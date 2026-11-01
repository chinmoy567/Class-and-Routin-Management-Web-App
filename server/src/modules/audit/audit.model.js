import mongoose from 'mongoose';

const { Schema } = mongoose;

const auditLogSchema = new Schema(
  {
    actor_id: { type: Schema.Types.ObjectId, required: true },
    actor_roles: { type: [Schema.Types.Mixed], default: [] },
    action: { type: String, required: true },
    scope_department_id: { type: Schema.Types.ObjectId },
    target_type: { type: String, required: true },
    target_id: { type: Schema.Types.Mixed },
    old_value: { type: Schema.Types.Mixed },
    new_value: { type: Schema.Types.Mixed },
    at: { type: Date, required: true },
    request_id: { type: String },
  },
  { collection: 'audit_log', versionKey: false },
);

auditLogSchema.index({ at: -1 });
auditLogSchema.index({ scope_department_id: 1, at: -1 });
auditLogSchema.index({ target_type: 1, target_id: 1, at: -1 });

// Append-only guard (mongo-patterns §7). The database role is the real guarantee (spec 23).
const forbid = function () {
  throw new Error('audit_log is append-only');
};
for (const op of [
  'updateOne',
  'updateMany',
  'findOneAndUpdate',
  'replaceOne',
  'findOneAndReplace',
  'deleteOne',
  'deleteMany',
  'findOneAndDelete',
]) {
  auditLogSchema.pre(op, { document: false, query: true }, forbid);
}
auditLogSchema.pre('updateOne', { document: true, query: false }, forbid);
auditLogSchema.pre('deleteOne', { document: true, query: false }, forbid);
auditLogSchema.pre('save', function () {
  if (!this.isNew) throw new Error('audit_log is append-only');
});

export const AuditLog = mongoose.models.AuditLog ?? mongoose.model('AuditLog', auditLogSchema);
