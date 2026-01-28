import { readStateFromHash, writeStateToHash, isEncryptedHash, clearHash } from "./modules/hashcalUrlManager.js";
import { expandEvents } from "./modules/recurrenceEngine.js";
import { renderAgendaView } from "./modules/agendaRender.js";
import { FocusMode } from "./modules/focusMode.js";
import { initQRCodeManager } from "./modules/qrCodeManager.js";
import { initCountdownWidget } from "./modules/countdownManager.js";
import { AVAILABLE_ZONES, getZoneInfo, isValidZone } from "./modules/timezoneManager.js";
import {
  formatDateKey,
  getMonthGridRange,
  getWeekRange,
  renderCalendar,
  renderTimeGrid,
  renderWeekdayHeaders,
  renderYearView,
} from "./modules/calendarRender.js";
import { parseIcs } from "./modules/icsImporter.js";

const DEFAULT_COLORS = ["#ff6b6b", "#ffd43b", "#4dabf7", "#63e6be", "#9775fa"];
const DEFAULT_VIEW = "month";
const VALID_VIEWS = new Set(["day", "week", "month", "year", "agenda"]);
const DEFAULT_STATE = {
  t: "hash-calendar",
  c: DEFAULT_COLORS,
  e: [],
  s: {
    d: 0,
    m: 0,
    v: DEFAULT_VIEW,
  },
  timezones: [],
};

const DEBOUNCE_MS = 500;
const MAX_TITLE_LENGTH = 60;
const MAX_TZ_RESULTS = 12;
const TZ_EMPTY_MESSAGE = "No matches yet. Try a city, region, or UTC+5:30.";
const MOBILE_WARNING_QUERY = "(max-width: 1024px)";
const MOBILE_WARNING_KEY = "hashcal.mobileWarningDismissed";

let state = cloneState(DEFAULT_STATE);
let viewDate = startOfDay(new Date());
let selectedDate = startOfDay(new Date());
let currentView = DEFAULT_VIEW;
let password = null;
let lockState = { encrypted: false, unlocked: true };
let saveTimer = null;
let occurrencesByDay = new Map();
let editingIndex = null;
let passwordResolver = null;
let passwordMode = "unlock";
let focusMode = null;
let qrManager = null;
let timezoneTimer = null;

const ui = {};

function cloneState(source) {
  return JSON.parse(JSON.stringify(source));
}

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date, days) {
  const next = new Date(date.getTime());
  next.setDate(next.getDate() + days);
  return next;
}

