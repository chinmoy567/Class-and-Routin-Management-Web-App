import { t } from '../../i18n/index.js';
import { clock } from '../../lib/time.js';
import { listAdminScopes } from '../auth/index.js';
import { enqueue } from './mail.service.js';

export const DIGEST_JOB = 'email.admin_digest';

/** EML-08: digest providers. Each module registers the waiting items it owns. */
const providers = [];

/**
 * `labelKey`: an i18n key for the item name. `count({ departmentIds })`: how many items are
 * waiting in scope (`null` = every department). Providers return counts only, never names.
 */
export function registerDigestProvider({ key, labelKey, count }) {
  providers.push({ key, labelKey, count });
}

export const resetDigestProviders = () => {
  providers.length = 0;
};

/** The waiting items in one admin's scope: [{ key, label, count }], only those above zero. */
export async function buildDigest(scope) {
  const out = [];
  for (const p of providers) {
    const count = await p.count({ departmentIds: scope.departmentIds });
    if (count > 0) out.push({ key: p.key, label: t(p.labelKey), count });
  }
  return out;
}

/**
 * Send each admin with waiting items their digest. Nothing is sent when nothing waits (EML-08).
 * The dedupe key is per admin and per run hour, so a retried run does not send twice.
 */
export async function sendAdminDigests() {
  const runHour = clock.now().toISOString().slice(0, 13);
  const sent = [];
  for (const scope of await listAdminScopes()) {
    const items = await buildDigest(scope);
    if (items.length === 0) continue;
    const lines = items.map((i) => `- ${i.label}: ${i.count}`).join('\n');
    await enqueue({
      to_user_id: scope.user_id,
      template: 'admin_digest',
      data: { items: lines },
      dedupe_key: `digest:${scope.user_id}:${runHour}`,
    });
    sent.push(scope.user_id);
  }
  return sent;
}
