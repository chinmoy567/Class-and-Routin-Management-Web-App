import mongoose from 'mongoose';

const { Schema } = mongoose;

// TCH-01, TCH-05
const registrationSchema = new Schema(
  {
    user_id: { type: Schema.Types.ObjectId, required: true },
    department_id: { type: Schema.Types.ObjectId, required: true },
    requested_short_code: { type: String, required: true },
    status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
    reason: { type: String },
    decided_by: { type: Schema.Types.ObjectId },
    decided_at: { type: Date },
  },
  { collection: 'teacher_registration', timestamps: { createdAt: 'created_at', updatedAt: false } },
);
// Only one pending registration per account.
registrationSchema.index(
  { user_id: 1 },
  { unique: true, partialFilterExpression: { status: 'pending' } },
);
registrationSchema.index({ department_id: 1, status: 1, created_at: 1 });

// TCH-07, TCH-08
const teacherSchema = new Schema(
  {
    department_id: { type: Schema.Types.ObjectId, required: true },
    short_code: { type: String, required: true, uppercase: true, trim: true },
    full_name: { type: String, required: true },
    user_id: { type: Schema.Types.ObjectId },
    created_from: { type: String, enum: ['import', 'manual'], default: 'manual' },
  },
  { collection: 'teacher', timestamps: true },
);
teacherSchema.index({ department_id: 1, short_code: 1 }, { unique: true });
// One link per account per department (see the spec's Decisions on Open question 4).
teacherSchema.index(
  { user_id: 1, department_id: 1 },
  { unique: true, partialFilterExpression: { user_id: { $type: 'objectId' } } },
);

export const TeacherRegistration =
  mongoose.models.TeacherRegistration ?? mongoose.model('TeacherRegistration', registrationSchema);
export const Teacher = mongoose.models.Teacher ?? mongoose.model('Teacher', teacherSchema);
