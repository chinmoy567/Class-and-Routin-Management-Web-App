import mongoose from 'mongoose';

const { Schema } = mongoose;

// CRD-DSH-04: one reminder per student per day, across all the section's CR/DCRs.
const reminderSchema = new Schema(
  {
    section_id: { type: Schema.Types.ObjectId, required: true },
    student_id: { type: Schema.Types.ObjectId, required: true },
    date: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    sent_by: { type: Schema.Types.ObjectId, required: true },
  },
  { collection: 'reminder_log', timestamps: { createdAt: 'created_at', updatedAt: false } },
);
reminderSchema.index({ student_id: 1, date: 1 }, { unique: true });

export const ReminderLog =
  mongoose.models.ReminderLog ?? mongoose.model('ReminderLog', reminderSchema);
