export type AvailabilityWindow = { weekday: number; start: string; end: string };
export function invalidAvailabilityWindows(windows: AvailabilityWindow[]): number[] {
  const time = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
  return windows.flatMap((w, i) => !Number.isInteger(w.weekday) || w.weekday < 0 || w.weekday > 6 ||
    !time.test(w.start) || !time.test(w.end) || w.start >= w.end ? [i] : []);
}
