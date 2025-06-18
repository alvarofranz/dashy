import * as api from '../api.js';
import { contentPanel, getIconForTable, formatObjectType, highlightMarker, clearHighlight } from './helpers.js';
import { renderAddLinkForm } from './forms.js';

let isLoadingMore = false;

const listToFormTypeMap = {
    places: 'place',
    people: 'person',
    interactions: 'interaction',
    custom_objects: 'custom_object',
    images: 'image',
    other_files: 'other_file',
    todos: 'todo',
    recent: 'place' // Default for dashboard 'Add New'
};

export function renderWelcomeMessage() {
    window.dashy.appState.currentView = { type: 'welcome' };
    contentPanel.innerHTML = `
        <div class="welcome-message">
            <i class="fas fa-meteor"></i>
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

export async function renderListView(type, offset = 0) {
    console.log(`Rendering list view for: ${type}`);
    window.dashy.appState.currentView = { type: 'list', listType: type, offset: 0, hasMore: true };

    const addNewButton = document.getElementById('add-new-button');
    const formType = listToFormTypeMap[type] || type;
    addNewButton.dataset.type = formType;
    addNewButton.querySelector('span').textContent = `Add New ${formatObjectType(formType)}`;
    addNewButton.classList.remove('hidden');

    clearHighlight();

    const listTitle = (type === 'recent') ? 'Recent Items' : formatObjectType(type);
    contentPanel.innerHTML = `<div class="list-view-header"><h2><i class="fas ${getIconForTable(type)}"></i> ${listTitle}</h2></div><ul class="items-list-view"></ul><div class="loader">Loading...</div>`;
    try {
        const items = await api.getObjectsList(type);
        appendItemsToListView(items, type);
    } catch (error) {
        console.error(`Error fetching list view for ${type}:`, error);
        contentPanel.innerHTML = `<p>Error loading items.</p>`;
    }
}

export async function loadMoreItems() {
    const { listType, offset, hasMore } = window.dashy.appState.currentView;
    if (isLoadingMore || !hasMore) return;

    isLoadingMore = true;
    const newOffset = offset + 20;
    try {
        const items = await api.getObjectsList(listType, { offset: newOffset });
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
        let label = isRecentView ? formatObjectType(item.table) : '';
        if (item.table === 'custom_objects' && item.object_type) {
            label = formatObjectType(item.object_type);
        }

        let prefix = `<i class="fas ${getIconForTable(item.table)} fa-fw"></i>`;
        let titleClass = '';

        if (isTodoList) {
            const isChecked = item.status === 1;
            prefix = `<div class="todo-list-status"><input type="checkbox" id="todo-list-item-${item.id}" data-id="${item.id}" ${isChecked ? 'checked' : ''}></div>`;
            titleClass = isChecked ? 'completed' : '';
        }

        if(isImageView) {
            return `<li class="list-item" data-id="${item.id}" data-table="${item.table}"><img src="/data${item.file_path}" alt="${item.title}" loading="lazy"></li>`
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
    clearHighlight();

    if (window.dashy.appState.markers[id]) {
        highlightMarker(window.dashy.appState.markers[id]);
        window.dashy.appState.map.flyTo(window.dashy.appState.markers[id].getLatLng(), 15);
    } else {
        const objectData = await api.getObject(table, id);
        const linkedPlace = objectData.links.find(l => l.table === 'places');
        if (linkedPlace && window.dashy.appState.markers[linkedPlace.id]) {
            highlightMarker(window.dashy.appState.markers[linkedPlace.id]);
            window.dashy.appState.map.flyTo(window.dashy.appState.markers[linkedPlace.id].getLatLng(), 15);
        }
    }

    contentPanel.innerHTML = '<div class="loader">Loading...</div>';
    try {
        const object = await api.getObject(table, id);

        // --- Start: Grouped Links Rendering ---
        const links = object.links;
        const groupedLinks = { todos: [], images: [], other_files: [], people: [], interactions: [], custom_objects: [], places: [] };
        links.forEach(link => {
            if (groupedLinks[link.table]) {
                groupedLinks[link.table].push(link);
            }
        });

        const sectionOrder = ['todos', 'images', 'other_files', 'people', 'interactions', 'custom_objects', 'places'];
        let groupedLinksHtml = '';

        sectionOrder.forEach(sectionKey => {
            const items = groupedLinks[sectionKey];
            if (items.length === 0) return;

            const sectionTitle = formatObjectType(sectionKey);
            let sectionContent = '';

            if (sectionKey === 'todos') {
                items.sort((a, b) => a.status - b.status); // Incomplete (0) first
                const incomplete = items.filter(t => t.status === 0);
                const complete = items.filter(t => t.status === 1);

                const renderTodo = (todo) => `<li class="link-item" data-id="${todo.id}" data-table="${todo.table}"><span class="link-title ${todo.status === 1 ? 'completed' : ''}"><i class="fas fa-check-square"></i> <span>${todo.title}</span></span><button class="unlink-btn action-button" title="Unlink Item"><i class="fas fa-times"></i></button></li>`;

                let listHtml = incomplete.map(renderTodo).join('');
                if (complete.length > 0) {
                    listHtml += `<div class="completed-todos-container hidden">${complete.map(renderTodo).join('')}</div>`;
                    listHtml += `<button class="show-completed-todos-btn button">${`Display ${complete.length} complete element` + (complete.length > 1 ? 's' : '')}</button>`;
                }
                sectionContent = `<ul class="links-list">${listHtml}</ul>`;

            } else if (sectionKey === 'images') {
                const imageItemsHtml = items.map(l =>
                    `<li class="link-item" data-id="${l.id}" data-table="${l.table}">
                        <img src="/data${l.file_path}" alt="${l.title}" loading="lazy">
                        <button class="unlink-btn action-button" title="Unlink Item"><i class="fas fa-times"></i></button>
                    </li>`
                ).join('');
                sectionContent = `<ul class="links-list image-grid">${imageItemsHtml}</ul>`;

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
        // --- End: Grouped Links Rendering ---

        let detailsHtml = '';
        let headerClass = '';

        if (table === 'interactions' || table === 'custom_objects') {
            const moodPercentage = (object.mood + 100) / 2;
            detailsHtml += `<div class="detail-item"><i class="fas fa-heart"></i> Mood <div class="mood-bar"><div class="thumb" style="transform: scaleX(${moodPercentage / 100});"></div></div></div>`;
        }
        if (table === 'interactions') {
            detailsHtml += `<div class="detail-item"><i class="fas fa-calendar-alt"></i> ${object.interaction_date}</div>`;
        }
        if (table === 'todos') {
            headerClass = object.status ? 'completed' : '';
            detailsHtml += `<div class="detail-item todo-status-toggle">
                <input type="checkbox" id="todo-status" data-id="${object.id}" ${object.status ? 'checked' : ''}>
                <label for="todo-status">${object.status ? 'Complete' : 'Incomplete'}</label>
            </div>`;
        }

        const kvHtml = object.key_values.map(kv => `<li data-kv-id="${kv.id}"><span class="key">${kv.key}</span><span class="value">${kv.value}</span><div class="actions"><button class="edit-kv-button action-button"><i class="fas fa-pencil-alt"></i></button><button class="delete-kv-button action-button"><i class="fas fa-trash"></i></button></div></li>`).join('');
        const objectTypeDisplay = (table === 'custom_objects' && object.object_type) ? `<span class="object-type-display">${formatObjectType(object.object_type)}</span>` : '';
        const imagePreview = (table === 'images') ? `<img src="/data${object.file_path}" class="image-preview" alt="${object.title}">` : '';

        contentPanel.innerHTML = `
            <div class="object-view" data-id="${id}" data-table="${table}">
                <div class="object-view-header">
                    <h2 class="${headerClass}"><i class="fas ${getIconForTable(table)}"></i> <span class="editable-title">${object.title}</span>${objectTypeDisplay}</h2>
                    <button class="delete-object-btn button button-danger" title="Delete Object"><i class="fas fa-trash"></i></button>
                </div>

                ${imagePreview}
                ${detailsHtml}

                <div class="section">
                    <div class="section-header"><h3><i class="fas fa-link"></i> Linked Items</h3></div>
                    ${groupedLinksHtml.length > 0 ? groupedLinksHtml : '<p class="text-secondary">No linked items found.</p>'}
                    ${renderAddLinkForm()}
                </div>

                <div class="section">
                    <div class="section-header"><h3><i class="fas fa-list-ul"></i> Details</h3><button class="add-kv-button button"><i class="fas fa-plus"></i></button></div>
                    <ul class="kv-list">${kvHtml}</ul>
                </div>
            </div>`;
    } catch (error) {
        console.error(`Error rendering object ${table}:${id}`, error);
        contentPanel.innerHTML = `<p>Error loading item.</p>`;
    }
}