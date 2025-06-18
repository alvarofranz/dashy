const handleResponse = async (response) => {
    if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'An unknown error occurred' }));
        throw new Error(error.error || `HTTP error! status: ${response.status}`);
    }
    return response.json();
};

export async function post(path, data) {
    return fetch(`/api${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
    }).then(handleResponse);
}

export async function patch(path, data) {
    return fetch(`/api${path}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
    }).then(handleResponse);
}

export async function del(path) {
    return fetch(`/api${path}`, {
        method: 'DELETE'
    }).then(handleResponse);
}

export async function getBootstrapData() {
    return fetch('/api/bootstrap').then(handleResponse);
}

export async function getObject(table, id) {
    return fetch(`/api/object/${table}/${id}`).then(handleResponse);
}

export async function getObjectsList(table, { limit = 20, offset = 0, filters = {} } = {}) {
    let url;
    if (table === 'recent') {
        url = `/api/recent?limit=${limit}&offset=${offset}`;
    } else {
        url = `/api/objects/${table}?limit=${limit}&offset=${offset}`;
        if (filters.types && filters.types.length > 0) {
            url += `&types=${encodeURIComponent(JSON.stringify(filters.types))}`;
        }
    }
    return fetch(url).then(handleResponse);
}

export async function getCustomObjectTypes() {
    return fetch('/api/custom-object-types').then(handleResponse);
}

export async function createObject(type, formData) {
    let body;
    let headers = {};
    if (['image', 'other_file'].includes(type)) {
        body = formData; // FormData sets its own content-type
    } else {
        const data = Object.fromEntries(formData.entries());

        // Handle multi-key for key_values
        const kvKeys = formData.getAll('kv_key');
        const kvValues = formData.getAll('kv_value');
        if (kvKeys.length > 0) {
            data.key_values = {};
            kvKeys.forEach((key, index) => {
                if (key) data.key_values[key] = kvValues[index];
            });
            // FIX: Remove raw kv fields to prevent backend error
            delete data.kv_key;
            delete data.kv_value;
        }

        body = JSON.stringify(data);
        headers['Content-Type'] = 'application/json';
    }
    return fetch(`/api/object/${type}`, { method: 'POST', headers, body }).then(handleResponse);
}

export async function searchObjects(term, limit = 10) {
    if (term.length < 2) return Promise.resolve([]);
    return fetch(`/api/search?term=${encodeURIComponent(term)}&limit=${limit}`).then(handleResponse);
}

export async function updateObject(table, id, field, value) {
    return patch(`/object/${table}/${id}`, { field, value });
}

export async function unlinkObjects(source, target) {
    return post('/unlink', {
        source_id: source.id,
        source_table: source.table,
        target_id: target.id,
        target_table: target.table,
    });
}

export async function deleteObject(table, id) {
    return del(`/object/${table}/${id}`);
}