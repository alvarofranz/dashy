import * as api from '../api.js';
import { contentPanel, debounce, getIconForTable, closeModal, formatObjectType } from './helpers.js';
import { renderAddForm, addLinkToForm, getSelectedLinks, renderOnTheFlyForm } from './forms.js';
import { renderObject, renderListView, loadMoreItems, renderDashboardView } from './main_view.js';

export function initializeEventListeners() {
    document.body.addEventListener('click', handleGlobalClick);
    document.body.addEventListener('submit', handleGlobalSubmit);
    document.body.addEventListener('change', handleGlobalChange);
    document.body.addEventListener('focusin', handleFocusIn); // For custom dropdown

    contentPanel.addEventListener('input', debounce(handleContentPanelInput, 300));
    contentPanel.addEventListener('keydown', handleKeyDown);
    contentPanel.addEventListener('focusout', handleFocusOut);
    contentPanel.addEventListener('scroll', handleInfiniteScroll);

    window.addEventListener('map-clicked-for-form', handleMapClickForForm);
    window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && window.dashy.appState.isModalOpen) {
            closeModal();
        }
    });
}

async function handleGlobalClick(e) {
    const target = e.target;

    // --- Actions that can happen anywhere (main panel or modal) ---
    if (target.closest('.add-kv-button')) {
        addKeyValueRow(target);
        return;
    }
    if (target.closest('.edit-kv-button')) {
        editKeyValueRow(target.closest('li'));
        return;
    }
    if (target.closest('.save-kv-button')) {
        await saveKeyValueRow(target.closest('li'));
        return;
    }
    if (target.closest('.delete-kv-button')) {
        await deleteKeyValueRow(target.closest('li'));
        return;
    }

    // --- Modal-specific closing actions ---
    if (window.dashy.appState.isModalOpen) {
        if (target.closest('.cancel-modal-btn')) {
            closeModal();
        }
        return;
    }

    // --- Actions that ONLY happen when modal is closed ---
    const currentlyEditingKv = document.querySelector('#app-panel-content .kv-edit-mode');
    if (currentlyEditingKv && !currentlyEditingKv.contains(target)) {
        saveKeyValueRow(currentlyEditingKv);
    }

    if (target.closest('.app-panel-header') || target.closest('#bottom-nav')) {
        if (target.closest('#add-new-button')) {
            renderAddForm(target.closest('#add-new-button').dataset.type);
        } else if (target.closest('#app-title')) {
            renderDashboardView();
        } else if(target.closest('#bottom-nav')) {
            handleBottomNavClick(e);
        }
        return;
    }

    if (target.closest('#app-panel-content')) {
        if (target.closest('.list-item') && !target.closest('.todo-list-status')) { renderObject(target.closest('.list-item').dataset.table, target.closest('.list-item').dataset.id); }
        else if (target.closest('.link-item') && !target.closest('.unlink-btn')) { renderObject(target.closest('.link-item').dataset.table, target.closest('.link-item').dataset.id); }
        else if (target.closest('.search-results-list > li')) { await handleSearchItemClick(target.closest('li')); }
        else if (target.closest('.custom-type-results > li')) { handleCustomTypeClick(target.closest('li')); }
        else if (target.closest('.unlink-btn')) { await handleUnlinkClick(target); }
        else if (target.closest('.delete-object-btn')) { await handleDeleteClick(target); }
        else if (target.closest('.editable-title')) { activateInlineEdit(target.closest('.editable-title')); }
        else if (target.closest('.create-link-btn')) { renderOnTheFlyForm(target.closest('.create-link-btn').dataset.type); }
    }
}

