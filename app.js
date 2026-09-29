"use strict";

const STORAGE_KEY = "parkfinder.spots.v2";
const THEME_KEY = "parkfinder.theme.v1";

const $ = (selector) => document.querySelector(selector);

const ui = {
  mapStatus: $("#mapStatus"),
  currentStatus: $("#currentStatus"),
  currentCoords: $("#currentCoords"),
  currentAddress: $("#currentAddress"),
  savedList: $("#savedList"),
  toastContainer: $("#toastContainer"),
  spotName: $("#spotName"),
  spotFloor: $("#spotFloor"),
  spotNumber: $("#spotNumber"),
  spotNotes: $("#spotNotes"),
  compass: $("#compass"),
  compassArrow: $("#compassArrow"),
  mapTypeBtn: $("#mapTypeBtn"),
  themeBtn: $("#themeBtn"),
  importFile: $("#importFile")
};

let spots = loadSpots();
let selectedSpotId = null;
let currentPosition = null;
let userMarker = null;
let userAccuracyCircle = null;
let currentTileLayer = null;
let satelliteEnabled = false;
let watchId = null;

const map = L.map("map", {
  zoomControl: true,
  attributionControl: true
}).setView([43.36, -5.85], 13);

const streetLayer = L.tileLayer(
  "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
  {
    maxZoom: 19,
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
  }
);

const satelliteLayer = L.tileLayer(
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
  {
    maxZoom: 19,
    attribution:
      "Tiles &copy; Esri — Source: Esri, Maxar, Earthstar Geographics"
  }
);

streetLayer.addTo(map);
currentTileLayer = streetLayer;

const markersLayer = L.layerGroup().addTo(map);

function loadSpots() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const data = raw ? JSON.parse(raw) : [];

    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function saveSpots() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(spots));
}

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function showToast(message, type = "success") {
  const toast = document.createElement("div");

  toast.className = `toast ${type}`;
  toast.textContent = message;

  ui.toastContainer.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transform = "translateY(8px)";

    setTimeout(() => toast.remove(), 250);
  }, 3500);
}

function setStatus(message) {
  ui.mapStatus.textContent = message;
}

function formatCoords(lat, lng, accuracy = null) {
  const coords = `${lat.toFixed(6)}, ${lng.toFixed(6)}`;

  return accuracy
    ? `${coords} · precisión ±${Math.round(accuracy)} m`
    : coords;
}

function formatDate(timestamp) {
  return new Intl.DateTimeFormat("es-ES", {
    dateStyle: "short",
    timeStyle: "short"
  }).format(new Date(timestamp));
}

async function reverseGeocode(lat, lng) {
  const url =
    "https://nominatim.openstreetmap.org/reverse" +
    `?lat=${encodeURIComponent(lat)}` +
    `&lon=${encodeURIComponent(lng)}` +
    "&format=jsonv2" +
    "&zoom=18" +
    "&addressdetails=1" +
    "&accept-language=es";

  const response = await fetch(url, {
    headers: {
      Accept: "application/json"
    }
  });

  if (!response.ok) {
    throw new Error("No se pudo obtener la dirección.");
  }

  return response.json();
}

function getStreetName(data) {
  if (!data || !data.address) {
    return "";
  }

  const address = data.address;

  const street =
    address.road ||
    address.pedestrian ||
    address.residential ||
    address.footway ||
    address.path ||
    "";

  const houseNumber = address.house_number
    ? ` ${address.house_number}`
    : "";

  const city =
    address.city ||
    address.town ||
    address.village ||
    address.municipality ||
    "";

  return [street + houseNumber, city]
    .filter(Boolean)
    .join(", ");
}

async function getAddressForPosition(lat, lng) {
  try {
    const data = await reverseGeocode(lat, lng);

    return {
      street: getStreetName(data),
      fullAddress: data.display_name || ""
    };
  } catch (error) {
    console.warn(
      "Geocodificación inversa no disponible:",
      error
    );

    return {
      street: "",
      fullAddress: ""
    };
  }
}

