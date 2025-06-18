import { Router } from 'express';
import { getDb } from './database.js';
import { nanoid } from 'nanoid';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import exifParser from 'exif-parser';
import sharp from 'sharp';

const router = Router();
const upload = multer({ dest: 'data/temp/' });

// --- Helper Functions ---
const getFullObjectDetails = async (table, id) => {
    console.log(`[API] Fetching full details for object '${id}' in table '${table}'`);
    const db = getDb();
    const object = await db.get(`SELECT * FROM ${table} WHERE id = ?`, id);
    if (!object) return null;

    object.key_values = await db.all('SELECT id, key, value FROM key_values WHERE object_id = ? ORDER BY id', id);

    // --- Start: Two-Level Link Fetching ---

    // Get Level 1 links
    const L1_links_raw = await db.all(`
        SELECT target_id as id, target_table as "table" FROM links WHERE source_id = ? AND source_table = ?
        UNION
        SELECT source_id as id, source_table as "table" FROM links WHERE target_id = ? AND target_table = ?
    `, id, table, id, table);

    let all_links_raw = [...L1_links_raw];

    // Get Level 2 links (links of level 1 links)
    if (L1_links_raw.length > 0) {
        // Note: SQLite tuple IN clause support `(col1, col2) IN ((?), (?))` is tricky with node-sqlite.
        // We will fetch them iteratively, which is safe and compatible.
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

    // De-duplicate and filter out the original object itself
    const uniqueLinks = new Map();
    all_links_raw.forEach(link => {
        if (link.id === id && link.table === table) return; // Exclude the main object
        uniqueLinks.set(`${link.table}:${link.id}`, link);
    });
    const linkedIds = Array.from(uniqueLinks.values());

    // --- End: Two-Level Link Fetching ---

    // Now fetch details for all unique links
    const tableQueries = {
        places: `SELECT id, title, 'places' as "table" FROM places WHERE id = ?`,
        people: `SELECT id, title, 'people' as "table" FROM people WHERE id = ?`,
        interactions: `SELECT id, title, 'interactions' as "table" FROM interactions WHERE id = ?`,
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
        if(!link) continue;
        const [targetTable, targetId] = link.split(':');
        if (!targetTable || !targetId || (sourceId === targetId && sourceTable === targetTable)) continue;
        console.log(`[Link] Linking ${sourceTable}:${sourceId} to ${targetTable}:${targetId}`);
        await db.run('INSERT OR IGNORE INTO links (source_id, source_table, target_id, target_table) VALUES (?, ?, ?, ?)', sourceId, sourceTable, targetId, targetTable);
    }
};

// --- GPS & HEIC Processing ---
const getDistance = (lat1, lon1, lat2, lon2) => {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

const processImageFile = async (file) => {
    console.log(`[Image Processing] Starting for: ${file.originalname}`);
    const inputPath = path.resolve(file.path);
    const inputBuffer = fs.readFileSync(inputPath);
    let gpsCoords = null;
    let fileDate = new Date();
    let finalFilename;
    let title = file.originalname;

    try {
        const jpegBuffer = await sharp(inputBuffer)
            .withMetadata()
            .jpeg({ quality: 90 })
            .toBuffer();
        console.log(`[Image Processing] Successfully converted '${file.originalname}' to JPEG buffer with Sharp.`);

        const parser = exifParser.create(jpegBuffer);
        const result = parser.parse();
        console.log('[Image Processing] EXIF data found in converted JPEG:', result.tags);

        if (result.tags && result.tags.DateTimeOriginal) {
            fileDate = new Date(result.tags.DateTimeOriginal * 1000);
            console.log(`[Image Processing] Parsed DateTimeOriginal: ${fileDate.toISOString()}`);
        } else if (result.tags && result.tags.CreateDate) {
            let dateStr = result.tags.CreateDate;
            let parsedDate;
            if (typeof dateStr === 'string') {
                const parts = dateStr.split(' ');
                if (parts.length > 0) parts[0] = parts[0].replace(/:/g, '-');
                dateStr = parts.join(' ');
                parsedDate = new Date(dateStr);
            } else if (typeof dateStr === 'number') {
                parsedDate = new Date(dateStr * 1000);
            }
            if (parsedDate && !isNaN(parsedDate)) {
                fileDate = parsedDate;
                console.log(`[Image Processing] Parsed CreateDate: ${fileDate.toISOString()}`);
            }
        } else {
            console.log('[Image Processing] No date tag found. Using current date.');
        }

        if (result.tags && result.tags.GPSLatitude && result.tags.GPSLongitude) {
            gpsCoords = { lat: result.tags.GPSLatitude, lng: result.tags.GPSLongitude };
            console.log('[Image Processing] Parsed GPS Coords:', gpsCoords);
        } else {
            console.log('[Image Processing] No GPS tags found.');
        }

        const dateString = fileDate.toISOString().slice(0, 10);
        const uniqueId = nanoid(6);
        const finalExtension = '.jpg';

        if (path.extname(title).toLowerCase() !== finalExtension) {
            title = `${path.parse(title).name}${finalExtension}`;
        }

        finalFilename = `${dateString}-${uniqueId}${finalExtension}`;
        const finalPath = path.resolve(`./data/images/${finalFilename}`);
        fs.writeFileSync(finalPath, jpegBuffer);
        console.log(`[Image Processing] Saved final file to: ${finalPath}`);
    } catch (err) {
        console.error(`[Image Processing] Error during Sharp/EXIF processing for ${file.originalname}:`, err.message);
        fs.unlinkSync(inputPath);
        return null;
    }

    fs.unlinkSync(inputPath);
    return { gpsCoords, finalFilename, title };
};

const linkGpsData = async (imageId, gpsCoords, imageTitle) => {
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
        console.log(`[GPS Linking] Linked image ${imageId} to existing place ${closestPlace.place.id}`);
        return null;
    } else {
        const placeId = nanoid();
        await db.run('INSERT INTO places (id, title, lat, lng) VALUES (?, ?, ?, ?)', placeId, imageTitle, lat, lng);
        await saveLinks(imageId, 'images', [`places:${placeId}`]);
        const newPlace = await db.get('SELECT * FROM places WHERE id = ?', placeId);
        newPlace.table = 'places';
        console.log(`[GPS Linking] Created new place ${placeId} for image ${imageId}`);
        return newPlace;
    }
};

// --- API Routes ---
router.get('/recent', async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 20;
        const offset = parseInt(req.query.offset) || 0;
        const db = getDb();

        const results = await db.all(`
            SELECT id, title, "table", created_at, object_type, file_path, status
            FROM (
                SELECT
                    *,
                    CASE WHEN "table" = 'todos' AND status = 0 THEN 0 ELSE 1 END as sort1,
                    CASE WHEN "table" = 'todos' AND status = 0 THEN created_at END as sort2,
                    CASE WHEN "table" != 'todos' OR status = 1 THEN created_at END as sort3
                FROM (
                    SELECT id, title, 'places' as "table", created_at, null as object_type, null as file_path, -1 as status FROM places
                    UNION ALL SELECT id, title, 'people' as "table", created_at, null as object_type, null as file_path, -1 as status FROM people
                    UNION ALL SELECT id, title, 'interactions' as "table", created_at, null as object_type, null as file_path, -1 as status FROM interactions
                    UNION ALL SELECT id, title, 'custom_objects' as "table", created_at, object_type, null as file_path, -1 as status FROM custom_objects
                    UNION ALL SELECT id, title, 'images' as "table", created_at, null as object_type, file_path, -1 as status FROM images
                    UNION ALL SELECT id, title, 'files' as "table", created_at, null as object_type, file_path, -1 as status FROM files
                    UNION ALL SELECT id, title, 'todos' as "table", created_at, null as object_type, null as file_path, status FROM todos
                ) as union_sub
            ) as sort_sub
            ORDER BY
                sort1 ASC,
                sort2 ASC,
                sort3 DESC
            LIMIT ? OFFSET ?
        `, limit, offset);

        res.json(results);
    } catch (e) {
        console.error('[API Error] /recent:', e);
        res.status(500).json({ error: e.message });
    }
});

