import { describe, it, expect, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import { z } from 'zod';
import mongoose from 'mongoose';
import { Writable } from 'node:stream';
import { connectTestDb, disconnectTestDb, buildTestApp, loginAs } from '../../test/harness.js';
import { makeUser } from '../../test/factories.js';
import { AppError, errorMiddleware } from '../lib/errors.js';
import { validate } from '../lib/validate.js';
import { createLogger } from '../lib/logger.js';
import { ERROR_CODES } from '@crm/shared/errors';
import { MongoRateLimitStore } from '../lib/rateLimitStore.js';

await connectTestDb();
afterAll(disconnectTestDb);

describe('errors and validation', () => {
  const app = buildTestApp({
    mountApi(app) {
      app.get('/api/__t__/boom', () => {
        throw new Error('secret internals at /srv/app.js');
      });
      app.get('/api/__t__/app-error', () => {
        throw new AppError(409, 'CONFLICT', 'Already there.', { name: 'taken' });
      });
      app.post(
        '/api/__t__/echo/:id',
        validate({
          body: z.object({ n: z.coerce.number().int().min(1) }),
          query: z.object({ page: z.coerce.number().default(1) }),
          params: z.object({ id: z.string().min(3) }),
        }),
        (req, res) =>
          res.json({ data: { n: req.body.n, page: req.query.page, id: req.params.id } }),
      );
    },
  });

  it('FND-09 an unknown error returns 500 INTERNAL with no details', async () => {
    const res = await request(app).get('/api/__t__/boom');
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: { code: 'INTERNAL', message: 'Something went wrong.' } });
    expect(JSON.stringify(res.body)).not.toMatch(/secret|stack|srv/);
  });

  it('FND-09 an AppError keeps its status, code and fields', async () => {
    const res = await request(app).get('/api/__t__/app-error');
    expect(res.status).toBe(409);
    expect(res.body).toEqual({
      error: { code: 'CONFLICT', message: 'Already there.', fields: { name: 'taken' } },
    });
  });

  it('FND-09 the unknown error is logged in full', () => {
    const lines = [];
    const sink = new Writable({
      write(chunk, _enc, cb) {
        lines.push(chunk.toString());
        cb();
      },
    });
    const log = createLogger({ level: 'info', destination: sink });
    const res = { status: () => ({ json: () => {} }) };
    errorMiddleware(new Error('kaboom'), { log }, res, () => {});
    expect(lines.join('')).toMatch(/kaboom/);
  });

  it('FND-10 validate replaces input with parsed values', async () => {
    const agent = await loginAs(null, app);
    const res = await agent.post('/api/__t__/echo/abc?page=3').send({ n: '7' });
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ n: 7, page: 3, id: 'abc' });
  });

  it('FND-10 validate returns 400 VALIDATION_ERROR with per-field messages', async () => {
    const agent = await loginAs(null, app);
    const res = await agent.post('/api/__t__/echo/ab').send({ n: 0 });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(Object.keys(res.body.error.fields).sort()).toEqual(['n', 'params.id']);
  });

  it('FND-11 error codes in shared/errors.js cover the spec table', () => {
    expect(Object.keys(ERROR_CODES).sort()).toEqual(
      [
        'ALREADY_DECIDED',
        'CONFLICT',
        'CSRF_FAILED',
        'FORBIDDEN',
        'INTERNAL',
        'NOT_FOUND',
        'RATE_LIMITED',
        'SECOND_STEP_REQUIRED',
        'STATE_NOT_ALLOWED',
        'UNAUTHENTICATED',
        'VALIDATION_ERROR',
      ].sort(),
    );
    expect(ERROR_CODES.CSRF_FAILED.status).toBe(403);
    expect(ERROR_CODES.RATE_LIMITED.status).toBe(429);
  });

  it('FND-09 an unknown route returns NOT_FOUND', async () => {
    const res = await request(app).get('/api/nothing-here');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});

