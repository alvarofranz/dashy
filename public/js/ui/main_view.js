import * as api from '../api.js';
import { contentPanel, getIconForTable, formatIdString, highlightMarker, clearHighlight } from './helpers.js';
import { renderAddLinkForm } from './forms.js';

let isLoadingMore = false;
let activeCustomObjectFilters = new Set();

export function toggleCustomObjectFilter(type) {
    if (activeCustomObjectFilters.has(type)) {
        activeCustomObjectFilters.delete(type);
    } else {
        activeCustomObjectFilters.add(type);
    }
}

const listToFormTypeMap = {
    places: 'place',
    people: 'person',
    notes: 'note',
    custom_objects: 'custom_object',
    images: 'image',
    files: 'other_file',
    todos: 'todo',
    recent: 'place' // Default for dashboard 'Add New'
};

export function renderWelcomeMessage() {
    window.dashy.appState.currentView = { type: 'welcome' };
    contentPanel.innerHTML = `
        <div class="welcome-message">
            <i class="fas fa-spaghetti-monster-flying"></i>
            <h2>Welcome to Dashy</h2>
            <p>This is your personal life dashboard. To get started, try adding a Place, a Person, or any other item using the navigation below.</p>
        </div>`;
    document.getElementById('add-new-button').classList.add('hidden');
    document.querySelectorAll('#bottom-nav .nav-btn').forEach(b => b.classList.remove('active'));
    document.querySelector('.nav-btn[data-type="dashboard"]').classList.add('active');
}

export async function renderDashboardView() {
    renderListView('recent');
}

export async function renderListView(type) {
    console.log(`Rendering list view for: ${type}`);
    if (type !== 'custom_objects') {
        activeCustomObjectFilters.clear();
    }
    window.dashy.appState.currentView = { type: 'list', listType: type, offset: 0, hasMore: true };

    const addNewButton = document.getElementById('add-new-button');
    const formType = listToFormTypeMap[type] || type;
    addNewButton.dataset.type = formType;
    addNewButton.querySelector('span').textContent = `Add ${formatIdString(formType)}`;
    addNewButton.classList.remove('hidden');

    clearHighlight();

    const listTitle = (type === 'recent') ? 'Recent Items' : formatIdString(type);
    const dashboardSearchHtml = type === 'recent' ? `
        <div class="dashboard-search-container">
            <input type="text" id="dashboard-search-input" placeholder="Search everywhere...">
            <ul class="search-results-list" id="dashboard-search-results" style="display: none;"></ul>
        </div>
    ` : '';

    contentPanel.innerHTML = `<div class="list-view-header"><h2><i class="fas ${getIconForTable(type)}"></i> ${listTitle}</h2>${dashboardSearchHtml}</div><div id="list-view-body"></div>`;
    const body = contentPanel.querySelector('#list-view-body');

    if (type === 'custom_objects') {
        const types = await api.getCustomObjectTypes();
        if (types.length > 0) {
            const filterTagsHtml = `
                <div class="filter-tags-container">
                    ${types.map(t => `<div class="filter-tag ${activeCustomObjectFilters.has(t) ? 'active' : ''}" data-type="${t}">${formatIdString(t)}</div>`).join('')}
                </div>`;
            // Insert filters before the main body container
            body.insertAdjacentHTML('beforebegin', filterTagsHtml);
        }
    }

    body.innerHTML = `<ul class="items-list-view"></ul><div class="loader">Loading...</div>`;
    await loadFilteredItems(type);
}