async function handleGlobalSubmit(e) {
    e.preventDefault();

    const form = e.target;
    const type = form.dataset.type;
    const formData = new FormData(form);

    // The main 'Add New' form
    if (form.id === 'add-form') {
        const links = getSelectedLinks(form.querySelector('.add-link-form'));
        formData.append('links', JSON.stringify(links));
        try {
            const result = await api.createObject(type, formData);
            const createdItems = Array.isArray(result) ? result : [result];

            createdItems.forEach(item => {
                if (item.table === 'places') {
                    window.dashy.addMarkerToMap(item, true);
                }
            });

            let expectedTable = type === 'person' ? 'people' : `${type}s`;
            if (['image', 'other_file', 'custom_object'].includes(type)) expectedTable = `${type}s`;
            if (type === 'custom_object') expectedTable = 'custom_objects';
            if (type === 'other_file') expectedTable = 'other_files';


            const primaryItem = createdItems.find(item => item.table === expectedTable) || createdItems[0];
            if (primaryItem) {
                renderObject(primaryItem.table, primaryItem.id);
            } else {
                renderDashboardView();
            }
        } catch (error) { console.error(error); alert(`Error: ${error.message}`); }
    }

    // The 'On-the-fly' form in the modal
    if (form.id === 'on-the-fly-add-form') {
        try {
            const result = await api.createObject(type, formData);
            const createdItems = Array.isArray(result) ? result : [result];

            createdItems.forEach(item => {
                if (item.table === 'places') window.dashy.addMarkerToMap(item, true);
            });

            let expectedTable = `${type}s`;
            if (type === 'person') expectedTable = 'people';
            if (type === 'custom_object') expectedTable = 'custom_objects';
            if (type === 'other_file') expectedTable = 'other_files';

            const allPrimaryItems = createdItems.filter(item => item.table === expectedTable);

            if (allPrimaryItems.length > 0) {
                const objectViewContext = document.querySelector('.object-view');
                const addFormContext = document.getElementById('add-form');

                for (const primaryItem of allPrimaryItems) {
                    if (objectViewContext) { // Linking to an existing object we are viewing
                        const source = objectViewContext.dataset;
                        const target = primaryItem;
                        await api.post('/link', { source_id: source.id, source_table: source.table, target_id: target.id, target_table: target.table });
                        const list = objectViewContext.querySelector('.links-list');
                        list.insertAdjacentHTML('beforeend', `<li class="link-item" data-id="${target.id}" data-table="${target.table}"><span class="link-title"><i class="fas ${getIconForTable(target.table)}"></i> ${target.title}</span><button class="unlink-btn action-button" title="Unlink Item"><i class="fas fa-times"></i></button></li>`);
                    } else if (addFormContext) { // Linking to a new object we are creating
                        const linkForm = addFormContext.querySelector('.add-link-form');
                        if (linkForm) addLinkToForm(primaryItem, linkForm);
                    }
                }
            }
            closeModal();
        } catch (error) { console.error(error); alert(`Error creating linked item: ${error.message}`); }
    }
}

async function handleGlobalChange(e) {
    const target = e.target;
    if (target.matches('#todo-status')) { // In object view
        const id = target.dataset.id;
        const newStatus = target.checked ? 1 : 0;
        await api.updateObject('todos', id, 'status', newStatus);
        target.nextElementSibling.textContent = newStatus ? 'Complete' : 'Incomplete';
        document.querySelector('.object-view-header h2')?.classList.toggle('completed', target.checked);
    } else if (target.matches('.todo-list-status input')) { // In list view
        const id = target.dataset.id;
        const newStatus = target.checked ? 1 : 0;
        await api.updateObject('todos', id, 'status', newStatus);
        target.closest('.list-item').querySelector('.item-title').classList.toggle('completed', target.checked);
    } else if (target.matches('.custom-file-input')) { // Custom file input
        const fileListEl = target.parentElement.querySelector('.file-list');
        if (!fileListEl) return;

        fileListEl.innerHTML = '';
        if (target.files.length > 0) {
            for (const file of target.files) {
                const li = document.createElement('li');
                li.textContent = file.name;
                fileListEl.appendChild(li);
            }
        }
    }
}

async function handleFocusIn(e) {
    if (e.target.matches('.custom-type-search-input')) {
        const input = e.target;
        const resultsList = input.nextElementSibling;
        const allTypes = await api.getCustomObjectTypes();
        resultsList.innerHTML = allTypes.map(t => `<li data-type-name="${t}">${formatObjectType(t)}</li>`).join('');
        resultsList.style.display = 'block';
    }
}

async function handleContentPanelInput(e) {
    if (e.target.matches('.link-search-input')) {
        const searchTerm = e.target.value;
        const resultsList = e.target.nextElementSibling;
        const objectView = e.target.closest('.object-view');
        const mainForm = e.target.closest('#add-form');
        let existingLinks = [];
        if (objectView) {
            existingLinks = Array.from(objectView.querySelectorAll('.links-list .link-item, .linked-items-preview .linked-item-tag')).map(el => el.dataset.linkId || `${el.dataset.table}:${el.dataset.id}`);
            const currentObjectId = objectView.dataset.id;
            existingLinks.push(`${objectView.dataset.table}:${currentObjectId}`);
        } else if (mainForm) {
            existingLinks = getSelectedLinks(mainForm);
        }

        if (searchTerm.length < 2) { resultsList.innerHTML = ''; return; }
        const results = await api.searchObjects(searchTerm);
        resultsList.innerHTML = results
            .filter(r => !existingLinks.includes(`${r.table}:${r.id}`))
            .map(r => `<li data-id="${r.id}" data-table="${r.table}" data-title="${r.title}"><i class="fas ${getIconForTable(r.table)}"></i> ${r.title}</li>`).join('');
    } else if (e.target.matches('.custom-type-search-input')) {
        const input = e.target;
        const searchTerm = input.value.toLowerCase();
        const resultsList = input.nextElementSibling;

        const allTypes = await api.getCustomObjectTypes();
        const filteredTypes = searchTerm ? allTypes.filter(t => t.toLowerCase().includes(searchTerm)) : allTypes;

        resultsList.innerHTML = filteredTypes.map(t => `<li data-type-name="${t}">${formatObjectType(t)}</li>`).join('');
        resultsList.style.display = filteredTypes.length > 0 ? 'block' : 'none';
    }
}

