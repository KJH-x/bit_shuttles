import { ROUTES, DURATION_MIN, DURATION_BY_ROUTE, DURATION_PROFILES, scheduleKind, activeTrips, CHECKPOINTS, CAMPUS, ENABLE_XISHAN } from "./schedule-data.js?v=20260910-29";
import {
  formatClock,
  formatHM,
  formatDurationLabel,
  computeAll,
  depToMs,
  ticketInfo,
  departureLabel,
  fidsStatus,
  checkpointTimes,
  checkpointLabel,
  checkpointOffsets,
  tripLocation,
  campusStopAt,
  etaDiffMin
} from "./lib/schedule.js?v=20260910-29";
import { now, syncClock, toBeijingDateStr } from "./lib/time.js?v=20260910-29";
import { initInstallGuide } from "./lib/install-guide.js?v=20260910-29";
import { initQQBrowserGuide } from "./lib/qq-guide.js?v=20260910-29";
import {
  initAvail,
  setDate as setAvailDate,
  refreshUpcoming,
  refreshNow as refreshAvailNow,
  mainAvailText,
  pidsAvailText,
  tripAgeMs,
  availAgeMs,
  fetchHistoryDates
} from "./lib/availability.js?v=20260910-29";
import { initTraffic, refreshTrafficNow, trafficForRoute, realtimeDurMin, markerProgress, laneGradient } from "./lib/traffic.js?v=20260910-29";
import { initRainbow, refreshRainbowNow, rainbowAvailText, rainbowAgeMs } from "./lib/rainbow.js?v=20260910-29";
import {
  readPref,
  savePref,
  readReminders,
  hasReminder,
  setReminder,
  unsetReminder,
  reminderMethodOf,
  hasBeenAsked,
  markAsked,
  isPwa,
  isIosSafari,
  notificationSupported,
  notificationGranted,
  ensureNotificationPermission,
  DEFAULT_OFFSET_MIN,
  icsHintDismissed,
  dismissIcsHint,
  openDingTalk,
  buildReminderIcs,
  buildReminderFilename,
  downloadIcs,
  schedulePwaNotify
} from "./lib/reminder.js?v=20260910-29";

const ROUTE_LABEL = Object.fromEntries(ROUTES.map((r) => [r.id, r.label]));
const ROUTE_DEST = { a: "中关村", c: "良乡", d: "西山", e: "中关村" };
const CORRIDORS = [
  { id: "main", label: "良乡 ⇄ 中关村", fwd: "a", rev: "c", left: "良乡", right: "中关村" },
  { id: "xishan", label: "中关村 ⇄ 西山", fwd: "d", rev: "e", left: "中关村", right: "西山" }
];
const FWD = new Set(CORRIDORS.map((c) => c.fwd));
const fwdTrip = (t) => FWD.has(t.route);

const dom = {
  clock: document.getElementById("liveClock"),
  scheduleBadge: document.getElementById("scheduleBadge"),
  viewMain: document.getElementById("view-main"),
  viewFids: document.getElementById("view-fids"),
  viewSwitchBtns: [...document.querySelectorAll(".view-switch__btn")],
  nextStatus: document.getElementById("nextStatus"),
  trafficBadge: document.getElementById("trafficBadge"),
  resultsStatus: document.getElementById("resultsStatus"),
  themeSelect: document.getElementById("themeSelect"),
  datePrev: document.getElementById("datePrev"),
  dateNext: document.getElementById("dateNext"),
  dateLabel: document.getElementById("dateLabel"),
  datePicker: document.getElementById("datePicker"),
  historyPanel: document.getElementById("historyPanel"),
  historyPanelTitle: document.getElementById("historyPanelTitle"),
  historyStats: document.getElementById("historyStats"),
  historyList: document.getElementById("historyList"),
  historyEmpty: document.getElementById("historyEmpty"),
  routeChips: document.getElementById("routeChips"),
  trackMain: document.getElementById("trackMain"),
  corridorContainer: document.getElementById("corridors"),
  trackMainEmpty: document.getElementById("trackMainEmpty"),
  runningDetail: document.getElementById("runningDetail"),
  detailToggle: document.getElementById("detailToggle"),
  runningList: document.getElementById("runningList"),
  runningTitle: document.getElementById("runningTitle"),
  amapButtons: [...document.querySelectorAll(".amap-links__btn")],
  amapQr: document.getElementById("amapQr"),
  trafficLiveNote: document.getElementById("trafficLiveNote"),
  reminderBtn: document.getElementById("reminderBtn"),
  reminderGuide: document.getElementById("reminderGuide"),
  reminderGuideYes: document.getElementById("reminderGuideYes"),
  reminderGuideNo: document.getElementById("reminderGuideNo"),
  reminderGuideMethods: document.getElementById("reminderGuideMethods"),
  reminderGuideMethodPwa: document.getElementById("reminderGuideMethodPwa"),
  reminderGuideMethodBoth: document.getElementById("reminderGuideMethodBoth"),
  reminderGuideText: document.getElementById("reminderGuideText"),
  reminderGuideHint: document.getElementById("reminderGuideHint"),
  reminderSettings: document.getElementById("reminderSettings"),
  reminderEnabled: document.getElementById("reminderEnabled"),
  reminderMethodGroup: document.getElementById("reminderMethodGroup"),
  reminderMethodCalendar: document.getElementById("reminderMethodCalendar"),
  reminderMethodPwa: document.getElementById("reminderMethodPwa"),
  reminderMethodBoth: document.getElementById("reminderMethodBoth"),
  reminderMethodPwaWrap: document.getElementById("reminderMethodPwaWrap"),
  reminderMethodBothWrap: document.getElementById("reminderMethodBothWrap"),
  reminderSettingsHint: document.getElementById("reminderSettingsHint"),
  reminderIcsHint: document.getElementById("reminderIcsHint"),
  reminderIcsHintDismiss: document.getElementById("reminderIcsHintDismiss"),
  reminderIcsHintClose: document.getElementById("reminderIcsHintClose"),
  reminderSettingsClose: document.getElementById("reminderSettingsClose"),
  fidsBody: document.getElementById("fidsBody"),
  tripColumnA: document.getElementById("tripColumnA"),
  tripColumnC: document.getElementById("tripColumnC"),
  tripColumnD: document.getElementById("tripColumnD"),
  tripColumnE: document.getElementById("tripColumnE"),
  tripListA: document.getElementById("tripListA"),
  tripListC: document.getElementById("tripListC"),
  tripListD: document.getElementById("tripListD"),
  tripListE: document.getElementById("tripListE"),
  upcomingEmpty: document.getElementById("upcomingEmpty")
};

const state = {
  theme: localStorage.getItem("shuttle-theme") || "system",
  routeFilter: "all",
  showAll: false,
  runningSig: "",
  upcomingSig: "",
  fidsSig: "",
  historySig: "",
  fidsAutoScroll: false,
  viewDate: null, // null=跟随真实今天；否则 'YYYY-MM-DD'
  displayDate: null, // 实际展示日期（末班后=明日；avail 数据 date 以它为准）
  availMap: new Map(), // `${route}|${dep}` → avail
  rainbowMap: new Map(), // `${date}|${route}|${dep}` → 彩虹实车余座 {seatsTotal,seatsTaken,seatsLeft}
  traffic: null,
  trafficLive: null,
  futureTrips: new Map(), // 未来日期 → 源站实车 trips（批量接口）
  scheduleKindByDate: new Map(), // 日期 → 源站实车推断的时刻表类型
  history: null, // { date, trips, stats } 历史快照 + 满载率统计
  historyDates: [] // 近 7 天有快照的历史日期
};

const MAX_FUTURE_DAYS = 5; // 未来查询上限（源站实车仅提前约 3 天发布，超出显示空/未发布）
const MIN_PAST_DAYS = 30; // 历史回看下限（快照仅保留 7 天，多翻无意义）

function shiftDateStr(dateStr, delta) {
  const d = dateFromStr(dateStr);
  d.setDate(d.getDate() + delta);
  return d.toISOString().slice(0, 10);
}

function maxFutureStr() {
  return shiftDateStr(beijingTodayStr(), MAX_FUTURE_DAYS);
}

