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

// DEP-01 to DEP-03. Retired departments stay, so history keeps pointing at them.
const departmentSchema = new Schema(
  {
    code: { type: String, required: true, uppercase: true, trim: true },
    name: { type: String, required: true, trim: true },
    retired: { type: Boolean, default: false },
    retired_at: { type: Date },
    // DEP-12: set when the "no active admin" email went out, cleared when an admin is back.
    admin_alert_sent_at: { type: Date },
  },
  { collection: 'department', timestamps: { createdAt: 'created_at', updatedAt: false } },
);
departmentSchema.index({ code: 1 }, { unique: true });
departmentSchema.index({ retired: 1, code: 1 });

export const Department =
  mongoose.models.Department ?? mongoose.model('Department', departmentSchema);

export const AllowedDomain =
  mongoose.models.AllowedDomain ?? mongoose.model('AllowedDomain', allowedDomainSchema);
export const AllowedDomainGuard =
  mongoose.models.AllowedDomainGuard ??
  mongoose.model('AllowedDomainGuard', allowedDomainGuardSchema);
