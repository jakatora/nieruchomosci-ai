import crypto from 'node:crypto';
import { env } from '../config/env.js';
import { forbidden, serviceUnavailable } from '../lib/errors.js';

/** Porównanie odporne na ataki czasowe. */
function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

/** Middleware: wymaga nagłówka x-admin-key zgodnego z ADMIN_API_KEY. */
export function adminRequired(req, res, next) {
  if (!env.ADMIN_API_KEY) {
    return next(serviceUnavailable('Panel administracyjny niedostępny — brak ADMIN_API_KEY'));
  }
  const key = req.headers['x-admin-key'];
  if (!key || !safeEqual(key, env.ADMIN_API_KEY)) {
    return next(forbidden('Nieprawidłowy klucz administratora'));
  }
  next();
}