describe('security middleware', () => {
  const app = buildTestApp({
    mountApi(app) {
      app.post('/api/__t__/write', (_req, res) => res.json({ data: { ok: true } }));
    },
  });

  it('FND-28 a POST without a CSRF token returns 403 CSRF_FAILED', async () => {
    const res = await request(app).post('/api/__t__/write').send({});
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CSRF_FAILED');
  });

  it('FND-28 a wrong token is refused, the right one is accepted', async () => {
    const agent = request.agent(app);
    const { body } = await agent.get('/api/auth/csrf');
    const bad = await agent.post('/api/__t__/write').set('X-CSRF-Token', 'nope').send({});
    expect(bad.body.error.code).toBe('CSRF_FAILED');
    const good = await agent.post('/api/__t__/write').set('X-CSRF-Token', body.data.token).send({});
    expect(good.status).toBe(200);
  });

  it('FND-28 a token from another session is refused', async () => {
    const a = request.agent(app);
    const b = request.agent(app);
    const tokenA = (await a.get('/api/auth/csrf')).body.data.token;
    await b.get('/api/auth/csrf');
    const res = await b.post('/api/__t__/write').set('X-CSRF-Token', tokenA).send({});
    expect(res.body.error.code).toBe('CSRF_FAILED');
  });

  it('FND-28 the session cookie is HTTP-only', async () => {
    const res = await request(app).get('/api/auth/csrf');
    expect(res.headers['set-cookie'].join(';')).toMatch(/HttpOnly/i);
  });

  it('FND-27 helmet headers are set and CORS is off', async () => {
    const res = await request(app).get('/api/health').set('Origin', 'https://evil.example');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('FND-27 a JSON body over 1 MB is refused', async () => {
    const agent = await loginAs(null, app);
    const res = await agent.post('/api/__t__/write').send({ blob: 'x'.repeat(1_100_000) });
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('FND-29 requests over the limit get 429 RATE_LIMITED', async () => {
    const limited = buildTestApp({
      rateLimitOptions: { limit: 3, store: new MongoRateLimitStore({ prefix: 'limited:' }) },
    });
    const statuses = [];
    for (let i = 0; i < 5; i++) statuses.push((await request(limited).get('/api/health')).status);
    expect(statuses).toEqual([200, 200, 200, 429, 429]);
    const res = await request(limited).get('/api/health');
    expect(res.body.error.code).toBe('RATE_LIMITED');
  });

  it('FND-29 the Mongo store counts concurrent hits without losing any', async () => {
    const store = new MongoRateLimitStore({ prefix: 'conc:' });
    store.init({ windowMs: 60_000 });
    const hits = await Promise.all(Array.from({ length: 25 }, () => store.increment('ip')));
    expect(hits.map((h) => h.totalHits).sort((a, b) => a - b)).toEqual(
      Array.from({ length: 25 }, (_, i) => i + 1),
    );
    await store.resetKey('ip');
    expect((await store.increment('ip')).totalHits).toBe(1);
  });

  it('FND-29 the rate limit store has a TTL index', async () => {
    const keys = await mongoose.connection.collection('rate_limits').indexes();
    expect(keys.some((i) => i.key.reset_at === 1 && i.expireAfterSeconds === 0)).toBe(true);
  });
});

describe('logging', () => {
  it('FND-30 sensitive fields are redacted and request bodies are not logged', async () => {
    const lines = [];
    const sink = new Writable({
      write(chunk, _enc, cb) {
        lines.push(chunk.toString());
        cb();
      },
    });
    const log = createLogger({ level: 'info', destination: sink });
    log.info(
      {
        password: 'hunter2',
        token: 'tok',
        email: 'a@b.c',
        phone: '017',
        code: '123456',
        user: { email: 'x@y.z' },
      },
      'sign in',
    );
    const out = lines.join('');
    for (const secret of ['hunter2', 'tok"', 'a@b.c', '017', '123456', 'x@y.z']) {
      expect(out).not.toContain(secret);
    }
    expect(out).toContain('[Redacted]');

    const { requestLogger } = await import('../lib/logger.js');
    const lines2 = [];
    const sink2 = new Writable({
      write(chunk, _enc, cb) {
        lines2.push(chunk.toString());
        cb();
      },
    });
    const app = express();
    app.use(express.json());
    app.use(requestLogger(createLogger({ level: 'info', destination: sink2 })));
    app.post('/p', (_req, res) => res.json({}));
    const res = await request(app).post('/p').send({ password: 'bodysecret' });
    expect(lines2.join('')).not.toContain('bodysecret');
    expect(lines2.join('')).toMatch(/"id":/);
    expect(res.headers['x-request-id']).toBeTruthy();
  });
});

describe('health and harness', () => {
  it('FND-37 /api/health returns ok when MongoDB is up', async () => {
    const res = await request(buildTestApp()).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: { ok: true, db: 'up' } });
  });

  it('FND-34 loginAs gives an agent with the session and CSRF token set', async () => {
    const user = await makeUser({ roles: [{ role: 'super_admin' }] });
    const app = buildTestApp({
      mountApi(a) {
        a.post('/api/__t__/me', (req, res) =>
          res.json({ data: { id: String(req.user?._id), roles: req.user?.roles } }),
        );
      },
    });
    const agent = await loginAs(user, app);
    const res = await agent.post('/api/__t__/me').send({});
    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(String(user._id));
    expect(res.body.data.roles).toEqual([{ role: 'super_admin' }]);
  });

  it('FND-16 the request user carries _id, kind, state, chat_suspended_until and in-effect roles', async () => {
    const user = await makeUser({ kind: 'teacher', state: 'pending' });
    expect(Object.keys(user).sort()).toEqual(
      ['_id', 'chat_suspended_until', 'email', 'kind', 'roles', 'state'].sort(),
    );
    expect(user.kind).toBe('teacher');
    expect(user.state).toBe('pending');
  });

  it('FND-34 a user without the CSRF flow still cannot write', async () => {
    const res = await request(buildTestApp()).post('/api/anything').send({});
    expect(res.status).toBe(403);
  });
});
