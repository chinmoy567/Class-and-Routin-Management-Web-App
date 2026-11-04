import mongoose from 'mongoose';

const { Schema } = mongoose;
const oid = (extra = {}) => ({ type: Schema.Types.ObjectId, ...extra });

// CAL-01: calendar event.
const calendarEventSchema = new Schema(
  {
    scope_department_id: oid(), // absent = university scope
    from_date: { type: String, required: true },
    to_date: { type: String, required: true },
    kind: {
      type: String,
      required: true,
      enum: ['holiday', 'prep_leave', 'exam', 'early_closing', 'dept_event'],
    },
    cutoff_min: { type: Number }, // minutes since midnight; only for early_closing / dept_event
    label: { type: String, required: true },
    created_by: oid({ required: true }),
  },
  { collection: 'calendar_event', timestamps: { createdAt: 'created_at', updatedAt: false } },
);

// CAL-06: range lookup and dept filter.
calendarEventSchema.index({ from_date: 1, to_date: 1 });
calendarEventSchema.index({ scope_department_id: 1, from_date: 1 });

export const CalendarEvent =
  mongoose.models.CalendarEvent ?? mongoose.model('CalendarEvent', calendarEventSchema);

// CAL-10: single-class cancellation.
const classCancellationSchema = new Schema(
  {
    slot_id: oid({ required: true }),
    date: { type: String, required: true }, // YYYY-MM-DD (institution time)
    reason: { type: String, required: true },
    created_by: oid({ required: true }),
  },
  { collection: 'class_cancellation', timestamps: { createdAt: 'created_at', updatedAt: false } },
);

// CAL-10: at most one cancellation per slot per date.
classCancellationSchema.index({ slot_id: 1, date: 1 }, { unique: true });

export const ClassCancellation =
  mongoose.models.ClassCancellation ?? mongoose.model('ClassCancellation', classCancellationSchema);
