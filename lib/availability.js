// 余票数据层：拉取 /api/availability，支持日期切换与按 minTtl 定时刷新。
// 不打扰每秒 tick；数据回调由 app.js 消费。

const MAX_RETRY_MS = 60000;

let currentDate = todayStr();
let timer = null;
let callback = null;
let inFlight = false;
let lastFetchAt = 0;

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
    lastFetchAt = Date.now();
    if (callback) callback(data, currentDate);
    const ttl = data && data.minTtl != null ? data.minTtl * 1000 : MAX_RETRY_MS;
    schedule(ttl);
  } finally {
    inFlight = false;
  }
}

// 数据龄（毫秒）：距最近一次成功拉取过去了多久，用于显示「数据是x分钟前」
export function availAgeMs() {
  return lastFetchAt ? Date.now() - lastFetchAt : null;
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

// 主屏余票文案：两行——第一行「余N」（余票数），第二行余票率 pct%。
// 主屏余票：返回 { value, color } 或 null（不显示）。
// value：有余票数时显示数字，否则显示余票率百分比；上方小字行「余」由 updateTripAvail 渲染（颜色跟随 value）
export function mainAvailText(trip) {
  const a = trip.avail;
  if (!a) return null;
  if (a.rainbow) return null; // 彩虹不显示任何余量
  const count = a.available != null && a.available > 0 ? a.available : null;
  const pct = a.pct != null && a.pct > 0 ? a.pct : null;
  if (count == null && pct == null) return null;
  const value = count != null ? `${count}` : `${pct}%`;
  return { value, color: availColor(a.available) };
}

// PIDS：显示满载率（取补：100 − 余票率）；无则占位
export function pidsAvailText(trip) {
  const a = trip.avail;
  if (!a || a.rainbow || a.pct == null) return { text: "—", color: "" };
  return { text: `${100 - a.pct}%`, color: availColor(a.available) };
}
