import { describe, it, expect } from 'vitest';
import { liveStatus } from '../liveStatus.js';

// Build a minimal routine payload for testing.
// semester: { start_date, end_date }
// days: [{ date, dayRule, slots[] }]
// slots: { slot_id, start_min, end_min, effective_end_min, status, course_code, ... }
function makePayload({ semester, days, isTeacher = false } = {}) {
  return {
    server_time: new Date().toISOString(),
    timezone: 'Asia/Dhaka',
    semester: semester ?? { start_date: '2027-04-04', end_date: '2027-10-04' },
    week: [],
    days: days ?? [],
    bookings: [],
    events: [],
    group_missing: false,
    is_teacher: isTeacher,
  };
}

function makeSlot(overrides = {}) {
  return {
    slot_id: 'slot1',
    course_code: 'CSE-421',
    course_name: 'Operating Systems',
    start_min: 510,
    end_min: 565,
    effective_end_min: 565,
    status: 'runs',
    room_code: '311',
    teachers: [],
    ...overrides,
  };
}

// Asia/Dhaka is UTC+6. 08:30 BDT = 02:30 UTC.
// A ms timestamp that represents a specific BDT time:
function bdtMs(dateStr, hour, minute) {
  // dateStr: YYYY-MM-DD. Subtract 6 h to get UTC.
  return Date.parse(
    `${dateStr}T${String(hour - 6).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00Z`,
  );
}

const SEMESTER = { start_date: '2027-04-04', end_date: '2027-10-04' };

// 2027-04-07 is a Wednesday (day 3) — a teaching day.
const TEACHING_DATE = '2027-04-07';
// Anchor: 2027-04-04 is Sunday (start of semester). Day 0 = Sun.
// Apr 4 Sun, Apr 5 Mon, Apr 6 Tue, Apr 7 Wed, Apr 8 Thu, Apr 9 Fri, Apr 10 Sat.
const REAL_FRIDAY = '2027-04-09';
const REAL_SATURDAY = '2027-04-10';

