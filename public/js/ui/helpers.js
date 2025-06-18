import { removeTempMarker } from '../main.js';

export const contentPanel = document.getElementById('app-panel-content');
export const modalOverlay = document.getElementById('modal-overlay');
export const modalContent = document.getElementById('modal-content');

export const getIconForTable = (table) => {
    const icons = {
        places: 'fa-map-marker-alt',
        people: 'fa-user',
        interactions: 'fa-shuffle',
        custom_objects: 'fa-tag',
        images: 'fa-image',
        other_files: 'fa-file-alt',
        todos: 'fa-check-square',
        dashboard: 'fa-home'
    };
    return icons[table] || 'fa-question-circle';
};

export const formatObjectType = (type) => {
    if (!type) return '';
    const specialCases = {
        'custom_objects': 'Custom Objects',
        'other_files': 'Files',
        'place': 'Place',
        'person': 'Person',
        'interaction': 'Interaction',
        'image': 'Image',
        'other_file': 'File',
        'custom_object': 'Custom Object',
        'todos': 'To-Dos',
        'todo': 'To-Do'
    };
    if (specialCases[type]) return specialCases[type];

    return type.replace(/_/g, ' ').split('-').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
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