function makeCarIcon(selected = false) {
  return L.divIcon({
    className: "custom-car-marker",

    html: `
      <div style="
        width: 42px;
        height: 42px;
        display: grid;
        place-items: center;
        border-radius: 50%;
        background: ${selected ? "#36d399" : "#10243e"};
        border: 3px solid ${selected ? "#d7fff0" : "#5aa9ff"};
        box-shadow: 0 6px 20px rgba(0,0,0,.38);
        font-size: 21px;
      ">🚗</div>
    `,

    iconSize: [42, 42],
    iconAnchor: [21, 21],
    popupAnchor: [0, -21]
  });
}

function drawSpots() {
  markersLayer.clearLayers();

  spots.forEach((spot) => {
    const marker = L.marker([spot.lat, spot.lng], {
      icon: makeCarIcon(spot.id === selectedSpotId),
      title: spot.name
    });

    const details = [
      spot.street
        ? `<strong>📍 ${escapeHtml(spot.street)}</strong>`
        : "",

      spot.floor
        ? `Planta: ${escapeHtml(spot.floor)}`
        : "",

      spot.number
        ? `Plaza: ${escapeHtml(spot.number)}`
        : "",

      spot.notes
        ? escapeHtml(spot.notes)
        : "",

      `<small>${formatCoords(spot.lat, spot.lng)}</small>`
    ]
      .filter(Boolean)
      .join("<br>");

    marker.bindPopup(`
      <div class="popup-title">
        🚗 ${escapeHtml(spot.name)}
      </div>

      <div class="popup-text">
        ${details}
      </div>

      <br>

      <button class="btn small primary popup-navigate">
        Abrir Google Maps
      </button>
    `);

    marker.on("popupopen", (event) => {
      const button = event.popup
        .getElement()
        .querySelector(".popup-navigate");

      button.addEventListener("click", () => {
        navigateTo(spot.id);
      });
    });

    marker.on("click", () => {
      selectedSpotId = spot.id;
      renderSavedList();
      drawSpots();
    });

    marker.addTo(markersLayer);
  });
}

function renderSavedList() {
  if (!spots.length) {
    ui.savedList.innerHTML = `
      <div class="empty">
        Todavía no hay aparcamientos guardados.
      </div>
    `;

    return;
  }

  ui.savedList.innerHTML = spots
    .slice()
    .sort((a, b) => b.createdAt - a.createdAt)
    .map((spot) => {
      const active =
        spot.id === selectedSpotId
          ? "active"
          : "";

      return `
        <article
          class="saved-card ${active}"
          data-id="${spot.id}"
        >
          <div class="saved-title">
            <span>
              🚗 ${escapeHtml(spot.name)}
            </span>

            <span class="badge">
              Guardado
            </span>
          </div>

          <div class="saved-meta">
            ${spot.street
              ? `<span class="saved-address">
                   📍 ${escapeHtml(spot.street)}
                 </span><br>`
              : ""}

            ${spot.floor
              ? `Planta: ${escapeHtml(spot.floor)} · `
              : ""}

            ${spot.number
              ? `Plaza: ${escapeHtml(spot.number)} · `
              : ""}

            ${formatDate(spot.createdAt)}
            <br>

            ${formatCoords(spot.lat, spot.lng)}

            ${spot.notes
              ? `<br>${escapeHtml(spot.notes)}`
              : ""}
          </div>

          <div class="saved-actions">
            <button
              class="btn small primary navigate-btn"
              data-id="${spot.id}"
            >
              🧭 Ir
            </button>

            <button
              class="btn small focus-btn"
              data-id="${spot.id}"
            >
              🔎 Ver
            </button>

            <button
              class="btn small copy-btn"
              data-id="${spot.id}"
            >
              📋 Copiar
            </button>

            <button
              class="btn small danger delete-btn"
              data-id="${spot.id}"
            >
              🗑 Borrar
            </button>
          </div>
        </article>
      `;
    })
    .join("");

  document.querySelectorAll(".saved-card").forEach((card) => {
    card.addEventListener("click", (event) => {
      if (event.target.closest("button")) {
        return;
      }

      const spot = spots.find(
        (item) => item.id === card.dataset.id
      );

      if (spot) {
        focusSpot(spot);
      }
    });
  });

  document.querySelectorAll(".navigate-btn").forEach((button) => {
    button.addEventListener("click", () => {
      navigateTo(button.dataset.id);
    });
  });

  document.querySelectorAll(".focus-btn").forEach((button) => {
    button.addEventListener("click", () => {
      const spot = spots.find(
        (item) => item.id === button.dataset.id
      );

      if (spot) {
        focusSpot(spot);
      }
    });
  });

  document.querySelectorAll(".copy-btn").forEach((button) => {
    button.addEventListener("click", () => {
      const spot = spots.find(
        (item) => item.id === button.dataset.id
      );

      if (spot) {
        copyCoordinates(spot);
      }
    });
  });

  document.querySelectorAll(".delete-btn").forEach((button) => {
    button.addEventListener("click", () => {
      deleteSpot(button.dataset.id);
    });
  });
}

