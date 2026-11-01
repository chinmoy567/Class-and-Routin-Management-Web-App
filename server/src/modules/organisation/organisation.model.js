import mongoose from 'mongoose';

const { Schema } = mongoose;

const allowedDomainSchema = new Schema(
  { domain: { type: String, required: true, lowercase: true, trim: true } },
  { collection: 'allowed_domain', timestamps: true },
);
allowedDomainSchema.index({ domain: 1 }, { unique: true });

// One document. Every add or remove writes to it first inside its transaction, so two changes
// at once conflict and run one after the other (mongo-patterns §6). That keeps "at least one
// domain remains" true even when two removals arrive together.
const allowedDomainGuardSchema = new Schema(
  { _id: { type: String }, version: { type: Number, default: 0 } },
  { collection: 'allowed_domain_guard', versionKey: false },
);

export const AllowedDomain =
  mongoose.models.AllowedDomain ?? mongoose.model('AllowedDomain', allowedDomainSchema);
export const AllowedDomainGuard =
  mongoose.models.AllowedDomainGuard ??
  mongoose.model('AllowedDomainGuard', allowedDomainGuardSchema);
