import * as db from './db.js';
import {
  BLOCKS, DEFAULT_CHECKPOINTS, DEFAULT_START, LEVELS, PLAN_WEEKS, SKILLS, STREAK_MIN, WEEKLY_GOAL_MIN,
  addDays, blockName, daysBetween, formatDuration, formatHours, formatMinutes, localDate, minutesByBlock, planBlocks,
  sessionsInWeek, slugify, streak, toCSV, toISODate, totalMinutes, weakestSkill, weekOf, weekRange, wordCount,
} from './calc.js';
import { checkpointChart } from './chart.js';
import { renderMarkdown } from './markdown.js';
import { Recorder, extensionFor, recordingSupported } from './recorder.js';
import { createZip, readZip } from './zip.js';

const QUICK_MINUTES = [15, 30, 45, 60];
const BACKUP_REMINDER_DAYS = 14;
const MATERIAL_TYPES = [
  { id: 'link', name: 'Enlaces', one: 'Enlace', icon: '🔗' },
  { id: 'text', name: 'Textos', one: 'Texto', icon: '📝' },
  { id: 'audio', name: 'Audios', one: 'Audio', icon: '🎙️' },
  { id: 'file', name: 'Archivos', one: 'Archivo', icon: '📎' },
];

const state = {
  view: 'hoy',
  sessions: [],
  materials: [],
  checkpoints: {},
  plan: null,
  customPlan: false,
  lastBackup: null,
  pickedBlock: null,
  logDate: null, // null = today
  otherOpen: false,
  weekView: 1,
  planView: 1,
  filterType: 'all',
  filterBlock: 'all',
  chartMode: 'band',
  chartWeek: null,
  urls: [],
};

const $ = (sel, el = document) => el.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const today = () => toISODate();
const start = () => state.plan?.start ?? DEFAULT_START;
const currentWeek = () => weekOf(today(), start());
const totalWeeks = () => state.plan?.weeks_total ?? PLAN_WEEKS;
const checkpointWeeks = () => state.plan?.checkpoints ?? DEFAULT_CHECKPOINTS;
const blocks = () => planBlocks(state.plan);
const clampWeek = (w) => Math.min(Math.max(w, 1), totalWeeks());
const sessionById = (id) => state.sessions.find((s) => s.id === id);
const materialsOf = (sessionId) => state.materials.filter((m) => m.sessionId === sessionId);

const dateFmt = new Intl.DateTimeFormat('es-ES', { weekday: 'short', day: 'numeric', month: 'short' });
const shortFmt = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short' });
const fmtDate = (iso) => dateFmt.format(localDate(iso));
const fmtShort = (iso) => shortFmt.format(localDate(iso));

function relDate(iso) {
  if (iso === today()) return 'Hoy';
  if (iso === addDays(today(), -1)) return 'Ayer';
  return fmtDate(iso);
}

function objectUrl(blob) {
  const url = URL.createObjectURL(blob);
  state.urls.push(url);
  return url;
}

function revokeUrls() {
  state.urls.forEach((u) => URL.revokeObjectURL(u));
  state.urls = [];
}

// ---------- Loading ----------

async function loadData() {
  const [sessions, materials, checkpoints, lastBackup] = await Promise.all([
    db.getAll('sessions'), db.getAll('materials'), db.getAll('checkpoints'), db.getMeta('lastBackup'),
  ]);
  state.sessions = sessions;
  state.materials = materials;
  state.checkpoints = Object.fromEntries(checkpoints.map((c) => [c.week, c]));
  state.lastBackup = lastBackup ?? null;
}

async function loadPlan() {
  const custom = await db.getMeta('customPlan');
  if (custom) {
    state.plan = custom;
    state.customPlan = true;
    return;
  }
  try {
    const res = await fetch('plan.json', { cache: 'no-cache' });
    state.plan = await res.json();
  } catch {
    state.plan = { start: DEFAULT_START, weeks: [], phases: [] };
  }
  state.customPlan = false;
}

async function requestPersist() {
  try {
    if (navigator.storage?.persist && !(await navigator.storage.persisted())) await navigator.storage.persist();
  } catch { /* best effort */ }
}

// ---------- Rendering ----------

function render() {
  revokeUrls();
  const views = { hoy: viewToday, semana: viewWeek, plan: viewPlan, materiales: viewMaterials, progreso: viewProgress };
  $('#view').innerHTML = views[state.view]();
  document.querySelectorAll('.tabbar [data-view]').forEach((b) => b.setAttribute('aria-current', b.dataset.view === state.view ? 'page' : 'false'));
  $('#header-week').textContent = headerWeekText();
  if (state.view === 'progreso') fillStorageInfo();
}

function headerWeekText() {
  const w = currentWeek();
  if (w < 1) {
    const d = daysBetween(today(), start());
    return `Empieza en ${d} ${d === 1 ? 'día' : 'días'}`;
  }
  if (w > totalWeeks()) return 'Plan terminado';
  return `Semana ${w} de ${totalWeeks()}`;
}

function progressBar(value, max, cls = '') {
  const pct = Math.min(100, max ? (value / max) * 100 : 0);
  return `<div class="bar ${cls} ${value >= max ? 'full' : ''}" role="progressbar" aria-valuemin="0" aria-valuemax="${max}" aria-valuenow="${value}"><span style="width:${pct}%"></span></div>`;
}

// ----- Hoy -----

function viewToday() {
  const logDate = state.logDate ?? today();
  const weekSessions = sessionsInWeek(state.sessions, weekOf(logDate, start()), start());
  const byBlock = minutesByBlock(weekSessions);
  const st = streak(state.sessions, today());
  const picked = state.pickedBlock;

  const blockButtons = blocks()
    .map((b) => `<button class="block-btn ${picked === b.id ? 'on' : ''}" data-action="pick-block" data-block="${b.id}" aria-pressed="${picked === b.id}">
        <span class="block-name">${esc(b.name)}</span>
        <span class="block-meta">${formatHours(byBlock[b.id])} / ${formatHours(b.hours * 60)}</span>
      </button>`)
    .join('');

  const minuteButtons = QUICK_MINUTES
    .map((m) => `<button class="chip big" data-action="log-min" data-min="${m}" ${picked ? '' : 'disabled'}>${m}</button>`)
    .join('');

  const other = state.otherOpen
    ? `<form class="other-row" data-form="other">
         <input id="other-min" type="number" inputmode="numeric" min="1" max="600" placeholder="Minutos" required autofocus>
         <button class="btn primary" type="submit">Guardar</button>
       </form>`
    : '';

  return `
    ${backupBanner()}
    <section class="card">
      <div class="card-head">
        <h2>Registrar tiempo</h2>
        <label class="date-pick ${logDate !== today() ? 'past' : ''}">
          <span>${relDate(logDate)}</span>
          <input type="date" data-change="log-date" value="${logDate}" max="${today()}" aria-label="Fecha del registro">
        </label>
      </div>
      <p class="hint">${picked ? `${esc(blockName(picked))}: elige los minutos` : '1. Elige el bloque · 2. Elige los minutos'}</p>
      <div class="block-grid">${blockButtons}</div>
      <div class="minute-row">${minuteButtons}
        <button class="chip big" data-action="log-other" ${picked ? '' : 'disabled'}>Otro</button>
      </div>
      ${other}
    </section>

    <section class="stats">
      <div class="stat">
        <span class="stat-value">${st.current}<small> ${st.current === 1 ? 'día' : 'días'}</small></span>
        <span class="stat-label">Racha${st.best > st.current ? ` · mejor ${st.best}` : ''}</span>
      </div>
      <div class="stat">
        <span class="stat-value">${st.todayMinutes}<small> / ${STREAK_MIN} min</small></span>
        <span class="stat-label">${st.todayDone ? 'Hoy cumplido ✓' : `Faltan ${STREAK_MIN - st.todayMinutes} min hoy`}</span>
      </div>
    </section>

    <section>
      <h2 class="section-title">Últimos registros</h2>
      ${recentList()}
    </section>`;
}