export async function loadFilteredItems(type) {
    const listViewBody = document.getElementById('list-view-body');
    if (!listViewBody) return;

    // Reset UI and state for new filter application
    listViewBody.querySelector('.items-list-view').innerHTML = '';
    let loader = listViewBody.querySelector('.loader');
    if (!loader) {
        loader = document.createElement('div');
        loader.className = 'loader';
        listViewBody.appendChild(loader);
    }
    loader.textContent = 'Loading...';

    window.dashy.appState.currentView.offset = 0;
    window.dashy.appState.currentView.hasMore = true;
    isLoadingMore = false;

    try {
        let filters = {};
        if (type === 'custom_objects' && activeCustomObjectFilters.size > 0) {
            filters.types = Array.from(activeCustomObjectFilters);
        }
        const items = await api.getObjectsList(type, { filters });
        appendItemsToListView(items, type);
    } catch (error) {
        console.error(`Error fetching filtered list view for ${type}:`, error);
        listViewBody.innerHTML = `<p>Error loading items.</p>`;
    }
}

export async function loadMoreItems() {
    const currentView = window.dashy.appState.currentView;
    if (!currentView || !currentView.type.includes('list')) return;

    const { listType, offset, hasMore } = currentView;
    if (isLoadingMore || !hasMore) return;

    isLoadingMore = true;
    const newOffset = offset + 20;
    try {
        let filters = {};
        if (listType === 'custom_objects' && activeCustomObjectFilters.size > 0) {
            filters.types = Array.from(activeCustomObjectFilters);
        }
        const items = await api.getObjectsList(listType, { offset: newOffset, filters });
        if (items.length > 0) {
            appendItemsToListView(items, listType);
            window.dashy.appState.currentView.offset = newOffset;
        } else {
            window.dashy.appState.currentView.hasMore = false;
            const loader = contentPanel.querySelector('.loader');
            if (loader) loader.remove();
            console.log("End of list reached.");
        }
    } catch (error) {
        console.error('Failed to load more items:', error);
    } finally {
        isLoadingMore = false;
    }
}

// Helper to create the correct URL for user data files
const createDataUrl = (filePath) => {
    // filePath from DB is like '/images/foo.jpg'. We need to remove the leading '/'
    return `dashy-data://${filePath.substring(1)}`;
}

function appendItemsToListView(items, type) {
    const list = contentPanel.querySelector('.items-list-view');
    const loader = contentPanel.querySelector('.loader');
    if (!list) return;

    if (list.children.length === 0 && items.length === 0) {
        if(loader) loader.textContent = 'No items found.';
        return;
    }

    const isRecentView = type === 'recent';
    const isTodoList = type === 'todos';
    const isImageView = type === 'images';

    if (isImageView && list) {
        list.classList.add('image-grid');
    }

    const itemsHtml = items.map(item => {
        let label = isRecentView ? formatIdString(item.table) : '';
        if (item.table === 'custom_objects' && item.object_type) {
            label = formatIdString(item.object_type);
        }

        let prefix = `<i class="fas ${getIconForTable(item.table)} fa-fw"></i>`;
        let titleClass = '';

        if (isTodoList) {
            const isChecked = item.status === 1;
            prefix = `<div class="todo-list-status"><input type="checkbox" id="todo-list-item-${item.id}" data-id="${item.id}" ${isChecked ? 'checked' : ''}></div>`;
            titleClass = isChecked ? 'completed' : '';
        }

        if(isImageView) {
            // MODIFIED: Use the custom protocol for image src
            const imageUrl = createDataUrl(item.file_path);
            return `<li class="list-item" data-id="${item.id}" data-table="${item.table}"><img src="${imageUrl}" alt="${item.title}" loading="lazy"></li>`
        }

        return `
            <li class="list-item ${isTodoList ? 'todo-item' : ''}" data-id="${item.id}" data-table="${item.table}">
                <div class="item-title ${titleClass}">
                    ${prefix}
                    <span>${item.title}</span>
                </div>
                <div class="item-meta">
                    ${isRecentView ? `<span class="item-type-label">${label}</span>` : ''}
                </div>
            </li>`;
    }).join('');
    list.insertAdjacentHTML('beforeend', itemsHtml);

    if (loader) {
        if (items.length < 20) {
            loader.remove();
        } else {
            loader.textContent = 'Loading...';
        }
    }
}

