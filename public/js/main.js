import { Map, TileLayer, Marker, Icon, DomEvent } from 'leaflet';
import * as api from './api.js';
import { initializeEventListeners } from './ui/events.js';
import { renderObject, renderDashboardView, renderWelcomeMessage } from './ui/main_view.js';
import { highlightMarker, clearHighlight } from './ui/helpers.js';

const appState = {
    map: null,
    markers: {},
    tempMarker: null,
    isModalOpen: false,
    currentView: null
};

// --- Map Logic ---
function initMap() {
    appState.map = new Map('map').setView([45.4642, 9.1900], 7);
    new TileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(appState.map);
    appState.map.on('click', handleMapClick);
}

function handleMapClick(e) {
    const isPlaceFormOpenInMain = window.dashy.appState.currentView?.type === 'form' && window.dashy.appState.currentView?.formType === 'place';
    const isPlaceFormOpenInModal = window.dashy.appState.isModalOpen && document.querySelector('#on-the-fly-add-form[data-type="place"]');

    if (isPlaceFormOpenInMain || isPlaceFormOpenInModal) {
        updateTempMarker(e.latlng);
        const event = new CustomEvent('map-clicked-for-form', { detail: e.latlng });
        window.dispatchEvent(event);
    } else {
        removeTempMarker();
    }
}

function updateTempMarker(latlng) {
    if (appState.tempMarker) {
        appState.tempMarker.setLatLng(latlng);
    } else {
        const tempIcon = new Icon({
            iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
            shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
            iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34], shadowSize: [41, 41],
            className: 'leaflet-marker-temp'
        });
        appState.tempMarker = new Marker(latlng, { icon: tempIcon, zIndexOffset: 1000 }).addTo(appState.map);
    }
    appState.map.panTo(latlng);
}

export function removeTempMarker() {
    if (appState.tempMarker) {
        appState.map.removeLayer(appState.tempMarker);
        appState.tempMarker = null;
    }
}

// --- Data & Marker Management ---
async function bootstrapApp() {
    try {
        const data = await api.getBootstrapData();
        if(data && data.places) data.places.forEach(place => addMarkerToMap(place));
        if (data && data.hasObjects) {
            renderDashboardView();
        } else {
            renderWelcomeMessage();
        }
    } catch (error) {
        console.error("Could not bootstrap the app:", error);
        renderWelcomeMessage();
    }
}

function addMarkerToMap(place, shouldFlyTo = false) {
    if (appState.markers[place.id]) {
        appState.markers[place.id].setLatLng([place.lat, place.lng]);
    } else {
        const marker = new Marker([place.lat, place.lng]).addTo(appState.map);
        marker.on('click', (e) => {
            DomEvent.stopPropagation(e);
            clearHighlight();
            removeTempMarker();
            highlightMarker(marker);
            renderObject('places', place.id);
        });
        appState.markers[place.id] = marker;
    }
    if (shouldFlyTo) appState.map.flyTo([place.lat, place.lng], 15);
}

function removeMarkerFromMap(placeId) {
    if (appState.markers[placeId]) {
        appState.map.removeLayer(appState.markers[placeId]);
        delete appState.markers[placeId];
    }
}

// --- Update Notification ---
function showUpdateNotification(updateInfo) {
    let container = document.getElementById('update-notification-banner');
    if (container) {
        container.remove();
    }
    container = document.createElement('div');
    container.id = 'update-notification-banner';
    container.style.cssText = 'position: fixed; top: 10px; right: 10px; background-color: var(--accent-secondary); color: white; padding: 15px; border-radius: var(--radius-md); z-index: 9999; box-shadow: var(--shadow-lg); max-width: 350px;';

    const releaseNotesHtml = updateInfo.releaseNotes ? `<p style="margin: 5px 0 15px; font-size: 0.9em; opacity: 0.9;">${updateInfo.releaseNotes}</p>` : '';

    container.innerHTML = `
        <h4 style="margin: 0 0 5px; font-weight: 600;">Update Available!</h4>
        <p style="margin:0;">Version ${updateInfo.version} is ready to download.</p>
        ${releaseNotesHtml}
        <button id="download-update-btn" class="button button-primary" style="margin-right: 10px;">Download</button>
        <button id="dismiss-update-btn" class="button" style="background:none; border: 1px solid white;">Dismiss</button>
    `;
    document.body.appendChild(container);

    document.getElementById('download-update-btn').addEventListener('click', () => {
        window.electronAPI.invoke('shell:open-external', updateInfo.url);
        container.remove();
    });

    document.getElementById('dismiss-update-btn').addEventListener('click', () => {
        container.remove();
    });
}


// --- App Start ---
document.addEventListener('DOMContentLoaded', () => {
    initMap();
    initializeEventListeners();
    bootstrapApp();
    window.dashy = {
        appState,
        api,
        addMarkerToMap,
        removeMarkerFromMap,
        removeTempMarker,
        renderObject,
        renderDashboardView
    };
    document.getElementById('app-title').addEventListener('click', renderDashboardView);
    document.querySelector('.nav-btn[data-type="dashboard"]').classList.add('active');

    // Listen for update notifications from the main process
    if (window.electronAPI) {
        window.electronAPI.on('update-available', (updateInfo) => {
            showUpdateNotification(updateInfo);
        });
    }
});