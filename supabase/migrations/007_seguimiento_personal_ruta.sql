-- Ejecutar después de 005_vehiculos_ruta.sql y 006_reparar_roles_registro.sql.
-- Conserva al conductor real en trips.driver_id; tracker_id identifica quién envía el GPS.
alter table public.trips add column if not exists tracker_id uuid references public.profiles(id);
update public.trips set tracker_id = driver_id where tracker_id is null;
alter table public.trips alter column tracker_id set not null;
create unique index if not exists one_active_trip_per_tracker
  on public.trips(tracker_id) where ended_at is null;

drop policy if exists "vehicles readable by assigned driver or admin" on public.vehicles;
create policy "vehicles readable by assigned driver or admin" on public.vehicles
for select to authenticated using (
  driver_id = (select auth.uid()) or assistant_id = (select auth.uid())
  or route_manager_id = (select auth.uid()) or (select public.is_admin())
);
drop policy if exists "trips readable by driver or admin" on public.trips;
create policy "trips readable by driver or admin" on public.trips
for select to authenticated using (
  driver_id = (select auth.uid()) or tracker_id = (select auth.uid()) or (select public.is_admin())
);
drop policy if exists "positions readable by driver or admin" on public.positions;
create policy "positions readable by driver or admin" on public.positions
for select to authenticated using (exists (
  select 1 from public.trips t where t.id = trip_id and
    (t.driver_id = (select auth.uid()) or t.tracker_id = (select auth.uid()) or (select public.is_admin()))
));
drop policy if exists "alerts readable by driver or admin" on public.speed_alerts;
create policy "alerts readable by driver or admin" on public.speed_alerts
for select to authenticated using (exists (
  select 1 from public.trips t where t.id = trip_id and
    (t.driver_id = (select auth.uid()) or t.tracker_id = (select auth.uid()) or (select public.is_admin()))
));

create or replace function public.create_route_vehicle(
  p_dt_number text, p_plate text, p_rr_cedula text, p_driver_cedula text,
  p_assistant_cedula text default null
)
returns public.vehicles language plpgsql security definer set search_path = '' as $$
declare v_driver public.profiles; v_rr public.profiles; v_assistant public.profiles; v_vehicle public.vehicles;
begin
  if (select auth.uid()) is null then raise exception 'Inicia sesión'; end if;
  if p_dt_number is null or length(trim(p_dt_number)) not between 1 and 40 then raise exception 'Número de DT inválido'; end if;
  if upper(trim(p_plate)) !~ '^[A-Z0-9]{5,8}$' then raise exception 'Placa inválida'; end if;
  select * into v_driver from public.profiles where cedula = p_driver_cedula and role = 'driver';
  if not found then raise exception 'La cédula del conductor no corresponde a un conductor registrado'; end if;
  select * into v_rr from public.profiles where cedula = p_rr_cedula and role = 'route_manager';
  if not found then raise exception 'La cédula del responsable no corresponde a un responsable de ruta'; end if;
  if nullif(trim(coalesce(p_assistant_cedula, '')), '') is not null then
    select * into v_assistant from public.profiles where cedula = p_assistant_cedula and role = 'assistant';
    if not found then raise exception 'La cédula del auxiliar no corresponde a un auxiliar de ruta'; end if;
  end if;
  if not public.is_admin() and v_driver.id is distinct from (select auth.uid())
    and v_rr.id is distinct from (select auth.uid())
    and v_assistant.id is distinct from (select auth.uid()) then
    raise exception 'Tu cédula debe figurar como conductor, responsable o auxiliar del vehículo';
  end if;
  insert into public.vehicles (dt_number, plate, driver_id, route_manager_id, assistant_id)
  values (trim(p_dt_number), upper(trim(p_plate)), v_driver.id, v_rr.id, v_assistant.id)
  returning * into v_vehicle;
  return v_vehicle;
end;
$$;

create or replace function public.list_my_route_vehicles()
returns table(dt_number text, plate text, rr_cedula text, rr_name text,
  driver_cedula text, driver_name text, assistant_cedula text, assistant_name text)
language sql stable security definer set search_path = '' as $$
  select v.dt_number, v.plate, rr.cedula, rr.full_name, d.cedula, d.full_name,
    a.cedula, a.full_name
  from public.vehicles v
  join public.profiles d on d.id = v.driver_id
  left join public.profiles rr on rr.id = v.route_manager_id
  left join public.profiles a on a.id = v.assistant_id
  where v.driver_id = (select auth.uid()) or v.route_manager_id = (select auth.uid())
    or v.assistant_id = (select auth.uid())
  order by v.created_at desc;
$$;

create or replace function public.start_trip(p_vehicle_id uuid, p_sector text, p_zone text)
returns public.trips language plpgsql security definer set search_path = '' as $$
declare v_trip public.trips; v_vehicle public.vehicles; v_limit integer; v_role text;
begin
  if (select auth.uid()) is null then raise exception 'Inicia sesión'; end if;
  v_limit := case p_zone when 'urbana' then 50 when 'nacional' then 70 when 'curvas' then 35 when 'escolar' then 30 else null end;
  if v_limit is null or length(trim(p_sector)) < 2 then raise exception 'Zona o sector inválido'; end if;
  select * into v_vehicle from public.vehicles where id = p_vehicle_id and enabled;
  select role into v_role from public.profiles where id = (select auth.uid());
  if v_vehicle.id is null or v_role is null or not coalesce((
    (v_role = 'driver' and v_vehicle.driver_id = (select auth.uid())) or
    (v_role = 'assistant' and v_vehicle.assistant_id = (select auth.uid())) or
    (v_role = 'route_manager' and v_vehicle.route_manager_id = (select auth.uid()))
  ), false) then raise exception 'Vehículo no asignado'; end if;
  insert into public.trips(vehicle_id, driver_id, tracker_id, sector, zone, speed_limit)
  values(p_vehicle_id, v_vehicle.driver_id, (select auth.uid()), trim(p_sector), p_zone, v_limit)
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
  where id = p_trip_id and tracker_id = (select auth.uid()) and ended_at is null
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
  where id = p_trip_id and tracker_id = (select auth.uid()) and ended_at is null;
  if not found then raise exception 'Ruta no activa'; end if;
end;
$$;
