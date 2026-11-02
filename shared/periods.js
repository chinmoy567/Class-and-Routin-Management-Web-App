/**
 * RTN-17: the standard period columns for the week grid.
 * Each entry is { start_min, end_min, label } — minutes since midnight.
 * Sourced from the CSE routine sheet (PRD: 08:30–09:25 first, 16:35–17:30 last).
 * Adjust here when the confirmed schedule arrives.
 */
export const PERIODS = Object.freeze([
  { start_min: 510, end_min: 565, label: '08:30–09:25' },
  { start_min: 565, end_min: 620, label: '09:25–10:20' },
  { start_min: 620, end_min: 675, label: '10:20–11:15' },
  { start_min: 675, end_min: 730, label: '11:15–12:10' },
  { start_min: 730, end_min: 785, label: '12:10–13:05' },
  { start_min: 785, end_min: 840, label: '13:05–14:00' },
  { start_min: 840, end_min: 895, label: '14:00–14:55' },
  { start_min: 895, end_min: 950, label: '14:55–15:50' },
  { start_min: 950, end_min: 1005, label: '15:50–16:45' },
  { start_min: 1005, end_min: 1050, label: '16:45–17:30' },
]);