function minPastStr() {
  return shiftDateStr(beijingTodayStr(), -MIN_PAST_DAYS);
}

function dayKind(date) {
  return (scheduleKind(date) === "weekend" ? "周末" : "工作日");
}

function badgeText(refDate, nowDate, kindOverride) {
  const sameDay = refDate.getFullYear() === nowDate.getFullYear() && refDate.getMonth() === nowDate.getMonth() && refDate.getDate() === nowDate.getDate();
  const diff = Math.round((dateFromStr(dateStrOf(refDate)) - dateFromStr(dateStrOf(nowDate))) / 86400000);
  const prefix = sameDay ? "" : diff === 1 ? "明日 · " : diff === -1 ? "昨日 · " : "";
  return prefix + (kindOverride || dayKind(refDate));
}

function beijingTodayStr() {
  return toBeijingDateStr(now());
}

function viewDateStr() {
  return state.viewDate || beijingTodayStr();
}

// 「即将开行」实际展示日期：末班后自动切到明日时 displayDate 由 tick 设为明日，
// avail 数据拉取/键都用它，避免显示明日班次却拿今日余票导致错位（售罄/旧值）。
function displayDateStr() {
  return state.displayDate || viewDateStr();
}

function dateStrOf(date) {
  return new Date(date.getTime() + 8 * 3600 * 1000).toISOString().slice(0, 10);
}

function dateFromStr(s) {
  return new Date(s + "T12:00:00+08:00");
}

function fmtDateLabel(s) {
  const today = beijingTodayStr();
  if (s === today) return "今日";
  const d = dateFromStr(s);
  const t = dateFromStr(today);
  const diffDays = Math.round((d - t) / 86400000);
  const wk = ["日", "一", "二", "三", "四", "五", "六"][d.getDay()];
  if (diffDays === 1) return `明日 · 周${wk}`;
  if (diffDays === -1) return `昨日 · 周${wk}`;
  return `${s.slice(5).replace("-", "/")} · 周${wk}`;
}

function goToDate(dateStr) {
  if (!dateStr) return;
  state.viewDate = dateStr;
  setAvailDate(dateStr);
  state.upcomingSig = "";
  state.fidsSig = "";
  state.historySig = "";
  renderDateNav();
  tick();
}

function backToday() {
  state.viewDate = null;
  setAvailDate(beijingTodayStr());
  state.upcomingSig = "";
  state.fidsSig = "";
  state.historySig = "";
  renderDateNav();
  tick();
}

function shiftViewDate(delta) {
  goToDate(shiftDateStr(viewDateStr(), delta));
}

function renderDateNav() {
  const s = viewDateStr();
  const today = beijingTodayStr();
  dom.dateLabel.textContent = fmtDateLabel(s);
  dom.datePrev.disabled = s <= minPastStr();
  dom.dateNext.disabled = s >= maxFutureStr();
  dom.dateLabel.title = state.viewDate ? "点击打开日期选择器（回车返回今日）" : "点击打开日期选择器";
  if (dom.datePicker) {
    dom.datePicker.value = s;
    dom.datePicker.min = minPastStr();
    dom.datePicker.max = maxFutureStr();
  }
}

function bindDateNav() {
  dom.datePrev.addEventListener("click", () => shiftViewDate(-1));
  dom.dateNext.addEventListener("click", () => shiftViewDate(1));
  dom.dateLabel.addEventListener("click", () => {
    const p = dom.datePicker;
    if (!p) { backToday(); return; }
    p.value = viewDateStr();
    if (p.showPicker) p.showPicker();
    else p.focus();
  });
  dom.dateLabel.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    backToday();
  });
  if (dom.datePicker) {
    dom.datePicker.addEventListener("change", () => {
      if (dom.datePicker.value) goToDate(dom.datePicker.value);
    });
  }
}

function initAvailBridge() {
  initAvail((data) => {
    const today = beijingTodayStr();
    if (!data) {
      state.traffic = null;
    } else {
      const d = data.date || today;
      // 批量数据只「填补缺失」，不覆盖已存在的逐车精确值：
      // 逐车接口带 date+route+dep 实时拉取（最新），批量 live 缓存可能残缺/过期，
      // 若用批量完全重建 availMap 会清掉逐车已填的值 → 该班次余票「消失」。
      const map = state.availMap || new Map();
      for (const t of data.trips || []) {
        const k = `${d}|${t.route}|${t.dep}`;
        if (!map.has(k)) map.set(k, t);
      }
      state.availMap = map;
      state.traffic = d === today ? data.traffic : null;
      if (data.scheduleKind) state.scheduleKindByDate.set(d, data.scheduleKind);
      // 未来日期：缓存源站实车 trips（列表驱动）；历史日期：缓存快照 + 满载率统计
      if (d > today && Array.isArray(data.trips)) state.futureTrips.set(d, data.trips);
      if (d < today) state.history = { date: d, trips: data.trips || [], stats: data.stats || null };
    }
    renderTraffic();
    state.upcomingSig = "";
    state.fidsSig = "";
    state.historySig = "";
    tick();
  });
}

// 彩虹巴士实车余座（/api/rainbow）：键 `${serviceDate}|${route}|${dep}`，供主屏彩虹卡 + PIDS 使用。
function initRainbowBridge() {
  initRainbow((data) => {
    const map = new Map();
    for (const t of (data && data.trips) || []) {
      if (!t || !t.boardRoute || !t.dep) continue;
      map.set(`${t.serviceDate}|${t.boardRoute}|${t.dep}`, t);
    }
    state.rainbowMap = map;
    state.upcomingSig = "";
    state.fidsSig = "";
    tick();
  });
}

// 展示日班次列表：今日=静态时刻表；未来=源站实车（未发布则空）；历史=空（交给历史面板）。
function viewTripsFor(dateStr) {
  const today = beijingTodayStr();
  if (dateStr === today) return activeTrips(dateFromStr(dateStr));
  if (dateStr > today) {
    const raw = state.futureTrips.get(dateStr);
    if (!Array.isArray(raw) || raw.length === 0) return [];
    return raw.map((t) => ({ ...t, id: `f-${t.route}-${t.dep}-${t.id || "x"}` }));
  }
  return [];
}

function renderTraffic() {
  const t = state.traffic;
  const badge = dom.trafficBadge;
  if (!badge) return;
  if (!t || !t.dir) {
    badge.hidden = true;
    return;
  }
  const arrow = t.dir === "up" ? "▲" : "▼";
  const label = t.dir === "up" ? "客流较同期升高" : "客流较同期降低";
  badge.hidden = false;
  badge.textContent = `${arrow} 今日客流 ${t.delta} · ${label}`;
  badge.classList.toggle("traffic-badge--red", t.color === "red");
  badge.classList.toggle("traffic-badge--green", t.color === "green");
}

// 高德路况数据龄提示：实时数据存在 fwd/rev 任一时显示「更新于 HH:MM · N 分钟前」，否则隐藏
function renderTrafficNote(now) {
  const note = dom.trafficLiveNote;
  if (!note) return;
  const live = state.trafficLive;
  if (live && live.available && live.dirs && (live.dirs.fwd || live.dirs.rev) && typeof live.fetchedAt === "number") {
    const ageMin = Math.max(1, Math.round((now - live.fetchedAt) / 60000));
    note.textContent = `路况更新于 ${formatHM(new Date(live.fetchedAt))} · ${ageMin} 分钟前`;
    note.hidden = false;
  } else {
    note.hidden = true;
  }
}

// 高德跳转按钮实时耗时：`良乡 → 中关村(54分)`（半角括号 + 分钟，超 1 小时仍用分钟，不加「时」）。
// 与路况条同源同新鲜度（realtimeDurMin 过期/无数据 → 回退纯文字）。
const AMAP_BTN_ROUTES = ["a", "c"];

function renderAmapDuration() {
  const n = now();
  for (let i = 0; i < dom.amapButtons.length; i++) {
    const btn = dom.amapButtons[i];
    if (!btn) continue;
    const route = AMAP_BTN_ROUTES[i];
    if (!route) continue;
    if (!btn.dataset.baseLabel) btn.dataset.baseLabel = btn.textContent.trim();
    const base = btn.dataset.baseLabel;
    const dur = realtimeDurMin(state.trafficLive, route, n);
    const label = dur != null ? `${base}(${Math.round(dur)}分)` : base;
    if (btn.textContent !== label) btn.textContent = label;
  }
}

