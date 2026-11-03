import mongoose from 'mongoose';

const { Schema } = mongoose;

// CRD-DSH-11: how many flags a CR/DCR raised on one institution day. Counted inside the flag's
// transaction, so concurrent requests cannot go over the limit.
const flagQuotaSchema = new Schema(
  {
    user_id: { type: Schema.Types.ObjectId, required: true },
    date: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    count: { type: Number, required: true, default: 0, min: 0 },
  },
  { collection: 'flag_quota' },
);
flagQuotaSchema.index({ user_id: 1, date: 1 }, { unique: true });

export const FlagQuota = mongoose.models.FlagQuota ?? mongoose.model('FlagQuota', flagQuotaSchema);
