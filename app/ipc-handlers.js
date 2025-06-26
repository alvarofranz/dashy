import { ipcMain } from 'electron';
import { getDb } from './database.js';
import { nanoid } from 'nanoid';
import path from 'path';
import fs from 'fs-extra';
import exifParser from 'exif-parser';
import sharp from 'sharp';
import heicJpgExif from 'heic-jpg-exif';

let DATA_PATH;

// --- Helper Functions (adapted from routes.js) ---
const getFullObjectDetails = async (table, id) => {
    console.log(`[IPC] Fetching full details for object '${id}' in table '${table}'`);
    const db = getDb();
    const object = await db.get(`SELECT * FROM ${table} WHERE id = ?`, id);
    if (!object) return null;

    object.key_values = await db.all('SELECT id, key, value FROM key_values WHERE object_id = ? ORDER BY id', id);

    const L1_links_raw = await db.all(`
        SELECT target_id as id, target_table as "table" FROM links WHERE source_id = ? AND source_table = ?
        UNION
        SELECT source_id as id, source_table as "table" FROM links WHERE target_id = ? AND target_table = ?
    `, id, table, id, table);

    let all_links_raw = [...L1_links_raw];
    if (L1_links_raw.length > 0) {
        const L2_links_promises = L1_links_raw.map(l1_link =>
            db.all(`
                SELECT target_id as id, target_table as "table" FROM links WHERE source_id = ? AND source_table = ?
                UNION
                SELECT source_id as id, source_table as "table" FROM links WHERE target_id = ? AND target_table = ?
            `, l1_link.id, l1_link.table, l1_link.id, l1_link.table)
        );
        const L2_links_results = await Promise.all(L2_links_promises);
        all_links_raw.push(...L2_links_results.flat());
    }

    const uniqueLinks = new Map();
    all_links_raw.forEach(link => {
        if (link.id === id && link.table === table) return;
        uniqueLinks.set(`${link.table}:${link.id}`, link);
    });
    const linkedIds = Array.from(uniqueLinks.values());

    const tableQueries = {
        places: `SELECT id, title, 'places' as "table" FROM places WHERE id = ?`,
        people: `SELECT id, title, 'people' as "table" FROM people WHERE id = ?`,
        notes: `SELECT id, title, content, 'notes' as "table" FROM notes WHERE id = ?`,
        custom_objects: `SELECT id, title, object_type, 'custom_objects' as "table" FROM custom_objects WHERE id = ?`,
        images: `SELECT id, title, 'images' as "table", file_path FROM images WHERE id = ?`,
        files: `SELECT id, title, 'files' as "table", file_path FROM files WHERE id = ?`,
        todos: `SELECT id, title, 'todos' as "table", status FROM todos WHERE id = ?`,
    };

    const linkedObjects = await Promise.all(
        linkedIds.map(link => {
            const query = tableQueries[link.table];
            return query ? db.get(query, link.id) : Promise.resolve(null);
        })
    );
    object.links = linkedObjects.filter(Boolean);
    object.table = table;
    return object;
};

const saveKeyValues = async (objectId, objectTable, keyValues) => {
    if (!keyValues) return;
    const db = getDb();
    const kvPairs = Object.entries(keyValues).filter(([k, v]) => k && v);
    for (const [key, value] of kvPairs) {
        await db.run('INSERT INTO key_values (object_id, object_table, key, value) VALUES (?, ?, ?, ?)', objectId, objectTable, key, value);
    }
};

const saveLinks = async (sourceId, sourceTable, links) => {
    if (!links || !Array.isArray(links) || links.length === 0) return;
    const db = getDb();
    for (const link of links) {
        if (!link) continue;
        const [targetTable, targetId] = link.split(':');
        if (!targetTable || !targetId || (sourceId === targetId && sourceTable === targetTable)) continue;
        console.log(`[Link] Linking ${sourceTable}:${sourceId} to ${targetTable}:${targetId}`);
        await db.run('INSERT OR IGNORE INTO links (source_id, source_table, target_id, target_table) VALUES (?, ?, ?, ?)', sourceId, sourceTable, targetId, targetTable);
    }
};

const getDistance = (lat1, lon1, lat2, lon2) => {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
};

