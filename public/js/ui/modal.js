import { modalOverlay, modalContent, formatObjectType } from './helpers.js';
import { addLinkToForm } from './forms.js';
import * as api from '../api.js';
import { removeTempMarker } from '../main.js';

let creationContext = null;

export async function openModal(type, contextElement) {
    creationContext = contextElement;
    window.dashy.appState.isModalOpen = true;
    window.dashy.appState.modalType = type;
    if(type !== 'place') removeTempMarker();

    // The form HTML is now generated asynchronously
    const formHtml = await getModalFormHtml(type);
    modalContent.innerHTML = `
        <div class="modal-header">
            <h2>Create & Link New ${formatObjectType(type)}</h2>
            <button id="modal-close-btn" class="button-danger"><i class="fas fa-times"></i></button>
        </div>
        <div class="modal-body">${formHtml}</div>
    `;
    modalOverlay.classList.remove('hidden');
}

export function closeModal() {
    window.dashy.appState.isModalOpen = false;
    window.dashy.appState.modalType = null;
    creationContext = null;
    removeTempMarker();
    modalOverlay.classList.add('hidden');
    modalContent.innerHTML = '';
}

export async function handleModalFormSubmit(form) {
    const type = form.dataset.type;
    const formData = new FormData(form);

    try {
        const result = await api.createObject(type, formData);
        const createdItems = Array.isArray(result) ? result : [result];
        createdItems.forEach(item => addLinkToForm(item, creationContext));
        closeModal();
    } catch (error) {
        console.error("Modal creation error:", error);
        alert(`Error creating item: ${error.message}`);
    }
}

async function getModalFormHtml(type) {
    let html = `<form id="modal-add-form" data-type="${type}" class="form-container">`;

    if (type === 'custom_object') {
        const types = await api.getCustomObjectTypes();
        const datalist = types.map(t => `<option value="${formatObjectType(t)}">`).join('');
        html += `<div class="form-group"><label>Type</label><input type="text" name="object_type" list="modal-custom-types" required autocomplete="off"><datalist id="modal-custom-types">${datalist}</datalist></div>`;
        html += `<div class="form-group"><label>Title</label><input type="text" name="title" required></div>`;
        html += `<div class="form-group"><label>Mood</label><input type="range" name="mood" min="-100" max="100" value="0"></div>`;
    } else if (['place', 'person'].includes(type)) {
        html += `<div class="form-group"><label>${type === 'person' ? 'Name' : 'Title'}</label><input type="text" name="title" required></div>`;
    }
    if (type === 'place') {
        html += `<div class="form-group"><label>Location</label><input type="text" id="modal-latlng-display" placeholder="Click on map" readonly>
                 <input type="hidden" name="lat" id="modal-lat"><input type="hidden" name="lng" id="modal-lng"></div>`;
    }
    if (type === 'interaction') {
        html += `<div class="form-group"><label>Description</label><textarea name="description" required></textarea></div>`;
        html += `<div class="form-group"><label>Date</label><input type="date" name="interaction_date" value="${new Date().toISOString().slice(0,10)}" required></div>`;
        html += `<div class="form-group"><label>Mood</label><input type="range" name="mood" min="-100" max="100" value="0"></div>`;
    }
    if (['image', 'other_file'].includes(type)) {
        html += `<div class="form-group"><label>Select File(s)</label><input type="file" name="files" multiple required></div>`;
    }

    html += `<button type="submit" class="button button-primary">Create & Link</button></form>`;
    return html;
}