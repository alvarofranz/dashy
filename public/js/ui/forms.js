import { contentPanel, getIconForTable, formatObjectType, openModal } from './helpers.js';
import * as api from '../api.js';
import { removeTempMarker } from '../main.js';

/**
 * Generates standardized form fields for any object type.
 * @param {string} type - The type of object (e.g., 'place', 'person').
 * @param {boolean} isModal - If true, prefixes IDs to prevent conflicts.
 * @returns {Promise<string>} A string of HTML for the form fields.
 */
async function generateFormFields(type, isModal = false) {
    let html = '';
    const p = isModal ? 'otf-' : ''; // Prefix for element IDs in modal

    switch (type) {
        case 'place':
            html += `<div class="form-group"><label for="${p}title">Title</label><input type="text" id="${p}title" name="title" required></div>`;
            html += `<div class="form-group"><label for="${p}latlng-display">Location (click on map)</label><input type="text" id="${p}latlng-display" readonly placeholder="Click on map to set coordinates" required>
                     <input type="hidden" name="lat" id="${p}lat"><input type="hidden" name="lng" id="${p}lng"></div>`;
            break;
        case 'person':
            html += `<div class="form-group"><label for="${p}title">Name</label><input type="text" id="${p}title" name="title" required></div>`;
            break;
        case 'interaction':
            html += `<div class="form-group"><label for="${p}title">Description</label><textarea id="${p}title" name="title" required></textarea></div>`;
            html += `<div class="form-group"><label for="${p}interaction_date">Date</label><input type="date" id="${p}interaction_date" name="interaction_date" value="${new Date().toISOString().slice(0,10)}" required></div>`;
            html += `<div class="form-group"><label for="${p}mood">Mood (-100 to 100)</label><input type="range" id="${p}mood" name="mood" min="-100" max="100" value="0"></div>`;
            break;
        case 'custom_object':
            html += `<div class="form-group"><label for="${p}title">Title</label><input type="text" id="${p}title" name="title" required></div>`;
            html += `<div class="form-group custom-type-search-container">
                        <label for="${p}object_type">Type</label>
                        <input type="text" id="${p}object_type" name="object_type" class="custom-type-search-input" placeholder="Enter or select a type" required autocomplete="off">
                        <ul class="search-results-list custom-type-results"></ul>
                     </div>`;
            html += `<div class="form-group"><label for="${p}mood">Mood (-100 to 100)</label><input type="range" id="${p}mood" name="mood" min="-100" max="100" value="0"></div>`;
            break;
        case 'todo':
            html += `<div class="form-group"><label for="${p}title">To-Do Item</label><input type="text" id="${p}title" name="title" required></div>`;
            html += `<input type="hidden" name="status" value="0">`; // Default to incomplete
            break;
        case 'image':
        case 'other_file':
            const isImage = type === 'image';
            const accept = isImage ? 'image/jpeg,image/png,image/webp,image/gif,image/avif' : '';
            const labelText = isImage ? 'Select Image(s)' : 'Select File(s)';
            html += `<div class="form-group">
                        <label>${labelText}</label>
                        <div class="custom-file-input-container">
                            <input type="file" name="files" id="${p}files" class="custom-file-input" accept="${accept}" multiple required>
                            <label for="${p}files" class="button"><i class="fas fa-upload"></i> Choose Files</label>
                            <ul class="file-list"></ul>
                        </div>
                     </div>`;
            break;
    }

    if (['place', 'person', 'interaction', 'custom_object', 'todo'].includes(type)) {
        html += `<div class="form-group"><label>Custom Details</label><ul class="kv-list"></ul><button type="button" class="add-kv-button button"><i class="fas fa-plus"></i> Add Detail</button></div>`;
    }
    return html;
}

/**
 * Renders the main form in the content panel for creating a new object.
 * @param {string} type - The type of object to create.
 */
export async function renderAddForm(type) {
    window.dashy.appState.currentView = { type: 'form', formType: type };
    if (type !== 'place') removeTempMarker();

    const formFieldsHtml = await generateFormFields(type, false);
    const formTitle = `Add New ${formatObjectType(type)}`;

    contentPanel.innerHTML = `
        <div class="form-container">
            <h2><i class="fas ${getIconForTable(type)}"></i> ${formTitle}</h2>
            <form id="add-form" data-type="${type}" autocomplete="off">
                ${formFieldsHtml}
                <div class="form-group"><label>Link to Other Items</label>${renderAddLinkForm()}</div>
                <button type="submit" class="button button-primary"><i class="fas fa-check"></i> Create ${formatObjectType(type)}</button>
            </form>
        </div>`;
}

