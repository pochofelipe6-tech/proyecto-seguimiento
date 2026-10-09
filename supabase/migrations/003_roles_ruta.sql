-- Ejecutar una vez en SQL Editor si ya se aplicó schema.sql anteriormente.
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('driver', 'assistant', 'route_manager', 'admin'));

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
