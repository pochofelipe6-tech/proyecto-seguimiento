-- Ejecutar una vez en SQL Editor después de 004_autoregistro_roles.sql.
alter table public.vehicles add column if not exists dt_number text;
alter table public.vehicles add column if not exists route_manager_id uuid references public.profiles(id) on delete set null;
alter table public.vehicles add column if not exists assistant_id uuid references public.profiles(id) on delete set null;

create or replace function public.lookup_route_person(p_cedula text)
returns table(person_name text, person_role text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null then raise exception 'Inicia sesión'; end if;
  if p_cedula !~ '^[0-9]{6,15}$' then return; end if;
  return query select p.full_name, p.role from public.profiles p where p.cedula = p_cedula limit 1;
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
  select * into v_driver from public.profiles where cedula = p_driver_cedula and role = 'driver';
  if not found then raise exception 'La cédula del conductor no corresponde a un conductor registrado'; end if;
  if v_driver.id <> (select auth.uid()) and not public.is_admin() then
    raise exception 'Solo puedes registrar un vehículo para tu propia cédula';
  end if;
  select * into v_rr from public.profiles where cedula = p_rr_cedula and role = 'route_manager';
  if not found then raise exception 'La cédula del responsable no corresponde a un responsable de ruta'; end if;
  if nullif(trim(coalesce(p_assistant_cedula, '')), '') is not null then
    select * into v_assistant from public.profiles where cedula = p_assistant_cedula and role = 'assistant';
    if not found then raise exception 'La cédula del auxiliar no corresponde a un auxiliar de ruta'; end if;
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
  where v.driver_id = (select auth.uid())
  order by v.created_at desc;
$$;

revoke all on function public.lookup_route_person(text) from public;
revoke all on function public.create_route_vehicle(text,text,text,text,text) from public;
revoke all on function public.list_my_route_vehicles() from public;
grant execute on function public.lookup_route_person(text) to authenticated;
grant execute on function public.create_route_vehicle(text,text,text,text,text) to authenticated;
grant execute on function public.list_my_route_vehicles() to authenticated;