function formatMonthLabel(date) {
  return date.toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

function formatDateLabel(date) {
  return date.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
}

function formatRangeLabel(start, end) {
  const sameYear = start.getFullYear() === end.getFullYear();
  const sameMonth = sameYear && start.getMonth() === end.getMonth();
  if (sameMonth) {
    return `${start.toLocaleDateString(undefined, {
      month: "long",
    })} ${start.getDate()}–${end.getDate()}, ${start.getFullYear()}`;
  }
  if (sameYear) {
    return `${start.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    })} – ${end.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    })}, ${start.getFullYear()}`;
  }
  return `${start.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  })} – ${end.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  })}`;
}

function formatTime(date) {
  return date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

function getStoredView(view) {
  return VALID_VIEWS.has(view) ? view : DEFAULT_VIEW;
}

function applyStoredView() {
  const stored = state && state.s ? state.s.v : null;
  currentView = getStoredView(stored);
  if (state && state.s) state.s.v = currentView;
  updateViewButtons();
}

function normalizeTimezones(rawZones) {
  if (!Array.isArray(rawZones)) return [];
  const zones = [];
  const seen = new Set();
  rawZones.forEach((zone) => {
    if (typeof zone !== "string") return;
    const trimmed = zone.trim();
    if (!trimmed || seen.has(trimmed)) return;
    if (!isValidZone(trimmed)) return;
    seen.add(trimmed);
    zones.push(trimmed);
  });
  return zones;
}

function normalizeState(raw) {
  const next = cloneState(DEFAULT_STATE);
  if (!raw || typeof raw !== "object") return next;

  if (typeof raw.t === "string") {
    next.t = raw.t.slice(0, MAX_TITLE_LENGTH);
  }

  if (raw.c && typeof raw.c === "object" && !Array.isArray(raw.c)) {
    next.c = DEFAULT_COLORS.slice();
    for (const [i, color] of Object.entries(raw.c)) {
      const idx = Number(i);
      if (idx >= 0 && idx < next.c.length && typeof color === "string" && /^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(color)) {
        next.c[idx] = color.startsWith("#") ? color : `#${color}`;
      }
    }
  } else if (Array.isArray(raw.c) && raw.c.length) {
    next.c = raw.c
      .filter((color) => typeof color === "string" && /^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(color))
      .map((color) => (color.startsWith("#") ? color : `#${color}`));
    if (!next.c.length) next.c = DEFAULT_COLORS.slice();
  }

  if (Array.isArray(raw.e)) {
    next.e = raw.e
      .filter((entry) => Array.isArray(entry) && entry.length >= 3)
      .map((entry) => {
        const startMin = Number(entry[0]);
        const duration = Math.max(0, Number(entry[1]) || 0);
        const title = String(entry[2] || "Untitled").slice(0, 80);
        const colorIndex = Math.max(0, Math.min(next.c.length - 1, Number(entry[3]) || 0));
        const rule = ["d", "w", "m", "y"].includes(entry[4]) ? entry[4] : "";
        const event = [startMin, duration, title, colorIndex];
        if (rule) event.push(rule);
        return event;
      })
      .filter((entry) => Number.isFinite(entry[0]));
  }

  if (raw.s && typeof raw.s === "object") {
    next.s.d = raw.s.d ? 1 : 0;
    next.s.m = raw.s.m ? 1 : 0;
    next.s.v = getStoredView(raw.s.v);
  }

  if (Array.isArray(raw.timezones) || Array.isArray(raw.z) || Array.isArray(raw.tz)) {
    const zones = Array.isArray(raw.timezones) ? raw.timezones : Array.isArray(raw.z) ? raw.z : raw.tz;
    next.timezones = normalizeTimezones(zones);
  }

  return next;
}

function cacheElements() {
  ui.mobileWarning = document.getElementById("mobile-warning");
  ui.mobileWarningDismiss = document.getElementById("mobile-warning-dismiss");
  ui.topbar = document.querySelector(".topbar");
  ui.titleInput = document.getElementById("calendar-title");
  ui.prevMonth = document.getElementById("prev-month");
  ui.nextMonth = document.getElementById("next-month");
  ui.todayBtn = document.getElementById("today-btn");
  ui.addEventBtn = document.getElementById("add-event");
  ui.copyLinkBtn = document.getElementById("copy-link");
  ui.shareQrBtn = document.getElementById("share-qr");
  ui.lockBtn = document.getElementById("lock-btn");
  ui.focusBtn = document.getElementById("focus-btn");
  ui.viewButtons = Array.from(document.querySelectorAll(".view-toggle button"));
  ui.weekstartToggle = document.getElementById("weekstart-toggle");
  ui.themeToggle = document.getElementById("theme-toggle");
  ui.monthLabel = document.getElementById("month-label");
  ui.weekdayRow = document.getElementById("weekday-row");
  ui.calendarGrid = document.getElementById("calendar-grid");
  ui.selectedDateLabel = document.getElementById("selected-date-label");
  ui.eventList = document.getElementById("event-list");
  ui.addEventInline = document.getElementById("add-event-inline");
  ui.urlLength = document.getElementById("url-length");
  ui.urlWarning = document.getElementById("url-warning");
  ui.viewJson = document.getElementById("view-json");
  ui.exportJson = document.getElementById("export-json");
  ui.importIcs = document.getElementById("import-ics");
  ui.icsInput = document.getElementById("ics-input");
  ui.clearAll = document.getElementById("clear-all");
  ui.lockedOverlay = document.getElementById("locked-overlay");
  ui.unlockBtn = document.getElementById("unlock-btn");

  ui.eventModal = document.getElementById("event-modal");
  ui.eventForm = document.getElementById("event-form");
  ui.eventModalTitle = document.getElementById("event-modal-title");
  ui.eventClose = document.getElementById("event-close");
  ui.eventCancel = document.getElementById("event-cancel");
  ui.eventDelete = document.getElementById("event-delete");
  ui.eventTitle = document.getElementById("event-title");
  ui.eventDate = document.getElementById("event-date");
  ui.eventTime = document.getElementById("event-time");
  ui.eventDuration = document.getElementById("event-duration");
  ui.eventAllDay = document.getElementById("event-all-day");
  ui.eventRecurrence = document.getElementById("event-recurrence");
  ui.eventColor = document.getElementById("event-color");
  ui.colorPalette = document.getElementById("color-palette");

  ui.passwordModal = document.getElementById("password-modal");
  ui.passwordTitle = document.getElementById("password-title");
  ui.passwordDesc = document.getElementById("password-desc");
  ui.passwordInput = document.getElementById("password-input");
  ui.passwordConfirmField = document.getElementById("password-confirm-field");
  ui.passwordConfirm = document.getElementById("password-confirm");
  ui.passwordError = document.getElementById("password-error");
  ui.passwordClose = document.getElementById("password-close");
  ui.passwordCancel = document.getElementById("password-cancel");
  ui.passwordSubmit = document.getElementById("password-submit");

  ui.jsonModal = document.getElementById("json-modal");
  ui.jsonClose = document.getElementById("json-close");
  ui.jsonHash = document.getElementById("json-hash");
  ui.jsonOutput = document.getElementById("json-output");
  ui.jsonCopy = document.getElementById("json-copy");
  ui.jsonCopyHash = document.getElementById("json-copy-hash");
  ui.jsonDownload = document.getElementById("json-download");

  ui.toastContainer = document.getElementById("toast-container");

  ui.tzSidebar = document.getElementById("timezone-ruler");
  ui.tzList = document.getElementById("tz-list");
  ui.tzAddBtn = document.getElementById("add-tz-btn");
  ui.tzModal = document.getElementById("tz-modal");
  ui.tzSearch = document.getElementById("tz-search");
  ui.tzResults = document.getElementById("tz-results");
  ui.tzClose = document.getElementById("close-tz-modal");
  ui.tzEmpty = document.getElementById("tz-empty");

  ui.hamburgerBtn = document.getElementById("hamburger-btn");
  ui.secondaryActions = document.getElementById("secondary-actions");
  ui.mobileSidebarToggle = document.getElementById("mobile-sidebar-toggle");
  ui.sidePanel = document.querySelector(".side-panel");
  ui.tzSidebar = document.getElementById("timezone-ruler");
  ui.sidePanelClose = document.getElementById("side-panel-close");
  ui.tzSidebarClose = document.getElementById("tz-sidebar-close");
}

function showToast(message, type = "info") {
  if (!ui.toastContainer) return;
  const toast = document.createElement("div");
  toast.className = `toast ${type}`.trim();
  toast.textContent = message;
  ui.toastContainer.appendChild(toast);
  setTimeout(() => {
    toast.remove();
  }, 3200);
}

function isMobileViewport() {
  if (window.matchMedia) {
    return window.matchMedia(MOBILE_WARNING_QUERY).matches;
  }
  return window.innerWidth <= 720;
}

function getMobileWarningDismissed() {
  try {
    return window.localStorage.getItem(MOBILE_WARNING_KEY) === "1";
  } catch (error) {
    return false;
  }
}

function setMobileWarningDismissed() {
  try {
    window.localStorage.setItem(MOBILE_WARNING_KEY, "1");
  } catch (error) {
    // Ignore storage errors (private mode, blocked, etc.).
  }
}

function updateMobileWarningVisibility() {
  if (!ui.mobileWarning) return;
  const shouldShow = isMobileViewport() && !getMobileWarningDismissed();
  ui.mobileWarning.classList.toggle("hidden", !shouldShow);
}

function dismissMobileWarning() {
  setMobileWarningDismissed();
  if (ui.mobileWarning) ui.mobileWarning.classList.add("hidden");
}

function initMobileWarning() {
  if (!ui.mobileWarning) return;
  updateMobileWarningVisibility();
  window.addEventListener("resize", updateMobileWarningVisibility);
  if (!window.matchMedia) return;
  const mediaQuery = window.matchMedia(MOBILE_WARNING_QUERY);
  const handleChange = () => updateMobileWarningVisibility();
  if (mediaQuery.addEventListener) {
    mediaQuery.addEventListener("change", handleChange);
  } else if (mediaQuery.addListener) {
    mediaQuery.addListener(handleChange);
  }
}

function hasStoredData() {
  return (state.e && state.e.length) || (state.timezones && state.timezones.length);
}

function getLocalZone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

function createTzCard(zoneId, isLocal) {
  const data = getZoneInfo(zoneId);
  const div = document.createElement("div");
  div.className = `tz-card${isLocal ? " is-local" : ""}`;

  div.innerHTML = `
    <div class="tz-name">
      <span class="tz-label">${data.name}</span>
      <span class="tz-offset">UTC${data.offset}</span>
    </div>
    <div class="tz-time">${data.time}</div>
    ${data.dayDiff ? `<div class="tz-diff">${data.dayDiff}</div>` : ""}
    ${!isLocal ? `<button class="tz-remove" type="button" data-zone="${data.fullZone}" aria-label="Remove timezone">x</button>` : ""}
  `;

  return div;
}

function renderTimezones() {
  if (!ui.tzList) return;
  ui.tzList.innerHTML = "";

  const localZone = getLocalZone();
  ui.tzList.appendChild(createTzCard(localZone, true));

  const zones = Array.isArray(state.timezones) ? state.timezones : [];
  let added = 0;
  const seen = new Set();
  zones.forEach((zone) => {
    if (zone === localZone) return;
    if (seen.has(zone)) return;
    if (!isValidZone(zone)) return;
    seen.add(zone);
    ui.tzList.appendChild(createTzCard(zone, false));
    added += 1;
  });

  if (!added) {
    const empty = document.createElement("p");
    empty.className = "tz-empty";
    empty.textContent = "Add a timezone to compare.";
    ui.tzList.appendChild(empty);
  }
}

function addTimezone(zoneStr) {
  if (!zoneStr || !isValidZone(zoneStr)) return;
  const localZone = getLocalZone();
  if (zoneStr === localZone) return;
  if (!Array.isArray(state.timezones)) state.timezones = [];
  if (state.timezones.includes(zoneStr)) return;
  state.timezones.push(zoneStr);
  scheduleSave();
  renderTimezones();
}

function removeTimezone(zoneStr) {
  if (!Array.isArray(state.timezones) || !zoneStr) return;
  state.timezones = state.timezones.filter((zone) => zone !== zoneStr);
  scheduleSave();
  renderTimezones();
}

function renderTzResults(results) {
  if (!ui.tzResults) return;
  ui.tzResults.innerHTML = "";
  results.forEach((zone) => {
    const li = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.className = "tz-result-btn";
    const info = getZoneInfo(zone);
    const name = document.createElement("span");
    name.className = "tz-result-name";
    name.textContent = zone;
    const offset = document.createElement("span");
    offset.className = "tz-result-offset";
    offset.textContent = `UTC${info.offset}`;
    button.append(name, offset);
    button.dataset.zone = zone;
    li.appendChild(button);
    ui.tzResults.appendChild(li);
  });
}

function parseOffsetSearchTerm(raw) {
  if (!raw) return null;
  let term = raw.toLowerCase().replace(/\s+/g, "");
  let hasPrefix = false;
  if (term.startsWith("utc")) {
    term = term.slice(3);
    hasPrefix = true;
  } else if (term.startsWith("gmt")) {
    term = term.slice(3);
    hasPrefix = true;
  }
  if (!term) return null;

  let sign = null;
  if (term.startsWith("+") || term.startsWith("-")) {
    sign = term[0];
    term = term.slice(1);
  }

  const hasSeparator = term.includes(":") || term.includes(".");

  let hours = null;
  let minutes = null;
  let hasMinutes = false;

  if (hasSeparator) {
    const parts = term.split(/[:.]/);
    if (parts.length !== 2) return null;
    hours = Number(parts[0]);
    minutes = Number(parts[1]);
    hasMinutes = parts[1].length > 0;
  } else if (/^\d{1,2}$/.test(term)) {
    hours = Number(term);
    minutes = 0;
  } else if (/^\d{3,4}$/.test(term)) {
    const padded = term.padStart(4, "0");
    hours = Number(padded.slice(0, 2));
    minutes = Number(padded.slice(2));
    hasMinutes = true;
  } else {
    return null;
  }

  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  if (hours > 14 || minutes > 59) return null;

  const signChar = sign || "+";
  const value = `${signChar}${hours}:${String(minutes).padStart(2, "0")}`;
  return { value, sign, hours, minutes, hasMinutes };
}

function handleTzSearch() {
  if (!ui.tzSearch) return;
  const term = ui.tzSearch.value.trim().toLowerCase();
  const offsetQuery = parseOffsetSearchTerm(term);
  if (!AVAILABLE_ZONES.length) {
    if (ui.tzEmpty) {
      ui.tzEmpty.textContent = "Timezone search isn't supported in this browser.";
      ui.tzEmpty.classList.remove("hidden");
    }
    renderTzResults([]);
    return;
  }
  if (term.length < 2 && !offsetQuery) {
    renderTzResults([]);
    if (ui.tzEmpty) ui.tzEmpty.classList.add("hidden");
    return;
  }
  const localZone = getLocalZone();
  const existing = new Set([localZone, ...(state.timezones || [])]);
  const matches = AVAILABLE_ZONES.filter((zone) => {
    if (existing.has(zone)) return false;
    const zoneLower = zone.toLowerCase();
    if (zoneLower.includes(term)) return true;
    if (offsetQuery) {
      const zoneOffset = getZoneInfo(zone).offset;
      const normalized = `${offsetQuery.hours}:${String(offsetQuery.minutes).padStart(2, "0")}`;
      if (offsetQuery.hasMinutes) {
        if (offsetQuery.sign) {
          return zoneOffset === `${offsetQuery.sign}${normalized}`;
        }
        return zoneOffset === `+${normalized}` || zoneOffset === `-${normalized}`;
      }
      if (offsetQuery.sign) {
        return zoneOffset.startsWith(`${offsetQuery.sign}${offsetQuery.hours}`);
      }
      return zoneOffset.startsWith(`+${offsetQuery.hours}`) || zoneOffset.startsWith(`-${offsetQuery.hours}`);
    }
    return false;
  }).slice(0, MAX_TZ_RESULTS);
  renderTzResults(matches);
  if (ui.tzEmpty) {
    ui.tzEmpty.textContent = TZ_EMPTY_MESSAGE;
    ui.tzEmpty.classList.toggle("hidden", matches.length > 0);
  }
}

function openTzModal() {
  if (!ui.tzModal) return;
  if (ui.tzSearch) ui.tzSearch.value = "";
  if (ui.tzEmpty) {
    ui.tzEmpty.textContent = TZ_EMPTY_MESSAGE;
    ui.tzEmpty.classList.add("hidden");
  }
  renderTzResults([]);
  handleTzSearch();
  if (typeof ui.tzModal.showModal === "function") {
    ui.tzModal.showModal();
  } else {
    ui.tzModal.setAttribute("open", "");
  }
  if (ui.tzSearch) ui.tzSearch.focus();
}

function closeTzModal() {
  if (!ui.tzModal) return;
  if (typeof ui.tzModal.close === "function") {
    ui.tzModal.close();
  } else {
    ui.tzModal.removeAttribute("open");
  }
}

function handleTzResultsClick(event) {
  const button = event.target.closest("button[data-zone]");
  if (!button) return;
  const zone = button.dataset.zone;
  addTimezone(zone);
  closeTzModal();
}

function handleTzListClick(event) {
  const button = event.target.closest("button[data-zone]");
  if (!button) return;
  removeTimezone(button.dataset.zone);
}

function initTimezones() {
  if (!ui.tzList) return;
  renderTimezones();
  if (timezoneTimer) {
    window.clearInterval(timezoneTimer);
    timezoneTimer = null;
  }
  const now = new Date();
  const delay = (60 - now.getSeconds()) * 1000;
  window.setTimeout(() => {
    renderTimezones();
    timezoneTimer = window.setInterval(renderTimezones, 60000);
  }, delay);
}

async function persistStateToHash() {
  if (lockState.encrypted && !lockState.unlocked) return;
  if (!hasStoredData()) {
    if (window.location.hash) clearHash();
    updateUrlLength();
    if (ui.jsonModal && !ui.jsonModal.classList.contains("hidden")) {
      updateJsonModal();
    }
    return;
  }
  await writeStateToHash(state, password);
  updateUrlLength();
  if (ui.jsonModal && !ui.jsonModal.classList.contains("hidden")) {
    updateJsonModal();
  }
}

function scheduleSave() {
  if (lockState.encrypted && !lockState.unlocked) return;
  if (!hasStoredData()) {
    if (saveTimer) {
      window.clearTimeout(saveTimer);
      saveTimer = null;
    }
    persistStateToHash();
    return;
  }
  if (saveTimer) window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    saveTimer = null;
    persistStateToHash();
  }, DEBOUNCE_MS);
}

