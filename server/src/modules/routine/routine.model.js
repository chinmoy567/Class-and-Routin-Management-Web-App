import mongoose from 'mongoose';

const { Schema } = mongoose;
const oid = (extra = {}) => ({ type: Schema.Types.ObjectId, ...extra });

// A section of one department's batch for a semester. Created by the first import that names it.
const sectionSchema = new Schema(
  {
    semester_id: oid({ required: true }),
    department_id: oid({ required: true }),
    level: { type: Number, required: true, min: 1, max: 4 },
    term: { type: String, required: true, enum: ['I', 'II'] },
    letter: { type: String, required: true },
    created_by_import_of: oid(), // IMP-27: the department whose import created it, if not its own
    closed_at: { type: Date },
  },
  { collection: 'section', timestamps: { createdAt: 'created_at', updatedAt: false } },
);
sectionSchema.index(
  { semester_id: 1, department_id: 1, level: 1, term: 1, letter: 1 },
  { unique: true },
);

const groupSchema = new Schema(
  {
    section_id: oid({ required: true }),
    label: { type: String, required: true },
  },
  { collection: 'section_group' },
);
groupSchema.index({ section_id: 1, label: 1 }, { unique: true });

// IMP-03, IMP-33
const importSchema = new Schema(
  {
    semester_id: oid({ required: true }),
    department_id: oid({ required: true }),
    file_id: oid(),
    status: { type: String, enum: ['checked', 'failed', 'published', 'replaced'], required: true },
    rows: { type: [Schema.Types.Mixed], default: [] },
    teachers: { type: [Schema.Types.Mixed], default: [] },
    issues: { type: [Schema.Types.Mixed], default: [] },
    counts: { type: Schema.Types.Mixed, default: {} }, // { rows, errors, warnings }
    keep_choices: { type: Schema.Types.Mixed, default: {} },
    uploaded_by: oid({ required: true }),
    uploaded_at: { type: Date, required: true },
    published_by: oid(),
    published_at: { type: Date },
  },
  { collection: 'routine_import', minimize: false },
);
// IMP-03: one open import per department and semester.
importSchema.index(
  { semester_id: 1, department_id: 1 },
  { unique: true, partialFilterExpression: { status: 'checked' } },
);
importSchema.index({ semester_id: 1, department_id: 1, uploaded_at: -1 });

const slotSchema = new Schema(
  {
    semester_id: oid({ required: true }),
    owner_department_id: oid({ required: true }),
    section_id: oid({ required: true }),
    group_id: oid(),
    day_of_week: { type: Number, required: true, min: 0, max: 4 },
    start_min: { type: Number, required: true },
    end_min: { type: Number, required: true },
    course_code: { type: String, required: true },
    course_name: { type: String },
    room_id: oid({ required: true }),
    source: { type: String, enum: ['import', 'manual'], required: true },
    tba: { type: Boolean, default: false },
    edited_by_hand: { type: Boolean, default: false }, // set by spec 08
    combined_key: { type: String },
    published: { type: Boolean, default: false },
    import_id: oid(),
  },
  { collection: 'routine_slot', timestamps: true },
);
slotSchema.index({ semester_id: 1, section_id: 1, published: 1 });
slotSchema.index({ semester_id: 1, room_id: 1, day_of_week: 1 });
slotSchema.index({ semester_id: 1, owner_department_id: 1 });

const slotTeacherSchema = new Schema(
  {
    slot_id: oid({ required: true }),
    teacher_id: oid({ required: true }),
  },
  { collection: 'routine_slot_teacher' },
);
slotTeacherSchema.index({ slot_id: 1, teacher_id: 1 }, { unique: true });
slotTeacherSchema.index({ teacher_id: 1 });

const model = (name, schema) => mongoose.models[name] ?? mongoose.model(name, schema);
export const Section = model('Section', sectionSchema);
export const SectionGroup = model('SectionGroup', groupSchema);
export const RoutineImport = model('RoutineImport', importSchema);
export const RoutineSlot = model('RoutineSlot', slotSchema);
export const RoutineSlotTeacher = model('RoutineSlotTeacher', slotTeacherSchema);
