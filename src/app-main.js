import { createClient } from "@supabase/supabase-js";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./supabase-config.js";

const $ = (id) => document.getElementById(id);
const limits = { urbana: 50, nacional: 70, curvas: 35, escolar: 30 };
const zoneNames = { urbana: "Urbana", nacional: "Vía nacional", curvas: "Curvas", escolar: "Escolar / residencial" };
const native = window.RutaSeguraNative;
const configuredUrl = window.RutaSeguraConfig?.url || SUPABASE_URL;
const configuredKey = window.RutaSeguraConfig?.anonKey || SUPABASE_ANON_KEY;
const supabase = configuredUrl && configuredKey ? createClient(configuredUrl, configuredKey) : null;
const emailForCedula = (cedula) => `cedula-${cedula}@rutasegura.invalid`;
const roleNames = { driver: "Conductor", assistant: "Auxiliar de ruta", route_manager: "Responsable de ruta", admin: "Administrador" };
const roleOptions = Object.entries(roleNames).map(([value, label]) => `<option value="${value}">${label}</option>`).join("");
async function requireCedulaOnlyAuth() {
  const response = await fetch(`${configuredUrl}/auth/v1/settings`, { headers: { apikey: configuredKey } });
  if (!response.ok) throw new Error("No se pudo verificar la configuración de registro de Supabase.");
  const settings = await response.json();
  if (settings.mailer_autoconfirm !== true) {
    throw new Error("El administrador debe desactivar Confirm Email en Supabase > Authentication > Providers > Email antes de registrar usuarios sin correo.");
  }
}
let user, profile, activeTrip, watchId, watchKind, map, mapLayer, routeLayer, channel;
let lastSent = 0, lastAlarm = 0, refreshTimer, audioContext;
let adminTrips = [], adminVehicles = [], adminProfiles = [], adminAlerts = [];
let registrationReady = false;