function updateUrlLength() {
  const length = window.location.hash.length;
  if (ui.urlLength) ui.urlLength.textContent = String(length);
  if (!ui.urlWarning) return;
  if (length > 2000) {
    ui.urlWarning.textContent = "Warning: long URLs may get truncated when shared.";
  } else {
    ui.urlWarning.textContent = "";
  }
}

function updateTheme() {
  document.body.dataset.theme = state.s.d ? "dark" : "light";
  if (ui.themeToggle) {
    ui.themeToggle.textContent = `Theme: ${state.s.d ? "Dark" : "Light"}`;
  }
}

function syncTopbarHeight() {
  if (!ui.topbar) return;
  document.documentElement.style.setProperty("--topbar-height", `${ui.topbar.offsetHeight}px`);
}

function updateWeekStartLabel() {
  if (!ui.weekstartToggle) return;
  ui.weekstartToggle.textContent = state.s.m ? "Week starts Monday" : "Week starts Sunday";
}

function updateFocusButton(isActive) {
  if (!ui.focusBtn) return;
  const active = typeof isActive === "boolean" ? isActive : focusMode && focusMode.isActive();
  ui.focusBtn.textContent = active ? "Exit focus" : "Focus";
  ui.focusBtn.setAttribute("aria-pressed", active ? "true" : "false");
}

