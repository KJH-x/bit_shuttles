// 余票实时查询（Pages Function）。
// 两种模式：
//   1) 逐车：GET /api/availability?date=YYYY-MM-DD&route=a&dep=07:30
//      优先返回 R2 trip 缓存（stale-while-revalidate：过期也立刻返回，同时后台刷新）；
//      无缓存时才同步查源站。最近班次由前端按 dep 升序发起。
//   2) 批量：GET /api/availability?date=YYYY-MM-DD
//      返回 R2 live 缓存（过期也立刻返回 + 后台刷新），供 PIDS/日期切换使用。
// 真实余票 = reservation_num − disable_seat 数（disable 座位不可约，reservation_num 含它们）。

import { host, fetchJson } from "../_shared/school.js";
import {
  beijingNowMs,
  beijingDateStr,
  depToMs,
  paidPhaseTtl,
  freeTtl,
  isVisible,
  applyVisibility,
  minTtl,
  NAME_TO_ROUTE
} from "../_shared/ttl.js";
import {
  writeSnapshot,
  readSnapshot,
  readLiveCache,
  writeLiveCache,
  readMetaCache,
  writeMetaCache,
  readTripCache,
  writeTripCache,
  rollupExpiredSnapshots,
  trafficForToday,
  writeLastFailed
} from "../_shared/history.js";
import { shiftDate } from "../_shared/metrics.js";

const MAX_ATTEMPTS = 3;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DEP_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const MAX_TS_SKEW_MS = 30 * 60000;
const LIVE_DEFAULT_TTL = 60;
const META_TTL = 3600; // get-list 元数据缓存 1h
const ROUTES_OK = new Set(["a", "c", "d", "e"]);

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...extraHeaders }
  });
}

function makeSchoolUrls(path, schemeOrder) {
  return host(schemeOrder).map((h) => h + path);
}

function cacheHeaders(ttl) {
  // 浏览器/边缘一律不缓存：新鲜度由 R2 缓存 + SWR（服务端 waitUntil 后台刷新）保证，
  // 前端每次轮询都打回服务端，避免「刷新不更新、须 Ctrl+F5」的旧缓存问题。
  return { "Cache-Control": "private, no-store" };
}

// 单趟计算：available = reservation_num − disable_seat 数；total = reserved + reservation_num − disable
function computeTrip(row, seatData, nowMs, date, isToday) {
  const route = NAME_TO_ROUTE[row.name];
  if (!route) return null;
  const dep = row.origin_time;
  if (!dep) return null;
  const rainbow = String(row.type) === "1";
  const tMs = depToMs(dep, date);
  const paid = Number(row.teacher_ticket_price ?? 0) > 0;
  const visible = isVisible(nowMs, tMs);
  const { phase, ttl } = paid ? paidPhaseTtl(nowMs, tMs) : { phase: "free", ttl: freeTtl(nowMs, tMs, isToday) };
  const disable = Array.isArray(seatData.disable_seat) ? seatData.disable_seat.length : 0;
  const reserved = Number(seatData.reserved_count ?? 0);
  const rn = Number(seatData.reservation_num ?? 0);
  const bookable = rn - disable; // 真实余票
  const total = reserved + rn - disable; // 可约总座席
  const availableRaw = bookable > 0 ? bookable : 0;
  const available = paid && !visible ? null : availableRaw;
  const pct = availableRaw != null && total > 0 ? Math.round((availableRaw / total) * 100) : null;
  // bookable=原始余票：缓存用，供 applyVisibility 按当前时刻重算可见性（避免窗口跨边界的灰色闪现）
  return { route, dep, name: row.name, paid, rainbow, phase, ttl, visible, available, bookable, total, pct };
}

