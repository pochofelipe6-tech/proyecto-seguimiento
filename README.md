# Ruta Segura SST

## Aplicación web con Next.js

La versión web usa Next.js App Router. En `.env.local`, coloca `NEXT_PUBLIC_SUPABASE_URL` y `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` reales de tu proyecto. Los nombres antiguos `SUPABASE_URL` y `SUPABASE_ANON_KEY` también funcionan. El archivo está excluido de Git. Las variables privadas (`SUPABASE_SECRET_KEY`, VAPID y otras) no se envían al navegador. La compilación del APK toma de ese archivo **solo** la URL y la clave pública; debes volver a ejecutar `npm run android:apk` después de configurar Supabase.

Ejecuta `npm install`, `npm run dev` y abre `http://localhost:3000`. Para producción, usa `npm run build` y `npm run start`. El proyecto Android/Capacitor y su compilación con `npm run android:apk` continúan disponibles por separado.

Aplicación Android (Capacitor) con roles de conductor, auxiliar de ruta, responsable de ruta y administrador. Usa Supabase para autenticación, registro de rutas y alertas, y Leaflet/OpenStreetMap para el mapa.

## Configurar Supabase

1. Crea un proyecto Supabase y ejecuta [schema.sql](supabase/schema.sql) en SQL Editor.
2. En Authentication, crea las cuentas de los conductores y del administrador. Cada cuenta recibe un perfil `driver` automáticamente.
3. En SQL Editor, cambia el rol del administrador: `update public.profiles set role = 'admin' where id = '<UUID_DEL_USUARIO_ADMIN>';`. El UUID está en Authentication > Users.
4. Copia **Project URL** y la clave **publishable** en `.env.local`. Nunca uses la clave `service_role` dentro de la app.
5. Ejecuta `npm install` y `npm run android:apk`. La salida está en `Ruta-Segura.apk`. Para web, ejecuta `npm run build:web` y sirve `dist/` con HTTPS para acceder al GPS.

### Registro de usuarios

La pantalla de acceso incluye **Crear cuenta de conductor** con nombre, cédula, contraseña y un desplegable de rol: conductor, auxiliar de ruta o responsable de ruta; no se solicita correo. Nadie puede darse acceso de administrador desde el registro público: la función de base de datos descarta cualquier rol distinto de esos tres y asigna conductor por defecto. El administrador puede registrar usuarios con cualquiera de los cuatro roles y cambiar después su rol desde la tabla de usuarios. Los roles auxiliar y responsable quedan registrados, pero por ahora tienen una pantalla de cuenta sin acceso al GPS ni al panel administrativo. La app crea internamente un identificador de Supabase Auth a partir de la cédula; no es un buzón real. La contraseña queda en Supabase Auth; nombre, cédula y rol se guardan en `public.profiles`. Las cuentas anteriores que usaban correo todavía pueden ingresar escribiéndolo en el campo de cédula.

**Configuración necesaria:** en Supabase, ve a Authentication → Sign In / Providers → Email y desactiva **Confirm Email**; guarda el cambio. La app no puede modificar ese ajuste con la clave pública y bloquea registros sin correo mientras esté activado. Sin un correo real no habrá recuperación de contraseña por email; un administrador tendrá que gestionar el restablecimiento. Si tu proyecto ya ejecutó el `schema.sql` anterior, aplica [002_registro_usuarios.sql](supabase/migrations/002_registro_usuarios.sql) si aún falta, después [003_roles_ruta.sql](supabase/migrations/003_roles_ruta.sql) y por último [004_autoregistro_roles.sql](supabase/migrations/004_autoregistro_roles.sql) en SQL Editor. Para proyectos nuevos, `schema.sql` ya incluye los cambios.

El administrador puede dar de alta una placa y asignarla a una cuenta de conductor. El conductor inicia una ruta, acepta el permiso de ubicación y mantiene la app abierta. El GPS envía coordenadas y velocidad aproximadamente cada 4 segundos. El servidor guarda las posiciones en `positions`, el estado y kilometraje acumulado en `trips` y cada episodio de exceso en `speed_alerts`. Una alerta continúa actualizando su velocidad máxima mientras el vehículo siga sobre el límite; al volver al límite y superarlo de nuevo, se crea otro evento. La tabla de rutas deja vacía la celda de alerta si esa ruta no registró excesos.

El conductor también puede pulsar **Agregar vehículo** junto al selector. El formulario solicita número de DT, placa, cédula del responsable de ruta y cédula del conductor; la cédula del auxiliar es opcional. Al escribir cada cédula se consulta el nombre en `profiles` y se comprueba el rol. El conductor solo puede crear un vehículo para su propia cédula; la base de datos vuelve a verificar todas las asignaciones al guardar. La tabla del formulario muestra los vehículos del conductor con nombres y cédulas. En proyectos existentes, ejecuta [005_vehiculos_ruta.sql](supabase/migrations/005_vehiculos_ruta.sql) después de las migraciones anteriores.

Si el registro sigue dejando todos los perfiles como `driver`, el proyecto conserva el trigger anterior. Ejecuta [006_reparar_roles_registro.sql](supabase/migrations/006_reparar_roles_registro.sql) en SQL Editor. Esta migración añade la cédula si faltaba, actualiza el trigger y recupera los roles auxiliar o responsable de cuentas que enviaron ese rol en sus metadatos de Auth. No modifica administradores ni conductores con ruta activa. Una cuenta registrada con una versión antigua de la APK que no enviaba rol debe corregirse manualmente desde el panel administrador.

Las tablas tienen políticas RLS: el administrador puede ver la flota, y el conductor solo sus rutas y vehículo asignado. Las escrituras de posiciones y alertas se hacen por funciones SQL que validan al conductor autenticado. El mapa se actualiza con Supabase Realtime y tiene un botón de actualización manual.

## Consideraciones

- Esta versión requiere que la app del conductor permanezca **abierta**. No ofrece seguimiento garantizado en segundo plano ni con el teléfono apagado o sin internet.
- El GPS puede entregar una velocidad desconocida; en ese caso no se genera una alerta de velocidad. La ubicación requiere permiso del conductor.
- Los límites configurados son preventivos SST: urbana 50, nacional 70, curvas 35 y escolar/residencial 30 km/h. No sustituyen la señalización ni la norma aplicable a cada vía.
- El APK generado es de desarrollo (`debug`). Para distribución pública debe firmarse una compilación `release`.