function focusSpot(spot) {
  selectedSpotId = spot.id;

  map.setView([spot.lat, spot.lng], 19, {
    animate: true
  });

  drawSpots();
  renderSavedList();

  setStatus(`Mostrando: ${spot.name}`);
}

function getCurrentPosition(options = {}) {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(
        new Error(
          "Este navegador no admite geolocalización."
        )
      );

      return;
    }

    navigator.geolocation.getCurrentPosition(
      resolve,
      reject,
      {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 0,
        ...options
      }
    );
  });
}

async function locateUser() {
  try {
    setStatus("Solicitando posición GPS…");

    const position = await getCurrentPosition();

    currentPosition = {
      lat: position.coords.latitude,
      lng: position.coords.longitude,
      accuracy: position.coords.accuracy,
      timestamp: Date.now()
    };

    updateUserMarker(currentPosition);

    map.setView(
      [
        currentPosition.lat,
        currentPosition.lng
      ],
      18,
      {
        animate: true
      }
    );

    ui.currentStatus.textContent =
      "Posición actual detectada";

    ui.currentCoords.textContent = formatCoords(
      currentPosition.lat,
      currentPosition.lng,
      currentPosition.accuracy
    );

    setStatus("GPS actualizado");
    showToast("Posición actualizada correctamente.");
  } catch (error) {
    const message =
      error.code === 1
        ? "Permiso de ubicación denegado."
        : error.code === 2
          ? "No se ha podido determinar la ubicación."
          : error.code === 3
            ? "El GPS ha tardado demasiado en responder."
            : error.message;

    setStatus("No se pudo localizar");
    showToast(message, "error");
  }
}

function updateUserMarker(position) {
  if (userMarker) {
    map.removeLayer(userMarker);
  }

  if (userAccuracyCircle) {
    map.removeLayer(userAccuracyCircle);
  }

  userMarker = L.marker(
    [
      position.lat,
      position.lng
    ],
    {
      icon: L.divIcon({
        className: "current-position-marker",

        html: `
          <div style="
            width: 20px;
            height: 20px;
            border-radius: 50%;
            background: #5aa9ff;
            border: 4px solid white;
            box-shadow:
              0 0 0 8px rgba(90,169,255,.2),
              0 4px 14px rgba(0,0,0,.4);
          "></div>
        `,

        iconSize: [20, 20],
        iconAnchor: [10, 10]
      })
    }
  )
    .addTo(map)
    .bindPopup("📱 Tu posición actual");

  if (Number.isFinite(position.accuracy)) {
    userAccuracyCircle = L.circle(
      [
        position.lat,
        position.lng
      ],
      {
        radius: position.accuracy,
        color: "#5aa9ff",
        fillColor: "#5aa9ff",
        fillOpacity: 0.08,
        weight: 1
      }
    ).addTo(map);
  }
}

