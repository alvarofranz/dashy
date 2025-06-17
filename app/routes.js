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
    const db = getDb();
    const object = await db.get(`SELECT * FROM ${table} WHERE id = ?`, id);
    if (!object) return null;
    object.key_values = await db.all('SELECT id, key, value FROM key_values WHERE object_id = ? ORDER BY id', id);
    const linkedIds = await db.all(`
        SELECT target_id as id, target_table as "table" FROM links WHERE source_id = ? AND source_table = ?
        UNION
        SELECT source_id as id, source_table as "table" FROM links WHERE target_id = ? AND target_table = ?
    `, id, table, id, table);
    const tableQueries = {
        places: `SELECT id, title, 'places' as "table" FROM places WHERE id = ?`,
        people: `SELECT id, name as title, 'people' as "table" FROM people WHERE id = ?`,
        interactions: `SELECT id, description as title, 'interactions' as "table" FROM interactions WHERE id = ?`,
        custom_objects: `SELECT id, title, object_type, 'custom_objects' as "table" FROM custom_objects WHERE id = ?`,
        images: `SELECT id, original_name as title, 'images' as "table" FROM images WHERE id = ?`,
        other_files: `SELECT id, original_name as title, 'other_files' as "table" FROM other_files WHERE id = ?`,
    };
    const linkedObjects = await Promise.all(
        linkedIds.map(link => {
            const query = tableQueries[link.table];
            return query ? db.get(query, link.id) : Promise.resolve(null);
        })
    );
    object.links = linkedObjects.filter(Boolean);
    object.table = table;
    if (object.name) { object.title = object.name; }
    if (object.description) { object.title = object.description; }
    if (object.original_name) { object.title = object.original_name; }
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
    let originalname = file.originalname;

    try {
        // Use Sharp to handle conversion, preserving metadata
        const jpegBuffer = await sharp(inputBuffer)
            .withMetadata() // Attempt to preserve EXIF data
            .jpeg({ quality: 90 })
            .toBuffer();

        console.log(`[Image Processing] Successfully converted '${file.originalname}' to JPEG buffer with Sharp.`);

        // Now, parse the EXIF from the generated JPEG buffer
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

        // Update originalname if the extension changed
        if (path.extname(originalname).toLowerCase() !== finalExtension) {
            originalname = `${path.parse(originalname).name}${finalExtension}`;
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
    return { gpsCoords, finalFilename, originalname };
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
            SELECT id, title, 'places' as "table", created_at, null as object_type, null as file_path FROM places
            UNION ALL SELECT id, name as title, 'people' as "table", created_at, null as object_type, null as file_path FROM people
            UNION ALL SELECT id, description as title, 'interactions' as "table", created_at, null as object_type, null as file_path FROM interactions
            UNION ALL SELECT id, title, 'custom_objects' as "table", created_at, object_type, null as file_path FROM custom_objects
            UNION ALL SELECT id, original_name as title, 'images' as "table", created_at, null as object_type, file_path FROM images
            UNION ALL SELECT id, original_name as title, 'other_files' as "table", created_at, null as object_type, file_path FROM other_files
            ORDER BY created_at DESC
            LIMIT ? OFFSET ?
        `, limit, offset);
        res.json(results);
    } catch (e) {
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
            (SELECT COUNT(id) FROM other_files) as count`);
        res.json({ places, hasObjects: objectCountResult.count > 0 });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/custom-object-types', async (req, res) => {
    try {
        const db = getDb();
        const types = await db.all('SELECT DISTINCT object_type FROM custom_objects ORDER BY object_type');
        res.json(types.map(t => t.object_type));
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/objects/:table', async (req, res) => {
    try {
        const { table } = req.params;
        const limit = parseInt(req.query.limit) || 20;
        const offset = parseInt(req.query.offset) || 0;

        const titleFields = { places: 'title', people: 'name', interactions: 'description', custom_objects: 'title', images: 'original_name', other_files: 'original_name' };
        const titleField = titleFields[table] || 'title';

        const columnsToSelect = ['id', `${titleField} as title`, 'created_at'];
        if (table === 'custom_objects') {
            columnsToSelect.push('object_type');
        }
        if (table === 'images' || table === 'other_files') {
            columnsToSelect.push('file_path');
        }

        const db = getDb();
        const items = await db.all(`SELECT ${columnsToSelect.join(', ')} FROM ${table} ORDER BY created_at DESC LIMIT ? OFFSET ?`, limit, offset);
        res.json(items);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

router.get('/object/:table/:id', async (req, res) => {
    try {
        const { table, id } = req.params;
        const object = await getFullObjectDetails(table, id);
        if (!object) return res.status(404).json({ error: 'Object not found' });
        res.json(object);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/search', async (req, res) => {
    try {
        const { term } = req.query;
        if (!term) return res.json([]);
        const query = `%${term}%`;
        const db = getDb();
        const results = await db.all(`
            SELECT id, title, 'places' as "table" FROM places WHERE title LIKE ?
            UNION ALL SELECT id, name as title, 'people' as "table" FROM people WHERE name LIKE ?
            UNION ALL SELECT id, description as title, 'interactions' as "table" FROM interactions WHERE description LIKE ?
            UNION ALL SELECT id, title, 'custom_objects' as "table" FROM custom_objects WHERE title LIKE ?
            UNION ALL SELECT id, original_name as title, 'images' as "table" FROM images WHERE original_name LIKE ?
            UNION ALL SELECT id, original_name as title, 'other_files' as "table" FROM other_files WHERE original_name LIKE ?
            ORDER BY title LIMIT 10
        `, query, query, query, query, query, query);
        res.json(results);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

const createGenericObject = async (table, req, res) => {
    try {
        let { links, key_values, ...data } = req.body;
        if (typeof links === 'string') {
            try { links = JSON.parse(links); } catch(e) { links = []; }
        }

        const id = nanoid();
        const db = getDb();
        const columnData = { ...data };
        if (table === 'people') {
            columnData.name = data.title;
        } else if (table === 'custom_objects') {
            columnData.object_type = data.object_type.toLowerCase().replace(/\s+/g, '-');
        }

        const columns = Object.keys(columnData).filter(k => k !== 'title' || table !== 'people');
        const values = columns.map(col => columnData[col]);

        await db.run(`INSERT INTO ${table} (id, ${columns.join(',')}) VALUES (?, ${columns.map(() => '?').join(',')})`, id, ...values);
        await saveKeyValues(id, table, key_values);
        await saveLinks(id, table, links);

        res.status(201).json(await getFullObjectDetails(table, id));
    } catch (e) {
        console.error(`Error creating generic object in table ${table}:`, e);
        res.status(500).json({ error: e.message });
    }
};

router.post('/object/place', (req, res) => createGenericObject('places', req, res));
router.post('/object/person', (req, res) => createGenericObject('people', req, res));
router.post('/object/interaction', (req, res) => createGenericObject('interactions', req, res));
router.post('/object/custom_object', (req, res) => createGenericObject('custom_objects', req, res));

router.post('/object/image', upload.array('files'), async (req, res) => {
    try {
        const links = req.body.links ? JSON.parse(req.body.links) : [];
        const db = getDb();
        const createdObjects = [];
        for (const file of req.files) {
            const processed = await processImageFile(file);
            if (!processed) continue;

            const { gpsCoords, finalFilename, originalname } = processed;
            const id = nanoid();

            await db.run('INSERT INTO images (id, original_name, file_path) VALUES (?, ?, ?)', id, originalname, `/images/${finalFilename}`);
            await saveLinks(id, 'images', links);

            if (gpsCoords) {
                const newPlace = await linkGpsData(id, gpsCoords, originalname);
                if (newPlace) {
                    createdObjects.push(newPlace);
                }
            }
            const imageDetails = await getFullObjectDetails('images', id);
            createdObjects.push(imageDetails);
        }
        res.status(201).json(createdObjects);
    } catch (e) {
        console.error(`Error creating image object:`, e);
        res.status(500).json({ error: e.message });
    }
});

router.post('/object/other_file', upload.array('files'), async (req, res) => {
    try {
        const links = req.body.links ? JSON.parse(req.body.links) : [];
        const db = getDb();
        const createdFiles = [];
        const targetDir = path.resolve('./data/other_files');
        if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });

        for (const file of req.files) {
            const tempPath = file.path;
            const finalFilename = `${new Date().toISOString().slice(0, 10)}-${nanoid(6)}${path.extname(file.originalname)}`;
            const finalPath = path.join(targetDir, finalFilename);
            fs.renameSync(tempPath, finalPath);

            const id = nanoid();
            await db.run('INSERT INTO other_files (id, original_name, file_path) VALUES (?, ?, ?)', id, file.originalname, `/other_files/${finalFilename}`);
            await saveLinks(id, 'other_files', links);
            createdFiles.push(await getFullObjectDetails('other_files', id));
        }
        res.status(201).json(createdFiles);
    } catch (e) {
        console.error(`Error creating file object:`, e);
        res.status(500).json({ error: e.message });
    }
});

router.post('/object/:table/:id/kv', async (req, res) => {
    try {
        const { table, id } = req.params;
        const { key, value } = req.body;
        const db = getDb();
        const result = await db.run('INSERT INTO key_values (object_id, object_table, key, value) VALUES (?, ?, ?, ?)', id, table, key, value);
        res.status(201).json({ id: result.lastID, key, value });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/link', async (req, res) => {
    try {
        const { source_id, source_table, target_id, target_table } = req.body;
        await saveLinks(source_id, source_table, [`${target_table}:${target_id}`]);
        res.status(201).json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.patch('/object/:table/:id', async (req, res) => {
    try {
        const { table, id } = req.params;
        const { field, value } = req.body;
        const fieldMap = { places: 'title', people: 'name', interactions: 'description', custom_objects: 'title' };
        const dbField = (field === 'title') ? fieldMap[table] : null;
        if (!dbField || !value) return res.status(400).json({ error: 'Invalid field or empty value' });
        const db = getDb();
        await db.run(`UPDATE ${table} SET ${dbField} = ? WHERE id = ?`, value, id);
        res.status(200).json({ success: true, newValue: value });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.patch('/kv/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { key, value } = req.body;
        const db = getDb();
        await db.run('UPDATE key_values SET key = ?, value = ? WHERE id = ?', key, value, id);
        res.status(200).json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/kv/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const db = getDb();
        await db.run('DELETE FROM key_values WHERE id = ?', id);
        res.status(200).json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/unlink', async (req, res) => {
    try {
        const { source_id, source_table, target_id, target_table } = req.body;
        const db = getDb();
        await db.run(`DELETE FROM links WHERE (source_id = ? AND source_table = ? AND target_id = ? AND target_table = ?) OR (source_id = ? AND source_table = ? AND target_id = ? AND target_table = ?)`, source_id, source_table, target_id, target_table, target_id, target_table, source_id, source_table);
        res.status(200).json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/object/:table/:id', async (req, res) => {
    try {
        const { table, id } = req.params;
        const db = getDb();
        if (table === 'images' || table === 'other_files') {
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
        res.status(200).json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

export default router;