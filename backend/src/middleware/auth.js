import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { users } from '../db/repos.js';
import { unauthorized } from '../lib/errors.js';

/** Podpisuje token JWT dla użytkownika (ważność z JWT_TTL_DAYS). */
export function signToken(userId) {
  return jwt.sign({ sub: userId }, env.JWT_SECRET, { expiresIn: `${env.JWT_TTL_DAYS}d` });
}

/** Middleware: wymaga ważnego tokenu Bearer; dołącza req.user. */
export function authRequired(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : null;
  if (!token) return next(unauthorized('Brak tokenu uwierzytelniającego'));

  let payload;
  try {
    payload = jwt.verify(token, env.JWT_SECRET);
  } catch {
    return next(unauthorized('Nieprawidłowy lub wygasły token'));
  }

  const user = users.findById(payload.sub);
  if (!user) return next(unauthorized('Konto nie istnieje'));
  req.user = user;
  next();
}