function backupBanner() {
  const hasData = state.sessions.length > 0;
  const last = state.lastBackup;
  const days = last ? Math.floor((Date.now() - last) / 86400000) : Infinity;
  const old = state.sessions.length && Date.now() - Math.min(...state.sessions.map((s) => s.ts)) > BACKUP_REMINDER_DAYS * 86400000;
  if (!hasData || days < BACKUP_REMINDER_DAYS || (!last && !old)) return '';
  return `<div class="banner">
      <span>${last ? `Tu última copia es de hace ${days} días.` : 'Aún no has hecho ninguna copia.'} Los audios solo están en este dispositivo.</span>
      <button class="btn small" data-action="export-zip">Hacer copia</button>
    </div>`;
}

function sessionRow(s) {
  const mats = materialsOf(s.id);
  const icons = MATERIAL_TYPES.map((t) => {
    const n = mats.filter((m) => m.type === t.id).length;
    return n ? `<span class="mat-count" title="${t.name}">${t.icon}${n > 1 ? n : ''}</span>` : '';
  }).join('');
  return `<button class="row" data-action="open-session" data-id="${s.id}">
      <span class="row-main"><strong>${esc(blockName(s.block))}</strong><span class="muted">${icons || '+ material'}</span></span>
      <span class="row-side">${formatMinutes(s.minutes)}</span>
    </button>`;
}

function recentList() {
  if (!state.sessions.length) return '<p class="empty">Todavía no hay registros. Elige un bloque y los minutos para empezar.</p>';
  const from = addDays(today(), -6);
  const recent = state.sessions.filter((s) => s.date >= from).sort((a, b) => b.date.localeCompare(a.date) || b.ts - a.ts);
  if (!recent.length) return '<p class="empty">Nada en los últimos 7 días.</p>';
  const groups = new Map();
  recent.forEach((s) => groups.set(s.date, [...(groups.get(s.date) ?? []), s]));
  return [...groups.entries()]
    .map(([date, list]) => `<div class="group">
        <div class="group-head"><span>${relDate(date)}</span><span>${formatMinutes(totalMinutes(list))}</span></div>
        <div class="list">${list.map(sessionRow).join('')}</div>
      </div>`)
    .join('');
}

// ----- Semana -----

function viewWeek() {
  const w = state.weekView;
  const { from, to } = weekRange(w, start());
  const list = sessionsInWeek(state.sessions, w, start());
  const total = totalMinutes(list);
  const byBlock = minutesByBlock(list);
  const isCurrent = w === currentWeek();
  const remaining = Math.max(0, WEEKLY_GOAL_MIN - total);

  const rows = blocks()
    .map((b) => {
      const target = b.hours * 60;
      const done = byBlock[b.id];
      return `<div class="goal-row">
          <div class="goal-head"><span>${esc(b.name)}</span><span class="${done >= target ? 'ok' : 'muted'}">${formatHours(done)} / ${formatHours(target)}${done >= target ? ' ✓' : ''}</span></div>
          ${progressBar(done, target)}
        </div>`;
    })
    .join('');

  const days = Array.from({ length: 7 }, (_, i) => addDays(from, i));
  const byDay = days.map((d) => totalMinutes(list.filter((s) => s.date === d)));
  const maxDay = Math.max(60, ...byDay);
  const dayBars = days
    .map((d, i) => `<div class="day ${d === today() ? 'today' : ''}" title="${fmtDate(d)}: ${formatMinutes(byDay[i])}">
        <div class="day-bar"><span class="${byDay[i] >= STREAK_MIN ? 'met' : ''}" style="height:${(byDay[i] / maxDay) * 100}%"></span></div>
        <span class="day-label">${dateFmt.formatToParts(localDate(d)).find((p) => p.type === 'weekday').value.slice(0, 2)}</span>
      </div>`)
    .join('');

  return `
    ${weekNav('week', w, `${fmtShort(from)} – ${fmtShort(to)}`)}
    <section class="card">
      <div class="total">
        <span class="total-value">${formatHours(total)}</span>
        <span class="muted">de ${formatHours(WEEKLY_GOAL_MIN)}${isCurrent && remaining ? ` · faltan ${formatMinutes(remaining)}` : ''}${total >= WEEKLY_GOAL_MIN ? ' · objetivo cumplido ✓' : ''}</span>
      </div>
      ${progressBar(total, WEEKLY_GOAL_MIN, 'thick')}
      <div class="days">${dayBars}</div>
    </section>
    <section class="card">
      <h2>Por bloque</h2>
      ${rows}
    </section>`;
}

function weekNav(kind, w, sub) {
  const cur = currentWeek();
  const inPlan = cur >= 1 && cur <= totalWeeks();
  return `<div class="week-nav">
      <button class="icon-btn" data-action="${kind}-prev" ${w <= 1 ? 'disabled' : ''} aria-label="Semana anterior">‹</button>
      <div class="week-title">
        <strong>Semana ${w}</strong>
        <span class="muted">${sub}</span>
        ${w !== cur && inPlan ? `<button class="link-btn" data-action="${kind}-now">Ir a la actual</button>` : ''}
      </div>
      <button class="icon-btn" data-action="${kind}-next" ${w >= totalWeeks() ? 'disabled' : ''} aria-label="Semana siguiente">›</button>
    </div>`;
}

// ----- Plan -----

