import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildTestApp,
  clearDb,
  clearOutbox,
  connectTestDb,
  disconnectTestDb,
  drainMail,
  startTestMail,
  stopTestMail,
} from '../../../../test/harness.js';
import { makeUser } from '../../../../test/factories.js';
import { getConfig } from '../../../config.js';
import { createApp } from '../../../app.js';
import { enqueue, getOutbox } from '../index.js';
import { renderTemplate, TEMPLATE_NAMES } from '../templates/index.js';
import en from '../../../i18n/en.json' with { type: 'json' };

// Fake data for every template. No real address, phone or name of another user appears here.
const FAKE = {
  name: 'Ayesha Rahman',
  semester: 'Fall 2026',
  department: 'Computer Science',
  date: '8 Nov 2026',
  course_code: 'CSE 301',
  room: 'Room 312',
  changes: '3-II-A (Sun, Tue): CSE 301, CSE 305',
  items: '- Teacher registrations waiting: 2',
  outcome: 'approved',
};
const PHONE_LIKE = /\+?\d[\d -]{9,}\d/;

// Every {placeholder} the English email strings use, so each one is filled in the render.
const PLACEHOLDERS = [
  ...new Set(
    Object.values(en.email).flatMap((t) =>
      [...`${t.subject} ${t.body}`.matchAll(/\{(\w+)\}/g)].map((m) => m[1]),
    ),
  ),
];
// The link is the app URL, filled by renderTemplate itself.
const FILLED = Object.fromEntries(
  PLACEHOLDERS.filter((k) => k !== 'link').map((k) => [k, FAKE[k] ?? `sample-${k}`]),
);

describe('email templates (EML-03)', () => {
  it('EML-03 every template renders a subject, a text and an HTML version with the app link', () => {
    for (const name of TEMPLATE_NAMES) {
      const m = renderTemplate(name, FILLED);
      expect(m.subject, name).toBeTruthy();
      expect(m.text, name).not.toMatch(/{w+}/); // no placeholder left unfilled
      expect(m.text, name).toContain(getConfig().APP_URL);
      expect(m.html, name).toContain('<p>');
    }
  });

  it('EML-03 no template shows an email address or a phone-like number', () => {
    for (const name of TEMPLATE_NAMES) {
      const m = renderTemplate(name, FILLED);
      for (const part of [m.subject, m.text, m.html]) {
        expect(part, name).not.toContain('@');
        expect(part, name).not.toMatch(PHONE_LIKE);
      }
    }
  });

  it('EML-03 the rendered catalogue does not change (snapshot of every template)', () => {
    const all = Object.fromEntries(TEMPLATE_NAMES.map((n) => [n, renderTemplate(n, FILLED)]));
    expect(all).toMatchSnapshot();
  });

  it('EML-03 the calendar cancellation and restore emails name the class and the date', () => {
    const cancelled = renderTemplate('class_cancelled', FAKE);
    const restored = renderTemplate('class_restored', FAKE);
    expect(cancelled.text).toContain('CSE 301');
    expect(cancelled.text).toContain('8 Nov 2026');
    expect(restored.text).toContain('back on');
  });

  it('EML-03 HTML escapes the values it is given', () => {
    const m = renderTemplate('test', { name: '<script>alert(1)</script>' });
    expect(m.html).toContain('&lt;script&gt;');
    expect(m.html).not.toContain('<script>');
  });

  it('EML-03 an unknown template name is an error, not a blank email', () => {
    expect(() => renderTemplate('no_such_template', {})).toThrow(/Unknown email template/);
  });
});

describe('catalogue names (EML-03)', () => {
  it('every template has its English subject and body', () => {
    for (const name of TEMPLATE_NAMES) {
      expect(en.email[name], name).toBeTruthy();
      expect(en.email[name].subject, name).toBeTruthy();
      expect(en.email[name].body, name).toBeTruthy();
    }
  });

  it('every template name the server sends exists (no typos in enqueue calls)', () => {
    const root = fileURLToPath(new URL('../../../', import.meta.url)); // server/src
    const used = new Set();
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== '__tests__') walk(p);
        } else if (p.endsWith('.js')) {
          const src = fs.readFileSync(p, 'utf8');
          for (const m of src.matchAll(/template:\s*([^,}\n]+)/g)) {
            // A ternary names its templates after the `?`, not in the condition before it.
            const names = m[1].includes('?') ? m[1].slice(m[1].indexOf('?')) : m[1];
            for (const name of names.matchAll(/'([a-z_]+)'/g)) used.add(name[1]);
          }
        }
      }
    };
    walk(root);
    const unknown = [...used].filter((n) => !TEMPLATE_NAMES.includes(n));
    expect(unknown).toEqual([]);
    expect(used.size).toBeGreaterThan(20);
  });
});

describe('dev outbox (EML-11)', () => {
  beforeAll(async () => {
    await connectTestDb();
    await startTestMail();
  });
  beforeEach(async () => {
    await clearDb();
    clearOutbox();
  });
  afterAll(async () => {
    await stopTestMail();
    await disconnectTestDb();
  });

  it('EML-11 in production-like environments the outbox page is not there', async () => {
    const res = await request(buildTestApp()).get('/dev/outbox');
    expect(res.status).toBe(404);
  });

  it('EML-11 in development the outbox lists sent emails, escaped, with clickable links', async () => {
    const user = await makeUser({ kind: 'student', name: '<b>Ayesha</b>' });
    await enqueue({ to_user_id: user._id, template: 'test', data: { name: '<b>Ayesha</b>' } });
    await drainMail();
    expect(getOutbox()).toHaveLength(1);

    const devApp = createApp(
      { ...getConfig(), NODE_ENV: 'development' },
      { sessionMiddleware: (_req, _res, next) => next() },
    );
    const res = await request(devApp).get('/dev/outbox');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.text).toContain(renderTemplate('test', { name: 'Rafi' }).subject);
    expect(res.text).toContain('&lt;b&gt;Ayesha&lt;/b&gt;');
    expect(res.text).not.toContain('<b>Ayesha</b>');
    expect(res.text).toContain(`href="${getConfig().APP_URL}`);
  });
});