function updateViewButtons() {
  if (!ui.viewButtons || !ui.viewButtons.length) return;
  ui.viewButtons.forEach((button) => {
    const isActive = button.dataset.view === currentView;
    button.classList.toggle("active", isActive);
    button.setAttribute("aria-selected", isActive ? "true" : "false");
  });
}

function setView(view) {
  if (!VALID_VIEWS.has(view)) return;
  if (currentView === view) return;
  currentView = view;
  if (state && state.s) state.s.v = view;
  updateViewButtons();
  render();
  persistStateToHash();
}

function updateLockUI() {
  const isLocked = lockState.encrypted && !lockState.unlocked;
  if (ui.lockBtn) {
    if (lockState.encrypted) {
      ui.lockBtn.textContent = isLocked ? "Unlock" : "Remove lock";
    } else {
      ui.lockBtn.textContent = "Lock";
    }
  }
  if (ui.lockedOverlay) {
    ui.lockedOverlay.classList.toggle("hidden", !isLocked);
  }
  const disabled = isLocked;
  [ui.addEventBtn, ui.addEventInline, ui.copyLinkBtn, ui.shareQrBtn].forEach((btn) => {
    if (btn) btn.disabled = disabled;
  });
}

function groupOccurrences(occurrences) {
  const map = new Map();
  occurrences.forEach((occ) => {
    const key = formatDateKey(new Date(occ.start));
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(occ);
  });

  map.forEach((list) => {
    list.sort((a, b) => a.start - b.start);
  });
  return map;
}

function decorateOccurrences(occurrences) {
  return occurrences.map((occ) => {
    const color = state.c[occ.colorIndex] || DEFAULT_COLORS[0];
    const timeLabel = occ.isAllDay ? "All day" : formatTime(new Date(occ.start));
    return { ...occ, color, timeLabel };
  });
}

