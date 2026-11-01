import { t } from '../../../i18n/index.js';

const escapeHtml = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );

/** A plain template: text from the i18n file, and the same text as HTML paragraphs. */
function simple(key) {
  const text = (data) => t(`email.${key}.body`, data);
  return {
    subject: () => t(`email.${key}.subject`),
    text,
    html: (data) =>
      text(data)
        .split('\n\n')
        .map((p) => `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`)
        .join(''),
  };
}

/**
 * Each template has a text and an HTML version, both built from the i18n file.
 * The auth templates are here (spec 01); the rest of the catalogue comes with spec 15.
 */
const templates = {
  test: simple('test'),
  verify_email: simple('verify_email'),
  already_registered: simple('already_registered'),
  email_change_confirm: simple('email_change_confirm'),
  email_changed_notice: simple('email_changed_notice'),
  reset_password: simple('reset_password'),
  password_changed: simple('password_changed'),
  failed_logins: simple('failed_logins'),
  second_step_code: simple('second_step_code'),
  admin_role_changed: simple('admin_role_changed'),
  admin_password_reset: simple('admin_password_reset'),
  admin_second_step_reset: simple('admin_second_step_reset'),
  no_active_admin: simple('no_active_admin'),
  teacher_approved: simple('teacher_approved'),
  teacher_rejected: simple('teacher_rejected'),
};

export function renderTemplate(name, data = {}) {
  const tpl = templates[name];
  if (!tpl) throw new Error(`Unknown email template: ${name}`);
  return { subject: tpl.subject(data), text: tpl.text(data), html: tpl.html(data) };
}
