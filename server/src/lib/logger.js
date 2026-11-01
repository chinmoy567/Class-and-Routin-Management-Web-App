import crypto from 'node:crypto';
import pino from 'pino';
import pinoHttp from 'pino-http';
import { requestContext } from './requestContext.js';

const SENSITIVE = ['password', 'token', 'code', 'email', 'phone', 'cookie', 'authorization'];

export const REDACT_PATHS = [
  ...SENSITIVE,
  ...SENSITIVE.map((k) => `*.${k}`),
  'req.headers.cookie',
  'req.headers.authorization',
  'res.headers["set-cookie"]',
];

export function createLogger({ level = 'info', destination } = {}) {
  return pino({ level, redact: { paths: REDACT_PATHS, censor: '[Redacted]' } }, destination);
}

export const logger = createLogger({
  level: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === 'test' ? 'silent' : 'info'),
});

/** Request logging with a request id. Request bodies are never logged. */
export function requestLogger(log = logger) {
  const http = pinoHttp({
    logger: log,
    genReqId: (req, res) => {
      const id = req.headers['x-request-id'] || crypto.randomUUID();
      res.setHeader('X-Request-Id', id);
      return id;
    },
    serializers: {
      req: (req) => ({ id: req.id, method: req.method, url: req.url }),
      res: (res) => ({ statusCode: res.statusCode }),
    },
  });
  return (req, res, next) => http(req, res, () => requestContext.run({ requestId: req.id }, next));
}