function render() {
  updateTheme();
  updateWeekStartLabel();
  if (ui.titleInput && document.activeElement !== ui.titleInput) {
    ui.titleInput.value = state.t;
  }

  const weekStartsOnMonday = state.s.m === 1;
  if (ui.calendarGrid) {
    ui.calendarGrid.className = `calendar-grid ${currentView}-view`;
    ui.calendarGrid.style.gridTemplateColumns = "";
    ui.calendarGrid.style.gridTemplateRows = "";
  }
  if (ui.weekdayRow) {
    ui.weekdayRow.classList.toggle("hidden", currentView === "year" || currentView === "agenda");
  }

  if (currentView === "month") {
    const range = getMonthGridRange(viewDate, weekStartsOnMonday);
    const expanded = expandEvents(state.e, range.start, range.end);
    const decorated = decorateOccurrences(expanded);
    occurrencesByDay = groupOccurrences(decorated);

    if (ui.monthLabel) ui.monthLabel.textContent = formatMonthLabel(viewDate);
    if (ui.weekdayRow) renderWeekdayHeaders(ui.weekdayRow, weekStartsOnMonday, "month");

    if (ui.calendarGrid) {
      renderCalendar({
        container: ui.calendarGrid,
        dates: range.dates,
        currentMonth: viewDate.getMonth(),
        selectedDate,
        eventsByDay: occurrencesByDay,
        onSelectDay: handleSelectDay,
        onEventClick: (event) => openEventModal({ index: event.sourceIndex }),
      });
    }
  } else if (currentView === "week") {
    const range = getWeekRange(selectedDate, weekStartsOnMonday);
    const expanded = expandEvents(state.e, range.start, range.end);
    const decorated = decorateOccurrences(expanded);
    occurrencesByDay = groupOccurrences(decorated);

    if (ui.monthLabel) ui.monthLabel.textContent = formatRangeLabel(range.start, range.end);
    if (ui.weekdayRow) renderWeekdayHeaders(ui.weekdayRow, weekStartsOnMonday, "week", range.dates);
    if (ui.calendarGrid) {
      renderTimeGrid({
        container: ui.calendarGrid,
        dates: range.dates,
        occurrences: decorated,
        onSelectDay: handleSelectDay,
        onEventClick: (event) => openEventModal({ index: event.sourceIndex }),
      });
    }
  } else if (currentView === "day") {
    const start = startOfDay(selectedDate);
    const end = new Date(start.getFullYear(), start.getMonth(), start.getDate(), 23, 59, 59);
    const expanded = expandEvents(state.e, start, end);
    const decorated = decorateOccurrences(expanded);
    occurrencesByDay = groupOccurrences(decorated);

    if (ui.monthLabel) ui.monthLabel.textContent = formatDateLabel(selectedDate);
    if (ui.weekdayRow) renderWeekdayHeaders(ui.weekdayRow, weekStartsOnMonday, "day", [start]);
    if (ui.calendarGrid) {
      renderTimeGrid({
        container: ui.calendarGrid,
        dates: [start],
        occurrences: decorated,
        onSelectDay: handleSelectDay,
        onEventClick: (event) => openEventModal({ index: event.sourceIndex }),
      });
    }
  } else if (currentView === "agenda") {
    const agendaData = renderAgendaView({
      events: state.e,
      colors: state.c,
      container: ui.calendarGrid,
      rangeMonths: 6,
      onEventClick: (event) => openEventModal({ index: event.sourceIndex }),
    });
    occurrencesByDay = agendaData && agendaData.occurrencesByDay ? agendaData.occurrencesByDay : new Map();
    if (ui.monthLabel && agendaData && agendaData.range) {
      ui.monthLabel.textContent = `Agenda · ${formatRangeLabel(agendaData.range.start, agendaData.range.end)}`;
    }
  } else if (currentView === "year") {
    const year = viewDate.getFullYear();
    const start = new Date(year, 0, 1);
    const end = new Date(year, 11, 31, 23, 59, 59);
    const expanded = expandEvents(state.e, start, end);
    const decorated = decorateOccurrences(expanded);
    occurrencesByDay = groupOccurrences(decorated);

    if (ui.monthLabel) ui.monthLabel.textContent = String(year);
    if (ui.calendarGrid) {
      renderYearView({
        container: ui.calendarGrid,
        year,
        eventsByDay: occurrencesByDay,
        selectedDate,
        weekStartsOnMonday,
        onSelectDay: handleSelectDay,
      });
    }
  }

  renderEventList();
  renderTimezones();
  updateUrlLength();
  if (ui.jsonModal && !ui.jsonModal.classList.contains("hidden")) {
    updateJsonModal();
  }
  updateLockUI();
  initCountdownWidget(state.e);
}

function renderEventList() {
  if (!ui.eventList || !ui.selectedDateLabel) return;
  ui.selectedDateLabel.textContent = formatDateLabel(selectedDate);
  const key = formatDateKey(selectedDate);
  const list = occurrencesByDay.get(key) || [];

  ui.eventList.innerHTML = "";
  if (!list.length) {
    const empty = document.createElement("div");
    empty.className = "event-item";
    empty.textContent = "No events yet.";
    ui.eventList.appendChild(empty);
    return;
  }

  list.forEach((event) => {
    const item = document.createElement("div");
    item.className = "event-item";
    item.dataset.index = String(event.sourceIndex);

    const left = document.createElement("div");
    left.className = "event-info";
    const title = document.createElement("div");
    title.className = "event-title";
    title.textContent = event.title;
    const time = document.createElement("div");
    time.className = "event-time";
    time.textContent = event.isAllDay ? "All day" : `${event.timeLabel}`;
    left.appendChild(title);
    left.appendChild(time);

    const dot = document.createElement("div");
    dot.className = "event-dot";
    dot.style.background = event.color;

    item.appendChild(left);
    item.appendChild(dot);
    item.addEventListener("click", () => openEventModal({ index: event.sourceIndex }));
    ui.eventList.appendChild(item);
  });
}

function handleSelectDay(date) {
  selectedDate = startOfDay(date);
  if (currentView === "month") {
    if (date.getMonth() !== viewDate.getMonth() || date.getFullYear() !== viewDate.getFullYear()) {
      viewDate = new Date(date.getFullYear(), date.getMonth(), 1);
    }
  } else {
    viewDate = startOfDay(date);
  }
  render();
}

