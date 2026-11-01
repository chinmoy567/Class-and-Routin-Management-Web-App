import en from '@/i18n/en.json';

/** FND-32: every visible string comes from en.json through t(key, vars). */
export function t(key, vars = {}) {
  const found = key.split('.').reduce((node, part) => node?.[part], en);
  if (typeof found !== 'string') return key;
  return found.replace(/\{(\w+)\}/g, (_, name) => String(vars[name] ?? `{${name}}`));
}
