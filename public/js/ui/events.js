import * as api from '../api.js';
import { contentPanel, debounce, getIconForTable, closeModal, formatIdString, formatStringToId } from './helpers.js';
import { renderAddForm, addLinkToForm, getSelectedLinks, renderOnTheFlyForm } from './forms.js';
import { renderObject, renderListView, loadMoreItems, renderDashboardView, loadFilteredItems, toggleCustomObjectFilter, renderSettingsView } from './main_view.js';

let currentSlide = 0;
const totalSlides = 8;

export function initializeEventListeners() {
    document.body.addEventListener('mousedown', handleGlobalMouseDown);
    document.body.addEventListener('click', handleGlobalClick);
    document.body.addEventListener('submit', handleGlobalSubmit);
    document.body.addEventListener('change', handleGlobalChange);
    document.body.addEventListener('focusin', handleFocusIn);
    document.body.addEventListener('keydown', handleKeyDown);
    document.body.addEventListener('focusout', handleFocusOut);

    contentPanel.addEventListener('scroll', handleInfiniteScroll);

    window.addEventListener('map-clicked-for-form', handleMapClickForForm);
    window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && window.dashy.appState.isModalOpen) {
            closeModal();
        }
    });
}

async function handleGlobalMouseDown(e) {
    const target = e.target;

    if (target.closest('.custom-type-results > li')) {
        e.preventDefault();
        handleCustomTypeClick(target.closest('li'));
    } else if (target.closest('.kv-key-results > li')) {
        e.preventDefault();
        handleKvKeyClick(target.closest('li'));
    }
}

function updateOnboardingNav() {
    const prevBtn = document.getElementById('onboarding-prev');
    const nextBtn = document.getElementById('onboarding-next');
    if (!prevBtn || !nextBtn) return;

    prevBtn.disabled = currentSlide === 0;

    if (currentSlide === totalSlides - 1) {
        nextBtn.style.visibility = 'hidden';
    } else {
        nextBtn.style.visibility = 'visible';
    }
}

function changeSlide(direction) {
    const slidesContainer = document.querySelector('.onboarding-slides-container');
    if (!slidesContainer) return;

    currentSlide += direction;
    if (currentSlide < 0) currentSlide = 0;
    if (currentSlide >= totalSlides) currentSlide = totalSlides - 1;

    slidesContainer.style.transform = `translateX(-${currentSlide * 100}%)`;
    updateOnboardingNav();
}

