import { test } from 'node:test';
import assert from 'node:assert/strict';
import { invalidAvailabilityWindows } from '../src/lib/availability.ts';
test('rejects equal, reversed, malformed and invalid-day availability windows', () => {
 const good = { weekday: 2, start: '10:00', end: '11:00' };
 assert.deepEqual(invalidAvailabilityWindows([good]), []);
 for (const bad of [{ ...good, end: '10:00' }, { ...good, end: '09:00' }, { ...good, end: '24:00' }, { ...good, weekday: 7 }, { ...good, start: '9:00' }]) assert.deepEqual(invalidAvailabilityWindows([good,bad]), [1]);
 assert.deepEqual(invalidAvailabilityWindows([]), []);
});
