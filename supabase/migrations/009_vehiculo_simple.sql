-- Ejecutar una vez en SQL Editor. No requiere las columnas DT, RR o auxiliar.
-- Solo permite registrar un vehículo a nombre de la cuenta autenticada.
create or replace function public.create_simple_vehicle(p_driver_name text, p_plate text)
returns public.vehicles language plpgsql security definer set search_path = '' as $$
declare v_profile public.profiles; v_vehicle public.vehicles;
begin
  if (select auth.uid()) is null then raise exception 'Inicia sesión'; end if;
  select * into v_profile from public.profiles where id = (select auth.uid());
  if not found then raise exception 'No se encontró tu perfil'; end if;
  if length(trim(coalesce(p_driver_name, ''))) < 3
    or lower(trim(p_driver_name)) <> lower(trim(v_profile.full_name)) then
    raise exception 'El nombre del conductor debe coincidir con el nombre de tu cuenta';
  end if;
  if upper(trim(coalesce(p_plate, ''))) !~ '^[A-Z0-9]{5,8}$' then raise exception 'Placa inválida'; end if;
  insert into public.vehicles (plate, driver_id)
  values (upper(trim(p_plate)), v_profile.id)
  returning * into v_vehicle;
  return v_vehicle;
end;
$$;

revoke all on function public.create_simple_vehicle(text,text) from public;
grant execute on function public.create_simple_vehicle(text,text) to authenticated;
