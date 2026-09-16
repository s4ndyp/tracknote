const TYPE_LABELS = {
  counter: "Teller (+1)",
  check: "Aanvinken",
  choice: "Keuzelijst",
  number: "Getal",
  scale: "Schaal",
  text: "Vrij invullen",
};

const COLORS = [
  "#f43f5e", "#fb923c", "#facc15", "#4ade80", "#2dd4bf",
  "#38bdf8", "#60a5fa", "#818cf8", "#a78bfa", "#f472b6", "#94a3b8",
];

const DOW = ["ma", "di", "wo", "do", "vr", "za", "zo"];

function pad(n) {
  return String(n).padStart(2, "0");
}

function localISODate(date = new Date()) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

const state = {
  view: "today",
  trackers: [],
  categories: [],
  entries: [],
  calendarRange: "month",
  calendarFilterTrackerId: null,
  statsRange: "month",
  selectedDay: localISODate(new Date()),
  selectedCategoryId: null,
  loading: false,
};

const appEl = document.getElementById("app");
const sheetEl = document.getElementById("sheet");
const sheetBody = document.getElementById("sheetBody");
const pageTitle = document.getElementById("pageTitle");
const todayLabel = document.getElementById("todayLabel");

function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function endOfDay(date) {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function addMonths(date, months) {
  const d = new Date(date);
  d.setMonth(d.getMonth() + months);
  return d;
}

function toPbDate(date) {
  return date.toISOString().replace("T", " ");
}

function parsePbDate(value) {
  if (!value) return new Date();
  return new Date(String(value).replace(" ", "T"));
}

function formatDayTitle(date) {
  return date.toLocaleDateString("nl-NL", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}

function selectedDayDate() {
  return new Date(`${state.selectedDay}T12:00:00`);
}

function isSelectedToday() {
  return state.selectedDay === localISODate(new Date());
}

function logTimestampForSelectedDay() {
  const now = new Date();
  if (isSelectedToday()) return now;
  return new Date(
    `${state.selectedDay}T${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`
  );
}

function formatTime(date) {
  return date.toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" });
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function trackerById(id) {
  return state.trackers.find((t) => t.id === id);
}

function categoryById(id) {
  return state.categories.find((c) => c.id === id);
}

function overigCategory() {
  return state.categories.find((c) => c.name === "Overig") || null;
}

function trackersInCategory(categoryId) {
  const active = state.trackers.filter((t) => !t.archived);
  const overig = overigCategory();
  return active
    .filter((t) => {
      if (!t.category) return overig && categoryId === overig.id;
      return t.category === categoryId;
    })
    .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0) || a.name.localeCompare(b.name));
}

function categoryGridLayout(count) {
  if (count <= 0) return { cols: 1, rows: 1 };
  if (count === 1) return { cols: 1, rows: 1 };
  if (count === 2) return { cols: 1, rows: 2 };
  if (count <= 4) return { cols: 2, rows: 2 };
  if (count <= 6) return { cols: 2, rows: 3 };
  if (count <= 9) return { cols: 3, rows: 3 };
  const cols = Math.ceil(Math.sqrt(count));
  return { cols, rows: Math.ceil(count / cols) };
}

function categoryDayLogCount(categoryId, day) {
  const ids = new Set(trackersInCategory(categoryId).map((t) => t.id));
  return entriesForDay(day).filter((e) => ids.has(e.tracker)).length;
}

function optionsOf(tracker) {
  const raw = tracker?.options;
  if (!raw) return {};
  if (typeof raw === "string") {
    try { return JSON.parse(raw); } catch { return {}; }
  }
  return raw;
}

function toast(message) {
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = message;
  document.getElementById("toasts").appendChild(el);
  setTimeout(() => el.remove(), 2400);
}

async function pbRequest(path, options = {}) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  if (!res.ok) {
    let detail = "";
    try {
      const err = await res.json();
      detail = err.message ? `: ${err.message}` : "";
    } catch (_) { /* ignore */ }
    throw new Error(`PocketBase ${res.status}${detail}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

async function listAll(collection, params = {}) {
  const items = [];
  let page = 1;
  let totalPages = 1;
  do {
    const q = new URLSearchParams({
      page: String(page),
      perPage: "200",
      skipTotal: "false",
      ...params,
    });
    const data = await pbRequest(`/api/collections/${collection}/records?${q}`);
    items.push(...(data.items || []));
    totalPages = data.totalPages || 1;
    page += 1;
  } while (page <= totalPages);
  return items;
}

async function loadCategories() {
  state.categories = await listAll("categories", { sort: "sort_order,name" });
}

async function loadTrackers() {
  state.trackers = await listAll("trackers", { sort: "sort_order,name" });
}

async function loadEntries(from, to) {
  const filter = `logged_at >= "${toPbDate(from)}" && logged_at <= "${toPbDate(to)}"`;
  state.entries = await listAll("entries", {
    filter,
    sort: "-logged_at",
    expand: "tracker",
  });
}

function entriesForDay(date) {
  const key = localISODate(date);
  return state.entries.filter((e) => localISODate(parsePbDate(e.logged_at)) === key);
}

function entriesForTracker(trackerId, date) {
  return entriesForDay(date).filter((e) => e.tracker === trackerId);
}

function summaryFor(tracker, date = new Date()) {
  const items = entriesForTracker(tracker.id, date);
  if (!items.length) return "Nog niets";
  if (tracker.type === "counter") {
    const total = items.reduce((sum, e) => sum + Number(e.value_number || 1), 0);
    return `${total}${tracker.unit ? ` ${tracker.unit}` : ""}`;
  }
  if (tracker.type === "check") return items.length ? "Gedaan" : "Nog niet";
  if (tracker.type === "choice" || tracker.type === "text") {
    return items.map((e) => e.value_text).filter(Boolean).join(" · ") || `${items.length}x`;
  }
  if (tracker.type === "number" || tracker.type === "scale") {
    const last = items[0];
    return `${last.value_number ?? "-"}${tracker.unit ? ` ${tracker.unit}` : ""}`;
  }
  return `${items.length}x`;
}

function closeSheet() {
  sheetEl.hidden = true;
  sheetBody.innerHTML = "";
}

function openSheet(html) {
  sheetBody.innerHTML = html;
  sheetEl.hidden = false;
}

function setView(view) {
  state.view = view;
  if (view !== "today") state.selectedCategoryId = null;
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.classList.toggle("is-active", tab.dataset.view === view);
  });
  render();
}

async function refresh(rangeDays = 400) {
  state.loading = true;
  render();
  try {
    await loadCategories();
    await loadTrackers();
    const to = endOfDay(new Date());
    const from = startOfDay(addDays(new Date(), -rangeDays));
    await loadEntries(from, to);
  } catch (err) {
    toast(err.message);
  } finally {
    state.loading = false;
    render();
  }
}

function render() {
  const titles = {
    today: isSelectedToday() ? "Vandaag" : "Logboek",
    calendar: "Kalender",
    stats: "Statistieken",
    trackers: "Trackers",
  };
  if (state.view === "today") {
    todayLabel.textContent = formatDayTitle(selectedDayDate());
    const cat = state.selectedCategoryId ? categoryById(state.selectedCategoryId) : null;
    if (cat) pageTitle.textContent = cat.name;
    else pageTitle.textContent = titles.today;
  } else {
    todayLabel.textContent = formatDayTitle(new Date());
    pageTitle.textContent = titles[state.view] || "Tracknote";
  }
  if (state.loading && !state.trackers.length) {
    appEl.innerHTML = `<p class="empty">Laden…</p>`;
    return;
  }
  if (state.view === "today") renderToday();
  else if (state.view === "calendar") renderCalendar();
  else if (state.view === "stats") renderStats();
  else renderTrackers();
}

function dayNavHtml(day) {
  return `
    <div class="day-nav">
      <button class="icon-btn" data-action="day-prev" type="button" aria-label="Vorige dag">‹</button>
      <p class="day-nav-label">${escapeHtml(formatDayTitle(day))}</p>
      <button class="icon-btn" data-action="day-next" type="button" aria-label="Volgende dag">›</button>
    </div>
  `;
}

function categoryTile(category) {
  const day = selectedDayDate();
  const trackerCount = trackersInCategory(category.id).length;
  const logs = categoryDayLogCount(category.id, day);
  return `
    <button
      type="button"
      class="category-tile"
      data-open-category="${category.id}"
      style="--tile-color:${escapeHtml(category.color)}"
    >
      <span class="category-tile-icon">${escapeHtml(category.icon || "▣")}</span>
      <span class="category-tile-name">${escapeHtml(category.name)}</span>
      <span class="category-tile-meta">${trackerCount} tracker${trackerCount === 1 ? "" : "s"} · ${logs} log${logs === 1 ? "" : "s"}</span>
    </button>
  `;
}

function renderToday() {
  const day = selectedDayDate();
  const dayItems = entriesForDay(day);
  const dayLabel = isSelectedToday() ? "vandaag" : "op deze dag";

  if (!state.selectedCategoryId) {
    const cats = [...state.categories].sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
    const { cols, rows } = categoryGridLayout(Math.max(cats.length, 1));
    appEl.classList.add("app--tiles");
    appEl.innerHTML = `
      ${dayNavHtml(day)}
      <div class="toolbar toolbar-compact">
        <p class="hint">${dayItems.length} log${dayItems.length === 1 ? "" : "s"} ${dayLabel}</p>
        <button class="btn btn-ghost" data-action="open-log" type="button">Logs</button>
      </div>
      <div
        class="category-stage"
        style="grid-template-columns:repeat(${cols},minmax(0,1fr));grid-template-rows:repeat(${rows},minmax(0,1fr))"
      >
        ${cats.length ? cats.map(categoryTile).join("") : `<p class="empty">Nog geen categorieën. Voeg ze toe onder Trackers.</p>`}
      </div>
    `;
    return;
  }

  appEl.classList.remove("app--tiles");
  const trackers = trackersInCategory(state.selectedCategoryId);
  const catLogs = categoryDayLogCount(state.selectedCategoryId, day);
  appEl.innerHTML = `
    ${dayNavHtml(day)}
    <div class="toolbar">
      <button class="btn btn-ghost" data-action="category-back" type="button">← Terug</button>
      <p class="hint">${catLogs} log${catLogs === 1 ? "" : "s"} ${dayLabel}</p>
      <button class="btn btn-ghost" data-action="open-log" type="button">Logs</button>
    </div>
    <div class="grid tracker-grid">
      ${trackers.map(trackerCard).join("") || `<p class="empty">Geen trackers in deze categorie.</p>`}
    </div>
  `;
}

function trackerCard(tracker) {
  const day = selectedDayDate();
  const value = summaryFor(tracker, day);
  const action = tracker.type === "counter"
    ? `<button class="plus" data-quick="counter" data-id="${tracker.id}" type="button">+</button>`
    : tracker.type === "check"
      ? `<span class="pill" style="color:${tracker.color}">${entriesForTracker(tracker.id, day).length ? "✓" : "○"}</span>`
      : `<span class="pill">${escapeHtml(String(value).slice(0, 10))}</span>`;
  return `
    <article class="card tracker-card" data-open-tracker="${tracker.id}">
      <div class="swatch" style="background:${tracker.color}">${escapeHtml(tracker.icon || "●")}</div>
      <div class="meta">
        <h3>${escapeHtml(tracker.name)}</h3>
        <p>${escapeHtml(value)}</p>
      </div>
      ${action}
    </article>
  `;
}

function monthMatrix(year, month) {
  const first = new Date(year, month, 1);
  const startOffset = (first.getDay() + 6) % 7;
  const start = addDays(first, -startOffset);
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
}

function renderCalendar() {
  appEl.classList.remove("app--tiles");
  const range = state.calendarRange;
  const now = new Date();
  const months = range === "month" ? 1 : range === "6m" ? 6 : 12;
  const list = [];
  for (let i = months - 1; i >= 0; i -= 1) {
    const d = addMonths(now, -i);
    list.push({ year: d.getFullYear(), month: d.getMonth() });
  }
  appEl.innerHTML = `
    <div class="segment" role="tablist">
      <button data-cal-range="month" class="${range === "month" ? "is-active" : ""}" type="button">Deze maand</button>
      <button data-cal-range="6m" class="${range === "6m" ? "is-active" : ""}" type="button">6 maanden</button>
      <button data-cal-range="year" class="${range === "year" ? "is-active" : ""}" type="button">Jaar</button>
    </div>
    <div class="legend filters" role="group" aria-label="Filter op tracker">
      <button type="button" class="filter-chip ${state.calendarFilterTrackerId ? "" : "is-active"}" data-cal-filter="all">Alle</button>
      ${state.trackers.filter((t) => !t.archived).map((t) => `
        <button type="button" class="filter-chip ${state.calendarFilterTrackerId === t.id ? "is-active" : ""}" data-cal-filter="${t.id}">
          <i class="dot" style="background:${t.color}"></i>${escapeHtml(t.name)}
        </button>
      `).join("")}
    </div>
    <div class="mini-months ${range === "year" ? "year" : ""}">
      ${list.map(({ year, month }) => calendarMonth(year, month, range === "month")).join("")}
    </div>
  `;
}

function calendarEntriesForDay(date) {
  let items = entriesForDay(date);
  if (state.calendarFilterTrackerId) {
    items = items.filter((e) => e.tracker === state.calendarFilterTrackerId);
  }
  return items;
}

function dotsForDay(date) {
  const items = calendarEntriesForDay(date);
  if (state.calendarFilterTrackerId) {
    const tracker = trackerById(state.calendarFilterTrackerId);
    const color = tracker?.color || "#64748b";
    return items.slice(0, 8).map(() => `<i class="dot" style="background:${color}"></i>`).join("");
  }
  const groups = new Map();
  items.forEach((entry) => {
    const tracker = trackerById(entry.tracker);
    if (!tracker) return;
    groups.set(tracker.id, tracker.color);
  });
  return [...groups.values()].slice(0, 8).map((color) => `<i class="dot" style="background:${color}"></i>`).join("");
}

function calendarMonth(year, month, large) {
  const days = monthMatrix(year, month);
  const title = new Date(year, month, 1).toLocaleDateString("nl-NL", { month: "long", year: "numeric" });
  const today = localISODate(new Date());
  return `
    <section class="card ${large ? "" : "mini-cal"}">
      <h3 style="margin:0 0 10px">${title}</h3>
      <div class="calendar">
        ${DOW.map((d) => `<div class="dow">${d}</div>`).join("")}
        ${days.map((day) => {
          const inMonth = day.getMonth() === month;
          const key = localISODate(day);
          return `
            <button class="day ${inMonth ? "" : "is-muted"} ${key === today ? "is-today" : ""}" data-day="${key}" type="button">
              <span class="day-num">${day.getDate()}</span>
              <span class="dots">${dotsForDay(day)}</span>
            </button>
          `;
        }).join("")}
      </div>
    </section>
  `;
}

function rangeStart(kind) {
  const now = new Date();
  if (kind === "week") return startOfDay(addDays(now, -6));
  if (kind === "year") return startOfDay(addMonths(now, -11));
  if (kind === "6m") return startOfDay(addMonths(now, -5));
  return startOfDay(new Date(now.getFullYear(), now.getMonth(), 1));
}

function renderStats() {
  appEl.classList.remove("app--tiles");
  const from = rangeStart(state.statsRange);
  const to = endOfDay(new Date());
  const entries = state.entries.filter((e) => {
    const d = parsePbDate(e.logged_at);
    return d >= from && d <= to;
  });
  const byTracker = new Map();
  entries.forEach((entry) => {
    if (!byTracker.has(entry.tracker)) byTracker.set(entry.tracker, []);
    byTracker.get(entry.tracker).push(entry);
  });
  const days = [];
  for (let d = new Date(from); d <= to; d = addDays(d, 1)) days.push(new Date(d));
  const maxDay = Math.max(1, ...days.map((d) => entriesForDay(d).length));

  appEl.innerHTML = `
    <div class="segment">
      <button data-stats-range="week" class="${state.statsRange === "week" ? "is-active" : ""}" type="button">7 dagen</button>
      <button data-stats-range="month" class="${state.statsRange === "month" ? "is-active" : ""}" type="button">Deze maand</button>
      <button data-stats-range="6m" class="${state.statsRange === "6m" ? "is-active" : ""}" type="button">6 maanden</button>
      <button data-stats-range="year" class="${state.statsRange === "year" ? "is-active" : ""}" type="button">Jaar</button>
    </div>
    <div class="grid stats-grid" style="margin-top:14px">
      <section class="card">
        <p class="hint">Logs in periode</p>
        <p class="stat-value">${entries.length}</p>
      </section>
      <section class="card">
        <p class="hint">Actieve dagen</p>
        <p class="stat-value">${new Set(entries.map((e) => localISODate(parsePbDate(e.logged_at)))).size}</p>
      </section>
    </div>
    <section class="card" style="margin-top:12px">
      <h3 style="margin:0 0 10px">Activiteit</h3>
      <div class="heat">
        ${days.map((day) => {
          const count = entriesForDay(day).length;
          const alpha = count ? 0.25 + (count / maxDay) * 0.75 : 0.12;
          return `<i title="${localISODate(day)} · ${count}" style="background:rgba(124,156,255,${alpha})"></i>`;
        }).join("")}
      </div>
    </section>
    ${state.trackers.filter((t) => !t.archived).map((tracker) => trackerStats(tracker, byTracker.get(tracker.id) || [])).join("")}
  `;
}

function streakFor(tracker) {
  const daysWith = new Set(
    state.entries
      .filter((e) => e.tracker === tracker.id)
      .map((e) => localISODate(parsePbDate(e.logged_at)))
  );
  let streak = 0;
  let cursor = startOfDay(new Date());
  if (!daysWith.has(localISODate(cursor))) cursor = addDays(cursor, -1);
  while (daysWith.has(localISODate(cursor))) {
    streak += 1;
    cursor = addDays(cursor, -1);
  }
  return streak;
}

function trackerStats(tracker, items) {
  const total = tracker.type === "counter" || tracker.type === "number" || tracker.type === "scale"
    ? items.reduce((sum, e) => sum + Number(e.value_number || 0), 0)
    : items.length;
  const avg = items.length && (tracker.type === "number" || tracker.type === "scale")
    ? (total / items.length).toFixed(1)
    : null;
  const max = Math.max(1, ...state.trackers.map((t) => {
    const list = state.entries.filter((e) => e.tracker === t.id);
    return list.length;
  }));
  const choiceCounts = {};
  if (tracker.type === "choice") {
    items.forEach((e) => {
      const key = e.value_text || "—";
      choiceCounts[key] = (choiceCounts[key] || 0) + 1;
    });
  }
  return `
    <section class="card" style="margin-top:12px">
      <div class="row" style="justify-content:space-between">
        <h3 style="margin:0">${escapeHtml(tracker.icon || "")} ${escapeHtml(tracker.name)}</h3>
        <span class="hint">reeks ${streakFor(tracker)}d</span>
      </div>
      <p class="stat-value">${avg ? `gem. ${avg}` : total}${tracker.unit && !avg ? ` ${escapeHtml(tracker.unit)}` : ""}</p>
      <div class="bar"><span style="width:${Math.round((items.length / max) * 100)}%;background:${tracker.color}"></span></div>
      ${tracker.type === "choice" ? Object.entries(choiceCounts).sort((a, b) => b[1] - a[1]).map(([label, count]) => `
        <p class="hint">${escapeHtml(label)} · ${count}x</p>
      `).join("") : ""}
    </section>
  `;
}

function renderTrackers() {
  appEl.classList.remove("app--tiles");
  appEl.innerHTML = `
    <div class="toolbar">
      <p class="hint">${state.categories.length} cat. · ${state.trackers.length} trackers</p>
      <div class="row">
        <button class="btn btn-ghost" data-action="new-category" type="button">Categorie</button>
        <button class="btn btn-primary" data-action="new-tracker" type="button" style="width:auto">Tracker</button>
      </div>
    </div>
    <h3 class="section-title">Categorieën</h3>
    <div class="grid">
      ${state.categories.map((category) => `
        <article class="card tracker-card" data-edit-category="${category.id}">
          <div class="swatch" style="background:${category.color}">${escapeHtml(category.icon || "▣")}</div>
          <div class="meta">
            <h3>${escapeHtml(category.name)}</h3>
            <p>${trackersInCategory(category.id).length} trackers</p>
          </div>
          <span class="pill">${category.sort_order ?? 0}</span>
        </article>
      `).join("") || `<p class="empty">Nog geen categorieën.</p>`}
    </div>
    <h3 class="section-title">Trackers</h3>
    <div class="grid">
      ${state.trackers.map((tracker) => {
        const cat = categoryById(tracker.category) || overigCategory();
        return `
        <article class="card tracker-card" data-edit-tracker="${tracker.id}">
          <div class="swatch" style="background:${tracker.color};opacity:${tracker.archived ? 0.4 : 1}">${escapeHtml(tracker.icon || "●")}</div>
          <div class="meta">
            <h3>${escapeHtml(tracker.name)}</h3>
            <p>${TYPE_LABELS[tracker.type] || tracker.type} · ${escapeHtml(cat?.name || "Overig")}${tracker.archived ? " · gearchiveerd" : ""}</p>
          </div>
          <span class="pill">${tracker.sort_order ?? 0}</span>
        </article>
      `;
      }).join("")}
    </div>
  `;
}

function categoryForm(category = null) {
  const color = category?.color || COLORS[2];
  return `
    <h2 style="margin:0 0 8px">${category ? "Categorie bewerken" : "Nieuwe categorie"}</h2>
    <label>Naam</label>
    <input id="f-cat-name" value="${escapeHtml(category?.name || "")}" placeholder="Bijv. Gezondheid" />
    <label>Icoon (emoji)</label>
    <input id="f-cat-icon" value="${escapeHtml(category?.icon || "")}" placeholder="🩺" maxlength="8" />
    <label>Kleur</label>
    <div class="colors" id="cat-colors">
      ${COLORS.map((c) => `<button class="color-dot ${c === color ? "is-active" : ""}" data-color="${c}" data-cat-color style="background:${c}" type="button"></button>`).join("")}
    </div>
    <input id="f-cat-color" value="${escapeHtml(color)}" />
    <label>Volgorde</label>
    <input id="f-cat-sort" type="number" value="${category?.sort_order ?? state.categories.length + 1}" />
    <div class="actions">
      ${category ? `<button class="btn btn-danger" data-delete-category="${category.id}" type="button">Verwijderen</button>` : ""}
      <button class="btn btn-primary" data-save-category="${category?.id || "new"}" type="button">Opslaan</button>
    </div>
  `;
}

function trackerForm(tracker = null) {
  const opts = optionsOf(tracker);
  const choices = (opts.choices || []).join("\n");
  const color = tracker?.color || COLORS[0];
  return `
    <h2 style="margin:0 0 8px">${tracker ? "Tracker bewerken" : "Nieuwe tracker"}</h2>
    <label>Naam</label>
    <input id="f-name" value="${escapeHtml(tracker?.name || "")}" placeholder="Bijv. Hoofdpijn" />
    <label>Icoon (emoji)</label>
    <input id="f-icon" value="${escapeHtml(tracker?.icon || "")}" placeholder="💊" maxlength="8" />
    <label>Kleur</label>
    <div class="colors">
      ${COLORS.map((c) => `<button class="color-dot ${c === color ? "is-active" : ""}" data-color="${c}" style="background:${c}" type="button"></button>`).join("")}
    </div>
    <input id="f-color" value="${escapeHtml(color)}" />
    <label>Type</label>
    <select id="f-type">
      ${Object.entries(TYPE_LABELS).map(([key, label]) => `
        <option value="${key}" ${tracker?.type === key ? "selected" : ""}>${label}</option>
      `).join("")}
    </select>
    <label>Eenheid (optioneel)</label>
    <input id="f-unit" value="${escapeHtml(tracker?.unit || "")}" placeholder="glazen, uur, mg" />
    <label>Keuzes / schaal (één per regel, of min-max zoals 1-10)</label>
    <textarea id="f-options" placeholder="Paracetamol&#10;Ibuprofen">${escapeHtml(choices || (opts.min ? `${opts.min}-${opts.max}` : ""))}</textarea>
    <label>Beschrijving</label>
    <input id="f-desc" value="${escapeHtml(tracker?.description || "")}" />
    <label>Categorie</label>
    <select id="f-category">
      ${state.categories.map((c) => `
        <option value="${c.id}" ${(tracker?.category || overigCategory()?.id) === c.id ? "selected" : ""}>${escapeHtml(c.name)}</option>
      `).join("")}
    </select>
    <label>Volgorde</label>
    <input id="f-sort" type="number" value="${tracker?.sort_order ?? state.trackers.length + 1}" />
    <label class="row" style="margin-top:12px">
      <input id="f-archived" type="checkbox" ${tracker?.archived ? "checked" : ""} style="width:auto" />
      Gearchiveerd
    </label>
    <div class="actions">
      ${tracker ? `<button class="btn btn-danger" data-delete-tracker="${tracker.id}" type="button">Verwijderen</button>` : ""}
      <button class="btn btn-primary" data-save-tracker="${tracker?.id || "new"}" type="button">Opslaan</button>
    </div>
  `;
}

function logForm(tracker, entry = null, date = new Date()) {
  const opts = optionsOf(tracker);
  const local = entry ? parsePbDate(entry.logged_at) : date;
  const stamp = `${localISODate(local)}T${pad(local.getHours())}:${pad(local.getMinutes())}`;
  let body = "";
  if (tracker.type === "choice") {
    const choices = opts.choices || [];
    body = `<div class="choice-list">${choices.map((c) => `
      <button type="button" data-choice="${escapeHtml(c)}" class="${entry?.value_text === c ? "is-active" : ""}">${escapeHtml(c)}</button>
    `).join("")}</div>
    <input id="f-text" type="hidden" value="${escapeHtml(entry?.value_text || "")}" />`;
  } else if (tracker.type === "scale") {
    const min = Number(opts.min || 1);
    const max = Number(opts.max || 10);
    const current = entry?.value_number ?? "";
    body = `<div class="scale">${Array.from({ length: max - min + 1 }, (_, i) => min + i).map((n) => `
      <button type="button" data-scale="${n}" class="${Number(current) === n ? "is-active" : ""}">${n}</button>
    `).join("")}</div>
    <input id="f-number" type="hidden" value="${escapeHtml(current)}" />`;
  } else if (tracker.type === "number") {
    body = `<input id="f-number" type="number" step="${opts.step || 1}" value="${escapeHtml(entry?.value_number ?? "")}" />`;
  } else if (tracker.type === "text") {
    body = `<textarea id="f-text" placeholder="Vrij invullen">${escapeHtml(entry?.value_text || "")}</textarea>`;
  } else if (tracker.type === "counter") {
    body = `<input id="f-number" type="number" step="1" value="${escapeHtml(entry?.value_number ?? 1)}" />`;
  } else {
    body = `<p class="hint">Dit vinkt het item aan voor het gekozen moment.</p><input id="f-number" type="hidden" value="1" />`;
  }
  return `
    <h2 style="margin:0 0 8px">${escapeHtml(tracker.icon || "")} ${escapeHtml(tracker.name)}</h2>
    <p class="hint">${escapeHtml(tracker.description || TYPE_LABELS[tracker.type])}</p>
    ${body}
    <label>Notitie</label>
    <input id="f-note" value="${escapeHtml(entry?.note || "")}" />
    <label>Moment</label>
    <input id="f-when" type="datetime-local" value="${stamp}" />
    <div class="actions">
      ${entry ? `<button class="btn btn-danger" data-delete-entry="${entry.id}" type="button">Verwijderen</button>` : `<button class="btn btn-ghost" data-close="sheet" type="button">Annuleren</button>`}
      <button class="btn btn-primary" data-save-entry="${entry?.id || "new"}" data-tracker="${tracker.id}" type="button">Opslaan</button>
    </div>
  `;
}

function daySheet(dateStr) {
  const date = new Date(`${dateStr}T12:00:00`);
  const items = calendarEntriesForDay(date);
  return `
    <h2 style="margin:0 0 8px">${formatDayTitle(date)}</h2>
    ${items.length ? items.map((entry) => {
      const tracker = trackerById(entry.tracker);
      const label = entry.value_text || entry.value_number || "✓";
      return `
        <div class="entry">
          <div class="swatch" style="background:${tracker?.color || "#64748b"};width:34px;height:34px;border-radius:12px;font-size:16px">${escapeHtml(tracker?.icon || "●")}</div>
          <div>
            <strong>${escapeHtml(tracker?.name || "Onbekend")}</strong>
            <p class="hint">${escapeHtml(String(label))} · ${formatTime(parsePbDate(entry.logged_at))}${entry.note ? ` · ${escapeHtml(entry.note)}` : ""}</p>
          </div>
          <button class="btn btn-ghost" data-edit-entry="${entry.id}" type="button">Bewerk</button>
        </div>
      `;
    }).join("") : `<p class="empty">Niets gelogd op deze dag.</p>`}
    <div class="actions">
      <button class="btn btn-primary" data-add-on-day="${dateStr}" type="button">Item toevoegen</button>
    </div>
  `;
}

function pickTrackerSheet(dateStr) {
  const active = state.trackers.filter((t) => !t.archived);
  return `
    <h2 style="margin:0 0 8px">Wat wil je loggen?</h2>
    <div class="grid">
      ${active.map((t) => `
        <button class="card tracker-card" data-log-tracker="${t.id}" data-on-day="${dateStr}" type="button">
          <div class="swatch" style="background:${t.color}">${escapeHtml(t.icon || "●")}</div>
          <div class="meta"><h3>${escapeHtml(t.name)}</h3><p>${TYPE_LABELS[t.type]}</p></div>
        </button>
      `).join("")}
    </div>
  `;
}

function todayLogSheet() {
  return daySheet(state.selectedDay);
}

function parseOptions(type, raw) {
  const text = (raw || "").trim();
  if (type === "choice") {
    return { choices: text.split("\n").map((s) => s.trim()).filter(Boolean) };
  }
  if (type === "scale" || type === "number") {
    const m = text.match(/(-?\d+(?:\.\d+)?)\s*[-–tot]+\s*(-?\d+(?:\.\d+)?)/i);
    if (m) return { min: Number(m[1]), max: Number(m[2]), step: type === "number" ? 0.5 : 1 };
  }
  return text ? { raw: text } : {};
}

async function saveCategory(id) {
  const payload = {
    name: document.getElementById("f-cat-name").value.trim(),
    icon: document.getElementById("f-cat-icon").value.trim(),
    color: document.getElementById("f-cat-color").value.trim() || COLORS[0],
    sort_order: Number(document.getElementById("f-cat-sort").value || 0),
  };
  if (!payload.name) {
    toast("Naam is verplicht");
    return;
  }
  if (id === "new") {
    await pbRequest("/api/collections/categories/records", { method: "POST", body: JSON.stringify(payload) });
  } else {
    await pbRequest(`/api/collections/categories/records/${id}`, { method: "PATCH", body: JSON.stringify(payload) });
  }
  closeSheet();
  toast("Categorie opgeslagen");
  await refresh();
}

async function saveTracker(id) {
  const type = document.getElementById("f-type").value;
  const categoryId = document.getElementById("f-category")?.value || "";
  const payload = {
    name: document.getElementById("f-name").value.trim(),
    icon: document.getElementById("f-icon").value.trim(),
    color: document.getElementById("f-color").value.trim() || COLORS[0],
    type,
    unit: document.getElementById("f-unit").value.trim(),
    description: document.getElementById("f-desc").value.trim(),
    sort_order: Number(document.getElementById("f-sort").value || 0),
    archived: document.getElementById("f-archived").checked,
    category: categoryId || null,
    options: parseOptions(type, document.getElementById("f-options").value),
  };
  if (!payload.name) {
    toast("Naam is verplicht");
    return;
  }
  if (id === "new") {
    await pbRequest("/api/collections/trackers/records", { method: "POST", body: JSON.stringify(payload) });
  } else {
    await pbRequest(`/api/collections/trackers/records/${id}`, { method: "PATCH", body: JSON.stringify(payload) });
  }
  closeSheet();
  toast("Tracker opgeslagen");
  await refresh();
}

function collectEntryValues() {
  const textEl = document.getElementById("f-text");
  const numberEl = document.getElementById("f-number");
  const noteEl = document.getElementById("f-note");
  const whenEl = document.getElementById("f-when");
  const when = whenEl?.value ? new Date(whenEl.value) : new Date();
  return {
    value_text: textEl ? textEl.value : "",
    value_number: numberEl && numberEl.value !== "" ? Number(numberEl.value) : 0,
    note: noteEl ? noteEl.value : "",
    logged_at: toPbDate(when),
  };
}

async function saveEntry(id, trackerId) {
  const payload = { tracker: trackerId, ...collectEntryValues() };
  if (id === "new") {
    await pbRequest("/api/collections/entries/records", { method: "POST", body: JSON.stringify(payload) });
  } else {
    await pbRequest(`/api/collections/entries/records/${id}`, { method: "PATCH", body: JSON.stringify(payload) });
  }
  closeSheet();
  toast("Opgeslagen");
  await refresh();
}

async function quickCounter(tracker) {
  await pbRequest("/api/collections/entries/records", {
    method: "POST",
    body: JSON.stringify({
      tracker: tracker.id,
      value_number: 1,
      logged_at: toPbDate(logTimestampForSelectedDay()),
    }),
  });
  toast(`${tracker.name} +1`);
  await refresh();
}

async function quickCheck(tracker) {
  const day = selectedDayDate();
  const existing = entriesForTracker(tracker.id, day);
  if (existing.length) {
    await pbRequest(`/api/collections/entries/records/${existing[0].id}`, { method: "DELETE" });
    toast(`${tracker.name} ongedaan`);
  } else {
    await pbRequest("/api/collections/entries/records", {
      method: "POST",
      body: JSON.stringify({
        tracker: tracker.id,
        value_number: 1,
        logged_at: toPbDate(logTimestampForSelectedDay()),
      }),
    });
    toast(`${tracker.name} gedaan`);
  }
  await refresh();
}

appEl.addEventListener("click", async (event) => {
  const t = event.target.closest("[data-open-tracker],[data-open-category],[data-quick],[data-action],[data-cal-range],[data-cal-filter],[data-stats-range],[data-day],[data-edit-tracker],[data-edit-category]");
  if (!t) return;
  if (t.dataset.openCategory) {
    state.selectedCategoryId = t.dataset.openCategory;
    render();
    return;
  }
  if (t.dataset.quick === "counter") {
    event.stopPropagation();
    const tracker = trackerById(t.dataset.id);
    await quickCounter(tracker);
    return;
  }
  if (t.dataset.openTracker) {
    const tracker = trackerById(t.dataset.openTracker);
    if (tracker.type === "check") {
      await quickCheck(tracker);
      return;
    }
    if (tracker.type === "counter") {
      await quickCounter(tracker);
      return;
    }
    openSheet(logForm(tracker, null, logTimestampForSelectedDay()));
    return;
  }
  if (t.dataset.editTracker) {
    openSheet(trackerForm(trackerById(t.dataset.editTracker)));
    return;
  }
  if (t.dataset.editCategory) {
    openSheet(categoryForm(categoryById(t.dataset.editCategory)));
    return;
  }
  if (t.dataset.action === "new-category") openSheet(categoryForm());
  if (t.dataset.action === "new-tracker") openSheet(trackerForm());
  if (t.dataset.action === "category-back") {
    state.selectedCategoryId = null;
    render();
  }
  if (t.dataset.action === "open-log") openSheet(todayLogSheet());
  if (t.dataset.action === "day-prev") {
    state.selectedDay = localISODate(addDays(selectedDayDate(), -1));
    render();
  }
  if (t.dataset.action === "day-next") {
    state.selectedDay = localISODate(addDays(selectedDayDate(), 1));
    render();
  }
  if (t.dataset.calFilter) {
    state.calendarFilterTrackerId = t.dataset.calFilter === "all" ? null : t.dataset.calFilter;
    renderCalendar();
  }
  if (t.dataset.calRange) {
    state.calendarRange = t.dataset.calRange;
    renderCalendar();
  }
  if (t.dataset.statsRange) {
    state.statsRange = t.dataset.statsRange;
    renderStats();
  }
  if (t.dataset.day) openSheet(daySheet(t.dataset.day));
});

sheetEl.addEventListener("click", async (event) => {
  const t = event.target.closest("[data-close],[data-color],[data-cat-color],[data-choice],[data-scale],[data-save-tracker],[data-delete-tracker],[data-save-category],[data-delete-category],[data-save-entry],[data-delete-entry],[data-edit-entry],[data-add-on-day],[data-log-tracker]");
  if (!t) return;
  if (t.dataset.close === "sheet") {
    closeSheet();
    return;
  }
  if (t.dataset.catColor) {
    document.getElementById("f-cat-color").value = t.dataset.color;
    sheetEl.querySelectorAll("[data-cat-color]").forEach((el) => el.classList.toggle("is-active", el === t));
    return;
  }
  if (t.dataset.color) {
    document.getElementById("f-color").value = t.dataset.color;
    sheetEl.querySelectorAll(".color-dot:not([data-cat-color])").forEach((el) => el.classList.toggle("is-active", el === t));
    return;
  }
  if (t.dataset.choice) {
    const input = document.getElementById("f-text");
    if (input) input.value = t.dataset.choice;
    sheetEl.querySelectorAll("[data-choice]").forEach((el) => el.classList.toggle("is-active", el === t));
    return;
  }
  if (t.dataset.scale) {
    const input = document.getElementById("f-number");
    if (input) input.value = t.dataset.scale;
    sheetEl.querySelectorAll("[data-scale]").forEach((el) => el.classList.toggle("is-active", el === t));
    return;
  }
  try {
    if (t.dataset.saveCategory) await saveCategory(t.dataset.saveCategory);
    if (t.dataset.deleteCategory) {
      if (!confirm("Categorie verwijderen? Trackers blijven bestaan maar verliezen deze categorie.")) return;
      await pbRequest(`/api/collections/categories/records/${t.dataset.deleteCategory}`, { method: "DELETE" });
      closeSheet();
      toast("Categorie verwijderd");
      await refresh();
    }
    if (t.dataset.saveTracker) await saveTracker(t.dataset.saveTracker);
    if (t.dataset.deleteTracker) {
      if (!confirm("Tracker en alle logs verwijderen?")) return;
      await pbRequest(`/api/collections/trackers/records/${t.dataset.deleteTracker}`, { method: "DELETE" });
      closeSheet();
      toast("Tracker verwijderd");
      await refresh();
    }
    if (t.dataset.saveEntry) await saveEntry(t.dataset.saveEntry, t.dataset.tracker);
    if (t.dataset.deleteEntry) {
      await pbRequest(`/api/collections/entries/records/${t.dataset.deleteEntry}`, { method: "DELETE" });
      closeSheet();
      toast("Log verwijderd");
      await refresh();
    }
    if (t.dataset.editEntry) {
      const entry = state.entries.find((e) => e.id === t.dataset.editEntry);
      const tracker = trackerById(entry.tracker);
      openSheet(logForm(tracker, entry));
    }
    if (t.dataset.addOnDay) openSheet(pickTrackerSheet(t.dataset.addOnDay));
    if (t.dataset.logTracker) {
      const tracker = trackerById(t.dataset.logTracker);
      const date = new Date(`${t.dataset.onDay}T${pad(new Date().getHours())}:${pad(new Date().getMinutes())}:00`);
      if (tracker.type === "check" || tracker.type === "counter") {
        await pbRequest("/api/collections/entries/records", {
          method: "POST",
          body: JSON.stringify({
            tracker: tracker.id,
            value_number: 1,
            logged_at: toPbDate(date),
          }),
        });
        closeSheet();
        toast("Gelogd");
        await refresh();
        return;
      }
      openSheet(logForm(tracker, null, date));
    }
  } catch (err) {
    toast(err.message);
  }
});

document.querySelector(".tabbar").addEventListener("click", (event) => {
  const tab = event.target.closest(".tab");
  if (tab) setView(tab.dataset.view);
});

document.getElementById("refreshBtn").addEventListener("click", () => refresh());

refresh();
