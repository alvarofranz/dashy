import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import path from 'path';

let db;

export async function initDatabase(dataPath) {
    if (db) {
        return db;
    }
    const dbPath = path.join(dataPath, 'dashy.sqlite3');
    console.log(`[Database] Initializing database at: ${dbPath}`);

    db = await open({
        filename: dbPath,
        driver: sqlite3.Database
    });

    await db.exec(`PRAGMA foreign_keys = ON;`);

    // Initial schema creation is now part of migrations
    // It will be run if the user_version is 0
    return db;
}

export async function closeDb() {
    if (db) {
        await db.close();
        db = null;
        console.log('[Database] Connection closed.');
    }
}

export const getDb = () => {
    if (!db) {
        throw new Error("Database has not been initialized.");
    }
    return db;
};