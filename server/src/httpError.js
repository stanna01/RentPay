// Errors that carry an HTTP status and a friendly message for the user. The
// central error handler in index.js sends err.message for any status < 500.

export function httpError(status, message, extra = {}) {
  return Object.assign(new Error(message), { status, ...extra });
}

export const badRequest = (msg) => httpError(400, msg);
// 404 (not 403) for resources outside the user's properties, so we never
// confirm that something the user may not see exists.
export const notFound = (msg = 'Not found.') => httpError(404, msg);
export const forbidden = (msg = 'You do not have permission to do that.') => httpError(403, msg);
