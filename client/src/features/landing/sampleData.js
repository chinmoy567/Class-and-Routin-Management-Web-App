/**
 * Example data for the public landing page (PRD: Visitor landing dashboard). It is not a real
 * routine: no name, section, room or time comes from the server, and every label is shown as "Example".
 * Days are Sunday (0) to Thursday (4), the institution week.
 */
export const EXAMPLE_WEEK = [
  {
    day: 0,
    slots: [
      { start: 9, end: 10, title: 'Example course A' },
      { start: 11, end: 12, title: 'Example course B' },
    ],
  },
  {
    day: 1,
    slots: [
      { start: 10, end: 11, title: 'Example course C' },
      { start: 13, end: 14.5, title: 'Example lab' },
    ],
  },
  {
    day: 2,
    slots: [
      { start: 9, end: 10, title: 'Example course D' },
      { start: 12, end: 13, title: 'Example course E' },
    ],
  },
  {
    day: 3,
    slots: [{ start: 11, end: 12.5, title: 'Example course F' }],
  },
  {
    day: 4,
    slots: [
      { start: 9, end: 10, title: 'Example course G' },
      { start: 14, end: 15, title: 'Example tutorial' },
    ],
  },
];

/** The day the example "now" marker sits on in the preview (Monday, the middle of the week). */
export const EXAMPLE_NOW_DAY = 1;
