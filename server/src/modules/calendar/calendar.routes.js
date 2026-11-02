import { Router } from 'express';
import {
  calendarEventsQuery,
  eventCreateBody,
  eventUpdateBody,
  eventIdParam,
  cancellationBody,
  cancellationParams,
} from '@crm/shared';
import { validate } from '../../lib/validate.js';
import { requireAuth } from '../auth/index.js';
import * as c from './calendar.controller.js';

export const calendarRouter = Router();

// CAL-14: upcoming events for the signed-in user.
calendarRouter.get('/calendar/upcoming', requireAuth, c.upcoming);

// Event CRUD — accessible to admins and active users.
calendarRouter.get(
  '/calendar-events',
  requireAuth,
  validate({ query: calendarEventsQuery }),
  c.listEvents,
);
calendarRouter.post(
  '/calendar-events',
  requireAuth,
  validate({ body: eventCreateBody }),
  c.createEvent,
);
calendarRouter.patch(
  '/calendar-events/:id',
  requireAuth,
  validate({ params: eventIdParam, body: eventUpdateBody }),
  c.updateEvent,
);
calendarRouter.delete(
  '/calendar-events/:id',
  requireAuth,
  validate({ params: eventIdParam }),
  c.deleteEvent,
);

// Single-class cancellation — admin of slot's owning department.
calendarRouter.post(
  '/slots/:id/cancellations',
  requireAuth,
  validate({ params: eventIdParam, body: cancellationBody }),
  c.createCancellation,
);
calendarRouter.delete(
  '/slots/:id/cancellations/:date',
  requireAuth,
  validate({ params: cancellationParams }),
  c.deleteCancellation,
);