async function saveCurrentPosition() {
  try {
    setStatus("Capturando posición del coche…");

    const position = await getCurrentPosition();

    currentPosition = {
      lat: position.coords.latitude,
      lng: position.coords.longitude,
      accuracy: position.coords.accuracy,
      timestamp: Date.now()
    };

    updateUserMarker(currentPosition);

    ui.currentStatus.textContent =
      "Buscando el nombre de la calle…";

    ui.currentCoords.textContent = formatCoords(
      currentPosition.lat,
      currentPosition.lng,
      currentPosition.accuracy
    );

    ui.currentAddress.textContent =
      "Consultando dirección aproximada…";

    const address = await getAddressForPosition(
      currentPosition.lat,
      currentPosition.lng
    );

    const defaultName =
      ui.spotName.value.trim() ||
      (
        address.street
          ? `Coche · ${address.street}`
          : `Coche · ${new Intl.DateTimeFormat(
              "es-ES",
              {
                dateStyle: "short",
                timeStyle: "short"
              }
            ).format(new Date())}`
      );

    const spot = {
      id:
        crypto.randomUUID?.() ||
        `${Date.now()}-${Math.random()
          .toString(16)
          .slice(2)}`,

      name: defaultName,
      floor: ui.spotFloor.value.trim(),
      number: ui.spotNumber.value.trim(),
      notes: ui.spotNotes.value.trim(),
      lat: currentPosition.lat,
      lng: currentPosition.lng,
      accuracy: currentPosition.accuracy,
      street: address.street,
      fullAddress: address.fullAddress,
      createdAt: Date.now()
    };

    spots.push(spot);
    selectedSpotId = spot.id;

    saveSpots();
    drawSpots();
    renderSavedList();

    map.setView(
      [
        spot.lat,
        spot.lng
      ],
      19,
      {
        animate: true
      }
    );

    ui.currentStatus.textContent =
      "Coche guardado";

    ui.currentCoords.textContent = formatCoords(
      spot.lat,
      spot.lng,
      spot.accuracy
    );

    ui.currentAddress.textContent =
      address.street || "Calle no identificada";

    ui.spotName.value = "";
    ui.spotFloor.value = "";
    ui.spotNumber.value = "";
    ui.spotNotes.value = "";

    setStatus(`Coche guardado: ${spot.name}`);

    showToast(
      address.street
        ? `Aparcamiento guardado en ${address.street}.`
        : "Aparcamiento guardado."
    );
  } catch (error) {
    console.error(error);

    const message =
      error.code === 1
        ? "Necesitas permitir el acceso a la ubicación."
        : "No se ha podido guardar la posición.";

    setStatus("No se pudo guardar");
    showToast(message, "error");
  }
}

function deleteSpot(id) {
  const spot = spots.find(
    (item) => item.id === id
  );

  if (!spot) {
    return;
  }

  const confirmed = confirm(
    `¿Borrar la ubicación "${spot.name}"?`
  );

  if (!confirmed) {
    return;
  }

  spots = spots.filter(
    (item) => item.id !== id
  );

  if (selectedSpotId === id) {
    selectedSpotId = null;
  }

  saveSpots();
  drawSpots();
  renderSavedList();

  setStatus("Ubicación eliminada");
  showToast("Ubicación eliminada.");
}

function navigateTo(id) {
  const spot = spots.find(
    (item) => item.id === id
  );

  if (!spot) {
    return;
  }

  const destination =
    `${spot.lat},${spot.lng}`;

  const googleUrl =
    "https://www.google.com/maps/dir/?api=1" +
    `&destination=${encodeURIComponent(destination)}` +
    "&travelmode=walking";

  window.open(
    googleUrl,
    "_blank",
    "noopener"
  );
}

