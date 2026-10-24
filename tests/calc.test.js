import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BLOCKS, addDays, csvCell, formatHours, formatMinutes, minutesByBlock, planBlocks, sessionsInWeek,
  streak, toCSV, weakestSkill, weekOf, weekRange, wordCount,
} from '../js/calc.js';

const START = '2026-10-26';
const s = (date, block, minutes) => ({ id: `${date}-${block}-${minutes}`, date, block, minutes, ts: 0 });

test('weekly targets add up to 10 hours', () => {
  assert.equal(BLOCKS.reduce((n, b) => n + b.hours, 0), 10);
});

test('weekOf counts Monday-to-Sunday weeks from the start date', () => {
  assert.equal(weekOf('2026-10-26', START), 1);
  assert.equal(weekOf('2026-11-01', START), 1);
  assert.equal(weekOf('2026-11-02', START), 2);
  assert.equal(weekOf('2026-10-25', START), 0);
  assert.equal(weekOf('2027-04-05', START), 24);
  assert.equal(weekOf('2027-04-11', START), 24);
  assert.equal(weekOf('2027-04-12', START), 25);
});

test('weekOf is not affected by the DST change on 2026-10-25 or 2027-03-28', () => {
  assert.equal(weekOf('2027-03-29', START), 23);
  assert.equal(weekRange(23, START).from, '2027-03-29');
});

test('weekRange returns the 7 days of a plan week', () => {
  assert.deepEqual(weekRange(1, START), { from: '2026-10-26', to: '2026-11-01' });
  assert.deepEqual(weekRange(9, START), { from: '2026-12-21', to: '2026-12-27' });
});

test('addDays crosses months and years', () => {
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2027-03-01', -1), '2027-02-28');
});

test('weekly totals by block only include that week', () => {
  const list = [s('2026-10-26', 'speaking', 30), s('2026-11-01', 'speaking', 45), s('2026-11-02', 'reading', 20), s('2026-10-27', 'listening', 15)];
  const week1 = sessionsInWeek(list, 1, START);
  assert.equal(week1.length, 3);
  const by = minutesByBlock(week1);
  assert.equal(by.speaking, 75);
  assert.equal(by.listening, 15);
  assert.equal(by.reading, 0);
});

test('streak counts consecutive days with at least 30 minutes', () => {
  const list = [
    s('2026-11-01', 'speaking', 30),
    s('2026-11-02', 'reading', 10), s('2026-11-02', 'grammar', 20), // 30 split in two
    s('2026-11-03', 'listening', 45),
  ];
  assert.deepEqual(streak(list, '2026-11-03'), { current: 3, best: 3, todayMinutes: 45, todayDone: true });
});

test('streak stays alive until today is over', () => {
  const list = [s('2026-11-01', 'speaking', 30), s('2026-11-02', 'speaking', 30), s('2026-11-03', 'reading', 10)];
  const r = streak(list, '2026-11-03');
  assert.equal(r.current, 2);
  assert.equal(r.todayMinutes, 10);
  assert.equal(r.todayDone, false);
});

test('streak breaks after a missed day but best is kept', () => {
  const list = ['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-05'].map((d) => s(d, 'speaking', 40));
  const r = streak(list, '2026-11-06');
  assert.equal(r.current, 1);
  assert.equal(r.best, 3);
  assert.equal(streak(list, '2026-11-07').current, 0);
});

test('weakestSkill uses band first and score as tie-break', () => {
  const cp = { levels: { reading: 'C1', listening: 'B2+', writing: 'B2+', speaking: 'C1' }, scores: { listening: 130, writing: 121 } };
  const w = weakestSkill(cp);
  assert.equal(w.skill.id, 'writing');
  assert.equal(weakestSkill({ levels: {} }), null);
});

test('planBlocks merges plan descriptions and hour overrides by id', () => {
  const b = planBlocks({ blocks: [{ id: 'speaking', hours: 4, what: 'Role-play' }] });
  assert.equal(b[0].hours, 4);
  assert.equal(b[0].what, 'Role-play');
  assert.equal(b[1].hours, 2.5);
});

test('CSV escapes separators, quotes and newlines and starts with a BOM', () => {
  assert.equal(csvCell('a;b'), '"a;b"');
  assert.equal(csvCell('say "hi"'), '"say ""hi"""');
  assert.equal(csvCell(null), '');
  const csv = toCSV([['fecha', 'minutos'], ['2026-10-26', 30]]);
  assert.equal(csv, '﻿fecha;minutos\r\n2026-10-26;30\r\n');
});

test('formatting helpers', () => {
  assert.equal(formatMinutes(45), '45 min');
  assert.equal(formatMinutes(90), '1 h 30 min');
  assert.equal(formatMinutes(120), '2 h');
  assert.equal(formatHours(150), '2,5 h');
  assert.equal(formatHours(600), '10 h');
  assert.equal(wordCount('  Hello   world\nagain '), 3);
  assert.equal(wordCount(''), 0);
});
