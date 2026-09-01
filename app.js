import { ROUTES, TRIPS, DURATION_MIN, DURATION_BY_ROUTE, DURATION_PROFILES } from "./schedule-data.js";
import {
  formatClock,
  formatHM,
  formatDurationLabel,
  computeAll,
  ticketInfo
} from "./lib/schedule.js";
import { now, syncClock, getSyncState } from "./lib/time.js";

const ROUTE_LABEL = Object.fromEntries(ROUTES.map((r) => [r.id, r.label]));
const ROUTE_DEST = { a: "中关村", c: "良乡" };

const dom = {
  clock: document.getElementById("liveClock"),
  syncBadge: document.getElementById("syncBadge"),
  nextStatus: document.getElementById("nextStatus"),
  resultsStatus: document.getElementById("resultsStatus"),
  themeSelect: document.getElementById("themeSelect"),
  routeChips: document.getElementById("routeChips"),
  trackMain: document.getElementById("trackMain"),
  laneA: document.getElementById("laneA"),
  laneC: document.getElementById("laneC"),
  trackMainEmpty: document.getElementById("trackMainEmpty"),
  runningDetail: document.getElementById("runningDetail"),
  detailToggle: document.getElementById("detailToggle"),
  runningList: document.getElementById("runningList"),
  runningHint: document.getElementById("runningHint"),
  tripList: document.getElementById("tripList"),
  upcomingEmpty: document.getElementById("upcomingEmpty")
};

const state = {
  theme: localStorage.getItem("shuttle-theme") || "system",
  routeFilter: "all",
  showAll: false,
  runningSig: "",
  upcomingSig: ""
};

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

/* ===== Clock sync badge ===== */
function renderSyncBadge() {
  const s = getSyncState();
  if (!s.synced) {
    dom.syncBadge.hidden = false;
    dom.syncBadge.textContent = "使用本机时间";
    dom.syncBadge.className = "sync-badge sync-badge--err";
    dom.syncBadge.title = "未能同步网络时间，使用本机时钟";
    return;
  }
  dom.syncBadge.hidden = false;
  const src = s.source === "akamai" ? "Akamai CDN" : "TimeAPI";
  dom.syncBadge.textContent = "网络时间已同步";
  dom.syncBadge.className = "sync-badge sync-badge--ok";
  dom.syncBadge.title = `同步源：${src} · 偏差 ${Math.round(s.offsetMs / 1000)}s · ${new Date(s.lastSync).toLocaleTimeString("zh-CN")}`;
}

async function initClockSync() {
  await syncClock();
  renderSyncBadge();
  setInterval(async () => {
    await syncClock();
    renderSyncBadge();
  }, 15 * 60 * 1000);
}

/* ===== Running track: two lanes (a: 良乡→中关村 left→right, c: 中关村→良乡 right→left) ===== */
function makeBusMarker(trip, now) {
  const lane = trip.route === "a" ? dom.laneA : dom.laneC;
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
  lane.appendChild(el);
  return el;
}

function updateBusMarker(el, trip, now) {
  const p = trip.progress * 100;
  const left = trip.route === "a" ? p : 100 - p;
  el.style.left = `${left}%`;
  const remaining = trip.arrMs - now;
  const dest = ROUTE_DEST[trip.route];
  const tip = el.querySelector('[data-role="tooltip"]');
  tip.textContent = `往${dest} · 剩余 ${formatDurationLabel(remaining)}`;
  const time = el.querySelector('[data-role="time"]');
  time.textContent = trip.dep;
}

