import * as api from '../api.js';
import { contentPanel, getIconForTable, formatObjectType, highlightMarker, clearHighlight } from './helpers.js';
import { renderAddLinkForm } from './forms.js';
import { removeTempMarker } from '../main.js';

/**
 * Renders the detailed view of a single object.
 * @param {string} table The table name for the object type.
 * @param {string} id The ID of the object.
 */
export async function renderObject(table, id) {
    try {
        const object = await api.getObject(table, id);
        window.dashy.appState.currentView = { type: 'object', table: table, id: id };
        document.getElementById('add-new-button').classList.add('hidden');
        document.querySelectorAll('#bottom-nav .nav-btn').forEach(b => b.classList.remove('active'));

        let headerTitleHtml = `<span class="editable-title">${object.title}</span>`;
        if (object.object_type) {
            headerTitleHtml += `<span class="object-type-display">${formatObjectType(object.object_type)}</span>`;
        }

        let mainContentHtml = '';
        if (object.table === 'images' && object.file_path) {
            // FIX: Correctly construct the image src path
            mainContentHtml += `<img src="/data${object.file_path}" class="image-preview" alt="${object.title}">`;
        }
        if (object.table === 'other_files' && object.file_path) {
            // FIX: Correctly construct the file href path
            mainContentHtml += `<div class="detail-item"><i class="fas fa-link"></i> <a href="/data${object.file_path}" target="_blank" rel="noopener noreferrer">Download File</a></div>`;
        }

        if (object.interaction_date) {
            mainContentHtml += `<div class="detail-item"><i class="far fa-calendar-alt"></i> ${new Date(object.interaction_date).toLocaleDateString(undefined, { timeZone: 'UTC', year: 'numeric', month: 'long', day: 'numeric' })}</div>`;
        }

        if (typeof object.mood === 'number') {
            const moodPercentage = (object.mood + 100) / 2;
            mainContentHtml += `<div class="detail-item"><i class="far fa-smile-beam"></i> Mood: <div class="mood-bar"><div class="thumb" style="width:${moodPercentage}%"></div></div></div>`;
        }

        const kvListHtml = object.key_values.map(kv => `
            <li data-kv-id="${kv.id}">
                <span class="key">${kv.key}</span>
                <span class="value">${kv.value}</span>
                <div class="actions">
                    <button class="edit-kv-button action-button" title="Edit Detail"><i class="fas fa-pencil-alt"></i></button>
                    <button class="delete-kv-button action-button" title="Delete Detail"><i class="fas fa-trash"></i></button>
                </div>
            </li>`).join('');

        const linksListHtml = object.links.map(link => `
            <li class="link-item" data-id="${link.id}" data-table="${link.table}">
                <span class="link-title"><i class="fas ${getIconForTable(link.table)}"></i> ${link.title}</span>
                <button class="unlink-btn action-button" title="Unlink Item"><i class="fas fa-times"></i></button>
            </li>`).join('');

        contentPanel.innerHTML = `
            <div class="object-view" data-id="${id}" data-table="${table}">
                <div class="object-view-header">
                    <h2>
                        <i class="fas ${getIconForTable(table)}"></i>
                        <div style="flex-grow:1;">${headerTitleHtml}</div>
                    </h2>
                    <button class="delete-object-btn button button-danger" title="Delete Object"><i class="fas fa-trash"></i></button>
                </div>
                
                ${mainContentHtml}
                
                <div class="section">
                    <div class="section-header"><h3><i class="fas fa-list-ul"></i> Details</h3> <button class="add-kv-button button"><i class="fas fa-plus"></i> Add</button></div>
                    <ul class="kv-list">${kvListHtml}</ul>
                </div>
                
                <div class="section">
                    <div class="section-header"><h3><i class="fas fa-link"></i> Links</h3></div>
                    <ul class="links-list">${linksListHtml}</ul>
                    ${renderAddLinkForm()}
                </div>
            </div>`;

        // Map interaction
        clearHighlight();
        removeTempMarker();
        if (table === 'places') {
            window.dashy.appState.map.flyTo([object.lat, object.lng], 15);
            if (window.dashy.appState.markers[id]) {
                highlightMarker(window.dashy.appState.markers[id]);
            }
        } else if (object.links) {
            const placeLink = object.links.find(l => l.table === 'places');
            if (placeLink) {
                api.getObject('places', placeLink.id).then(place => {
                    window.dashy.appState.map.flyTo([place.lat, place.lng], 15);
                    if (window.dashy.appState.markers[place.id]) {
                        highlightMarker(window.dashy.appState.markers[place.id]);
                    }
                });
            }
        }
    } catch (error) {
        console.error("Error rendering object:", error);
        contentPanel.innerHTML = `<div class="welcome-message"><p>Could not load object. It may have been deleted.</p></div>`;
    }
}

