const crypto = require('crypto');

const TOKEN_ENV = 'NECRO_API_TOKEN';

/**
 * Read and validate the API token required to operate Necrobrowser.
 * Tokens are supplied only through the process environment and are never
 * persisted in config.toml or emitted in logs.
 */
exports.requireConfiguredToken = () => {
  const token = process.env[TOKEN_ENV];

  if (!token || !token.trim()) {
    throw new Error(`${TOKEN_ENV} must be set before starting Necrobrowser`);
  }

  return token;
};

/**
 * Constant-time bearer-token authentication for every operator API route.
 */
exports.requireBearerToken = (req, res, next) => {
  const expected = exports.requireConfiguredToken();
  const authorization = req.get('authorization') || '';
  const match = /^Bearer\s+(.+)$/i.exec(authorization);
  const received = match ? match[1] : '';

  const expectedBytes = Buffer.from(expected);
  const receivedBytes = Buffer.from(received);
  const valid = expectedBytes.length === receivedBytes.length &&
    crypto.timingSafeEqual(expectedBytes, receivedBytes);

  if (!valid) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  return next();
};
