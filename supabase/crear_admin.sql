-- Primero crea o confirma la cuenta en Supabase Dashboard > Authentication > Users.
-- Esta cuenta ya existe en Authentication. No insertes en auth.users.
do $$
begin
  insert into public.profiles (id, full_name, role)
  select id, coalesce(nullif(raw_user_meta_data ->> 'full_name', ''), 'Administrador'), 'admin'
  from auth.users
  where lower(email) = lower('administrador@gmail.com')
  on conflict (id) do update set role = 'admin';

  if not found then
    raise exception 'No existe administrador@gmail.com en Authentication > Users. Comprueba el correo de la cuenta allí.';
  end if;
end;
$$;