function show(view) {
  for (const id of ["setupView", "loginView", "signupView", "driverView", "staffView", "adminView"]) $(id).hidden = id !== view;
  $("registrationPanel").hidden = view !== "adminView";
  $("sessionBar").hidden = view === "loginView" || view === "signupView" || view === "setupView";
}
function message(id, text, error = false) { $(id).textContent = text; $(id).classList.toggle("error", error); }
function clean(value) { return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]); }
function date(value) { return value ? new Date(value).toLocaleString("es-CO", { dateStyle: "short", timeStyle: "short" }) : "—"; }
function failure(result) { if (result.error) throw result.error; return result.data; }
function stopTracking() {
  if (watchId != null) {
    if (watchKind === "native") native.clearWatch(watchId).catch(() => {});
    else navigator.geolocation.clearWatch(watchId);
  }
  watchId = null;
}
function beep() {
  try {
    audioContext ||= new (window.AudioContext || window.webkitAudioContext)();
    if (audioContext.state === "suspended") audioContext.resume();
    const oscillator = audioContext.createOscillator(), gain = audioContext.createGain();
    oscillator.type = "square"; oscillator.frequency.value = 880;
    gain.gain.setValueAtTime(0.13, audioContext.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + 0.35);
    oscillator.connect(gain).connect(audioContext.destination);
    oscillator.start(); oscillator.stop(audioContext.currentTime + 0.35);
  } catch (_) {}
}
async function alarm(speed, limit) {
  if (Date.now() - lastAlarm < 10000) return;
  lastAlarm = Date.now(); beep();
  if (native.isNative) { native.vibrate().catch(() => {}); native.notify(speed, limit).catch(() => {}); }
  else if ("Notification" in window && Notification.permission === "granted") new Notification("Reduce la velocidad", { body: `Vas a ${Math.round(speed)} km/h. Límite: ${limit} km/h.` });
}
function updateSpeed(speed, limit) {
  $("speedValue").textContent = Math.round(speed);
  $("limitValue").textContent = limit;
  const exceeded = speed > limit;
  $("speedState").classList.toggle("over", exceeded);
  $("speedState").textContent = exceeded ? "Exceso de velocidad" : "Dentro del límite";
  $("alertBanner").hidden = !exceeded;
  if (exceeded) alarm(speed, limit);
}
async function onPosition(position, error) {
  if (error) { message("driverMessage", `GPS: ${error.message || error}`, true); return; }
  if (!position?.coords || !activeTrip) return;
  const { latitude, longitude, speed, accuracy } = position.coords;
  // Geolocation.speed se entrega en m/s; sin lectura de velocidad no se inventa un exceso.
  const kmh = speed == null || speed < 0 ? 0 : Math.min(250, speed * 3.6);
  updateSpeed(kmh, activeTrip.speed_limit);
  $("gpsInfo").textContent = `${latitude.toFixed(5)}, ${longitude.toFixed(5)} · precisión ${Math.round(accuracy || 0)} m · ${new Date().toLocaleTimeString("es-CO")}`;
  if (Date.now() - lastSent < 4000) return;
  lastSent = Date.now();
  try {
    const result = failure(await supabase.rpc("record_position", { p_trip_id: activeTrip.id, p_lat: latitude, p_lng: longitude, p_speed: kmh, p_accuracy: accuracy || null }));
    if (result?.[0]) $("distanceValue").textContent = Number(result[0].total_km).toLocaleString("es-CO", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    message("driverMessage", "Ubicación enviada al centro de control.");
  } catch (err) { message("driverMessage", `No se pudo enviar la ubicación: ${err.message}`, true); }
}
async function startTracking() {
  stopTracking(); lastSent = 0;
  try {
    if (native.isNative) {
      const permissions = await native.requestPermissions();
      if (permissions.location !== "granted") throw new Error("Permite el acceso a la ubicación para iniciar el seguimiento.");
      watchId = await native.watchPosition({ enableHighAccuracy: true }, onPosition);
      watchKind = "native";
    } else {
      if (!navigator.geolocation) throw new Error("Este dispositivo no ofrece GPS.");
      if ("Notification" in window && Notification.permission === "default") Notification.requestPermission().catch(() => {});
      watchId = navigator.geolocation.watchPosition((p) => onPosition(p), (e) => onPosition(null, e), { enableHighAccuracy: true, maximumAge: 1000, timeout: 20000 });
      watchKind = "web";
    }
    message("driverMessage", "GPS activado. Mantén la aplicación abierta durante la ruta.");
  } catch (err) { message("driverMessage", err.message, true); throw err; }
}
function renderTrip() {
  const running = !!activeTrip;
  $("driverStatus").textContent = running ? "Ruta activa" : "Sin ruta activa";
  $("driverStatus").classList.toggle("active", running);
  $("startButton").hidden = running; $("stopButton").hidden = !running;
  for (const element of $("tripForm").querySelectorAll("input,select")) element.disabled = running;
  if (running) { $("limitValue").textContent = activeTrip.speed_limit; $("sector").value = activeTrip.sector; $("distanceValue").textContent = Number(activeTrip.distance_km || 0).toLocaleString("es-CO", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  else { $("speedValue").textContent = "0"; $("distanceValue").textContent = "0,00"; $("speedState").textContent = "Esperando ruta"; $("alertBanner").hidden = true; }
}
$("driverVehicle").closest("label").insertAdjacentHTML("afterend", '<button id="showVehicleForm" type="button" class="secondary vehicle-add-button">Agregar vehículo</button>');
$("tripForm").insertAdjacentHTML("afterend", `
  <section id="driverVehiclePanel" class="vehicle-registration" hidden>
    <h2>Agregar vehículo a la ruta</h2>
    <form id="driverVehicleForm">
      <div class="vehicle-form-grid">
        <label>Número de DT<input id="vehicleDt" type="text" maxlength="40" required></label>
        <label>Placa del vehículo<input id="vehiclePlateNew" type="text" maxlength="8" placeholder="ABC123" required></label>
        <label>Cédula de responsable de ruta (RR)<input id="vehicleRrCedula" type="text" inputmode="numeric" pattern="[0-9]{6,15}" maxlength="15" required><small id="vehicleRrName" class="person-result" aria-live="polite"></small></label>
        <label>Cédula de conductor<input id="vehicleDriverCedula" type="text" inputmode="numeric" pattern="[0-9]{6,15}" maxlength="15" required><small id="vehicleDriverName" class="person-result" aria-live="polite"></small></label>
        <label>Cédula de auxiliar (opcional)<input id="vehicleAssistantCedula" type="text" inputmode="numeric" pattern="[0-9]{6,15}" maxlength="15"><small id="vehicleAssistantName" class="person-result" aria-live="polite"></small></label>
      </div>
      <button type="submit">Guardar vehículo</button>
      <p id="driverVehicleMessage" class="message" role="status"></p>
    </form>
    <h2>Vehículos registrados</h2>
    <div class="table-scroll"><table><thead><tr><th>DT</th><th>Placa</th><th>Responsable de ruta</th><th>Conductor</th><th>Auxiliar</th></tr></thead><tbody id="driverVehicleRows"></tbody></table></div>
  </section>`);
const personFields = [
  { input: "vehicleRrCedula", output: "vehicleRrName", role: "route_manager", required: true },
  { input: "vehicleDriverCedula", output: "vehicleDriverName", role: "driver", required: true },
  { input: "vehicleAssistantCedula", output: "vehicleAssistantName", role: "assistant", required: false },
];
async function lookupPerson(field) {
  const cedula = $(field.input).value.trim();
  if (!cedula && !field.required) { $(field.output).textContent = "Sin auxiliar"; return null; }
  if (!/^[0-9]{6,15}$/.test(cedula)) { $(field.output).textContent = "Escribe una cédula válida"; return null; }
  try {
    const people = failure(await supabase.rpc("lookup_route_person", { p_cedula: cedula }));
    if ($(field.input).value.trim() !== cedula) return null;
    const person = people?.[0];
    $(field.output).textContent = !person ? "No se encontró esa cédula" : person.person_role !== field.role
      ? `${person.person_name} · rol incorrecto: ${roleNames[person.person_role] || person.person_role}`
      : person.person_name;
    return person?.person_role === field.role ? person : null;
  } catch (err) { $(field.output).textContent = "No se pudo consultar la cédula. Revisa la migración 005."; return null; }
}
for (const field of personFields) {
  let timer;
  $(field.input).addEventListener("input", () => {
    clearTimeout(timer);
    $(field.output).textContent = "Buscando...";
    timer = setTimeout(() => lookupPerson(field), 300);
  });
}
function formatPerson(name, cedula) { return name ? `${clean(name)}<br><small>${clean(cedula || "")}</small>` : "—"; }
async function loadDriverVehicleTable() {
  const rows = failure(await supabase.rpc("list_my_route_vehicles"));
  $("driverVehicleRows").innerHTML = rows.length ? rows.map((v) => `<tr><td>${clean(v.dt_number || "—")}</td><td>${clean(v.plate)}</td><td>${formatPerson(v.rr_name, v.rr_cedula)}</td><td>${formatPerson(v.driver_name, v.driver_cedula)}</td><td>${formatPerson(v.assistant_name, v.assistant_cedula)}</td></tr>`).join("") : '<tr><td colspan="5">Aún no hay vehículos registrados.</td></tr>';
}
$("showVehicleForm").addEventListener("click", async () => {
  const panel = $("driverVehiclePanel");
  panel.hidden = !panel.hidden;
  $("showVehicleForm").textContent = panel.hidden ? "Agregar vehículo" : "Cerrar registro de vehículo";
  if (!panel.hidden) {
    $("vehicleDriverCedula").value ||= profile?.cedula || "";
    if ($("vehicleDriverCedula").value) lookupPerson(personFields[1]);
    await loadDriverVehicleTable().catch((err) => message("driverVehicleMessage", `No se pudo cargar la tabla: ${err.message}. Ejecuta la migración 005.`, true));
  }
});
$("driverVehicleForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = $("driverVehicleForm").querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    for (const field of personFields) {
      if (!await lookupPerson(field) && (field.required || $(field.input).value.trim())) throw new Error(`Revisa la ${field.input === "vehicleRrCedula" ? "cédula del responsable" : field.input === "vehicleDriverCedula" ? "cédula del conductor" : "cédula del auxiliar"}.`);
    }
    failure(await supabase.rpc("create_route_vehicle", {
      p_dt_number: $("vehicleDt").value.trim(), p_plate: $("vehiclePlateNew").value.trim().toUpperCase(),
      p_rr_cedula: $("vehicleRrCedula").value.trim(), p_driver_cedula: $("vehicleDriverCedula").value.trim(),
      p_assistant_cedula: $("vehicleAssistantCedula").value.trim() || null,
    }));
    $("driverVehicleForm").reset();
    $("vehicleDriverCedula").value = profile.cedula || "";
    await loadDriverVehicleTable();
    await loadDriver();
    message("driverVehicleMessage", "Vehículo registrado y disponible en el selector.");
  } catch (err) { message("driverVehicleMessage", `No se pudo guardar: ${err.message}`, true); }
  finally { button.disabled = false; }
});
async function loadDriver() {
  const vehicles = failure(await supabase.from("vehicles").select("id,plate,label").eq("driver_id", user.id).eq("enabled", true).order("plate"));
  $("driverVehicle").innerHTML = vehicles.length ? vehicles.map((v) => `<option value="${v.id}">${clean(v.plate)}${v.label ? ` · ${clean(v.label)}` : ""}</option>`).join("") : '<option value="">Sin vehículo asignado</option>';
  const trips = failure(await supabase.from("trips").select("*").eq("driver_id", user.id).is("ended_at", null).limit(1));
  activeTrip = trips[0] || null; renderTrip();
  if (activeTrip) { $("driverVehicle").value = activeTrip.vehicle_id; await startTracking().catch(() => {}); }
}
$("tripForm").addEventListener("submit", async (event) => {
  event.preventDefault(); if (activeTrip) return;
  const vehicleId = $("driverVehicle").value, sector = $("sector").value.trim();
  const zone = document.querySelector('input[name="zone"]:checked').value;
  if (!vehicleId) return message("driverMessage", "Aún no tienes un vehículo asignado.", true);
  try {
    // Solicitar GPS antes de crear la ruta evita una ruta activa sin consentimiento.
    if (native.isNative) {
      const p = await native.requestPermissions(); if (p.location !== "granted") throw new Error("Debes permitir la ubicación.");
    } else await new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 20000 }));
    activeTrip = failure(await supabase.rpc("start_trip", { p_vehicle_id: vehicleId, p_sector: sector, p_zone: zone }));
    renderTrip(); await startTracking();
  } catch (err) { message("driverMessage", err.message, true); }
});
$("stopButton").addEventListener("click", async () => {
  if (!activeTrip) return;
  try { failure(await supabase.rpc("finish_trip", { p_trip_id: activeTrip.id })); stopTracking(); activeTrip = null; renderTrip(); message("driverMessage", "Ruta finalizada."); }
  catch (err) { message("driverMessage", err.message, true); }
});
document.querySelectorAll('input[name="zone"]').forEach((input) => input.addEventListener("change", () => { if (!activeTrip) $("limitValue").textContent = limits[input.value]; }));

