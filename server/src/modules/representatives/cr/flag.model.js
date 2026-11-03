import mongoose from 'mongoose';

const { Schema } = mongoose;
const oid = (extra = {}) => ({ type: Schema.Types.ObjectId, ...extra });

// CRD-DSH-08, CRD-DSH-11: a problem a CR or DCR reports to the department admin.
const flagSchema = new Schema(
  {
    section_id: oid({ required: true }),
    semester_id: oid({ required: true }),
    department_id: oid({ required: true }),
    raised_by: oid({ required: true }),
    category: {
      type: String,
      enum: ['wrong_section', 'wrong_group', 'missing_student', 'routine_mistake', 'other'],
      required: true,
    },
    student_id: oid(),
    description: { type: String, required: true, minlength: 10, maxlength: 1000 },
    status: { type: String, enum: ['open', 'fixed', 'rejected'], required: true, default: 'open' },
    reply: { type: String, maxlength: 1000 },
    resolved_by: oid(),
    resolved_at: { type: Date },
  },
  { collection: 'flag', timestamps: { createdAt: 'created_at', updatedAt: false } },
);
flagSchema.index({ section_id: 1, created_at: -1 });
flagSchema.index({ status: 1, created_at: 1 });
flagSchema.index({ department_id: 1, status: 1 });

export const Flag = mongoose.models.Flag ?? mongoose.model('Flag', flagSchema);