const processImageFile = async (inputPath, originalFilename) => {
    console.log(`[Image Processing] Starting for: ${originalFilename}`);
    const inputBuffer = fs.readFileSync(inputPath);
    let finalJpegBuffer;

    try {
        const isHeic = ['.heic', '.heif'].includes(path.extname(originalFilename).toLowerCase());

        if (isHeic) {
            console.log('[Image Processing] HEIC file detected. Converting with heic-jpg-exif...');
            // This library converts HEIC to a JPEG buffer directly, preserving metadata.
            finalJpegBuffer = await heicJpgExif(inputBuffer);
            console.log('[Image Processing] HEIC converted to JPEG successfully.');
        } else {
            console.log('[Image Processing] Non-HEIC file. Normalizing with sharp...');
            // For other formats, we normalize to JPEG, ensuring metadata is kept.
            finalJpegBuffer = await sharp(inputBuffer)
                .withMetadata()
                .jpeg({ quality: 90 })
                .toBuffer();
        }

        // Now that we have a standard JPEG buffer, parse it for our app's logic.
        const parser = exifParser.create(finalJpegBuffer);
        const parsedExifResult = parser.parse();

        let gpsCoords = null;
        let fileDate = new Date();
        let title = originalFilename;

        if (parsedExifResult.tags && parsedExifResult.tags.GPSLatitude && parsedExifResult.tags.GPSLongitude) {
            gpsCoords = { lat: parsedExifResult.tags.GPSLatitude, lng: parsedExifResult.tags.GPSLongitude };
            console.log(`[Image Processing] Found GPS data:`, gpsCoords);
        }

        if (parsedExifResult.tags && parsedExifResult.tags.DateTimeOriginal) {
            fileDate = new Date(parsedExifResult.tags.DateTimeOriginal * 1000);
        } else if (parsedExifResult.tags && parsedExifResult.tags.CreateDate) {
            let dateStr = parsedExifResult.tags.CreateDate;
            let parsedDate;
            if (typeof dateStr === 'string') {
                const parts = dateStr.split(' ');
                if (parts.length > 0) parts[0] = parts[0].replace(/:/g, '-');
                dateStr = parts.join(' ');
                parsedDate = new Date(dateStr);
            } else if (typeof dateStr === 'number') {
                parsedDate = new Date(dateStr * 1000);
            }
            if (parsedDate && !isNaN(parsedDate)) fileDate = parsedDate;
        }

        const dateString = fileDate.toISOString().slice(0, 10);
        const uniqueId = nanoid(6);
        const finalExtension = '.jpg';
        title = `${path.parse(title).name}${finalExtension}`;

        const finalFilename = `${dateString}-${uniqueId}${finalExtension}`;
        const finalPath = path.join(DATA_PATH, 'images', finalFilename);
        fs.ensureDirSync(path.dirname(finalPath));

        fs.writeFileSync(finalPath, finalJpegBuffer);
        console.log(`[Image Processing] Saved final file to: ${finalPath}`);

        return { gpsCoords, finalFilename, title };

    } catch (err) {
        console.error(`[Image Processing] CRITICAL ERROR for ${originalFilename}:`, err);
        return null;
    }
};

const linkGpsData = async (imageId, gpsCoords, imageTitle) => {
    // This function remains the same as it's pure DB logic
    if (!gpsCoords) return null;
    const { lat, lng } = gpsCoords;
    const db = getDb();
    const allPlaces = await db.all('SELECT id, lat, lng FROM places');
    const closestPlace = allPlaces.reduce((closest, place) => {
        const distance = getDistance(lat, lng, place.lat, place.lng);
        if (distance < closest.minDistance) return { place, minDistance: distance };
        return closest;
    }, { place: null, minDistance: Infinity });

    const toleranceKm = 0.05; // 50 meters
    if (closestPlace.place && closestPlace.minDistance < toleranceKm) {
        await saveLinks(imageId, 'images', [`places:${closestPlace.place.id}`]);
        return null;
    } else {
        const placeId = nanoid();
        await db.run('INSERT INTO places (id, title, lat, lng) VALUES (?, ?, ?, ?)', placeId, imageTitle, lat, lng);
        await saveLinks(imageId, 'images', [`places:${placeId}`]);
        const newPlace = await db.get('SELECT * FROM places WHERE id = ?', placeId);
        newPlace.table = 'places';
        return newPlace;
    }
};