function viewPlan() {
  const w = state.planView;
  const plan = state.plan ?? {};
  const week = plan.weeks?.find((x) => x.week === w);
  const phase = plan.phases?.find((p) => w >= p.from && w <= p.to);
  const { from, to } = weekRange(w, start());
  const isCp = checkpointWeeks().includes(w);

  const content = week
    ? `<dl class="plan-items">
        <dt>Gramática y vocabulario</dt><dd>${esc(week.grammar)}</dd>
        <dt>Speaking (tema)</dt><dd>${esc(week.speaking)}</dd>
        <dt>Writing</dt><dd>${esc(week.writing)}</dd>
      </dl>
      ${week.note ? `<p class="note">${esc(week.note)}</p>` : ''}`
    : '<p class="empty">Esta semana no tiene contenido en el plan.</p>';

  const typical = blocks()
    .filter((b) => b.what)
    .map((b) => `<li><strong>${esc(b.name)} · ${formatHours(b.hours * 60)}</strong><span>${esc(b.what)}</span></li>`)
    .join('');
  const rules = (plan.rules ?? []).map((r) => `<li><strong>${esc(r.title)}</strong><span>${esc(r.text)}</span></li>`).join('');
  const booking = plan.booking
    ? `<details class="card"><summary>Cuándo reservar el examen</summary>
        <p>${esc(plan.booking.intro)}</p>
        <ul class="plain">${plan.booking.rows.map((r) => `<li><strong>${esc(r.result)}</strong><span>${esc(r.action)}</span></li>`).join('')}</ul>
      </details>`
    : '';

  return `
    ${weekNav('plan', w, `${fmtShort(from)} – ${fmtShort(to)}`)}
    <section class="card">
      ${phase ? `<p class="eyebrow">${esc(phase.name)}</p>` : ''}
      ${isCp ? `<button class="badge" data-action="open-checkpoint" data-week="${w}">Checkpoint: ${w === 1 ? 'demo inicial' : 'demo completa'} ›</button>` : ''}
      ${content}
      ${phase?.goal ? `<p class="muted small">Objetivo de la fase: ${esc(phase.goal)}</p>` : ''}
    </section>
    ${typical ? `<details class="card"><summary>Semana tipo (10 h)</summary><ul class="plain">${typical}</ul></details>` : ''}
    ${rules ? `<details class="card"><summary>Reglas</summary><ul class="plain">${rules}</ul></details>` : ''}
    ${booking}
    <p class="muted small center">${state.customPlan ? 'Usando un plan cargado por ti.' : 'Plan por defecto.'} Puedes cargar otro JSON en Progreso › Datos.</p>`;
}

// ----- Materiales -----

function viewMaterials() {
  const sessions = new Map(state.sessions.map((s) => [s.id, s]));
  const list = state.materials
    .filter((m) => state.filterType === 'all' || m.type === state.filterType)
    .filter((m) => state.filterBlock === 'all' || sessions.get(m.sessionId)?.block === state.filterBlock)
    .sort((a, b) => (sessions.get(b.sessionId)?.date ?? '').localeCompare(sessions.get(a.sessionId)?.date ?? '') || b.ts - a.ts);

  const typeChips = [{ id: 'all', name: 'Todos' }, ...MATERIAL_TYPES]
    .map((t) => `<button class="chip ${state.filterType === t.id ? 'on' : ''}" data-action="filter-type" data-type="${t.id}">${t.name}</button>`)
    .join('');
  const blockOptions = [{ id: 'all', name: 'Todos los bloques' }, ...BLOCKS]
    .map((b) => `<option value="${b.id}" ${state.filterBlock === b.id ? 'selected' : ''}>${esc(b.name)}</option>`)
    .join('');

  const items = list.length
    ? list.map((m) => materialRow(m, sessions.get(m.sessionId))).join('')
    : `<p class="empty">${state.materials.length ? 'Nada con estos filtros.' : 'Aún no hay materiales. Añádelos desde un registro: enlaces, textos, audios o archivos.'}</p>`;

  return `
    <div class="filters">
      <div class="chip-row">${typeChips}</div>
      <select data-change="filter-block" aria-label="Filtrar por bloque">${blockOptions}</select>
    </div>
    <div class="list">${items}</div>`;
}

function materialRow(m, s) {
  const type = MATERIAL_TYPES.find((t) => t.id === m.type);
  const meta = [s ? esc(blockName(s.block)) : '', s ? `${fmtShort(s.date)} · S${weekOf(s.date, start())}` : '',
    m.type === 'audio' && m.durationSec ? formatDuration(m.durationSec) : '',
    m.type === 'text' ? `${wordCount(m.text)} palabras` : ''].filter(Boolean).join(' · ');
  return `<button class="row" data-action="open-material" data-id="${m.id}">
      <span class="row-icon" aria-hidden="true">${type.icon}</span>
      <span class="row-main"><strong>${esc(m.title || type.one)}</strong><span class="muted">${meta}</span></span>
      <span class="row-side">›</span>
    </button>`;
}

// ----- Progreso -----

function viewProgress() {
  const weeks = checkpointWeeks();
  const cps = state.checkpoints;
  const chart = checkpointChart(cps, weeks, state.chartMode, state.chartWeek);
  const latest = [...weeks].reverse().map((w) => cps[w]).find((c) => c && Object.values(c.levels ?? {}).some(Boolean));
  const weakest = latest && weakestSkill(latest);

  const legend = SKILLS.map((s, i) => `<span class="legend-item"><i class="swatch s${i + 1}"></i>${s.name}</span>`).join('');
  const readout = state.chartWeek && cps[state.chartWeek]
    ? `<p class="readout"><strong>S${state.chartWeek}</strong> ${SKILLS.map((s) => {
        const lvl = cps[state.chartWeek].levels?.[s.id];
        const sc = cps[state.chartWeek].scores?.[s.id];
        return `${s.name}: ${lvl ?? '—'}${typeof sc === 'number' ? ` (${sc})` : ''}`;
      }).join(' · ')}</p>`
    : '<p class="readout muted">Toca el gráfico para ver los valores de cada checkpoint.</p>';

  const cards = weeks.map((w) => checkpointCard(w, cps[w])).join('');

  return `
    <section class="card">
      <div class="card-head">
        <h2>Evolución</h2>
        <div class="seg" role="group" aria-label="Escala">
          <button class="${state.chartMode === 'band' ? 'on' : ''}" data-action="chart-mode" data-mode="band">Nivel</button>
          <button class="${state.chartMode === 'score' ? 'on' : ''}" data-action="chart-mode" data-mode="score">Puntuación</button>
        </div>
      </div>
      ${chart
        ? `<div class="legend">${legend}</div>${chart}${readout}`
        : `<p class="empty">${state.chartMode === 'score' && Object.keys(cps).length ? 'No hay puntuaciones apuntadas todavía.' : 'Apunta tu primer checkpoint para ver la evolución.'}</p>`}
      ${weakest ? `<p class="weakest">Parte más baja: <strong>${weakest.skill.name} (${weakest.level}${typeof weakest.score === 'number' ? `, ${weakest.score}` : ''})</strong>. Es la nota que cuenta.</p>` : ''}
    </section>

    <h2 class="section-title">Checkpoints</h2>
    <div class="cp-list">${cards}</div>

    <h2 class="section-title">Datos</h2>
    <section class="card data">
      <button class="btn" data-action="export-csv">Exportar registros (CSV)</button>
      <button class="btn" data-action="export-cp-csv">Exportar checkpoints (CSV)</button>
      <button class="btn primary" data-action="export-zip">Copia completa (ZIP con audios y textos)</button>
      <button class="btn" data-action="import-zip">Restaurar copia…</button>
      <hr>
      <button class="btn" data-action="load-plan">Cargar plan desde JSON…</button>
      ${state.customPlan ? '<button class="btn" data-action="reset-plan">Volver al plan por defecto</button>' : ''}
      <p class="muted small" id="storage-info">Calculando espacio…</p>
    </section>`;
}