function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
        if (e.target.classList.contains('inline-edit-input')) { e.preventDefault(); e.target.blur(); }
        if (e.target.closest('.kv-edit-mode') && !e.target.matches('textarea')) { e.preventDefault(); saveKeyValueRow(e.target.closest('li')); }
    } else if (e.key === 'Escape') {
        if (e.target.classList.contains('inline-edit-input')) e.target.blur();
        if (e.target.closest('.kv-edit-mode')) cancelEditKeyValueRow(e.target.closest('li'));
    }
}

function handleFocusOut(e) {
    if (e.target.matches('.inline-edit-input')) {
        saveInlineEdit(e.target);
    }
    if (e.target.closest('.kv-edit-mode') && !e.target.closest('.kv-edit-mode').contains(e.relatedTarget)) {
        saveKeyValueRow(e.target.closest('.kv-edit-mode'));
    }
    if (e.target.matches('.custom-type-search-input')) {
        setTimeout(() => {
            const resultsList = e.target.nextElementSibling;
            if (resultsList && !resultsList.matches(':hover')) {
                resultsList.style.display = 'none';
            }
        }, 150);
    }
}

function handleInfiniteScroll(e) {
    if (!window.dashy.appState.currentView?.type?.includes('list')) return;
    const { scrollTop, scrollHeight, clientHeight } = e.target;
    if (scrollHeight - scrollTop - clientHeight < 250) {
        loadMoreItems();
    }
}

