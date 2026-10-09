# Ruta Segura SST

Aplicación Android (Capacitor) con dos roles: conductor y administrador. Usa Supabase para autenticación, registro de rutas y alertas, y Leaflet/OpenStreetMap para el mapa.

## Configurar Supabase

1. Crea un proyecto Supabase y ejecuta [schema.sql](supabase/schema.sql) en SQL Editor.
2. En Authentication, crea las cuentas de los conductores y del administrador. Cada cuenta recibe un perfil `driver` automáticamente.
3. En SQL Editor, cambia el rol del administrador: `update public.profiles set role = 'admin' where id = '<UUID_DEL_USUARIO_ADMIN>';`. El UUID está en Authentication > Users.
4. Copia **Project URL** y la clave **anon/publishable** en [supabase-config.js](src/supabase-config.js). Nunca uses la clave `service_role` dentro de la app.
5. Ejecuta `npm install` y `npm run android:apk`. La salida está en `Ruta-Segura.apk`. Para web, ejecuta `npm run build:web` y sirve `dist/` con HTTPS para acceder al GPS.

El administrador puede dar de alta una placa y asignarla a una cuenta de conductor. El conductor inicia una ruta, acepta el permiso de ubicación y mantiene la app abierta. El GPS envía coordenadas y velocidad aproximadamente cada 4 segundos. El servidor guarda las posiciones en `positions`, el estado y kilometraje acumulado en `trips` y cada episodio de exceso en `speed_alerts`. Una alerta continúa actualizando su velocidad máxima mientras el vehículo siga sobre el límite; al volver al límite y superarlo de nuevo, se crea otro evento. La tabla de rutas deja vacía la celda de alerta si esa ruta no registró excesos.

Las tablas tienen políticas RLS: el administrador puede ver la flota, y el conductor solo sus rutas y vehículo asignado. Las escrituras de posiciones y alertas se hacen por funciones SQL que validan al conductor autenticado. El mapa se actualiza con Supabase Realtime y tiene un botón de actualización manual.

## Consideraciones

- Esta versión requiere que la app del conductor permanezca **abierta**. No ofrece seguimiento garantizado en segundo plano ni con el teléfono apagado o sin internet.
- El GPS puede entregar una velocidad desconocida; en ese caso no se genera una alerta de velocidad. La ubicación requiere permiso del conductor.
- Los límites configurados son preventivos SST: urbana 50, nacional 70, curvas 35 y escolar/residencial 30 km/h. No sustituyen la señalización ni la norma aplicable a cada vía.
- El APK generado es de desarrollo (`debug`). Para distribución pública debe firmarse una compilación `release`.
