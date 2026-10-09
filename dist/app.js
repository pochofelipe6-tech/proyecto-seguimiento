const STORAGE_KEY = "kilometraje-registros-v1";

const form = document.querySelector("#tripForm");
const historyList = document.querySelector("#historyList");
const emptyState = document.querySelector("#emptyState");
const template = document.querySelector("#tripTemplate");
const searchInput = document.querySelector("#searchInput");
const exportButton = document.querySelector("#exportButton");
const toast = document.querySelector("#toast");

const fields = {
  person: document.querySelector("#person"),
  date: document.querySelector("#date"),
  vehicle: document.querySelector("#vehicle"),
  route: document.querySelector("#route"),
  startKm: document.querySelector("#startKm"),
  endKm: document.querySelector("#endKm"),
};

let trips = readTrips();
let toastTimer;

fields.date.value = localDateValue(new Date());
render();

function readTrips() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveTrips() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(trips));
}

function localDateValue(date) {
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60000).toISOString().slice(0, 10);
}

function distanceValue() {
  const start = Number(fields.startKm.value);
  const end = Number(fields.endKm.value);
  return Number.isFinite(start) && Number.isFinite(end) && end >= start ? end - start : 0;
}

function formatKm(value) {
  return new Intl.NumberFormat("es-CO", { maximumFractionDigits: 1 }).format(value);
}

function formatDate(value) {
  return new Intl.DateTimeFormat("es-CO", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`));
}

function initials(name) {
  return name.trim().split(/\s+/).slice(0, 2).map(part => part[0]).join("").toUpperCase();
}

function clearErrors() {
  Object.values(fields).forEach(field => field.classList.remove("invalid"));
  document.querySelectorAll(".field-error").forEach(node => { node.textContent = ""; });
}

function setError(name, message) {
  fields[name].classList.add("invalid");
  const node = document.querySelector(`#${name}Error`);
  if (node) node.textContent = message;
}

function validate() {
  clearErrors();
  let valid = true;
  const start = Number(fields.startKm.value);
  const end = Number(fields.endKm.value);

  if (!fields.person.value.trim()) { setError("person", "Escribe el nombre de la persona."); valid = false; }
  if (!fields.date.value) { setError("date", "Selecciona una fecha."); valid = false; }
  if (fields.startKm.value === "" || !Number.isFinite(start) || start < 0) { setError("startKm", "Ingresa un kilometraje válido."); valid = false; }
  if (fields.endKm.value === "" || !Number.isFinite(end) || end < 0) { setError("endKm", "Ingresa un kilometraje válido."); valid = false; }
  else if (Number.isFinite(start) && end <= start) { setError("endKm", "Debe ser mayor al kilometraje inicial."); valid = false; }

  return valid;
}

function updateCalculation() {
  document.querySelector("#calculatedKm").textContent = formatKm(distanceValue());
  fields.startKm.classList.remove("invalid");
  fields.endKm.classList.remove("invalid");
  document.querySelector("#startKmError").textContent = "";
  document.querySelector("#endKmError").textContent = "";
}

function render() {
  renderStats();
  renderHistory();
  exportButton.disabled = trips.length === 0;
}

function renderStats() {
  const total = trips.reduce((sum, trip) => sum + trip.distance, 0);
  const now = new Date();
  const monthPrefix = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const monthTotal = trips.filter(trip => trip.date.startsWith(monthPrefix)).reduce((sum, trip) => sum + trip.distance, 0);
  const people = new Set(trips.map(trip => trip.person.trim().toLocaleLowerCase("es")));

  document.querySelector("#totalKm").textContent = formatKm(total);
  document.querySelector("#monthKm").textContent = formatKm(monthTotal);
  document.querySelector("#tripCount").textContent = trips.length;
  document.querySelector("#personCount").textContent = people.size;
}

function renderHistory() {
  const query = searchInput.value.trim().toLocaleLowerCase("es");
  const visible = trips
    .filter(trip => [trip.person, trip.vehicle, trip.route].join(" ").toLocaleLowerCase("es").includes(query))
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);

  historyList.replaceChildren();
  emptyState.classList.toggle("hidden", visible.length > 0);
  emptyState.querySelector("h3").textContent = trips.length && !visible.length ? "Sin resultados" : "Aún no hay recorridos";
  emptyState.querySelector("p").textContent = trips.length && !visible.length
    ? "Prueba con otro nombre, vehículo o ruta."
    : "Agrega el primer registro y aquí aparecerá todo el historial.";

  visible.forEach(trip => {
    const row = template.content.firstElementChild.cloneNode(true);
    row.dataset.id = trip.id;
    row.querySelector(".avatar").textContent = initials(trip.person);
    row.querySelector(".trip-person").textContent = trip.person;
    row.querySelector(".trip-meta").textContent = [formatDate(trip.date), trip.vehicle].filter(Boolean).join(" · ");
    row.querySelector(".trip-route").textContent = trip.route || "";
    row.querySelector(".trip-distance strong").textContent = formatKm(trip.distance);
    row.querySelector(".delete-button").addEventListener("click", () => removeTrip(trip.id));
    historyList.append(row);
  });
}

function removeTrip(id) {
  const trip = trips.find(item => item.id === id);
  if (!trip || !window.confirm(`¿Eliminar el recorrido de ${trip.person}?`)) return;
  trips = trips.filter(item => item.id !== id);
  saveTrips();
  render();
  showToast("Recorrido eliminado");
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 2600);
}

form.addEventListener("submit", event => {
  event.preventDefault();
  if (!validate()) {
    form.querySelector(".invalid")?.focus();
    return;
  }

  trips.push({
    id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
    person: fields.person.value.trim(),
    date: fields.date.value,
    vehicle: fields.vehicle.value.trim(),
    route: fields.route.value.trim(),
    startKm: Number(fields.startKm.value),
    endKm: Number(fields.endKm.value),
    distance: distanceValue(),
    createdAt: Date.now(),
  });

  saveTrips();
  form.reset();
  fields.date.value = localDateValue(new Date());
  updateCalculation();
  render();
  fields.person.focus();
  showToast("Recorrido guardado correctamente");
});

[fields.startKm, fields.endKm].forEach(field => field.addEventListener("input", updateCalculation));
fields.person.addEventListener("input", () => { fields.person.classList.remove("invalid"); document.querySelector("#personError").textContent = ""; });
fields.date.addEventListener("input", () => { fields.date.classList.remove("invalid"); document.querySelector("#dateError").textContent = ""; });
searchInput.addEventListener("input", renderHistory);

exportButton.addEventListener("click", () => {
  if (!trips.length) return;
  const header = ["Persona", "Fecha", "Vehículo", "Ruta o motivo", "Km inicial", "Km final", "Distancia (km)"];
  const rows = trips.map(trip => [trip.person, trip.date, trip.vehicle, trip.route, trip.startKm, trip.endKm, trip.distance]);
  const csv = [header, ...rows].map(row => row.map(value => `"${String(value).replaceAll('"', '""')}"`).join(",")).join("\n");
  const blob = new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `kilometraje-${localDateValue(new Date())}.csv`;
  link.click();
  URL.revokeObjectURL(url);
  showToast("Archivo CSV descargado");
});
