import { t } from '../../../i18n/index.js';
import { getConfig } from '../../../config.js';
import { logger } from '../../../lib/logger.js';

const escapeHtml = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );

/** A plain template: text from the i18n file, and the same text as HTML paragraphs. */
function simple(key) {
  // EML-03: every email ends with the app link, even when its body does not name it.
  const text = (data) => {
    const body = t(`email.${key}.body`, data);
    return body.includes(data.link) ? body : `${body}\n\nOpen the app: ${data.link}`;
  };
  return {
    subject: (data) => t(`email.${key}.subject`, data),
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
  department_without_admin: simple('department_without_admin'),
  teacher_approved: simple('teacher_approved'),
  teacher_rejected: simple('teacher_rejected'),
  routine_changed: simple('routine_changed'),
  class_cancelled: simple('class_cancelled'),
  class_restored: simple('class_restored'),
  room_request_result: simple('room_request_result'),
  booking_cancelled: simple('booking_cancelled'),
  request_expired: simple('request_expired'),
  admin_digest: simple('admin_digest'),
  semester_update_reminder: simple('semester_update_reminder'),
  role_assigned: simple('role_assigned'),
  role_removed: simple('role_removed'),
  join_accepted: simple('join_accepted'),
  join_rejected: simple('join_rejected'),
  group_changed: simple('group_changed'),
};

/** EML-03: every email carries the app link. A caller may override it (tests do). */
export function renderTemplate(name, data = {}) {
  const tpl = templates[name];
  if (!tpl) throw new Error(`Unknown email template: ${name}`);
  const full = { link: getConfig().APP_URL, ...data };
  const message = { subject: tpl.subject(full), text: tpl.text(full), html: tpl.html(full) };
  // A caller that forgot a value would send "{name}" to a person. Fail in development and tests;
  // in production, log it and still send (a failed job would retry the same mistake).
  const unfilled = [...new Set(Object.values(message).flatMap((p) => p.match(/\{\w+\}/g) ?? []))];
  if (unfilled.length) {
    const detail = `Email template ${name} has unfilled placeholders: ${unfilled.join(' ')}`;
    if (getConfig().NODE_ENV === 'production') logger.error(detail);
    else throw new Error(detail);
  }
  return message;
}

/** The catalogue names every template uses (spec 15). Used by the snapshot test. */
export const TEMPLATE_NAMES = Object.keys(templates);