describe('liveStatus', () => {
  // RTN-08: no_semester outside semester
  it('RTN-08 returns no_semester when today is before the semester', () => {
    const now = bdtMs('2027-04-03', 10, 0); // day before
    const payload = makePayload({
      semester: SEMESTER,
      days: [], // Apr 3 not in payload
    });
    expect(liveStatus(payload, now)).toEqual({ kind: 'no_semester' });
  });

  it('RTN-08 returns no_semester when today is after the semester', () => {
    const now = bdtMs('2027-10-05', 10, 0);
    const payload = makePayload({ semester: SEMESTER, days: [] });
    expect(liveStatus(payload, now)).toEqual({ kind: 'no_semester' });
  });

  // RTN-08: non_teaching_day (Friday)
  it('RTN-08 returns no_classes_today on Friday', () => {
    const now = bdtMs(REAL_FRIDAY, 10, 0);
    const payload = makePayload({
      semester: SEMESTER,
      days: [{ date: REAL_FRIDAY, dayRule: { kind: 'non_teaching_day' }, slots: [] }],
    });
    expect(liveStatus(payload, now)).toEqual({ kind: 'no_classes_today' });
  });

  it('RTN-08 returns no_classes_today on Saturday', () => {
    const now = bdtMs(REAL_SATURDAY, 11, 0);
    const payload = makePayload({
      semester: SEMESTER,
      days: [{ date: REAL_SATURDAY, dayRule: { kind: 'non_teaching_day' }, slots: [] }],
    });
    expect(liveStatus(payload, now)).toEqual({ kind: 'no_classes_today' });
  });

  // RTN-08: closed (full-day event)
  it('RTN-08 returns event with label on a closed day', () => {
    const now = bdtMs(TEACHING_DATE, 10, 0);
    const payload = makePayload({
      semester: SEMESTER,
      days: [
        { date: TEACHING_DATE, dayRule: { kind: 'closed', label: 'Mid-term exam' }, slots: [] },
      ],
    });
    expect(liveStatus(payload, now)).toEqual({ kind: 'event', label: 'Mid-term exam' });
  });

  // RTN-08 + RTN-09: in_class
  it('RTN-08 returns in_class when a running slot straddles now (student)', () => {
    // slot 08:30–09:25 BDT (510–565 min). Now = 08:45 BDT (525 min).
    const now = bdtMs(TEACHING_DATE, 8, 45);
    const slot = makeSlot({ start_min: 510, effective_end_min: 565 });
    const payload = makePayload({
      semester: SEMESTER,
      days: [{ date: TEACHING_DATE, dayRule: { kind: 'normal' }, slots: [slot] }],
      isTeacher: false,
    });
    const result = liveStatus(payload, now);
    expect(result.kind).toBe('in_class');
    expect(result.ends_at).toBe(565);
    expect(result.slot).toBe(slot);
  });

  // RTN-13: teacher gets 'teaching' kind
  it('RTN-13 returns teaching (not in_class) for a teacher', () => {
    const now = bdtMs(TEACHING_DATE, 8, 45);
    const slot = makeSlot({ start_min: 510, effective_end_min: 565 });
    const payload = makePayload({
      semester: SEMESTER,
      days: [{ date: TEACHING_DATE, dayRule: { kind: 'normal' }, slots: [slot] }],
      isTeacher: true,
    });
    expect(liveStatus(payload, now).kind).toBe('teaching');
  });

  // RTN-09: cancelled slot at current time → free
  it('RTN-09 cancelled slot at current time counts as free', () => {
    const now = bdtMs(TEACHING_DATE, 8, 45); // inside 510–565
    const slot = makeSlot({ start_min: 510, effective_end_min: 565, status: 'cancelled' });
    const payload = makePayload({
      semester: SEMESTER,
      days: [{ date: TEACHING_DATE, dayRule: { kind: 'normal' }, slots: [slot] }],
    });
    const result = liveStatus(payload, now);
    expect(result.kind).toBe('free');
  });

  // RTN-08: free when before first slot
  it('RTN-08 returns free before any slot with next pointing to first slot', () => {
    const now = bdtMs(TEACHING_DATE, 7, 0); // 07:00, before 08:30
    const slot = makeSlot({ start_min: 510, effective_end_min: 565 });
    const payload = makePayload({
      semester: SEMESTER,
      days: [{ date: TEACHING_DATE, dayRule: { kind: 'normal' }, slots: [slot] }],
    });
    const result = liveStatus(payload, now);
    expect(result.kind).toBe('free');
    expect(result.next).not.toBeNull();
    expect(result.next.slot.start_min).toBe(510);
    expect(result.next.date).toBe(TEACHING_DATE);
  });

  // RTN-08: free after last slot
  it('RTN-08 returns free after all slots with next pointing to next teaching day', () => {
    const now = bdtMs(TEACHING_DATE, 18, 0); // after all classes
    const slot = makeSlot({ start_min: 510, effective_end_min: 565 });
    // Next teaching day = Apr 8 (Thursday)
    const nextDate = '2027-04-08';
    const nextSlot = makeSlot({ slot_id: 'slot2', start_min: 510, effective_end_min: 565 });
    const payload = makePayload({
      semester: SEMESTER,
      days: [
        { date: TEACHING_DATE, dayRule: { kind: 'normal' }, slots: [slot] },
        { date: nextDate, dayRule: { kind: 'normal' }, slots: [nextSlot] },
      ],
    });
    const result = liveStatus(payload, now);
    expect(result.kind).toBe('free');
    expect(result.next?.date).toBe(nextDate);
  });

  // RTN-10: countdown skips non-teaching days
  it('RTN-10 free on Thursday evening finds Sunday slot, skipping Fri/Sat', () => {
    // Apr 8 is Thursday, Apr 9 Fri, Apr 10 Sat, Apr 11 Sun.
    const thursday = '2027-04-08';
    const friday = '2027-04-09';
    const saturday = '2027-04-10';
    const sunday = '2027-04-11';

    const now = bdtMs(thursday, 18, 0);
    const slotThursday = makeSlot({ start_min: 510, effective_end_min: 565 });
    const slotFriday = makeSlot({ start_min: 510, effective_end_min: 565, slot_id: 'fri' });
    const slotSunday = makeSlot({ start_min: 510, effective_end_min: 565, slot_id: 'sun' });

    const payload = makePayload({
      semester: SEMESTER,
      days: [
        { date: thursday, dayRule: { kind: 'normal' }, slots: [slotThursday] },
        { date: friday, dayRule: { kind: 'non_teaching_day' }, slots: [slotFriday] },
        { date: saturday, dayRule: { kind: 'non_teaching_day' }, slots: [slotSunday] },
        { date: sunday, dayRule: { kind: 'normal' }, slots: [slotSunday] },
      ],
    });
    const result = liveStatus(payload, now);
    expect(result.kind).toBe('free');
    expect(result.next?.date).toBe(sunday);
  });

  // RTN-10: countdown skips closed (event) days
  it('RTN-10 free on Thursday evening skips a closed Sunday, finds Monday', () => {
    const thursday = '2027-04-08';
    const sunday = '2027-04-11';
    const monday = '2027-04-12';
    const now = bdtMs(thursday, 18, 0);

    const slotThursday = makeSlot({ start_min: 510, effective_end_min: 565 });
    const slotSunday = makeSlot({ slot_id: 'sun', start_min: 510, effective_end_min: 565 });
    const slotMonday = makeSlot({ slot_id: 'mon', start_min: 510, effective_end_min: 565 });

    const payload = makePayload({
      semester: SEMESTER,
      days: [
        { date: thursday, dayRule: { kind: 'normal' }, slots: [slotThursday] },
        { date: '2027-04-09', dayRule: { kind: 'non_teaching_day' }, slots: [] },
        { date: '2027-04-10', dayRule: { kind: 'non_teaching_day' }, slots: [] },
        { date: sunday, dayRule: { kind: 'closed', label: 'Holiday' }, slots: [slotSunday] },
        { date: monday, dayRule: { kind: 'normal' }, slots: [slotMonday] },
      ],
    });
    const result = liveStatus(payload, now);
    expect(result.kind).toBe('free');
    expect(result.next?.date).toBe(monday);
  });

  // RTN-08: classes_over after early-closing cutoff
  it('RTN-08 returns classes_over after cutoff when now >= cutoff_min', () => {
    // cutoff at 12:00 (720 min). Now = 12:30 BDT (750 min).
    const now = bdtMs(TEACHING_DATE, 12, 30);
    const payload = makePayload({
      semester: SEMESTER,
      days: [
        {
          date: TEACHING_DATE,
          dayRule: { kind: 'cutoff', cutoff_min: 720, label: 'Campus Day' },
          slots: [],
        },
      ],
    });
    expect(liveStatus(payload, now)).toEqual({ kind: 'classes_over', label: 'Campus Day' });
  });

  // RTN-08: in_class during cutoff day when before cutoff
  it('RTN-08 returns in_class on a cutoff day when slot is active before cutoff', () => {
    // slot 11:35–12:30 (695–750 min), cutoff at 12:00 (720). Now = 11:45 (705 min).
    const now = bdtMs(TEACHING_DATE, 11, 45);
    const slot = makeSlot({ start_min: 695, effective_end_min: 720 }); // effective end = cutoff
    const payload = makePayload({
      semester: SEMESTER,
      days: [
        {
          date: TEACHING_DATE,
          dayRule: { kind: 'cutoff', cutoff_min: 720, label: 'Campus Day' },
          slots: [slot],
        },
      ],
    });
    const result = liveStatus(payload, now);
    expect(result.kind).toBe('in_class');
    expect(result.ends_at).toBe(720);
  });

  // RTN-11: device clock offset doesn't matter — the function only uses serverNow
  it('RTN-11 uses serverNow not device time: same result regardless of local time', () => {
    // serverNow says it's 08:45 BDT inside the slot.
    const serverNow = bdtMs(TEACHING_DATE, 8, 45);
    const slot = makeSlot({ start_min: 510, effective_end_min: 565 });
    const payload = makePayload({
      semester: SEMESTER,
      days: [{ date: TEACHING_DATE, dayRule: { kind: 'normal' }, slots: [slot] }],
    });
    // liveStatus only takes serverNow — the result must be in_class regardless of what Date.now() would say.
    expect(liveStatus(payload, serverNow).kind).toBe('in_class');

    // Simulating a device 20 min fast: device says 09:30 but serverNow is still 08:45.
    // If the device clock were used, it would be after the slot end (09:25) and return free.
    // But liveStatus only takes the serverNow argument — so passing the server time (08:45) is in_class.
    const afterSlotEnd = bdtMs(TEACHING_DATE, 9, 30); // 570 min, after slot end 565
    expect(liveStatus(payload, afterSlotEnd).kind).toBe('free'); // sanity: after slot end is free
    // But if we pass the server time (08:45) it's still in_class:
    expect(liveStatus(payload, serverNow).kind).toBe('in_class');
  });

  // RTN-08: free with no next slot when days array has no future slots
  it('RTN-08 returns free with null next when there are no more running slots in range', () => {
    const now = bdtMs(TEACHING_DATE, 18, 0);
    const payload = makePayload({
      semester: SEMESTER,
      days: [{ date: TEACHING_DATE, dayRule: { kind: 'normal' }, slots: [] }],
    });
    const result = liveStatus(payload, now);
    expect(result.kind).toBe('free');
    expect(result.next).toBeNull();
  });
});