function checkpointCard(w, cp) {
  const filled = cp && Object.values(cp.levels ?? {}).some(Boolean);
  const weakest = filled && weakestSkill(cp);
  const cells = SKILLS.map((s) => {
    const lvl = cp?.levels?.[s.id];
    const sc = cp?.scores?.[s.id];
    return `<span class="cp-cell ${weakest && weakest.skill.id === s.id ? 'low' : ''}"><small>${s.name}</small><b>${lvl ?? '—'}</b>${typeof sc === 'number' ? `<small>${sc}</small>` : ''}</span>`;
  }).join('');
  const isNow = w === currentWeek();
  return `<button class="cp-card ${filled ? '' : 'empty-cp'} ${isNow ? 'now' : ''}" data-action="open-checkpoint" data-week="${w}">
      <span class="cp-head"><strong>Semana ${w}${w === 1 ? ' · inicial' : ''}</strong><span class="muted">${filled ? (cp.date ? fmtShort(cp.date) : '') : isNow ? 'Toca esta semana' : 'Apuntar ›'}</span></span>
      ${filled ? `<span class="cp-cells">${cells}</span>` : ''}
    </button>`;
}

async function fillStorageInfo() {
  const el = $('#storage-info');
  if (!el) return;
  const parts = [];
  try {
    const { usage } = await navigator.storage.estimate();
    parts.push(`Espacio usado: ${(usage / 1048576).toLocaleString('es-ES', { maximumFractionDigits: 1 })} MB`);
    if (navigator.storage.persisted) parts.push((await navigator.storage.persisted()) ? 'almacenamiento persistente ✓' : 'el navegador podría borrar los datos si le falta espacio');
  } catch { /* not supported */ }
  parts.push(state.lastBackup ? `última copia: ${fmtDate(toISODate(new Date(state.lastBackup)))}` : 'sin copias todavía');
  el.textContent = parts.join(' · ');
}

// ---------- Sheets (dialogs) ----------

const sheet = () => $('#sheet');
let onSheetClose = null;

function openSheet(html, mount) {
  closeSheetCleanup();
  const dlg = sheet();
  $('.sheet-body', dlg).innerHTML = html;
  if (!dlg.open) dlg.showModal();
  mount?.(dlg);
}

function closeSheetCleanup() {
  onSheetClose?.();
  onSheetClose = null;
  $('.sheet-body', sheet()).querySelectorAll('audio').forEach((a) => a.pause());
}

function closeSheet() {
  closeSheetCleanup();
  sheet().close();
}

function sessionSheet(id) {
  const s = sessionById(id);
  if (!s) return closeSheet();
  const mats = materialsOf(id);
  const items = mats.length
    ? mats.map((m) => materialItem(m)).join('')
    : '<p class="empty">Sin materiales. Añade lo que has usado en este bloque.</p>';
  openSheet(`
    <header class="sheet-head">
      <div><h2>${esc(blockName(s.block))} · ${formatMinutes(s.minutes)}</h2>
      <p class="muted">${fmtDate(s.date)} · semana ${weekOf(s.date, start())}</p></div>
      <button class="icon-btn" data-action="close-sheet" aria-label="Cerrar">✕</button>
    </header>
    <div class="mat-list">${items}</div>
    <div class="add-grid">
      ${MATERIAL_TYPES.map((t) => `<button class="btn" data-action="add-material" data-type="${t.id}" data-session="${id}">${t.icon} ${t.id === 'audio' ? 'Audio' : t.one}</button>`).join('')}
    </div>
    <button class="btn danger-text" data-action="del-session" data-id="${id}">Borrar registro</button>`,
  (dlg) => mountAudioPlayers(dlg));
}

function materialItem(m) {
  const type = MATERIAL_TYPES.find((t) => t.id === m.type);
  let body = '';
  if (m.type === 'link') body = `<a href="${esc(m.url)}" target="_blank" rel="noopener" class="ellipsis">${esc(m.url)}</a>`;
  if (m.type === 'text') body = `<span class="muted">${wordCount(m.text)} palabras</span> <button class="link-btn" data-action="view-text" data-id="${m.id}">Ver</button> <button class="link-btn" data-action="edit-text" data-id="${m.id}">Editar</button>`;
  if (m.type === 'audio') body = `<audio controls preload="metadata" data-blob="${m.blobId}" data-mime="${esc(m.mime)}"></audio>`;
  if (m.type === 'file') body = `<button class="link-btn" data-action="open-file" data-id="${m.id}">Abrir ${esc(m.fileName ?? '')}</button>`;
  return `<div class="mat-item">
      <div class="mat-top"><span>${type.icon} <strong>${esc(m.title || type.one)}</strong></span>
        <button class="icon-btn small" data-action="del-material" data-id="${m.id}" aria-label="Borrar material">🗑</button></div>
      <div class="mat-body">${body}</div>
    </div>`;
}

async function mountAudioPlayers(root) {
  for (const el of root.querySelectorAll('audio[data-blob]')) {
    const rec = await db.get('blobs', el.dataset.blob);
    if (!rec) continue;
    // Chrome's MediaRecorder WebM files carry no duration; seeking far ahead makes the player compute it.
    el.addEventListener('loadedmetadata', () => {
      if (el.duration !== Infinity) return;
      el.addEventListener('durationchange', () => { el.currentTime = 0; }, { once: true });
      el.currentTime = 1e7;
    }, { once: true });
    el.src = objectUrl(new Blob([rec.data], { type: rec.mime || el.dataset.mime }));
  }
}

function previousLinks() {
  const seen = new Map();
  [...state.materials].filter((m) => m.type === 'link').sort((a, b) => b.ts - a.ts)
    .forEach((m) => { if (!seen.has(m.url)) seen.set(m.url, m); });
  return [...seen.values()];
}

