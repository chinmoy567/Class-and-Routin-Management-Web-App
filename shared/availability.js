/**
 * FRV-03: two ranges overlap when `start₁ < end₂ && start₂ < end₁`. Ranges that only touch
 * (one ends where the other starts) do not overlap. Pure, so the client and the server agree.
 */
export const rangesOverlap = (start1, end1, start2, end2) => start1 < end2 && start2 < end1;
