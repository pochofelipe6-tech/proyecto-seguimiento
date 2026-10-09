-- Ejecutar después de 003_roles_ruta.sql en proyectos existentes.
-- Solo permite autoasignarse roles no administrativos al crear la cuenta.
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
