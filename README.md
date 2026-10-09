# Ruta Segura SST

## Aplicación web con Next.js

La versión web usa Next.js App Router. En `.env.local`, coloca `NEXT_PUBLIC_SUPABASE_URL` y `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` reales de tu proyecto. Los nombres antiguos `SUPABASE_URL` y `SUPABASE_ANON_KEY` también funcionan. El archivo está excluido de Git. Las variables privadas (`SUPABASE_SECRET_KEY`, VAPID y otras) no se envían al navegador. La compilación del APK toma de ese archivo **solo** la URL y la clave pública; debes volver a ejecutar `npm run android:apk` después de configurar Supabase.

Ejecuta `npm install`, `npm run dev` y abre `http://localhost:3000`. Para producción, usa `npm run build` y `npm run start`. El proyecto Android/Capacitor y su compilación con `npm run android:apk` continúan disponibles por separado.

Aplicación Android (Capacitor) con cuentas de usuario y una cuenta de administración. Usa Supabase para autenticación, registro de rutas y alertas, y Leaflet/OpenStreetMap para el mapa.

## Configurar Supabase

1. Crea un proyecto Supabase y ejecuta [schema.sql](supabase/schema.sql) en SQL Editor.
2. Cada persona puede crear su cuenta desde la app con nombre, cédula y contraseña. Internamente recibe el perfil `driver`, sin elegir rol.
3. En SQL Editor, cambia el rol del administrador: `update public.profiles set role = 'admin' where id = '<UUID_DEL_USUARIO_ADMIN>';`. El UUID está en Authentication > Users.
4. Copia **Project URL** y la clave **publishable** en `.env.local`. Nunca uses la clave `service_role` dentro de la app.
5. Ejecuta `npm install` y `npm run android:apk`. La salida está en `Ruta-Segura.apk`. Para web, ejecuta `npm run build:web` y sirve `dist/` con HTTPS para acceder al GPS.

### Registro de usuarios

El registro público pide solo nombre, cédula y contraseña. Al crear la cuenta muestra **«Usuario creado exitosamente»** y regresa al inicio de sesión. La app crea internamente un identificador de Supabase Auth a partir de la cédula; no es un buzón real. La contraseña queda en Supabase Auth; nombre y cédula se guardan en `public.profiles`. El valor interno `driver` identifica a los usuarios comunes; `admin` se reserva para el panel de administración y no se puede elegir en el registro. Las cuentas anteriores con correo real pueden ingresar escribiéndolo en el campo de cédula.

**Configuración necesaria:** en Supabase, ve a Authentication → Sign In / Providers → Email y desactiva **Confirm Email**; guarda el cambio. La app no puede modificar ese ajuste con la clave pública y bloquea registros sin correo mientras esté activado. Sin correo real no habrá recuperación de contraseña por email. Para proyectos existentes, aplica las migraciones pendientes en orden hasta [008_usuarios_sin_roles_de_ruta.sql](supabase/migrations/008_usuarios_sin_roles_de_ruta.sql). Para proyectos nuevos, usa [schema.sql](supabase/schema.sql).

Si al ingresar aparece `column vehicles.assistant_id does not exist`, el proyecto conserva la tabla `vehicles` anterior. Ejecuta en SQL Editor, en este orden, [006_reparar_roles_registro.sql](supabase/migrations/006_reparar_roles_registro.sql), [005_vehiculos_ruta.sql](supabase/migrations/005_vehiculos_ruta.sql), [007_seguimiento_personal_ruta.sql](supabase/migrations/007_seguimiento_personal_ruta.sql) y [008_usuarios_sin_roles_de_ruta.sql](supabase/migrations/008_usuarios_sin_roles_de_ruta.sql). Son scripts repetibles para esta instalación. La app permite entrar con el esquema antiguo, pero el registro de vehículos y el seguimiento completo requieren actualizar la base de datos.

El administrador puede dar de alta una placa y asignarla a una cuenta de conductor. El conductor inicia una ruta, acepta el permiso de ubicación y mantiene la app abierta. El GPS envía coordenadas y velocidad aproximadamente cada 4 segundos. El servidor guarda las posiciones en `positions`, el estado y kilometraje acumulado en `trips` y cada episodio de exceso en `speed_alerts`. Una alerta continúa actualizando su velocidad máxima mientras el vehículo siga sobre el límite; al volver al límite y superarlo de nuevo, se crea otro evento. La tabla de rutas deja vacía la celda de alerta si esa ruta no registró excesos.

Cada usuario puede pulsar **Agregar vehículo** junto al selector. El formulario solicita número de DT, placa, cédula del responsable de ruta y cédula del conductor; la cédula del auxiliar es opcional. Al escribir cada cédula se consulta y muestra el nombre guardado en `profiles`. La base de datos comprueba que quien registra el vehículo figure en él, sin exigir un rol distinto. La tabla muestra los vehículos vinculados al usuario con nombres y cédulas.

La migración 008 convierte los antiguos valores `assistant` y `route_manager` a `driver` sin borrar usuarios, nombres, cédulas ni rutas. La distinción de conductor, responsable y auxiliar sigue en los campos del vehículo, no en el registro de cuenta.

Al iniciar sesión, todo usuario común entra en **Mi recorrido**. Puede iniciar el seguimiento de un vehículo al que esté vinculado, conceder ubicación y ver sus alertas de exceso de velocidad con contador total, fecha, hora, placa, sector, zona, velocidad máxima y límite. Las zonas usan los límites preventivos SST: urbana 50, vía nacional 70, curvas 35 y escolar/residencial 30 km/h. La app emite pitido y, cuando el dispositivo lo permite, vibración o notificación por exceso. Solo una persona asignada puede enviar el GPS de un vehículo a la vez. La app debe permanecer abierta durante la ruta.

Las tablas tienen políticas RLS: el administrador puede ver la flota, y cada usuario solo las rutas y vehículos que le corresponden. Las escrituras de posiciones y alertas se hacen por funciones SQL que validan a la persona autenticada que inició el seguimiento. El mapa se actualiza con Supabase Realtime y tiene un botón de actualización manual.

## Consideraciones

- Esta versión requiere que la app del conductor permanezca **abierta**. No ofrece seguimiento garantizado en segundo plano ni con el teléfono apagado o sin internet.
- El GPS puede entregar una velocidad desconocida; en ese caso no se genera una alerta de velocidad. La ubicación requiere permiso del conductor.
- Los límites configurados son preventivos SST: urbana 50, nacional 70, curvas 35 y escolar/residencial 30 km/h. No sustituyen la señalización ni la norma aplicable a cada vía.
- El APK generado es de desarrollo (`debug`). Para distribución pública debe firmarse una compilación `release`.
