import mongoose from 'mongoose';

const { Schema } = mongoose;

const allowedDomainSchema = new Schema(
  { domain: { type: String, required: true, lowercase: true, trim: true } },
  { collection: 'allowed_domain', timestamps: true },
);
allowedDomainSchema.index({ domain: 1 }, { unique: true });

export const AllowedDomain =
  mongoose.models.AllowedDomain ?? mongoose.model('AllowedDomain', allowedDomainSchema);
