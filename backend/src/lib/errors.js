/** Błąd aplikacyjny z kodem HTTP i kodem maszynowym — obsługiwany przez errorHandler. */
export class AppError extends Error {
  constructor(status, code, message, details = null) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.expose = true; // bezpieczny do pokazania klientowi
  }
}

export const badRequest = (msg, details) => new AppError(400, 'BAD_REQUEST', msg, details);
export const unauthorized = (msg = 'Brak autoryzacji') => new AppError(401, 'UNAUTHORIZED', msg);
export const forbidden = (msg = 'Brak dostępu') => new AppError(403, 'FORBIDDEN', msg);
export const notFound = (msg = 'Nie znaleziono zasobu', details) => new AppError(404, 'NOT_FOUND', msg, details);
export const conflict = (msg, details) => new AppError(409, 'CONFLICT', msg, details);
export const tooMany = (msg = 'Za dużo żądań') => new AppError(429, 'RATE_LIMITED', msg);
export const serviceUnavailable = (msg) => new AppError(503, 'SERVICE_UNAVAILABLE', msg);
