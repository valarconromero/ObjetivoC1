// Line chart of checkpoint levels per skill, as an SVG string.
// mode "band": y = CEFR band (ordinal). mode "score": y = demo score.

import { LEVELS, SKILLS, levelIndex } from './calc.js';

const W = 340;
const H = 210;
const M = { l: 34, r: 74, t: 14, b: 30 };
const PW = W - M.l - M.r;
const PH = H - M.t - M.b;

function valueOf(cp, skill, mode) {
  if (mode === 'band') {
    const i = levelIndex(cp?.levels?.[skill]);
    return i >= 0 ? i : null;
  }
  const s = cp?.scores?.[skill];
  return typeof s === 'number' ? s : null;
}

function niceTicks(min, max, count = 4) {
  const span = Math.max(1, max - min);
  const raw = span / count;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((k) => k * pow).find((s) => s >= raw);
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = lo; v <= hi + 1e-9; v += step) ticks.push(v);
  return ticks;
}

// checkpoints: { [week]: cp }, weeks: checkpoint weeks in order.
export function checkpointChart(checkpoints, weeks, mode = 'band', selected = null) {
  const series = SKILLS.map((sk, i) => ({
    ...sk,
    slot: i + 1,
    points: weeks
      .map((w) => ({ week: w, v: valueOf(checkpoints[w], sk.id, mode) }))
      .filter((p) => p.v != null),
  }));
  const all = series.flatMap((s) => s.points.map((p) => p.v));
  if (!all.length) return null;

  let yTicks;
  let yLabel;
  if (mode === 'band') {
    yTicks = LEVELS.map((_, i) => i);
    yLabel = (v) => LEVELS[v];
  } else {
    yTicks = niceTicks(Math.min(...all), Math.max(...all));
    yLabel = (v) => String(v);
  }
  const yMin = yTicks[0];
  const yMax = yTicks[yTicks.length - 1];
  const x = (w) => M.l + (weeks.length > 1 ? ((w - weeks[0]) / (weeks[weeks.length - 1] - weeks[0])) * PW : PW / 2);
  const y = (v) => M.t + PH - ((v - yMin) / (yMax - yMin || 1)) * PH;
  // In band mode several skills often share a level; offset lines slightly so all stay visible.
  const jitter = mode === 'band' ? [-3, -1, 1, 3] : [0, 0, 0, 0];

  const grid = yTicks
    .map((v) => `<line class="grid" x1="${M.l}" x2="${M.l + PW}" y1="${y(v)}" y2="${y(v)}"/>
      <text class="tick" x="${M.l - 6}" y="${y(v) + 4}" text-anchor="end">${yLabel(v)}</text>`)
    .join('');
  const xTicks = weeks
    .map((w) => `<text class="tick" x="${x(w)}" y="${H - 10}" text-anchor="middle">S${w}</text>`)
    .join('');

  const lines = series
    .map((s, i) => {
      if (!s.points.length) return '';
      const pts = s.points.map((p) => [x(p.week), y(p.v) + jitter[i]]);
      const path = pts.map(([px, py], k) => `${k ? 'L' : 'M'}${px.toFixed(1)},${py.toFixed(1)}`).join('');
      const dots = pts.map(([px, py]) => `<circle class="dot s${s.slot}" cx="${px}" cy="${py}" r="4.5"/>`).join('');
      return `<path class="line s${s.slot}" d="${path}"/>${dots}`;
    })
    .join('');

  // Direct labels at each series' last point, nudged apart to avoid overlap.
  const labels = series
    .filter((s) => s.points.length)
    .map((s) => {
      const last = s.points[s.points.length - 1];
      return { name: s.name, slot: s.slot, y: y(last.v) + jitter[SKILLS.findIndex((k) => k.id === s.id)] };
    })
    .sort((a, b) => a.y - b.y);
  for (let i = 1; i < labels.length; i++) labels[i].y = Math.max(labels[i].y, labels[i - 1].y + 13);
  const labelSvg = labels
    .map((l) => `<line class="line s${l.slot}" x1="${M.l + PW + 6}" x2="${M.l + PW + 16}" y1="${l.y}" y2="${l.y}"/>
      <text class="dlabel" x="${M.l + PW + 20}" y="${l.y + 4}">${l.name}</text>`)
    .join('');

  const hits = weeks
    .map((w, i) => {
      const prev = i ? (x(weeks[i - 1]) + x(w)) / 2 : M.l - 10;
      const next = i < weeks.length - 1 ? (x(w) + x(weeks[i + 1])) / 2 : M.l + PW + 10;
      return `<rect class="hit" data-action="cp-readout" data-week="${w}" x="${prev}" y="${M.t}" width="${next - prev}" height="${PH}"/>`;
    })
    .join('');

  const cross = weeks.includes(selected)
    ? `<line class="cross" x1="${x(selected)}" x2="${x(selected)}" y1="${M.t}" y2="${M.t + PH}"/>`
    : '';

  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Evolución por parte en los checkpoints">
    ${grid}<line class="axis" x1="${M.l}" x2="${M.l + PW}" y1="${M.t + PH}" y2="${M.t + PH}"/>
    ${xTicks}${cross}${lines}${labelSvg}${hits}</svg>`;
}
