import { getAreaStatus } from 'src/utils/areaStatus';

describe('getAreaStatus', () => {
  it('returns Not Started', () => {
    expect(getAreaStatus({})).toEqual({ text: 'Not Started', hue: 'gray' });
  });
  it('returns In Progress', () => {
    expect(getAreaStatus({ startedAt: { seconds: 1 } })).toEqual({ text: 'In Progress', hue: 'orange' });
  });
  it('returns Completed', () => {
    expect(getAreaStatus({ startedAt: { seconds: 1 }, completedAt: { seconds: 2 } }))
      .toEqual({ text: 'Completed', hue: 'green' });
  });
});
