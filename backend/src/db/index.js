import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { DB_PATH } from '../config/env.js';

// Katalog bazy musi istnieć przed otwarciem połączenia.
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

/**
 * Połączenie SQLite (wbudowany moduł node:sqlite — bez kompilacji natywnej).
 * Decyzja DEC-007 w decisions.md: trzymamy się node:sqlite (wzorzec z PrzetargAI),
 * mimo że to wciąż API "Experimental" w Node 22 — zysk: zero kompilacji natywnej,
 * tańszy CI/CD, mniejszy footprint na Railway.
 */
export const db = new DatabaseSync(DB_PATH);

db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');
db.exec('PRAGMA busy_timeout = 5000;');