function openEventModal({ index = null, date = null } = {}) {
  if (!ui.eventModal) return;
  editingIndex = index;
  const isEditing = typeof index === "number";
  ui.eventModalTitle.textContent = isEditing ? "Edit event" : "Add event";
  ui.eventDelete.classList.toggle("hidden", !isEditing);

  const baseDate = date || selectedDate;
  let startDate = new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate(), 9, 0);
  let duration = 60;
  let title = "";
  let color = state.c[0] || DEFAULT_COLORS[0];
  let rule = "";
  let isAllDay = false;

  if (isEditing) {
    const entry = state.e[index];
    if (entry) {
      const [startMin, storedDuration, storedTitle, colorIndex, storedRule] = entry;
      startDate = new Date(startMin * 60000);
      duration = storedDuration || 0;
      title = storedTitle || "";
      color = state.c[colorIndex] || color;
      rule = storedRule || "";
      isAllDay = duration === 0;
    }
  }

  ui.eventTitle.value = title;
  ui.eventDate.value = formatDateKey(startDate);
  ui.eventTime.value = startDate.toTimeString().slice(0, 5);
  ui.eventDuration.value = String(isAllDay ? 0 : duration || 60);
  ui.eventRecurrence.value = rule;
  ui.eventColor.value = color;
  ui.eventAllDay.checked = isAllDay;
  toggleAllDay(isAllDay);
  renderColorPalette(color);

  ui.eventModal.classList.remove("hidden");
}

function closeEventModal() {
  if (ui.eventModal) ui.eventModal.classList.add("hidden");
}

function toggleAllDay(allDay) {
  if (!ui.eventTime || !ui.eventDuration) return;
  ui.eventTime.disabled = allDay;
  ui.eventDuration.disabled = allDay;
  if (allDay) {
    ui.eventDuration.value = "0";
  } else if (Number(ui.eventDuration.value) === 0) {
    ui.eventDuration.value = "60";
  }
}

function renderColorPalette(activeColor) {
  if (!ui.colorPalette) return;
  ui.colorPalette.innerHTML = "";
  state.c.forEach((color) => {
    const swatch = document.createElement("button");
    swatch.type = "button";
    swatch.className = "color-swatch";
    if (color.toLowerCase() === activeColor.toLowerCase()) {
      swatch.classList.add("active");
    }
    swatch.style.background = color;
    swatch.addEventListener("click", () => {
      ui.eventColor.value = color;
      renderColorPalette(color);
    });
    ui.colorPalette.appendChild(swatch);
  });
}

function saveEvent(event) {
  event.preventDefault();
  if (!ui.eventTitle || !ui.eventDate) return;
  const title = ui.eventTitle.value.trim() || "Untitled";
  const dateValue = ui.eventDate.value;
  if (!dateValue) return;

  const [year, month, day] = dateValue.split("-").map(Number);
  const allDay = ui.eventAllDay.checked;

  let startDate;
  if (allDay) {
    startDate = new Date(year, month - 1, day);
  } else {
    const [rawHours, rawMinutes] = ui.eventTime.value.split(":").map(Number);
    const hours = Number.isFinite(rawHours) ? rawHours : 9;
    const minutes = Number.isFinite(rawMinutes) ? rawMinutes : 0;
    startDate = new Date(year, month - 1, day, hours, minutes);
  }

  const startMin = Math.floor(startDate.getTime() / 60000);
  const duration = allDay ? 0 : Math.max(0, Number(ui.eventDuration.value) || 60);
  const colorValue = ui.eventColor.value.toLowerCase();
  let colorIndex = state.c.findIndex((color) => color.toLowerCase() === colorValue);
  if (colorIndex === -1) {
    state.c.push(colorValue);
    colorIndex = state.c.length - 1;
  }
  const rule = ui.eventRecurrence.value;
  const entry = [startMin, duration, title, colorIndex];
  if (rule) entry.push(rule);

  if (typeof editingIndex === "number") {
    state.e[editingIndex] = entry;
  } else {
    state.e.push(entry);
  }

  selectedDate = startOfDay(startDate);
  closeEventModal();
  scheduleSave();
  render();
}

function deleteEvent() {
  if (typeof editingIndex !== "number") return;
  const confirmed = window.confirm("Delete this event?");
  if (!confirmed) return;
  state.e.splice(editingIndex, 1);
  editingIndex = null;
  closeEventModal();
  scheduleSave();
  render();
}

function openPasswordModal({ mode, title, description, submitLabel }) {
  if (!ui.passwordModal) return Promise.resolve(null);
  passwordMode = mode;
  ui.passwordTitle.textContent = title;
  ui.passwordDesc.textContent = description;
  ui.passwordInput.value = "";
  ui.passwordConfirm.value = "";
  ui.passwordError.classList.add("hidden");

  if (mode === "set") {
    ui.passwordConfirmField.classList.remove("hidden");
  } else {
    ui.passwordConfirmField.classList.add("hidden");
  }

  ui.passwordSubmit.textContent = submitLabel;
  ui.passwordModal.classList.remove("hidden");

  return new Promise((resolve) => {
    passwordResolver = resolve;
  });
}

function closePasswordModal() {
  if (ui.passwordModal) ui.passwordModal.classList.add("hidden");
  if (passwordResolver) {
    passwordResolver(null);
    passwordResolver = null;
  }
}

function submitPassword() {
  if (!passwordResolver) return;
  const value = ui.passwordInput.value.trim();
  if (!value) {
    ui.passwordError.textContent = "Password is required.";
    ui.passwordError.classList.remove("hidden");
    return;
  }

  if (passwordMode === "set") {
    if (value !== ui.passwordConfirm.value.trim()) {
      ui.passwordError.textContent = "Passwords do not match.";
      ui.passwordError.classList.remove("hidden");
      return;
    }
  }

  ui.passwordModal.classList.add("hidden");
  passwordResolver(value);
  passwordResolver = null;
}

async function handleLockAction() {
  if (lockState.encrypted && !lockState.unlocked) {
    await attemptUnlock();
    return;
  }

  if (lockState.encrypted && lockState.unlocked) {
    const confirmed = window.confirm("Remove password protection? This will store data unencrypted in the URL.");
    if (!confirmed) return;
    password = null;
    lockState = { encrypted: false, unlocked: true };
    await writeStateToHash(state, null);
    updateLockUI();
    showToast("Lock removed", "success");
    return;
  }

  const value = await openPasswordModal({
    mode: "set",
    title: "Set password",
    description: "Add a password so only people with the link and password can read this calendar.",
    submitLabel: "Set password",
  });
  if (!value) return;
  password = value;
  lockState = { encrypted: true, unlocked: true };
  await writeStateToHash(state, password);
  updateLockUI();
  showToast("Calendar locked", "success");
}

