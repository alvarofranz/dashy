import { getDb } from './database.js';

// Define the latest version of the database schema.
// Increment this number whenever you add a new migration.
const LATEST_VERSION = 1;

// Define migration scripts. Each key is the version it migrates TO.
// The script runs if the current DB version is `key - 1`.
const MIGRATIONS = {
    1: `
        -- This is the initial schema setup. It will only run if user_version is 0.
        CREATE TABLE IF NOT EXISTS places (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            lat REAL NOT NULL,
            lng REAL NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS people (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS images (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            file_path TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS files (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            file_path TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS interactions (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            mood INTEGER NOT NULL,
            interaction_date DATE NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS custom_objects (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            object_type TEXT NOT NULL,
            mood INTEGER NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS todos (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            status INTEGER NOT NULL DEFAULT 0, -- 0 = incomplete, 1 = complete
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS key_values (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            object_id TEXT NOT NULL,
            object_table TEXT NOT NULL,
            key TEXT NOT NULL,
            value TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS links (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            source_id TEXT NOT NULL,
            source_table TEXT NOT NULL,
            target_id TEXT NOT NULL,
            target_table TEXT NOT NULL,
            UNIQUE(source_id, source_table, target_id, target_table)
        );
    `
    // To add a new migration for version 2:
    // 2: `
    //    ALTER TABLE people ADD COLUMN email TEXT;
    // `
};

export async function runMigrations() {
    const db = getDb();
    let currentVersion = (await db.get('PRAGMA user_version')).user_version;
    console.log(`[DB Migration] Current DB version: ${currentVersion}. Target version: ${LATEST_VERSION}`);

    if (currentVersion >= LATEST_VERSION) {
        console.log('[DB Migration] Database is up to date.');
        return;
    }

    try {
        console.log('[DB Migration] Starting migration process...');
        await db.exec('BEGIN TRANSACTION');

        while (currentVersion < LATEST_VERSION) {
            const nextVersion = currentVersion + 1;
            const migrationScript = MIGRATIONS[nextVersion];

            if (!migrationScript) {
                throw new Error(`[DB Migration] Error: No migration script found for version ${nextVersion}.`);
            }

            console.log(`[DB Migration] Applying migration for version ${nextVersion}...`);
            await db.exec(migrationScript);

            await db.exec(`PRAGMA user_version = ${nextVersion}`);
            currentVersion = nextVersion;
            console.log(`[DB Migration] Successfully migrated to version ${nextVersion}.`);
        }

        await db.exec('COMMIT');
        console.log('[DB Migration] All migrations applied successfully.');

    } catch (err) {
        console.error('[DB Migration] FAILED. Rolling back transaction.', err);
        await db.exec('ROLLBACK');
        throw err; // Re-throw the error to be caught by the main process startup
    }
}