function ensureMap() {
  if (map) return;
  map = L.map("map").setView([4.57, -74.09], 6);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' }).addTo(map);
  mapLayer = L.layerGroup().addTo(map); routeLayer = L.layerGroup().addTo(map);
  setTimeout(() => map.invalidateSize(), 50);
}
async function selectTrip(id) {
  const trip = adminTrips.find((t) => t.id === id); if (!trip) return;
  const vehicle = adminVehicles.find((v) => v.id === trip.vehicle_id);
  const points = failure(await supabase.from("positions").select("latitude,longitude,recorded_at").eq("trip_id", id).order("recorded_at", { ascending: true }).limit(2000));
  routeLayer.clearLayers();
  const path = points.map((p) => [p.latitude, p.longitude]);
  if (path.length > 1) { L.polyline(path, { color: "#356eae", weight: 4 }).addTo(routeLayer); map.fitBounds(path, { padding: [35, 35] }); }
  else if (path.length) map.setView(path[0], 15);
  $("mapDetail").textContent = `${vehicle?.plate || "Vehículo"} · ${trip.sector} · ${points.length} puntos registrados · última señal ${date(trip.last_seen_at)}`;
}
function renderAdmin() {
  const profiles = Object.fromEntries(adminProfiles.map((p) => [p.id, p]));
  const vehicles = Object.fromEntries(adminVehicles.map((v) => [v.id, v]));
  const active = adminTrips.filter((t) => !t.ended_at);
  $("activeCount").textContent = active.length;
  $("alertCount").textContent = active.filter((t) => t.has_alert).length;
  $("updateTime").textContent = new Date().toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" });
  $("tableSummary").textContent = `${active.length} vehículos`;
  $("profileRows").innerHTML = adminProfiles.length
    ? adminProfiles.map((p) => `<tr><td>${clean(p.full_name || "—")}</td><td>${clean(p.cedula || "—")}</td><td>${clean(roleNames[p.role] || p.role)}</td><td><select aria-label="Nuevo rol para ${clean(p.full_name || p.cedula || "usuario")}" data-role-user="${p.id}" ${p.id === user.id ? "disabled" : ""}>${roleOptions}</select><button type="button" data-save-role="${p.id}" ${p.id === user.id ? "disabled" : ""}>Guardar</button></td></tr>`).join("")
    : '<tr><td colspan="4">No hay usuarios registrados.</td></tr>';
  $("profileRows").querySelectorAll("select[data-role-user]").forEach((select) => { select.value = adminProfiles.find((p) => p.id === select.dataset.roleUser)?.role || "driver"; });
  $("tripRows").innerHTML = active.length ? active.map((t) => `<tr data-trip="${t.id}"><td><b>${clean(vehicles[t.vehicle_id]?.plate || "—")}</b></td><td>${clean(profiles[t.driver_id]?.full_name || "—")}</td><td>${clean(t.sector)}<br><small>${zoneNames[t.zone] || t.zone} · ${t.speed_limit} km/h · ${Number(t.distance_km || 0).toFixed(2)} km</small></td><td>${t.last_speed == null ? "—" : `${Math.round(t.last_speed)} km/h`}</td><td>${date(t.last_seen_at)}</td><td>${t.has_alert ? '<span class="alert-tag">Exceso de velocidad</span>' : ""}</td></tr>`).join("") : '<tr><td colspan="6">No hay vehículos en ruta.</td></tr>';
  $("tripRows").querySelectorAll("tr[data-trip]").forEach((row) => row.addEventListener("click", () => selectTrip(row.dataset.trip).catch((e) => message("adminMessage", e.message, true))));
  $("alertRows").innerHTML = adminAlerts.length ? adminAlerts.map((a) => { const t = adminTrips.find((x) => x.id === a.trip_id); return `<tr><td>${date(a.occurred_at)}</td><td>${clean(vehicles[t?.vehicle_id]?.plate || "—")}</td><td>${clean(profiles[t?.driver_id]?.full_name || "—")}</td><td>${clean(a.sector)} / ${zoneNames[a.zone] || clean(a.zone)}</td><td>${Math.round(a.peak_speed_kmh)} km/h</td><td>${a.limit_kmh} km/h</td></tr>`; }).join("") : '<tr><td colspan="6">No se han generado alertas.</td></tr>';
  mapLayer.clearLayers(); const bounds = [];
  for (const t of active) if (t.last_lat != null && t.last_lng != null) {
    const point = [t.last_lat, t.last_lng]; bounds.push(point);
    const color = t.has_alert ? "#d3453c" : "#558e26";
    L.circleMarker(point, { radius: 11, color: "#fff", weight: 3, fillColor: color, fillOpacity: 1 }).addTo(mapLayer)
      .bindPopup(`<b>${clean(vehicles[t.vehicle_id]?.plate || "Vehículo")}</b><br>${clean(t.sector)}<br>${t.last_speed ?? "—"} km/h`)
      .on("click", () => selectTrip(t.id).catch(() => {}));
  }
  if (bounds.length && !routeLayer.getLayers().length) map.fitBounds(bounds, { padding: [45, 45], maxZoom: 14 });
}
async function refreshAdmin() {
  try {
    const [trips, vehicles, profiles, alerts] = await Promise.all([
      supabase.from("trips").select("*").order("started_at", { ascending: false }).limit(500),
      supabase.from("vehicles").select("*"),
      supabase.from("profiles").select("id,full_name,cedula,role").order("full_name"),
      supabase.from("speed_alerts").select("*").order("occurred_at", { ascending: false }).limit(50),
    ]);
    let profileData;
    if (profiles.error && /cedula|column/i.test(profiles.error.message || "")) {
      profileData = failure(await supabase.from("profiles").select("id,full_name,role").order("full_name"));
      registrationReady = false;
      message("registrationMessage", "Para activar el registro, ejecuta supabase/migrations/002_registro_usuarios.sql en SQL Editor.", true);
    } else {
      profileData = failure(profiles);
      registrationReady = true;
      message("registrationMessage", "");
    }
    adminTrips = failure(trips); adminVehicles = failure(vehicles); adminProfiles = profileData; adminAlerts = failure(alerts);
    $("vehicleDriver").innerHTML = '<option value="">Selecciona un conductor</option>' + adminProfiles.filter((p) => p.role === "driver").map((p) => `<option value="${p.id}">${clean(p.full_name || p.id)}</option>`).join("");
    renderAdmin(); message("adminMessage", "");
  } catch (err) { message("adminMessage", `Error al actualizar: ${err.message}`, true); }
}
function scheduleRefresh() { clearTimeout(refreshTimer); refreshTimer = setTimeout(refreshAdmin, 800); }
$("refreshButton").addEventListener("click", refreshAdmin);
$("registerRole").innerHTML = roleOptions;
$("registrationPanel").querySelector("thead tr").innerHTML = "<th>Nombre</th><th>Cédula</th><th>Rol actual</th><th>Cambiar rol</th>";
$("profileRows").addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-save-role]");
  if (!button || profile?.role !== "admin") return;
  const target = adminProfiles.find((p) => p.id === button.dataset.saveRole);
  const nextRole = $("profileRows").querySelector(`select[data-role-user="${button.dataset.saveRole}"]`)?.value;
  if (!target || !roleNames[nextRole] || target.id === user.id) return;
  if (target.role === nextRole) return message("registrationMessage", "El usuario ya tiene ese rol.");
  button.disabled = true;
  try {
    failure(await supabase.rpc("set_user_role", { p_user_id: target.id, p_role: nextRole }));
    await refreshAdmin();
    message("registrationMessage", `Rol de ${target.full_name || target.cedula} actualizado a ${roleNames[nextRole]}.`);
  } catch (err) { message("registrationMessage", `No se pudo cambiar el rol: ${err.message}. Ejecuta la migración 003_roles_ruta.sql si falta.`, true); button.disabled = false; }
});
$("vehicleForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const plate = $("vehiclePlate").value.toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (!/^[A-Z0-9]{5,8}$/.test(plate)) throw new Error("La placa debe tener entre 5 y 8 letras o números.");
    failure(await supabase.from("vehicles").insert({ plate, label: $("vehicleLabel").value.trim(), driver_id: $("vehicleDriver").value }));
    $("vehicleForm").reset(); message("vehicleMessage", "Vehículo guardado."); await refreshAdmin();
  } catch (err) { message("vehicleMessage", err.message, true); }
});

