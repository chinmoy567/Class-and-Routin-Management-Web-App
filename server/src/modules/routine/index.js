import { registerPolicies } from '../../policy/index.js';
import { routinePolicy } from './routine.policy.js';
import { RoutineSlot, RoutineSlotTeacher, Section } from './routine.model.js';
import { registerRoomUsage } from '../rooms/index.js';
import { registerSectionsProvider } from '../teachers/index.js';
import { currentSemester, openSemesterIds, registerSemesterUsage } from '../organisation/index.js';

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

export { routineRouter } from './routine.routes.js';
export {
  registerAudienceProvider,
  registerRoutineChangeListener,
  resetRoutineHooks,
} from './publish.service.js';
export {
  Section,
  SectionGroup,
  RoutineImport,
  RoutineSlot,
  RoutineSlotTeacher,
} from './routine.model.js';
