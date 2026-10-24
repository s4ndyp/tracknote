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
  statsRange: "month",
  statsAnchor: localISODate(new Date()),
  statsTrackerId: null,
  selectedDay: localISODate(new Date()),
  loading: false,
  logsFilter: {
    trackerId: "",
    entryKey: "",
    range: "month",
    anchor: localISODate(new Date()),
  },
  logsSelectedIds: [],
};

const APP_VERSION = "1.0.32";
const DESKTOP_LAYOUT_MQ = "(min-width: 900px)";
const BACKUP_FORMAT = "tracknote-backup";
const BACKUP_VERSION = 1;

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

function formatDayShort(date) {
  return date.toLocaleDateString("nl-NL", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

function trackerChipLabel(name) {
  const text = String(name || "").trim();
  if (text.length <= 14) return text;
  return `${text.slice(0, 13)}…`;
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

function isDesktopLayout() {
  return typeof window !== "undefined" && window.matchMedia(DESKTOP_LAYOUT_MQ).matches;
}

function categoryGridLayout(count) {
  if (count <= 0) return { cols: 1, rows: 1 };
  if (isDesktopLayout()) {
    if (count === 1) return { cols: 1, rows: 1 };
    if (count === 2) return { cols: 2, rows: 1 };
    if (count <= 4) return { cols: 2, rows: 2 };
    if (count <= 6) return { cols: 3, rows: 2 };
    if (count <= 9) return { cols: 3, rows: 3 };
    const cols = Math.min(4, Math.ceil(Math.sqrt(count * 1.15)));
    return { cols, rows: Math.ceil(count / cols) };
  }
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

function trackerOncePerDay(tracker) {
  return Boolean(tracker?.once_per_day);
}

function trackerIsLockedForDay(tracker, day) {
  return trackerOncePerDay(tracker) && entriesForTracker(tracker.id, day).length > 0;
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

function backupCategoryRecord(record) {
  return {
    id: record.id,
    name: record.name,
    icon: record.icon || "",
    color: record.color,
    sort_order: record.sort_order ?? 0,
  };
}

function backupTrackerRecord(record) {
  return {
    id: record.id,
    name: record.name,
    icon: record.icon || "",
    color: record.color,
    type: record.type,
    unit: record.unit || "",
    options: optionsOf(record),
    description: record.description || "",
    sort_order: record.sort_order ?? 0,
    archived: Boolean(record.archived),
    once_per_day: Boolean(record.once_per_day),
    category: record.category || null,
  };
}

function backupEntryRecord(record) {
  return {
    id: record.id,
    tracker: record.tracker,
    logged_at: record.logged_at,
    value_number: record.value_number ?? 0,
    value_text: record.value_text || "",
    note: record.note || "",
  };
}

function parseBackupJson(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch (_) {
    throw new Error("Geen geldig JSON-bestand");
  }
  if (data?.format !== BACKUP_FORMAT) {
    throw new Error("Onbekend backupformaat");
  }
  if (Number(data.version) !== BACKUP_VERSION) {
    throw new Error(`Backupversie ${data.version ?? "?"} wordt niet ondersteund`);
  }
  if (!Array.isArray(data.categories) || !Array.isArray(data.trackers) || !Array.isArray(data.entries)) {
    throw new Error("Backup mist categorieën, trackers of logs");
  }
  const trackerIds = new Set(data.trackers.map((t) => t.id));
  const badEntry = data.entries.find((e) => !trackerIds.has(e.tracker));
  if (badEntry) {
    throw new Error("Backup bevat logs zonder bijbehorende tracker");
  }
  return data;
}

async function deleteAllInCollection(collection) {
  const items = await listAll(collection);
  for (const item of items) {
    await pbRequest(`/api/collections/${collection}/records/${item.id}`, { method: "DELETE" });
  }
  return items.length;
}

async function createBackupRecord(collection, payload) {
  try {
    await pbRequest(`/api/collections/${collection}/records`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
    return payload.id;
  } catch (firstErr) {
    if (!payload.id) throw firstErr;
    const { id, ...rest } = payload;
    const created = await pbRequest(`/api/collections/${collection}/records`, {
      method: "POST",
      body: JSON.stringify(rest),
    });
    return created.id;
  }
}

async function exportBackup() {
  await loadCategories();
  await loadTrackers();
  const entries = await listAll("entries", { sort: "logged_at" });
  const backup = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    app_version: APP_VERSION,
    exported_at: new Date().toISOString(),
    categories: state.categories.map(backupCategoryRecord),
    trackers: state.trackers.map(backupTrackerRecord),
    entries: entries.map(backupEntryRecord),
  };
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `tracknote-backup-${localISODate(new Date())}.json`;
  link.click();
  URL.revokeObjectURL(url);
  toast(`Backup: ${backup.categories.length} categorieën, ${backup.trackers.length} trackers, ${backup.entries.length} logs`);
}

async function restoreBackup(data) {
  state.loading = true;
  render();
  try {
    await deleteAllInCollection("entries");
    await deleteAllInCollection("trackers");
    await deleteAllInCollection("categories");

    const categoryIdMap = new Map();
    for (const category of data.categories) {
      const newId = await createBackupRecord("categories", {
        id: category.id,
        name: category.name,
        icon: category.icon || "",
        color: category.color,
        sort_order: category.sort_order ?? 0,
      });
      categoryIdMap.set(category.id, newId);
    }

    const trackerIdMap = new Map();
    for (const tracker of data.trackers) {
      const categoryRef = tracker.category ? categoryIdMap.get(tracker.category) || null : null;
      const newId = await createBackupRecord("trackers", {
        id: tracker.id,
        name: tracker.name,
        icon: tracker.icon || "",
        color: tracker.color,
        type: tracker.type,
        unit: tracker.unit || "",
        options: tracker.options || {},
        description: tracker.description || "",
        sort_order: tracker.sort_order ?? 0,
        archived: Boolean(tracker.archived),
        once_per_day: Boolean(tracker.once_per_day),
        category: categoryRef,
      });
      trackerIdMap.set(tracker.id, newId);
    }

    for (const entry of data.entries) {
      const trackerRef = trackerIdMap.get(entry.tracker);
      if (!trackerRef) continue;
      await createBackupRecord("entries", {
        id: entry.id,
        tracker: trackerRef,
        logged_at: entry.logged_at,
        value_number: entry.value_number ?? 0,
        value_text: entry.value_text || "",
        note: entry.note || "",
      });
    }

    closeSheet();
    toast(`Teruggezet: ${data.categories.length} categorieën, ${data.trackers.length} trackers, ${data.entries.length} logs`);
    state.statsTrackerId = null;
    await refresh(2000);
  } finally {
    state.loading = false;
    render();
  }
}

function backupRestoreSheet() {
  return `
    <h2 style="margin:0 0 8px">Backup terugzetten</h2>
    <p class="hint">Importeer een eerder gedownload JSON-backupbestand. Alle categorieën, trackers en logs op deze server worden vervangen.</p>
    <label for="f-backup-file">Backupbestand</label>
    <input id="f-backup-file" type="file" accept=".json,application/json" />
    <div class="actions">
      <button class="btn btn-danger" data-action="restore-backup" type="button">Alles vervangen en terugzetten</button>
    </div>
  `;
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
  sheetEl.classList.remove("is-modal");
  sheetBody.innerHTML = "";
}

function openSheet(html) {
  sheetEl.classList.remove("is-modal");
  sheetBody.innerHTML = html;
  sheetEl.hidden = false;
  setupTextAutocomplete();
}

function openLogModal(html) {
  sheetEl.classList.add("is-modal");
  sheetBody.innerHTML = html;
  sheetEl.hidden = false;
  setupTextAutocomplete();
}

function textValueNorm(value) {
  return String(value ?? "").trim().toLocaleLowerCase("nl-NL");
}

function previousTextValuesForTracker(trackerId, { excludeEntryId = null, limit = 80 } = {}) {
  const byNorm = new Map();
  const sorted = state.entries
    .filter((e) => e.tracker === trackerId && String(e.value_text ?? "").trim())
    .sort((a, b) => parsePbDate(b.logged_at) - parsePbDate(a.logged_at));
  for (const entry of sorted) {
    if (excludeEntryId && entry.id === excludeEntryId) continue;
    const raw = String(entry.value_text).trim();
    const norm = textValueNorm(raw);
    if (!norm || byNorm.has(norm)) continue;
    byNorm.set(norm, raw);
    if (byNorm.size >= limit) break;
  }
  return [...byNorm.values()].sort((a, b) => a.localeCompare(b, "nl"));
}

function textSuggestionsForQuery(query, suggestions) {
  const q = textValueNorm(query);
  if (q.length < 2) return [];
  return suggestions
    .filter((s) => textValueNorm(s).includes(q))
    .slice(0, 10);
}

function setupTextAutocomplete() {
  const input = sheetBody.querySelector("#f-text[data-text-suggest]");
  const list = sheetBody.querySelector("#f-text-suggestions");
  if (!input || !list) return;
  const saveBtn = sheetBody.querySelector("[data-save-entry]");
  const trackerId = saveBtn?.dataset.tracker;
  if (!trackerId) return;
  const entryId = saveBtn?.dataset.saveEntry;
  const excludeEntryId = entryId && entryId !== "new" ? entryId : null;
  const suggestions = previousTextValuesForTracker(trackerId, { excludeEntryId });

  const render = () => {
    const matches = textSuggestionsForQuery(input.value, suggestions);
    if (!matches.length) {
      list.hidden = true;
      list.innerHTML = "";
      return;
    }
    list.innerHTML = matches.map((label) => `
      <li><button type="button" data-text-suggest-pick>${escapeHtml(label)}</button></li>
    `).join("");
    list.hidden = false;
  };

  input.addEventListener("input", render);
  input.addEventListener("focus", render);
  input.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      list.hidden = true;
    }
  });
}

function setView(view) {
  state.view = view;
  if (view === "today") {
    state.selectedDay = localISODate(new Date());
  }
  if (view === "stats") {
    state.statsTrackerId = null;
  }
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.classList.toggle("is-active", tab.dataset.view === view);
  });
  render();
}

