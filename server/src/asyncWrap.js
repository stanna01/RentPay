// Express 4 does not catch rejected promises from async route handlers, so an
// unhandled rejection would crash the whole process. wrapAsync patches a router's
// handlers to forward any async error to Express's error middleware instead.

export function wrapAsync(router) {
  for (const layer of router.stack) {
    if (!layer.route) continue;
    for (const s of layer.route.stack) {
      const orig = s.handle;
      // Skip error-handling middleware (arity 4); wrap normal handlers only.
      if (typeof orig === 'function' && orig.length < 4) {
        s.handle = (req, res, next) => Promise.resolve(orig(req, res, next)).catch(next);
      }
    }
  }
  return router;
}
