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
import {
  authRouter,
  meRouter,
  meProfileRouter,
  usersRouter,
  adminUsersRouter,
  adminRolesRouter,
  loadUser,
  requireAuth,
  enforceSessionLifetime,
  secondStepGate,
} from './modules/auth/index.js';
import {
  departmentsAdminRouter,
  departmentsPublicRouter,
  organisationRouter,
  semestersAdminRouter,
  semestersRouter,
} from './modules/organisation/index.js';
import { roomsAdminRouter, roomsRouter } from './modules/rooms/index.js';
import { teachersAdminRouter, teachersMeRouter } from './modules/teachers/index.js';

// AUTH-21, AUTH-22: sessions live in MongoDB. `stringify: false` keeps `session.userId` as a
// queryable field so all of an account's sessions can be found (AUTH-23). The cookie's maximum
// age is set per request by enforceSessionLifetime (14 days, or 30 minutes for an admin).
export function createSessionMiddleware(config) {
  return session({
    name: 'sid',
    secret: config.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    store: MongoStore.create({
      client: mongoose.connection.getClient(),
      dbName: mongoose.connection.name,
      collectionName: 'sessions',
      stringify: false,
    }),
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: config.NODE_ENV === 'production',
      maxAge: 1000 * 60 * 60 * 24 * 14,
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
  app.use(loadUser); // AUTH-24: state and roles are read fresh on every request
  app.use(enforceSessionLifetime);
  app.use(secondStepGate);

  app.get('/api/health', async (_req, res) => {
    try {
      await mongoose.connection.db.admin().ping();
      res.json({ data: { ok: true, db: 'up' } });
    } catch {
      res.status(503).json({ data: { ok: false, db: 'down' } });
    }
  });

  app.use('/api/auth', authRouter);
  app.use('/api/me', meRouter);
  app.use('/api/me', meProfileRouter);
  app.use('/api/me', teachersMeRouter);
  app.use('/api/users', usersRouter);
  app.use('/api/departments', departmentsPublicRouter);
  app.use('/api/admin', requireAuth, organisationRouter);
  app.use('/api/admin', requireAuth, adminUsersRouter);
  app.use('/api/admin', requireAuth, departmentsAdminRouter);
  app.use('/api/admin', requireAuth, semestersAdminRouter);
  app.use('/api/semesters', requireAuth, semestersRouter);
  app.use('/api/admin', requireAuth, roomsAdminRouter);
  app.use('/api/rooms', requireAuth, roomsRouter);
  app.use('/api/admin', requireAuth, adminRolesRouter);
  app.use('/api/admin', requireAuth, teachersAdminRouter);
  if (mountApi) mountApi(app);

  app.use(notFoundHandler);
  app.use(errorMiddleware);
  return app;
}
