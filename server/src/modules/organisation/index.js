import { AllowedDomain } from './organisation.model.js';

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