function activeTripsForNow() {
  const date = new Date(now());
  const todayTrips = activeTrips(date);
  const HIDE_AFTER_MS = 10 * 60000;
  const lastDepMs = todayTrips.reduce((mx, t) => Math.max(mx, depToMs(t.dep, date)), 0);
  if (lastDepMs > 0 && date.getTime() >= lastDepMs + HIDE_AFTER_MS) {
    const tomorrow = new Date(date);
    tomorrow.setDate(tomorrow.getDate() + 1);
    return { trips: activeTrips(tomorrow), refDate: tomorrow };
  }
  return { trips: todayTrips, refDate: date };
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

/* ===== Theme ===== */
function applyTheme(theme) {
  const safe = ["system", "light", "dark"].includes(theme) ? theme : "system";
  document.documentElement.dataset.theme = safe;
  localStorage.setItem("shuttle-theme", safe);
}

function bindTheme() {
  dom.themeSelect.value = state.theme;
  applyTheme(state.theme);
  dom.themeSelect.addEventListener("change", (e) => {
    state.theme = e.target.value;
    applyTheme(state.theme);
  });
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if (state.theme === "system") applyTheme("system");
  });
}

/* ===== View switch: main ⇄ PIDS (#/PIDS) ===== */
function isFidsPath() {
  const h = location.hash.replace(/^#\/?/, "").toLowerCase();
  return h === "fids" || h === "pids";
}

function isDesktopDevice() {
  const fine = window.matchMedia && matchMedia("(hover: hover) and (pointer: fine)").matches;
  const ua = navigator.userAgent || "";
  const ipadLike = /iPad/i.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const androidPad = /Android/i.test(ua) && navigator.maxTouchPoints > 1;
  return fine && !ipadLike && !androidPad;
}

function bindAmapQr() {
  const btnFwd = dom.amapButtons[0];
  const btnRev = dom.amapButtons[1];
  const qr = dom.amapQr;
  if (!qr || !btnFwd || !btnRev) return;
  const fwdItem = qr.querySelector('[data-qr="fwd"]');
  const revItem = qr.querySelector('[data-qr="rev"]');
  const close = () => {
    qr.classList.remove("amap-qr--open");
    document.removeEventListener("click", onDocClick);
  };
  function onDocClick(e) {
    if (!qr.contains(e.target) && !dom.amapButtons.includes(e.target)) close();
  }
  function open(target) {
    if (fwdItem) fwdItem.hidden = target !== "fwd";
    if (revItem) revItem.hidden = target !== "rev";
    qr.classList.add("amap-qr--open");
    document.addEventListener("click", onDocClick);
  }
  btnFwd.addEventListener("click", (e) => {
    if (!isDesktopDevice()) return;
    e.preventDefault();
    if (qr.classList.contains("amap-qr--open") && fwdItem && !fwdItem.hidden) {
      close();
      return;
    }
    open("fwd");
  });
  btnRev.addEventListener("click", (e) => {
    if (!isDesktopDevice()) return;
    e.preventDefault();
    if (qr.classList.contains("amap-qr--open") && revItem && !revItem.hidden) {
      close();
      return;
    }
    open("rev");
  });
}

function applyView() {
  const fids = isFidsPath();
  dom.viewMain.hidden = fids;
  dom.viewFids.hidden = !fids;
  for (const btn of dom.viewSwitchBtns) {
    const active = btn.dataset.view === (fids ? "fids" : "main");
    btn.classList.toggle("view-switch__btn--active", active);
    btn.setAttribute("aria-pressed", String(active));
  }
  if (fids) state.fidsAutoScroll = true;
}

function bindViewSwitch() {
  for (const btn of dom.viewSwitchBtns) {
    btn.addEventListener("click", () => {
      const target = btn.dataset.view === "fids" ? "#/PIDS" : "#/";
      if (location.hash === target || (target === "#/" && location.hash === "")) return;
      location.hash = target;
      applyView();
      tick();
    });
  }
  window.addEventListener("hashchange", () => {
    applyView();
    tick();
  });
}

function initCheckpointStrip() {}

/* ===== Clock sync (time correctness, badge removed) ===== */
async function initClockSync() {
  await syncClock();
  setInterval(async () => {
    await syncClock();
  }, 15 * 60 * 1000);
}

/* ===== Running track: per-corridor lanes (main 良乡⇄中关村 + 西山 中关村⇄西山) ===== */
function laneFor(trip) {
  return dom.corridorContainer.querySelector(`[data-lane="${trip.route}"]`);
}

function toggleBusActive(el) {
  const wasActive = el.classList.contains("bus-marker--active");
  document.querySelectorAll(".bus-marker--active").forEach((m) => m.classList.remove("bus-marker--active"));
  if (!wasActive) el.classList.add("bus-marker--active");
}

function makeBusMarker(trip, now) {
  const lane = laneFor(trip);
  if (!lane) return null;
  const el = document.createElement("div");
  el.className = "bus-marker";
  el.dataset.id = trip.id;
  el.innerHTML = `
    <span class="bus-marker__tip" aria-hidden="true"></span>
    <span class="bus-marker__pill">
      <span class="bus-marker__emoji" aria-hidden="true">🚌</span>
      <span class="bus-marker__time" data-role="time">${escapeHtml(trip.dep)}</span>
    </span>
    <span class="bus-marker__tooltip" data-role="tooltip"></span>
  `;
  updateBusMarker(el, trip, now);
  let tapPointerId = null;
  let tapStartX = 0;
  let tapStartY = 0;
  let tapHandledByPointer = false;
  el.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse") return;
    tapPointerId = e.pointerId;
    tapStartX = e.clientX;
    tapStartY = e.clientY;
    tapHandledByPointer = false;
    if (el.setPointerCapture) {
      try { el.setPointerCapture(e.pointerId); } catch (_) {}
    }
  });
  el.addEventListener("pointerup", (e) => {
    if (e.pointerType === "mouse" || e.pointerId !== tapPointerId) return;
    const dx = e.clientX - tapStartX;
    const dy = e.clientY - tapStartY;
    tapHandledByPointer = true;
    if (dx * dx + dy * dy < 100) {
      toggleBusActive(el);
    }
    tapPointerId = null;
    if (el.releasePointerCapture && el.hasPointerCapture && el.hasPointerCapture(e.pointerId)) {
      try { el.releasePointerCapture(e.pointerId); } catch (_) {}
    }
  });
  el.addEventListener("pointercancel", () => {
    tapPointerId = null;
    tapHandledByPointer = false;
  });
  el.addEventListener("click", (e) => {
    e.stopPropagation();
    if (tapHandledByPointer) {
      tapHandledByPointer = false;
      return;
    }
    toggleBusActive(el);
  });
  lane.appendChild(el);
  return el;
}

function updateBusMarker(el, trip, now) {
  const p = markerProgress(trip, state.trafficLive, now) * 100;
  const left = fwdTrip(trip) ? p : 100 - p;
  el.style.left = `${left}%`;
  const remaining = trip.arrMs - now;
  const dest = ROUTE_DEST[trip.route];
  const tip = el.querySelector('[data-role="tooltip"]');
  tip.textContent = `往${dest} · 剩余 ${formatDurationLabel(remaining)}`;
  const time = el.querySelector('[data-role="time"]');
  time.textContent = trip.dep;
}

