/**
 * RTN-17: the standard period columns for the week grid, as in the CSE routine sheet
 * (`DOCUMENTS/Dept of CSE Routine Spring 2026.xlsx`, sheet ROUTINE, header row). Nine columns of
 * 55 minutes each, from 08:30–09:25 to 16:35–17:30. Each entry is { start_min, end_min, label }
 * in minutes since midnight, Asia/Dhaka time.
 */
export const PERIODS = Object.freeze([
  { start_min: 510, end_min: 565, label: '08:30–09:25' },
  { start_min: 570, end_min: 625, label: '09:30–10:25' },
  { start_min: 630, end_min: 685, label: '10:30–11:25' },
  { start_min: 695, end_min: 750, label: '11:35–12:30' },
  { start_min: 755, end_min: 810, label: '12:35–13:30' },
  { start_min: 815, end_min: 870, label: '13:35–14:30' },
  { start_min: 875, end_min: 930, label: '14:35–15:30' },
  { start_min: 935, end_min: 990, label: '15:35–16:30' },
  { start_min: 995, end_min: 1050, label: '16:35–17:30' },
]);
