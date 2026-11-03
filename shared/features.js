// DSH-02: which release each dashboard card belongs to. A card whose release is later than the
// current one is not rendered, and its data is never requested.

export const RELEASE_ORDER = Object.freeze({ R1: 1, R2: 2, R3: 3, LATER: 4 });

/** The release the running app is built for. Bump it when a release ships. */
export const CURRENT_RELEASE = 'R1';

export const FEATURE_RELEASE = Object.freeze({
  // Student dashboard
  'dashboard.student.routine': 'R1',
  'dashboard.student.notices': 'R1',
  'dashboard.student.rooms': 'R1',
  'dashboard.student.section': 'R1',
  'dashboard.student.reminders': 'R1',
  'dashboard.student.messages': 'R3',
  'dashboard.student.announcements': 'LATER',
  'dashboard.student.notifications': 'LATER',
  // Teacher dashboard
  'dashboard.teacher.routine': 'R1',
  'dashboard.teacher.notices': 'R1',
  'dashboard.teacher.rooms': 'R1',
  'dashboard.teacher.students': 'R1',
  'dashboard.teacher.account': 'R1',
  'dashboard.teacher.room_requests': 'R2',
  'dashboard.teacher.messages': 'R3',
  'dashboard.teacher.students_status': 'LATER',
  'dashboard.teacher.announcements': 'LATER',
  'dashboard.teacher.notifications': 'LATER',
  // CR/DCR dashboard (spec 17)
  'cr.dashboard': 'R1',
  'cr.room_requests': 'R2',
  // Admin dashboard (spec 18)
  'admin.dashboard': 'R1',
  'admin.room_requests': 'R2',
  // Shared
  'dashboard.representative_message': 'R3',
});

/** True when `feature` is released at `release` (default: the current release). */
export function isReleased(feature, release = CURRENT_RELEASE) {
  const featureRelease = FEATURE_RELEASE[feature];
  if (!featureRelease) throw new Error(`Unknown feature flag: ${feature}`);
  if (!RELEASE_ORDER[release]) throw new Error(`Unknown release: ${release}`);
  return RELEASE_ORDER[featureRelease] <= RELEASE_ORDER[release];
}