router.get('/bootstrap', async (req, res) => {
    try {
        const db = getDb();
        const places = await db.all('SELECT id, title, lat, lng FROM places');
        const objectCountResult = await db.get(`SELECT
            (SELECT COUNT(id) FROM places) +
            (SELECT COUNT(id) FROM people) +
            (SELECT COUNT(id) FROM interactions) +
            (SELECT COUNT(id) FROM custom_objects) +
            (SELECT COUNT(id) FROM images) +
            (SELECT COUNT(id) FROM files) +
            (SELECT COUNT(id) FROM todos) as count`);
        res.json({ places, hasObjects: objectCountResult.count > 0 });
    } catch (e) {
        console.error('[API Error] /bootstrap:', e);
        res.status(500).json({ error: e.message });
    }
});

router.get('/custom-object-types', async (req, res) => {
    try {
        const db = getDb();
        const types = await db.all('SELECT DISTINCT object_type FROM custom_objects ORDER BY object_type');
        res.json(types.map(t => t.object_type));
    } catch (e) {
        console.error('[API Error] /custom-object-types:', e);
        res.status(500).json({ error: e.message });
    }
});

router.get('/objects/:table', async (req, res) => {
    try {
        const { table } = req.params;
        const limit = parseInt(req.query.limit) || 20;
        const offset = parseInt(req.query.offset) || 0;
        const db = getDb();
        let items;

        if (table === 'todos') {
            items = await db.all(`
                SELECT id, title, created_at, status FROM todos
                ORDER BY status ASC,
                         CASE WHEN status = 0 THEN created_at END ASC,
                         CASE WHEN status = 1 THEN created_at END DESC
                LIMIT ? OFFSET ?`, limit, offset);
        } else if (table === 'custom_objects') {
            const types = req.query.types ? JSON.parse(req.query.types) : [];
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
            items = await db.all(`SELECT ${columnsToSelect.join(', ')} FROM ${table} ORDER BY created_at DESC LIMIT ? OFFSET ?`, limit, offset);
        }

        // Add table property to all items before sending
        items.forEach(item => item.table = table);

        res.json(items);
    } catch (e) {
        console.error(`[API Error] /objects/${req.params.table}:`, e);
        res.status(500).json({ error: e.message });
    }
});

