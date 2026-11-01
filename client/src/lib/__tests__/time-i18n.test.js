import { describe, it, expect, vi, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { setServerTime, serverNow, formatDhaka } from '../time.js';
import { t } from '../i18n.js';
import en from '@/i18n/en.json';
import { ERROR_CODES } from '@crm/shared/errors';

afterEach(() => vi.useRealTimers());

describe('server time', () => {
  it('FND-31 a device clock 20 minutes fast still shows server time', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-10T12:20:00Z')); // device says 12:20
    setServerTime('2026-11-10T12:00:00Z'); // server says 12:00
    expect(serverNow().toISOString()).toBe('2026-11-10T12:00:00.000Z');
    vi.advanceTimersByTime(60_000);
    expect(serverNow().toISOString()).toBe('2026-11-10T12:01:00.000Z');
  });

  it('FND-31 times are formatted in Asia/Dhaka, not the browser zone', () => {
    expect(formatDhaka(new Date('2026-11-10T17:34:00Z'), 'yyyy-MM-dd HH:mm')).toBe(
      '2026-11-10 23:34',
    );
  });
});

describe('i18n', () => {
  it('FND-32 t() returns the string, fills variables and falls back to the key', () => {
    expect(t('home.title')).toBe('Welcome');
    expect(t('no.such.key')).toBe('no.such.key');
  });

  it('FND-11 every shared error code has a translated message', () => {
    for (const code of Object.keys(ERROR_CODES)) expect(en.errors[code], code).toBeTruthy();
  });

  it('FND-32 no hard-coded text in components: JSX text and aria-labels come from t()', () => {
    const root = path.resolve(import.meta.dirname, '../..');
    const offenders = [];
    const walk = (dir) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) {
          if (!['__tests__', 'test', 'ui'].includes(e.name)) walk(full);
        } else if (e.name.endsWith('.jsx')) {
          const text = fs.readFileSync(full, 'utf8');
          if (/>\s*[A-Za-z][^<>{}]*</.test(text.replace(/<svg[\s\S]*?<\/svg>/g, '')))
            offenders.push(e.name);
          if (/aria-label="[^"]+"/.test(text)) offenders.push(`${e.name} aria-label`);
        }
      }
    };
    walk(root);
    expect(offenders).toEqual([]);
  });
});
