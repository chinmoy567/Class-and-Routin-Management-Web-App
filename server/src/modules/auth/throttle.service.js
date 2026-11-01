import { LoginThrottle } from './auth.model.js';
import { clock } from '../../lib/time.js';

// AUTH-14, AUTH-15
export const FREE_TRIES = 5; // after this many failures in the window, waits begin
export const WINDOW_MS = 15 * 60 * 1000;
export const HOUR_MS = 60 * 60 * 1000;
export const MAX_WAIT_SECONDS = 5 * 60;
export const ALERT_AT = 10;

export const accountKey = (emailHmac) => `acct:${emailHmac}`;
export const ipKey = (ip) => `ip:${ip}`;

const coll = () => LoginThrottle.collection;

/**
 * What a sign-in attempt must respect right now: how long it still has to wait, and whether a
 * CAPTCHA is required (5 or more failures inside the 15 minute window on either key).
 */
export async function checkThrottle(keys) {
  const now = clock.now();
  const docs = await LoginThrottle.find({ key: { $in: keys } }).lean();
  let waitMs = 0;
  let captchaRequired = false;
  for (const doc of docs) {
    if (doc.next_allowed_at)
      waitMs = Math.max(waitMs, doc.next_allowed_at.getTime() - now.getTime());
    const windowActive =
      doc.first_fail_at && now.getTime() - doc.first_fail_at.getTime() <= WINDOW_MS;
    if (windowActive && doc.fails >= FREE_TRIES) captchaRequired = true;
  }
  return { waitMs: Math.max(0, waitMs), captchaRequired };
}

/**
 * Count one failed try on a key. It is one atomic update, so concurrent failures are never lost.
 * From the 5th failure on, the next try must wait 1 s, 2 s, 4 s ... up to 5 minutes.
 */
export async function recordFailure(key) {
  const now = clock.now();
  const windowStart = new Date(now.getTime() - WINDOW_MS);
  const hourStart = new Date(now.getTime() - HOUR_MS);
  const present = (field) => ({ $ne: [{ $type: field }, 'missing'] });
  const doc = await coll().findOneAndUpdate(
    { key },
    [
      {
        $set: {
          _window: { $and: [present('$first_fail_at'), { $gte: ['$first_fail_at', windowStart] }] },
          _hour: { $and: [present('$hour_started_at'), { $gte: ['$hour_started_at', hourStart] }] },
        },
      },
      {
        $set: {
          fails: { $cond: ['$_window', { $add: ['$fails', 1] }, 1] },
          first_fail_at: { $cond: ['$_window', '$first_fail_at', now] },
          hour_fails: { $cond: ['$_hour', { $add: ['$hour_fails', 1] }, 1] },
          hour_started_at: { $cond: ['$_hour', '$hour_started_at', now] },
          updated_at: now,
        },
      },
      {
        $set: {
          next_allowed_at: {
            $cond: [
              { $gte: ['$fails', FREE_TRIES] },
              {
                $add: [
                  now,
                  {
                    $multiply: [
                      1000,
                      {
                        $min: [
                          MAX_WAIT_SECONDS,
                          { $pow: [2, { $subtract: ['$fails', FREE_TRIES] }] },
                        ],
                      },
                    ],
                  },
                ],
              },
              null,
            ],
          },
        },
      },
      { $unset: ['_window', '_hour'] },
    ],
    { upsert: true, returnDocument: 'after' },
  );
  return doc;
}

/** A good sign-in resets the account's counter. */
export async function clearAccount(emailHmac) {
  await coll().deleteOne({ key: accountKey(emailHmac) });
}

/**
 * AUTH-15: true once per hour when an account has had 10 failures inside the hour. The
 * conditional update lets exactly one concurrent caller win.
 */
export async function claimOwnerAlert(emailHmac) {
  const now = clock.now();
  const claimed = await coll().findOneAndUpdate(
    {
      key: accountKey(emailHmac),
      hour_fails: { $gte: ALERT_AT },
      $or: [
        { notified_at: { $exists: false } },
        { notified_at: { $lt: new Date(now.getTime() - HOUR_MS) } },
      ],
    },
    { $set: { notified_at: now } },
  );
  return Boolean(claimed);
}
