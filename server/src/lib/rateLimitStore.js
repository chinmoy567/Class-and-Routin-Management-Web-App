import mongoose from 'mongoose';
import { clock } from './time.js';

/**
 * express-rate-limit store on MongoDB (collection `rate_limits`).
 * One document per key; the update is a single atomic pipeline, so concurrent hits never lose counts.
 */
export class MongoRateLimitStore {
  constructor({ collection = 'rate_limits', prefix = '' } = {}) {
    this.collectionName = collection;
    this.prefix = prefix;
  }

  init(options) {
    this.windowMs = options.windowMs;
  }

  get coll() {
    return mongoose.connection.collection(this.collectionName);
  }

  /** Create the TTL index (documents vanish once their window has ended). */
  async ensureIndexes() {
    await this.coll.createIndex({ reset_at: 1 }, { expireAfterSeconds: 0 });
  }

  async increment(key) {
    const now = clock.now();
    const next = new Date(now.getTime() + this.windowMs);
    const active = { $gt: ['$reset_at', now] };
    const doc = await this.coll.findOneAndUpdate(
      { _id: this.prefix + key },
      [
        {
          $set: {
            count: { $cond: [active, { $add: ['$count', 1] }, 1] },
            reset_at: { $cond: [active, '$reset_at', next] },
          },
        },
      ],
      { upsert: true, returnDocument: 'after' },
    );
    return { totalHits: doc.count, resetTime: doc.reset_at };
  }

  async decrement(key) {
    await this.coll.updateOne({ _id: this.prefix + key, count: { $gt: 0 } }, { $inc: { count: -1 } });
  }

  async resetKey(key) {
    await this.coll.deleteOne({ _id: this.prefix + key });
  }
}
