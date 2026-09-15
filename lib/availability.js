// 余票数据层：逐车请求 + stale-while-revalidate（立刻返回 R2 缓存，过期则后台刷新）。
// 主屏：每辆车单独 /api/availability?route=&dep=，最近班次优先，各自 TTL 刷新。
// PIDS/日期切换：批量 /api/availability?date= 一次拉全量。
// 不打扰每秒 tick；数据更新通过回调通知 app.js。
// 防打爆（v1.36）：调度统一收归 entry.nextAllowedAt 闸门（tick 每秒的 ensureTrip
// 变成零成本 no-op），stale/degraded/失败走 10s→20s→40s→60s 指数退避，
// 页面隐藏暂停全部轮询，列表外班次 entry 超时清扫（杜绝孤儿 timer 永续重拉）。

import { toBeijingDateStr } from "./time.js";
import { isHidden, onVisible } from "./visibility.js";

const MAX_RETRY_MS = 60000;
const MIN_TTL_MS = 3000;   // 最小重拉间隔（避免抖动）
const STALE_BASE_MS = 10000; // stale 退避起点：10s→20s→40s→封顶 60s
const HIDDEN_CHECK_MS = 15000; // 页面隐藏时的轮询休眠步长
const ORPHAN_MS = 10 * 60000; // 不在列表中的班次 entry 保留时长，超时清扫

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
export function tripAgeMs(route, dep, date = currentDate) {
  const e = trips.get(tripKey(route, dep, date));
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

// stale/degraded/失败后的重拉退避：10s→20s→40s→60s 封顶（导出供单测）
export function staleBackoffMs(retries) {
  const step = Math.max(0, Math.min(Number(retries) || 0, 3));
  return Math.min(MAX_RETRY_MS, STALE_BASE_MS * (2 ** step));
}

// 清扫判定（导出供单测）：不在当前列表、非进行中、超过 ORPHAN_MS 未被需要的 entry key
export function orphanKeys(entries, seen, nowMs, orphanMs = ORPHAN_MS) {
  const out = [];
  for (const [key, entry] of entries) {
    if (entry.inflight) continue;
    if (seen.has(key)) continue;
    if (entry.lastSeenAt && nowMs - entry.lastSeenAt < orphanMs) continue;
    out.push(key);
  }
  return out;
}

// 批量（PIDS / 日期切换）
export async function fetchAvail(date = currentDate) {
  return fetchJson(`/api/availability?date=${date}`);
}

// 历史日期列表（近 7 天内有快照的历史日期，供日期选择器）
export async function fetchHistoryDates() {
  const data = await fetchJson(`/api/history/dates`);
  return data && Array.isArray(data.dates) ? data.dates : [];
}

async function bulkFetch() {
  if (inFlightBulk) return;
  if (isHidden()) {
    clearTimeout(bulkTimer);
    bulkTimer = setTimeout(bulkFetch, HIDDEN_CHECK_MS);
    return;
  }
  inFlightBulk = true;
  try {
    const data = await fetchAvail(currentDate);
    lastFetchAt = Date.now();
    if (data && typeof data.dataFetchedAt === "number") lastDataFetchedAt = data.dataFetchedAt;
    if (callback) callback(data, currentDate);
    const ttlSec = data && data.minTtl != null ? data.minTtl : 60;
    // 未来日（服务端日级 TTL=1 天/1 小时）降低轮询频率；今日仍按相位 TTL（≤5 分钟）
    const maxPollMs = ttlSec > 3600 ? 86400 * 1000 : 300000;
    clearTimeout(bulkTimer);
    bulkTimer = setTimeout(bulkFetch, Math.max(MIN_TTL_MS, Math.min(maxPollMs, ttlSec * 1000)));
  } finally {
    inFlightBulk = false;
  }
}

// === 逐车 ===
function tripKey(route, dep, date = currentDate) {
  return `${date}|${route}|${dep}`;
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

// 拉取单趟：写缓存、按统一闸门安排下次刷新。
// 节拍规则：成功且非 stale → 剩余 TTL；stale/degraded/missing/失败 → 指数退避。
// nextAllowedAt 同时约束 timer 与 tick 里的 ensureTrip，重拉节拍不再被 tick 放大到 1/s。
async function pullTrip(route, dep, date, onData) {
  const key = tripKey(route, dep, date);
  const now = Date.now();
  const data = await fetchTrip(route, dep, date);
  lastFetchAt = now;
  const entry = trips.get(key) || {};
  const retries = entry.staleRetries || 0;
  const bad = !data || !data.trips || !data.trips[0] || data.source === "degraded" || data.source === "missing";
  let nextDelayMs;
  if (bad) {
    nextDelayMs = staleBackoffMs(retries);
    entry.staleRetries = retries + 1;
  } else {
    const tripData = data.trips[0];
    const ttlSec = normTtl(data.minTtl);
    if (typeof data.dataFetchedAt === "number") lastDataFetchedAt = data.dataFetchedAt;
    entry.data = tripData;
    entry.ttlSec = ttlSec;
    entry.fetchedAt = now;
    entry.dataFetchedAt = typeof data.dataFetchedAt === "number" ? data.dataFetchedAt : now;
    if (data.source === "stale") {
      entry.staleRetries = retries + 1;
      nextDelayMs = staleBackoffMs(entry.staleRetries);
    } else {
      entry.staleRetries = 0;
      // 刷新节拍按数据真实龄的剩余 TTL：数据已旧则尽快刷新，避免复用过期缓存
      const ageMs = now - (entry.dataFetchedAt || entry.fetchedAt);
      nextDelayMs = Math.max(MIN_TTL_MS, ttlSec * 1000 - ageMs);
    }
    if (onData) onData(route, dep, tripData, data.source);
  }
  entry.nextAllowedAt = now + nextDelayMs;
  trips.set(key, entry);
  clearTimeout(entry.timer);
  entry.timer = setTimeout(() => ensureTrip(route, dep, date, onData), nextDelayMs);
}

// 确保某趟有新鲜数据：新鲜/未到闸门时间/进行中则跳过，否则拉取（inflight 去重）。
export function ensureTrip(route, dep, date = currentDate, onData) {
  const key = tripKey(route, dep, date);
  const entry = trips.get(key);
  if (tripFresh(entry)) return;
  if (entry && entry.inflight) return;
  if (entry && entry.nextAllowedAt && Date.now() < entry.nextAllowedAt) return;
  const rec = entry || {};
  rec.inflight = true;
  rec.lastSeenAt = Date.now();
  trips.set(key, rec);
  pullTrip(route, dep, date, onData).finally(() => {
    const cur = trips.get(key);
    if (cur) cur.inflight = false;
  });
}

// 批量「即将开行」逐车拉取：按 dep 升序（最近班次优先），最多并发 4。
// 尾随清扫：列表外的孤儿 entry（如已开行班次）超时删除，断掉永续 timer 链。
// onData(route, dep, tripData, source)
export function refreshUpcoming(date, list, onData) {
  if (Array.isArray(list) && list.length > 0) {
    const sorted = list.slice().sort((a, b) => (a.depMs || 0) - (b.depMs || 0));
    const seenNow = Date.now();
    for (const t of sorted) {
      const e = trips.get(tripKey(t.route, t.dep, date));
      if (e) e.lastSeenAt = seenNow;
    }
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
  const seen = new Set((Array.isArray(list) ? list : []).map((t) => tripKey(t.route, t.dep, date)));
  for (const key of orphanKeys(trips, seen, Date.now())) {
    const e = trips.get(key);
    if (e) clearTimeout(e.timer);
    trips.delete(key);
  }
}

export function initAvail(cb) {
  callback = cb;
  bulkFetch();
  onVisible(() => {
    for (const e of trips.values()) e.nextAllowedAt = 0;
    clearTimeout(bulkTimer);
    bulkFetch();
  });
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
// 彩虹巴士：恒显示占位 "--"（灰色），不做真实余量展示。
export function mainAvailText(trip) {
  if (trip.rainbow || (trip.avail && trip.avail.rainbow)) return { value: "--", color: "" };
  const a = trip.avail;
  if (!a) return null;
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

// PIDS：显示满载率（取补：100 − 余票率）。
// 彩虹：有实车座位数据（trip.rainbowData）→ 满载率%；无数据 → 🌈；其余无数据 → "--" 占位
export function pidsAvailText(trip) {
  const a = trip.avail;
  if (trip.rainbow || (a && a.rainbow)) {
    const rb = trip.rainbowData;
    if (rb && rb.seatsTotal > 0) {
      const taken = rb.seatsTotal - rb.seatsLeft;
      return { text: `${Math.round((taken / rb.seatsTotal) * 100)}%`, color: availColor(rb.seatsLeft) };
    }
    return { text: "🌈", color: "" };
  }
  if (!a || a.pct == null) return { text: "--", color: "" };
  return { text: `${100 - a.pct}%`, color: availColor(a.available) };
}
