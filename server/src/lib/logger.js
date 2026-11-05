import crypto from 'node:crypto';
import pino from 'pino';
import pinoHttp from 'pino-http';
import { requestContext } from './requestContext.js';
import { createErrorCounter } from './errorCounter.js';

const SENSITIVE = ['password', 'token', 'code', 'email', 'phone', 'cookie', 'authorization'];

export const REDACT_PATHS = [
  ...SENSITIVE,
  ...SENSITIVE.map((k) => `*.${k}`),
  'req.headers.cookie',
  'req.headers.authorization',
  'res.headers["set-cookie"]',
];

// OPS-12: every error line the main logger writes is counted; a burst calls the alert handler.
let errorAlertHandler = () => {};
/** Set once at start-up (server.js) to send the alert email. */
export function onErrorAlert(fn) {
  errorAlertHandler = fn;
}
export const errorCounter = createErrorCounter({ onAlert: (alert) => errorAlertHandler(alert) });

export function createLogger({ level = 'info', destination, count = false } = {}) {
  // pino needs a hooks object either way; only a counted logger records error lines.
  const hooks = {
    logMethod(args, method, lvl) {
      if (count) errorCounter.record(lvl);
      return method.apply(this, args);
    },
  };
  return pino({ level, hooks, redact: { paths: REDACT_PATHS, censor: '[Redacted]' } }, destination);
}

export const logger = createLogger({
  count: true,
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
