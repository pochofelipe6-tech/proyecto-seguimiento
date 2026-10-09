-- Reparación idempotente para proyectos que conservaron el trigger/esquema antiguos.
-- Ejecutar en SQL Editor. No borra cuentas ni cambia administradores existentes.
alter table public.profiles add column if not exists cedula text;

-- Recuperar cédulas de Auth solo si son válidas y no están duplicadas.
with candidate as (
  select u.id, u.raw_user_meta_data ->> 'cedula' as cedula,
    count(*) over (partition by u.raw_user_meta_data ->> 'cedula') as repetitions
  from auth.users u
  where u.raw_user_meta_data ->> 'cedula' ~ '^[0-9]{6,15}$'
)
update public.profiles p set cedula = c.cedula
from candidate c
where p.id = c.id and p.cedula is null and c.repetitions = 1
  and not exists (select 1 from public.profiles other where other.cedula = c.cedula);

create unique index if not exists profiles_cedula_unique
  on public.profiles(cedula) where cedula is not null;

alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('driver', 'assistant', 'route_manager', 'admin'));

-- Corregir cuentas cuyo rol elegido quedó como conductor por el trigger anterior.
-- No alterar administradores ni conductores con una ruta activa.
update public.profiles p set role = u.raw_user_meta_data ->> 'role'
from auth.users u
where p.id = u.id and p.role = 'driver'
  and u.raw_user_meta_data ->> 'role' in ('assistant', 'route_manager')
  and not exists (select 1 from public.trips t where t.driver_id = p.id and t.ended_at is null);

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, full_name, cedula, role)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    nullif(new.raw_user_meta_data ->> 'cedula', ''),
    case when new.raw_user_meta_data ->> 'role' in ('driver', 'assistant', 'route_manager')
      then new.raw_user_meta_data ->> 'role' else 'driver' end);
  return new;
end;
$$;

create or replace function public.set_user_role(p_user_id uuid, p_role text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'Solo un administrador puede asignar roles'; end if;
  if p_role not in ('driver', 'assistant', 'route_manager', 'admin') then raise exception 'Rol inválido'; end if;
  if p_user_id = (select auth.uid()) and p_role <> 'admin' then
    raise exception 'No puedes quitarte tu propio rol de administrador';
  end if;
  if p_role <> 'driver' and exists (
    select 1 from public.trips where driver_id = p_user_id and ended_at is null
  ) then raise exception 'Finaliza la ruta activa antes de cambiar el rol del conductor'; end if;
  update public.profiles set role = p_role where id = p_user_id;
  if not found then raise exception 'Usuario no encontrado'; end if;
end;
$$;

revoke all on function public.set_user_role(uuid,text) from public;
grant execute on function public.set_user_role(uuid,text) to authenticated;
