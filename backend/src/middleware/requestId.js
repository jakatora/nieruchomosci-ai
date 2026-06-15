import { randomUUID } from 'node:crypto';

/**
 * Request ID middleware — przypisuje każdemu requestowi unikalny UUID v4.
 *
 * Use case:
 *   - Incident response: user zgłasza "błąd o 14:32" → szukamy `req_id` w logach/audit
 *   - Distributed tracing: gdy w v2 dodamy mikroserwisy / job queue, ID podążą cross-system
 *   - Debugging: pino logger może auto-included req.id w log entries
 *
 * Header:
 *   - Jeśli klient (np. mobile) wyśle `X-Request-Id`, używamy tej wartości (umożliwia
 *     idempotency hash albo end-to-end tracing).
 *   - Jeśli nie — generujemy UUID v4.
 *
 * Response header `X-Request-Id` zwraca ID do klienta — pozwala mu reportować bugs
 * z tym ID dla szybkiej diagnozy.
 */
export function requestId(req, res, next) {
  const headerId = req.headers['x-request-id'];
  // Akceptujemy tylko sensowne ID (UUID lub krótkie alfanumeryczne ≤ 64 chars).
  const id = (typeof headerId === 'string' && headerId.length <= 64 && /^[\w.-]+$/.test(headerId))
    ? headerId
    : randomUUID();
  req.id = id;
  res.setHeader('X-Request-Id', id);
  next();
}