// --- IPC Handlers Registration ---
export function registerIpcHandlers(dataPath) {
    DATA_PATH = dataPath;
    const db = getDb();

    ipcMain.handle('get:recent', async (event, { limit = 20, offset = 0 }) => {
        return db.all(`
            SELECT id, title, "table", created_at, object_type, file_path, status
            FROM (
                SELECT *,
                    CASE WHEN "table" = 'todos' AND status = 0 THEN 0 ELSE 1 END as sort1,
                    CASE WHEN "table" = 'todos' AND status = 0 THEN created_at END as sort2,
                    CASE WHEN "table" != 'todos' OR status = 1 THEN created_at END as sort3
                FROM (
                    SELECT id, title, 'places' as "table", created_at, null as object_type, null as file_path, -1 as status FROM places
                    UNION ALL SELECT id, title, 'people' as "table", created_at, null as object_type, null as file_path, -1 as status FROM people
                    UNION ALL SELECT id, title, 'notes' as "table", created_at, null as object_type, null as file_path, -1 as status FROM notes
                    UNION ALL SELECT id, title, 'custom_objects' as "table", created_at, object_type, null as file_path, -1 as status FROM custom_objects
                    UNION ALL SELECT id, title, 'images' as "table", created_at, null as object_type, file_path, -1 as status FROM images
                    UNION ALL SELECT id, title, 'files' as "table", created_at, null as object_type, file_path, -1 as status FROM files
                    UNION ALL SELECT id, title, 'todos' as "table", created_at, null as object_type, null as file_path, status FROM todos
                ) as union_sub
            ) as sort_sub ORDER BY sort1 ASC, sort2 ASC, sort3 DESC LIMIT ? OFFSET ?
        `, limit, offset);
    });

    ipcMain.handle('get:bootstrap', async () => {
        const places = await db.all('SELECT id, title, lat, lng FROM places');
        const objectCountResult = await db.get(`SELECT (SELECT COUNT(id) FROM places) + (SELECT COUNT(id) FROM people) + (SELECT COUNT(id) FROM notes) + (SELECT COUNT(id) FROM custom_objects) + (SELECT COUNT(id) FROM images) + (SELECT COUNT(id) FROM files) + (SELECT COUNT(id) FROM todos) as count`);
        return { places, hasObjects: objectCountResult.count > 0 };
    });

    ipcMain.handle('get:custom-object-types', () => {
        return db.all('SELECT DISTINCT object_type FROM custom_objects ORDER BY object_type').then(types => types.map(t => t.object_type));
    });

    ipcMain.handle('get:kv-keys', () => {
        return db.all('SELECT DISTINCT key FROM key_values ORDER BY key').then(keys => keys.map(k => k.key));
    });

    ipcMain.handle('get:objects', async (event, { table, limit = 20, offset = 0, filters = {} }) => {
        let items;
        if (table === 'todos') {
            items = await db.all(`SELECT id, title, created_at, status FROM todos ORDER BY status ASC, CASE WHEN status = 0 THEN created_at END ASC, CASE WHEN status = 1 THEN created_at END DESC LIMIT ? OFFSET ?`, limit, offset);
        } else if (table === 'custom_objects') {
            const types = filters.types || [];
            let query = `SELECT id, title, created_at, object_type FROM custom_objects`;
            const params = [];
            if (types.length > 0) {
                query += ` WHERE object_type IN (${types.map(() => '?').join(',')})`;
                params.push(...types);
            }
            query += ` ORDER BY created_at DESC LIMIT ? OFFSET ?`;
            params.push(limit, offset);
            items = await db.all(query, ...params);
        } else {
            const columnsToSelect = ['id', 'title', 'created_at'];
            if (table === 'images' || table === 'files') columnsToSelect.push('file_path');
            if (table === 'notes') columnsToSelect.push('content');
            items = await db.all(`SELECT ${columnsToSelect.join(', ')} FROM ${table} ORDER BY created_at DESC LIMIT ? OFFSET ?`, limit, offset);
        }
        items.forEach(item => item.table = table);
        return items;
    });

    ipcMain.handle('get:object', (event, { table, id }) => getFullObjectDetails(table, id));

    ipcMain.handle('search:objects', (event, { term, limit = 25 }) => {
        if (!term || term.length < 3) return [];
        const query = `%${term}%`;
        return db.all(`
            SELECT id, title, 'places' as "table" FROM places WHERE title LIKE ? UNION ALL
            SELECT id, title, 'people' as "table" FROM people WHERE title LIKE ? UNION ALL
            SELECT id, title, 'notes' as "table" FROM notes WHERE title LIKE ? UNION ALL
            SELECT id, title, 'custom_objects' as "table" FROM custom_objects WHERE title LIKE ? UNION ALL
            SELECT id, title, 'images' as "table" FROM images WHERE title LIKE ? UNION ALL
            SELECT id, title, 'files' as "table" FROM files WHERE title LIKE ? UNION ALL
            SELECT id, title, 'todos' as "table" FROM todos WHERE title LIKE ?
            ORDER BY title LIMIT ?
        `, query, query, query, query, query, query, query, limit);
    });

    ipcMain.handle('create:object', async (event, { type, data }) => {
        let { links, key_values, filePaths, ...objectData } = data;
        if (typeof links === 'string') {
            try { links = JSON.parse(links); } catch(e) { links = []; }
        }

        // Handle file-based objects (image, other_file)
        if (type === 'image' || type === 'other_file') {
            const createdObjects = [];
            const isImage = type === 'image';

            for (const filePath of filePaths) {
                const originalFilename = path.basename(filePath);

                if (isImage) {
                    const processed = await processImageFile(filePath, originalFilename);
                    if (!processed) continue;

                    const { gpsCoords, finalFilename, title } = processed;
                    const id = nanoid();

                    await db.run('INSERT INTO images (id, title, file_path) VALUES (?, ?, ?)', id, title, `/images/${finalFilename}`);
                    await saveLinks(id, 'images', links);

                    if (gpsCoords) {
                        const newPlace = await linkGpsData(id, gpsCoords, title);
                        if (newPlace) createdObjects.push(newPlace);
                    }
                    const imageDetails = await getFullObjectDetails('images', id);
                    createdObjects.push(imageDetails);
                } else { // Is 'other_file'
                    const targetDir = path.join(DATA_PATH, 'files');
                    await fs.ensureDir(targetDir);
                    const finalFilename = `${new Date().toISOString().slice(0, 10)}-${nanoid(6)}${path.extname(originalFilename)}`;
                    const finalPath = path.join(targetDir, finalFilename);
                    await fs.copy(filePath, finalPath);

                    const id = nanoid();
                    await db.run('INSERT INTO files (id, title, file_path) VALUES (?, ?, ?)', id, originalFilename, `/files/${finalFilename}`);
                    await saveLinks(id, 'files', links);
                    createdObjects.push(await getFullObjectDetails('files', id));
                }
            }
            return createdObjects;
        }

        // Handle generic objects
        const tableMap = {
            place: 'places', person: 'people', note: 'notes',
            custom_object: 'custom_objects', todo: 'todos'
        };
        const table = tableMap[type];
        if (!table) throw new Error(`Invalid object type for creation: ${type}`);

        const id = nanoid();
        if (table === 'custom_objects' && objectData.object_type) {
            objectData.object_type = objectData.object_type.toLowerCase().replace(/\s+/g, '-');
        }

        const columns = Object.keys(objectData);
        const values = Object.values(objectData);

        await db.run(`INSERT INTO ${table} (id, ${columns.join(',')}) VALUES (?, ${columns.map(() => '?').join(',')})`, id, ...values);
        await saveKeyValues(id, table, key_values);
        await saveLinks(id, table, links);

        return getFullObjectDetails(table, id);
    });

    ipcMain.handle('update:object', (event, { table, id, field, value }) => {
        if (field === 'title') {
            if (!value) throw new Error(`Title field cannot be empty.`);
            return db.run(`UPDATE ${table} SET title = ? WHERE id = ?`, value, id).then(() => ({ success: true, newValue: value }));
        } else if (field === 'status' && table === 'todos') {
            const newStatus = Number(value);
            if (newStatus === undefined || ![0, 1].includes(newStatus)) throw new Error('Invalid value for status');
            return db.run(`UPDATE todos SET status = ? WHERE id = ?`, newStatus, id).then(() => ({ success: true, newValue: newStatus }));
        } else if (field === 'content' && table === 'notes') {
            return db.run(`UPDATE notes SET content = ? WHERE id = ?`, value, id).then(() => ({ success: true, newValue: value }));
        }
        throw new Error('Invalid field for patching');
    });

    ipcMain.handle('add:kv', async (event, {table, id, key, value}) => {
        const result = await db.run('INSERT INTO key_values (object_id, object_table, key, value) VALUES (?, ?, ?, ?)', id, table, key, value);
        return { id: result.lastID, key, value };
    });

    ipcMain.handle('update:kv', (event, { id, key, value }) => db.run('UPDATE key_values SET key = ?, value = ? WHERE id = ?', key, value, id).then(() => ({ success: true })));

    ipcMain.handle('delete:kv', (event, { id }) => db.run('DELETE FROM key_values WHERE id = ?', id).then(() => ({ success: true })));

    ipcMain.handle('link:objects', (event, { source_id, source_table, target_id, target_table }) => {
        return saveLinks(source_id, source_table, [`${target_table}:${target_id}`]).then(() => ({ success: true }));
    });

    ipcMain.handle('unlink:objects', (event, { source_id, source_table, target_id, target_table }) => {
        return db.run(`DELETE FROM links WHERE (source_id = ? AND source_table = ? AND target_id = ? AND target_table = ?) OR (source_id = ? AND source_table = ? AND target_id = ? AND target_table = ?)`, source_id, source_table, target_id, target_table, target_id, target_table, source_id, source_table).then(() => ({ success: true }));
    });

    ipcMain.handle('delete:object', async (event, { table, id }) => {
        if (table === 'images' || table === 'files') {
            const fileObject = await db.get(`SELECT file_path FROM ${table} WHERE id = ?`, id);
            if (fileObject) {
                const filePath = path.join(DATA_PATH, fileObject.file_path);
                if (fs.existsSync(filePath)) {
                    fs.unlinkSync(filePath);
                }
            }
        }
        await db.run(`DELETE FROM ${table} WHERE id = ?`, id);
        await db.run('DELETE FROM key_values WHERE object_id = ?', id);
        await db.run('DELETE FROM links WHERE source_id = ? OR target_id = ?', id, id);
        return { success: true };
    });
}