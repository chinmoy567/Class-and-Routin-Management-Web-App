import mongoose from 'mongoose';

const { Schema } = mongoose;
const oid = (extra = {}) => ({ type: Schema.Types.ObjectId, ...extra });

// Spec 10: the join request and, once accepted, the membership (one document).
const enrolmentSchema = new Schema(
  {
    user_id: oid({ required: true }),
    semester_id: oid({ required: true }),
    section_id: oid({ required: true }),
    department_id: oid(),
    group_id: oid(),
    group_set_by: { type: String, enum: ['cr', 'admin'] },
    uv_claim_id: oid(),
    reason: { type: String },
    appeal: {
      type: new Schema(
        {
          at: { type: Date, required: true },
          status: { type: String, enum: ['open', 'upheld', 'reversed'], required: true },
        },
        { _id: false },
      ),
    },
    status: {
      type: String,
      enum: ['pending', 'accepted', 'rejected', 'withdrawn', 'revoked'],
      required: true,
    },
    escalated_at: { type: Date },
    decided_by: oid(),
    decided_at: { type: Date },
  },
  { collection: 'enrolment', timestamps: { createdAt: 'created_at', updatedAt: false } },
);
// One accepted enrolment per student per semester.
enrolmentSchema.index(
  { user_id: 1, semester_id: 1 },
  { unique: true, partialFilterExpression: { status: 'accepted' } },
);
// One pending request per student.
enrolmentSchema.index(
  { user_id: 1 },
  { unique: true, partialFilterExpression: { status: 'pending' } },
);
enrolmentSchema.index({ section_id: 1, status: 1, created_at: 1 });

export const Enrolment = mongoose.models.Enrolment ?? mongoose.model('Enrolment', enrolmentSchema);
