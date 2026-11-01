import { test, expect } from '@playwright/test';

test('FND-35 the app opens and shows the shell on a phone-sized screen', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Welcome' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeVisible();
});

test('FND-31 at 360 px there is no horizontal scroll and tap targets are at least 44 px', async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Welcome' })).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(overflow).toBe(false);
  for (const link of await page.getByRole('navigation').getByRole('link').all()) {
    const box = await link.boundingBox();
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.width).toBeGreaterThanOrEqual(44);
  }
});

test('FND-31 the skip link is the first focusable element', async ({ page }) => {
  await page.goto('/');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused();
});

test('FND-33 a service worker is registered and API responses are never cached', async ({
  page,
}) => {
  await page.goto('/');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.evaluate(() => fetch('/api/health').catch(() => null));
  const cachedApi = await page.evaluate(async () => {
    const urls = [];
    for (const name of await caches.keys()) {
      for (const req of await (await caches.open(name)).keys()) urls.push(req.url);
    }
    return urls.filter((u) => u.includes('/api/') || u.includes('/socket.io/'));
  });
  expect(cachedApi).toEqual([]);
});

test('FND-33 the app serves a web manifest', async ({ page }) => {
  const res = await page.request.get('/manifest.webmanifest');
  expect(res.ok()).toBe(true);
  expect((await res.json()).display).toBe('standalone');
});
