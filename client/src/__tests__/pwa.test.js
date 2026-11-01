import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { workbox } from '../../pwa.config.js';

describe('PWA', () => {
  it('FND-33 API and socket requests are network-only and never served from the shell', () => {
    for (const path of ['/api/me/routine', '/socket.io/?EIO=4']) {
      expect(
        workbox.navigateFallbackDenylist.some((re) => re.test(path)),
        path,
      ).toBe(true);
      const rule = workbox.runtimeCaching.find((r) => r.urlPattern.test(path));
      expect(rule?.handler, path).toBe('NetworkOnly');
    }
    expect(workbox.runtimeCaching.every((r) => r.handler === 'NetworkOnly')).toBe(true);
  });

  it('FND-33 the manifest makes the app installable (name, start_url, standalone, icon)', () => {
    const config = fs.readFileSync(
      path.resolve(import.meta.dirname, '../../vite.config.js'),
      'utf8',
    );
    expect(config).toMatch(/display: 'standalone'/);
    expect(config).toMatch(/start_url: '\/'/);
    expect(config).toMatch(/\/icons\/icon\.svg/);
    expect(fs.existsSync(path.resolve(import.meta.dirname, '../../public/icons/icon.svg'))).toBe(
      true,
    );
  });
});