function handleBottomNavClick(e) {
    const btn = e.target.closest('.nav-btn');
    if (btn) {
        document.querySelectorAll('#bottom-nav .nav-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const type = btn.dataset.type;
        if (type === 'dashboard') {
            renderDashboardView();
        } else {
            renderListView(type);
        }
    }
}

function handleMapClickForForm(e) {
    const { lat, lng } = e.detail;
    const latlngStr = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;

    const idPrefix = window.dashy.appState.isModalOpen ? 'otf-' : '';
    document.getElementById(`${idPrefix}latlng-display`)?.setAttribute('value', latlngStr);
    document.getElementById(`${idPrefix}lat`)?.setAttribute('value', lat);
    document.getElementById(`${idPrefix}lng`)?.setAttribute('value', lng);
}

async function handleSearchItemClick(li) {
    // This function handles both link search and custom type search results
    if (li.closest('.custom-type-results')) {
        handleCustomTypeClick(li);
        return;
    }

    const linkForm = li.closest('.add-link-form');
    const objectView = li.closest('.object-view');
    const target = { id: li.dataset.id, table: li.dataset.table, title: li.dataset.title };

    if (objectView) {
        const source = objectView.dataset;
        await api.post('/link', { source_id: source.id, source_table: source.table, target_id: target.id, target_table: target.table });
        const list = objectView.querySelector('.links-list');
        list.insertAdjacentHTML('beforeend', `<li class="link-item" data-id="${target.id}" data-table="${target.table}"><span class="link-title"><i class="fas ${getIconForTable(target.table)}"></i> ${target.title}</span><button class="unlink-btn action-button" title="Unlink Item"><i class="fas fa-times"></i></button></li>`);
    } else {
        addLinkToForm(target, linkForm);
    }
    linkForm.querySelector('.link-search-input').value = '';
    li.parentElement.innerHTML = '';
}

function handleCustomTypeClick(li) {
    const container = li.closest('.custom-type-search-container');
    const input = container.querySelector('.custom-type-search-input');
    const resultsList = li.parentElement; // Get a reference to the parent (the <ul>)

    input.value = li.dataset.typeName; // Set the input value

    resultsList.innerHTML = ''; // Clear the list
    resultsList.style.display = 'none'; // Hide the list
}

async function handleUnlinkClick(target) {
    const source = target.closest('.object-view').dataset;
    const linkedItem = target.closest('.link-item');
    const targetData = linkedItem.dataset;
    if (confirm('Are you sure you want to unlink this item?')) {
        await api.unlinkObjects(source, targetData);
        linkedItem.remove();
    }
}

async function handleDeleteClick(target) {
    const { id, table } = target.closest('.object-view').dataset;
    if (confirm('Are you sure you want to delete this object and all its links? This cannot be undone.')) {
        await api.deleteObject(table, id);
        if (table === 'places') window.dashy.removeMarkerFromMap(id);
        renderDashboardView();
    }
}

function activateInlineEdit(span) {
    if (span.querySelector('input')) return;
    const originalText = span.textContent;
    span.dataset.original = originalText;
    span.innerHTML = `<input type="text" value="${originalText}" class="inline-edit-input">`;
    const input = span.querySelector('input');
    input.focus();
    input.select();
}

async function saveInlineEdit(input) {
    const span = input.parentElement;
    if (!span || !span.classList.contains('editable-title') || !span.closest('.object-view')) return;

    const { id, table } = span.closest('.object-view').dataset;
    const newValue = input.value.trim();
    const originalValue = span.dataset.original;

    span.innerHTML = originalValue; // Revert to span to avoid losing content on failed API call

    if (newValue && newValue !== originalValue) {
        try {
            const result = await api.updateObject(table, id, 'title', newValue);
            span.textContent = result.newValue;
        } catch (e) {
            console.error(e);
            alert(`Error: ${e.message}`);
            span.textContent = originalValue; // Restore original on failure
        }
    } else {
        span.textContent = originalValue;
    }
}

function addKeyValueRow(target) {
    const container = target.closest('.form-group') || target.closest('.section') || target.closest('.form-container');
    const list = container.querySelector('.kv-list');
    if (!list || list.querySelector('.kv-edit-mode.new-kv')) return;
    const li = document.createElement('li');
    li.className = 'kv-edit-mode new-kv';
    li.innerHTML = `<input type="text" class="key-input" placeholder="Key">
                    <input type="text" class="value-input" placeholder="Value">
                    <div class="actions"><button type="button" class="save-kv-button action-button" title="Save"><i class="fas fa-check"></i></button></div>`;
    list.appendChild(li);
    li.querySelector('.key-input').focus();
}

function editKeyValueRow(li) {
    if (document.querySelector('.kv-edit-mode')) return;
    const key = li.querySelector('.key').textContent;
    const value = li.querySelector('.value').textContent;
    li.classList.add('kv-edit-mode');
    li.dataset.originalKey = key;
    li.dataset.originalValue = value;
    li.innerHTML = `<input type="text" class="key-input" value="${key}">
                    <input type="text" class="value-input" value="${value}">
                    <div class="actions"><button type="button" class="save-kv-button action-button" title="Save"><i class="fas fa-check"></i></button></div>`;
    li.querySelector('.key-input').focus();
}

async function saveKeyValueRow(li) {
    const keyInput = li.querySelector('.key-input');
    const valueInput = li.querySelector('.value-input');
    if (!keyInput || !valueInput) return;

    const key = keyInput.value.trim();
    const value = valueInput.value.trim();
    const isNewInForm = !li.closest('.object-view');

    if (!key) {
        cancelEditKeyValueRow(li);
        return;
    }

    if (isNewInForm) {
        li.classList.remove('kv-edit-mode', 'new-kv');
        li.innerHTML = `<input type="hidden" name="kv_key" value="${key}"><input type="hidden" name="kv_value" value="${value}">
                        <span class="key">${key}</span><span class="value">${value}</span><div class="actions"><button type="button" class="edit-kv-button action-button"><i class="fas fa-pencil-alt"></i></button><button type="button" class="delete-kv-button action-button"><i class="fas fa-trash"></i></button></div>`;
        return;
    }

    const { id, table } = li.closest('.object-view').dataset;
    const kvId = li.dataset.kvId;
    try {
        if (kvId) {
            await api.patch(`/kv/${kvId}`, { key, value });
        } else {
            const newKv = await api.post(`/object/${table}/${id}/kv`, { key, value });
            li.dataset.kvId = newKv.id;
        }
        li.classList.remove('kv-edit-mode', 'new-kv');
        li.innerHTML = `<span class="key">${key}</span><span class="value">${value}</span><div class="actions"><button class="edit-kv-button action-button"><i class="fas fa-pencil-alt"></i></button><button class="delete-kv-button action-button"><i class="fas fa-trash"></i></button></div>`;
    } catch (e) {
        console.error(e);
        alert(`Error saving detail: ${e.message}`);
        cancelEditKeyValueRow(li);
    }
}

function cancelEditKeyValueRow(li) {
    if (li.classList.contains('new-kv')) {
        li.remove();
        return;
    }
    li.classList.remove('kv-edit-mode');
    li.innerHTML = `<span class="key">${li.dataset.originalKey}</span><span class="value">${li.dataset.originalValue}</span><div class="actions"><button class="edit-kv-button action-button"><i class="fas fa-pencil-alt"></i></button><button class="delete-kv-button action-button"><i class="fas fa-trash"></i></button></div>`;
}

async function deleteKeyValueRow(li) {
    const isNewInForm = !li.dataset.kvId;
    if (isNewInForm) {
        li.remove();
        return;
    }
    if (confirm('Are you sure you want to delete this detail?')) {
        await api.del(`/kv/${li.dataset.kvId}`);
        li.remove();
    }
}