// 批量刷新今日：get-list + 逐趟 get-reserved-seats → 写 trip 缓存 + live 缓存 + 快照 + 客流
async function refreshAll(env, secret, schemeOrder, date, nowMs, isToday) {
  const bucket = env.AVAIL_BUCKET;
  const enableXishan = String(env.ENABLE_XISHAN || "false") === "true";
  const list = await fetchJson(
    makeSchoolUrls(`/vehicle/get-list?page=1&limit=100&date=${date}`, schemeOrder),
    secret
  );
  const rows = Array.isArray(list.data) ? list.data : [];
  await writeMetaCache(bucket, date, rows);

  const relevant = rows
    .filter((r) => NAME_TO_ROUTE[r.name])
    .filter((r) => String(r.type) !== "1")
    .filter((r) => enableXishan || !["d", "e"].includes(NAME_TO_ROUTE[r.name]))
    .filter((r) => r.origin_time);

  const seatInfo = new Map();
  const CHUNK = 4;
  for (let i = 0; i < relevant.length; i += CHUNK) {
    const chunk = relevant.slice(i, i + CHUNK);
    await Promise.all(
      chunk.map(async (r) => {
        try {
          const seat = await fetchJson(
            makeSchoolUrls(`/vehicle/get-reserved-seats?id=${encodeURIComponent(r.id)}&date=${date}`, schemeOrder),
            secret
          );
          seatInfo.set(r.name + "|" + r.origin_time, seat && seat.data ? seat.data : seat);
        } catch {
          seatInfo.set(r.name + "|" + r.origin_time, null);
        }
      })
    );
  }

  const trips = relevant
    .map((r) => {
      const seat = seatInfo.get(r.name + "|" + r.origin_time);
      if (!seat) return null;
      return computeTrip(r, seat, nowMs, date, isToday);
    })
    .filter(Boolean);

  // 写 trip 缓存
  await Promise.all(
    trips.map((t) => writeTripCache(bucket, date, t.route, t.dep, t))
  );

  // 客流对比
  let traffic = null;
  if (isToday) traffic = await trafficForToday(bucket, beijingDateStr(nowMs), trips);

  const ttlList = trips.map((t) => (t.ttl == null ? null : t.ttl));
  const mTtl = minTtl(ttlList) || LIVE_DEFAULT_TTL;
  await writeLiveCache(bucket, date, { minTtl: mTtl, traffic, trips });

  if (isToday) {
    const snapTrips = trips.map((t) => ({ route: t.route, dep: t.dep, available: t.available, total: t.total }));
    await writeSnapshot(bucket, date, snapTrips);
    await rollupExpiredSnapshots(bucket, beijingDateStr(nowMs));
  }
  return { trips, traffic, mTtl };
}

// 单趟刷新：源站 get-reserved-seats → 写 trip 缓存，返回该趟数据
async function refreshTrip(env, secret, schemeOrder, date, row, nowMs, isToday) {
  const bucket = env.AVAIL_BUCKET;
  const seat = await fetchJson(
    makeSchoolUrls(`/vehicle/get-reserved-seats?id=${encodeURIComponent(row.id)}&date=${date}`, schemeOrder),
    secret
  );
  const seatData = seat && seat.data ? seat.data : seat;
  const trip = computeTrip(row, seatData, nowMs, date, isToday);
  if (trip) await writeTripCache(bucket, date, trip.route, trip.dep, trip);
  return trip;
}

async function getMeta(env, secret, schemeOrder, date, nowMs) {
  const bucket = env.AVAIL_BUCKET;
  const meta = await readMetaCache(bucket, date);
  if (meta && meta.savedAt && nowMs - meta.savedAt < META_TTL * 1000 && Array.isArray(meta.rows)) {
    return meta.rows;
  }
  const list = await fetchJson(
    makeSchoolUrls(`/vehicle/get-list?page=1&limit=100&date=${date}`, schemeOrder),
    secret
  );
  const rows = Array.isArray(list.data) ? list.data : [];
  await writeMetaCache(bucket, date, rows);
  return rows;
}

