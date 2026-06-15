import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

/** Identyfikator zasobu (UUID v4). */
export const newId = () => randomUUID();

/** Losowy token hex (np. magic link). Domyślnie 24 bajty => 48 znaków hex. */
export const newToken = (bytes = 24) => randomBytes(bytes).toString('hex');

/** Bieżący znacznik czasu w ISO 8601 (UTC). */
export const nowIso = () => new Date().toISOString();

/** Początek dzisiejszej doby (UTC) w ISO — do limitów dziennych. */
export const startOfTodayIso = () =>
  `${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`;

/** Czy dany moduł został uruchomiony bezpośrednio (node plik.js), nie zaimportowany. */
export const isMainModule = (importMetaUrl) =>
  Boolean(process.argv[1]) && importMetaUrl === pathToFileURL(process.argv[1]).href;

/** SHA-256 hex — używane jako klucz do geocoding_cache + dedupe. */
export const sha256 = (input) => createHash('sha256').update(String(input)).digest('hex');