function linkSheet(sessionId) {
  const prev = previousLinks();
  const s = sessionById(sessionId);
  const sameBlock = prev.filter((m) => sessionById(m.sessionId)?.block === s?.block).slice(0, 6);
  const recent = (sameBlock.length ? sameBlock : prev).slice(0, 6);
  openSheet(`
    <header class="sheet-head"><h2>🔗 Enlace</h2><button class="icon-btn" data-action="back-session" data-session="${sessionId}" aria-label="Volver">‹</button></header>
    ${recent.length ? `<p class="label">Usados antes</p><div class="chip-row wrap">${recent.map((m) => `<button class="chip" data-action="reuse-link" data-id="${m.id}" data-session="${sessionId}">${esc(m.title || m.url)}</button>`).join('')}</div>` : ''}
    <form data-form="link" data-session="${sessionId}" class="form">
      <label>URL<input name="url" type="url" inputmode="url" required placeholder="https://…" list="link-list" autocomplete="off"></label>
      <datalist id="link-list">${prev.map((m) => `<option value="${esc(m.url)}">${esc(m.title)}</option>`).join('')}</datalist>
      <label>Título <span class="muted">(opcional)</span><input name="title" placeholder="p. ej. 6 Minute English – AI at work"></label>
      <button class="btn primary" type="submit">Guardar enlace</button>
    </form>`,
  (dlg) => {
    const url = $('input[name=url]', dlg);
    url.focus();
    url.addEventListener('change', () => {
      const match = prev.find((m) => m.url === url.value);
      if (match && !$('input[name=title]', dlg).value) $('input[name=title]', dlg).value = match.title ?? '';
    });
  });
}

const draftKey = (sessionId, id) => `draft:${sessionId}:${id ?? 'new'}`;
function readDraft(key) { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } }
function writeDraft(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* ignore */ } }
function clearDraft(key) { try { localStorage.removeItem(key); } catch { /* ignore */ } }

function textSheet(sessionId, materialId = null) {
  const s = sessionById(sessionId);
  const existing = materialId ? state.materials.find((m) => m.id === materialId) : null;
  const key = draftKey(sessionId, materialId);
  const draft = readDraft(key);
  const title = draft?.title ?? existing?.title ?? `${blockName(s.block)} – ${fmtShort(s.date)}`;
  const text = draft?.text ?? existing?.text ?? '';
  openSheet(`
    <header class="sheet-head"><h2>📝 ${existing ? 'Editar texto' : 'Texto'}</h2><button class="icon-btn" data-action="back-session" data-session="${sessionId}" aria-label="Volver">‹</button></header>
    <form data-form="text" data-session="${sessionId}" data-id="${materialId ?? ''}" class="form">
      <label>Título<input name="title" value="${esc(title)}" required></label>
      <div class="seg" role="group" aria-label="Modo">
        <button type="button" class="on" data-action="md-mode" data-mode="edit">Escribir</button>
        <button type="button" data-action="md-mode" data-mode="preview">Vista previa</button>
      </div>
      <textarea name="text" rows="12" placeholder="Escribe en Markdown: # título, **negrita**, - listas…">${esc(text)}</textarea>
      <div class="md-preview prose" hidden></div>
      <p class="muted small"><span id="wc">${wordCount(text)}</span> palabras${draft ? ' · borrador recuperado' : ''}</p>
      <button class="btn primary" type="submit">Guardar texto</button>
    </form>`,
  (dlg) => {
    const ta = $('textarea', dlg);
    const titleInput = $('input[name=title]', dlg);
    const save = () => {
      $('#wc', dlg).textContent = wordCount(ta.value);
      writeDraft(key, { title: titleInput.value, text: ta.value });
    };
    ta.addEventListener('input', save);
    titleInput.addEventListener('input', save);
    if (!existing) ta.focus();
  });
}

function viewTextSheet(materialId) {
  const m = state.materials.find((x) => x.id === materialId);
  if (!m) return;
  openSheet(`
    <header class="sheet-head"><h2>${esc(m.title)}</h2><button class="icon-btn" data-action="back-session" data-session="${m.sessionId}" aria-label="Volver">‹</button></header>
    <article class="prose">${renderMarkdown(m.text) || '<p class="muted">(vacío)</p>'}</article>
    <p class="muted small">${wordCount(m.text)} palabras</p>
    <div class="add-grid two">
      <button class="btn" data-action="edit-text" data-id="${m.id}">Editar</button>
      <button class="btn" data-action="download-text" data-id="${m.id}">Descargar .md</button>
    </div>`);
}

function audioSheet(sessionId) {
  const s = sessionById(sessionId);
  const canRecord = recordingSupported();
  let recorder = null;
  let timer = null;
  let result = null;

  openSheet(`
    <header class="sheet-head"><h2>🎙️ Audio</h2><button class="icon-btn" data-action="back-session" data-session="${sessionId}" aria-label="Volver">‹</button></header>
    <div class="recorder">
      ${canRecord ? `<button class="rec-btn" type="button" id="rec-toggle" aria-label="Grabar"><span></span></button>
      <p class="rec-time" id="rec-time">0:00</p>
      <p class="muted small" id="rec-status">Toca para grabar</p>` : '<p class="muted">Este navegador no permite grabar. Puedes subir un archivo de audio.</p>'}
      <audio id="rec-preview" controls hidden></audio>
    </div>
    <form data-form="audio" class="form" id="audio-form" hidden>
      <label>Título<input name="title" value="${esc(`${blockName(s.block)} – ${fmtShort(s.date)}`)}" required></label>
      <div class="add-grid two">
        <button type="button" class="btn" id="rec-discard">Descartar</button>
        <button type="submit" class="btn primary">Guardar audio</button>
      </div>
    </form>
    <label class="btn file-btn">Subir archivo de audio<input type="file" accept="audio/*" id="audio-file" hidden></label>`,
  (dlg) => {
    const toggle = $('#rec-toggle', dlg);
    const preview = $('#rec-preview', dlg);
    const form = $('#audio-form', dlg);
    const showResult = (r) => {
      result = r;
      preview.src = objectUrl(r.blob);
      preview.hidden = false;
      form.hidden = false;
      if (toggle) toggle.hidden = true;
      const status = $('#rec-status', dlg);
      if (status) status.textContent = 'Escúchalo y guárdalo';
    };

    toggle?.addEventListener('click', async () => {
      if (!recorder) {
        recorder = new Recorder();
        try {
          await recorder.start();
        } catch {
          recorder = null;
          $('#rec-status', dlg).textContent = 'No se pudo usar el micrófono. Revisa los permisos.';
          return;
        }
        toggle.classList.add('on');
        toggle.setAttribute('aria-label', 'Parar');
        $('#rec-status', dlg).textContent = 'Grabando… toca para parar';
        timer = setInterval(() => { $('#rec-time', dlg).textContent = formatDuration(recorder.elapsed); }, 250);
      } else {
        clearInterval(timer);
        toggle.classList.remove('on');
        const r = await recorder.stop();
        recorder = null;
        showResult(r);
      }
    });

    $('#rec-discard', dlg).addEventListener('click', () => audioSheet(sessionId));
    $('#audio-file', dlg).addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;
      $('input[name=title]', dlg).value = file.name.replace(/\.[^.]+$/, '');
      const probe = new Audio(URL.createObjectURL(file));
      probe.addEventListener('loadedmetadata', () => { if (result) result.durationSec = Number.isFinite(probe.duration) ? probe.duration : 0; URL.revokeObjectURL(probe.src); });
      showResult({ blob: file, mime: file.type || 'audio/mpeg', durationSec: 0, fileName: file.name });
    });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!result) return;
      await saveBlobMaterial(sessionId, 'audio', $('input[name=title]', dlg).value.trim(), result.blob, result.mime, { durationSec: result.durationSec, fileName: result.fileName });
      sessionSheet(sessionId);
    });

    onSheetClose = () => { clearInterval(timer); recorder?.cancel(); };
  });
}

