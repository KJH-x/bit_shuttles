// 余票数据层：逐车请求 + stale-while-revalidate（立刻返回 R2 缓存，过期则后台刷新）。
// 主屏：每辆车单独 /api/availability?route=&dep=，最近班次优先，各自 TTL 刷新。
// PIDS/日期切换：批量 /api/availability?date= 一次拉全量。
// 不打扰每秒 tick；数据更新通过回调通知 app.js。

import { toBeijingDateStr } from "./time.js";

const MAX_RETRY_MS = 60000;
const MIN_TTL_MS = 3000;   // 最小重拉间隔（避免抖动）
const STALE_RETRY_MS = 2500; // 命中 stale 后短延时重拉，拿后台刷新完的新值

let currentDate = todayStr();
let callback = null;
let inFlightBulk = false;
let bulkTimer = null;
let lastFetchAt = 0;      // 最近一次成功响应的请求时刻
let lastDataFetchedAt = 0; // 最近一次数据「真实抓取时间」（服务端 dataFetchedAt；R2 命中=缓存写入时间）

// 逐车缓存：key = route|dep
const trips = new Map(); // { data, ttlSec, fetchedAt, dataFetchedAt, timer, inflight }

export function todayStr(nowMs = Date.now()) {
  return toBeijingDateStr(nowMs);
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

// 数据龄（毫秒）：以「服务端数据真实抓取时间」为基准（R2 命中=缓存写入时间，
// 非前端请求时刻）；无 dataFetchedAt 时回退最近请求时刻。
export function availAgeMs() {
  const base = lastDataFetchedAt || lastFetchAt;
  return base ? Date.now() - base : null;
}

// 单趟数据龄（优先用该车自己的数据抓取时间）
export function tripAgeMs(route, dep) {
  const e = trips.get(`${route}|${dep}`);
  const base = e && e.dataFetchedAt ? e.dataFetchedAt : (e && e.fetchedAt ? e.fetchedAt : 0);
  return base ? Date.now() - base : availAgeMs();
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
  return Math.max(10, Math.min(300, Math.round(t)));
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
    if (data && typeof data.dataFetchedAt === "number") lastDataFetchedAt = data.dataFetchedAt;
    if (callback) callback(data, currentDate);
    const ttl = data && data.minTtl != null ? data.minTtl * 1000 : MAX_RETRY_MS;
    clearTimeout(bulkTimer);
    bulkTimer = setTimeout(bulkFetch, Math.max(MIN_TTL_MS, Math.min(300000, ttl)));
  } finally {
    inFlightBulk = false;
  }
}

// === 逐车 ===
function tripKey(route, dep) {
  return `${route}|${dep}`;
}

// 数据新鲜度：以「服务端数据真实抓取时间 dataFetchedAt」为基准，
// 而非前端请求时刻 fetchedAt——R2 缓存返回旧数据时前端必须判定为不新鲜，
// 从而重新拉取，避免长期复用过期缓存（如「售罄但数据945分钟前」永不刷新）。
function tripFresh(entry) {
  const base = entry && entry.data && (entry.dataFetchedAt || entry.fetchedAt);
  return base ? Date.now() - base < entry.ttlSec * 1000 : false;
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
  if (typeof data.dataFetchedAt === "number") lastDataFetchedAt = data.dataFetchedAt;
  const tripData = data.trips && data.trips[0] ? data.trips[0] : null;
  if (!tripData) return;
  const ttlSec = normTtl(data.minTtl);
  const entry = trips.get(key) || {};
  entry.data = tripData;
  entry.ttlSec = ttlSec;
  entry.fetchedAt = Date.now();
  entry.dataFetchedAt = typeof data.dataFetchedAt === "number" ? data.dataFetchedAt : entry.fetchedAt;
  trips.set(key, entry);
  clearTimeout(entry.timer);
  // 刷新节拍按数据真实龄的剩余 TTL：数据已旧则立即刷新，避免复用过期缓存
  const ageMs = Date.now() - (entry.dataFetchedAt || entry.fetchedAt);
  const delayMs = Math.max(MIN_TTL_MS, (entry.ttlSec * 1000) - ageMs);
  entry.timer = setTimeout(() => ensureTrip(route, dep, date, onData), delayMs);
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
// value：有余票数时显示数字；仅余票率时显示百分比；售罄（bookable≤0，含窗口外 available=null）显示「售罄」。
export function mainAvailText(trip) {
  const a = trip.avail;
  if (!a) return null;
  if (a.rainbow) return null; // 彩虹不显示任何余量
  // 售罄判定用 bookable（原始余票，可为负）而非 available：
  // 窗口外 available=null 但 pct=0 的售罄班次也应显示「售罄」而非消失
  const soldOut = a.total > 0 && (a.available === 0 || (a.bookable != null && a.bookable <= 0));
  if (soldOut) return { value: "售罄", color: availColor(0) };
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