// 渲染 lane 内圆角细条（路况色带）与检查点小圆点（分段 node，不附文字）
function renderLaneRail(lane, rid) {
  const rail = lane.querySelector("[data-rail]");
  const cps = lane.querySelector("[data-cps]");
  if (rail) {
    // 与 ETA 注入同口径：仅数据新鲜（≤TRAFFIC_STALE_MS）时显示路况色带，过期/无数据保持透明
    const fresh = realtimeDurMin(state.trafficLive, rid, Date.now()) != null;
    const seg = fresh ? trafficForRoute(state.trafficLive, rid) : null;
    rail.style.background = seg ? laneGradient(seg.segments, rid) : "";
  }
  if (!cps) return;
  cps.textContent = "";
  const points = CHECKPOINTS[rid];
  if (!Array.isArray(points)) return;
  const fwd = FWD.has(rid);
  for (const cp of points) {
    const dot = document.createElement("span");
    dot.className = "lane-cp";
    dot.title = checkpointLabel(cp);
    dot.style.left = `${fwd ? cp.pos * 100 : (1 - cp.pos) * 100}%`;
    cps.appendChild(dot);
  }
}

function renderTrack(all, now) {
  const running = all.filter((t) => t.status === "running");
  const anyRunning = running.length > 0;

  for (const corridor of CORRIDORS) {
    const block = dom.corridorContainer.querySelector(`[data-corridor="${corridor.id}"]`);
    if (!block) continue;
    const corridorTrips = running.filter((t) => t.route === corridor.fwd || t.route === corridor.rev);
    const hasBus = corridorTrips.length > 0;

    for (const rid of [corridor.fwd, corridor.rev]) {
      const lane = block.querySelector(`[data-lane="${rid}"]`);
      renderLaneRail(lane, rid);
      const trips = corridorTrips.filter((t) => t.route === rid);
      const current = [...lane.querySelectorAll(".bus-marker")];
      const currentIds = new Set(current.map((el) => el.dataset.id));
      const wantIds = new Set(trips.map((t) => t.id));
      for (const el of current) {
        if (!wantIds.has(el.dataset.id)) el.remove();
      }
      for (const trip of trips) {
        if (!currentIds.has(trip.id)) {
          makeBusMarker(trip, now);
        } else {
          const el = lane.querySelector(`.bus-marker[data-id="${trip.id}"]`);
          updateBusMarker(el, trip, now);
        }
      }
    }
    block.hidden = !hasBus;
  }
  dom.trackMainEmpty.hidden = anyRunning;
}

/* ===== Detail toggle: force show-all + expand per-trip list ===== */
function bindDetailToggle() {
  dom.detailToggle.addEventListener("click", () => {
    state.showAll = !state.showAll;
    dom.trackMain.classList.toggle("show-all", state.showAll);
    dom.runningDetail.hidden = !state.showAll;
    dom.detailToggle.setAttribute("aria-expanded", String(state.showAll));
    dom.detailToggle.textContent = state.showAll ? "隐藏全部开行详情" : "显示全部开行详情";
  });
}

/* ===== Running detail list ===== */
// 运行详情检查点顺序：fwd 保持数据序（良乡→中关村）；rev 反转成同一方向（京良→杜家坎→六里桥），箭头随方向
function tripCpList(trip) {
  const cps = CHECKPOINTS[trip.route] || [];
  return FWD.has(trip.route) ? cps : [...cps].reverse();
}

function runningItemHtml(trip, now) {
  const rainbowTag = trip.rainbow ? '<span class="tag">🌈 彩虹班车</span>' : "";
  const elapsed = now - trip.depMs;
  const remaining = trip.arrMs - now;
  const pct = Math.round(trip.progress * 100);
  const cpMeta = tripCpList(trip);
  const cps = checkpointTimes(trip, cpMeta);
  const cpArrow = FWD.has(trip.route) ? "→" : "←";
  const cpLine = cps.length
    ? `<div class="running-item__cp" data-role="checkpoints">${cps.map((cp, i) => {
        const passed = now >= cp.ms;
        const meta = cpMeta[i] || {};
        const name = meta.name ? escapeHtml(meta.name) : escapeHtml(cp.label);
        const suffix = meta.note ? `<span class="running-item__cp-suffix">${escapeHtml(meta.note)}</span>` : "";
        return `<span class="running-item__cp-item${passed ? " is-passed" : ""}">${name}${suffix}<small>${escapeHtml(formatHM(new Date(cp.ms)))}</small></span>${i < cps.length - 1 ? `<span class="running-item__cp-arrow">${cpArrow}</span>` : ""}`;
      }).join("")}</div>`
    : "";
return `
    <li class="running-item" data-id="${trip.id}" data-route="${trip.route}" data-rainbow="${trip.rainbow}" style="--pct:${pct}%">
      <div class="running-item__pulse" aria-hidden="true"></div>
      <div class="running-item__head">
        <span class="running-item__time">${escapeHtml(trip.dep)}</span>
        <span class="running-item__route">${escapeHtml(ROUTE_LABEL[trip.route])}</span>
        ${rainbowTag}
        <span class="running-item__meta"><span data-role="pct">${pct}%</span> · 已行 ${escapeHtml(formatDurationLabel(elapsed))}</span>
      </div>
      <div class="running-item__foot">
        <span>预计到达 <b>${escapeHtml(formatHM(new Date(trip.arrMs)))}</b><b class="eta-diff" data-role="eta-diff"></b></span>
        <span data-role="remaining">剩余 ${escapeHtml(formatDurationLabel(remaining))}</span>
      </div>
      ${cpLine}
    </li>
  `;
}

// 运行详情排序：与轨道 lane 一致（中关村发车=rev 在上、良乡出发=fwd 在下，按走廊分组，同方向按开点升序）
function routeRank(r) {
  for (let i = 0; i < CORRIDORS.length; i++) {
    if (r === CORRIDORS[i].rev) return i * 2;
    if (r === CORRIDORS[i].fwd) return i * 2 + 1;
  }
  return CORRIDORS.length * 2;
}

function renderRunningList(all, now) {
  const running = all
    .filter((t) => t.status === "running")
    .sort((a, b) => routeRank(a.route) - routeRank(b.route) || a.depMs - b.depMs);
  const sig = running.map((t) => t.id).join(",");
  const n = running.length;
  dom.runningTitle.textContent = n ? `正在运行 (${n})` : "正在运行";
  dom.detailToggle.hidden = n === 0;
  if (sig !== state.runningSig) {
    state.runningSig = sig;
    dom.runningList.innerHTML = running.map((t) => runningItemHtml(t, now)).join("");
  }
  dom.runningList.querySelectorAll("li").forEach((li) => {
    const trip = all.find((t) => t.id === li.dataset.id);
    if (!trip) return;
    const pct = Math.round(trip.progress * 100);
    const remaining = trip.arrMs - now;
    const pctEl = li.querySelector('[data-role="pct"]');
    const remEl = li.querySelector('[data-role="remaining"]');
    li.style.setProperty("--pct", `${pct}%`);
    if (pctEl) pctEl.textContent = `${pct}%`;
    if (remEl) remEl.textContent = `剩余 ${formatDurationLabel(remaining)}`;
    const cpEls = li.querySelector('[data-role="checkpoints"]');
    if (cpEls) {
      const cps = checkpointTimes(trip, tripCpList(trip));
      cps.forEach((cp, i) => {
        const item = cpEls.querySelectorAll(".running-item__cp-item")[i];
        if (item) item.classList.toggle("is-passed", now >= cp.ms);
      });
    }
    const diffEl = li.querySelector('[data-role="eta-diff"]');
    if (diffEl) {
      const diff = etaDiffMin(trip, DURATION_PROFILES);
      if (diff == null) {
        diffEl.textContent = "";
        diffEl.className = "eta-diff";
      } else {
        diffEl.textContent = diff > 0 ? `+${diff}` : String(diff);
        diffEl.className = `eta-diff ${diff > 0 ? "eta-diff--late" : "eta-diff--early"}`;
      }
    }
  });
}

/* ===== Upcoming list ===== */
function filterUpcoming(all, now) {
  const HIDE_AFTER_MS = 10 * 60000;
  let list = all.filter((t) => t.status === "upcoming" || (t.status === "running" && now < t.depMs + HIDE_AFTER_MS));
  if (state.routeFilter === "norainbow") {
    list = list.filter((t) => !t.rainbow);
  } else if (state.routeFilter !== "all") {
    list = list.filter((t) => t.route === state.routeFilter);
  }
  return list.sort((a, b) => a.depMs - b.depMs);
}

function ticketClass(info) {
  if (info.type === "free") return "ticket--free";
  if (info.type === "rainbow") return "ticket--rainbow";
  return `ticket--${info.phase}`;
}

