import { describe, it, expect } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import { WeekGrid } from '../components/WeekGrid.jsx';
import { placeSlots } from '../utils.js';
import { PERIODS } from '@crm/shared';
import { t } from '@/lib/i18n';

const slot = (over) => ({
  slot_id: over.course_code,
  section_label: '2-II A',
  group: null,
  room_code: '311',
  teachers: [],
  ...over,
});

describe('RTN-17 the week grid placement', () => {
  it('RTN-17 the period columns are the nine columns of the CSE routine sheet', () => {
    expect(PERIODS.map((p) => p.label)).toEqual([
      '08:30–09:25',
      '09:30–10:25',
      '10:30–11:25',
      '11:35–12:30',
      '12:35–13:30',
      '13:35–14:30',
      '14:35–15:30',
      '15:35–16:30',
      '16:35–17:30',
    ]);
  });

  it('RTN-17 a two-period lab is one block spanning its periods, not repeated', () => {
    const { starts, covered } = placeSlots(
      [slot({ course_code: 'CSE-LAB', start_min: 510, end_min: 625 })],
      PERIODS,
    );
    expect(starts.get(0).span).toBe(2);
    expect(covered.has(1)).toBe(true);
    expect(covered.has(2)).toBe(false);
  });

  it('RTN-17 a class starting at 09:30 sits in the 09:30 row, not the row before', () => {
    const { starts } = placeSlots(
      [slot({ course_code: 'CSE-300', start_min: 570, end_min: 625 })],
      PERIODS,
    );
    expect(starts.get(1).slot.course_code).toBe('CSE-300');
    expect(starts.has(0)).toBe(false);
  });

  it('RTN-17 the rendered grid shows a lab once with rowspan 2, and the class in its own row', () => {
    render(
      <WeekGrid
        today="2027-04-04"
        week={[
          {
            day_of_week: 0,
            slots: [
              slot({
                course_code: 'CSE-LAB',
                start_min: 510,
                end_min: 625,
                teachers: [{ short_code: 'AR', full_name: 'Abdur Rahman' }],
              }),
              slot({
                course_code: 'CSE-300',
                start_min: 630,
                end_min: 685,
                teachers: [{ short_code: 'SBK', full_name: 'S. B. Khan' }],
              }),
            ],
          },
        ]}
      />,
    );
    expect(screen.getAllByText('CSE-LAB')).toHaveLength(1);
    expect(screen.getByText('CSE-LAB').closest('td')).toHaveAttribute('rowspan', '2');
    expect(screen.getByText('CSE-300').closest('tr')).toHaveTextContent('10:30–11:25');
  });

  it('RTN-17 the running class is marked in its cell', () => {
    render(
      <WeekGrid
        today="2027-04-04"
        runningSlotId="run-1"
        week={[
          {
            day_of_week: 0,
            slots: [
              slot({
                slot_id: 'run-1',
                course_code: 'CSE-421',
                start_min: 510,
                end_min: 565,
                teachers: [],
              }),
              slot({
                slot_id: 'later-1',
                course_code: 'CSE-300',
                start_min: 630,
                end_min: 685,
                teachers: [],
              }),
            ],
          },
        ]}
      />,
    );
    const running = screen.getByText('CSE-421').closest('td');
    expect(running).toHaveAttribute('aria-current', 'true');
    expect(within(running).getByText(t('routine.runningNow'))).toBeInTheDocument();
    expect(screen.getByText('CSE-300').closest('td')).not.toHaveAttribute('aria-current');
  });

  it('RTN-17 a cell shows the short code, and the full names appear when it is tapped', () => {
    render(
      <WeekGrid
        today="2027-04-04"
        week={[
          {
            day_of_week: 0,
            slots: [
              slot({
                course_code: 'CSE-300',
                start_min: 510,
                end_min: 565,
                teachers: [{ short_code: 'AR', full_name: 'Abdur Rahman' }],
              }),
            ],
          },
        ]}
      />,
    );
    expect(screen.queryByText('Abdur Rahman')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'AR' }));
    expect(screen.getByText('Abdur Rahman')).toBeInTheDocument();
  });
});
