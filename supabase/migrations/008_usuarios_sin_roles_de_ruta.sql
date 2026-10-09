-- Ejecutar después de 007_seguimiento_personal_ruta.sql.
-- Conserva admin internamente; todos los demás perfiles pasan a usuario común.
alter table public.profiles drop constraint if exists profiles_role_check;
update public.profiles set role = 'driver' where role in ('assistant', 'route_manager');
alter table public.profiles add constraint profiles_role_check check (role in ('driver', 'admin'));

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, full_name, cedula)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    nullif(new.raw_user_meta_data ->> 'cedula', ''));
  return new;
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
  if p_role <> 'driver' and exists (
    select 1 from public.trips where driver_id = p_user_id and ended_at is null
  ) then raise exception 'Finaliza la ruta activa antes de cambiar el rol del usuario'; end if;
  update public.profiles set role = p_role where id = p_user_id;
  if not found then raise exception 'Usuario no encontrado'; end if;
end;
$$;

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
  select * into v_driver from public.profiles where cedula = p_driver_cedula;
  if not found then raise exception 'La cédula del conductor no corresponde a un usuario registrado'; end if;
  select * into v_rr from public.profiles where cedula = p_rr_cedula;
  if not found then raise exception 'La cédula del responsable no corresponde a un usuario registrado'; end if;
  if nullif(trim(coalesce(p_assistant_cedula, '')), '') is not null then
    select * into v_assistant from public.profiles where cedula = p_assistant_cedula;
    if not found then raise exception 'La cédula del auxiliar no corresponde a un usuario registrado'; end if;
  end if;
  if not public.is_admin() and v_driver.id is distinct from (select auth.uid())
    and v_rr.id is distinct from (select auth.uid())
    and v_assistant.id is distinct from (select auth.uid()) then
    raise exception 'Tu cédula debe figurar en los datos del vehículo';
  end if;
  insert into public.vehicles (dt_number, plate, driver_id, route_manager_id, assistant_id)
  values (trim(p_dt_number), upper(trim(p_plate)), v_driver.id, v_rr.id, v_assistant.id)
  returning * into v_vehicle;
  return v_vehicle;
end;
$$;

create or replace function public.start_trip(p_vehicle_id uuid, p_sector text, p_zone text)
returns public.trips language plpgsql security definer set search_path = '' as $$
declare v_trip public.trips; v_vehicle public.vehicles; v_limit integer;
begin
  if (select auth.uid()) is null then raise exception 'Inicia sesión'; end if;
  v_limit := case p_zone when 'urbana' then 50 when 'nacional' then 70 when 'curvas' then 35 when 'escolar' then 30 else null end;
  if v_limit is null or length(trim(p_sector)) < 2 then raise exception 'Zona o sector inválido'; end if;
  select * into v_vehicle from public.vehicles where id = p_vehicle_id and enabled;
  if v_vehicle.id is null or not coalesce((
    v_vehicle.driver_id = (select auth.uid()) or
    v_vehicle.assistant_id = (select auth.uid()) or
    v_vehicle.route_manager_id = (select auth.uid())
  ), false) then raise exception 'Vehículo no asignado'; end if;
  insert into public.trips(vehicle_id, driver_id, tracker_id, sector, zone, speed_limit)
  values(p_vehicle_id, v_vehicle.driver_id, (select auth.uid()), trim(p_sector), p_zone, v_limit)
  returning * into v_trip;
  return v_trip;
end;
$$;

revoke all on function public.set_user_role(uuid,text) from public;
revoke all on function public.create_route_vehicle(text,text,text,text,text) from public;
revoke all on function public.start_trip(uuid,text,text) from public;
grant execute on function public.set_user_role(uuid,text) to authenticated;
grant execute on function public.create_route_vehicle(text,text,text,text,text) to authenticated;
grant execute on function public.start_trip(uuid,text,text) to authenticated;
