import { registerPolicies } from '../../policy/index.js';
import { calendarPolicy } from './calendar.policy.js';

registerPolicies(calendarPolicy);

export { calendarRouter } from './calendar.routes.js';
export { CalendarEvent, ClassCancellation } from './calendar.model.js';
export {
  listCalendarEvents,
  upcomingEvents,
  createCalendarEvent,
  updateCalendarEvent,
  deleteCalendarEvent,
  cancelClass,
  undoCancelClass,
  getCancellationsForSlots,
  getEventsForDepartment,
  registerBookingAffectedProvider,
  resetBookingAffectedProviders,
  registerBookingEffectHandler,
  resetBookingEffectHandlers,
} from './calendar.service.js';
export {
  registerCalendarAudienceProvider,
  resetCalendarAudienceProviders,
  getAudienceForSections,
} from './hooks.js';
