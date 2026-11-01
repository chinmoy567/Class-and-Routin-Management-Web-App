import { t } from '../../../i18n/index.js';

const escapeHtml = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );

/**
 * Each template has a text and an HTML version, both built from the i18n file.
 * The real catalogue comes with spec 15.
 */
const templates = {
  test: {
    subject: () => t('email.test.subject'),
    text: (data) => t('email.test.body', data),
    html: (data) => `<p>${escapeHtml(t('email.test.body', data))}</p>`,
  },
};

export function renderTemplate(name, data = {}) {
  const tpl = templates[name];
  if (!tpl) throw new Error(`Unknown email template: ${name}`);
  return { subject: tpl.subject(data), text: tpl.text(data), html: tpl.html(data) };
}