function priceTagHtml(price) {
  if (price === "¥0.00") return '<span class="tag tag--free">免费</span>';
  return `<span class="tag tag--paid">${escapeHtml(price)}</span>`;
}

function tripItemHtml(trip, now, isNext) {
  const rainbowTag = trip.rainbow ? '<span class="tag">🌈</span>' : "";
  const soon = trip.depMs - now <= 10 * 60000;
  const info = ticketInfo(trip, now);
  return `
    <li class="trip-item${isNext ? " trip-item--next" : ""}" data-id="${trip.id}" data-route="${trip.route}" data-dep="${escapeHtml(trip.dep)}">
<span class="trip-item__row1">
        <span class="trip-item__time">${escapeHtml(trip.dep)}</span>
        ${priceTagHtml(trip.price)}
        <span class="trip-item__ticket ${ticketClass(info)}" data-role="ticket">${escapeHtml(info.label)}</span>
        <span class="trip-item__avail-l" data-role="avail-l" aria-hidden="true"></span>
      </span>
      <span class="trip-item__route">
        ${escapeHtml(ROUTE_LABEL[trip.route])}
        ${rainbowTag}
      </span>
      <span class="trip-item__countdown${soon ? " trip-item__countdown--soon" : ""}" data-role="countdown">—</span>
      <span class="trip-item__avail" data-role="avail"></span>
    </li>
  `;
}

function updateTripAvail(li, trip) {
  const avEl = li.querySelector('[data-role="avail"]');
  const lEl = li.querySelector('[data-role="avail-l"]');
  if (!avEl) return;
  const key = `${displayDateStr()}|${trip.route}|${trip.dep}`;
  const a = state.availMap.get(key) || null;
  const rb = trip.rainbow ? state.rainbowMap.get(key) || null : null;
  // 彩虹优先用实车余座（rainbowAvailText）；无数据回退占位（mainAvailText 对彩虹返回 "--"）
  const view = (rb && rainbowAvailText(rb)) || mainAvailText({ ...trip, avail: a });
  const clearLabel = () => { if (lEl) { lEl.textContent = ""; lEl.className = "trip-item__avail-l"; } };
  if (!view) {
    avEl.textContent = "";
    avEl.className = "trip-item__avail";
    clearLabel();
    return;
  }
  // 占位 "--"（彩虹无数据）：小号灰色，不显示「余」标签与数据龄
  if (view.value === "--") {
    avEl.className = "trip-item__avail avail--none";
    clearLabel();
    avEl.innerHTML = '<span class="trip-item__avail-n">--</span>';
    return;
  }
  avEl.className = view.color ? `trip-item__avail avail--${view.color}` : "trip-item__avail";
  const ageMs = rb ? rainbowAgeMs() : (tripAgeMs(trip.route, trip.dep, displayDateStr()) ?? availAgeMs());
  const ttlText = ageMs == null ? "数据获取中…" : `数据是${Math.max(1, Math.round(ageMs / 60000))}分钟前`;
  // 售罄不显示「余」（置于 row1 行右侧）；数字+数据龄留在 avail 块
  const label = view.value === "售罄" ? "" : "余";
  if (lEl) {
    lEl.textContent = label;
    lEl.className = `trip-item__avail-l${label ? ` avail-l--${view.color}` : ""}`;
  }
  avEl.innerHTML = `<span class="trip-item__avail-n">${view.value}</span><span class="trip-item__avail-ttl">${ttlText}</span>`;
}

function renderList(ul, list, now, highlightNext) {
  const sig = list.map((t) => t.id).join(",");
  const nextId = highlightNext && list.length ? list[0].id : null;
  if (sig !== state.upcomingSig) {
    state.upcomingSig = sig;
    ul.innerHTML = list
      .map((t, i) => tripItemHtml(t, now, nextId === t.id))
      .join("");
  }
  ul.querySelectorAll("li").forEach((li) => {
    const trip = list.find((t) => t.id === li.dataset.id);
    if (!trip) return;
    updateTripAvail(li, trip);
    // 已设置抢票提醒的班次金黄高亮（日期+班次限定）
    li.classList.toggle("trip-item--reminded", hasReminder(viewDateStr(), trip.route, trip.dep));
    const cd = li.querySelector('[data-role="countdown"]');
    if (cd) {
      if (now < trip.depMs) {
        cd.textContent = departureLabel(trip, now);
        cd.classList.toggle("trip-item__countdown--soon", trip.depMs - now <= 10 * 60000);
      } else {
        const relMin = (now - trip.depMs) / 60000;
        const stop = campusStopAt(trip, now, CAMPUS[trip.route]);
        cd.textContent = stop ? stop : "已出发";
        cd.classList.toggle("trip-item__countdown--soon", true);
      }
    }
    const tk = li.querySelector('[data-role="ticket"]');
    if (tk) {
      const info = ticketInfo(trip, now);
      tk.textContent = info.label;
      tk.className = `trip-item__ticket ${ticketClass(info)}`;
    }
  });
}

function renderUpcoming(all, now) {
  const list = filterUpcoming(all, now);
  const routes = ["a", "c", "d", "e"];
  const byRoute = Object.fromEntries(routes.map((id) => [id, []]));
  for (const t of list) {
    if (byRoute[t.route]) byRoute[t.route].push(t);
  }
  const total = list.length;
  const viewDate = displayDateStr();
  const today = beijingTodayStr();
  dom.upcomingEmpty.hidden = !(total === 0 && viewDate >= today);
  if (total === 0 && viewDate >= today) {
    dom.upcomingEmpty.innerHTML = viewDate > today
      ? '<h3>该日班次尚未发布</h3><p>源站实车仅提前约 3 天发布；发布后会自动显示。</p>'
      : '<h3>今天没有更多班次了</h3><p>今日班次均已开行，请明天再来查看。</p>';
  }
  dom.resultsStatus.textContent = `即将开行 ${total} 个班次`;
  const columns = { a: dom.tripColumnA, c: dom.tripColumnC, d: dom.tripColumnD, e: dom.tripColumnE };
  const lists = { a: dom.tripListA, c: dom.tripListC, d: dom.tripListD, e: dom.tripListE };
  for (const id of routes) {
    const trips = byRoute[id];
    columns[id].hidden = trips.length === 0;
    renderList(lists[id], trips, now, true);
  }
  // 逐车拉取余票：仅今日（未来/历史由批量数据直接驱动，避免对未发布日逐车打源站）
  const d = viewDate;
  if (d === today) {
    refreshUpcoming(d, list, (route, dep, tripData) => {
      state.availMap.set(`${d}|${route}|${dep}`, tripData);
      const row = [...dom.tripListA.querySelectorAll(`li[data-route="${route}"][data-dep="${dep}"]`), ...dom.tripListC.querySelectorAll(`li[data-route="${route}"][data-dep="${dep}"]`), ...dom.tripListD.querySelectorAll(`li[data-route="${route}"][data-dep="${dep}"]`), ...dom.tripListE.querySelectorAll(`li[data-route="${route}"][data-dep="${dep}"]`)];
      for (const li of row) updateTripAvail(li, { route, dep });
    });
  }
}

/* ===== Status line ===== */
function renderStatus(all, now) {
  const upcoming = all.filter((t) => t.status === "upcoming").sort((a, b) => a.depMs - b.depMs);
  if (upcoming.length) {
    const next = upcoming[0];
    const diff = next.depMs - now;
    const suffix = diff <= 60000 ? "即将发车" : `约 ${formatDurationLabel(diff)}后发车`;
    dom.nextStatus.innerHTML = `下一班：<strong>${escapeHtml(next.dep)}</strong> ${escapeHtml(ROUTE_LABEL[next.route])} · <strong>${escapeHtml(suffix)}</strong>`;
  } else {
    dom.nextStatus.textContent = "当前时刻表班次已全部开行";
  }
}

