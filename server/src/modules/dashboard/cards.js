// DSH-02: later specs add their own cards here. A card is built only when its release is live and
// its kind matches the viewer, so an unreleased card's provider is never called.
import { isReleased } from '@crm/shared';

const registry = [];

/**
 * @param {{ feature: string, key: string, kinds: string[], build: (actor) => Promise<unknown> }} card
 */
export function registerDashboardCard(card) {
  registry.push(card);
}

export function resetDashboardCards() {
  registry.length = 0;
}

/** The data for every released, applicable card, keyed by each card's `key`. */
export async function buildRegisteredCards(actor, release) {
  const out = {};
  for (const card of registry) {
    if (!card.kinds.includes(actor.kind)) continue;
    if (!isReleased(card.feature, release)) continue;
    out[card.key] = await card.build(actor);
  }
  return out;
}
