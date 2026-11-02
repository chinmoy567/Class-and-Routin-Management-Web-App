import mongoose from 'mongoose';

const { Schema } = mongoose;
const oid = (extra = {}) => ({ type: Schema.Types.ObjectId, ...extra });

// A student's claim to a UV ID. A pending claim reserves nothing (JR-06).
const uvClaimSchema = new Schema(
  {
    user_id: oid({ required: true }),
    department_id: oid(),
    uv_id_text: { type: String, required: true },
    uv_id_norm: { type: String, required: true },
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected', 'revoked'],
      required: true,
    },
    decided_by: oid(),
    decided_at: { type: Date },
    reason: { type: String },
  },
  { collection: 'uv_claim', timestamps: { createdAt: 'created_at', updatedAt: false } },
);
// JR-06: an ID can be approved for one account only.
uvClaimSchema.index(
  { uv_id_norm: 1 },
  { unique: true, partialFilterExpression: { status: 'approved' } },
);
uvClaimSchema.index({ uv_id_norm: 1, status: 1 });
uvClaimSchema.index({ user_id: 1, status: 1 });

export const UvClaim = mongoose.models.UvClaim ?? mongoose.model('UvClaim', uvClaimSchema);