export async function onRequest({ request, env, waitUntil }) {
  const url = new URL(request.url);
  const dateParam = url.searchParams.get("date");
  const routeParam = url.searchParams.get("route");
  const depParam = url.searchParams.get("dep");
  const date = dateParam && DATE_RE.test(dateParam) ? dateParam : beijingDateStr(Date.now());

  const tsParam = url.searchParams.get("_t");
  if (tsParam) {
    const t = Number(tsParam);
    if (!Number.isFinite(t) || Math.abs(t - beijingNowMs()) > MAX_TS_SKEW_MS) {
      return json({ error: "clock_skew" }, 400);
    }
  }

  const bucket = env.AVAIL_BUCKET;
  const secret = env.SCHOOL_SECRET;
  const schemeOrder = env.SCHOOL_SCHEME_ORDER || "https,http";
  const todayStr = beijingDateStr(Date.now());
  const nowMs = Date.now();
  const isToday = date === todayStr;
  const isPast = date < todayStr;

  // === 历史日期：返回快照 ===
  if (isPast) {
    const snap = await readSnapshot(bucket, date);
    return json(
      { serverNow: nowMs, date, minTtl: 3600, source: "snapshot", traffic: null, trips: snap ? snap.trips : [] },
      200,
      cacheHeaders(3600)
    );
  }

  // === 逐车模式 ===
  if (routeParam && ROUTES_OK.has(routeParam) && depParam && DEP_RE.test(depParam)) {
    // 无缓存才同步查（一次性），否则 stale-while-revalidate
    const cached = await readTripCache(bucket, date, routeParam, depParam);
    if (cached && cached.route === routeParam && cached.dep === depParam) {
      const tMs = depToMs(depParam, date);
      const paid = cached.paid === true;
      const ttl = paid ? paidPhaseTtl(nowMs, tMs).ttl : freeTtl(nowMs, tMs, isToday);
      const ttlSec = ttl != null && ttl > 0 ? ttl : LIVE_DEFAULT_TTL;
      const fresh = cached.fetchedAt != null && nowMs - cached.fetchedAt < ttlSec * 1000;
      // 过期：立刻返回旧值，后台刷新
      if (!fresh) {
        waitUntil(
          (async () => {
            try {
              const rows = await getMeta(env, secret, schemeOrder, date, nowMs);
              const row = rows.find((r) => NAME_TO_ROUTE[r.name] === routeParam && r.origin_time === depParam);
              if (row) await refreshTrip(env, secret, schemeOrder, date, row, nowMs, isToday);
            } catch (e) {
              await writeLastFailed(bucket, { date, error: `trip ${routeParam} ${depParam}: ${String(e && e.message || e)}`, attempts: MAX_ATTEMPTS }).catch(() => {});
            }
          })()
        );
      }
      return json(
        {
          serverNow: nowMs,
          date,
          route: routeParam,
          dep: depParam,
          minTtl: ttlSec,
          source: fresh ? "cache" : "stale",
          trips: [applyVisibility(cached, nowMs, date)]
        },
        200,
        cacheHeaders(ttlSec)
      );
    }

    // 无缓存：同步查一趟（很快），否则降级
    try {
      const rows = await getMeta(env, secret, schemeOrder, date, nowMs);
      const row = rows.find((r) => NAME_TO_ROUTE[r.name] === routeParam && r.origin_time === depParam);
      if (!row) {
        return json({ serverNow: nowMs, date, route: routeParam, dep: depParam, minTtl: 60, source: "missing", trips: [] }, 200, cacheHeaders(60));
      }
      const trip = await refreshTrip(env, secret, schemeOrder, date, row, nowMs, isToday);
      const tMs = depToMs(depParam, date);
      const paid = trip ? trip.paid === true : false;
      const ttlSec = trip && trip.ttl != null && trip.ttl > 0 ? trip.ttl : LIVE_DEFAULT_TTL;
      return json(
        { serverNow: nowMs, date, route: routeParam, dep: depParam, minTtl: ttlSec, source: "live", trips: trip ? [applyVisibility(trip, nowMs, date)] : [] },
        200,
        cacheHeaders(ttlSec)
      );
    } catch (err) {
      waitUntil(
        writeLastFailed(bucket, { date, error: String((err && err.message) || err), attempts: MAX_ATTEMPTS }).catch(() => {})
      );
      return json({ serverNow: nowMs, date, route: routeParam, dep: depParam, minTtl: 60, source: "degraded", trips: [] }, 200, cacheHeaders(60));
    }
  }

  // === 批量模式（PIDS / 日期切换）===
  const live = await readLiveCache(bucket, date);
  if (live && Array.isArray(live.trips)) {
    const ttl = live.minTtl != null && live.minTtl > 0 ? live.minTtl : LIVE_DEFAULT_TTL;
    const fresh = live.fetchedAt != null && nowMs - live.fetchedAt < ttl * 1000;
    if (!fresh) {
      waitUntil(
        (async () => {
          try {
            await refreshAll(env, secret, schemeOrder, date, nowMs, isToday);
          } catch (e) {
            await writeLastFailed(bucket, { date, error: `bulk: ${String(e && e.message || e)}`, attempts: MAX_ATTEMPTS }).catch(() => {});
          }
        })()
      );
    }
    return json(
      { serverNow: nowMs, date, minTtl: ttl, source: fresh ? "cache" : "stale", traffic: live.traffic || null, trips: live.trips.map((t) => applyVisibility(t, nowMs, date)) },
      200,
      cacheHeaders(ttl)
    );
  }

  // 无 live 缓存：同步批量查一次
  try {
    const { trips, traffic, mTtl } = await refreshAll(env, secret, schemeOrder, date, nowMs, isToday);
    return json(
      { serverNow: nowMs, date, minTtl: mTtl, source: "live", traffic, trips: trips.map((t) => applyVisibility(t, nowMs, date)) },
      200,
      cacheHeaders(mTtl)
    );
  } catch (err) {
    waitUntil(
      writeLastFailed(bucket, { date, error: String((err && err.message) || err), attempts: MAX_ATTEMPTS }).catch(() => {})
    );
    return json({ serverNow: nowMs, date, minTtl: 60, source: "degraded", traffic: null, trips: [] }, 200, cacheHeaders(60));
  }
}
