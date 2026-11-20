import { describe, it, expect, afterAll, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { connectTestDb, disconnectTestDb } from '../../test/harness.js';
import { createApp, createSessionMiddleware } from '../app.js';
import { getConfig, loadConfig, resetConfigForTests } from '../config.js';
import { requireUploadsEnabled } from '../lib/uploadsGate.js';

await connectTestDb();
afterAll(disconnectTestDb);

const env = (extra = {}) => ({ ...process.env, ...extra });

describe('Render deployment config', () => {
  it('uploads stay on by default and then CLAMAV_HOST is required', () => {
    expect(loadConfig(env({ UPLOADS_ENABLED: undefined })).UPLOADS_ENABLED).toBe(true);
    expect(() => loadConfig(env({ CLAMAV_HOST: undefined }))).toThrow(/CLAMAV_HOST/);
  });

  it('UPLOADS_ENABLED=false makes CLAMAV_HOST optional', () => {
    const cfg = loadConfig(env({ UPLOADS_ENABLED: 'false', CLAMAV_HOST: undefined }));
    expect(cfg.UPLOADS_ENABLED).toBe(false);
  });
});

describe('uploads gate', () => {
  afterEach(() => {
    delete process.env.UPLOADS_ENABLED;
    resetConfigForTests();
  });

  it('refuses with 503 UPLOADS_DISABLED when uploads are off', () => {
    process.env.UPLOADS_ENABLED = 'false';
    resetConfigForTests();
    let err;
    requireUploadsEnabled({}, {}, (e) => (err = e));
    expect(err.status).toBe(503);
    expect(err.code).toBe('UPLOADS_DISABLED');
  });

  it('lets the request through when uploads are on', () => {
    let called = 'unset';
    requireUploadsEnabled({}, {}, (e) => (called = e));
    expect(called).toBeUndefined();
  });
});

describe('serving the built client', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-dist-'));
  fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><title>crm-shell</title>');
  fs.writeFileSync(path.join(dir, 'app.js'), 'console.log(1)');
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

  const app = (serve) =>
    createApp(
      { ...getConfig(), SERVE_CLIENT: serve },
      { sessionMiddleware: createSessionMiddleware(getConfig()), clientDir: dir },
    );

  it('serves files and falls back to index.html for client routes', async () => {
    const a = app(true);
    expect((await request(a).get('/app.js')).status).toBe(200);
    const page = await request(a).get('/routine/week');
    expect(page.status).toBe(200);
    expect(page.text).toContain('crm-shell');
  });

  it('unknown /api paths still return the JSON 404, not the page', async () => {
    const res = await request(app(true)).get('/api/nope');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('serves nothing when SERVE_CLIENT is off', async () => {
    expect((await request(app(false)).get('/routine/week')).status).toBe(404);
  });
});
