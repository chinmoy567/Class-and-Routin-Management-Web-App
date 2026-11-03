import { registerPolicies } from '../../policy/index.js';
import { routinePolicy } from './routine.policy.js';
import { RoutineSlot, RoutineSlotTeacher, Section } from './routine.model.js';
import { registerRoomUsage, registerAvailabilityProvider } from '../rooms/index.js';
import { publishedDepartments, runningSlots, dayRules } from './availability.provider.js';
import { registerSectionsProvider, registerLinkChangeListener } from '../teachers/index.js';
import { currentSemester, openSemesterIds, registerSemesterUsage } from '../organisation/index.js';
import { clearSectionCache, clearTeacherCache } from './routine-cache.js';

registerPolicies(routinePolicy);

// ROOM-06: a published slot of a draft or current semester keeps its room in use.
registerRoomUsage({
  inUse: async (roomId) =>
    Boolean(
      await RoutineSlot.exists({
        room_id: roomId,
        published: true,
        semester_id: { $in: await openSemesterIds() },
      }),
    ),
});
// SEM-04: a semester with sections is no longer empty.
registerSemesterUsage({ inUse: async (id) => Boolean(await Section.exists({ semester_id: id })) });
// TCH-16: the sections a teacher teaches, from the current semester's published routine.
registerSectionsProvider(async (teacherIds) => {
  const semester = await currentSemester();
  if (!semester) return [];
  const links = await RoutineSlotTeacher.find({ teacher_id: { $in: teacherIds } })
    .select('slot_id')
    .lean();
  const sectionIds = await RoutineSlot.distinct('section_id', {
    _id: { $in: links.map((l) => l.slot_id) },
    semester_id: semester.id,
    published: true,
  });
  return sectionIds.map((id) => ({ section_id: String(id), semester_id: semester.id }));
});

// FRV-02 to FRV-04: the free-room view reads the routine through these providers.
registerAvailabilityProvider({ publishedDepartments, runningSlots, dayRules });

// RTN-14: clear caches when published slots change or teacher links change.
import { registerRoutineChangeListener } from './publish.service.js';
registerRoutineChangeListener(async ({ sectionIds, userIds }) => {
  const semester = await currentSemester();
  if (!semester) return;
  const semId = String(semester._id);
  for (const sid of sectionIds) clearSectionCache(semId, sid);
  for (const uid of userIds) clearTeacherCache(semId, uid);
});
registerLinkChangeListener(async (userId) => {
  const semester = await currentSemester();
  if (!semester) return;
  clearTeacherCache(String(semester._id), String(userId));
});

export { routineRouter } from './routine.routes.js';
export { myRoutineRouter } from './my-routine.routes.js';
export {
  registerAudienceProvider,
  registerRoutineChangeListener,
  resetRoutineHooks,
} from './publish.service.js';
export { registerGroupUsage, resetGroupUsage } from './section.service.js';
export {
  registerBookingClashProvider,
  registerBookingActionHandler,
  resetBookingHooks,
} from './bookings.hooks.js';
export {
  Section,
  SectionGroup,
  RoutineImport,
  RoutineSlot,
  RoutineSlotTeacher,
} from './routine.model.js';
export {
  getSectionBrief,
  findSectionByBatch,
  listSectionsBrief,
  bumpSectionRoleSeq,
  listGroupsOfSections,
  getGroupBrief,
  hasPublishedCleanImport,
} from './section.brief.js';
export { sectionCoursesFor, sectionRoutineFor } from './my-routine.service.js';
export { clearAll as clearRoutineCaches } from './routine-cache.js';
export { routineProblemsFor } from './problems.service.js';
