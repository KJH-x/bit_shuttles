import { ROUTES, TRIPS_WEEKEND, DURATION_MIN, DURATION_BY_ROUTE, DURATION_PROFILES, isWeekend, activeTrips, CHECKPOINTS, CAMPUS, ENABLE_XISHAN } from "./schedule-data.js?v=20260904-13";
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
  campusStopAt
} from "./lib/schedule.js?v=20260904-13";
import { now, syncClock } from "./lib/time.js?v=20260904-13";
import { initInstallGuide } from "./lib/install-guide.js?v=20260904-13";
import { initQQBrowserGuide } from "./lib/qq-guide.js?v=20260904-13";
import {
  initAvail,
  setDate as setAvailDate,
  refreshUpcoming,
  refreshNow as refreshAvailNow,
  mainAvailText,
  pidsAvailText,
  tripAgeMs,
  availAgeMs
} from "./lib/availability.js?v=20260904-13";
import { initTraffic, refreshTrafficNow, trafficForRoute, realtimeDurMin, markerProgress, laneGradient } from "./lib/traffic.js?v=20260904-13";

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
  fidsAutoScroll: false,
  viewDate: null, // null=跟随真实今天；否则 'YYYY-MM-DD'
  availMap: new Map(), // `${route}|${dep}` → avail
  traffic: null,
  trafficLive: null
};

function dayKind(date) {
  return (isWeekend(date) ? "周末" : "工作日");
}

function badgeText(refDate, nowDate) {
  const sameDay = refDate.getFullYear() === nowDate.getFullYear() && refDate.getMonth() === nowDate.getMonth() && refDate.getDate() === nowDate.getDate();
  return (sameDay ? "" : "明日 · ") + dayKind(refDate);
}

