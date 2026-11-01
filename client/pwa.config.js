// FND-33: the service worker may cache the app shell, but never API or socket traffic.
export const workbox = {
  navigateFallback: '/index.html',
  navigateFallbackDenylist: [/^\/api\//, /^\/socket\.io\//],
  runtimeCaching: [
    { urlPattern: /^\/api\//, handler: 'NetworkOnly' },
    { urlPattern: /^\/socket\.io\//, handler: 'NetworkOnly' },
  ],
};
