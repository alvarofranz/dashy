import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import path from 'path';

let db;

export async function initDatabase() {
    db = await open({
        filename: path.resolve('./data/dashy.sqlite3'),
        driver: sqlite3.Database
    });

    await db.exec(`
        PRAGMA foreign_keys = ON;

        CREATE TABLE IF NOT EXISTS places (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            lat REAL NOT NULL,
            lng REAL NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS people (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS images (
            id TEXT PRIMARY KEY,
            original_name TEXT NOT NULL,
            file_path TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS other_files (
            id TEXT PRIMARY KEY,
            original_name TEXT NOT NULL,
            file_path TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS interactions (
            id TEXT PRIMARY KEY,
            description TEXT NOT NULL,
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
    `);
    return db;
}

export const getDb = () => db;