/* ===== Filter chips ===== */
function bindChips() {
  dom.routeChips.addEventListener("click", (e) => {
    const chip = e.target.closest(".filter-chip");
    if (!chip) return;
    const route = chip.dataset.route;
    state.routeFilter = route;
    state.upcomingSig = "";
    dom.routeChips.querySelectorAll(".filter-chip").forEach((c) => {
      const active = c.dataset.route === route;
      c.classList.toggle("filter-chip--active", active);
      c.setAttribute("aria-pressed", String(active));
    });
    const refDate = state.viewDate ? dateFromStr(state.viewDate) : activeTripsForNow().refDate;
    renderUpcoming(computeForDate(viewTripsFor(dateStrOf(refDate)), now(), refDate), now());
  });
}

/* ===== FIDS: 全车次、一行一趟、方向/开点/状态/位置 ===== */
const FIDS_PHASE_CLASS = { wait: "fids-st--wait", urge: "fids-st--urge", dep: "fids-st--dep", arr: "fids-st--arr" };
const FIDS_ROW_GROUP = { wait: "pre", urge: "pre", dep: "run", arr: "done" };
const FIDS_ARROW_L = { c: "←", e: "←" };
const FIDS_ARROW_R = { a: "→", d: "→" };
const FIDS_ROUTE_COLOR = { a: "var(--dir-a)", c: "var(--dir-c)", d: "var(--dir-d)", e: "var(--dir-e)" };

function fidsLocParts(trip, now, checkpoints, campus) {
  const loc = tripLocation(trip, now, checkpoints, campus);
  if (!loc) return { head: "—", note: "", tail: "" };
  // road 态且带收费站后缀：按「前段 + 后缀 + 尾段」拆分——后缀单独成 span（窄屏隐藏），
  // 桌面端三段拼接还原全名原位（距杜家坎收费站 约 8分钟 · 约 5.8km），不再把后缀甩到句尾
  if (loc.kind === "road" && loc.cpNote) {
    const idx = loc.text.indexOf(loc.cpNote);
    if (idx >= 0) {
      return {
        head: loc.text.slice(0, idx),
        note: loc.cpNote,
        tail: loc.text.slice(idx + loc.cpNote.length)
      };
    }
  }
  return { head: loc.text, note: "", tail: "" };
}

function fidsRowHtml(trip, now) {
  const st = fidsStatus(trip, now);
  const group = FIDS_ROW_GROUP[st.phase];
  const pct = st.phase === "dep" ? Math.round(trip.progress * 100) : 0;
  const parts = fidsLocParts(trip, now, CHECKPOINTS[trip.route], CAMPUS[trip.route]);
  return `
    <div class="fids-row fids-row--${group}" data-id="${trip.id}" data-route="${trip.route}" data-rainbow="${trip.rainbow}" data-dep="${escapeHtml(trip.dep)}" style="--pct:${pct}%">
      <span class="fids-row__arrow fids-row__arrow--l" aria-hidden="true">${FIDS_ARROW_L[trip.route] || ""}</span>
      <span class="fids-row__arrow fids-row__arrow--r" aria-hidden="true">${FIDS_ARROW_R[trip.route] || ""}</span>
      <span class="fids-row__dir">${escapeHtml(ROUTE_LABEL[trip.route])}</span>
      <span class="fids-row__dep">${escapeHtml(trip.dep)}</span>
      <span class="fids-row__pct" data-role="fids-pct">—</span>
      <span class="fids-st ${FIDS_PHASE_CLASS[st.phase]}" data-role="fids-status">${escapeHtml(st.label)}</span>
      <span class="fids-row__loc" data-role="fids-loc">
        <span data-role="fids-loc-head">${escapeHtml(parts.head)}</span><span data-role="fids-loc-note">${escapeHtml(parts.note)}</span><span data-role="fids-loc-tail">${escapeHtml(parts.tail)}</span>
      </span>
    </div>
  `;
}

function renderFids(all, now) {
  const list = all.slice().sort((a, b) => a.depMs - b.depMs);
  const sig = list.map((t) => t.id).join(",");
  if (sig !== state.fidsSig) {
    state.fidsSig = sig;
    dom.fidsBody.innerHTML = list.map((t) => fidsRowHtml(t, now)).join("");
  }
  dom.fidsBody.querySelectorAll(".fids-row").forEach((row) => {
    const trip = list.find((t) => t.id === row.dataset.id);
    if (!trip) return;
    const st = fidsStatus(trip, now);
    row.className = `fids-row fids-row--${FIDS_ROW_GROUP[st.phase]}`;
    row.style.setProperty("--pct", `${st.phase === "dep" ? Math.round(trip.progress * 100) : 0}%`);
    const key = `${beijingTodayStr()}|${trip.route}|${trip.dep}`;
    const a = state.availMap.get(key) || null;
    const rb = trip.rainbow ? state.rainbowMap.get(key) || null : null;
    const pv = pidsAvailText({ ...trip, avail: a, rainbowData: rb });
    const pctEl = row.querySelector('[data-role="fids-pct"]');
    if (pctEl) {
      pctEl.textContent = pv.text;
      pctEl.className = `fids-row__pct${pv.color ? ` avail--${pv.color}` : ""}`;
    }
    const el = row.querySelector('[data-role="fids-status"]');
    if (el) {
      el.textContent = st.label;
      el.className = `fids-st ${FIDS_PHASE_CLASS[st.phase]}`;
    }
    const parts = fidsLocParts(trip, now, CHECKPOINTS[trip.route], CAMPUS[trip.route]);
    const locHead = row.querySelector('[data-role="fids-loc-head"]');
    const locNote = row.querySelector('[data-role="fids-loc-note"]');
    const locTail = row.querySelector('[data-role="fids-loc-tail"]');
    if (locHead) locHead.textContent = parts.head;
    if (locNote) locNote.textContent = parts.note;
    if (locTail) locTail.textContent = parts.tail;
  });
}

/* ===== PWA: register service worker for install + offline ===== */
function registerSW() {
  if (!("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch((err) => {
      console.warn("SW registration failed:", err);
    });
  });
}

/* ===== Tick loop ===== */
function computeForDate(trips, n, refDate) {
  const injected = trips.map((t) => {
    const dur = realtimeDurMin(state.trafficLive, t.route, n);
    return dur != null ? { ...t, dur } : t;
  });
  return computeAll(injected, n, DURATION_BY_ROUTE, DURATION_MIN, DURATION_PROFILES, refDate);
}

function tick() {
  const n = now();
  const nowDate = new Date(n);
  const todayStr = beijingTodayStr();
  let display;
  if (state.viewDate) {
    const refDate = dateFromStr(state.viewDate);
    display = { trips: viewTripsFor(state.viewDate), refDate };
  } else {
    display = activeTripsForNow();
  }
  // 记录「即将开行」实际展示日期，供 avail 拉取/键使用（末班后=明日，避免拿今日旧值）
  state.displayDate = display.refDate ? dateStrOf(display.refDate) : null;
  const displayAll = computeForDate(display.trips, n, display.refDate);
  const todayAll = computeForDate(activeTrips(nowDate), n, nowDate);
  dom.clock.textContent = formatClock(nowDate);
  dom.clock.setAttribute("datetime", nowDate.toISOString());
  // 时刻表徽标：源站实车推断优先（调休/节假日），否则静态节假日表
  const dispDateStr = display.refDate ? dateStrOf(display.refDate) : todayStr;
  dom.scheduleBadge.textContent = badgeText(display.refDate, nowDate, state.scheduleKindByDate.get(dispDateStr) || null);
  renderTrack(todayAll, n);
  renderRunningList(todayAll, n);
  renderUpcoming(displayAll, n);
  renderStatus(displayAll, n);
  renderFids(todayAll, n);
  renderHistoryPanel();
  renderTrafficNote(n);
  renderAmapDuration();
  renderDateNav();
  if (state.fidsAutoScroll) {
    autoScrollFids();
    state.fidsAutoScroll = false;
  }
}

