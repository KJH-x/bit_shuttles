// 余票数据层：逐车请求 + stale-while-revalidate（立刻返回 R2 缓存，过期则后台刷新）。
// 主屏：每辆车单独 /api/availability?route=&dep=，最近班次优先，各自 TTL 刷新。
// PIDS/日期切换：批量 /api/availability?date= 一次拉全量。
// 不打扰每秒 tick；数据更新通过回调通知 app.js。

const MAX_RETRY_MS = 60000;
const MIN_TTL_MS = 3000;   // 最小重拉间隔（避免抖动）
const STALE_RETRY_MS = 2500; // 命中 stale 后短延时重拉，拿后台刷新完的新值

let currentDate = todayStr();
let callback = null;
let inFlightBulk = false;
let bulkTimer = null;
let lastFetchAt = 0;

// 逐车缓存：key = route|dep
const trips = new Map(); // { data, ttlSec, fetchedAt, timer, inflight }

export function todayStr(nowMs = Date.now()) {
  return new Date(nowMs + 8 * 3600 * 1000).toISOString().slice(0, 10);
}

export function getDate() {
  return currentDate;
}

export function setDate(d) {
  if (d === currentDate) return;
  currentDate = d;
  trips.forEach((t) => clearTimeout(t.timer));
  trips.clear();
  bulkFetch();
}

// 数据龄（毫秒）：距最近一次成功拉取过去多久，用于「数据是x分钟前」
export function availAgeMs() {
  return lastFetchAt ? Date.now() - lastFetchAt : null;
}

// 单趟数据龄（优先用该车自己的拉取时间）
export function tripAgeMs(route, dep) {
  const e = trips.get(`${route}|${dep}`);
  return e && e.fetchedAt ? Date.now() - e.fetchedAt : availAgeMs();
}

async function fetchJson(url) {
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

function normTtl(minTtl) {
  const t = Number(minTtl);
  if (!Number.isFinite(t) || t <= 0) return 60;
  return Math.max(10, Math.min(3600, Math.round(t)));
}

// === 批量（PIDS / 日期切换）===
export async function fetchAvail(date = currentDate) {
  return fetchJson(`/api/availability?date=${date}`);
}

async function bulkFetch() {
  if (inFlightBulk) return;
  inFlightBulk = true;
  try {
    const data = await fetchAvail(currentDate);
    lastFetchAt = Date.now();
    if (callback) callback(data, currentDate);
    const ttl = data && data.minTtl != null ? data.minTtl * 1000 : MAX_RETRY_MS;
    clearTimeout(bulkTimer);
    bulkTimer = setTimeout(bulkFetch, Math.max(MIN_TTL_MS, Math.min(3600000, ttl)));
  } finally {
    inFlightBulk = false;
  }
}

// === 逐车 ===
function tripKey(route, dep) {
  return `${route}|${dep}`;
}

function tripFresh(entry) {
  return entry && entry.data && entry.fetchedAt && Date.now() - entry.fetchedAt < entry.ttlSec * 1000;
}

async function fetchTrip(route, dep, date = currentDate) {
  return fetchJson(`/api/availability?date=${date}&route=${encodeURIComponent(route)}&dep=${encodeURIComponent(dep)}`);
}

// 拉取单趟：写缓存、安排下次刷新；若服务端返回 stale，短延时后再拉一次拿新值。
async function pullTrip(route, dep, date, onData) {
  const key = tripKey(route, dep);
  const data = await fetchTrip(route, dep, date);
  if (!data) return;
  lastFetchAt = Date.now();
  const tripData = data.trips && data.trips[0] ? data.trips[0] : null;
  if (!tripData) return;
  const ttlSec = normTtl(data.minTtl);
  const entry = trips.get(key) || {};
  entry.data = tripData;
  entry.ttlSec = ttlSec;
  entry.fetchedAt = Date.now();
  trips.set(key, entry);
  clearTimeout(entry.timer);
  entry.timer = setTimeout(() => ensureTrip(route, dep, date, onData), Math.max(MIN_TTL_MS, ttlSec * 1000));
  if (onData) onData(route, dep, tripData, data.source);
  // stale：后台已在刷新 R2，稍等后重拉新值
  if (data.source === "stale") {
    clearTimeout(entry.timer);
    entry.timer = setTimeout(() => ensureTrip(route, dep, date, onData), STALE_RETRY_MS);
  }
}

// 确保某趟有新鲜数据：新鲜则跳过；过期/无则拉取（inflight 去重）。
export function ensureTrip(route, dep, date = currentDate, onData) {
  const key = tripKey(route, dep);
  const entry = trips.get(key);
  if (tripFresh(entry)) return;
  if (entry && entry.inflight) return;
  const rec = entry || {};
  rec.inflight = true;
  trips.set(key, rec);
  pullTrip(route, dep, date, onData).finally(() => {
    const cur = trips.get(key);
    if (cur) cur.inflight = false;
  });
}

// 批量「即将开行」逐车拉取：按 dep 升序（最近班次优先），最多并发 4。
// onData(route, dep, tripData, source)
export function refreshUpcoming(date, list, onData) {
  if (!Array.isArray(list) || list.length === 0) return;
  const sorted = list.slice().sort((a, b) => (a.depMs || 0) - (b.depMs || 0));
  let idx = 0;
  let inflight = 0;
  const CHUNK = 4;
  const step = () => {
    while (inflight < CHUNK && idx < sorted.length) {
      const t = sorted[idx++];
      inflight++;
      ensureTrip(t.route, t.dep, date, (route, dep, data, source) => {
        inflight--;
        if (onData) onData(route, dep, data, source);
        step();
      });
    }
  };
  step();
}

export function initAvail(cb) {
  callback = cb;
  bulkFetch();
  return () => clearTimeout(bulkTimer);
}

// 用户点「刷新」：清空全部本地缓存（含进行中标记），立即重拉批量数据；
// 逐车缓存由下次 renderUpcoming 的 ensureTrip 自动重建（本地已清，必然重新 fetch）。
export function refreshNow() {
  for (const e of trips.values()) {
    clearTimeout(e.timer);
    e.data = null;
    e.inflight = false;
    e.timer = null;
  }
  trips.clear();
  lastFetchAt = 0;
  inFlightBulk = false;
  clearTimeout(bulkTimer);
  bulkFetch();
}

// 颜色：按真实余票量（≥15 绿 / 6–14 黄 / ≤5 红，0=售罄红）
export function availColor(available) {
  if (available == null) return "";
  if (available >= 15) return "green";
  if (available >= 6) return "yellow";
  return "red";
}

// 主屏余票：返回 { value, color } 或 null（不显示）。
// value：有余票数时显示数字；仅余票率时显示百分比；售罄（available=0）显示「售罄」。
export function mainAvailText(trip) {
  const a = trip.avail;
  if (!a) return null;
  if (a.rainbow) return null; // 彩虹不显示任何余量
  if (a.available === 0 && a.total > 0) return { value: "售罄", color: availColor(0) };
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
