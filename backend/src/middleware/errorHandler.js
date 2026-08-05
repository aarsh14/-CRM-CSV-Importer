// Express recognizes this as error-handling middleware specifically
// because it takes 4 arguments (err, req, res, next) — this must be
// registered LAST, after all routes, in app.js.
export function errorHandler(err, req, res, next) {
  console.error('[error]', err.message);

  if (err.name === 'ValidationError') {
    // Mongoose validation errors
    return res.status(400).json({ error: err.message });
  }

  if (err.name === 'MongoServerError' && err.code === 11000) {
    return res.status(409).json({ error: 'Duplicate entry' });
  }

  if (err.code === 'LIMIT_FILE_SIZE') {
    // thrown by multer when a file exceeds the configured size limit
    return res.status(413).json({ error: 'File is too large. Maximum size is 50MB.' });
  }

  if (err.message === 'Only .csv files are allowed') {
    return res.status(400).json({ error: err.message });
  }

  if (err.code === 'ENOSPC') {
    // server's disk ran out of space while writing the uploaded file —
    // this is a server capacity problem, not something the user can fix,
    // so the message deliberately doesn't suggest a fix on their end
    console.error('[error] Server disk is full — could not write uploaded file');
    return res.status(507).json({
      error: 'The server is temporarily unable to accept uploads. Please try again shortly.',
    });
  }

  // fallback — never leak internal error details to the client
  res.status(500).json({ error: 'Something went wrong on our end' });
}

export function notFoundHandler(req, res) {
  res.status(404).json({ error: 'Route not found' });
}