function renderTrack(all, now) {
  const running = all.filter((t) => t.status === "running");
  const aRunning = running.filter((t) => t.route === "a");
  const cRunning = running.filter((t) => t.route === "c");

  for (const [lane, trips] of [[dom.laneA, aRunning], [dom.laneC, cRunning]]) {
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
  dom.trackMainEmpty.hidden = running.length > 0;
  dom.laneA.hidden = aRunning.length === 0;
  dom.laneC.hidden = cRunning.length === 0;
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
  const fillCls = trip.rainbow ? "running-item__fill--rainbow" : `running-item__fill--${trip.route}`;
  return `
    <li class="running-item" data-id="${trip.id}">
      <div class="running-item__head">
        <span class="running-item__time">${escapeHtml(trip.dep)}</span>
        <span class="running-item__route">${escapeHtml(ROUTE_LABEL[trip.route])}</span>
        ${rainbowTag}
        <span class="running-item__meta"><span data-role="pct">${pct}%</span> · 已行 ${escapeHtml(formatDurationLabel(elapsed))}</span>
      </div>
      <div class="running-item__bar" aria-hidden="true">
        <div class="running-item__fill ${fillCls}" data-role="fill" style="width:${pct}%"></div>
      </div>
      <div class="running-item__foot">
        <span>预计到达 <b>${escapeHtml(formatHM(new Date(trip.arrMs)))}</b></span>
        <span data-role="remaining">剩余 ${escapeHtml(formatDurationLabel(remaining))}</span>
      </div>
    </li>
  `;
}

function renderRunningList(all, now) {
  const running = all.filter((t) => t.status === "running");
  const sig = running.map((t) => t.id).join(",");
  dom.runningHint.textContent = running.length
    ? `当前 ${running.length} 个班次在运行，进度按预计耗时实时推算`
    : "暂无班车在运行，下方列出即将开行的班次";
  if (sig !== state.runningSig) {
    state.runningSig = sig;
    dom.runningList.innerHTML = running.map((t) => runningItemHtml(t, now)).join("");
  }
  dom.runningList.querySelectorAll("li").forEach((li) => {
    const trip = all.find((t) => t.id === li.dataset.id);
    if (!trip) return;
    const pct = Math.round(trip.progress * 100);
    const remaining = trip.arrMs - now;
    const fill = li.querySelector('[data-role="fill"]');
    const pctEl = li.querySelector('[data-role="pct"]');
    const remEl = li.querySelector('[data-role="remaining"]');
    if (fill) fill.style.width = `${pct}%`;
    if (pctEl) pctEl.textContent = `${pct}%`;
    if (remEl) remEl.textContent = `剩余 ${formatDurationLabel(remaining)}`;
  });
}

/* ===== Upcoming list ===== */
function filterUpcoming(all) {
  let list = all.filter((t) => t.status === "upcoming");
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
    <li class="trip-item${isNext ? " trip-item--next" : ""}" data-id="${trip.id}">
      <span class="trip-item__time">${escapeHtml(trip.dep)}</span>
      <span class="trip-item__route">
        <span class="trip-item__arrow" aria-hidden="true">↔</span>
        ${escapeHtml(ROUTE_LABEL[trip.route])}
        ${rainbowTag}
      </span>
      ${priceTagHtml(trip.price)}
      <span class="trip-item__ticket ${ticketClass(info)}" data-role="ticket">${escapeHtml(info.label)}</span>
      <span class="trip-item__countdown${soon ? " trip-item__countdown--soon" : ""}" data-role="countdown">—</span>
    </li>
  `;
}

function renderUpcoming(all, now) {
  const list = filterUpcoming(all);
  const sig = list.map((t) => t.id).join(",");
  dom.upcomingEmpty.hidden = list.length > 0;
  dom.resultsStatus.textContent = `即将开行 ${list.length} 个班次`;
  if (sig !== state.upcomingSig) {
    state.upcomingSig = sig;
    dom.tripList.innerHTML = list
      .map((t, i) => tripItemHtml(t, now, i === 0))
      .join("");
  }
  dom.tripList.querySelectorAll("li").forEach((li) => {
    const trip = list.find((t) => t.id === li.dataset.id);
    if (!trip) return;
    const cd = li.querySelector('[data-role="countdown"]');
    if (cd) {
      const diff = trip.depMs - now;
      cd.textContent = diff <= 0 ? "即将发车" : `${formatDurationLabel(diff)}后`;
    }
    const tk = li.querySelector('[data-role="ticket"]');
    if (tk) {
      const info = ticketInfo(trip, now);
      tk.textContent = info.label;
      tk.className = `trip-item__ticket ${ticketClass(info)}`;
    }
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
    dom.nextStatus.textContent = "今日班次已全部开行";
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
    renderUpcoming(computeAll(TRIPS, now(), DURATION_BY_ROUTE, DURATION_MIN, DURATION_PROFILES), now());
  });
}

/* ===== Tick loop ===== */
function tick() {
  const n = now();
  const all = computeAll(TRIPS, n, DURATION_BY_ROUTE, DURATION_MIN, DURATION_PROFILES);
  const nowDate = new Date(n);
  dom.clock.textContent = formatClock(nowDate);
  dom.clock.setAttribute("datetime", nowDate.toISOString());
  renderTrack(all, n);
  renderRunningList(all, n);
  renderUpcoming(all, n);
  renderStatus(all, n);
}

/* ===== Init ===== */
bindTheme();
bindChips();
bindDetailToggle();
initClockSync();
tick();
setInterval(tick, 1000);
