import * as s from './calendar.service.js';

export async function listEvents(req, res) {
  const data = await s.listCalendarEvents(req.user, req.query);
  res.json({ data });
}

export async function createEvent(req, res) {
  const result = await s.createCalendarEvent(req.user, req.body);
  if (!result.saved) return res.json(result);
  res.status(201).json({ data: result.event });
}

export async function updateEvent(req, res) {
  const result = await s.updateCalendarEvent(req.user, req.params.id, req.body);
  if (!result.saved) return res.json(result);
  res.json({ data: result.event });
}

export async function deleteEvent(req, res) {
  await s.deleteCalendarEvent(req.user, req.params.id);
  res.status(204).end();
}

export async function createCancellation(req, res) {
  const cancellation = await s.cancelClass(req.user, req.params.id, req.body);
  res.status(201).json({ data: cancellation });
}

export async function deleteCancellation(req, res) {
  await s.undoCancelClass(req.user, req.params.id, req.params.date);
  res.status(204).end();
}

export async function upcoming(req, res) {
  const data = await s.upcomingEvents(req.user);
  res.json({ data });
}