/**
 * Renders the list view for a given object type (e.g., 'places').
 * @param {string} type The plural type of object to list.
 */
export async function renderListView(type) {
    window.dashy.appState.currentView = { type: 'list', listType: type, offset: 0, canLoadMore: true };

    let singularType = type.endsWith('s') ? type.slice(0, -1) : type;
    if (type === 'other_files') singularType = 'other_file';
    if (type === 'people') singularType = 'person';

    const title = formatObjectType(type);
    const addNewBtn = document.getElementById('add-new-button');
    addNewBtn.innerHTML = `<i class="fas fa-plus"></i> <span>Add New ${formatObjectType(singularType)}</span>`;
    addNewBtn.dataset.type = singularType;
    addNewBtn.classList.remove('hidden');

    contentPanel.innerHTML = `
        <div class="list-view-header">
            <h2><i class="fas ${getIconForTable(type)}"></i> ${title}</h2>
        </div>
        <ul class="items-list-view" id="items-list"></ul>
        <div id="list-loader" class="hidden" style="text-align:center; padding: 1rem;">Loading...</div>`;

    await loadMoreItems();
}

/** Renders the main dashboard view with recent items. */
export async function renderDashboardView() {
    document.getElementById('add-new-button').classList.add('hidden');
    document.querySelectorAll('#bottom-nav .nav-btn').forEach(b => b.classList.remove('active'));
    document.querySelector('.nav-btn[data-type="dashboard"]').classList.add('active');

    window.dashy.appState.currentView = { type: 'list', listType: 'recent', offset: 0, canLoadMore: true };

    contentPanel.innerHTML = `
        <div class="list-view-header">
            <h2><i class="fas fa-home"></i> Dashboard</h2>
        </div>
        <ul class="items-list-view" id="items-list"></ul>
        <div id="list-loader" class="hidden" style="text-align:center; padding: 1rem;">Loading...</div>`;

    await loadMoreItems();
}

/** Fetches and appends more items for infinite scrolling lists. */
export async function loadMoreItems() {
    if (!window.dashy.appState.currentView?.canLoadMore) return;

    const { listType, offset } = window.dashy.appState.currentView;
    const loader = document.getElementById('list-loader');
    loader.classList.remove('hidden');

    try {
        const items = await api.getObjectsList(listType, { offset });
        loader.classList.add('hidden');

        if (items.length === 0) {
            window.dashy.appState.currentView.canLoadMore = false;
            if (offset === 0) {
                document.getElementById('items-list').innerHTML = '<p class="text-secondary" style="text-align:center; margin-top: 2rem;">No items to show.</p>';
            }
            return;
        }

        window.dashy.appState.currentView.offset += items.length;
        const listEl = document.getElementById('items-list');

        const isImageGrid = listType === 'images';
        if (isImageGrid && listEl && !listEl.classList.contains('image-grid')) {
            listEl.classList.add('image-grid');
        }

        const itemsHtml = items.map(item => {
            const itemDate = new Date(item.created_at).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
            const table = item.table || listType;

            if (isImageGrid) {
                return `<li class="list-item" data-table="${table}" data-id="${item.id}" title="${item.title} - ${itemDate}">
                            <img src="/data${item.file_path}" alt="${item.title}" loading="lazy">
                        </li>`;
            }

            return `
                <li class="list-item" data-table="${table}" data-id="${item.id}">
                    <span class="item-title">
                        <i class="fas ${getIconForTable(table)}"></i>
                        ${item.title}
                        ${listType === 'recent' ? `<span class="item-type-label">${formatObjectType(table)}</span>` : ''}
                    </span>
                    <span class="list-item-time">${itemDate}</span>
                </li>`;
        }).join('');

        listEl.insertAdjacentHTML('beforeend', itemsHtml);
    } catch (error) {
        console.error("Failed to load more items:", error);
        loader.innerHTML = "Failed to load items.";
    }
}

/** Renders the initial welcome message if no objects exist in the database. */
export function renderWelcomeMessage() {
    document.getElementById('add-new-button').classList.add('hidden');
    contentPanel.innerHTML = `
        <div class="welcome-message">
            <i class="far fa-paper-plane"></i>
            <h2>Welcome to Dashy!</h2>
            <p>This is your personal life dashboard. To get started, try adding your first item, like a Place you've visited or a Person you know, using the navigation below.</p>
        </div>`;
}