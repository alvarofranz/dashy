import { removeTempMarker } from '../main.js';

export const contentPanel = document.getElementById('app-panel-content');
export const modalOverlay = document.getElementById('modal-overlay');
export const modalContent = document.getElementById('modal-content');
export const onboardingModalOverlay = document.getElementById('onboarding-modal-overlay');

export const getIconForTable = (table) => {
    const icons = {
        places: 'fa-map-marker-alt',
        people: 'fa-user',
        notes: 'fa-note-sticky',
        custom_objects: 'fa-tag',
        images: 'fa-image',
        files: 'fa-file-alt',
        todos: 'fa-check-square',
        dashboard: 'fa-home',
        settings: 'fa-cog'
    };
    return icons[table] || 'fa-question-circle';
};

export const formatIdString = (type) => {
    if (!type) return '';
    const specialCases = {
        'custom_objects': 'Custom Objects', 'files': 'Files', 'place': 'Place',
        'person': 'Person', 'note': 'Note', 'notes': 'Notes', 'image': 'Image',
        'other_file': 'File', 'custom_object': 'Custom Object', 'todos': 'To-Dos',
        'todo': 'To-Do', 'settings': 'Settings'
    };
    if (specialCases[type]) return specialCases[type];

    return type.replace(/_/g, ' ').split('-').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
};

export const formatStringToId = (str) => {
    if (!str) return '';
    return str.trim().toLowerCase()
        .replace(/[^a-z0-9\s-]/g, '')
        .replace(/\s+/g, '-');
};

export const debounce = (func, delay) => {
    let timeout;
    return function(...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), delay);
    };
};

export function clearHighlight() {
    Object.values(window.dashy.appState.markers).forEach(m => {
        m._icon.classList.remove('highlighted');
    });
}

export function highlightMarker(marker) {
    marker._icon.classList.add('highlighted');
}

export function openModal(htmlContent) {
    modalContent.innerHTML = htmlContent;
    modalOverlay.classList.remove('hidden');
    window.dashy.appState.isModalOpen = true;
}

export function closeModal() {
    modalOverlay.classList.add('hidden');
    modalContent.innerHTML = '';
    window.dashy.appState.isModalOpen = false;
    removeTempMarker();
}

export function openOnboardingModal(htmlContent) {
    onboardingModalOverlay.innerHTML = htmlContent;
    onboardingModalOverlay.classList.remove('hidden');
}

export function closeOnboardingModal() {
    onboardingModalOverlay.classList.add('hidden');
    onboardingModalOverlay.innerHTML = '';
}