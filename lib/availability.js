// 余票数据层：拉取 /api/availability，支持日期切换与按 minTtl 定时刷新。
// 不打扰每秒 tick；数据回调由 app.js 消费。

const MODE_KEY = "shuttle-avail-mode";
const MAX_RETRY_MS = 60000;

let mode = localStorage.getItem(MODE_KEY) || "num";
let currentDate = todayStr();
let timer = null;
let callback = null;
let inFlight = false;

export function getMode() {
  return mode;
}

export function setMode(m) {
  mode = m === "pct" ? "pct" : "num";
  localStorage.setItem(MODE_KEY, mode);
  return mode;
}

export function todayStr(nowMs = Date.now()) {
  return new Date(nowMs + 8 * 3600 * 1000).toISOString().slice(0, 10);
}

export function getDate() {
  return currentDate;
}

export function setDate(d) {
  if (d === currentDate) return;
  currentDate = d;
  fetchNow();
}

export async function fetchAvail(date = currentDate) {
  try {
    const res = await fetch(`/api/availability?date=${date}`);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

function schedule(nextMs) {
  clearTimeout(timer);
  timer = setTimeout(fetchNow, Math.max(10000, Math.min(3600000, nextMs || MAX_RETRY_MS)));
}

async function fetchNow() {
  if (inFlight) return;
  inFlight = true;
  try {
    const data = await fetchAvail(currentDate);
    if (callback) callback(data, currentDate);
    const ttl = data && data.minTtl != null ? data.minTtl * 1000 : MAX_RETRY_MS;
    schedule(ttl);
  } finally {
    inFlight = false;
  }
}

// onData(data, date)：每次拉取成功（含降级 null）都会回调
export function initAvail(cb) {
  callback = cb;
  fetchNow();
  return () => clearTimeout(timer);
}
// 合并：把 avail 挂到 trip 上（按 route+dep）
export function mergeAvail(trip, availMap) {
  if (!availMap) return trip;
  const a = availMap.get(`${trip.route}|${trip.dep}`);
  trip.avail = a || null;
  return trip;
}

// 颜色：按真实余票量（≥15 绿 / 6–14 黄 / ≤5 红，0=售罄红）
export function availColor(available) {
  if (available == null) return "";
  if (available >= 15) return "green";
  if (available >= 6) return "yellow";
  return "red";
}

// 主屏余票文案（数字/百分比切换）；返回 { text, color } 或 null（不显示）
export function mainAvailText(trip, modeNow) {
  const a = trip.avail;
  if (!a) return null;
  if (a.rainbow) return null; // 彩虹不显示任何余量
  if (a.available == null) {
    // 付费 >3h 窗口外：仅开售前显示百分比（无具体数字）
    if (a.paid && a.pct != null) return { text: `${a.pct}%`, color: availColor(a.available) };
    return null;
  }
  if (modeNow === "pct") {
    if (a.pct == null) return { text: "—", color: "" };
    return { text: `${a.pct}%`, color: availColor(a.available) };
  }
  const total = a.total != null ? `/${a.total}` : "";
  return { text: `${a.available}${total}`, color: availColor(a.available) };
}

// PIDS：始终显示整数百分比（Q3）；无则占位
export function pidsAvailText(trip) {
  const a = trip.avail;
  if (!a || a.rainbow || a.pct == null) return { text: "—", color: "" };
  return { text: `${a.pct}%`, color: availColor(a.available) };
}