$("registrationForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (profile?.role !== "admin") return message("registrationMessage", "Solo un administrador puede registrar usuarios.", true);
  if (!registrationReady) return message("registrationMessage", "Primero ejecuta la migración SQL del módulo de registro.", true);
  const button = $("registrationForm").querySelector('button[type="submit"]');
  const fullName = $("registerName").value.trim();
  const cedula = $("registerCedula").value.trim();
  const email = emailForCedula(cedula);
  const password = $("registerPassword").value;
  const role = $("registerRole").value;
  if (fullName.length < 3 || !/^[0-9]{6,15}$/.test(cedula) || password.length < 8) {
    return message("registrationMessage", "Revisa el nombre, la cédula y la contraseña (mínimo 8 caracteres).", true);
  }
  button.disabled = true; message("registrationMessage", "Registrando usuario...");
  try {
    await requireCedulaOnlyAuth();
    // Cliente aislado: el registro no reemplaza la sesión del administrador.
    const registrationClient = createClient(configuredUrl, configuredKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    const { data, error } = await registrationClient.auth.signUp({
      email, password, options: { data: { full_name: fullName, cedula } },
    });
    if (error) throw error;
    if (!data.user || data.user.identities?.length === 0) throw new Error("Esa cédula ya tiene una cuenta.");
    if (role !== "driver") failure(await supabase.rpc("set_user_role", { p_user_id: data.user.id, p_role: role }));
    $("registrationForm").reset(); await refreshAdmin();
    message("registrationMessage", data.session
      ? "Usuario registrado. Ya puede ingresar con su cédula."
      : "Cuenta creada, pero Supabase exige confirmación de correo. Desactiva Confirm Email para usarla.", !data.session);
  } catch (err) {
    message("registrationMessage", `No se completó el registro: ${err.message}. Si el usuario se creó, revisa su rol en la tabla.`, true);
  } finally { button.disabled = false; }
});

