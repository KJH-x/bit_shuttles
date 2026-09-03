import { ROUTES, TRIPS_WEEKEND, DURATION_MIN, DURATION_BY_ROUTE, DURATION_PROFILES, isWeekend, activeTrips, CHECKPOINTS } from "./schedule-data.js?v=20260902-4";
import {
  formatClock,
  formatHM,
  formatDurationLabel,
  computeAll,
  ticketInfo,
  departureLabel,
  fidsStatus,
  checkpointTimes,
  checkpointLabel,
  checkpointOffsets
} from "./lib/schedule.js?v=20260902-4";
import { now, syncClock } from "./lib/time.js?v=20260902-4";
import { initInstallGuide } from "./lib/install-guide.js?v=20260902-4";
import { initQQBrowserGuide } from "./lib/qq-guide.js?v=20260902-4";

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
  resultsStatus: document.getElementById("resultsStatus"),
  themeSelect: document.getElementById("themeSelect"),
  routeChips: document.getElementById("routeChips"),
  trackMain: document.getElementById("trackMain"),
  corridorContainer: document.getElementById("corridors"),
  trackMainEmpty: document.getElementById("trackMainEmpty"),
  runningDetail: document.getElementById("runningDetail"),
  detailToggle: document.getElementById("detailToggle"),
  runningList: document.getElementById("runningList"),
  runningHint: document.getElementById("runningHint"),
  checkpointItems: document.getElementById("checkpointItems"),
  fidsStatusEl: document.getElementById("fidsStatus"),
  fidsHint: document.getElementById("fidsHint"),
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
  fidsSig: ""
};

const dayKind = (date) => (isWeekend(date) ? "周末" : "工作日");

function activeTripsForNow() {
  return activeTrips(new Date(now()));
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

/* ===== View switch: main ⇄ FIDS (/FIDS) ===== */
function isFidsPath() {
  const p = location.pathname.replace(/\/+$/, "").toLowerCase();
  return p === "/fids";
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
}

function bindViewSwitch() {
  for (const btn of dom.viewSwitchBtns) {
    btn.addEventListener("click", () => {
      const target = btn.dataset.view === "fids" ? "/FIDS" : "/";
      if (location.pathname === target) return;
      history.pushState({}, "", target);
      applyView();
      tick();
    });
  }
  window.addEventListener("popstate", () => {
    applyView();
    tick();
  });
}

function initCheckpointStrip() {
  if (!dom.checkpointItems) return;
  const cps = CHECKPOINTS.a || [];
  dom.checkpointItems.innerHTML = cps.map((cp) => {
    const off = checkpointOffsets(cps)[cps.indexOf(cp)];
    return `<span class="checkpoint-item">${escapeHtml(checkpointLabel(cp))}<small>·${Math.round(off * 100)}%处</small></span>`;
  }).join("");
}

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
  lane.appendChild(el);
  return el;
}

function updateBusMarker(el, trip, now) {
  const p = trip.progress * 100;
  const left = fwdTrip(trip) ? p : 100 - p;
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
  const anyRunning = running.length > 0;

  for (const corridor of CORRIDORS) {
    const block = dom.corridorContainer.querySelector(`[data-corridor="${corridor.id}"]`);
    if (!block) continue;
    const corridorTrips = running.filter((t) => t.route === corridor.fwd || t.route === corridor.rev);
    const hasBus = corridorTrips.length > 0;

    for (const rid of [corridor.fwd, corridor.rev]) {
      const lane = block.querySelector(`[data-lane="${rid}"]`);
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
      lane.hidden = trips.length === 0;
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
  const fillCls = trip.rainbow ? "running-item__fill--rainbow" : `running-item__fill--${trip.route}`;
  const cps = checkpointTimes(trip, CHECKPOINTS[trip.route]);
  const cpLine = cps.length
    ? `<div class="running-item__cp" data-role="checkpoints">${cps.map((cp, i) => {
        const passed = now >= cp.ms;
        return `<span class="running-item__cp-item${passed ? " is-passed" : ""}">${escapeHtml(cp.label)}<small>${escapeHtml(formatHM(new Date(cp.ms)))}</small></span>${i < cps.length - 1 ? '<span class="running-item__cp-arrow">→</span>' : ""}`;
      }).join("")}</div>`
    : "";
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
      ${cpLine}
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
    <li class="trip-item${isNext ? " trip-item--next" : ""}" data-id="${trip.id}">
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
    </li>
  `;
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
    const cd = li.querySelector('[data-role="countdown"]');
    if (cd) {
      cd.textContent = departureLabel(trip, now);
      cd.classList.toggle("trip-item__countdown--soon", trip.depMs - now <= 10 * 60000);
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
    renderUpcoming(computeAll(activeTripsForNow(), now(), DURATION_BY_ROUTE, DURATION_MIN, DURATION_PROFILES), now());
  });
}

/* ===== FIDS: 全车次、一行一趟、方向/开点/状态 ===== */
const FIDS_PHASE_CLASS = { wait: "fids-st--wait", urge: "fids-st--urge", dep: "fids-st--dep", arr: "fids-st--arr" };
const FIDS_ROW_GROUP = { wait: "pre", urge: "pre", dep: "run", arr: "done" };

function fidsRowHtml(trip, now) {
  const st = fidsStatus(trip, now);
  const group = FIDS_ROW_GROUP[st.phase];
  return `
    <div class="fids-row fids-row--${group}" data-id="${trip.id}">
      <span class="fids-row__dir">${escapeHtml(ROUTE_LABEL[trip.route])}</span>
      <span class="fids-row__dep">${escapeHtml(trip.dep)}</span>
      <span class="fids-st ${FIDS_PHASE_CLASS[st.phase]}" data-role="fids-status">${escapeHtml(st.label)}</span>
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
    const el = row.querySelector('[data-role="fids-status"]');
    if (el) {
      el.textContent = st.label;
      el.className = `fids-st ${FIDS_PHASE_CLASS[st.phase]}`;
    }
  });
  const total = list.length;
  dom.fidsStatusEl.textContent = `共 ${total} 个班次`;
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
function tick() {
  const n = now();
  const all = computeAll(activeTripsForNow(), n, DURATION_BY_ROUTE, DURATION_MIN, DURATION_PROFILES);
  const nowDate = new Date(n);
  dom.clock.textContent = formatClock(nowDate);
  dom.clock.setAttribute("datetime", nowDate.toISOString());
  dom.scheduleBadge.textContent = dayKind(nowDate);
  renderTrack(all, n);
  renderRunningList(all, n);
  renderUpcoming(all, n);
  renderStatus(all, n);
  renderFids(all, n);
}

/* ===== Init ===== */
bindTheme();
bindViewSwitch();
bindChips();
bindDetailToggle();
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