async function attemptUnlock() {
  const value = await openPasswordModal({
    mode: "unlock",
    title: "Unlock calendar",
    description: "Enter the password to decrypt this calendar.",
    submitLabel: "Unlock",
  });
  if (!value) return;
  try {
    const loaded = await readStateFromHash(value);
    password = value;
    lockState = { encrypted: true, unlocked: true };
    state = normalizeState(loaded);
    applyStoredView();
    render();
    showToast("Calendar unlocked", "success");
  } catch (error) {
    showToast("Incorrect password", "error");
    lockState = { encrypted: true, unlocked: false };
    updateLockUI();
  }
}

async function loadStateFromHash() {
  if (!window.location.hash) {
    state = cloneState(DEFAULT_STATE);
    applyStoredView();
    return;
  }

  if (isEncryptedHash()) {
    lockState = { encrypted: true, unlocked: false };
    state = cloneState(DEFAULT_STATE);
    updateLockUI();
    return;
  }

  try {
    const loaded = await readStateFromHash();
    state = normalizeState(loaded);
  } catch (error) {
    state = cloneState(DEFAULT_STATE);
  }
  applyStoredView();
}

function handleHashChange() {
  loadStateFromHash().then(render);
}

function handleTitleInput() {
  if (!ui.titleInput) return;
  state.t = ui.titleInput.value.slice(0, MAX_TITLE_LENGTH);
  scheduleSave();
}

function handleThemeToggle() {
  state.s.d = state.s.d ? 0 : 1;
  updateTheme();
  scheduleSave();
}

function handleWeekStartToggle() {
  state.s.m = state.s.m ? 0 : 1;
  render();
  scheduleSave();
}

function shiftView(direction) {
  if (currentView === "month") {
    viewDate = new Date(viewDate.getFullYear(), viewDate.getMonth() + direction, 1);
  } else if (currentView === "year") {
    viewDate = new Date(viewDate.getFullYear() + direction, 0, 1);
  } else if (currentView === "week") {
    selectedDate = addDays(selectedDate, direction * 7);
    viewDate = startOfDay(selectedDate);
  } else if (currentView === "day") {
    selectedDate = addDays(selectedDate, direction);
    viewDate = startOfDay(selectedDate);
  }
  render();
}

function handlePrevMonth() {
  shiftView(-1);
}

function handleNextMonth() {
  shiftView(1);
}

function handleToday() {
  const today = startOfDay(new Date());
  viewDate = today;
  selectedDate = today;
  render();
}

function fallbackCopyText(text) {
  const textArea = document.createElement("textarea");
  textArea.value = text;
  textArea.setAttribute("readonly", "");
  textArea.style.position = "absolute";
  textArea.style.left = "-9999px";
  document.body.appendChild(textArea);
  textArea.select();
  let success = false;
  try {
    success = document.execCommand("copy");
  } catch (error) {
    success = false;
  }
  document.body.removeChild(textArea);
  return success;
}

async function handleCopyLink() {
  await persistStateToHash();
  const url = window.location.href;
  if (navigator.clipboard && navigator.clipboard.writeText) {
    try {
      await navigator.clipboard.writeText(url);
      showToast("Link copied", "success");
      return;
    } catch (error) {
      // Fallback below
    }
  }
  if (fallbackCopyText(url)) {
    showToast("Link copied", "success");
  } else {
    showToast("Unable to copy link", "error");
  }
}

function handleShareQr() {
  if (qrManager) {
    qrManager.show();
  }
}

function handleFocusToggle() {
  if (!focusMode) return;
  if (focusMode.isActive()) {
    focusMode.stop();
  } else {
    focusMode.start();
  }
}

function updateJsonModal() {
  if (ui.jsonOutput) {
    ui.jsonOutput.value = JSON.stringify(state, null, 2);
  }
  if (ui.jsonHash) {
    ui.jsonHash.value = window.location.hash || "";
  }
}

function openJsonModal() {
  if (!ui.jsonModal) return;
  updateJsonModal();
  ui.jsonModal.classList.remove("hidden");
}

function closeJsonModal() {
  if (!ui.jsonModal) return;
  ui.jsonModal.classList.add("hidden");
}

async function handleCopyJson() {
  if (!ui.jsonOutput) return;
  try {
    await navigator.clipboard.writeText(ui.jsonOutput.value);
    showToast("JSON copied", "success");
  } catch (error) {
    showToast("Unable to copy JSON", "error");
  }
}

async function handleCopyHash() {
  if (!ui.jsonHash) return;
  try {
    await navigator.clipboard.writeText(ui.jsonHash.value);
    showToast("Hash copied", "success");
  } catch (error) {
    showToast("Unable to copy hash", "error");
  }
}

function handleExportJson() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "hashcal.json";
  link.click();
  URL.revokeObjectURL(url);
}

function handleImportIcsClick() {
  if (ui.icsInput) ui.icsInput.click();
}

function handleIcsFile(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    const text = String(reader.result || "");
    const imported = parseIcs(text);
    if (!imported.length) {
      showToast("No events found", "error");
      return;
    }
    const colorCount = state.c.length || 1;
    imported.forEach((entry, idx) => {
      const start = entry.start;
      if (!start) return;
      const startMin = Math.floor(start.getTime() / 60000);
      let duration = 0;
      if (entry.end) {
        duration = Math.max(0, Math.round((entry.end.getTime() - start.getTime()) / 60000));
      }
      if (entry.isAllDay) duration = 0;
      const colorIndex = idx % colorCount;
      const event = [startMin, duration, entry.title || "Imported", colorIndex];
      if (entry.rule) event.push(entry.rule);
      state.e.push(event);
    });
    scheduleSave();
    render();
    showToast("Events imported", "success");
  };
  reader.readAsText(file);
  event.target.value = "";
}

function handleClearAll() {
  const confirmed = window.confirm("Clear all events? This cannot be undone.");
  if (!confirmed) return;
  state.e = [];
  scheduleSave();
  render();
}