async function loadSession() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) { show("loginView"); return; }
  user = session.user;
  try {
    profile = failure(await supabase.from("profiles").select("*").eq("id", user.id).single());
    $("userName").textContent = profile.full_name || user.email;
    if (profile.role === "admin") {
      show("adminView"); ensureMap(); await refreshAdmin();
      if (channel) supabase.removeChannel(channel);
      channel = supabase.channel("control-rutas").on("postgres_changes", { event: "*", schema: "public", table: "trips" }, scheduleRefresh).on("postgres_changes", { event: "*", schema: "public", table: "speed_alerts" }, scheduleRefresh).subscribe();
    } else if (profile.role === "driver") { show("driverView"); await loadDriver(); }
    else { $("staffTitle").textContent = roleNames[profile.role] || "Personal de ruta"; show("staffView"); }
  } catch (err) { show("loginView"); message("loginError", `No se pudo cargar el perfil: ${err.message}`, true); }
}
$("loginForm").addEventListener("submit", async (event) => {
  event.preventDefault(); message("loginError", "Ingresando...");
  const identifier = $("loginIdentifier").value.trim();
  const email = /^[0-9]{6,15}$/.test(identifier) ? emailForCedula(identifier) : identifier.toLowerCase();
  const { error } = await supabase.auth.signInWithPassword({ email, password: $("password").value });
  if (error) return message("loginError", error.message, true);
  message("loginError", ""); await loadSession();
});
$("showSignup").addEventListener("click", () => { message("signupMessage", ""); show("signupView"); });
$("backToLogin").addEventListener("click", () => show("loginView"));
$("showSignup").textContent = "Crear cuenta";
$("signupForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const name = $("signupName").value.trim();
  const cedula = $("signupCedula").value.trim();
  const email = emailForCedula(cedula);
  const password = $("signupPassword").value;
  const role = $("signupRole").value;
  if (name.length < 3 || !/^[0-9]{6,15}$/.test(cedula) || password.length < 8 || !["driver", "assistant", "route_manager"].includes(role)) {
    return message("signupMessage", "Revisa el nombre, la cédula y la contraseña (mínimo 8 caracteres).", true);
  }
  const button = $("signupForm").querySelector('button[type="submit"]');
  button.disabled = true; message("signupMessage", "Creando cuenta...");
  try {
    await requireCedulaOnlyAuth();
    const { data, error } = await supabase.auth.signUp({
      email, password, options: { data: { full_name: name, cedula, role } },
    });
    if (error) throw error;
    if (!data.user || data.user.identities?.length === 0) throw new Error("Esa cédula ya tiene una cuenta.");
    $("signupForm").reset();
    if (data.session) { await loadSession(); }
    else message("signupMessage", "Cuenta creada, pero Supabase exige confirmación de correo. Pide al administrador que desactive Confirm Email.", true);
  } catch (err) { message("signupMessage", `No se pudo registrar: ${err.message}`, true); }
  finally { button.disabled = false; }
});
$("logoutButton").addEventListener("click", async () => {
  stopTracking(); if (channel) await supabase.removeChannel(channel);
  await supabase.auth.signOut(); activeTrip = null; user = profile = null; show("loginView");
});
if (!supabase) show("setupView"); else loadSession();
