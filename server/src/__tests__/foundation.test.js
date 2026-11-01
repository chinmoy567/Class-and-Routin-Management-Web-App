import { describe, it, expect, afterAll, vi } from 'vitest';
import fs from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import mongoose from 'mongoose';
import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { connectTestDb, disconnectTestDb, buildTestApp } from '../../test/harness.js';
import { createApp, createSessionMiddleware } from '../app.js';
import { getConfig } from '../config.js';

await connectTestDb();
afterAll(disconnectTestDb);

const root = new URL('../../../', import.meta.url);
const serverDir = new URL('../../', import.meta.url);
const readJson = (rel) => JSON.parse(fs.readFileSync(new URL(rel, root), 'utf8'));

/** Environment for a child server process: only what the test passes, no .env file. */
function childEnv(extra = {}) {
  const keep = [
    'PATH',
    'Path',
    'SystemRoot',
    'SESSION_SECRET',
    'DATA_ENC_KEY',
    'EMAIL_HMAC_KEY',
    'FILE_LINK_KEY',
    'SMTP_HOST',
    'MAIL_FROM',
    'APP_URL',
    'CLAMAV_HOST',
  ];
  const env = Object.fromEntries(
    keep.filter((k) => process.env[k]).map((k) => [k, process.env[k]]),
  );
  return { ...env, NODE_ENV: 'development', LOG_LEVEL: 'silent', ...extra };
}

const runServer = (env) =>
  spawnSync(process.execPath, ['src/server.js'], {
    cwd: serverDir,
    env,
    encoding: 'utf8',
    timeout: 30_000,
  });

describe('tooling (FND-02, FND-03)', () => {
  it('FND-02 the root has lint, test and build scripts', () => {
    const { scripts } = readJson('package.json');
    for (const name of ['lint', 'test', 'build']) expect(scripts[name], name).toBeTruthy();
  });

  it('FND-02 each workspace has its own test script, and client and server have lint/build', () => {
    for (const ws of ['shared', 'server', 'client']) {
      expect(readJson(`${ws}/package.json`).scripts.test, `${ws} test`).toBeTruthy();
    }
    expect(readJson('client/package.json').scripts.build).toBeTruthy();
  });

  it('FND-03 the CI workflow runs install, lint, test and build on push and pull request', () => {
    const ci = fs.readFileSync(new URL('.github/workflows/ci.yml', root), 'utf8');
    expect(ci).toMatch(/^\s*push:/m);
    expect(ci).toMatch(/^\s*pull_request:/m);
    for (const step of ['npm ci', 'npm run lint', 'npm test', 'npm run build']) {
      expect(ci, step).toContain(step);
    }
    expect(ci).toMatch(/node-version:\s*24/);
  });
});

describe('start-up (FND-04, FND-06, FND-08)', () => {
  it('FND-04 the server exits with code 1 and names a missing DATA_ENC_KEY', () => {
    const env = childEnv({ MONGO_URL: 'mongodb://127.0.0.1:1/x' });
    delete env.DATA_ENC_KEY;
    const res = runServer(env);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain('DATA_ENC_KEY');
  });

  it('FND-06 the server exits with code 1 when MongoDB is not a replica set', async () => {
    const standalone = await MongoMemoryServer.create();
    try {
      const res = runServer(childEnv({ MONGO_URL: standalone.getUri('crm') }));
      expect(res.status).toBe(1);
      expect(res.stderr).toMatch(/replica set/);
    } finally {
      await standalone.stop();
    }
  });

  it('FND-08 starting the server builds the indexes and serves /api/health', async () => {
    const url = new URL(process.env.TEST_MONGO_URI);
    const dbName = `t_boot_${Date.now().toString(36)}`;
    url.pathname = `/${dbName}`;
    const port = 4600 + Math.floor(Math.random() * 300);
    const child = spawn(process.execPath, ['src/server.js'], {
      cwd: serverDir,
      env: childEnv({ MONGO_URL: url.toString(), PORT: String(port) }),
      stdio: 'ignore',
    });
    try {
      let ok = false;
      for (let i = 0; i < 100 && !ok; i++) {
        try {
          ok = (await fetch(`http://127.0.0.1:${port}/api/health`)).ok;
        } catch {
          await new Promise((r) => setTimeout(r, 300));
        }
      }
      expect(ok).toBe(true);
      const db = mongoose.connection.client.db(dbName);
      const indexes = await db.collection('user').indexes();
      expect(indexes.some((i) => i.key.email_hmac === 1 && i.unique)).toBe(true);
      await db.dropDatabase();
    } finally {
      child.kill();
    }
  }, 60_000);
});

describe('HTTP hardening (FND-27)', () => {
  const production = () =>
    createApp(
      { ...getConfig(), NODE_ENV: 'production' },
      { sessionMiddleware: createSessionMiddleware(getConfig()) },
    );

  it('FND-27 production sends Strict-Transport-Security', async () => {
    const res = await request(production()).get('/api/health');
    expect(res.headers['strict-transport-security']).toMatch(/max-age=\d+/);
  });

  it('FND-27 outside production HSTS is not sent', async () => {
    const res = await request(buildTestApp()).get('/api/health');
    expect(res.headers['strict-transport-security']).toBeUndefined();
  });

  it('FND-27 trust proxy makes req.ip the forwarded client address', async () => {
    const app = buildTestApp({
      mountApi(a) {
        a.get('/api/__t__/ip', (req, res) => res.json({ data: { ip: req.ip } }));
      },
    });
    const res = await request(app).get('/api/__t__/ip').set('X-Forwarded-For', '203.0.113.9');
    expect(res.body.data.ip).toBe('203.0.113.9');
  });
});

describe('health (FND-37)', () => {
  it('FND-37 /api/health returns 503 when MongoDB does not answer', async () => {
    const app = buildTestApp();
    const spy = vi.spyOn(mongoose.connection.db, 'admin').mockReturnValue({
      ping: () => Promise.reject(new Error('down')),
    });
    try {
      const res = await request(app).get('/api/health');
      expect(res.status).toBe(503);
      expect(res.body).toEqual({ data: { ok: false, db: 'down' } });
    } finally {
      spy.mockRestore();
    }
  });
});
