import express from 'express';
import helmet from 'helmet';
import session from 'express-session';
import MongoStore from 'connect-mongo';
import mongoose from 'mongoose';
import { rateLimit } from 'express-rate-limit';
import { requestLogger } from './lib/logger.js';
import { errorMiddleware, notFoundHandler, AppError } from './lib/errors.js';
import { csrfProtection } from './lib/csrf.js';
import { MongoRateLimitStore } from './lib/rateLimitStore.js';
import { authRouter, loadUser } from './modules/auth/index.js';

export function createSessionMiddleware(config) {
  return session({
    name: 'sid',
    secret: config.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({
      client: mongoose.connection.getClient(),
      dbName: mongoose.connection.name,
      collectionName: 'sessions',
    }),
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: config.NODE_ENV === 'production',
      maxAge: 1000 * 60 * 60 * 24 * 7,
    },
  });
}

/**
 * Build the Express app. Needs an open mongoose connection.
 * `extra(app)` mounts extra routes after CSRF-safe middleware (used by test harnesses only).
 */
export function createApp(
  config,
  { sessionMiddleware, rateLimitOptions = {}, mountBefore, mountApi } = {},
) {
  const app = express();
  app.set('trust proxy', 1); // Caddy sits in front
  app.disable('x-powered-by');

  app.use(requestLogger());
  app.use(
    helmet({
      hsts: config.NODE_ENV === 'production',
    }),
  );
  // CORS is deliberately off: the client is served from the same origin.
  app.use(express.json({ limit: '1mb' }));

  const limiter = rateLimit({
    windowMs: 60_000,
    limit: 300,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    store: new MongoRateLimitStore(),
    handler: (_req, _res, next) => next(new AppError(429, 'RATE_LIMITED', 'Too many requests.')),
    ...rateLimitOptions,
  });
  app.use(limiter);

  app.use(sessionMiddleware ?? createSessionMiddleware(config));
  if (mountBefore) mountBefore(app); // test-only hook, runs before CSRF
  app.use(csrfProtection);
  app.use(loadUser);

  app.get('/api/health', async (_req, res) => {
    try {
      await mongoose.connection.db.admin().ping();
      res.json({ data: { ok: true, db: 'up' } });
    } catch {
      res.status(503).json({ data: { ok: false, db: 'down' } });
    }
  });

  app.use('/api/auth', authRouter);
  if (mountApi) mountApi(app);

  app.use(notFoundHandler);
  app.use(errorMiddleware);
  return app;
}
