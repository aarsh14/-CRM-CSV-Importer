// Minimal structured logger. Not a real logging library (pino/winston) —
// intentionally simple for now, but consistent JSON shape means it could
// be swapped for one later without changing call sites much.
function log(level, message, meta = {}) {
  console.log(JSON.stringify({ level, message, ...meta, time: new Date().toISOString() }));
}

export const logger = {
  info: (message, meta) => log('info', message, meta),
  warn: (message, meta) => log('warn', message, meta),
  error: (message, meta) => log('error', message, meta),
};