function fileSheet(sessionId) {
  openSheet(`
    <header class="sheet-head"><h2>📎 Archivo</h2><button class="icon-btn" data-action="back-session" data-session="${sessionId}" aria-label="Volver">‹</button></header>
    <form class="form" id="file-form">
      <label class="btn file-btn">Elegir archivo<input type="file" name="file" hidden></label>
      <p class="muted small" id="file-name">Foto de apuntes, PDF, documento…</p>
      <label>Título<input name="title" required></label>
      <button class="btn primary" type="submit">Guardar archivo</button>
    </form>`,
  (dlg) => {
    const input = $('input[name=file]', dlg);
    input.addEventListener('change', () => {
      const f = input.files[0];
      if (!f) return;
      $('#file-name', dlg).textContent = `${f.name} · ${(f.size / 1048576).toFixed(1)} MB`;
      if (!$('input[name=title]', dlg).value) $('input[name=title]', dlg).value = f.name.replace(/\.[^.]+$/, '');
    });
    $('#file-form', dlg).addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = input.files[0];
      if (!f) return toast('Elige un archivo primero');
      const type = f.type.startsWith('audio/') ? 'audio' : 'file';
      await saveBlobMaterial(sessionId, type, $('input[name=title]', dlg).value.trim(), f, f.type || 'application/octet-stream', { fileName: f.name });
      sessionSheet(sessionId);
    });
  });
}

function checkpointSheet(week) {
  const cp = state.checkpoints[week] ?? {};
  const { to } = weekRange(week, start());
  const defaultDate = cp.date ?? (today() < to ? today() : to);
  const rows = SKILLS.map((s) => `
    <div class="cp-row">
      <span class="cp-skill">${s.name}</span>
      <select name="level-${s.id}" aria-label="Nivel de ${s.name}">
        <option value="">—</option>
        ${LEVELS.map((l) => `<option ${cp.levels?.[s.id] === l ? 'selected' : ''}>${l}</option>`).join('')}
      </select>
      <input name="score-${s.id}" type="number" inputmode="numeric" min="0" max="999" placeholder="Punt." value="${cp.scores?.[s.id] ?? ''}" aria-label="Puntuación de ${s.name}">
    </div>`).join('');
  openSheet(`
    <header class="sheet-head"><div><h2>Checkpoint · semana ${week}</h2><p class="muted">Nivel obligatorio, puntuación de la demo opcional</p></div>
      <button class="icon-btn" data-action="close-sheet" aria-label="Cerrar">✕</button></header>
    <form class="form" data-form="checkpoint" data-week="${week}">
      <label>Fecha de la demo<input type="date" name="date" value="${defaultDate}"></label>
      <div class="cp-rows">${rows}</div>
      <label>Nota <span class="muted">(opcional)</span><textarea name="note" rows="3" placeholder="Qué te ha costado, qué repasar…">${esc(cp.note ?? '')}</textarea></label>
      <button class="btn primary" type="submit">Guardar checkpoint</button>
      ${state.checkpoints[week] ? `<button class="btn danger-text" type="button" data-action="del-checkpoint" data-week="${week}">Borrar checkpoint</button>` : ''}
    </form>`);
}

// ---------- Mutations ----------

async function logSession(minutes) {
  const block = state.pickedBlock;
  if (!block || !(minutes > 0)) return;
  const s = { id: db.uid(), date: state.logDate ?? today(), block, minutes: Math.round(minutes), ts: Date.now() };
  await db.put('sessions', s);
  state.sessions.push(s);
  state.pickedBlock = null;
  state.otherOpen = false;
  render();
  requestPersist();
  toast(`${esc(blockName(block))} · ${formatMinutes(s.minutes)} guardado`, [
    { label: '+ Material', action: 'open-session', id: s.id },
    { label: 'Deshacer', action: 'undo', id: s.id },
  ], 6000);
}

async function deleteSession(id) {
  for (const m of materialsOf(id)) await deleteMaterial(m.id, false);
  await db.del('sessions', id);
  state.sessions = state.sessions.filter((s) => s.id !== id);
}

async function deleteMaterial(id, rerender = true) {
  const m = state.materials.find((x) => x.id === id);
  if (!m) return;
  if (m.blobId) await db.del('blobs', m.blobId);
  await db.del('materials', id);
  state.materials = state.materials.filter((x) => x.id !== id);
  if (rerender) render();
}

async function saveMaterial(m) {
  await db.put('materials', m);
  const i = state.materials.findIndex((x) => x.id === m.id);
  if (i >= 0) state.materials[i] = m; else state.materials.push(m);
  render();
}

async function saveBlobMaterial(sessionId, type, title, blob, mime, extra = {}) {
  const blobId = db.uid();
  try {
    await db.put('blobs', { id: blobId, mime, data: await blob.arrayBuffer() });
  } catch (err) {
    toast('No se pudo guardar: puede que falte espacio en el dispositivo');
    throw err;
  }
  await saveMaterial({ id: db.uid(), sessionId, type, title, blobId, mime, size: blob.size, ts: Date.now(), ...extra });
  requestPersist();
  toast('Guardado');
}

// ---------- Export / import ----------

