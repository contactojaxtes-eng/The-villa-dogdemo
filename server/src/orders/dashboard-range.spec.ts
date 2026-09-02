import { dashboardRange } from './dashboard-range';

describe('Dashboard business dates', () => {
  it('includes a full Colombian day with an exclusive upper bound', () => {
    const range = dashboardRange('2026-09-02', '2026-09-02');
    expect(range.from.toISOString()).toBe('2026-09-02T05:00:00.000Z');
    expect(range.until.toISOString()).toBe('2026-09-03T05:00:00.000Z');
  });
  it.each([['2026-02-30', '2026-03-01'], ['2026-09-03', '2026-09-02'], ['invalid', '2026-09-02'], ['2020-01-01', '2026-09-02']])('rejects invalid or unbounded dates %s / %s', (start, end) => {
    expect(() => dashboardRange(start, end)).toThrow();
  });
});
