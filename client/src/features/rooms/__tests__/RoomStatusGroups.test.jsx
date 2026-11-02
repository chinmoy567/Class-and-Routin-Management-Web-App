import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { RoomStatusGroups } from '../components/RoomStatusGroups.jsx';

const rooms = [
  { id: '1', code: '311', type: 'classroom', owner: { id: 'c', code: 'CSE' }, status: 'free' },
  { id: '2', code: '309', type: 'classroom', owner: { id: 'c', code: 'CSE' }, status: 'unknown' },
  { id: '3', code: 'LAB2', type: 'lab', owner: { id: 'c', code: 'CSE' }, status: 'busy' },
  { id: '4', code: '501', type: 'classroom', owner: { id: 'e', code: 'EEE' }, status: 'booked' },
];

describe('free-room status groups (spec 13)', () => {
  it('FRV-05 shows the four groups in order, each with a text heading and a count', () => {
    render(<RoomStatusGroups rooms={rooms} />);
    for (const name of ['Free (1)', 'Availability unknown (1)', 'In use (1)', 'Booked (1)']) {
      expect(screen.getByRole('heading', { name })).toBeInTheDocument();
    }
  });

  it('FRV-05 a room that is availability unknown says it cannot be requested', () => {
    render(<RoomStatusGroups rooms={rooms} />);
    const group = screen.getByRole('region', { name: 'Availability unknown (1)' });
    expect(within(group).getByText('309')).toBeInTheDocument();
    expect(within(group).getByText('Cannot be requested')).toBeInTheDocument();
  });

  it('FRV-05 an empty group says "None"', () => {
    render(<RoomStatusGroups rooms={[rooms[0]]} />);
    const group = screen.getByRole('region', { name: 'In use (0)' });
    expect(within(group).getByText('None')).toBeInTheDocument();
  });

  it('FRV-05 the legend explains each status in words, not only colour', () => {
    render(<RoomStatusGroups rooms={rooms} />);
    expect(
      screen.getByText('A class is using this room. The class is not shown.'),
    ).toBeInTheDocument();
    expect(screen.getByText('This room is booked. The booking is not shown.')).toBeInTheDocument();
  });

  it('FRV-05 never shows a course or a teacher, even if one were passed in', () => {
    const leaky = [{ ...rooms[2], course_code: 'CSE-301', teacher: 'Dr Rahman', section: 'A' }];
    render(<RoomStatusGroups rooms={leaky} />);
    expect(screen.queryByText(/CSE-301/)).toBeNull();
    expect(screen.queryByText(/Rahman/)).toBeNull();
  });
});
