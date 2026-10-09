-- Ruta Segura: ejecutar una vez en el SQL Editor del proyecto Supabase.
create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  cedula text unique check (cedula ~ '^[0-9]{6,15}$'),
  role text not null default 'driver' check (role in ('driver', 'admin')),
  created_at timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, full_name, cedula)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    nullif(new.raw_user_meta_data ->> 'cedula', ''));
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
for each row execute function public.handle_new_user();

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.profiles where id = (select auth.uid()) and role = 'admin');
$$;

create table if not exists public.vehicles (
  id uuid primary key default gen_random_uuid(),
  plate text not null unique check (plate ~ '^[A-Z0-9]{5,8}$'),
  label text not null default '',
  driver_id uuid references public.profiles(id) on delete set null,
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.trips (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references public.vehicles(id),
  driver_id uuid not null references public.profiles(id),
  sector text not null check (length(trim(sector)) between 2 and 120),
  zone text not null check (zone in ('urbana','nacional','curvas','escolar')),
  speed_limit integer not null check (speed_limit in (30,35,50,70)),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  last_lat double precision,
  last_lng double precision,
  last_speed numeric(6,1),
  distance_km numeric(10,3) not null default 0,
  last_seen_at timestamptz,
  has_alert boolean not null default false,
  breach_open boolean not null default false
);
create unique index if not exists one_active_trip_per_vehicle on public.trips(vehicle_id) where ended_at is null;
create unique index if not exists one_active_trip_per_driver on public.trips(driver_id) where ended_at is null;
create index if not exists trips_active_seen_idx on public.trips(last_seen_at desc) where ended_at is null;

create table if not exists public.positions (
  id bigint generated always as identity primary key,
  trip_id uuid not null references public.trips(id) on delete cascade,
  recorded_at timestamptz not null default now(),
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  speed_kmh numeric(6,1) not null check (speed_kmh between 0 and 250),
  accuracy_m numeric(7,1)
);
create index if not exists positions_trip_time_idx on public.positions(trip_id, recorded_at desc);

create table if not exists public.speed_alerts (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  occurred_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  zone text not null,
  sector text not null,
  limit_kmh integer not null,
  peak_speed_kmh numeric(6,1) not null,
  latitude double precision,
  longitude double precision
);
create index if not exists alerts_trip_time_idx on public.speed_alerts(trip_id, occurred_at desc);

alter table public.profiles enable row level security;
alter table public.vehicles enable row level security;
alter table public.trips enable row level security;
alter table public.positions enable row level security;
alter table public.speed_alerts enable row level security;

revoke all on public.profiles, public.vehicles, public.trips, public.positions, public.speed_alerts from anon;
revoke all on public.profiles, public.vehicles, public.trips, public.positions, public.speed_alerts from authenticated;
grant select on public.profiles, public.vehicles, public.trips, public.positions, public.speed_alerts to authenticated;
grant insert, update, delete on public.vehicles to authenticated;
grant usage on sequence public.positions_id_seq to authenticated;

create policy "profiles readable by self or admin" on public.profiles
for select to authenticated using (id = (select auth.uid()) or (select public.is_admin()));
create policy "vehicles readable by assigned driver or admin" on public.vehicles
for select to authenticated using (driver_id = (select auth.uid()) or (select public.is_admin()));
create policy "admin creates vehicles" on public.vehicles
for insert to authenticated with check ((select public.is_admin()));
create policy "admin updates vehicles" on public.vehicles
for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "admin deletes vehicles" on public.vehicles
for delete to authenticated using ((select public.is_admin()));
create policy "trips readable by driver or admin" on public.trips
for select to authenticated using (driver_id = (select auth.uid()) or (select public.is_admin()));
create policy "positions readable by driver or admin" on public.positions
for select to authenticated using (exists (
  select 1 from public.trips t where t.id = trip_id and (t.driver_id = (select auth.uid()) or (select public.is_admin()))
));
create policy "alerts readable by driver or admin" on public.speed_alerts
for select to authenticated using (exists (
  select 1 from public.trips t where t.id = trip_id and (t.driver_id = (select auth.uid()) or (select public.is_admin()))
));

create or replace function public.start_trip(p_vehicle_id uuid, p_sector text, p_zone text)
returns public.trips language plpgsql security definer set search_path = '' as $$
declare v_trip public.trips; v_limit integer;
begin
  if (select auth.uid()) is null then raise exception 'Inicia sesión'; end if;
  v_limit := case p_zone when 'urbana' then 50 when 'nacional' then 70 when 'curvas' then 35 when 'escolar' then 30 else null end;
  if v_limit is null or length(trim(p_sector)) < 2 then raise exception 'Zona o sector inválido'; end if;
  if not exists(select 1 from public.vehicles where id = p_vehicle_id and driver_id = (select auth.uid()) and enabled) then
    raise exception 'Vehículo no asignado';
  end if;
  insert into public.trips(vehicle_id, driver_id, sector, zone, speed_limit)
  values(p_vehicle_id, (select auth.uid()), trim(p_sector), p_zone, v_limit)
  returning * into v_trip;
  return v_trip;
end;
$$;

create or replace function public.record_position(
  p_trip_id uuid, p_lat double precision, p_lng double precision,
  p_speed numeric, p_accuracy numeric default null
)
returns table(exceeded boolean, alert_id uuid, limit_kmh integer, total_km numeric)
language plpgsql security definer set search_path = '' as $$
declare v_trip public.trips; v_alert_id uuid; v_speed numeric(6,1); v_segment numeric;
begin
  select * into v_trip from public.trips
  where id = p_trip_id and driver_id = (select auth.uid()) and ended_at is null
  for update;
  if not found then raise exception 'Ruta no activa'; end if;
  if p_lat not between -90 and 90 or p_lng not between -180 and 180 or p_speed not between 0 and 250 then
    raise exception 'Lectura GPS inválida';
  end if;
  v_speed := round(p_speed, 1);
  v_segment := case when v_trip.last_lat is null then 0 else
    6371 * 2 * asin(sqrt(least(1, power(sin(radians(p_lat - v_trip.last_lat) / 2), 2)
      + cos(radians(v_trip.last_lat)) * cos(radians(p_lat))
      * power(sin(radians(p_lng - v_trip.last_lng) / 2), 2)))) end;
  insert into public.positions(trip_id, latitude, longitude, speed_kmh, accuracy_m)
  values(p_trip_id, p_lat, p_lng, v_speed, p_accuracy);
  update public.trips set last_lat = p_lat, last_lng = p_lng, last_speed = v_speed,
    last_seen_at = now(), distance_km = distance_km + case when v_segment <= 2 then v_segment else 0 end,
    breach_open = (v_speed > v_trip.speed_limit),
    has_alert = has_alert or (v_speed > v_trip.speed_limit)
  where id = p_trip_id;

  if v_speed > v_trip.speed_limit then
    if v_trip.breach_open then
      select id into v_alert_id from public.speed_alerts where trip_id = p_trip_id order by occurred_at desc limit 1;
      update public.speed_alerts set peak_speed_kmh = greatest(peak_speed_kmh, v_speed),
        updated_at = now(), latitude = p_lat, longitude = p_lng where id = v_alert_id;
    else
      insert into public.speed_alerts(trip_id, zone, sector, limit_kmh, peak_speed_kmh, latitude, longitude)
      values(p_trip_id, v_trip.zone, v_trip.sector, v_trip.speed_limit, v_speed, p_lat, p_lng)
      returning id into v_alert_id;
    end if;
  end if;
  return query select v_speed > v_trip.speed_limit, v_alert_id, v_trip.speed_limit,
    (select t.distance_km from public.trips t where t.id = p_trip_id);
end;
$$;

create or replace function public.finish_trip(p_trip_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.trips set ended_at = now(), breach_open = false
  where id = p_trip_id and driver_id = (select auth.uid()) and ended_at is null;
  if not found then raise exception 'Ruta no activa'; end if;
end;
$$;

create or replace function public.set_user_role(p_user_id uuid, p_role text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'Solo un administrador puede asignar roles'; end if;
  if p_role not in ('driver', 'admin') then raise exception 'Rol inválido'; end if;
  if p_user_id = (select auth.uid()) and p_role <> 'admin' then
    raise exception 'No puedes quitarte tu propio rol de administrador';
  end if;
  update public.profiles set role = p_role where id = p_user_id;
  if not found then raise exception 'Usuario no encontrado'; end if;
end;
$$;

revoke all on function public.start_trip(uuid,text,text) from public;
revoke all on function public.record_position(uuid,double precision,double precision,numeric,numeric) from public;
revoke all on function public.finish_trip(uuid) from public;
revoke all on function public.set_user_role(uuid,text) from public;
grant execute on function public.start_trip(uuid,text,text) to authenticated;
grant execute on function public.record_position(uuid,double precision,double precision,numeric,numeric) to authenticated;
grant execute on function public.finish_trip(uuid) to authenticated;
grant execute on function public.set_user_role(uuid,text) to authenticated;

do $$ begin
  alter publication supabase_realtime add table public.trips;
exception when duplicate_object then null;
end $$;
do $$ begin
  alter publication supabase_realtime add table public.speed_alerts;
exception when duplicate_object then null;
end $$;

-- Después de crear el primer usuario administrador en Authentication, asígnale el rol:
-- update public.profiles set role = 'admin' where id = '<UUID_DEL_USUARIO_ADMIN>';