function bindEvents() {
  if (ui.mobileWarningDismiss) ui.mobileWarningDismiss.addEventListener("click", dismissMobileWarning);
  if (ui.titleInput) ui.titleInput.addEventListener("input", handleTitleInput);
  if (ui.prevMonth) ui.prevMonth.addEventListener("click", handlePrevMonth);
  if (ui.nextMonth) ui.nextMonth.addEventListener("click", handleNextMonth);
  if (ui.todayBtn) ui.todayBtn.addEventListener("click", handleToday);
  if (ui.viewButtons && ui.viewButtons.length) {
    ui.viewButtons.forEach((button) => {
      button.addEventListener("click", () => setView(button.dataset.view));
    });
  }
  if (ui.addEventBtn) ui.addEventBtn.addEventListener("click", () => openEventModal({ date: selectedDate }));
  if (ui.addEventInline) ui.addEventInline.addEventListener("click", () => openEventModal({ date: selectedDate }));
  if (ui.copyLinkBtn) ui.copyLinkBtn.addEventListener("click", handleCopyLink);
  if (ui.shareQrBtn) ui.shareQrBtn.addEventListener("click", handleShareQr);
  if (ui.lockBtn) ui.lockBtn.addEventListener("click", handleLockAction);
  if (ui.focusBtn) ui.focusBtn.addEventListener("click", handleFocusToggle);
  if (ui.weekstartToggle) ui.weekstartToggle.addEventListener("click", handleWeekStartToggle);
  if (ui.themeToggle) ui.themeToggle.addEventListener("click", handleThemeToggle);
  if (ui.unlockBtn) ui.unlockBtn.addEventListener("click", attemptUnlock);
  if (ui.viewJson) ui.viewJson.addEventListener("click", openJsonModal);
  if (ui.exportJson) ui.exportJson.addEventListener("click", handleExportJson);
  if (ui.importIcs) ui.importIcs.addEventListener("click", handleImportIcsClick);
  if (ui.icsInput) ui.icsInput.addEventListener("change", handleIcsFile);
  if (ui.clearAll) ui.clearAll.addEventListener("click", handleClearAll);

  if (ui.eventClose) ui.eventClose.addEventListener("click", closeEventModal);
  if (ui.eventCancel) ui.eventCancel.addEventListener("click", closeEventModal);
  if (ui.eventDelete) ui.eventDelete.addEventListener("click", deleteEvent);
  if (ui.eventForm) ui.eventForm.addEventListener("submit", saveEvent);
  if (ui.eventAllDay) ui.eventAllDay.addEventListener("change", (e) => toggleAllDay(e.target.checked));

  if (ui.passwordClose) ui.passwordClose.addEventListener("click", closePasswordModal);
  if (ui.passwordCancel) ui.passwordCancel.addEventListener("click", closePasswordModal);
  if (ui.passwordSubmit) ui.passwordSubmit.addEventListener("click", submitPassword);
  if (ui.jsonClose) ui.jsonClose.addEventListener("click", closeJsonModal);
  if (ui.jsonCopy) ui.jsonCopy.addEventListener("click", handleCopyJson);
  if (ui.jsonCopyHash) ui.jsonCopyHash.addEventListener("click", handleCopyHash);
  if (ui.jsonDownload) ui.jsonDownload.addEventListener("click", handleExportJson);
  if (ui.tzAddBtn) ui.tzAddBtn.addEventListener("click", openTzModal);
  if (ui.tzClose) ui.tzClose.addEventListener("click", closeTzModal);
  if (ui.tzSearch) ui.tzSearch.addEventListener("input", handleTzSearch);
  if (ui.tzResults) ui.tzResults.addEventListener("click", handleTzResultsClick);
  if (ui.tzList) ui.tzList.addEventListener("click", handleTzListClick);
  if (ui.tzModal) {
    ui.tzModal.addEventListener("click", (event) => {
      if (event.target === ui.tzModal) closeTzModal();
    });
  }

  window.addEventListener("hashchange", handleHashChange);
  window.addEventListener("resize", syncTopbarHeight);
}

function initResponsiveFeatures() {
  if (ui.hamburgerBtn && ui.secondaryActions) {
    ui.hamburgerBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      ui.secondaryActions.classList.toggle("is-active");
      const icon = ui.hamburgerBtn.querySelector("i");
      if (icon) {
        icon.classList.toggle("fa-bars");
        icon.classList.toggle("fa-xmark");
      }
    });

    document.addEventListener("click", (e) => {
      if (!ui.secondaryActions.contains(e.target) && !ui.hamburgerBtn.contains(e.target)) {
        ui.secondaryActions.classList.remove("is-active");
        const icon = ui.hamburgerBtn.querySelector("i");
        if (icon) {
          icon.classList.add("fa-bars");
          icon.classList.remove("fa-xmark");
        }
      }
    });
  }

  if (ui.mobileSidebarToggle) {
    ui.mobileSidebarToggle.addEventListener("click", () => {
      if (ui.sidePanel.classList.contains("is-active")) {
        // From Events to Clock
        ui.sidePanel.classList.remove("is-active");
        ui.tzSidebar.classList.add("is-active");
        ui.mobileSidebarToggle.querySelector("span").textContent = "Clock";
      } else if (ui.tzSidebar.classList.contains("is-active")) {
        // From Clock to Calendar (Close both)
        ui.tzSidebar.classList.remove("is-active");
        ui.mobileSidebarToggle.querySelector("span").textContent = "Details";
      } else {
        // From Calendar to Events
        ui.sidePanel.classList.add("is-active");
        ui.mobileSidebarToggle.querySelector("span").textContent = "Events";
      }
    });
  }

  if (ui.sidePanelClose) {
    ui.sidePanelClose.addEventListener("click", () => {
      ui.sidePanel.classList.remove("is-active");
      if (ui.mobileSidebarToggle) ui.mobileSidebarToggle.querySelector("span").textContent = "Details";
    });
  }

  if (ui.tzSidebarClose) {
    ui.tzSidebarClose.addEventListener("click", () => {
      ui.tzSidebar.classList.remove("is-active");
      if (ui.mobileSidebarToggle) ui.mobileSidebarToggle.querySelector("span").textContent = "Details";
    });
  }
}

async function init() {
  cacheElements();
  syncTopbarHeight();
  qrManager = initQRCodeManager({
    onBeforeOpen: persistStateToHash,
    onCopyLink: handleCopyLink,
    showToast,
  });
  focusMode = new FocusMode({
    getState: () => state,
    fallbackColors: DEFAULT_COLORS,
    onToggle: updateFocusButton,
  });
  bindEvents();
  initMobileWarning();
  initResponsiveFeatures();
  await loadStateFromHash();
  if (!isEncryptedHash() && !hasStoredData() && window.location.hash) {
    clearHash();
  }

  updateViewButtons();
  updateFocusButton(false);
  render();
  initTimezones();

  if (isEncryptedHash() && !lockState.unlocked) {
    attemptUnlock();
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
