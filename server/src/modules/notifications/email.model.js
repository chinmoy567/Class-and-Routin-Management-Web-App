import mongoose from 'mongoose';

const { Schema } = mongoose;

// EML-06: routine-change items waiting to be sent as one email per person and kind.
const emailBatchSchema = new Schema(
  {
    user_id: { type: Schema.Types.ObjectId, required: true },
    kind: { type: String, required: true },
    semester_name: { type: String, default: '' },
    items: { type: [String], default: [] },
    first_at: { type: Date, required: true },
    flush_scheduled: { type: Boolean, default: false },
  },
  { collection: 'email_batch', timestamps: false },
);
emailBatchSchema.index({ user_id: 1, kind: 1 }, { unique: true });

// EML-04: an email key that was queued in the last 24 hours. Removed by TTL after `at` expires.
const emailDedupeSchema = new Schema(
  {
    key: { type: String, required: true },
    at: { type: Date, required: true },
  },
  { collection: 'email_dedupe', timestamps: false },
);
emailDedupeSchema.index({ key: 1 }, { unique: true });
emailDedupeSchema.index({ at: 1 }, { expireAfterSeconds: 24 * 3600 });

export const EmailBatch =
  mongoose.models.EmailBatch ?? mongoose.model('EmailBatch', emailBatchSchema);
export const EmailDedupe =
  mongoose.models.EmailDedupe ?? mongoose.model('EmailDedupe', emailDedupeSchema);
