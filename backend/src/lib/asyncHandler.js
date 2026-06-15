/**
 * Opakowuje asynchroniczny handler trasy, przekazując odrzucone obietnice
 * do middleware błędów (Express 4 nie łapie async-throw automatycznie).
 */
export const ah = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);