router.get('/object/:table/:id', async (req, res) => {
    try {
        const { table, id } = req.params;
        const object = await getFullObjectDetails(table, id);
        if (!object) return res.status(404).json({ error: 'Object not found' });
        res.json(object);
    } catch (e) {
        console.error(`[API Error] /object/${req.params.table}/${req.params.id}:`, e);
        res.status(500).json({ error: e.message });
    }
});

router.get('/search', async (req, res) => {
    try {
        const { term } = req.query;
        const limit = parseInt(req.query.limit) || 25;
        if (!term || term.length < 3) return res.json([]);
        console.log(`[API] Searching for term: "${term}" with limit ${limit}`);
        const query = `%${term}%`;
        const db = getDb();
        const results = await db.all(`
            SELECT id, title, 'places' as "table" FROM places WHERE title LIKE ?
            UNION ALL SELECT id, title, 'people' as "table" FROM people WHERE title LIKE ?
            UNION ALL SELECT id, title, 'interactions' as "table" FROM interactions WHERE title LIKE ?
            UNION ALL SELECT id, title, 'custom_objects' as "table" FROM custom_objects WHERE title LIKE ?
            UNION ALL SELECT id, title, 'images' as "table" FROM images WHERE title LIKE ?
            UNION ALL SELECT id, title, 'files' as "table" FROM files WHERE title LIKE ?
            UNION ALL SELECT id, title, 'todos' as "table" FROM todos WHERE title LIKE ?
            ORDER BY title LIMIT ?
        `, query, query, query, query, query, query, query, limit);
        res.json(results);
    } catch (e) {
        console.error('[API Error] /search:', e);
        res.status(500).json({ error: e.message });
    }
});