/**
 * Renders a form in a modal for creating a new item "on-the-fly" to link it.
 * @param {string} type - The type of object to create.
 */
export async function renderOnTheFlyForm(type) {
    window.dashy.appState.modalFormType = type;
    const formFields = await generateFormFields(type, true);
    const modalHtml = `
        <div class="modal-header">
            <h2><i class="fas ${getIconForTable(type)}"></i> Add New ${formatObjectType(type)}</h2>
            <button class="cancel-modal-btn button button-danger"><i class="fas fa-times"></i> Cancel</button>
        </div>
        <div class="modal-body">
            <div class="form-container">
                <form id="on-the-fly-add-form" data-type="${type}" autocomplete="off">
                    ${formFields}
                    <button type="submit" class="button button-primary"><i class="fas fa-plus"></i> Create & Link</button>
                </form>
            </div>
        </div>
    `;
    openModal(modalHtml);
    if (type === 'place') {
        const mapCenter = window.dashy.appState.map.getCenter();
        const event = new CustomEvent('map-clicked-for-form', { detail: mapCenter });
        window.dispatchEvent(event);
    }
}

/**
 * Renders the UI for adding links to a form.
 * @returns {string} HTML string for the link creation section.
 */
export function renderAddLinkForm() {
    return `<div class="add-link-form">
        <input type="text" class="link-search-input" placeholder="Search to link existing items...">
        <ul class="search-results-list"></ul>
        <div class="linked-items-preview"></div>
        <p style="text-align: center; color: var(--text-tertiary); margin: 1rem 0;">Or create a new item to link:</p>
        <div class="link-creation-options">
            <button type="button" class="create-link-btn button" data-type="place" title="Create & Link Place"><i class="fas fa-map-marker-alt"></i></button>
            <button type="button" class="create-link-btn button" data-type="person" title="Create & Link Person"><i class="fas fa-user"></i></button>
            <button type="button" class="create-link-btn button" data-type="todo" title="Create & Link To-Do"><i class="fas fa-check-square"></i></button>
            <button type="button" class="create-link-btn button" data-type="interaction" title="Create & Link Interaction"><i class="fas fa-shuffle"></i></button>
            <button type="button" class="create-link-btn button" data-type="custom_object" title="Create & Link Custom Object"><i class="fas fa-tag"></i></button>
            <button type="button" class="create-link-btn button" data-type="image" title="Create & Link Image"><i class="fas fa-image"></i></button>
            <button type="button" class="create-link-btn button" data-type="other_file" title="Create & Link File"><i class="fas fa-file-alt"></i></button>
        </div>
    </div>`;
}

/**
 * Adds a visual tag for a linked item to a form's preview area.
 * @param {{table: string, id: string, title: string}} link - The object to link.
 * @param {HTMLElement} contextElement - The form element containing the link preview area.
 */
export function addLinkToForm(link, contextElement) {
    if (!contextElement) return;
    const linkId = `${link.table}:${link.id}`;
    const previewContainer = contextElement.querySelector('.linked-items-preview');
    if (!previewContainer) return;

    const existing = previewContainer.querySelector(`[data-link-id="${linkId}"]`);
    if (existing) return;

    const tag = document.createElement('span');
    tag.className = 'linked-item-tag';
    tag.dataset.linkId = linkId;
    tag.innerHTML = `<i class="fas ${getIconForTable(link.table)}"></i> ${link.title} <button type="button" class="remove-link-tag">&times;</button>`;

    tag.querySelector('.remove-link-tag').addEventListener('click', (e) => {
        e.preventDefault();
        tag.remove();
    });

    previewContainer.appendChild(tag);
}

/**
 * Retrieves all selected link IDs from a form's preview area.
 * @param {HTMLElement} contextElement - The form element.
 * @returns {string[]} An array of link IDs in the format 'table:id'.
 */
export function getSelectedLinks(contextElement) {
    const previewContainer = contextElement.querySelector('.linked-items-preview');
    if (!previewContainer) return [];
    return Array.from(previewContainer.querySelectorAll('.linked-item-tag')).map(tag => tag.dataset.linkId);
}