export async function renderObject(table, id) {
    console.log(`Rendering object view for: ${table}:${id}`);
    window.dashy.appState.currentView = { type: 'object', table, id };
    document.getElementById('add-new-button').classList.add('hidden');
    document.querySelectorAll('#bottom-nav .nav-btn').forEach(b => b.classList.remove('active'));


    clearHighlight();

    if (window.dashy.appState.markers[id]) {
        highlightMarker(window.dashy.appState.markers[id]);
        window.dashy.appState.map.flyTo(window.dashy.appState.markers[id].getLatLng(), 15);
    } else {
        const objectForMap = await api.getObject(table, id);
        const linkedPlace = objectForMap.links.find(l => l.table === 'places');
        if (linkedPlace && window.dashy.appState.markers[linkedPlace.id]) {
            highlightMarker(window.dashy.appState.markers[linkedPlace.id]);
            window.dashy.appState.map.flyTo(window.dashy.appState.markers[linkedPlace.id].getLatLng(), 15);
        }
    }

    contentPanel.innerHTML = '<div class="loader">Loading...</div>';
    try {
        const object = await api.getObject(table, id);

        const links = object.links;
        const groupedLinks = { todos: [], images: [], notes: [], files: [], people: [], custom_objects: [], places: [] };
        links.forEach(link => {
            if (groupedLinks[link.table]) {
                groupedLinks[link.table].push(link);
            }
        });

        const sectionOrder = ['todos', 'images', 'notes', 'files', 'people', 'custom_objects', 'places'];
        let groupedLinksHtml = '';

        sectionOrder.forEach(sectionKey => {
            const items = groupedLinks[sectionKey];
            if (items.length === 0) return;

            const sectionTitle = formatIdString(sectionKey);
            let sectionContent = '';

            if (sectionKey === 'todos') {
                items.sort((a, b) => a.status - b.status); // Incomplete (0) first
                const incomplete = items.filter(t => t.status === 0);
                const complete = items.filter(t => t.status === 1);

                const renderTodo = (todo) => `<li class="link-item" data-id="${todo.id}" data-table="${todo.table}"><span class="link-title ${todo.status === 1 ? 'completed' : ''}"><i class="fas fa-check-square"></i> <span>${todo.title}</span></span><button class="unlink-btn action-button" title="Unlink Item"><i class="fas fa-times"></i></button></li>`;

                let listHtml = incomplete.map(renderTodo).join('');
                if (complete.length > 0) {
                    const completedContainerClass = complete.length > 5 ? 'completed-todos-container hidden' : 'completed-todos-container';
                    listHtml += `<div class="${completedContainerClass}">${complete.map(renderTodo).join('')}</div>`;
                    if (complete.length > 5) {
                        listHtml += `<button class="show-completed-todos-btn button">${`Display ${complete.length} complete element` + (complete.length > 1 ? 's' : '')}</button>`;
                    }
                }
                sectionContent = `<ul class="links-list">${listHtml}</ul>`;

            } else if (sectionKey === 'images') {
                const imageItemsHtml = items.map(l =>
                    `<li class="link-item" data-id="${l.id}" data-table="${l.table}">
                        <img src="${createDataUrl(l.file_path)}" alt="${l.title}" loading="lazy">
                        <button class="unlink-btn action-button" title="Unlink Item"><i class="fas fa-times"></i></button>
                    </li>`
                ).join('');
                sectionContent = `<ul class="links-list image-grid">${imageItemsHtml}</ul>`;

            } else if (sectionKey === 'notes') {
                const notesHtml = items.map(l =>
                    `<li class="link-item note-display-item" data-id="${l.id}" data-table="${l.table}">
                        <div class="note-display-header">
                            <span class="link-title"><i class="fas ${getIconForTable(l.table)}"></i> <span>${l.title}</span></span>
                            <button class="unlink-btn action-button" title="Unlink Item"><i class="fas fa-times"></i></button>
                        </div>
                        <div class="note-display-content">${l.content || ''}</div>
                    </li>`
                ).join('');
                sectionContent = `<ul class="links-list">${notesHtml}</ul>`;

            } else {
                const itemsHtml = items.map(l =>
                    `<li class="link-item" data-id="${l.id}" data-table="${l.table}">
                        <span class="link-title"><i class="fas ${getIconForTable(l.table)}"></i> <span>${l.title}</span></span>
                        <button class="unlink-btn action-button" title="Unlink Item"><i class="fas fa-times"></i></button>
                    </li>`
                ).join('');
                sectionContent = `<ul class="links-list">${itemsHtml}</ul>`;
            }

            groupedLinksHtml += `
                <div class="section link-section">
                    <div class="section-header"><h3><i class="fas ${getIconForTable(sectionKey)}"></i> ${sectionTitle}</h3></div>
                    ${sectionContent}
                </div>
            `;
        });

        let detailsHtml = '';
        let headerClass = '';

        if (table === 'todos') {
            headerClass = object.status === 1 ? 'completed' : '';
            const isComplete = object.status === 1;
            detailsHtml += `
                <button 
                    class="button todo-status-button ${isComplete ? 'complete' : 'incomplete'}" 
                    data-id="${object.id}" 
                    data-current-status="${object.status}">
                    <i class="fas ${isComplete ? 'fa-check-circle' : 'fa-times-circle'}"></i>
                    <span>${isComplete ? 'Complete' : 'Incomplete'}</span>
                </button>`;
        }

        if (table === 'notes') {
            detailsHtml += `<div class="editable note-content-display" data-field="content" data-edit-type="textarea">${object.content || 'Click to add content...'}</div>`;
        }

        const kvHtml = object.key_values.map(kv => `<li data-kv-id="${kv.id}" data-original-key="${kv.key}"><span class="key">${formatIdString(kv.key)}</span><span class="value">${kv.value}</span><div class="actions"><button class="edit-kv-button action-button"><i class="fas fa-pencil-alt"></i></button><button class="delete-kv-button action-button"><i class="fas fa-trash"></i></button></div></li>`).join('');
        const objectTypeDisplay = (table === 'custom_objects' && object.object_type) ? `<span class="object-type-display">${formatIdString(object.object_type)}</span>` : '';
        const imagePreview = (table === 'images') ? `<img src="${createDataUrl(object.file_path)}" class="image-preview" alt="${object.title}">` : '';
        const downloadLink = (table === 'files') ? `<a href="${createDataUrl(object.file_path)}" download="${object.title}" class="button"><i class="fas fa-download"></i> Download</a>` : '';

        const headerActionsHtml = `
            <div class="header-actions" style="display:flex; gap:0.5rem;">
                 ${downloadLink}
                 <button class="delete-object-btn button button-danger" title="Delete Object"><i class="fas fa-trash"></i></button>
            </div>`;


        contentPanel.innerHTML = `
            <div class="object-view" data-id="${id}" data-table="${table}">
                <div class="object-view-header">
                    <h2 class="${headerClass}">
                        <i class="fas ${getIconForTable(table)}"></i> 
                        <span class="editable" data-field="title" data-edit-type="input">${object.title}</span>
                        ${objectTypeDisplay}
                    </h2>
                    ${headerActionsHtml}
                </div>

                ${imagePreview}
                
                <div class="section">
                    <div class="section-header">
                        <h3><i class="fas fa-list-ul"></i> Details</h3>
                        <button class="add-kv-button button"><i class="fas fa-plus"></i></button>
                    </div>
                    ${detailsHtml ? `<div style="margin-bottom: 1.5rem;">${detailsHtml}</div>` : ''}
                    <ul class="kv-list">${kvHtml}</ul>
                </div>
                
                ${groupedLinksHtml}

                <div class="section">
                    ${renderAddLinkForm()}
                </div>
            </div>`;
    } catch (error) {
        console.error(`Error rendering object ${table}:${id}`, error);
        contentPanel.innerHTML = `<p>Error loading item.</p>`;
    }
}