async function refresh(rangeDays = 400) {
  const showLoadingScreen = !state.trackers.length;
  if (showLoadingScreen) {
    state.loading = true;
    render();
  }
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

function setAppHeading(label) {
  pageTitle.innerHTML = `${escapeHtml(label)} <span class="app-version">v${APP_VERSION}</span>`;
}

function render() {
  const titles = {
    stats: "Statistieken",
    trackers: "Trackers",
    logs: "Logs",
  };
  document.body.classList.toggle("view-today", state.view === "today");
  document.body.classList.toggle("view-logs", state.view === "logs");
  if (state.view === "today") {
    todayLabel.textContent = "";
    setAppHeading("Vandaag");
  } else if (state.view === "logs") {
    todayLabel.textContent = "";
    setAppHeading("Logs");
  } else if (state.view === "stats" && state.statsTrackerId) {
    todayLabel.textContent = "";
    const tracker = trackerById(state.statsTrackerId);
    setAppHeading(tracker?.name || titles.stats);
  } else {
    todayLabel.textContent = formatDayTitle(new Date());
    setAppHeading(titles[state.view] || "Tracknote");
  }
  if (state.loading && !state.trackers.length) {
    appEl.innerHTML = `<p class="empty">Laden…</p>`;
    return;
  }
  if (state.view === "today") renderToday();
  else if (state.view === "stats") renderStats();
  else if (state.view === "logs") renderLogs();
  else renderTrackers();
}

function todayBarHtml(day, dayItems, dayLabel) {
  return `
    <div class="today-bar">
      <button class="icon-btn today-bar-nav" data-action="day-prev" type="button" aria-label="Vorige dag">‹</button>
      <div class="today-bar-mid">
        <p class="today-bar-date">${escapeHtml(formatDayShort(day))}</p>
        <p class="today-bar-meta">${dayItems.length} log${dayItems.length === 1 ? "" : "s"} ${dayLabel}</p>
      </div>
      <button class="icon-btn today-bar-nav" data-action="day-next" type="button" aria-label="Volgende dag">›</button>
      <button class="btn btn-ghost btn-sm" data-action="open-log" type="button">Logs</button>
    </div>
  `;
}

function categoryStatusText(categoryId, day) {
  const trackers = trackersInCategory(categoryId);
  if (!trackers.length) return "Geen trackers";
  const filled = trackers.filter((t) => entriesForTracker(t.id, day).length > 0).length;
  const logs = categoryDayLogCount(categoryId, day);
  if (filled === trackers.length) return `Alles ingevuld · ${logs} log${logs === 1 ? "" : "s"}`;
  if (filled === 0) return isSelectedToday() ? "Nog niets vandaag" : "Nog niets";
  return `${filled}/${trackers.length} ingevuld · ${logs} log${logs === 1 ? "" : "s"}`;
}

function trackerChipMeta(tracker, day) {
  const items = entriesForTracker(tracker.id, day);
  if (!items.length) return { filled: false, active: false, badge: "", locked: false };
  const locked = trackerIsLockedForDay(tracker, day);
  if (tracker.type === "counter") {
    const total = items.reduce((sum, e) => sum + Number(e.value_number || 1), 0);
    return { filled: true, active: true, badge: String(total), locked };
  }
  return { filled: true, active: true, badge: "", locked };
}

function trackerChipInner(tracker, meta) {
  const counterBadge = meta.filled && tracker.type === "counter" && meta.badge
    ? `<span class="tracker-chip-badge tracker-chip-badge--count">${escapeHtml(meta.badge)}</span>`
    : "";
  const filledCheck = meta.filled
    ? `<span class="tracker-chip-check" aria-hidden="true"><svg viewBox="0 0 12 12" width="10" height="10" fill="none"><path d="M2 6.2 4.8 9 10 3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></span>`
    : "";
  return `
    <span class="tracker-chip-label">${escapeHtml(trackerChipLabel(tracker.name))}</span>
    ${filledCheck}
    ${counterBadge}
  `;
}

function trackerChipHtml(tracker, {
  interactive = false,
  day = null,
  editTrackerId = null,
  logTrackerId = null,
  logOnDay = null,
  extraClass = "",
  showDayState = true,
} = {}) {
  const dayDate = day || selectedDayDate();
  const meta = showDayState
    ? trackerChipMeta(tracker, dayDate)
    : { filled: false, active: false, badge: "", locked: false };
  const title = `${tracker.name}: ${summaryFor(tracker, dayDate)}`;
  const locked = interactive && meta.locked;
  const isActionChip = interactive || editTrackerId || logTrackerId;
  const classes = [
    "tracker-chip",
    meta.active ? "is-active" : "",
    meta.filled ? "is-filled" : "",
    locked ? "is-locked" : "",
    isActionChip ? "" : "tracker-chip--preview",
    tracker.archived ? "is-archived" : "",
    extraClass,
  ].filter(Boolean).join(" ");

  if (editTrackerId || logTrackerId) {
    const lockedLog = Boolean(logTrackerId && meta.locked);
    const attrs = editTrackerId
      ? `type="button" data-edit-tracker="${editTrackerId}"`
      : `type="button" data-log-tracker="${logTrackerId}" data-on-day="${escapeHtml(logOnDay || "")}"${lockedLog ? " disabled" : ""}`;
    return `
      <button
        ${attrs}
        class="${classes}${lockedLog ? " is-locked" : ""}"
        title="${escapeHtml(tracker.name)}"
        aria-label="${escapeHtml(tracker.name)}"
        style="--chip-color:${escapeHtml(tracker.color)}"
      >
        ${trackerChipInner(tracker, meta)}
      </button>
    `;
  }

  const tag = interactive ? "button" : "span";
  const actionAttrs = interactive
    ? `type="button" data-open-tracker="${tracker.id}"${locked ? " disabled" : ""}`
    : `aria-hidden="true"`;
  return `
    <${tag}
      ${actionAttrs}
      class="${classes}"
      title="${escapeHtml(title)}"
      ${interactive ? `aria-label="${escapeHtml(title)}"` : ""}
      style="--chip-color:${escapeHtml(tracker.color)}"
    >
      ${trackerChipInner(tracker, meta)}
    </${tag}>
  `;
}

function categoryTrackerChip(tracker, interactive) {
  return trackerChipHtml(tracker, { interactive, day: selectedDayDate() });
}

function categoryTileContent(category) {
  const day = selectedDayDate();
  const trackers = trackersInCategory(category.id);
  return `
    <span class="category-tile-head">
      <span class="category-tile-name">${escapeHtml(category.name)}</span>
      <span class="category-tile-meta">${escapeHtml(categoryStatusText(category.id, day))}</span>
    </span>
    <span class="category-tile-frame">
      <span class="tracker-chip-grid tracker-chip-grid--category">
        ${trackers.length
          ? trackers.map((t) => categoryTrackerChip(t, true)).join("")
          : `<span class="category-tile-empty">Geen trackers</span>`}
      </span>
    </span>
  `;
}

function categoryTile(category) {
  return `
    <article
      class="category-tile"
      data-category-id="${category.id}"
      style="--tile-color:${escapeHtml(category.color)}"
    >
      ${categoryTileContent(category)}
    </article>
  `;
}

function renderToday() {
  const day = selectedDayDate();
  const dayItems = entriesForDay(day);
  const dayLabel = isSelectedToday() ? "vandaag" : "op deze dag";
  const cats = [...state.categories].sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
  const { cols } = categoryGridLayout(Math.max(cats.length, 1));
  const colMin = isDesktopLayout() ? "minmax(260px, 1fr)" : "minmax(0, 1fr)";
  appEl.classList.add("app--tiles");
  appEl.innerHTML = `
    <div class="category-stage-wrap">
      <div
        class="category-stage"
        style="grid-template-columns:repeat(${cols}, ${colMin})"
      >
        ${cats.length ? cats.map(categoryTile).join("") : `<p class="empty">Nog geen categorieën. Voeg ze toe onder Trackers.</p>`}
      </div>
    </div>
    ${todayBarHtml(day, dayItems, dayLabel)}
  `;
}

function defaultLogsFilter() {
  return {
    trackerId: "",
    entryKey: "",
    range: "month",
    anchor: localISODate(new Date()),
  };
}

function entryValueKey(entry) {
  const text = String(entry.value_text ?? "").trim();
  if (text) return `t:${text}`;
  const num = entry.value_number;
  if (num != null && num !== "" && Number(num) !== 0) return `n:${num}`;
  return "check";
}

function entryValueLabel(entry, tracker) {
  const text = String(entry.value_text ?? "").trim();
  if (text) return text;
  if (tracker?.type === "check") return "Gedaan";
  const num = entry.value_number;
  if (num != null && num !== "") {
    const unit = tracker?.unit ? ` ${tracker.unit}` : "";
    return `${num}${unit}`;
  }
  return "✓";
}

function logsFilterBounds() {
  const range = state.logsFilter.range;
  if (range === "all") return null;
  const anchor = startOfDay(new Date(`${state.logsFilter.anchor}T12:00:00`));
  return {
    from: rangeStart(range, anchor),
    to: endOfDay(anchor),
  };
}

function formatLogsPeriodLabel() {
  const range = state.logsFilter.range;
  const end = startOfDay(new Date(`${state.logsFilter.anchor}T12:00:00`));
  if (range === "week") {
    const from = addDays(end, -6);
    return `${from.toLocaleDateString("nl-NL", { day: "numeric", month: "short" })} – ${end.toLocaleDateString("nl-NL", { day: "numeric", month: "short", year: "numeric" })}`;
  }
  if (range === "month") {
    return end.toLocaleDateString("nl-NL", { month: "long", year: "numeric" });
  }
  const monthsBack = range === "6m" ? 5 : 11;
  const from = addMonths(end, -monthsBack);
  const fromLabel = from.toLocaleDateString("nl-NL", { month: "short" });
  const toLabel = end.toLocaleDateString("nl-NL", { month: "short" });
  if (from.getFullYear() === end.getFullYear()) {
    return `${fromLabel} – ${toLabel} ${end.getFullYear()}`;
  }
  return `${fromLabel} ${from.getFullYear()} – ${toLabel} ${end.getFullYear()}`;
}

function shiftLogsPeriodAnchor(direction) {
  const range = state.logsFilter.range;
  if (range === "all") return;
  let next = startOfDay(new Date(`${state.logsFilter.anchor}T12:00:00`));
  if (range === "week") next = addDays(next, 7 * direction);
  else if (range === "month") next = addMonths(next, direction);
  else if (range === "6m") next = addMonths(next, 6 * direction);
  else if (range === "year") next = addMonths(next, 12 * direction);
  state.logsFilter.anchor = localISODate(next);
}

function filteredLogsEntries({ skipEntry = false } = {}) {
  const bounds = logsFilterBounds();
  const trackerId = state.logsFilter.trackerId;
  const entryKey = skipEntry ? "" : state.logsFilter.entryKey;
  return state.entries
    .filter((entry) => {
      const at = parsePbDate(entry.logged_at);
      if (bounds && (at < bounds.from || at > bounds.to)) return false;
      if (trackerId && entry.tracker !== trackerId) return false;
      if (entryKey && entryValueKey(entry) !== entryKey) return false;
      return true;
    })
    .sort((a, b) => parsePbDate(b.logged_at) - parsePbDate(a.logged_at));
}

function logsEntryFilterOptions() {
  const seen = new Map();
  filteredLogsEntries({ skipEntry: true }).forEach((entry) => {
    const key = entryValueKey(entry);
    if (!seen.has(key)) {
      seen.set(key, entryValueLabel(entry, trackerById(entry.tracker)));
    }
  });
  return [...seen.entries()].sort((a, b) => a[1].localeCompare(b[1], "nl"));
}

function pruneLogsSelection() {
  const visible = new Set(filteredLogsEntries().map((e) => e.id));
  state.logsSelectedIds = state.logsSelectedIds.filter((id) => visible.has(id));
}

function logsPeriodNavHtml() {
  if (state.logsFilter.range === "all") return "";
  return `
    <div class="period-nav" role="group" aria-label="Periode logs">
      <button class="icon-btn icon-btn-sm" data-action="logs-period-prev" type="button" aria-label="Vorige periode">‹</button>
      <p class="period-nav-label">${escapeHtml(formatLogsPeriodLabel())}</p>
      <button class="icon-btn icon-btn-sm" data-action="logs-period-next" type="button" aria-label="Volgende periode">›</button>
    </div>
  `;
}

function logListRow(entry, selected) {
  const tracker = trackerById(entry.tracker);
  const at = parsePbDate(entry.logged_at);
  const value = entryValueLabel(entry, tracker);
  return `
    <div class="log-row entry">
      <input
        type="checkbox"
        class="log-row-check"
        data-logs-select="${escapeHtml(entry.id)}"
        ${selected ? "checked" : ""}
        aria-label="Selecteer log"
      />
      <span class="tracker-chip tracker-chip--preview entry-chip" style="--chip-color:${escapeHtml(tracker?.color || "#64748b")}">
        <span class="tracker-chip-label">${escapeHtml(trackerChipLabel(tracker?.name || "?"))}</span>
      </span>
      <div class="log-row-body">
        <strong>${escapeHtml(tracker?.name || "Onbekend")}</strong>
        <p class="hint">${escapeHtml(value)} · ${formatDayShort(at)} ${formatTime(at)}${entry.note ? ` · ${escapeHtml(entry.note)}` : ""}</p>
      </div>
      <button class="btn btn-ghost btn-sm" data-edit-entry="${escapeHtml(entry.id)}" type="button">Bewerk</button>
    </div>
  `;
}

function bulkEditSheet(ids) {
  const entries = ids.map((id) => state.entries.find((e) => e.id === id)).filter(Boolean);
  const tracker = entries.length && entries.every((e) => e.tracker === entries[0].tracker)
    ? trackerById(entries[0].tracker)
    : null;
  let valueField = "";
  if (tracker) {
    const opts = optionsOf(tracker);
    if (tracker.type === "number" || tracker.type === "counter") {
      valueField = `
        <label>Nieuw getal <span class="optional">(leeg = niet wijzigen)</span></label>
        <input id="bulk-number" type="number" step="${tracker.type === "counter" ? 1 : opts.step || 1}" />
      `;
    } else if (tracker.type === "text") {
      valueField = `
        <label>Nieuwe tekst <span class="optional">(leeg = niet wijzigen)</span></label>
        <textarea id="bulk-text"></textarea>
      `;
    } else if (tracker.type === "choice") {
      const choices = opts.choices || [];
      valueField = `
        <label>Nieuwe keuze</label>
        <select id="bulk-choice">
          <option value="">— niet wijzigen —</option>
          ${choices.map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join("")}
        </select>
      `;
    } else if (tracker.type === "scale") {
      const min = Number(opts.min || 1);
      const max = Number(opts.max || 10);
      valueField = `
        <label>Nieuwe schaal</label>
        <select id="bulk-number">
          <option value="">— niet wijzigen —</option>
          ${Array.from({ length: max - min + 1 }, (_, i) => min + i).map((n) => `
            <option value="${n}">${n}</option>
          `).join("")}
        </select>
      `;
    }
  } else if (entries.length > 1) {
    valueField = `<p class="hint">Waarde wijzigen kan alleen als alle geselecteerde logs dezelfde tracker hebben.</p>`;
  }
  return `
    <h2 style="margin:0 0 8px">${entries.length} logs wijzigen</h2>
    <p class="hint">Alleen ingevulde velden worden toegepast op alle geselecteerde logs.</p>
    ${valueField}
    <label>Notitie <span class="optional">(leeg = niet wijzigen)</span></label>
    <input id="bulk-note" placeholder="Nieuwe notitie" />
    <label class="row" style="margin-top:10px">
      <input id="bulk-clear-note" type="checkbox" style="width:auto" />
      Notitie wissen
    </label>
    <label>Dagen verschuiven</label>
    <input id="bulk-day-shift" type="number" step="1" value="0" placeholder="0 = niet verschuiven" />
    <p class="hint" style="margin-top:4px">Positief = later, negatief = eerder.</p>
    <div class="actions">
      <button class="btn btn-primary" data-save-bulk-edit="${escapeHtml(ids.join(","))}" type="button">Toepassen</button>
    </div>
  `;
}

async function saveBulkEdit(idsCsv) {
  const ids = idsCsv.split(",").filter(Boolean);
  const noteEl = document.getElementById("bulk-note");
  const clearNote = document.getElementById("bulk-clear-note")?.checked;
  const dayShift = Number(document.getElementById("bulk-day-shift")?.value || 0);
  const textEl = document.getElementById("bulk-text");
  const numberEl = document.getElementById("bulk-number");
  const choiceEl = document.getElementById("bulk-choice");
  let updated = 0;
  for (const id of ids) {
    const entry = state.entries.find((e) => e.id === id);
    if (!entry) continue;
    const patch = {};
    if (clearNote) patch.note = "";
    else if (noteEl?.value.trim()) patch.note = noteEl.value.trim();
    if (dayShift !== 0) {
      patch.logged_at = toPbDate(addDays(parsePbDate(entry.logged_at), dayShift));
    }
    if (textEl?.value.trim()) patch.value_text = textEl.value.trim();
    if (choiceEl?.value) patch.value_text = choiceEl.value;
    if (numberEl?.value !== "" && numberEl?.value != null) patch.value_number = Number(numberEl.value);
    if (!Object.keys(patch).length) continue;
    await pbRequest(`/api/collections/entries/records/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
    updated += 1;
  }
  closeSheet();
  toast(updated ? `${updated} logs bijgewerkt` : "Geen wijzigingen");
  state.logsSelectedIds = state.logsSelectedIds.filter((id) => !ids.includes(id));
  await refresh();
}

async function bulkDeleteLogs(ids) {
  if (!ids.length) return;
  if (!confirm(`${ids.length} log${ids.length === 1 ? "" : "s"} definitief verwijderen?`)) return;
  for (const id of ids) {
    await pbRequest(`/api/collections/entries/records/${id}`, { method: "DELETE" });
  }
  state.logsSelectedIds = [];
  toast(`${ids.length} log${ids.length === 1 ? "" : "s"} verwijderd`);
  await refresh();
}

function renderLogs() {
  appEl.classList.remove("app--tiles");
  pruneLogsSelection();
  const filtered = filteredLogsEntries();
  const selectedSet = new Set(state.logsSelectedIds);
  const range = state.logsFilter.range;
  const entryOptions = logsEntryFilterOptions();
  const trackers = [...state.trackers].sort((a, b) => a.name.localeCompare(b.name, "nl"));

  appEl.innerHTML = `
    <div class="logs-page">
      <div class="logs-filters">
        <div class="logs-filter-row">
          <label class="logs-filter-label" for="logs-filter-tracker">Tracker</label>
          <select id="logs-filter-tracker" class="logs-select" data-logs-filter-tracker aria-label="Filter op tracker">
            <option value="">Alle trackers</option>
            ${trackers.map((t) => `
              <option value="${escapeHtml(t.id)}" ${state.logsFilter.trackerId === t.id ? "selected" : ""}>${escapeHtml(t.name)}</option>
            `).join("")}
          </select>
        </div>
        <div class="logs-filter-row">
          <label class="logs-filter-label" for="logs-filter-entry">Invoer</label>
          <select id="logs-filter-entry" class="logs-select" data-logs-filter-entry aria-label="Filter op invoer"${entryOptions.length ? "" : " disabled"}>
            <option value="">Alle invoeren</option>
            ${entryOptions.map(([key, label]) => `
              <option value="${escapeHtml(key)}" ${state.logsFilter.entryKey === key ? "selected" : ""}>${escapeHtml(label)}</option>
            `).join("")}
          </select>
        </div>
        <div class="period-toolbar logs-period-toolbar">
          ${logsPeriodNavHtml()}
          <div class="segment">
            <button data-logs-range="week" class="${range === "week" ? "is-active" : ""}" type="button">7 dagen</button>
            <button data-logs-range="month" class="${range === "month" ? "is-active" : ""}" type="button">Deze maand</button>
            <button data-logs-range="6m" class="${range === "6m" ? "is-active" : ""}" type="button">6 maanden</button>
            <button data-logs-range="year" class="${range === "year" ? "is-active" : ""}" type="button">Jaar</button>
            <button data-logs-range="all" class="${range === "all" ? "is-active" : ""}" type="button">Alles</button>
          </div>
        </div>
        <div class="logs-filter-actions">
          <button class="btn btn-ghost btn-sm" data-action="logs-select-all" type="button">Selecteer alles</button>
          <button class="btn btn-ghost btn-sm" data-action="logs-clear-filters" type="button">Filters wissen</button>
        </div>
      </div>
      ${selectedSet.size ? `
        <div class="logs-bulk-bar" role="toolbar" aria-label="Bulkacties">
          <span class="logs-bulk-count">${selectedSet.size} geselecteerd</span>
          <button class="btn btn-ghost btn-sm" data-action="logs-bulk-edit" type="button">Wijzig</button>
          <button class="btn btn-danger btn-sm" data-action="logs-bulk-delete" type="button">Verwijder</button>
          <button class="btn btn-ghost btn-sm" data-action="logs-clear-selection" type="button">Deselecteer</button>
        </div>
      ` : ""}
      <div class="view-body view-body--logs">
        <p class="hint logs-result-count">${filtered.length} log${filtered.length === 1 ? "" : "s"}</p>
        ${filtered.length
          ? filtered.map((entry) => logListRow(entry, selectedSet.has(entry.id))).join("")
          : `<p class="empty">Geen logs voor dit filter.</p>`}
      </div>
    </div>
  `;
}

function monthMatrix(year, month) {
  const first = new Date(year, month, 1);
  const startOffset = (first.getDay() + 6) % 7;
  const start = addDays(first, -startOffset);
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
}

function calendarEntriesForDay(date, trackerId) {
  return entriesForDay(date).filter((e) => e.tracker === trackerId);
}

function trackerPaletteOffset(id) {
  let hash = 0;
  const text = String(id || "");
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash + text.charCodeAt(i) * 17) % COLORS.length;
  }
  return hash;
}

function choiceColorsForTracker(tracker) {
  const choices = optionsOf(tracker).choices || [];
  const offset = trackerPaletteOffset(tracker?.id);
  const map = new Map();
  choices.forEach((label, index) => {
    map.set(label, COLORS[(offset + index) % COLORS.length]);
  });
  return map;
}

function colorForChoiceValue(tracker, valueText) {
  const map = choiceColorsForTracker(tracker);
  const key = String(valueText ?? "").trim();
  if (map.has(key)) return map.get(key);
  return tracker?.color || "#64748b";
}

function calendarChoiceLegendHtml(tracker) {
  if (!tracker || tracker.type !== "choice") return "";
  const choices = optionsOf(tracker).choices || [];
  if (!choices.length) return "";
  const colors = choiceColorsForTracker(tracker);
  return `
    <div class="cal-choice-legend" role="list" aria-label="Legenda keuzes">
      ${choices.map((label) => `
        <span class="cal-legend-item" role="listitem">
          <i class="dot" style="background:${escapeHtml(colors.get(label))}"></i>
          <span>${escapeHtml(label)}</span>
        </span>
      `).join("")}
    </div>
  `;
}

function calendarFilterHintHtml(tracker) {
  if (!tracker) return "";
  if (tracker.type === "choice") {
    return `<p class="hint cal-filter-hint">Kleur in de cel = keuze die dag · tik op een dag voor details</p>`;
  }
  return `<p class="hint cal-filter-hint">Waarde per dag in de cel · tik op een dag voor alle details</p>`;
}

function truncateCalendarLabel(text, max) {
  const value = String(text ?? "").trim();
  if (value.length <= max) return value;
  return `${value.slice(0, Math.max(1, max - 1))}…`;
}

function calendarValueLabel(tracker, items, { mini = false } = {}) {
  if (!tracker || !items.length) return "";
  const textMax = mini ? 5 : 16;
  if (tracker.type === "check") return "✓";
  if (tracker.type === "counter") {
    const total = items.reduce((sum, e) => sum + Number(e.value_number || 1), 0);
    if (mini) return String(total);
    const unit = tracker.unit ? ` ${truncateCalendarLabel(tracker.unit, 8)}` : "";
    return `${total}${unit}`;
  }
  if (tracker.type === "scale" || tracker.type === "number") {
    const last = items[0];
    const num = last.value_number ?? "—";
    if (mini || !tracker.unit) return String(num);
    return `${num} ${truncateCalendarLabel(tracker.unit, 6)}`;
  }
  if (tracker.type === "text") {
    const joined = items.map((e) => e.value_text).filter(Boolean).join(mini ? "+" : " · ");
    return truncateCalendarLabel(joined || `${items.length}×`, textMax);
  }
  return `${items.length}×`;
}

function calendarDayMark(date, mini, trackerId) {
  const items = calendarEntriesForDay(date, trackerId);
  const tracker = trackerById(trackerId);
  if (!items.length || !tracker) {
    return `<span class="day-mark day-mark--empty" aria-hidden="true"></span>`;
  }
  const full = summaryFor(tracker, date);
  if (tracker.type === "choice") {
    const dots = items.slice(0, 8).map((entry) => {
      const color = colorForChoiceValue(tracker, entry.value_text);
      const label = entry.value_text || "—";
      return `<i class="dot" title="${escapeHtml(label)}" style="background:${escapeHtml(color)}"></i>`;
    }).join("");
    return `<span class="dots" title="${escapeHtml(full)}">${dots}</span>`;
  }
  const label = calendarValueLabel(tracker, items, { mini });
  const color = tracker.color || "#64748b";
  return `
    <span class="day-mark" title="${escapeHtml(full)}">
      <span class="day-value" style="--mark-color:${escapeHtml(color)}">${escapeHtml(label)}</span>
    </span>
  `;
}

function calendarMonth(year, month, large, trackerId) {
  const days = monthMatrix(year, month);
  const title = new Date(year, month, 1).toLocaleDateString("nl-NL", { month: "long", year: "numeric" });
  const today = localISODate(new Date());
  const tracker = trackerById(trackerId);
  const choiceMode = tracker?.type === "choice";
  const mini = !large;
  return `
    <section class="card ${large ? "" : "mini-cal"} ${choiceMode ? "cal-filtered cal-filtered--choice" : "cal-filtered"}">
      <h3 style="margin:0 0 10px">${title}</h3>
      <div class="calendar ${!choiceMode ? "calendar--filtered" : ""} ${choiceMode ? "calendar--choice-dots" : ""}">
        ${DOW.map((d) => `<div class="dow">${d}</div>`).join("")}
        ${days.map((day) => {
          const inMonth = day.getMonth() === month;
          const key = localISODate(day);
          const items = calendarEntriesForDay(day, trackerId);
          const dayTitle = items.length && tracker
            ? `${key}: ${summaryFor(tracker, day)}`
            : key;
          return `
            <button class="day ${inMonth ? "" : "is-muted"} ${key === today ? "is-today" : ""} ${items.length && !choiceMode ? "has-value" : ""}" data-day="${key}" type="button" title="${escapeHtml(dayTitle)}">
              <span class="day-num">${day.getDate()}</span>
              ${calendarDayMark(day, mini, trackerId)}
            </button>
          `;
        }).join("")}
      </div>
    </section>
  `;
}

function statsCalendarSection(tracker) {
  const range = state.statsRange;
  const anchor = periodAnchorDate();
  const months = range === "week" || range === "month" ? 1 : range === "6m" ? 6 : 12;
  const list = [];
  for (let i = months - 1; i >= 0; i -= 1) {
    const d = addMonths(anchor, -i);
    list.push({ year: d.getFullYear(), month: d.getMonth() });
  }
  const large = range === "month" || range === "week";
  return `
    ${calendarChoiceLegendHtml(tracker)}
    ${calendarFilterHintHtml(tracker)}
    <div class="mini-months ${range === "year" ? "year" : ""}">
      ${list.map(({ year, month }) => calendarMonth(year, month, large, tracker.id)).join("")}
    </div>
  `;
}

function periodAnchorDate() {
  const iso = state.statsAnchor || localISODate(new Date());
  return startOfDay(new Date(`${iso}T12:00:00`));
}

function resetPeriodAnchor() {
  state.statsAnchor = localISODate(new Date());
}

function shiftPeriodAnchor(direction) {
  const range = state.statsRange;
  let next = periodAnchorDate();
  if (range === "week") {
    next = addDays(next, 7 * direction);
  } else if (range === "month") {
    next = addMonths(next, direction);
  } else if (range === "6m") {
    next = addMonths(next, 6 * direction);
  } else if (range === "year") {
    next = addMonths(next, 12 * direction);
  }
  state.statsAnchor = localISODate(next);
}

function formatPeriodLabel() {
  const range = state.statsRange;
  const end = periodAnchorDate();
  if (range === "week") {
    const from = addDays(end, -6);
    return `${from.toLocaleDateString("nl-NL", { day: "numeric", month: "short" })} – ${end.toLocaleDateString("nl-NL", { day: "numeric", month: "short", year: "numeric" })}`;
  }
  if (range === "month") {
    return end.toLocaleDateString("nl-NL", { month: "long", year: "numeric" });
  }
  const monthsBack = range === "6m" ? 5 : 11;
  const from = addMonths(end, -monthsBack);
  const fromLabel = from.toLocaleDateString("nl-NL", { month: "short" });
  const toLabel = end.toLocaleDateString("nl-NL", { month: "short" });
  if (from.getFullYear() === end.getFullYear()) {
    return `${fromLabel} – ${toLabel} ${end.getFullYear()}`;
  }
  return `${fromLabel} ${from.getFullYear()} – ${toLabel} ${end.getFullYear()}`;
}

function periodNavHtml() {
  return `
    <div class="period-nav" role="group" aria-label="Periode">
      <button class="icon-btn icon-btn-sm" data-action="stats-period-prev" type="button" aria-label="Vorige periode">‹</button>
      <p class="period-nav-label">${escapeHtml(formatPeriodLabel())}</p>
      <button class="icon-btn icon-btn-sm" data-action="stats-period-next" type="button" aria-label="Volgende periode">›</button>
    </div>
  `;
}

function rangeStart(kind, endDate = new Date()) {
  const end = startOfDay(endDate);
  if (kind === "week") return startOfDay(addDays(end, -6));
  if (kind === "year") return startOfDay(addMonths(end, -11));
  if (kind === "6m") return startOfDay(addMonths(end, -5));
  return startOfDay(new Date(end.getFullYear(), end.getMonth(), 1));
}

function statsPeriodBounds() {
  const anchor = periodAnchorDate();
  return {
    from: rangeStart(state.statsRange, anchor),
    to: endOfDay(anchor),
  };
}

function statsTrackerListItem(tracker) {
  return `
    <button
      type="button"
      class="stats-tracker-row"
      data-action="stats-open"
      data-tracker-id="${escapeHtml(tracker.id)}"
    >
      <i class="dot stats-tracker-row-dot" style="background:${escapeHtml(tracker.color)}"></i>
      <span class="stats-tracker-row-name">${escapeHtml(tracker.name)}</span>
      <span class="stats-tracker-row-chevron" aria-hidden="true">›</span>
    </button>
  `;
}

function renderStats() {
  appEl.classList.remove("app--tiles");
  const active = state.trackers.filter((t) => !t.archived);

  if (!state.statsTrackerId) {
    appEl.innerHTML = `
      <div class="view-body view-body--stats">
        <div class="stats-tracker-list" role="list">
          ${active.length
            ? active.map((t) => statsTrackerListItem(t)).join("")
            : `<p class="empty">Nog geen actieve trackers.</p>`}
        </div>
      </div>
    `;
    return;
  }

  const tracker = trackerById(state.statsTrackerId);
  if (!tracker || tracker.archived) {
    state.statsTrackerId = null;
    renderStats();
    return;
  }

  const { from, to } = statsPeriodBounds();
  const entries = state.entries.filter((e) => {
    if (e.tracker !== tracker.id) return false;
    const d = parsePbDate(e.logged_at);
    return d >= from && d <= to;
  });
  const range = state.statsRange;

  appEl.innerHTML = `
    <button class="btn btn-ghost btn-sm stats-back" data-action="stats-back" type="button">← Alle trackers</button>
    <div class="period-toolbar">
      ${periodNavHtml()}
      <div class="segment">
        <button data-stats-range="week" class="${range === "week" ? "is-active" : ""}" type="button">7 dagen</button>
        <button data-stats-range="month" class="${range === "month" ? "is-active" : ""}" type="button">Deze maand</button>
        <button data-stats-range="6m" class="${range === "6m" ? "is-active" : ""}" type="button">6 maanden</button>
        <button data-stats-range="year" class="${range === "year" ? "is-active" : ""}" type="button">Jaar</button>
      </div>
    </div>
    <div class="view-body view-body--stats">
      ${statsCalendarSection(tracker)}
      ${trackerStats(tracker, entries, from, to)}
    </div>
  `;
}

function eachDayInRange(from, to) {
  const days = [];
  let cursor = startOfDay(from);
  const end = startOfDay(to);
  while (cursor <= end) {
    days.push(new Date(cursor));
    cursor = addDays(cursor, 1);
  }
  return days;
}

function logsPerDaySeries(items, from, to) {
  const days = eachDayInRange(from, to);
  const counts = new Map(days.map((d) => [localISODate(d), 0]));
  items.forEach((entry) => {
    const key = localISODate(parsePbDate(entry.logged_at));
    if (counts.has(key)) counts.set(key, counts.get(key) + 1);
  });
  return days.map((date) => ({
    date,
    count: counts.get(localISODate(date)) || 0,
  }));
}

function chartAxisTicks(series) {
  const n = series.length;
  if (n <= 1) return [{ index: 0, label: formatDayShort(series[0].date) }];
  const maxLabels = n <= 10 ? n : n <= 45 ? 7 : 6;
  const step = Math.max(1, Math.round((n - 1) / (maxLabels - 1)));
  const ticks = [];
  for (let i = 0; i < n; i += step) {
    const point = series[i];
    let label;
    if (n > 120) {
      label = point.date.toLocaleDateString("nl-NL", { month: "short" });
    } else if (n > 45) {
      label = `${point.date.getDate()}/${point.date.getMonth() + 1}`;
    } else {
      label = String(point.date.getDate());
    }
    ticks.push({ index: i, label });
  }
  const lastIndex = n - 1;
  if (ticks[ticks.length - 1]?.index !== lastIndex) {
    const last = series[lastIndex];
    ticks.push({
      index: lastIndex,
      label: n > 45 ? formatDayShort(last.date) : String(last.date.getDate()),
    });
  }
  return ticks;
}

function statBarChartHtml(series, color) {
  if (!series.length) {
    return `<p class="empty stat-chart-empty">Geen dagen in deze periode.</p>`;
  }
  const width = 360;
  const height = 132;
  const pad = { left: 4, right: 4, top: 10, bottom: 22 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const maxCount = Math.max(1, ...series.map((p) => p.count));
  const n = series.length;
  const slotW = innerW / n;
  const barW = Math.max(1.2, Math.min(16, slotW * 0.72));
  const baseline = pad.top + innerH;
  const fill = color || "#64748b";
  const bars = series.map((point, index) => {
    const centerX = pad.left + slotW * index + slotW / 2;
    const barH = (point.count / maxCount) * innerH;
    const x = centerX - barW / 2;
    const y = baseline - barH;
    return `
      <rect
        class="stat-chart-bar"
        x="${x.toFixed(2)}"
        y="${y.toFixed(2)}"
        width="${barW.toFixed(2)}"
        height="${Math.max(0, barH).toFixed(2)}"
        rx="2"
        style="--chart-color:${escapeHtml(fill)}"
      >
        <title>${escapeHtml(formatDayShort(point.date))}: ${point.count} log${point.count === 1 ? "" : "s"}</title>
      </rect>
    `;
  }).join("");
  const ticks = chartAxisTicks(series);
  const axisLabels = ticks.map(({ index, label }) => {
    const centerX = pad.left + slotW * index + slotW / 2;
    return `<text class="stat-chart-axis-label" x="${centerX.toFixed(1)}" y="${height - 4}" text-anchor="middle">${escapeHtml(label)}</text>`;
  }).join("");
  return `
    <svg class="stat-bar-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Staafdiagram logs per dag">
      <line class="stat-chart-grid" x1="${pad.left}" y1="${baseline}" x2="${width - pad.right}" y2="${baseline}" />
      ${bars}
      ${axisLabels}
    </svg>
  `;
}

function trackerStatsHead(tracker) {
  return `
    <div class="stats-tracker-head">
      <span class="tracker-chip tracker-chip--preview tracker-chip--stat" style="--chip-color:${escapeHtml(tracker.color)}">
        <span class="tracker-chip-label">${escapeHtml(trackerChipLabel(tracker.name))}</span>
      </span>
    </div>
  `;
}

function distributionColor(tracker, label, index, choiceColors) {
  if (tracker.type === "choice") {
    return choiceColors.get(label) || colorForChoiceValue(tracker, label);
  }
  return COLORS[(trackerPaletteOffset(tracker.id) + index) % COLORS.length];
}

function textDistributionGroups(items) {
  const groups = new Map();
  items.forEach((entry) => {
    const raw = String(entry.value_text || "—").trim() || "—";
    const norm = textValueNorm(raw === "—" ? "" : raw) || "—";
    if (!groups.has(norm)) {
      groups.set(norm, { total: 0, variants: new Map() });
    }
    const group = groups.get(norm);
    group.total += 1;
    group.variants.set(raw, (group.variants.get(raw) || 0) + 1);
  });
  const rows = [];
  groups.forEach((group) => {
    let label = "—";
    let best = -1;
    group.variants.forEach((count, variant) => {
      if (count > best) {
        best = count;
        label = variant;
      }
    });
    rows.push({ label, count: group.total });
  });
  return rows.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "nl"));
}

function distributionBuckets(tracker, items) {
  const choiceColors = choiceColorsForTracker(tracker);

  if (tracker.type === "text") {
    let rows = textDistributionGroups(items);
    if (rows.length > 8) {
      const top = rows.slice(0, 7);
      const otherCount = rows.slice(7).reduce((sum, row) => sum + row.count, 0);
      rows = [...top];
      if (otherCount > 0) rows.push({ label: "Overig", count: otherCount });
    }
    return rows.map((row, index) => ({
      label: row.label,
      count: row.count,
      color: distributionColor(tracker, row.label, index, choiceColors),
    }));
  }

  const configured = tracker.type === "choice" ? (optionsOf(tracker).choices || []) : [];
  const valueCounts = {};
  configured.forEach((label) => { valueCounts[label] = 0; });
  items.forEach((entry) => {
    const key = String(entry.value_text || "—").trim() || "—";
    valueCounts[key] = (valueCounts[key] || 0) + 1;
  });
  const labels = tracker.type === "choice"
    ? [...new Set([...configured, ...Object.keys(valueCounts)])]
    : Object.keys(valueCounts).sort((a, b) => (valueCounts[b] || 0) - (valueCounts[a] || 0) || a.localeCompare(b, "nl"));

  return labels.map((label, index) => ({
    label,
    count: valueCounts[label] || 0,
    color: distributionColor(tracker, label, index, choiceColors),
  }));
}

function donutSlicePath(cx, cy, outerR, innerR, startAngle, endAngle) {
  const large = endAngle - startAngle > Math.PI ? 1 : 0;
  const sx = cx + outerR * Math.cos(startAngle);
  const sy = cy + outerR * Math.sin(startAngle);
  const ex = cx + outerR * Math.cos(endAngle);
  const ey = cy + outerR * Math.sin(endAngle);
  const ix = cx + innerR * Math.cos(endAngle);
  const iy = cy + innerR * Math.sin(endAngle);
  const isx = cx + innerR * Math.cos(startAngle);
  const isy = cy + innerR * Math.sin(startAngle);
  return `M ${sx.toFixed(2)} ${sy.toFixed(2)} A ${outerR} ${outerR} 0 ${large} 1 ${ex.toFixed(2)} ${ey.toFixed(2)} L ${ix.toFixed(2)} ${iy.toFixed(2)} A ${innerR} ${innerR} 0 ${large} 0 ${isx.toFixed(2)} ${isy.toFixed(2)} Z`;
}

function statPieChartHtml(buckets) {
  const slices = buckets.filter((b) => b.count > 0);
  const total = slices.reduce((sum, b) => sum + b.count, 0);
  if (!total) {
    return `<p class="empty stat-chart-empty">Nog geen keuzes in deze periode.</p>`;
  }
  const size = 168;
  const cx = size / 2;
  const cy = size / 2;
  const outerR = 74;
  const innerR = 46;
  let angle = -Math.PI / 2;
  const paths = slices.map((slice) => {
    const sweep = (slice.count / total) * Math.PI * 2;
    const start = angle;
    const end = angle + sweep;
    angle = end;
    const pct = Math.round((slice.count / total) * 100);
    return `
      <path
        class="stat-pie-slice"
        d="${donutSlicePath(cx, cy, outerR, innerR, start, end)}"
        fill="${escapeHtml(slice.color)}"
      >
        <title>${escapeHtml(slice.label)}: ${slice.count}× (${pct}%)</title>
      </path>
    `;
  }).join("");
  return `
    <svg class="stat-pie-chart" viewBox="0 0 ${size} ${size}" role="img" aria-label="Cirkeldiagram verdeling keuzes">
      ${paths}
      <text class="stat-pie-center" x="${cx}" y="${cy - 2}" text-anchor="middle">${total}</text>
      <text class="stat-pie-center-sub" x="${cx}" y="${cy + 12}" text-anchor="middle">logs</text>
    </svg>
  `;
}

function trackerValueDistribution(tracker, items) {
  const buckets = distributionBuckets(tracker, items);
  if (!buckets.length) return "";
  const maxCount = Math.max(1, ...buckets.map((b) => b.count));
  const rows = buckets.map((bucket) => `
    <div class="stat-choice-row">
      <span class="stat-choice-label hint">
        <i class="dot stat-choice-dot" style="background:${escapeHtml(bucket.color)}"></i>
        ${escapeHtml(bucket.label)}
      </span>
      <div class="bar stat-choice-bar"><span style="width:${Math.round((bucket.count / maxCount) * 100)}%;background:${escapeHtml(bucket.color)}"></span></div>
      <span class="stat-choice-count hint">${bucket.count}×</span>
    </div>
  `).join("");
  return `
    <div class="stat-section">
      <p class="hint stat-section-label">Verdeling per keuze</p>
      <div class="stat-distribution-layout">
        <div class="stat-pie-wrap">${statPieChartHtml(buckets)}</div>
        <div class="stat-choice-rows">${rows}</div>
      </div>
    </div>
  `;
}

function entriesForTrackerInPeriod(trackerId, from, to) {
  return state.entries.filter((entry) => {
    if (entry.tracker !== trackerId) return false;
    const logged = parsePbDate(entry.logged_at);
    return logged >= from && logged <= to;
  });
}

function previousPeriodBounds(from, to) {
  const days = eachDayInRange(from, to);
  const span = days.length;
  const prevEnd = endOfDay(addDays(startOfDay(from), -1));
  const prevStart = startOfDay(addDays(prevEnd, -(span - 1)));
  return { from: prevStart, to: prevEnd };
}

function weekdayIndex(date) {
  return (date.getDay() + 6) % 7;
}

function formatStatNumber(value, decimals = 1) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  const rounded = decimals === 0 ? Math.round(value) : Number(value.toFixed(decimals));
  return String(rounded).replace(".", ",");
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2) return sorted[mid];
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

function dailyTotalsForTracker(tracker, items, from, to) {
  const days = eachDayInRange(from, to);
  const totals = new Map(days.map((d) => [localISODate(d), 0]));
  items.forEach((entry) => {
    const key = localISODate(parsePbDate(entry.logged_at));
    if (!totals.has(key)) return;
    const add = Number(entry.value_number ?? (tracker.type === "counter" ? 1 : 0));
    totals.set(key, totals.get(key) + (Number.isNaN(add) ? 0 : add));
  });
  return days.map((date) => totals.get(localISODate(date)) || 0);
}

function logNumericValues(tracker, items) {
  return items
    .map((entry) => Number(entry.value_number))
    .filter((value) => !Number.isNaN(value));
}

function minMaxMedianValues(tracker, items, from, to) {
  if (tracker.type === "counter") {
    return dailyTotalsForTracker(tracker, items, from, to);
  }
  if (tracker.type === "number" || tracker.type === "scale") {
    return logNumericValues(tracker, items);
  }
  return [];
}

function statUnitSuffix(tracker, spaced = true) {
  if (!tracker.unit) return "";
  return `${spaced ? " " : ""}${tracker.unit}`;
}

function sortedLogTimestamps(items) {
  return items
    .map((entry) => parsePbDate(entry.logged_at).getTime())
    .filter((time) => !Number.isNaN(time))
    .sort((a, b) => a - b);
}

function logIntervalGapsMs(timestamps) {
  const gaps = [];
  for (let i = 1; i < timestamps.length; i += 1) {
    gaps.push(timestamps[i] - timestamps[i - 1]);
  }
  return gaps;
}

function formatDurationMs(ms) {
  if (ms === null || ms === undefined || Number.isNaN(ms)) return "—";
  if (ms < 60000) return "< 1 min";
  const totalMinutes = Math.round(ms / 60000);
  const minutes = totalMinutes % 60;
  const totalHours = Math.floor(totalMinutes / 60);
  const hours = totalHours % 24;
  const days = Math.floor(totalHours / 24);
  if (days > 0) {
    if (hours > 0) return `${days} d ${hours} u`;
    return `${days} ${days === 1 ? "dag" : "dagen"}`;
  }
  if (totalHours >= 1) {
    if (minutes > 0) return `${totalHours} u ${minutes} min`;
    return `${totalHours} u`;
  }
  return `${totalMinutes} min`;
}

function statLogIntervalsHtml(items) {
  const gaps = logIntervalGapsMs(sortedLogTimestamps(items));
  const emptyNote = items.length < 2
    ? "Minimaal 2 logs in deze periode nodig."
    : "—";
  if (!gaps.length) {
    return `
      <div class="stat-section">
        <p class="hint stat-section-label">Tijd tussen logs</p>
        <p class="hint stat-interval-empty">${emptyNote}</p>
      </div>
    `;
  }
  const total = gaps.reduce((sum, gap) => sum + gap, 0);
  const avg = total / gaps.length;
  const min = Math.min(...gaps);
  const max = Math.max(...gaps);
  return `
    <div class="stat-section">
      <p class="hint stat-section-label">Tijd tussen logs</p>
      <p class="hint stat-minmax-note">Tussen opeenvolgende logs in deze periode</p>
      <div class="stat-metrics-grid">
        <div class="stat-metric-card">
          <p class="hint">Gemiddeld</p>
          <p class="stat-metric-value stat-metric-value--duration">${formatDurationMs(avg)}</p>
        </div>
        <div class="stat-metric-card">
          <p class="hint">Langst</p>
          <p class="stat-metric-value stat-metric-value--duration">${formatDurationMs(max)}</p>
        </div>
        <div class="stat-metric-card">
          <p class="hint">Kortst</p>
          <p class="stat-metric-value stat-metric-value--duration">${formatDurationMs(min)}</p>
        </div>
      </div>
    </div>
  `;
}

function statMinMaxMedianHtml(tracker, items, from, to) {
  if (!["counter", "number", "scale"].includes(tracker.type)) return "";
  const values = minMaxMedianValues(tracker, items, from, to);
  if (!values.length) return "";
  const min = Math.min(...values);
  const max = Math.max(...values);
  const med = median(values);
  const unit = escapeHtml(statUnitSuffix(tracker));
  const perDayHint = tracker.type === "counter"
    ? `<p class="hint stat-minmax-note">Per dag in deze periode (inclusief dagen zonder log)</p>`
    : tracker.type === "number" || tracker.type === "scale"
      ? `<p class="hint stat-minmax-note">Per log in deze periode</p>`
      : "";
  return `
    <div class="stat-section">
      <p class="hint stat-section-label">Min · max · mediaan</p>
      ${perDayHint}
      <div class="stat-metrics-grid">
        <div class="stat-metric-card">
          <p class="hint">Min</p>
          <p class="stat-metric-value">${formatStatNumber(min, tracker.type === "counter" ? 0 : 1)}${unit}</p>
        </div>
        <div class="stat-metric-card">
          <p class="hint">Max</p>
          <p class="stat-metric-value">${formatStatNumber(max, tracker.type === "counter" ? 0 : 1)}${unit}</p>
        </div>
        <div class="stat-metric-card">
          <p class="hint">Mediaan</p>
          <p class="stat-metric-value">${formatStatNumber(med, tracker.type === "counter" ? 0 : 1)}${unit}</p>
        </div>
      </div>
    </div>
  `;
}

function trendMetricValue(tracker, items, from, to) {
  if (tracker.type === "counter") {
    return items.reduce((sum, entry) => sum + Number(entry.value_number || 1), 0);
  }
  if (tracker.type === "number" || tracker.type === "scale") {
    const values = logNumericValues(tracker, items);
    if (!values.length) return null;
    return values.reduce((sum, value) => sum + value, 0) / values.length;
  }
  if (tracker.type === "check") {
    return new Set(items.map((entry) => localISODate(parsePbDate(entry.logged_at)))).size;
  }
  return items.length;
}

function trendMetricLabel(tracker) {
  if (tracker.type === "counter") return "totaal in periode";
  if (tracker.type === "number" || tracker.type === "scale") return "gemiddelde waarde";
  if (tracker.type === "check") return "actieve dagen";
  return "aantal logs";
}

function formatTrendDelta(tracker, diff) {
  const abs = Math.abs(diff);
  if (tracker.type === "counter") {
    return `${diff > 0 ? "+" : diff < 0 ? "−" : ""}${formatStatNumber(abs, 0)}${escapeHtml(statUnitSuffix(tracker))}`;
  }
  if (tracker.type === "number" || tracker.type === "scale") {
    return `${diff > 0 ? "+" : diff < 0 ? "−" : ""}${formatStatNumber(abs, 1)}${escapeHtml(statUnitSuffix(tracker))}`;
  }
  if (tracker.type === "check") {
    return `${diff > 0 ? "+" : diff < 0 ? "−" : ""}${formatStatNumber(abs, 0)} dagen`;
  }
  return `${diff > 0 ? "+" : diff < 0 ? "−" : ""}${formatStatNumber(abs, 0)} logs`;
}

function statTrendHtml(tracker, items, from, to) {
  const prev = previousPeriodBounds(from, to);
  const prevItems = entriesForTrackerInPeriod(tracker.id, prev.from, prev.to);
  const current = trendMetricValue(tracker, items, from, to);
  const previous = trendMetricValue(tracker, prevItems, prev.from, prev.to);
  if (current === null && previous === null) return "";
  const cur = current ?? 0;
  const prevVal = previous ?? 0;
  const diff = cur - prevVal;
  let pct = 0;
  if (prevVal !== 0) pct = Math.round((diff / prevVal) * 100);
  else if (cur !== 0) pct = 100;
  const arrow = diff > 0 ? "↑" : diff < 0 ? "↓" : "→";
  const trendClass = diff > 0 ? "stat-trend-up" : diff < 0 ? "stat-trend-down" : "stat-trend-flat";
  const pctLabel = prevVal === 0 && cur === 0
    ? "geen verschil"
    : `${pct > 0 ? "+" : ""}${pct}% t.o.v. vorige periode`;
  return `
    <div class="stat-section">
      <p class="hint stat-section-label">Trend</p>
      <p class="stat-trend ${trendClass}">
        <span class="stat-trend-arrow" aria-hidden="true">${arrow}</span>
        <span>${formatTrendDelta(tracker, diff)} · ${pctLabel}</span>
      </p>
      <p class="hint stat-trend-caption">Vergelijking op basis van ${escapeHtml(trendMetricLabel(tracker))}</p>
    </div>
  `;
}

function weekdayMetricForDay(tracker, dayItems) {
  if (tracker.type === "counter" || tracker.type === "number" || tracker.type === "scale") {
    return dayItems.reduce(
      (sum, entry) => sum + Number(entry.value_number ?? (tracker.type === "counter" ? 1 : 0)),
      0
    );
  }
  if (tracker.type === "check") return dayItems.length > 0 ? 1 : 0;
  return dayItems.length;
}

function weekdayHeatmapSeries(tracker, items, from, to) {
  const buckets = Array.from({ length: 7 }, () => []);
  eachDayInRange(from, to).forEach((date) => {
    const key = localISODate(date);
    const dayItems = items.filter((entry) => localISODate(parsePbDate(entry.logged_at)) === key);
    buckets[weekdayIndex(date)].push(weekdayMetricForDay(tracker, dayItems));
  });
  return DOW.map((label, index) => {
    const values = buckets[index];
    const avg = values.length
      ? values.reduce((sum, value) => sum + value, 0) / values.length
      : 0;
    return { label, avg };
  });
}

function weekdayHeatmapCaption(tracker) {
  if (tracker.type === "counter") return "Gemiddeld totaal per dag (incl. dagen zonder log)";
  if (tracker.type === "number" || tracker.type === "scale") return "Gemiddeld totaal per kalenderdag in deze periode";
  if (tracker.type === "check") return "Gemiddeld aantal ingevulde dagen per weekdag (0–1)";
  return "Gemiddeld aantal logs per kalenderdag";
}

function statWeekdayHeatmapHtml(tracker, items, from, to) {
  const series = weekdayHeatmapSeries(tracker, items, from, to);
  const maxAvg = Math.max(0.001, ...series.map((point) => point.avg));
  const decimals = tracker.type === "check" ? 0 : tracker.type === "counter" ? 1 : 1;
  const cells = series.map((point) => {
    const heat = point.avg / maxAvg;
    const title = `${point.label}: gem. ${formatStatNumber(point.avg, decimals)}${statUnitSuffix(tracker, false)}`;
    return `
      <div class="stat-weekday-cell" style="--heat:${heat.toFixed(3)}" title="${escapeHtml(title)}">
        <span class="stat-weekday-dow">${point.label}</span>
        <span class="stat-weekday-val">${formatStatNumber(point.avg, decimals)}</span>
      </div>
    `;
  }).join("");
  return `
    <div class="stat-section">
      <p class="hint stat-section-label">Patroon per weekdag</p>
      <div class="stat-weekday-heatmap" role="list">${cells}</div>
      <p class="hint stat-weekday-caption">${weekdayHeatmapCaption(tracker)}</p>
    </div>
  `;
}

function trackerTypeSummaryHtml(tracker, items) {
  if (!items.length) return "";
  if (tracker.type === "check") {
    return `<p class="hint stat-type-summary">${items.length}× ingevuld in deze periode</p>`;
  }
  if (tracker.type === "counter" || tracker.type === "number" || tracker.type === "scale") {
    const total = items.reduce((sum, e) => sum + Number(e.value_number || 0), 0);
    if (tracker.type === "number" || tracker.type === "scale") {
      const avg = (total / items.length).toFixed(1);
      const unit = tracker.unit ? ` ${tracker.unit}` : "";
      return `<p class="stat-value stat-type-summary">gem. ${avg}${escapeHtml(unit)}</p>`;
    }
    const unit = tracker.unit ? ` ${escapeHtml(tracker.unit)}` : "";
    return `<p class="stat-value stat-type-summary">${total}${unit}</p>`;
  }
  return "";
}

function trackerStats(tracker, items, from, to) {
  const series = logsPerDaySeries(items, from, to);
  const distributionHtml = (tracker.type === "choice" || tracker.type === "text")
    ? trackerValueDistribution(tracker, items)
    : trackerTypeSummaryHtml(tracker, items);
  return `
    <section class="card stat-tracker-card">
      ${trackerStatsHead(tracker)}
      <div class="stat-section">
        <p class="hint stat-section-label">Logs per dag</p>
        ${statBarChartHtml(series, tracker.color)}
      </div>
      ${statLogIntervalsHtml(items)}
      ${statMinMaxMedianHtml(tracker, items, from, to)}
      ${statTrendHtml(tracker, items, from, to)}
      ${statWeekdayHeatmapHtml(tracker, items, from, to)}
      ${distributionHtml}
    </section>
  `;
}

function adminTileLabel(name) {
  return escapeHtml(trackerChipLabel(name));
}

function categoryAdminIcon(category) {
  return `
    <button
      type="button"
      class="admin-icon-tile"
      data-edit-category="${category.id}"
      style="--tile-color:${escapeHtml(category.color)}"
      title="${escapeHtml(category.name)}"
      aria-label="${escapeHtml(category.name)}"
    >
      <span class="admin-icon-glyph admin-icon-glyph--text" aria-hidden="true">${adminTileLabel(category.name)}</span>
    </button>
  `;
}

function trackerAdminIcon(tracker) {
  return `
    <button
      type="button"
      class="admin-icon-tile admin-icon-tile--tracker ${tracker.archived ? "is-archived" : ""}"
      data-edit-tracker="${tracker.id}"
      style="--tile-color:${escapeHtml(tracker.color)}"
      title="${escapeHtml(tracker.name)}"
      aria-label="${escapeHtml(tracker.name)}"
    >
      <span class="admin-icon-glyph admin-icon-glyph--text" aria-hidden="true">${adminTileLabel(tracker.name)}</span>
    </button>
  `;
}

function renderTrackers() {
  appEl.classList.remove("app--tiles");
  appEl.innerHTML = `
    <div class="trackers-admin">
      <div class="trackers-admin-toolbar">
        <button class="btn btn-ghost" data-action="new-category" type="button">+ Categorie</button>
        <button class="btn btn-primary" data-action="new-tracker" type="button" style="width:auto">+ Tracker</button>
      </div>
      <section class="trackers-admin-section" aria-label="Categorieën">
        <div class="admin-icon-grid">
          ${state.categories.map(categoryAdminIcon).join("") || `<p class="empty">Nog geen categorieën.</p>`}
        </div>
      </section>
      <section class="trackers-admin-section" aria-label="Trackers">
        <div class="admin-icon-grid admin-icon-grid--trackers">
          ${state.trackers.map(trackerAdminIcon).join("") || `<p class="empty">Nog geen trackers.</p>`}
        </div>
      </section>
      <section class="trackers-admin-section trackers-admin-backup" aria-label="Backup en restore">
        <h2 class="section-title" style="margin-top:0">Backup &amp; restore</h2>
        <p class="hint">Download een JSON-backup of zet data terug op een andere server. IDs blijven behouden waar mogelijk.</p>
        <div class="trackers-backup-actions">
          <button class="btn btn-ghost" data-action="backup-export" type="button">Backup downloaden</button>
          <button class="btn btn-ghost" data-action="backup-restore-open" type="button">Backup terugzetten…</button>
        </div>
      </section>
    </div>
  `;
}

function categoryForm(category = null) {
  const color = category?.color || COLORS[2];
  return `
    <h2 style="margin:0 0 8px">${category ? "Categorie bewerken" : "Nieuwe categorie"}</h2>
    <label>Naam</label>
    <input id="f-cat-name" value="${escapeHtml(category?.name || "")}" placeholder="Bijv. Gezondheid" />
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
      <input id="f-once-day" type="checkbox" ${tracker?.once_per_day ? "checked" : ""} style="width:auto" />
      Maximaal 1× per dag
    </label>
    <p class="hint" style="margin-top:4px">Na invullen is de tracker op Vandaag niet meer klikbaar tot je de log verwijdert via Logs.</p>
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
    body = `
      <div class="text-autocomplete-wrap">
        <input
          id="f-text"
          type="text"
          data-text-suggest
          autocomplete="off"
          value="${escapeHtml(entry?.value_text || "")}"
          placeholder="Vrij invullen"
        />
        <ul class="text-suggest-list" id="f-text-suggestions" hidden></ul>
      </div>
    `;
  } else if (tracker.type === "counter") {
    body = `<input id="f-number" type="number" step="1" value="${escapeHtml(entry?.value_number ?? 1)}" />`;
  } else {
    body = `<p class="hint">Dit vinkt het item aan voor het gekozen moment.</p><input id="f-number" type="hidden" value="1" />`;
  }
  return `
    <div class="log-modal-head">
      <span class="tracker-chip tracker-chip--preview log-modal-chip" style="--chip-color:${escapeHtml(tracker.color)}">
        <span class="tracker-chip-label">${escapeHtml(trackerChipLabel(tracker.name))}</span>
      </span>
      <div class="log-modal-titles">
        <h2 class="log-modal-title">${escapeHtml(tracker.name)}</h2>
        <p class="hint">${escapeHtml(tracker.description || TYPE_LABELS[tracker.type])}</p>
      </div>
      <button class="icon-btn log-modal-close" data-close="sheet" type="button" aria-label="Sluiten">×</button>
    </div>
    <div class="log-modal-body">
      ${body}
      <label class="log-modal-label">Notitie <span class="optional">(optioneel)</span></label>
      <input id="f-note" value="${escapeHtml(entry?.note || "")}" placeholder="Korte notitie" />
      <details class="log-modal-when">
        <summary>Moment aanpassen</summary>
        <input id="f-when" type="datetime-local" value="${stamp}" />
      </details>
    </div>
    <div class="log-modal-actions">
      ${entry ? `<button class="btn btn-danger" data-delete-entry="${entry.id}" type="button">Verwijderen</button>` : ""}
      <button class="btn btn-primary" data-save-entry="${entry?.id || "new"}" data-tracker="${tracker.id}" type="button">Opslaan</button>
    </div>
  `;
}

function daySheet(dateStr) {
  const date = new Date(`${dateStr}T12:00:00`);
  const trackerId = state.view === "stats" ? state.statsTrackerId : null;
  const items = trackerId ? calendarEntriesForDay(date, trackerId) : entriesForDay(date);
  return `
    <h2 style="margin:0 0 8px">${formatDayTitle(date)}</h2>
    ${items.length ? items.map((entry) => {
      const tracker = trackerById(entry.tracker);
      const label = entry.value_text || entry.value_number || "✓";
      return `
        <div class="entry">
          <span class="tracker-chip tracker-chip--preview entry-chip" style="--chip-color:${escapeHtml(tracker?.color || "#64748b")}">
            <span class="tracker-chip-label">${escapeHtml(trackerChipLabel(tracker?.name || "?"))}</span>
          </span>
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
    <div class="tracker-chip-grid tracker-chip-grid--pick">
      ${active.map((t) => trackerChipHtml(t, {
        logTrackerId: t.id,
        logOnDay: dateStr,
        day: new Date(`${dateStr}T12:00:00`),
        extraClass: "tracker-chip--pick",
      })).join("")}
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
    color: document.getElementById("f-color").value.trim() || COLORS[0],
    type,
    unit: document.getElementById("f-unit").value.trim(),
    description: document.getElementById("f-desc").value.trim(),
    sort_order: Number(document.getElementById("f-sort").value || 0),
    archived: document.getElementById("f-archived").checked,
    once_per_day: document.getElementById("f-once-day").checked,
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
  const values = collectEntryValues();
  if (id === "new") {
    const tracker = trackerById(trackerId);
    const day = parsePbDate(values.logged_at);
    if (tracker && trackerIsLockedForDay(tracker, day)) {
      toast(`${tracker.name} is die dag al ingevuld`);
      return;
    }
  }
  const payload = { tracker: trackerId, ...values };
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
  const day = selectedDayDate();
  if (trackerIsLockedForDay(tracker, day)) {
    toast(`${tracker.name} is vandaag al ingevuld`);
    return;
  }
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
  if (trackerOncePerDay(tracker) && existing.length) {
    toast(`${tracker.name} is al ingevuld — verwijder via Logs om opnieuw te loggen`);
    return;
  }
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

appEl.addEventListener("change", (event) => {
  const t = event.target;
  if (t.matches("[data-logs-select]")) {
    const id = t.dataset.logsSelect;
    if (t.checked) {
      if (!state.logsSelectedIds.includes(id)) state.logsSelectedIds.push(id);
    } else {
      state.logsSelectedIds = state.logsSelectedIds.filter((x) => x !== id);
    }
    renderLogs();
    return;
  }
  if (t.matches("[data-logs-filter-tracker]")) {
    state.logsFilter.trackerId = t.value;
    state.logsFilter.entryKey = "";
    pruneLogsSelection();
    renderLogs();
    return;
  }
  if (t.matches("[data-logs-filter-entry]")) {
    state.logsFilter.entryKey = t.value;
    pruneLogsSelection();
    renderLogs();
  }
});

appEl.addEventListener("click", async (event) => {
  const t = event.target.closest("[data-open-tracker],[data-quick],[data-action],[data-stats-range],[data-stats-tracker],[data-logs-range],[data-day],[data-edit-tracker],[data-edit-category],[data-edit-entry]");
  if (!t) return;
  if (t.dataset.quick === "counter") {
    event.stopPropagation();
    const tracker = trackerById(t.dataset.id);
    await quickCounter(tracker);
    return;
  }
  if (t.dataset.openTracker) {
    const tracker = trackerById(t.dataset.openTracker);
    if (trackerIsLockedForDay(tracker, selectedDayDate())) {
      toast(`${tracker.name} is al ingevuld — verwijder via Logs om opnieuw te loggen`);
      return;
    }
    if (tracker.type === "check") {
      await quickCheck(tracker);
      return;
    }
    if (tracker.type === "counter") {
      await quickCounter(tracker);
      return;
    }
    openLogModal(logForm(tracker, null, logTimestampForSelectedDay()));
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
  if (t.dataset.action === "backup-export") {
    try {
      await exportBackup();
    } catch (err) {
      toast(err.message);
    }
    return;
  }
  if (t.dataset.action === "backup-restore-open") {
    openSheet(backupRestoreSheet());
    return;
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
  if (t.dataset.action === "stats-open") {
    state.statsTrackerId = t.dataset.trackerId || null;
    render();
    return;
  }
  if (t.dataset.action === "stats-back") {
    state.statsTrackerId = null;
    render();
    return;
  }
  if (t.dataset.action === "stats-period-prev") {
    shiftPeriodAnchor(-1);
    renderStats();
  }
  if (t.dataset.action === "stats-period-next") {
    shiftPeriodAnchor(1);
    renderStats();
  }
  if (t.dataset.statsRange) {
    state.statsRange = t.dataset.statsRange;
    resetPeriodAnchor();
    renderStats();
  }
  if (t.dataset.logsRange) {
    state.logsFilter.range = t.dataset.logsRange;
    if (t.dataset.logsRange !== "all") {
      state.logsFilter.anchor = localISODate(new Date());
    }
    pruneLogsSelection();
    renderLogs();
    return;
  }
  if (t.dataset.action === "logs-period-prev") {
    shiftLogsPeriodAnchor(-1);
    pruneLogsSelection();
    renderLogs();
    return;
  }
  if (t.dataset.action === "logs-period-next") {
    shiftLogsPeriodAnchor(1);
    pruneLogsSelection();
    renderLogs();
    return;
  }
  if (t.dataset.action === "logs-select-all") {
    state.logsSelectedIds = filteredLogsEntries().map((e) => e.id);
    renderLogs();
    return;
  }
  if (t.dataset.action === "logs-clear-filters") {
    state.logsFilter = defaultLogsFilter();
    state.logsSelectedIds = [];
    renderLogs();
    return;
  }
  if (t.dataset.action === "logs-clear-selection") {
    state.logsSelectedIds = [];
    renderLogs();
    return;
  }
  if (t.dataset.action === "logs-bulk-edit") {
    if (!state.logsSelectedIds.length) return;
    openSheet(bulkEditSheet(state.logsSelectedIds));
    return;
  }
  if (t.dataset.action === "logs-bulk-delete") {
    await bulkDeleteLogs([...state.logsSelectedIds]);
    return;
  }
  if (t.dataset.editEntry) {
    const entry = state.entries.find((e) => e.id === t.dataset.editEntry);
    if (entry) openLogModal(logForm(trackerById(entry.tracker), entry));
    return;
  }
  if (t.dataset.day) openSheet(daySheet(t.dataset.day));
});

sheetEl.addEventListener("click", async (event) => {
  const t = event.target.closest("[data-close],[data-color],[data-cat-color],[data-choice],[data-scale],[data-save-tracker],[data-delete-tracker],[data-save-category],[data-delete-category],[data-save-entry],[data-delete-entry],[data-edit-entry],[data-add-on-day],[data-log-tracker],[data-save-bulk-edit],[data-action=\"restore-backup\"]");
  if (!t) return;
  if (t.dataset.close === "sheet") {
    closeSheet();
    return;
  }
  const suggestPick = t.closest("[data-text-suggest-pick]");
  if (suggestPick) {
    const input = document.getElementById("f-text");
    if (input) {
      input.value = suggestPick.textContent.trim();
      const list = document.getElementById("f-text-suggestions");
      if (list) list.hidden = true;
    }
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
    if (t.dataset.action === "restore-backup") {
      const fileInput = document.getElementById("f-backup-file");
      const file = fileInput?.files?.[0];
      if (!file) {
        toast("Kies eerst een backupbestand");
        return;
      }
      if (!confirm("Alle categorieën, trackers en logs op deze server worden vervangen. Doorgaan?")) return;
      const text = await file.text();
      const data = parseBackupJson(text);
      await restoreBackup(data);
      return;
    }
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
    if (t.dataset.saveBulkEdit) await saveBulkEdit(t.dataset.saveBulkEdit);
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
      openLogModal(logForm(tracker, entry));
    }
    if (t.dataset.addOnDay) {
      const dateStr = t.dataset.addOnDay;
      if (state.statsTrackerId) {
        const date = new Date(`${dateStr}T12:00:00`);
        openLogModal(logForm(trackerById(state.statsTrackerId), null, date));
      } else {
        openSheet(pickTrackerSheet(dateStr));
      }
    }
    if (t.dataset.logTracker) {
      const tracker = trackerById(t.dataset.logTracker);
      const date = new Date(`${t.dataset.onDay}T${pad(new Date().getHours())}:${pad(new Date().getMinutes())}:00`);
      const dayForLog = new Date(`${t.dataset.onDay}T12:00:00`);
      if (trackerIsLockedForDay(tracker, dayForLog)) {
        toast(`${tracker.name} is die dag al ingevuld`);
        return;
      }
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
      openLogModal(logForm(tracker, null, date));
    }
  } catch (err) {
    toast(err.message);
  }
});

document.querySelector(".tabbar").addEventListener("click", (event) => {
  const tab = event.target.closest(".tab");
  if (tab) setView(tab.dataset.view);
});

document.getElementById("refreshBtn").addEventListener("click", () => {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.getRegistration().then((reg) => reg?.update()).catch(() => {});
  }
  refresh();
});

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  const secure =
    window.location.protocol === "https:" ||
    window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1";
  if (!secure) return;
  navigator.serviceWorker.register(`/sw.js?v=${APP_VERSION}`).catch(() => {});
}

registerServiceWorker();

if (typeof window !== "undefined") {
  window.matchMedia(DESKTOP_LAYOUT_MQ).addEventListener("change", () => {
    if (state.view === "today" || state.view === "stats" || state.view === "logs") render();
  });
}

refresh();
