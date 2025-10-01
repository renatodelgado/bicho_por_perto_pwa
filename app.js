const DEFAULT_RADIUS = 3;
const MAX_SPECIES = 100;

let map, userMarker, speciesMarkers = [];
let currentPosition = null;
let userCircle = null;
let centerMarker = null;
let lastCenter = null;
let deferredPrompt;

const statusEl = document.getElementById('status');
const radiusRange = document.getElementById('radiusRange');
const radiusLabel = document.getElementById('radiusLabel');
const cardsEl = document.getElementById('cards');
const locationBadge = document.getElementById('locationBadge');
const locationName = document.getElementById('locationName');
const fallbackEl = document.getElementById('fallback');
const searchHereBtn = document.getElementById('searchHereBtn');

radiusLabel.textContent = `${DEFAULT_RADIUS} km`;
radiusRange.value = DEFAULT_RADIUS;

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js")
      .then(reg => {
        console.log("Service Worker registrado com sucesso:", reg.scope);
      })
      .catch(err => {
        console.error("Falha ao registrar o Service Worker:", err);
      });
  });
}


function initMap() {
  map = L.map('map').setView([0, 0], 2);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors'
  }).addTo(map);

  // Evento para mostrar botão "Procurar aqui"
  map.on('moveend', checkMapMove);
}

// -------------------- FETCH & PROCESS --------------------
async function fetchObservations(lat, lng, radius) {
  const url = `https://api.inaturalist.org/v1/observations?lat=${lat}&lng=${lng}&radius=${radius}&per_page=50&order=desc&order_by=observed_on&photos=true&taxon_id=1`;

  const res = await fetch(url);
  if (!res.ok) throw new Error('Falha ao buscar observações');
  const data = await res.json();
  return data.results;
}

function dedupeObservations(obs) {
  const seen = new Map();
  obs.forEach(o => {
    const id = o.taxon?.id || o.species_guess;
    if (!id) return;

    if (!seen.has(id)) seen.set(id, { sample: o, count: 1, taxon: o.taxon });
    else seen.get(id).count++;
  });
  return Array.from(seen.values()).slice(0, MAX_SPECIES);
}

// -------------------- RENDER CARDS --------------------
function renderCards(list) {
  cardsEl.innerHTML = '';
  if (!list.length) {
    cardsEl.innerHTML = `<div class="card empty" style="padding:20px;">Nenhuma espécie encontrada.</div>`;
    return;
  }

  list.forEach(item => {
    const taxon = item.taxon;
    const nameCommon = taxon?.preferred_common_name || item.sample.species_guess || 'Desconhecido';
    const sci = taxon?.name || '';
    const photo = taxon?.default_photo?.medium_url || item.sample.photos?.[0]?.url || '';

    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = `
      <img src="${photo}" alt="${nameCommon}">
      <div class="body">
        <div class="common">${nameCommon}</div>
        <div class="scientific">${sci}</div>
        <div class="badge">${item.count} avistamento${item.count > 1 ? 's' : ''}</div>
      </div>
    `;
    card.addEventListener('click', () => {
      const loc = item.sample.location?.split(',').map(Number);
      if (loc) map.setView(loc, 15);
    });
    cardsEl.appendChild(card);
  });
}

// -------------------- CUSTOM MARKER --------------------
function createIcon(url) {
  return L.icon({
    iconUrl: url || 'https://cdn-icons-png.flaticon.com/512/616/616408.png',
    iconSize: [50, 50],
    iconAnchor: [25, 50],
    popupAnchor: [0, -40],
    className: 'animal-marker'
  });
}

function placeMarkers(list) {
  speciesMarkers.forEach(m => map.removeLayer(m));
  speciesMarkers = [];

  list.forEach(item => {
    const loc = item.sample.location?.split(',').map(Number);
    if (!loc) return;
    const photo = item.taxon?.default_photo?.square_url || item.sample.photos?.[0]?.url || '';
    const marker = L.marker(loc, { icon: createIcon(photo) }).addTo(map);

    const common = item.taxon?.preferred_common_name || item.sample.species_guess || 'Desconhecido';
    const sci = item.taxon?.name || '';
    const date = item.sample?.observed_on || '';
    const link = item.sample?.uri || '';

    marker.bindPopup(`
      <strong>${common}</strong><br>
      <em>${sci}</em><br>
      Observado em: ${date}<br>
      <a href="${link}" target="_blank">Ver no iNaturalist</a>
    `);
    speciesMarkers.push(marker);
  });
}

// -------------------- SEARCH FUNCTION --------------------
async function doSearch(lat, lng, radius) {
  try {
    statusEl.textContent = 'Buscando observações...';
    const obs = await fetchObservations(lat, lng, radius);
    const deduped = dedupeObservations(obs);
    statusEl.textContent = `${deduped.length} espécie(s) encontrada(s)`;
    renderCards(deduped);
    placeMarkers(deduped);
  } catch (e) {
    console.error(e);
    statusEl.textContent = 'Erro ao buscar dados.';
  }
}

