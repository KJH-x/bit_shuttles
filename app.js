import { ROUTES, TRIPS, DURATION_MIN, DURATION_BY_ROUTE } from "./schedule-data.js";
import {
  formatClock,
  formatHM,
  formatDurationLabel,
  computeAll
} from "./lib/schedule.js";

const ROUTE_LABEL = Object.fromEntries(ROUTES.map((r) => [r.id, r.label]));

const dom = {
  clock: document.getElementById("liveClock"),
  nextStatus: document.getElementById("nextStatus"),
  resultsStatus: document.getElementById("resultsStatus"),
  themeSelect: document.getElementById("themeSelect"),
  routeChips: document.getElementById("routeChips"),
  trackMainLine: document.getElementById("trackMainLine"),
  trackMainEmpty: document.getElementById("trackMainEmpty"),
  trackSecondary: document.getElementById("trackSecondary"),
  trackSecondaryLine: document.getElementById("trackSecondaryLine"),
  runningList: document.getElementById("runningList"),
  runningHint: document.getElementById("runningHint"),
  tripList: document.getElementById("tripList"),
  upcomingEmpty: document.getElementById("upcomingEmpty")
};

const state = {
  theme: localStorage.getItem("shuttle-theme") || "system",
  routeFilter: "all",
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

/* ===== Running track (bidirectional shared) ===== */
function makeBusElement(trip, now) {
  const el = document.createElement("div");
  el.className = `route-track__bus ${trip.route === "c" ? "route-track__bus--c" : ""}`;
  el.dataset.id = trip.id;
  el.innerHTML = `
    <span class="route-track__bus-time">${escapeHtml(trip.dep)}${trip.route === "c" ? " ←" : " →"}</span>
    <span class="route-track__bus-dot" aria-hidden="true"></span>
  `;
  updateBusPosition(el, trip, now);
  return el;
}

function updateBusPosition(el, trip, now) {
  const p = trip.progress * 100;
  let left;
  if (trip.route === "c") {
    left = 100 - p;
  } else if (trip.route === "a") {
    left = p;
  } else {
    left = p;
  }
  el.style.left = `${left}%`;
}

function renderMainTrack(all, now) {
  const running = all.filter((t) => t.status === "running" && (t.route === "a" || t.route === "c"));
  const current = [...dom.trackMainLine.querySelectorAll(".route-track__bus")];
  const currentIds = new Set(current.map((el) => el.dataset.id));
  const wantIds = new Set(running.map((t) => t.id));

  for (const el of current) {
    if (!wantIds.has(el.dataset.id)) el.remove();
  }
  for (const trip of running) {
    if (!currentIds.has(trip.id)) {
      dom.trackMainLine.appendChild(makeBusElement(trip, now));
    } else {
      const el = dom.trackMainLine.querySelector(`.route-track__bus[data-id="${trip.id}"]`);
      updateBusPosition(el, trip, now);
    }
  }
  dom.trackMainEmpty.hidden = running.length > 0;
}

function renderSecondaryTrack(all, now) {
  const running = all.filter((t) => t.status === "running" && t.route === "b");
  dom.trackSecondary.hidden = running.length === 0;
  if (running.length === 0) return;
  const current = [...dom.trackSecondaryLine.querySelectorAll(".route-track__bus")];
  const currentIds = new Set(current.map((el) => el.dataset.id));
  for (const el of current) {
    if (!running.some((t) => t.id === el.dataset.id)) el.remove();
  }
  for (const trip of running) {
    if (!currentIds.has(trip.id)) {
      dom.trackSecondaryLine.appendChild(makeBusElement(trip, now));
    } else {
      const el = dom.trackSecondaryLine.querySelector(`.route-track__bus[data-id="${trip.id}"]`);
      updateBusPosition(el, trip, now);
    }
  }
}

/* ===== Running detail list ===== */
function runningItemHtml(trip) {
  const rainbowTag = trip.rainbow ? '<span class="tag">🌈 彩虹班车</span>' : "";
  const elapsed = Date.now() - trip.depMs;
  const remaining = trip.arrMs - Date.now();
  const pct = Math.round(trip.progress * 100);
  return `
    <li class="running-item" data-id="${trip.id}">
      <div class="running-item__head">
        <span class="running-item__time">${escapeHtml(trip.dep)}</span>
        <span class="running-item__route">${escapeHtml(ROUTE_LABEL[trip.route])}</span>
        ${rainbowTag}
        <span class="running-item__meta"><span data-role="pct">${pct}%</span> · 已行 ${escapeHtml(formatDurationLabel(elapsed))}</span>
      </div>
      <div class="running-item__bar" aria-hidden="true">
        <div class="running-item__fill ${trip.rainbow ? "running-item__fill--rainbow" : ""}" data-role="fill" style="width:${pct}%"></div>
      </div>
      <div class="running-item__foot">
        <span>预计到达 <b>${escapeHtml(formatHM(new Date(trip.arrMs)))}</b></span>
        <span data-role="remaining">剩余 ${escapeHtml(formatDurationLabel(remaining))}</span>
      </div>
    </li>
  `;
}

function renderRunningList(all) {
  const running = all.filter((t) => t.status === "running");
  const sig = running.map((t) => t.id).join(",");
  dom.runningHint.textContent = running.length
    ? `当前 ${running.length} 个班次在运行，进度按预计耗时实时推算`
    : "暂无班车在运行，下方列出即将开行的班次";
  if (sig !== state.runningSig) {
    state.runningSig = sig;
    dom.runningList.innerHTML = running.map(runningItemHtml).join("");
  }
  dom.runningList.querySelectorAll("li").forEach((li) => {
    const trip = all.find((t) => t.id === li.dataset.id);
    if (!trip) return;
    const pct = Math.round(trip.progress * 100);
    const remaining = trip.arrMs - Date.now();
    const elapsed = DURATION_MIN * 60000 - remaining;
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
  if (state.routeFilter === "rainbow") {
    list = list.filter((t) => t.rainbow);
  } else if (state.routeFilter !== "all") {
    list = list.filter((t) => t.route === state.routeFilter);
  }
  return list.sort((a, b) => a.depMs - b.depMs);
}

function priceTagHtml(price) {
  if (price === "¥0.00") return '<span class="tag tag--free">免费</span>';
  return `<span class="tag tag--paid">${escapeHtml(price)}</span>`;
}

function tripItemHtml(trip, isNext) {
  const rainbowTag = trip.rainbow ? '<span class="tag">🌈</span>' : "";
  const soon = trip.depMs - Date.now() <= 10 * 60000;
  return `
    <li class="trip-item${isNext ? " trip-item--next" : ""}" data-id="${trip.id}">
      <span class="trip-item__time">${escapeHtml(trip.dep)}</span>
      <span class="trip-item__route">
        <span class="trip-item__arrow" aria-hidden="true">↔</span>
        ${escapeHtml(ROUTE_LABEL[trip.route])}
        ${rainbowTag}
      </span>
      ${priceTagHtml(trip.price)}
      <span class="trip-item__countdown${soon ? " trip-item__countdown--soon" : ""}" data-role="countdown">—</span>
    </li>
  `;
}

function renderUpcoming(all) {
  const list = filterUpcoming(all);
  const sig = list.map((t) => t.id).join(",");
  dom.upcomingEmpty.hidden = list.length > 0;
  dom.resultsStatus.textContent = `即将开行 ${list.length} 个班次`;
  if (sig !== state.upcomingSig) {
    state.upcomingSig = sig;
    dom.tripList.innerHTML = list
      .map((t, i) => tripItemHtml(t, i === 0))
      .join("");
  }
  dom.tripList.querySelectorAll("li").forEach((li) => {
    const trip = list.find((t) => t.id === li.dataset.id);
    if (!trip) return;
    const cd = li.querySelector('[data-role="countdown"]');
    if (!cd) return;
    const diff = trip.depMs - Date.now();
    cd.textContent = diff <= 0 ? "即将发车" : `${formatDurationLabel(diff)}后`;
  });
}

/* ===== Status line ===== */
function renderStatus(all, now) {
  const upcoming = all.filter((t) => t.status === "upcoming").sort((a, b) => a.depMs - b.depMs);
  if (upcoming.length) {
    const next = upcoming[0];
    const diff = next.depMs - now;
    dom.nextStatus.innerHTML = `下一班：<strong>${escapeHtml(next.dep)}</strong> ${escapeHtml(ROUTE_LABEL[next.route])} · 约 <strong>${escapeHtml(formatDurationLabel(diff))}</strong>后发车`;
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
    renderUpcoming(computeAll(TRIPS, Date.now(), DURATION_BY_ROUTE, DURATION_MIN));
  });
}

/* ===== Tick loop ===== */
function tick() {
  const now = Date.now();
  const all = computeAll(TRIPS, now, DURATION_BY_ROUTE, DURATION_MIN);
  const nowDate = new Date(now);
  dom.clock.textContent = formatClock(nowDate);
  dom.clock.setAttribute("datetime", nowDate.toISOString());
  renderMainTrack(all, now);
  renderSecondaryTrack(all, now);
  renderRunningList(all);
  renderUpcoming(all);
  renderStatus(all, now);
}

/* ===== Init ===== */
bindTheme();
bindChips();
tick();
setInterval(tick, 1000);