/* ===== 历史记录面板：班次 + 余票（历史口径）+ 满载率统计 ===== */
function renderHistoryPanel() {
  const s = viewDateStr();
  const isPast = s < beijingTodayStr();
  dom.historyPanel.hidden = !isPast;
  if (!isPast) return;
  dom.historyPanelTitle.textContent = `历史记录 · ${fmtDateLabel(s)}`;
  const h = state.history;
  if (!h || h.date !== s || !Array.isArray(h.trips)) {
    dom.historyStats.hidden = true;
    dom.historyList.hidden = true;
    dom.historyEmpty.hidden = false;
    dom.historyEmpty.textContent = "当日无快照（源站未采集到该日班次数据，仅保留最近 7 天）。";
    return;
  }
  // 满载率统计（每帧更新，文本便宜）
  const st = h.stats || {};
  const day = st.day || {};
  const cumW = st.cumulative && st.cumulative.weekday ? st.cumulative.weekday : null;
  const cumE = st.cumulative && st.cumulative.weekend ? st.cumulative.weekend : null;
  const pct = (r) => (r == null ? "—" : `${Math.round(r * 100)}%`);
  dom.historyStats.hidden = false;
  dom.historyStats.title = "满载率 = 已售座位 / 总座位（按趟座位加权累计）";
  dom.historyStats.textContent = `当日满载率 ${pct(day.loadRatio)}（${day.tripCount ?? 0} 班）｜累计·工作日 ${pct(cumW && cumW.loadRatio)}（${cumW ? cumW.days : 0}天）｜累计·周末 ${pct(cumE && cumE.loadRatio)}（${cumE ? cumE.days : 0}天）`;
  // 班次列表（仅数据变化时重建）
  const sig = `${s}|${h.trips.length}`;
  dom.historyEmpty.hidden = true;
  if (sig !== state.historySig) {
    state.historySig = sig;
    const rows = h.trips.slice().sort((a, b) => (a.route === b.route ? (a.dep < b.dep ? -1 : 1) : a.route < b.route ? -1 : 1));
    dom.historyList.hidden = rows.length === 0;
    dom.historyList.innerHTML = rows.map((t) => {
      const label = ROUTE_LABEL[t.route] || t.route || "";
      const avail = t.available;
      const hasLoad = t.total != null && t.total > 0 && avail != null;
      const load = hasLoad ? `${Math.round(((t.total - avail) / t.total) * 100)}%` : "—";
      const availTxt = avail == null ? "—" : avail > 0 ? `余${avail}` : "售罄";
      const price = t.price ? `<span class="tag${t.price === "¥0.00" ? " tag--free" : " tag--paid"}">${escapeHtml(t.price)}</span>` : "";
      return `<li class="history-item">
        <span class="history-item__route">${escapeHtml(label)}${price}</span>
        <span class="history-item__dep">${escapeHtml(t.dep)}</span>
        <span class="history-item__avail">${availTxt}</span>
        <span class="history-item__load">${load}</span>
      </li>`;
    }).join("");
  }
}

/* ===== 西山线路 UI 隐藏：ENABLE_XISHAN 关闭时隐藏筛选按钮/D/E列/西山走廊 ===== */
function hideXishanUi() {
  if (ENABLE_XISHAN) return;
  for (const chip of document.querySelectorAll('.filter-chip[data-route="d"], .filter-chip[data-route="e"]')) {
    chip.hidden = true;
  }
  if (dom.tripColumnD) dom.tripColumnD.hidden = true;
  if (dom.tripColumnE) dom.tripColumnE.hidden = true;
  const xishanCorridor = dom.corridorContainer.querySelector('[data-corridor="xishan"]');
  if (xishanCorridor) xishanCorridor.hidden = true;
}

function autoScrollFids() {
  const rows = [...dom.fidsBody.querySelectorAll(".fids-row")];
  if (!rows.length) return;
  let anchor = null;
  for (const r of rows) {
    if (r.classList.contains("fids-row--done")) anchor = r;
  }
  if (!anchor) {
    for (const r of rows) {
      if (r.classList.contains("fids-row--run") || r.classList.contains("fids-row--pre")) { anchor = r; break; }
    }
  }
  (anchor || rows[0]).scrollIntoView({ block: "start" });
}

/* ===== 手动刷新：点击「即将开行」标题（灰闪一次）清缓存重拉余票 + 实时路况 =====
   冷却：5 分钟内不重复触发（localStorage 记录上次刷新时刻）；
   pages.dev 预览域名（domain-suffix 命中）不施冷却，方便开发反复刷新。 */
const REFRESH_COOLDOWN_MS = 5 * 60 * 1000;
const REFRESH_TS_KEY = "bitbus-refresh-ts";

function refreshCooldownEnabled() {
  return !/\.pages\.dev$/i.test(location.hostname);
}

function bindRefreshBtn() {
  const title = document.getElementById("upcomingTitle");
  if (!title) return;
  let flashing = false;
  const flash = () => {
    title.classList.add("upcoming-title--flash");
    if (flashing) return;
    flashing = true;
    setTimeout(() => {
      title.classList.remove("upcoming-title--flash");
      flashing = false;
    }, 350);
  };
  const doRefresh = () => {
    refreshAvailNow();
    refreshTrafficNow();
    refreshRainbowNow();
    state.upcomingSig = "";
    state.fidsSig = "";
    tick();
  };
  const onClick = (e) => {
    if (e.type === "keydown" && e.key !== "Enter" && e.key !== " ") return;
    if (e.type === "keydown") e.preventDefault();
    flash();
    if (refreshCooldownEnabled()) {
      const last = Number(localStorage.getItem(REFRESH_TS_KEY) || 0);
      const now = Date.now();
      if (now - last < REFRESH_COOLDOWN_MS) return; // 冷却中
      localStorage.setItem(REFRESH_TS_KEY, String(now));
    }
    doRefresh();
  };
  title.addEventListener("click", onClick);
  title.addEventListener("keydown", onClick);
}

/* ===== 抢票提醒：点击班次引导 + 顶部设置面板 ===== */
let pendingReminderTrip = null;
let reminderCloseTimer = null;

function clearReminderCloseTimer() {
  if (reminderCloseTimer) {
    clearTimeout(reminderCloseTimer);
    reminderCloseTimer = null;
  }
}

function closeReminderGuide(delayMs) {
  clearReminderCloseTimer();
  const doClose = () => {
    dom.reminderGuide.hidden = true;
    reminderCloseTimer = null;
  };
  if (delayMs > 0) {
    reminderCloseTimer = setTimeout(doClose, delayMs);
  } else {
    doClose();
  }
}

function promptReminder(trip) {
  markAsked(); // 引导只询问一次（此后不再弹「触发了抢票提醒」）
  pendingReminderTrip = trip;
  dom.reminderGuideText.textContent = "你刚刚触发了「添加抢票提醒功能」，是否要保留此功能？";
  dom.reminderGuideYes.hidden = false;
  dom.reminderGuideNo.hidden = false;
  dom.reminderGuideHint.textContent = "";
  dom.reminderGuide.hidden = false;
}

// 首次引导「是」→ 显示方式选择；非 PWA 隐藏 PWA/两者选项
function showReminderMethods() {
  const pwa = isPwa();
  dom.reminderGuideYes.hidden = true;
  dom.reminderGuideNo.hidden = true;
  dom.reminderGuideHint.textContent = "";
  if (dom.reminderGuideMethodPwa) dom.reminderGuideMethodPwa.hidden = !pwa;
  if (dom.reminderGuideMethodBoth) dom.reminderGuideMethodBoth.hidden = !pwa;
  dom.reminderGuideMethods.hidden = false;
}

// 生成 ICS 与导出文件名（班车.MMDD.HHMM.<hash4>.ics）
function icsFor(trip, dateStr) {
  const routeLabel = ROUTE_LABEL[trip.route];
  return {
    ics: buildReminderIcs({ routeLabel, dep: trip.dep, dateStr }),
    filename: buildReminderFilename({ dateStr, dep: trip.dep })
  };
}

