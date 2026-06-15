import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from './index.js';
import { logger } from '../lib/logger.js';
import { isMainModule } from '../lib/ids.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA_VERSION = '1';

/** Tworzy / aktualizuje schemat bazy. Idempotentne — bezpieczne przy każdym starcie. */
export function migrate() {
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  db.exec(schema);
  db.prepare(
    `INSERT INTO schema_meta (key, value) VALUES ('version', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(SCHEMA_VERSION);
  logger.info({ version: SCHEMA_VERSION }, 'Migracja bazy zakończona');
}

if (isMainModule(import.meta.url)) {
  migrate();
  process.exit(0);
}