function beijingTodayStr() {
  return new Date(now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
}

function viewDateStr() {
  return state.viewDate || beijingTodayStr();
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

function shiftViewDate(delta) {
  const d = dateFromStr(viewDateStr());
  d.setDate(d.getDate() + delta);
  state.viewDate = d.toISOString().slice(0, 10);
  setAvailDate(state.viewDate);
  state.upcomingSig = "";
  state.fidsSig = "";
  renderDateNav();
  tick();
}

function renderDateNav() {
  const s = viewDateStr();
  dom.dateLabel.textContent = fmtDateLabel(s);
  dom.dateNext.disabled = s >= beijingTodayStr();
  dom.dateLabel.title = state.viewDate ? "点击返回今日" : "今日";
}

function bindDateNav() {
  dom.datePrev.addEventListener("click", () => shiftViewDate(-1));
  dom.dateNext.addEventListener("click", () => shiftViewDate(1));
  dom.dateLabel.addEventListener("click", () => {
    state.viewDate = null;
    setAvailDate(beijingTodayStr());
    state.upcomingSig = "";
    state.fidsSig = "";
    renderDateNav();
    tick();
  });
}

function initAvailBridge() {
  initAvail((data) => {
    if (!data) {
      state.traffic = null;
    } else {
      const map = new Map();
      const d = data.date || beijingTodayStr();
      for (const t of data.trips || []) map.set(`${d}|${t.route}|${t.dep}`, t);
      state.availMap = map;
      state.traffic = d === beijingTodayStr() ? data.traffic : null;
    }
    renderTraffic();
    state.upcomingSig = "";
    state.fidsSig = "";
    tick();
  });
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
function runningItemHtml(trip, now) {
  const rainbowTag = trip.rainbow ? '<span class="tag">🌈 彩虹班车</span>' : "";
  const elapsed = now - trip.depMs;
  const remaining = trip.arrMs - now;
  const pct = Math.round(trip.progress * 100);
const cps = checkpointTimes(trip, CHECKPOINTS[trip.route]);
  const cpMeta = CHECKPOINTS[trip.route] || [];
  const cpLine = cps.length
    ? `<div class="running-item__cp" data-role="checkpoints">${cps.map((cp, i) => {
        const passed = now >= cp.ms;
        const meta = cpMeta[i] || {};
        const name = meta.name ? escapeHtml(meta.name) : escapeHtml(cp.label);
        const suffix = meta.note ? `<span class="running-item__cp-suffix">${escapeHtml(meta.note)}</span>` : "";
        return `<span class="running-item__cp-item${passed ? " is-passed" : ""}">${name}${suffix}<small>${escapeHtml(formatHM(new Date(cp.ms)))}</small></span>${i < cps.length - 1 ? '<span class="running-item__cp-arrow">→</span>' : ""}`;
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
        <span>预计到达 <b>${escapeHtml(formatHM(new Date(trip.arrMs)))}</b></span>
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
      const cps = checkpointTimes(trip, CHECKPOINTS[trip.route]);
      cps.forEach((cp, i) => {
        const item = cpEls.querySelectorAll(".running-item__cp-item")[i];
        if (item) item.classList.toggle("is-passed", now >= cp.ms);
      });
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
  if (!avEl) return;
  const key = `${viewDateStr()}|${trip.route}|${trip.dep}`;
  const a = state.availMap.get(key) || null;
  const view = mainAvailText({ ...trip, avail: a });
  if (!view) {
    avEl.textContent = "";
    avEl.className = "trip-item__avail";
    return;
  }
  avEl.className = `trip-item__avail avail--${view.color}`;
  const ageMs = tripAgeMs(trip.route, trip.dep) ?? availAgeMs();
  const ttlText = ageMs == null ? "数据获取中…" : `数据是${Math.max(1, Math.round(ageMs / 60000))}分钟前`;
  const label = view.value === "售罄" ? "" : "<span class=\"trip-item__avail-l\">余</span>";
  avEl.innerHTML = `${label}<span class="trip-item__avail-n">${view.value}</span><span class="trip-item__avail-ttl">${ttlText}</span>`;
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
  dom.upcomingEmpty.hidden = total > 0;
  dom.resultsStatus.textContent = `即将开行 ${total} 个班次`;
  const columns = { a: dom.tripColumnA, c: dom.tripColumnC, d: dom.tripColumnD, e: dom.tripColumnE };
  const lists = { a: dom.tripListA, c: dom.tripListC, d: dom.tripListD, e: dom.tripListE };
  for (const id of routes) {
    const trips = byRoute[id];
    columns[id].hidden = trips.length === 0;
    renderList(lists[id], trips, now, true);
  }
  // 逐车拉取余票：最近班次优先；stale-while-revalidate（立刻返缓存，过期后台刷）
  const d = viewDateStr();
  refreshUpcoming(d, list, (route, dep, tripData) => {
    state.availMap.set(`${d}|${route}|${dep}`, tripData);
    const row = [...dom.tripListA.querySelectorAll(`li[data-route="${route}"][data-dep="${dep}"]`), ...dom.tripListC.querySelectorAll(`li[data-route="${route}"][data-dep="${dep}"]`), ...dom.tripListD.querySelectorAll(`li[data-route="${route}"][data-dep="${dep}"]`), ...dom.tripListE.querySelectorAll(`li[data-route="${route}"][data-dep="${dep}"]`)];
    for (const li of row) updateTripAvail(li, { route, dep });
  });
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
    renderUpcoming(computeForDate(activeTrips(refDate), now(), refDate), now());
  });
}

/* ===== FIDS: 全车次、一行一趟、方向/开点/状态/位置 ===== */
const FIDS_PHASE_CLASS = { wait: "fids-st--wait", urge: "fids-st--urge", dep: "fids-st--dep", arr: "fids-st--arr" };
const FIDS_ROW_GROUP = { wait: "pre", urge: "pre", dep: "run", arr: "done" };
const FIDS_ARROW_L = { c: "←", e: "←" };
const FIDS_ARROW_R = { a: "→", d: "→" };
const FIDS_ROUTE_COLOR = { a: "var(--dir-a)", c: "var(--dir-c)", d: "var(--dir-d)", e: "var(--dir-e)" };

function fidsLocText(trip, now) {
  const loc = tripLocation(trip, now, CHECKPOINTS[trip.route], CAMPUS[trip.route]);
  return loc ? loc.text : "—";
}

function fidsRowHtml(trip, now) {
  const st = fidsStatus(trip, now);
  const group = FIDS_ROW_GROUP[st.phase];
  const pct = st.phase === "dep" ? Math.round(trip.progress * 100) : 0;
  return `
    <div class="fids-row fids-row--${group}" data-id="${trip.id}" data-route="${trip.route}" data-dep="${escapeHtml(trip.dep)}" style="--pct:${pct}%">
      <span class="fids-row__arrow fids-row__arrow--l" aria-hidden="true">${FIDS_ARROW_L[trip.route] || ""}</span>
      <span class="fids-row__arrow fids-row__arrow--r" aria-hidden="true">${FIDS_ARROW_R[trip.route] || ""}</span>
      <span class="fids-row__dir">${escapeHtml(ROUTE_LABEL[trip.route])}</span>
      <span class="fids-row__dep">${escapeHtml(trip.dep)}</span>
      <span class="fids-row__pct" data-role="fids-pct">—</span>
      <span class="fids-st ${FIDS_PHASE_CLASS[st.phase]}" data-role="fids-status">${escapeHtml(st.label)}</span>
      <span class="fids-row__loc" data-role="fids-loc">${escapeHtml(fidsLocText(trip, now))}</span>
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
    const pv = pidsAvailText({ ...trip, avail: a });
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
    const loc = row.querySelector('[data-role="fids-loc"]');
    if (loc) loc.textContent = fidsLocText(trip, now);
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
  const display = state.viewDate ? { trips: activeTrips(dateFromStr(state.viewDate)), refDate: dateFromStr(state.viewDate) } : activeTripsForNow();
  const displayAll = computeForDate(display.trips, n, display.refDate);
  const todayAll = computeForDate(activeTrips(nowDate), n, nowDate);
  dom.clock.textContent = formatClock(nowDate);
  dom.clock.setAttribute("datetime", nowDate.toISOString());
  dom.scheduleBadge.textContent = badgeText(display.refDate, nowDate);
  renderTrack(todayAll, n);
  renderRunningList(todayAll, n);
  renderUpcoming(displayAll, n);
  renderStatus(displayAll, n);
  renderFids(todayAll, n);
  renderTrafficNote(n);
  renderDateNav();
  if (state.fidsAutoScroll) {
    autoScrollFids();
    state.fidsAutoScroll = false;
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

/* ===== Init ===== */
hideXishanUi();
bindTheme();
bindViewSwitch();
bindChips();
bindDetailToggle();
bindAmapQr();
bindDateNav();
bindRefreshBtn();
initAvailBridge();
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