async function handleGlobalClick(e) {
    const target = e.target;

    // --- Onboarding Modal ---
    if (target.closest('#onboarding-modal')) {
        if (target.id === 'onboarding-next') changeSlide(1);
        if (target.id === 'onboarding-prev') changeSlide(-1);
        if (target.id === 'onboarding-select-folder') {
            const filePaths = await api.selectFiles({ properties: ['openDirectory', 'createDirectory'] });
            if (filePaths.length > 0) {
                target.textContent = 'Setting up...';
                target.disabled = true;
                await api.setDataPath(filePaths[0]);
                // The app will restart automatically from the main process
            }
        }
        return;
    }

    // --- Settings View ---
    if (target.id === 'settings-open-data-btn') {
        api.openDataPath();
        return;
    }
    if (target.id === 'settings-change-data-btn') {
        if (confirm('Changing the data folder will move all your data and restart the application. Continue?')) {
            target.textContent = 'Working...';
            target.disabled = true;
            const result = await api.changeDataPath();
            if (result && result.success === false && result.reason === 'same_path') {
                target.textContent = 'Change Folder';
                target.disabled = false;
            }
        }
        return;
    }
    if (target.id === 'settings-download-update-btn') {
        await window.electronAPI.invoke('shell:open-external', target.dataset.url);
        return;
    }

    // --- Inline Editing ---
    if (target.closest('.editable') && !target.closest('.inline-edit-control')) {
        activateInlineEdit(target.closest('.editable'));
        return;
    }

    // --- File Selection (Electron specific) ---
    if(target.matches('.file-select-btn')) {
        e.preventDefault();
        const isImage = target.dataset.fileType === 'image';
        const options = {
            properties: ['openFile', 'multiSelections'],
            filters: isImage
                ? [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif', 'heic', 'heif'] }]
                : [{ name: 'All Files', extensions: ['*'] }]
        };
        const filePaths = await api.selectFiles(options);
        if (filePaths.length > 0) {
            target.dataset.selectedFiles = JSON.stringify(filePaths);
            const fileListEl = target.parentElement.querySelector('.file-list');
            if (fileListEl) {
                fileListEl.innerHTML = filePaths.map(p => `<li>${p.split(/[/\\]/).pop()}</li>`).join('');
            }
        }
        return;
    }


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
    if (target.closest('.todo-status-button')) {
        const button = target.closest('.todo-status-button');
        const id = button.dataset.id;
        const currentStatus = parseInt(button.dataset.currentStatus, 10);
        const newStatus = currentStatus === 1 ? 0 : 1;
        await api.updateObject('todos', id, 'status', newStatus);
        renderObject('todos', id);
        return;
    }

    // --- Modal-specific closing actions ---
    if (window.dashy.appState.isModalOpen) {
        if (target.closest('.cancel-modal-btn') || target.id === 'modal-overlay') {
            closeModal();
        }
        return;
    }

    // --- Actions that ONLY happen when modal is closed ---
    const currentlyEditingKv = document.querySelector('#app-panel-content .kv-edit-mode');
    if (currentlyEditingKv && !currentlyEditingKv.contains(target)) {
        await saveKeyValueRow(currentlyEditingKv);
    }

    if (target.closest('.app-panel-header') || target.closest('#bottom-nav')) {
        if (target.closest('#add-new-button')) {
            const button = target.closest('#add-new-button');
            const type = button.dataset.type;
            if (type === 'settings') {
                renderSettingsView();
            } else {
                renderAddForm(type);
            }
        } else if (target.closest('#app-title')) {
            renderDashboardView();
        } else if(target.closest('#bottom-nav')) {
            handleBottomNavClick(e);
        }
        return;
    }

    const contentContainer = target.closest('#app-panel-content, #modal-content');
    if (contentContainer) {
        if (target.closest('.show-in-folder-btn')) {
            const objectView = target.closest('.object-view');
            const filePath = objectView?.dataset.filePath;
            if (filePath) {
                api.showItemInFolder(filePath);
            }
            return;
        }
        if (target.closest('.filter-tag')) {
            const tag = target.closest('.filter-tag');
            tag.classList.toggle('active');
            toggleCustomObjectFilter(tag.dataset.type);
            loadFilteredItems('custom_objects');
            return;
        }
        if (target.closest('.link-item:not(.image-grid .link-item)')) {
            if (!target.closest('.unlink-btn')) renderObject(target.closest('.link-item').dataset.table, target.closest('.link-item').dataset.id);
        }
        else if (target.closest('.image-grid .link-item img')) {
            renderObject(target.closest('.link-item').dataset.table, target.closest('.link-item').dataset.id);
        }
        else if (target.closest('.list-item') && !target.closest('.todo-list-status')) { renderObject(target.closest('.list-item').dataset.table, target.closest('.list-item').dataset.id); }
        else if (target.closest('.search-results-list > li')) { await handleSearchItemClick(target.closest('li')); }
        else if (target.closest('.unlink-btn')) { await handleUnlinkClick(target); }
        else if (target.closest('.delete-object-btn')) { await handleDeleteClick(target); }
        else if (target.closest('.create-link-btn')) { renderOnTheFlyForm(target.closest('.create-link-btn').dataset.type); }
        else if (target.closest('.show-completed-todos-btn')) {
            const container = target.previousElementSibling;
            if (container && container.classList.contains('completed-todos-container')) {
                container.classList.remove('hidden');
                target.classList.add('hidden');
            }
            return;
        }
    }
}

async function handleGlobalSubmit(e) {
    e.preventDefault();

    const form = e.target;
    const type = form.dataset.type;
    const formData = new FormData(form);

    if (type === 'image' || type === 'other_file') {
        const fileSelectBtn = form.querySelector('.file-select-btn');
        const filePaths = fileSelectBtn.dataset.selectedFiles ? JSON.parse(fileSelectBtn.dataset.selectedFiles) : [];
        if (filePaths.length === 0) {
            alert('Please select one or more files.');
            return;
        }
        formData.append('filePaths', JSON.stringify(filePaths));
    }

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
            if (['image', 'other_file', 'custom_object', 'note'].includes(type)) expectedTable = `${type}s`;
            if (type === 'custom_object') expectedTable = 'custom_objects';
            if (type === 'other_file') expectedTable = 'files';

            const primaryItem = createdItems.find(item => item.table === expectedTable) || createdItems[0];
            if (primaryItem) {
                renderObject(primaryItem.table, primaryItem.id);
            } else {
                renderDashboardView();
            }
        } catch (error) { console.error(error); alert(`Error: ${error.message}`); }
    }

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
            if (type === 'other_file') expectedTable = 'files';
            if (type === 'note') expectedTable = 'notes';

            const allPrimaryItems = createdItems.filter(item => item.table === expectedTable);

            if (allPrimaryItems.length > 0) {
                const objectViewContext = document.querySelector('.object-view');
                const addFormContext = document.getElementById('add-form');

                for (const primaryItem of allPrimaryItems) {
                    if (objectViewContext) {
                        const source = objectViewContext.dataset;
                        const target = primaryItem;
                        await api.post('/link', { source_id: source.id, source_table: source.table, target_id: target.id, target_table: target.table });
                        renderObject(source.table, source.id);
                    } else if (addFormContext) {
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
    if (target.matches('#todo-status')) {
        const id = target.dataset.id;
        const newStatus = target.checked ? 1 : 0;
        await api.updateObject('todos', id, 'status', newStatus);
        target.nextElementSibling.textContent = newStatus ? 'Complete' : 'Incomplete';
        document.querySelector('.object-view-header h2')?.classList.toggle('completed', target.checked);
    } else if (target.matches('.todo-list-status input')) {
        const id = target.dataset.id;
        const newStatus = target.checked ? 1 : 0;
        await api.updateObject('todos', id, 'status', newStatus);
        target.closest('.list-item').querySelector('.item-title').classList.toggle('completed', target.checked);
    }
}

async function handleFocusIn(e) {
    const target = e.target;
    if (target.matches('.custom-type-search-input')) {
        const resultsList = target.nextElementSibling;
        let allTypes = await api.getCustomObjectTypes();
        resultsList.innerHTML = allTypes.slice(0, 6).map(t => `<li data-type-name="${t}">${formatIdString(t)}</li>`).join('');
        resultsList.style.display = 'block';
    }
    if (target.matches('.kv-key-search-input')) {
        const resultsList = target.nextElementSibling;
        let allKeys = await api.getKvKeys();
        resultsList.innerHTML = allKeys.slice(0, 6).map(k => `<li data-key-name="${k}">${formatIdString(k)}</li>`).join('');
        resultsList.style.display = 'block';
    }
    // Debounced search for dashboard
    if (target.matches('#dashboard-search-input')) {
        target.addEventListener('input', debounce(handleDashboardSearch, 300));
    }
}

async function handleDashboardSearch(e) {
    const target = e.target;
    const resultsList = document.getElementById('dashboard-search-results');
    const term = target.value.trim();

    if (term.length < 2) {
        resultsList.innerHTML = '';
        resultsList.style.display = 'none';
        return;
    }

    let results = await api.searchObjects(term, 25);
    resultsList.style.display = 'block';
    if (results.length > 0) {
        resultsList.innerHTML = results
            .slice(0, 6)
            .map(r => `<li data-id="${r.id}" data-table="${r.table}" data-title="${r.title}"><i class="fas ${getIconForTable(r.table)}"></i> ${r.title}</li>`).join('');
    } else {
        resultsList.innerHTML = '<li style="padding: 0.75rem; color: var(--text-tertiary);">No results found</li>';
    }
}


function handleKeyDown(e) {
    const target = e.target;

    // MODIFIED: Added #dashboard-search-input to enable keyboard navigation for the main search results.
    if (target.matches('.custom-type-search-input') || target.matches('.kv-key-search-input') || target.matches('#dashboard-search-input')) {
        handleSuggestionNav(e);
        if (['ArrowUp', 'ArrowDown', 'Enter', 'Tab', 'Escape'].includes(e.key)) return;
    }

    if (target.matches('.inline-edit-control')) {
        if (e.key === 'Escape') {
            cancelInlineEdit(target);
        } else if (e.key === 'Enter' && target.tagName.toLowerCase() === 'input') {
            e.preventDefault();
            saveInlineEdit(target);
        }
        return;
    }

    if (e.key === 'Enter' && !e.shiftKey) {
        if (target.closest('.kv-edit-mode') && !target.matches('textarea')) {
            e.preventDefault();
            saveKeyValueRow(target.closest('li'));
        }
    } else if (e.key === 'Escape') {
        if (target.closest('.kv-edit-mode')) cancelEditKeyValueRow(target.closest('li'));
    }
}

function handleSuggestionNav(e) {
    const resultsList = e.target.nextElementSibling;
    if (!resultsList) return;
    const items = Array.from(resultsList.children);
    if (items.length === 0 || resultsList.style.display === 'none') return;

    let activeItem = resultsList.querySelector('li.active');
    let activeIndex = activeItem ? items.indexOf(activeItem) : -1;

    if (e.key === 'ArrowDown') {
        e.preventDefault();
        activeIndex = (activeIndex + 1) % items.length;
    } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        activeIndex = (activeIndex - 1 + items.length) % items.length;
    } else if (e.key === 'Enter' || e.key === 'Tab') {
        if (activeItem) {
            e.preventDefault();
            if (e.target.matches('.custom-type-search-input')) handleCustomTypeClick(activeItem);
            else if (e.target.matches('.kv-key-search-input')) handleKvKeyClick(activeItem);
            else if(e.target.matches('#dashboard-search-input')) handleSearchItemClick(activeItem);
        }
        return;
    } else if (e.key === 'Escape') {
        resultsList.style.display = 'none';
    } else {
        return;
    }

    if (activeItem) activeItem.classList.remove('active');

    const newActiveItem = items[activeIndex];
    newActiveItem.classList.add('active');
    newActiveItem.scrollIntoView({ block: 'nearest' });
}


function handleFocusOut(e) {
    const target = e.target;
    const hideList = (list) => {
        setTimeout(() => { if (list && !list.matches(':hover')) { list.style.display = 'none'; }}, 150);
    };

    if (target.matches('#dashboard-search-input')) hideList(document.getElementById('dashboard-search-results'));
    if (target.matches('.inline-edit-control')) saveInlineEdit(target);
    if (target.matches('.custom-type-search-input') || target.matches('.kv-key-search-input') || target.matches('.link-search-input')) hideList(target.nextElementSibling);

    const editingRow = target.closest('.kv-edit-mode');
    if (editingRow) {
        if (editingRow.dataset.ignoreFocusOut === 'true') return;
        setTimeout(() => {
            if (editingRow.parentElement && !editingRow.contains(document.activeElement)) {
                if (editingRow.classList.contains('kv-edit-mode')) saveKeyValueRow(editingRow);
            }
        }, 50);
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
    if (li.closest('#dashboard-search-results')) {
        renderObject(li.dataset.table, li.dataset.id);
        const searchInput = document.getElementById('dashboard-search-input');
        const resultsList = document.getElementById('dashboard-search-results');
        if (searchInput) searchInput.value = '';
        if (resultsList) resultsList.style.display = 'none';
        return;
    }

    const linkForm = li.closest('.add-link-form');
    const objectView = li.closest('.object-view');
    const target = { id: li.dataset.id, table: li.dataset.table, title: li.dataset.title };

    if (objectView) {
        const source = objectView.dataset;
        await api.post('/link', { source_id: source.id, source_table: source.table, target_id: target.id, target_table: target.table });
        renderObject(source.table, source.id);
    } else {
        addLinkToForm(target, linkForm);
    }
    linkForm.querySelector('.link-search-input').value = '';
    li.parentElement.innerHTML = '';
}

function handleCustomTypeClick(li) {
    const container = li.closest('.custom-type-search-container');
    const input = container.querySelector('.custom-type-search-input');
    const resultsList = li.parentElement;
    const form = li.closest('form');
    const editingElement = form || li.closest('.kv-edit-mode');
    editingElement.dataset.ignoreFocusOut = 'true';
    input.value = formatIdString(li.dataset.typeName);
    resultsList.innerHTML = '';
    resultsList.style.display = 'none';
    if (form) {
        const inputs = Array.from(form.querySelectorAll('input:not([type=hidden]), textarea, button'));
        const currentIndex = inputs.findIndex(el => el === input);
        if (currentIndex > -1 && currentIndex < inputs.length - 1) {
            inputs[currentIndex + 1].focus();
        }
    }
    setTimeout(() => delete editingElement.dataset.ignoreFocusOut, 50);
}

function handleKvKeyClick(li) {
    const editingRow = li.closest('li.kv-edit-mode');
    if (!editingRow) return;

    const container = li.closest('.kv-key-search-container');
    const input = container.querySelector('.kv-key-search-input');
    const resultsList = li.parentElement;
    editingRow.dataset.ignoreFocusOut = 'true';
    input.value = li.textContent;
    resultsList.innerHTML = '';
    resultsList.style.display = 'none';
    const valueInput = editingRow.querySelector('.value-input');
    if (valueInput) {
        valueInput.addEventListener('focus', () => { delete editingRow.dataset.ignoreFocusOut; }, { once: true });
        valueInput.focus();
    } else {
        delete editingRow.dataset.ignoreFocusOut;
    }
}


async function handleUnlinkClick(target) {
    const source = target.closest('.object-view').dataset;
    const linkedItem = target.closest('.link-item');
    const targetData = linkedItem.dataset;
    if (confirm('Are you sure you want to unlink this item?')) {
        await api.unlinkObjects(source, targetData);
        renderObject(source.table, source.id);
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

function activateInlineEdit(element) {
    if (element.querySelector('.inline-edit-control')) return;
    const originalText = element.textContent.trim() === 'Click to add content...' ? '' : element.textContent;
    const editType = element.dataset.editType || 'input';
    element.dataset.original = element.textContent;
    let control;
    if (editType === 'textarea') {
        control = document.createElement('textarea');
        control.className = 'inline-edit-control inline-edit-textarea';
    } else {
        control = document.createElement('input');
        control.type = 'text';
        control.className = 'inline-edit-control inline-edit-input';
    }
    control.value = originalText;
    element.innerHTML = '';
    element.appendChild(control);
    control.focus();
    if (control.select) control.select();
}

async function saveInlineEdit(control) {
    const element = control.parentElement;
    if (!element || !element.classList.contains('editable') || !element.dataset.original) return;
    const { id, table } = element.closest('.object-view').dataset;
    const field = element.dataset.field;
    const newValue = control.value;
    const originalValue = element.dataset.original;
    delete element.dataset.original;
    if (newValue.trim() !== originalValue.trim()) {
        try {
            await api.updateObject(table, id, field, newValue);
            element.textContent = (field === 'content' && newValue.trim() === '') ? 'Click to add content...' : newValue;
        } catch (e) {
            console.error(e);
            alert(`Error: ${e.message}`);
            element.textContent = originalValue;
        }
    } else {
        element.textContent = originalValue;
    }
}

function cancelInlineEdit(control) {
    const element = control.parentElement;
    if (element && element.dataset.original) {
        element.textContent = element.dataset.original;
        delete element.dataset.original;
    }
}

function addKeyValueRow(target) {
    const container = target.closest('.form-group') || target.closest('.section') || target.closest('.form-container');
    const list = container.querySelector('.kv-list');
    if (!list || list.querySelector('.kv-edit-mode.new-kv')) return;
    const li = document.createElement('li');
    li.className = 'kv-edit-mode new-kv';
    li.innerHTML = `
        <div class="kv-key-search-container">
            <input type="text" class="kv-key-search-input" placeholder="Key" autocomplete="off">
            <ul class="search-results-list kv-key-results"></ul>
        </div>
        <input type="text" class="value-input" placeholder="Value">
        <div class="actions">
            <button type="button" class="save-kv-button action-button" title="Save"><i class="fas fa-check"></i></button>
        </div>`;
    list.appendChild(li);
    li.querySelector('.kv-key-search-input').focus();
}

function editKeyValueRow(li) {
    const otherEditingRow = document.querySelector('.kv-edit-mode');
    if (otherEditingRow && otherEditingRow !== li) {
        saveKeyValueRow(otherEditingRow);
        if (document.querySelector('.kv-edit-mode')) return;
    };
    const displayKey = li.querySelector('.key').textContent;
    const value = li.querySelector('.value').textContent;
    li.classList.add('kv-edit-mode');
    li.dataset.originalValue = value;
    li.innerHTML = `
        <div class="kv-key-search-container">
            <input type="text" class="kv-key-search-input" value="${displayKey}" autocomplete="off">
            <ul class="search-results-list kv-key-results"></ul>
        </div>
        <input type="text" class="value-input" value="${value}">
        <div class="actions">
            <button type="button" class="save-kv-button action-button" title="Save"><i class="fas fa-check"></i></button>
        </div>`;
    const keyInput = li.querySelector('.kv-key-search-input');
    keyInput.focus();
    keyInput.select();
}

async function saveKeyValueRow(li) {
    const keyInput = li.querySelector('.kv-key-search-input');
    const valueInput = li.querySelector('.value-input');
    if (!keyInput || !valueInput) return;
    const displayKey = keyInput.value.trim();
    const keySlug = formatStringToId(displayKey);
    const value = valueInput.value.trim();
    const isNewInForm = !li.closest('.object-view');
    if (!keySlug) {
        if (li.classList.contains('new-kv')) li.remove();
        else cancelEditKeyValueRow(li);
        return;
    }
    if (isNewInForm) {
        li.classList.remove('kv-edit-mode', 'new-kv');
        li.innerHTML = `<input type="hidden" name="kv_key" value="${keySlug}"><input type="hidden" name="kv_value" value="${value}">
                        <span class="key">${displayKey}</span><span class="value">${value}</span><div class="actions"><button type="button" class="edit-kv-button action-button"><i class="fas fa-pencil-alt"></i></button><button type="button" class="delete-kv-button action-button"><i class="fas fa-trash"></i></button></div>`;
        return;
    }
    const { id, table } = li.closest('.object-view').dataset;
    const kvId = li.dataset.kvId;
    try {
        if (kvId) {
            await api.patch(`/kv/${kvId}`, { key: keySlug, value });
        } else {
            const newKv = await api.post(`/object/${table}/${id}/kv`, { key: keySlug, value });
            li.dataset.kvId = newKv.id;
        }
        li.classList.remove('kv-edit-mode', 'new-kv');
        li.dataset.originalKey = keySlug;
        li.innerHTML = `<span class="key">${displayKey}</span><span class="value">${value}</span><div class="actions"><button class="edit-kv-button action-button"><i class="fas fa-pencil-alt"></i></button><button class="delete-kv-button action-button"><i class="fas fa-trash"></i></button></div>`;
    } catch (e) {
        console.error(e);
        alert(`Error saving detail: ${e.message}`);
        cancelEditKeyValueRow(li);
    }
}

function cancelEditKeyValueRow(li) {
    if (li.classList.contains('new-kv')) { li.remove(); return; }
    if (!li.classList.contains('kv-edit-mode')) return;
    li.classList.remove('kv-edit-mode');
    const originalKey = li.dataset.originalKey;
    const originalValue = li.dataset.originalValue;
    li.innerHTML = `<span class="key">${formatIdString(originalKey)}</span><span class="value">${originalValue}</span><div class="actions"><button class="edit-kv-button action-button"><i class="fas fa-pencil-alt"></i></button><button class="delete-kv-button action-button"><i class="fas fa-trash"></i></button></div>`;
}

async function deleteKeyValueRow(li) {
    const isNewInForm = !li.dataset.kvId && li.closest('#add-form');
    if (isNewInForm) {
        li.remove();
        return;
    }
    if (confirm('Are you sure you want to delete this detail?')) {
        try {
            await api.del(`/kv/${li.dataset.kvId}`);
            li.remove();
        } catch(e) { console.error(e); alert("Failed to delete detail."); }
    }
}