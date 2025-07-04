const api = window.electronAPI;

// --- Core App API ---
export async function checkInitStatus() {
    return api.invoke('app:init-check');
}

export async function setDataPath(path) {
    return api.invoke('app:set-data-path', path);
}

export async function getSettings() {
    return api.invoke('app:get-settings');
}

export async function changeDataPath() {
    return api.invoke('app:change-data-path');
}

export async function selectFiles(options) {
    return api.invoke('dialog:open-files', options);
}

export async function openDataPath() {
    return api.invoke('shell:open-path');
}

export async function showItemInFolder(filePath) {
    return api.invoke('shell:show-item-in-folder', filePath);
}

// --- Data API ---
export async function getBootstrapData() {
    return api.invoke('get:bootstrap');
}

export async function getObject(table, id) {
    return api.invoke('get:object', { table, id });
}

export async function getObjectsList(table, { limit = 20, offset = 0, filters = {} } = {}) {
    if (table === 'recent') {
        return api.invoke('get:recent', { limit, offset });
    }
    return api.invoke('get:objects', { table, limit, offset, filters });
}

export async function getCustomObjectTypes() {
    return api.invoke('get:custom-object-types');
}

export async function getKvKeys() {
    return api.invoke('get:kv-keys');
}

export async function createObject(type, formData) {
    const data = Object.fromEntries(formData.entries());

    const kvKeys = formData.getAll('kv_key');
    const kvValues = formData.getAll('kv_value');
    if (kvKeys.length > 0) {
        data.key_values = {};
        kvKeys.forEach((key, index) => {
            if (key) data.key_values[key] = kvValues[index];
        });
        delete data.kv_key;
        delete data.kv_value;
    }

    if (data.filePaths && typeof data.filePaths === 'string') {
        try {
            data.filePaths = JSON.parse(data.filePaths);
        } catch (e) {
            console.error("Failed to parse filePaths JSON string:", e);
            data.filePaths = [];
        }
    }

    return api.invoke('create:object', { type, data });
}

export async function searchObjects(term, limit = 10) {
    if (term.length < 2) return Promise.resolve([]);
    return api.invoke('search:objects', { term, limit });
}

export async function updateObject(table, id, field, value) {
    return api.invoke('update:object', { table, id, field, value });
}

export async function unlinkObjects(source, target) {
    return api.invoke('unlink:objects', {
        source_id: source.id, source_table: source.table,
        target_id: target.id, target_table: target.table,
    });
}

export async function deleteObject(table, id) {
    return api.invoke('delete:object', { table, id });
}

export async function post(path, data) {
    const channelMap = {
        '/unlink': 'unlink:objects',
        '/link': 'link:objects'
    };
    const channel = channelMap[path];
    if (channel) {
        return api.invoke(channel, data);
    }
    if (path.match(/\/object\/(.*?)\/(.*?)\/kv/)) {
        const [, table, id] = path.match(/\/object\/(.*?)\/(.*?)\/kv/);
        return api.invoke('add:kv', { table, id, ...data });
    }
    throw new Error(`Unknown API POST path: ${path}`);
}

export async function patch(path, data) {
    if (path.match(/\/object\/(.*?)\/(.*?)/)) {
        const [, table, id] = path.match(/\/object\/(.*?)\/(.*?)/);
        return api.invoke('update:object', { table, id, ...data });
    }
    if (path.match(/\/kv\/(\d+)/)) {
        const [, id] = path.match(/\/kv\/(\d+)/);
        return api.invoke('update:kv', { id, ...data });
    }
    throw new Error(`Unknown API PATCH path: ${path}`);
}

export async function del(path) {
    if (path.match(/\/object\/(.*?)\/(.*?)/)) {
        const [, table, id] = path.match(/\/object\/(.*?)\/(.*?)/);
        return api.invoke('delete:object', { table, id });
    }
    if (path.match(/\/kv\/(\d+)/)) {
        const [, id] = path.match(/\/kv\/(\d+)/);
        return api.invoke('delete:kv', { id });
    }
    throw new Error(`Unknown API DELETE path: ${path}`);
}