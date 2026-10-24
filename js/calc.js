// Pure helpers: dates, plan weeks, totals, streak, CSV and formatting.
// No DOM or storage access, so everything here can be unit-tested in Node.

export const DEFAULT_START = '2026-10-26';
export const PLAN_WEEKS = 24;
export const WEEKLY_GOAL_MIN = 600;
export const STREAK_MIN = 30;
export const DEFAULT_CHECKPOINTS = [1, 8, 16, 20, 23];

export const BLOCKS = [
  { id: 'speaking', name: 'Speaking', hours: 3 },
  { id: 'listening', name: 'Listening', hours: 2.5 },
  { id: 'writing', name: 'Writing', hours: 1.5 },
  { id: 'reading', name: 'Reading', hours: 1 },
  { id: 'grammar', name: 'Gramática y vocabulario', hours: 1.5 },
  { id: 'shadowing', name: 'Shadowing', hours: 0.5 },
];

export const SKILLS = [
  { id: 'reading', name: 'Reading' },
  { id: 'listening', name: 'Listening' },
  { id: 'writing', name: 'Writing' },
  { id: 'speaking', name: 'Speaking' },
];

export const LEVELS = ['A2', 'B1', 'B2', 'B2+', 'C1', 'C2'];

const DAY_MS = 86400000;

export function blockName(id) {
  return BLOCKS.find((b) => b.id === id)?.name ?? id;
}

// Blocks with their weekly targets, letting the plan override hours/description by id.
export function planBlocks(plan) {
  const overrides = new Map((plan?.blocks ?? []).map((b) => [b.id, b]));
  return BLOCKS.map((b) => {
    const o = overrides.get(b.id) ?? {};
    const hours = typeof o.hours === 'number' ? o.hours : b.hours;
    return { ...b, hours, what: o.what ?? '' };
  });
}

// --- Dates (always local calendar days as "YYYY-MM-DD") ---

export function toISODate(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function dayNumber(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / DAY_MS);
}

export function addDays(iso, n) {
  const d = new Date((dayNumber(iso) + n) * DAY_MS);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(fromIso, toIso) {
  return dayNumber(toIso) - dayNumber(fromIso);
}

// Week 1 is the 7 days starting on `start`; earlier dates give 0 or negative weeks.
export function weekOf(dateIso, startIso = DEFAULT_START) {
  return Math.floor(daysBetween(startIso, dateIso) / 7) + 1;
}

export function weekRange(week, startIso = DEFAULT_START) {
  const from = addDays(startIso, (week - 1) * 7);
  return { from, to: addDays(from, 6) };
}

export function localDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

// --- Totals ---

export function sessionsInWeek(sessions, week, startIso) {
  return sessions.filter((s) => weekOf(s.date, startIso) === week);
}

export function minutesByBlock(sessions) {
  const out = Object.fromEntries(BLOCKS.map((b) => [b.id, 0]));
  for (const s of sessions) out[s.block] = (out[s.block] ?? 0) + s.minutes;
  return out;
}

export function totalMinutes(sessions) {
  return sessions.reduce((sum, s) => sum + s.minutes, 0);
}

export function minutesByDate(sessions) {
  const out = new Map();
  for (const s of sessions) out.set(s.date, (out.get(s.date) ?? 0) + s.minutes);
  return out;
}

// Consecutive days with >= STREAK_MIN minutes. A streak stays alive today
// until midnight: if today isn't done yet, counting starts from yesterday.
export function streak(sessions, todayIso = toISODate(), min = STREAK_MIN) {
  const byDate = minutesByDate(sessions);
  const todayMinutes = byDate.get(todayIso) ?? 0;
  const todayDone = todayMinutes >= min;
  let day = todayDone ? todayIso : addDays(todayIso, -1);
  let current = 0;
  while ((byDate.get(day) ?? 0) >= min) {
    current++;
    day = addDays(day, -1);
  }

  let best = 0;
  let run = 0;
  let prev = null;
  const days = [...byDate.entries()].filter(([, m]) => m >= min).map(([d]) => d).sort();
  for (const d of days) {
    run = prev && daysBetween(prev, d) === 1 ? run + 1 : 1;
    best = Math.max(best, run);
    prev = d;
  }
  return { current, best, todayMinutes, todayDone };
}

// --- Checkpoints ---

export function levelIndex(level) {
  return LEVELS.indexOf(level);
}

// Lowest skill of a checkpoint: by band first, then by score.
export function weakestSkill(cp) {
  let worst = null;
  for (const sk of SKILLS) {
    const level = cp?.levels?.[sk.id];
    if (!level) continue;
    const score = cp.scores?.[sk.id];
    const rank = [levelIndex(level), typeof score === 'number' ? score : Infinity];
    if (!worst || rank[0] < worst.rank[0] || (rank[0] === worst.rank[0] && rank[1] < worst.rank[1])) {
      worst = { skill: sk, level, score, rank };
    }
  }
  return worst;
}

// --- CSV ---

export function csvCell(value, sep = ';') {
  const s = value == null ? '' : String(value);
  return /["\r\n]/.test(s) || s.includes(sep) ? `"${s.replace(/"/g, '""')}"` : s;
}

// Semicolon-separated with a BOM so Spanish-locale Excel opens it in columns.
export function toCSV(rows, sep = ';') {
  return '﻿' + rows.map((r) => r.map((c) => csvCell(c, sep)).join(sep)).join('\r\n') + '\r\n';
}

// --- Formatting ---

export function formatMinutes(min) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (!h) return `${m} min`;
  return m ? `${h} h ${m} min` : `${h} h`;
}

export function formatHours(min) {
  const h = Math.round((min / 60) * 10) / 10;
  return `${String(h).replace('.', ',')} h`;
}

export function formatDuration(sec) {
  const s = Math.round(sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function slugify(text, max = 40) {
  return String(text)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max) || 'material';
}

export function wordCount(text) {
  return String(text).trim().split(/\s+/).filter(Boolean).length;
}
