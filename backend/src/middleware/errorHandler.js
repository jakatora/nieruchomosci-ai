import { AppError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import { captureException } from '../lib/sentry.js';

/**
 * Zwraca request_id z `req.id` (ustawione przez `requestId` middleware z iter 16)
 * albo `undefined` gdy middleware nie wstał (np. test bez full stack).
 */
function reqId(req) {
  return typeof req?.id === 'string' ? req.id : undefined;
}

/** Middleware: zasób nieznaleziony (trasa nie pasuje). */
export function notFoundHandler(req, res) {
  res.status(404).json({
    error: { code: 'NOT_FOUND', message: 'Nie znaleziono zasobu' },
    request_id: reqId(req),
  });
}

/** Centralny handler błędów — mapuje wyjątki na odpowiedzi JSON.
 *  Iter 17: dodaje request_id do każdej error response (incident response). */
export function errorHandler(err, req, res, _next) {
  if (err instanceof AppError) {
    return res.status(err.status).json({
      error: { code: err.code, message: err.message, details: err.details ?? undefined },
      request_id: reqId(req),
    });
  }

  // Błąd parsera JSON (express.json()).
  if (err?.type === 'entity.parse.failed') {
    return res.status(400).json({
      error: { code: 'BAD_JSON', message: 'Treść żądania nie jest poprawnym JSON-em' },
      request_id: reqId(req),
    });
  }

  // Iter 47: body-parser zgłasza 413 Payload Too Large (przekroczony limit per-route).
  if (err?.type === 'entity.too.large' || err?.statusCode === 413 || err?.status === 413) {
    return res.status(413).json({
      error: { code: 'PAYLOAD_TOO_LARGE',
               message: `Treść żądania przekracza dopuszczalny rozmiar${err?.limit ? ` (${err.limit} B)` : ''}.` },
      request_id: reqId(req),
    });
  }

  logger.error({
    err: err?.message,
    stack: err?.stack,
    req_id: reqId(req),
    path: req?.originalUrl,
  }, 'Nieobsłużony błąd');
  captureException(err, { req_id: reqId(req), path: req?.originalUrl });
  res.status(500).json({
    error: { code: 'SERVER_ERROR', message: 'Wewnętrzny błąd serwera' },
    request_id: reqId(req),
  });
}