const createGenericObject = async (table, req, res) => {
    try {
        console.log(`[API] Creating object in table '${table}' with data:`, req.body);
        let { links, key_values, ...data } = req.body;
        if (typeof links === 'string') {
            try { links = JSON.parse(links); } catch(e) { links = []; }
        }

        const id = nanoid();
        const db = getDb();
        const columnData = { ...data };

        if (table === 'custom_objects') {
            columnData.object_type = data.object_type.toLowerCase().replace(/\s+/g, '-');
        }

        const columns = Object.keys(columnData);
        const values = Object.values(columnData);

        await db.run(`INSERT INTO ${table} (id, ${columns.join(',')}) VALUES (?, ${columns.map(() => '?').join(',')})`, id, ...values);
        await saveKeyValues(id, table, key_values);
        await saveLinks(id, table, links);

        console.log(`[API] Successfully created object '${id}' in table '${table}'`);
        res.status(201).json(await getFullObjectDetails(table, id));
    } catch (e) {
        console.error(`[API Error] Error creating generic object in table ${table}:`, e);
        res.status(500).json({ error: e.message });
    }
};

router.post('/object/place', (req, res) => createGenericObject('places', req, res));
router.post('/object/person', (req, res) => createGenericObject('people', req, res));
router.post('/object/interaction', (req, res) => createGenericObject('interactions', req, res));
router.post('/object/custom_object', (req, res) => createGenericObject('custom_objects', req, res));
router.post('/object/todo', (req, res) => createGenericObject('todos', req, res));

router.post('/object/image', upload.array('files'), async (req, res) => {
    try {
        console.log(`[API] Creating image object(s)`);
        const links = req.body.links ? JSON.parse(req.body.links) : [];
        const db = getDb();
        const createdObjects = [];
        for (const file of req.files) {
            const processed = await processImageFile(file);
            if (!processed) continue;

            const { gpsCoords, finalFilename, title } = processed;
            const id = nanoid();

            await db.run('INSERT INTO images (id, title, file_path) VALUES (?, ?, ?)', id, title, `/images/${finalFilename}`);
            await saveLinks(id, 'images', links);

            if (gpsCoords) {
                const newPlace = await linkGpsData(id, gpsCoords, title);
                if (newPlace) {
                    createdObjects.push(newPlace);
                }
            }
            const imageDetails = await getFullObjectDetails('images', id);
            createdObjects.push(imageDetails);
        }
        console.log(`[API] Successfully created ${createdObjects.length} image-related objects.`);
        res.status(201).json(createdObjects);
    } catch (e) {
        console.error(`[API Error] creating image object:`, e);
        res.status(500).json({ error: e.message });
    }
});

router.post('/object/other_file', upload.array('files'), async (req, res) => {
    try {
        console.log(`[API] Creating file object(s)`);
        const links = req.body.links ? JSON.parse(req.body.links) : [];
        const db = getDb();
        const createdFiles = [];
        const targetDir = path.resolve('./data/files');
        if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });

        for (const file of req.files) {
            const tempPath = file.path;
            const finalFilename = `${new Date().toISOString().slice(0, 10)}-${nanoid(6)}${path.extname(file.originalname)}`;
            const finalPath = path.join(targetDir, finalFilename);
            fs.renameSync(tempPath, finalPath);

            const id = nanoid();
            await db.run('INSERT INTO files (id, title, file_path) VALUES (?, ?, ?)', id, file.originalname, `/files/${finalFilename}`);
            await saveLinks(id, 'files', links);
            createdFiles.push(await getFullObjectDetails('files', id));
        }
        console.log(`[API] Successfully created ${createdFiles.length} file objects.`);
        res.status(201).json(createdFiles);
    } catch (e) {
        console.error(`[API Error] creating file object:`, e);
        res.status(500).json({ error: e.message });
    }
});

router.post('/object/:table/:id/kv', async (req, res) => {
    try {
        const { table, id } = req.params;
        const { key, value } = req.body;
        console.log(`[API] Adding KV pair to ${table}:${id} -> ${key}:${value}`);
        const db = getDb();
        const result = await db.run('INSERT INTO key_values (object_id, object_table, key, value) VALUES (?, ?, ?, ?)', id, table, key, value);
        res.status(201).json({ id: result.lastID, key, value });
    } catch (e) {
        console.error(`[API Error] adding KV pair:`, e);
        res.status(500).json({ error: e.message });
    }
});

router.post('/link', async (req, res) => {
    try {
        const { source_id, source_table, target_id, target_table } = req.body;
        await saveLinks(source_id, source_table, [`${target_table}:${target_id}`]);
        res.status(201).json({ success: true });
    } catch (e) {
        console.error(`[API Error] creating link:`, e);
        res.status(500).json({ error: e.message });
    }
});