// 执行提醒：calendar/both → ICS（非 iOS Safari 下载后弹打开日历提示）；pwa/both → PWA 通知
async function applyReminder(trip, method, dateStr) {
  const effective = method === "both" || method === "pwa" || method === "calendar" ? method : "calendar";
  let message = "";
  try {
    if (effective === "calendar" || effective === "both") {
      const { ics, filename } = icsFor(trip, dateStr);
      downloadIcs(ics, filename);
      setReminder(dateStr, trip.route, trip.dep, effective === "both" ? "both" : "calendar");
      message = "已添加到日历（开售前 3 分钟提醒）";
      if (!isIosSafari() && !icsHintDismissed()) {
        showIcsHint();
      }
    }
    if (effective === "pwa" || effective === "both") {
      if (isPwa()) {
        const granted = await ensureNotificationPermission();
        if (granted) {
          schedulePwaNotify({ routeLabel: ROUTE_LABEL[trip.route], dep: trip.dep, dateStr, offsetMin: DEFAULT_OFFSET_MIN });
          setReminder(dateStr, trip.route, trip.dep, "pwa");
          message = "已设置 PWA 提醒（开售前 3 分钟通知）";
        } else {
          const { ics, filename } = icsFor(trip, dateStr);
          downloadIcs(ics, filename);
          setReminder(dateStr, trip.route, trip.dep, "calendar");
          message = "通知权限被拒绝，已回退为添加到日历";
          if (!isIosSafari() && !icsHintDismissed()) showIcsHint();
        }
      } else {
        const { ics, filename } = icsFor(trip, dateStr);
        downloadIcs(ics, filename);
        setReminder(dateStr, trip.route, trip.dep, "calendar");
        message = "需安装到主屏幕才支持 PWA 提醒，已回退为添加到日历";
        if (!isIosSafari() && !icsHintDismissed()) showIcsHint();
      }
    }
  } catch (err) {
    console.warn("applyReminder failed:", err);
    message = "设置提醒失败，请稍后重试";
  }
  dom.reminderGuideMethods.hidden = true;
  if (dom.reminderGuide.hidden) {
    // 直接设置路径（一次性引导之外）：弹出结果反馈 1.6s，避免「点了没反应」
    dom.reminderGuideText.textContent = message || "已更新提醒设置";
    dom.reminderGuideHint.textContent = "";
    dom.reminderGuide.hidden = false;
  } else {
    dom.reminderGuideHint.textContent = message;
  }
  closeReminderGuide(1600);
  state.upcomingSig = "";
  tick();
}

// 非 iOS Safari：.ics 下载后弹「通过日历打开」提示
function showIcsHint() {
  dom.reminderIcsHint.hidden = false;
}
function closeIcsHint() {
  dom.reminderIcsHint.hidden = true;
}

// 点击班次：已设→取消（金黄移除）；未设→按默认方式设置（首次先问）
function handleTripReminderClick(trip, dateStr) {
  const already = hasReminder(dateStr, trip.route, trip.dep);
  if (already) {
    unsetReminder(dateStr, trip.route, trip.dep);
    dom.reminderGuideText.textContent = "已取消该班次的抢票提醒。";
    dom.reminderGuideYes.hidden = true;
    dom.reminderGuideNo.hidden = true;
    dom.reminderGuideMethods.hidden = true;
    dom.reminderGuideHint.textContent = "";
    dom.reminderGuide.hidden = false;
    closeReminderGuide(1400);
    state.upcomingSig = "";
    tick();
    return;
  }
  const pref = readPref();
  if (!hasBeenAsked()) {
    promptReminder(trip); // 首次：询问 1 次并记住
    return;
  }
  // 已询问过：启用则按默认方式直接设置；未启用（设置之后不提醒）→ 点击无反应
  if (!pref.askedOnce) return;
  applyReminder(trip, pref.method, dateStr);
}

function renderReminderSettings() {
  const pref = readPref();
  dom.reminderEnabled.checked = pref.askedOnce;
  dom.reminderMethodCalendar.checked = pref.method === "calendar";
  dom.reminderMethodPwa.checked = pref.method === "pwa";
  dom.reminderMethodBoth.checked = pref.method === "both";
  const pwa = isPwa();
  dom.reminderMethodPwa.disabled = !pwa;
  dom.reminderMethodBoth.disabled = !pwa;
  dom.reminderMethodPwaWrap.classList.toggle("is-disabled", !pwa);
  dom.reminderMethodBothWrap.classList.toggle("is-disabled", !pwa);
  dom.reminderSettingsHint.textContent = pwa ? "" : "未安装为 PWA，PWA 提醒不可用";
}

function bindTripReminder() {
  const container = document.getElementById("tripColumns");
  if (!container) return;
  container.addEventListener("click", (e) => {
    const li = e.target.closest("li.trip-item");
    if (!li) return;
    if (e.target.closest("a, button, .trip-item__avail")) return;
    handleTripReminderClick({ route: li.dataset.route, dep: li.dataset.dep }, viewDateStr());
  });
}

function bindReminderGuide() {
  dom.reminderGuideYes.addEventListener("click", () => showReminderMethods());
  dom.reminderGuideNo.addEventListener("click", () => {
    savePref({ askedOnce: false, method: readPref().method });
    dom.reminderGuideYes.hidden = false;
    dom.reminderGuideNo.hidden = false;
    dom.reminderGuideHint.textContent = "已关闭；可在顶部 🔔 设置提醒中重新开启";
    closeReminderGuide(1600);
  });
  dom.reminderGuideMethods.addEventListener("click", (e) => {
    const btn = e.target.closest(".reminder-method");
    if (!btn || !pendingReminderTrip) return;
    const method = btn.dataset.method;
    savePref({ askedOnce: true, method });
    applyReminder(pendingReminderTrip, method, viewDateStr());
  });
}

function bindReminderSettings() {
  dom.reminderBtn.addEventListener("click", () => {
    renderReminderSettings();
    dom.reminderSettings.hidden = false;
  });
  dom.reminderSettingsClose.addEventListener("click", () => {
    dom.reminderSettings.hidden = true;
  });
  const persist = () => {
    const method = dom.reminderMethodPwa.checked && isPwa() ? "pwa"
      : dom.reminderMethodBoth.checked && isPwa() ? "both"
      : dom.reminderMethodCalendar.checked ? "calendar"
      : "calendar";
    savePref({ askedOnce: dom.reminderEnabled.checked, method });
    renderReminderSettings();
  };
  dom.reminderEnabled.addEventListener("change", persist);
  for (const r of [dom.reminderMethodCalendar, dom.reminderMethodPwa, dom.reminderMethodBoth]) {
    r.addEventListener("change", persist);
  }
}

function bindReminderIcsHint() {
  dom.reminderIcsHintDismiss.addEventListener("click", () => {
    dismissIcsHint();
    closeIcsHint();
  });
  dom.reminderIcsHintClose.addEventListener("click", () => closeIcsHint());
}

function bindReminderOverlay() {
  for (const overlay of [dom.reminderGuide, dom.reminderSettings, dom.reminderIcsHint]) {
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) overlay.hidden = true;
    });
  }
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (!dom.reminderGuide.hidden) dom.reminderGuide.hidden = true;
    if (!dom.reminderSettings.hidden) dom.reminderSettings.hidden = true;
    if (!dom.reminderIcsHint.hidden) dom.reminderIcsHint.hidden = true;
  });
}

// 预取近 7 天历史日期列表（驱动日期选择器可用范围提示）
async function initHistoryDates() {
  try {
    state.historyDates = await fetchHistoryDates();
  } catch {
    state.historyDates = [];
  }
}

/* ===== Init ===== */
hideXishanUi();
bindTheme();
bindViewSwitch();
bindChips();
bindDetailToggle();
bindAmapQr();
bindDateNav();
bindRefreshBtn();
bindTripReminder();
bindReminderGuide();
bindReminderSettings();
bindReminderIcsHint();
bindReminderOverlay();
initAvailBridge();
initRainbowBridge();
initHistoryDates();
initTraffic((data) => {
  state.trafficLive = data;
  state.upcomingSig = "";
  state.runningSig = "";
  state.fidsSig = "";
  tick();
});
document.addEventListener("click", () => {
  document.querySelectorAll(".bus-marker--active").forEach((m) => m.classList.remove("bus-marker--active"));
});
initCheckpointStrip();
initClockSync();
registerSW();
if (initQQBrowserGuide()) {
  // QQ 内置浏览器提示优先，避免与 PWA 安装引导同时弹出
} else {
  initInstallGuide();
}
applyView();
tick();
setInterval(tick, 1000);