async function copyCoordinates(spot) {
  const text =
    `${spot.lat}, ${spot.lng}`;

  try {
    await navigator.clipboard.writeText(text);
    showToast("Coordenadas copiadas.");
  } catch {
    showToast(`Coordenadas: ${text}`);
  }
}

function fitAll() {
  const layers = [];

  markersLayer.eachLayer((layer) => {
    layers.push(layer);
  });

  if (userMarker) {
    layers.push(userMarker);
  }

  if (!layers.length) {
    showToast(
      "No hay ubicaciones para mostrar.",
      "error"
    );

    return;
  }

  const group = L.featureGroup(layers);

  map.fitBounds(
    group.getBounds().pad(0.25)
  );

  setStatus(
    "Mostrando todas las ubicaciones"
  );
}

function toggleMapType() {
  map.removeLayer(currentTileLayer);

  satelliteEnabled = !satelliteEnabled;

  currentTileLayer = satelliteEnabled
    ? satelliteLayer
    : streetLayer;

  currentTileLayer.addTo(map);

  ui.mapTypeBtn.textContent =
    satelliteEnabled
      ? "🗺 Calles"
      : "🛰 Satélite";

  setStatus(
    satelliteEnabled
      ? "Vista satélite"
      : "Mapa de calles"
  );
}

function toggleCompass() {
  if (watchId !== null) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;

    ui.compass.classList.remove(
      "visible"
    );

    showToast("Brújula desactivada.");
    return;
  }

  if (!navigator.geolocation) {
    showToast(
      "La geolocalización no está disponible.",
      "error"
    );

    return;
  }

  watchId = navigator.geolocation.watchPosition(
    (position) => {
      if (position.coords.heading !== null) {
        ui.compass.classList.add("visible");

        ui.compassArrow.style.transform =
          `rotate(${position.coords.heading}deg)`;
      }
    },

    () => {
      showToast(
        "No se ha podido activar la orientación GPS.",
        "error"
      );
    },

    {
      enableHighAccuracy: true,
      maximumAge: 1000,
      timeout: 10000
    }
  );

  ui.compass.classList.add("visible");

  showToast(
    "Brújula activa. La orientación puede requerir movimiento."
  );
}

function exportData() {
  const payload = {
    app: "ParkFinder",
    version: 2,
    exportedAt: new Date().toISOString(),
    spots
  };

  const blob = new Blob(
    [
      JSON.stringify(
        payload,
        null,
        2
      )
    ],
    {
      type: "application/json"
    }
  );

  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");

  anchor.href = url;
  anchor.download =
    `parkfinder-${new Date()
      .toISOString()
      .slice(0, 10)}.json`;

  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();

  URL.revokeObjectURL(url);

  showToast(
    "Copia de seguridad exportada."
  );
}

function importData() {
  ui.importFile.click();
}

function handleImport(event) {
  const file = event.target.files?.[0];

  if (!file) {
    return;
  }

  const reader = new FileReader();

  reader.onload = () => {
    try {
      const imported = JSON.parse(
        reader.result
      );

      const importedSpots =
        Array.isArray(imported)
          ? imported
          : imported.spots;

      if (!Array.isArray(importedSpots)) {
        throw new Error(
          "Formato no válido"
        );
      }

      const validSpots =
        importedSpots.filter(
          (spot) =>
            spot &&
            typeof spot.lat === "number" &&
            typeof spot.lng === "number"
        );

      spots = [
        ...spots,

        ...validSpots.map((spot) => ({
          ...spot,

          id:
            spot.id ||
            `${Date.now()}-${Math.random()
              .toString(16)
              .slice(2)}`,

          name:
            spot.name ||
            "Coche importado",

          createdAt:
            spot.createdAt ||
            Date.now()
        }))
      ];

      saveSpots();
      drawSpots();
      renderSavedList();

      showToast(
        `${validSpots.length} ubicación(es) importada(s).`
      );
    