router.patch('/object/:table/:id', async (req, res) => {
    try {
        const { table, id } = req.params;
        const { field, value } = req.body;
        console.log(`[API] Patching ${table}:${id} with field '${field}' and value '${value}'`);
        const db = getDb();

        if (field === 'title') {
            if (!value) {
                return res.status(400).json({ error: `Title field cannot be empty.` });
            }
            await db.run(`UPDATE ${table} SET title = ? WHERE id = ?`, value, id);
            console.log(`[API] Successfully updated title for ${table}:${id}`);
            return res.status(200).json({ success: true, newValue: value });

        } else if (field === 'status' && table === 'todos') {
            const newStatus = Number(value);
            if (newStatus === undefined || newStatus === null || ![0, 1].includes(newStatus)) {
                return res.status(400).json({ error: 'Invalid value for status' });
            }
            await db.run(`UPDATE todos SET status = ? WHERE id = ?`, newStatus, id);
            console.log(`[API] Successfully updated status for todo:${id}`);
            return res.status(200).json({ success: true, newValue: newStatus });

        } else {
            return res.status(400).json({ error: 'Invalid field for patching' });
        }
    } catch (e) {
        console.error(`[API Error] patching ${req.params.table}:${req.params.id}:`, e);
        res.status(500).json({ error: e.message });
    }
});

router.patch('/kv/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { key, value } = req.body;
        console.log(`[API] Patching KV ${id} with ${key}:${value}`);
        const db = getDb();
        await db.run('UPDATE key_values SET key = ?, value = ? WHERE id = ?', key, value, id);
        res.status(200).json({ success: true });
    } catch (e) {
        console.error(`[API Error] patching KV ${req.params.id}:`, e);
        res.status(500).json({ error: e.message });
    }
});

router.delete('/kv/:id', async (req, res) => {
    try {
        const { id } = req.params;
        console.log(`[API] Deleting KV ${id}`);
        const db = getDb();
        await db.run('DELETE FROM key_values WHERE id = ?', id);
        res.status(200).json({ success: true });
    } catch (e) {
        console.error(`[API Error] deleting KV ${req.params.id}:`, e);
        res.status(500).json({ error: e.message });
    }
});

router.post('/unlink', async (req, res) => {
    try {
        const { source_id, source_table, target_id, target_table } = req.body;
        console.log(`[API] Unlinking ${source_table}:${source_id} from ${target_table}:${target_id}`);
        const db = getDb();
        await db.run(`DELETE FROM links WHERE (source_id = ? AND source_table = ? AND target_id = ? AND target_table = ?) OR (source_id = ? AND source_table = ? AND target_id = ? AND target_table = ?)`, source_id, source_table, target_id, target_table, target_id, target_table, source_id, source_table);
        res.status(200).json({ success: true });
    } catch (e) {
        console.error(`[API Error] unlinking objects:`, e);
        res.status(500).json({ error: e.message });
    }
});

router.delete('/object/:table/:id', async (req, res) => {
    try {
        const { table, id } = req.params;
        console.log(`[API] Deleting object ${table}:${id}`);
        const db = getDb();
        if (table === 'images' || table === 'files') {
            const fileObject = await db.get(`SELECT file_path FROM ${table} WHERE id = ?`, id);
            if (fileObject) {
                const filePath = path.resolve(`./data${fileObject.file_path}`);
                if (fs.existsSync(filePath)) {
                    fs.unlinkSync(filePath);
                    console.log(`[File System] Deleted file: ${filePath}`);
                }
            }
        }

        await db.run(`DELETE FROM ${table} WHERE id = ?`, id);
        await db.run('DELETE FROM key_values WHERE object_id = ?', id);
        await db.run('DELETE FROM links WHERE source_id = ? OR target_id = ?', id, id);
        console.log(`[API] Successfully deleted object ${table}:${id} and associated data.`);
        res.status(200).json({ success: true });
    } catch (e) {
        console.error(`[API Error] deleting object ${req.params.table}:${req.params.id}:`, e);
        res.status(500).json({ error: e.message });
    }
});

export default router;