// -------------------- GEOLOCATION --------------------
function onPositionSuccess(pos) {
  const lat = pos.coords.latitude;
  const lng = pos.coords.longitude;
  currentPosition = [lat, lng];

  if (!map) initMap();
  map.setView([lat, lng], 13);

  if (!userMarker) {
    userMarker = L.circleMarker([lat, lng], {
      radius: 8,
      color: '#2e7d32',
      fill: true,
      fillColor: '#2e7d32'
    }).addTo(map);
  }

  locationBadge.hidden = false;
  locationName.textContent = 'Sua localização';
  fallbackEl.hidden = true;

  if (!userCircle) {
    userCircle = L.circle([lat, lng], {
      radius: Number(radiusRange.value) * 1000,
      color: '#2e7d32',
      fillColor: '#2e7d32',
      fillOpacity: 0.2,
      weight: 2
    }).addTo(map);
  } else {
    userCircle.setLatLng([lat, lng]);
    userCircle.setRadius(Number(radiusRange.value) * 1000);
  }

  if (!centerMarker) {
    centerMarker = L.marker([lat, lng], { draggable: true, opacity: 0.8 }).addTo(map);
    // Attach dragend event listener here
    centerMarker.on('dragend', () => {
      const popupContent = `<button id="popupSearchBtn" style="
        padding:6px 12px; 
        background:#2e7d32; 
        color:#fff; 
        border:none; 
        border-radius:4px; 
        cursor:pointer;">🔍 Procurar aqui</button>`;

      centerMarker.bindPopup(popupContent).openPopup();

      setTimeout(() => {
        const btn = document.getElementById('popupSearchBtn');
        if (btn) {
          btn.addEventListener('click', () => {
            const pos = centerMarker.getLatLng();
            doSearch(pos.lat, pos.lng, Number(radiusRange.value));
            centerMarker.closePopup();
          });
        }
      }, 100);
    });
  } else {
    centerMarker.setLatLng([lat, lng]);
  }

  doSearch(lat, lng, Number(radiusRange.value));
}

function onPositionError() {
  statusEl.textContent = 'Permissão de localização negada ou indisponível.';
  fallbackEl.hidden = false;
}

// -------------------- UI EVENTS --------------------
document.getElementById('refreshBtn').addEventListener('click', () => requestLocation());

radiusRange.addEventListener('input', () => {
  radiusLabel.textContent = `${radiusRange.value} km`;

  // Atualiza raio em torno do centro do mapa
  if (userCircle && map) {
    userCircle.setLatLng(map.getCenter());
    userCircle.setRadius(Number(radiusRange.value) * 1000);
  }
});

// -------------------- MAP MOVE BUTTON --------------------
function checkMapMove() {
  if (!map) return;
  const center = map.getCenter();

  // Atualiza marcador de centro
  if (centerMarker) centerMarker.setLatLng(center);

  if (!lastCenter || map.distance(center, lastCenter) > 500) {
    searchHereBtn.style.display = 'block';
  } else {
    searchHereBtn.style.display = 'none';
  }

}

searchHereBtn.addEventListener('click', () => {
  const center = map.getCenter();
  doSearch(center.lat, center.lng, Number(radiusRange.value));
  lastCenter = center;
  searchHereBtn.style.display = 'none';
});

// -------------------- INIT --------------------
function requestLocation() {
  if (!navigator.geolocation) { onPositionError(); return; }
  statusEl.textContent = 'Solicitando permissão de localização...';
  navigator.geolocation.getCurrentPosition(onPositionSuccess, onPositionError, { enableHighAccuracy: true, timeout: 10000 });
}

window.addEventListener('load', () => {
  initMap();
  requestLocation();
});

centerMarker.on('dragend', () => {
  const popupContent = `<button id="popupSearchBtn" style="
    padding:6px 12px; 
    background:#2e7d32; 
    color:#fff; 
    border:none; 
    border-radius:4px; 
    cursor:pointer;">🔍 Procurar aqui</button>`;

  centerMarker.bindPopup(popupContent).openPopup();

  // Adiciona evento ao botão do popup
  setTimeout(() => {
    const btn = document.getElementById('popupSearchBtn');
    if (btn) {
      btn.addEventListener('click', () => {
        const pos = centerMarker.getLatLng();
        doSearch(pos.lat, pos.lng, Number(radiusRange.value));
        centerMarker.closePopup();
      });
    }
  }, 100);
});



const installButton = document.getElementById('installBtn');

window.addEventListener('beforeinstallprompt', (e) => {
  console.log('beforeinstallprompt event fired');
  e.preventDefault();
  deferredPrompt = e;
  installButton.style.display = 'block';
  console.log('Install button should now be visible');
});

installButton.addEventListener('click', async () => {
  console.log('Install button clicked');
  if (deferredPrompt) {
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    console.log(`User response to install prompt: ${outcome}`);
    deferredPrompt = null;
    installButton.style.display = 'none';
  } else {
    console.log('No deferredPrompt available');
  }
});