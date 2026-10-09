-- Ejecutar UNA vez en SQL Editor si ya se aplicó schema.sql anteriormente.
alter table public.profiles add column if not exists cedula text;
create unique index if not exists profiles_cedula_unique
  on public.profiles(cedula) where cedula is not null;

do $$ begin
  if not exists (
    select 1 from pg_constraint where conname = 'profiles_cedula_format'
  ) then
    alter table public.profiles add constraint profiles_cedula_format
      check (cedula is null or cedula ~ '^[0-9]{6,15}$');
  end if;
end $$;

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
  update public.profiles set role = p_role where id = p_user_id;
  if not found then raise exception 'Usuario no encontrado'; end if;
end;
$$;

revoke all on function public.set_user_role(uuid,text) from public;
grant execute on function public.set_user_role(uuid,text) to authenticated;
