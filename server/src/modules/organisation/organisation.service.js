import { AllowedDomain, AllowedDomainGuard } from './organisation.model.js';
import { assertCan } from '../../policy/index.js';
import { withTransaction } from '../../lib/db.js';
import { AppError } from '../../lib/errors.js';
import { record } from '../audit/index.js';

const GUARD_ID = 'allowed_domain';

/** Idempotently allow an email domain for sign-up. */
export async function addAllowedDomain(domain, { session } = {}) {
  await AllowedDomain.updateOne(
    { domain: domain.toLowerCase() },
    { $setOnInsert: { domain: domain.toLowerCase() } },
    { upsert: true, session },
  );
}

export async function isDomainAllowed(domain) {
  return Boolean(await AllowedDomain.exists({ domain: domain.toLowerCase() }));
}

export async function listDomains(actor) {
  assertCan(actor, 'email_domain.manage');
  const domains = await AllowedDomain.find().sort({ domain: 1 }).lean();
  return domains.map((d) => ({ domain: d.domain }));
}

async function ensureGuard() {
  try {
    await AllowedDomainGuard.updateOne(
      { _id: GUARD_ID },
      { $setOnInsert: { version: 0 } },
      { upsert: true },
    );
  } catch (err) {
    if (err.code !== 11000) throw err; // another request created it first
  }
}

const touchGuard = (session) =>
  AllowedDomainGuard.updateOne({ _id: GUARD_ID }, { $inc: { version: 1 } }, { session });

export async function addDomain(actor, domain) {
  assertCan(actor, 'email_domain.manage');
  await ensureGuard();
  return withTransaction(async (session) => {
    await touchGuard(session);
    if (await AllowedDomain.exists({ domain }).session(session)) {
      throw new AppError(409, 'CONFLICT', 'That domain is already allowed.');
    }
    await AllowedDomain.create([{ domain }], { session });
    await record({
      actor,
      action: 'allowed_domain.add',
      target: { type: 'allowed_domain', id: domain },
      new_value: { domain },
      session,
    });
    return { domain };
  });
}

export async function removeDomain(actor, domain) {
  assertCan(actor, 'email_domain.manage');
  await ensureGuard();
  await withTransaction(async (session) => {
    await touchGuard(session);
    if (!(await AllowedDomain.exists({ domain }).session(session))) {
      throw new AppError(404, 'NOT_FOUND', 'That domain is not on the list.');
    }
    if ((await AllowedDomain.countDocuments().session(session)) <= 1) {
      throw new AppError(409, 'LAST_DOMAIN', 'At least one email domain must remain.');
    }
    await AllowedDomain.deleteOne({ domain }, { session });
    await record({
      actor,
      action: 'allowed_domain.remove',
      target: { type: 'allowed_domain', id: domain },
      old_value: { domain },
      session,
    });
  });
}