function download(blob, filename) {
  const file = new File([blob], filename, { type: blob.type });
  const touch = matchMedia('(pointer: coarse)').matches;
  if (touch && navigator.canShare?.({ files: [file] })) {
    return navigator.share({ files: [file], title: filename }).catch(() => {});
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

function sessionsCSV() {
  const rows = [['fecha', 'semana', 'bloque', 'minutos', 'materiales']];
  [...state.sessions].sort((a, b) => a.date.localeCompare(b.date) || a.ts - b.ts).forEach((s) => {
    const mats = materialsOf(s.id).map((m) => (m.type === 'link' ? `${m.title ? `${m.title} ` : ''}${m.url}` : `${m.type}: ${m.title}`)).join(' | ');
    rows.push([s.date, weekOf(s.date, start()), blockName(s.block), s.minutes, mats]);
  });
  return toCSV(rows);
}

function checkpointsCSV() {
  const rows = [['semana', 'fecha', ...SKILLS.flatMap((s) => [`${s.name} nivel`, `${s.name} puntuación`]), 'nota']];
  Object.values(state.checkpoints).sort((a, b) => a.week - b.week).forEach((c) => {
    rows.push([c.week, c.date ?? '', ...SKILLS.flatMap((s) => [c.levels?.[s.id] ?? '', c.scores?.[s.id] ?? '']), c.note ?? '']);
  });
  return toCSV(rows);
}

function materialPath(m) {
  const s = sessionById(m.sessionId);
  const week = s ? String(weekOf(s.date, start())).padStart(2, '0') : 'xx';
  const base = `${s?.date ?? 'sin-fecha'}-${slugify(m.title)}-${m.id.slice(0, 6)}`;
  const ext = m.type === 'text' ? 'md' : extensionFor(m.mime);
  return `materiales/semana-${week}/${base}.${ext}`;
}

async function exportZip() {
  toast('Preparando copia…');
  const entries = [];
  const materials = [];
  for (const m of state.materials) {
    const path = m.type === 'link' ? null : materialPath(m);
    if (m.type === 'text') entries.push({ name: path, data: `# ${m.title}\n\n${m.text}\n` });
    if (m.blobId) {
      const rec = await db.get('blobs', m.blobId);
      if (rec) entries.push({ name: path, data: rec.data });
    }
    materials.push({ ...m, file: path });
  }
  const data = {
    app: 'objetivoc1',
    version: 1,
    exportedAt: new Date().toISOString(),
    sessions: state.sessions,
    materials,
    checkpoints: Object.values(state.checkpoints),
    customPlan: state.customPlan ? state.plan : null,
  };
  entries.unshift(
    { name: 'datos.json', data: JSON.stringify(data, null, 2) },
    { name: 'registros.csv', data: sessionsCSV() },
    { name: 'checkpoints.csv', data: checkpointsCSV() },
  );
  const zip = await createZip(entries);
  await download(zip, `objetivoc1-copia-${today()}.zip`);
  state.lastBackup = Date.now();
  await db.setMeta('lastBackup', state.lastBackup);
  render();
}

async function importZip(file) {
  let files;
  let data;
  try {
    files = await readZip(file);
    const json = files.get('datos.json');
    if (!json) throw new Error('Falta datos.json');
    data = JSON.parse(new TextDecoder().decode(await json()));
    if (data.app !== 'objetivoc1') throw new Error('No es una copia de esta app');
  } catch (err) {
    return toast(`No se pudo leer la copia: ${esc(err.message)}`);
  }
  const msg = `Se reemplazarán todos los datos actuales por los de la copia (${data.sessions.length} registros, ${data.materials.length} materiales). ¿Continuar?`;
  if (!confirm(msg)) return;

  const blobs = [];
  const materials = [];
  for (const { file: path, ...m } of data.materials) {
    if (m.blobId && path && files.has(path)) {
      const bytes = await files.get(path)();
      blobs.push({ id: m.blobId, mime: m.mime, data: bytes.slice().buffer });
    }
    materials.push(m);
  }
  const meta = [{ key: 'lastBackup', value: state.lastBackup }];
  if (data.customPlan) meta.push({ key: 'customPlan', value: data.customPlan });
  await db.replaceAll({ sessions: data.sessions, materials, blobs, checkpoints: data.checkpoints, meta });
  await loadData();
  await loadPlan();
  render();
  toast('Copia restaurada');
}

async function loadPlanFile(file) {
  try {
    const plan = JSON.parse(await file.text());
    if (!Array.isArray(plan.weeks)) throw new Error('falta la lista "weeks"');
    if (plan.start && !/^\d{4}-\d{2}-\d{2}$/.test(plan.start)) throw new Error('"start" debe ser AAAA-MM-DD');
    await db.setMeta('customPlan', plan);
    await loadPlan();
    state.planView = clampWeek(currentWeek());
    render();
    toast('Plan cargado');
  } catch (err) {
    toast(`JSON no válido: ${esc(err.message)}`);
  }
}

function pickFile(accept, onPick) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = accept;
  input.addEventListener('change', () => input.files[0] && onPick(input.files[0]));
  input.click();
}

// ---------- Toast ----------

let toastTimer;
function toast(html, actions = [], ms = 3000) {
  const el = $('#toast');
  el.innerHTML = `<span>${html}</span>${actions.map((a) => `<button data-action="${a.action}" data-id="${a.id}">${a.label}</button>`).join('')}`;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, ms);
}

function hideToast() {
  $('#toast').hidden = true;
}

// ---------- Events ----------

const actions = {
  tab: (t) => { state.view = t.dataset.view; render(); window.scrollTo(0, 0); },
  'pick-block': (t) => { state.pickedBlock = state.pickedBlock === t.dataset.block ? null : t.dataset.block; render(); },
  'log-min': (t) => logSession(Number(t.dataset.min)),
  'log-other': () => { state.otherOpen = true; render(); $('#other-min')?.focus(); },
  undo: async (t) => { hideToast(); await deleteSession(t.dataset.id); render(); toast('Registro deshecho'); },
  'open-session': (t) => { hideToast(); sessionSheet(t.dataset.id); },
  'close-sheet': () => closeSheet(),
  'back-session': (t) => sessionSheet(t.dataset.session),
  'add-material': (t) => {
    const fn = { link: linkSheet, text: textSheet, audio: audioSheet, file: fileSheet }[t.dataset.type];
    fn(t.dataset.session);
  },
  'reuse-link': async (t) => {
    const src = state.materials.find((m) => m.id === t.dataset.id);
    await saveMaterial({ id: db.uid(), sessionId: t.dataset.session, type: 'link', url: src.url, title: src.title, ts: Date.now() });
    sessionSheet(t.dataset.session);
  },
  'view-text': (t) => viewTextSheet(t.dataset.id),
  'edit-text': (t) => { const m = state.materials.find((x) => x.id === t.dataset.id); textSheet(m.sessionId, m.id); },
  'download-text': (t) => { const m = state.materials.find((x) => x.id === t.dataset.id); download(new Blob([`# ${m.title}\n\n${m.text}\n`], { type: 'text/markdown' }), `${slugify(m.title)}.md`); },
  'md-mode': (t) => {
    const form = t.closest('form');
    const preview = t.dataset.mode === 'preview';
    form.querySelectorAll('[data-action=md-mode]').forEach((b) => b.classList.toggle('on', b === t));
    $('textarea', form).hidden = preview;
    const box = $('.md-preview', form);
    box.hidden = !preview;
    if (preview) box.innerHTML = renderMarkdown($('textarea', form).value) || '<p class="muted">(vacío)</p>';
  },
  'open-file': async (t) => {
    const m = state.materials.find((x) => x.id === t.dataset.id);
    const rec = await db.get('blobs', m.blobId);
    if (!rec) return toast('Archivo no encontrado');
    const blob = new Blob([rec.data], { type: m.mime });
    if (/^(image\/|application\/pdf|text\/)/.test(m.mime)) window.open(objectUrl(blob), '_blank');
    else download(blob, m.fileName ?? `${slugify(m.title)}.${extensionFor(m.mime)}`);
  },
  'open-material': (t) => {
    const m = state.materials.find((x) => x.id === t.dataset.id);
    if (m.type === 'text') viewTextSheet(m.id);
    else sessionSheet(m.sessionId);
  },
  'del-material': async (t) => {
    if (!confirm('¿Borrar este material?')) return;
    const m = state.materials.find((x) => x.id === t.dataset.id);
    await deleteMaterial(t.dataset.id);
    sessionSheet(m.sessionId);
  },
  'del-session': async (t) => {
    const n = materialsOf(t.dataset.id).length;
    if (!confirm(n ? `¿Borrar el registro y sus ${n} materiales?` : '¿Borrar este registro?')) return;
    await deleteSession(t.dataset.id);
    closeSheet();
    render();
  },
  'week-prev': () => { state.weekView = clampWeek(state.weekView - 1); render(); },
  'week-next': () => { state.weekView = clampWeek(state.weekView + 1); render(); },
  'week-now': () => { state.weekView = clampWeek(currentWeek()); render(); },
  'plan-prev': () => { state.planView = clampWeek(state.planView - 1); render(); },
  'plan-next': () => { state.planView = clampWeek(state.planView + 1); render(); },
  'plan-now': () => { state.planView = clampWeek(currentWeek()); render(); },
  'filter-type': (t) => { state.filterType = t.dataset.type; render(); },
  'open-checkpoint': (t) => checkpointSheet(Number(t.dataset.week)),
  'del-checkpoint': async (t) => {
    if (!confirm('¿Borrar este checkpoint?')) return;
    const week = Number(t.dataset.week);
    await db.del('checkpoints', week);
    delete state.checkpoints[week];
    closeSheet();
    render();
  },
  'chart-mode': (t) => { state.chartMode = t.dataset.mode; render(); },
  'cp-readout': (t) => { state.chartWeek = Number(t.dataset.week); render(); },
  'export-csv': () => download(new Blob([sessionsCSV()], { type: 'text/csv;charset=utf-8' }), `objetivoc1-registros-${today()}.csv`),
  'export-cp-csv': () => download(new Blob([checkpointsCSV()], { type: 'text/csv;charset=utf-8' }), `objetivoc1-checkpoints-${today()}.csv`),
  'export-zip': () => exportZip().catch((err) => toast(`Error al crear la copia: ${esc(err.message)}`)),
  'import-zip': () => pickFile('.zip,application/zip', importZip),
  'load-plan': () => pickFile('.json,application/json', loadPlanFile),
  'reset-plan': async () => {
    await db.del('meta', 'customPlan');
    await loadPlan();
    render();
    toast('Plan por defecto restaurado');
  },
};

const forms = {
  other: (form) => logSession(Number($('#other-min', form).value)),
  link: async (form) => {
    const sessionId = form.dataset.session;
    const url = form.elements.url.value.trim();
    await saveMaterial({ id: db.uid(), sessionId, type: 'link', url, title: form.elements.title.value.trim(), ts: Date.now() });
    sessionSheet(sessionId);
  },
  text: async (form) => {
    const sessionId = form.dataset.session;
    const id = form.dataset.id || null;
    const prev = id ? state.materials.find((m) => m.id === id) : null;
    await saveMaterial({ ...(prev ?? { id: db.uid(), sessionId, type: 'text', ts: Date.now() }), title: form.elements.title.value.trim(), text: form.elements.text.value, updatedAt: Date.now() });
    clearDraft(draftKey(sessionId, id));
    requestPersist();
    sessionSheet(sessionId);
  },
  checkpoint: async (form) => {
    const week = Number(form.dataset.week);
    const levels = {};
    const scores = {};
    for (const s of SKILLS) {
      const lvl = form.elements[`level-${s.id}`].value;
      const sc = form.elements[`score-${s.id}`].value;
      if (lvl) levels[s.id] = lvl;
      if (sc !== '') scores[s.id] = Number(sc);
    }
    if (!Object.keys(levels).length) return toast('Apunta el nivel de al menos una parte');
    const cp = { week, date: form.elements.date.value || null, levels, scores, note: form.elements.note.value.trim() };
    await db.put('checkpoints', cp);
    state.checkpoints[week] = cp;
    closeSheet();
    render();
    toast('Checkpoint guardado');
  },
};

function bindEvents() {
  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-action]');
    if (!t || t.disabled) return;
    const fn = actions[t.dataset.action];
    if (fn) {
      e.preventDefault();
      fn(t, e);
    }
  });
  document.addEventListener('submit', (e) => {
    const form = e.target.closest('[data-form]');
    if (!form || !forms[form.dataset.form]) return;
    e.preventDefault();
    forms[form.dataset.form](form);
  });
  document.addEventListener('change', (e) => {
    const t = e.target.closest('[data-change]');
    if (!t) return;
    if (t.dataset.change === 'log-date') {
      state.logDate = t.value && t.value !== today() ? t.value : null;
      render();
    }
    if (t.dataset.change === 'filter-block') {
      state.filterBlock = t.value;
      render();
    }
  });
  const dlg = sheet();
  dlg.addEventListener('close', closeSheetCleanup);
  dlg.addEventListener('click', (e) => { if (e.target === dlg) closeSheet(); });
  // Keep "today", the streak and the current week right if the app stays open past midnight.
  document.addEventListener('visibilitychange', () => { if (!document.hidden && !dlg.open) render(); });
}

async function init() {
  bindEvents();
  await Promise.all([loadData(), loadPlan()]);
  state.weekView = clampWeek(currentWeek());
  state.planView = clampWeek(currentWeek());
  render();
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

init().catch((err) => {
  console.error(err);
  $('#view').innerHTML = `<p class="empty">No se pudo iniciar la app: ${esc(err.message)}</p>`;
});
