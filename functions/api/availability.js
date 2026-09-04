// GET /api/availability?date=YYYY-MM-DD
// 余票实时查询（Pages Function，随 Git 集成自动部署）。
// 流程：服务端校时 → 可选 _t 校验 ±30min → 查 CF 缓存 → 源站 get-list（签名+重试3次）→
//       映射 route / 过滤彩虹 / total 反推（仅可见窗口）→ 计算 phase/ttl/visible/pct →
//       写 R2 每日快照 → 返回（Cache-Control: s-maxage=<minTtl> + SWR）。

import { host, fetchJson } from "../_shared/school.js";
import {
  beijingNowMs,
  beijingDateStr,
  depToMs,
  paidPhaseTtl,
  freeTtl,
  isVisible,
  minTtl,
  NAME_TO_ROUTE
} from "../_shared/ttl.js";
import {
  writeSnapshot,
  readSnapshot,
  rollupExpiredSnapshots,
  trafficForToday,
  writeLastFailed
} from "../_shared/history.js";
import { shiftDate } from "../_shared/metrics.js";

const MAX_ATTEMPTS = 3;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_TS_SKEW_MS = 30 * 60000;

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...extraHeaders }
  });
}

function makeSchoolUrls(path, schemeOrder) {
  return host(schemeOrder).map((h) => h + path);
}

export async function onRequest({ request, env, waitUntil }) {
  const url = new URL(request.url);
  const dateParam = url.searchParams.get("date");
  const date = dateParam && DATE_RE.test(dateParam) ? dateParam : beijingDateStr(Date.now());

  // 可选客户端时间戳校验（Q6：仅服务端校时；前端默认不传 _t）
  const tsParam = url.searchParams.get("_t");
  if (tsParam) {
    const t = Number(tsParam);
    if (!Number.isFinite(t) || Math.abs(t - beijingNowMs()) > MAX_TS_SKEW_MS) {
      return json({ error: "clock_skew" }, 400);
    }
  }

  const bucket = env.AVAIL_BUCKET;
  const secret = env.SCHOOL_SECRET;
  const enableXishan = String(env.ENABLE_XISHAN || "false") === "true";
  // 源站协议顺序：默认 https 优先、失败回退 http；本地/内网可覆盖为 http
  const schemeOrder = env.SCHOOL_SCHEME_ORDER || "https,http";
  const cache = caches.default;
  const cacheKey = `https://bitbus.nslc.top/api/availability?date=${date}&x=${enableXishan}`;
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  const todayStr = beijingDateStr(Date.now());
  const nowMs = Date.now();
  const isToday = date === todayStr;
  const isPast = date < todayStr;

  // 历史日期：直接返回 R2 快照（不再查源站）
  if (isPast) {
    const snap = await readSnapshot(bucket, date);
    const res = json(
      {
        serverNow: nowMs,
        date,
        minTtl: 3600,
        source: "snapshot",
        traffic: null,
        trips: snap ? snap.trips : []
      },
      200,
      { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=7200" }
    );
    waitUntil(cache.put(cacheKey, res.clone()));
    return res;
  }

  // 今日/未来：查源站（未来日期源站可能返回空，优雅降级）
  try {
    const list = await fetchJson(
      makeSchoolUrls(`/vehicle/get-list?page=1&limit=100&date=${date}`, schemeOrder),
      secret
    );
    const rows = Array.isArray(list.data) ? list.data : [];

    // total 反推：当天未停售的非彩虹班次（Q3：>3h 付费班次也需百分比；成本受控并发）
    const needTotal = rows
      .filter((r) => NAME_TO_ROUTE[r.name])
      .filter((r) => String(r.type) !== "1")
      .filter((r) => !enableXishan || !["d", "e"].includes(NAME_TO_ROUTE[r.name]))
      .filter((r) => {
        const dep = r.origin_time;
        if (!dep) return false;
        const tMs = depToMs(dep, date);
        return nowMs < tMs - 5 * 60000; // 停售后不再反推
      })
      .slice(0, 20);

    const totals = new Map();
    const CHUNK = 4;
    for (let i = 0; i < needTotal.length; i += CHUNK) {
      const chunk = needTotal.slice(i, i + CHUNK);
      await Promise.all(
        chunk.map(async (r) => {
          try {
            const seat = await fetchJson(
              makeSchoolUrls(`/vehicle/get-reserved-seats?id=${encodeURIComponent(r.id)}&date=${date}`, schemeOrder),
              secret
            );
            const seatData = seat && seat.data ? seat.data : seat;
            const reserved = Number(seatData.reserved_count ?? 0);
            const reservationNum = Number(seatData.reservation_num ?? 0);
            const total = reserved + reservationNum;
            totals.set(r.name + "|" + r.origin_time, total > 0 ? total : null);
          } catch {
            totals.set(r.name + "|" + r.origin_time, null);
          }
        })
      );
    }

    const trips = rows
      .map((r) => {
        const route = NAME_TO_ROUTE[r.name];
        if (!route) return null;
        const dep = r.origin_time;
        if (!dep) return null;
        const rainbow = String(r.type) === "1";
        if (rainbow) return null; // 彩虹不在查询范围（Q4），排除
        if (!enableXishan && (route === "d" || route === "e")) return null; // 西山隐藏
        const tMs = depToMs(dep, date);
        const paid = Number(r.teacher_ticket_price ?? 0) > 0;
        const visible = isVisible(nowMs, tMs);
        const { phase, ttl } = paid ? paidPhaseTtl(nowMs, tMs) : { phase: "free", ttl: freeTtl(nowMs, tMs, isToday) };
        const availableRaw = Number(r.reservation_num_able);
        const total = totals.get(r.name + "|" + r.origin_time);
        const available = paid && !visible ? null : Number.isFinite(availableRaw) ? availableRaw : null;
        const pct = Number.isFinite(availableRaw) && total != null && total > 0 ? Math.round((availableRaw / total) * 100) : null;
        return { route, dep, name: r.name, paid, rainbow, phase, ttl, visible, available, total, pct };
      })
      .filter(Boolean);

    // 写当日快照 + 折入过期快照（后台执行，不阻塞响应）
    if (isToday) {
      const snapTrips = trips.map((t) => ({ route: t.route, dep: t.dep, available: t.available, total: t.total }));
      waitUntil(
        (async () => {
          await writeSnapshot(bucket, date, snapTrips);
          await rollupExpiredSnapshots(bucket, todayStr);
        })().catch(() => {})
      );
    }

    const ttlList = trips.map((t) => (t.ttl == null ? null : t.ttl));
    const mTtl = minTtl(ttlList) || 60;

    // 今日客流对比
    let traffic = null;
    if (isToday) {
      traffic = await trafficForToday(bucket, todayStr, trips);
    }

    const res = json(
      { serverNow: nowMs, date, minTtl: mTtl, source: "live", traffic, trips },
      200,
      { "Cache-Control": `public, s-maxage=${mTtl}, stale-while-revalidate=${mTtl * 2}` }
    );
    waitUntil(cache.put(cacheKey, res.clone(), { expirationTtl: mTtl * 2 }));
    return res;
  } catch (err) {
    // 重试 3 次后放弃：写 last-failed 日志到 R2，返回降级响应
    waitUntil(
      writeLastFailed(bucket, { date, error: String((err && err.message) || err), attempts: MAX_ATTEMPTS }).catch(() => {})
    );
    return json(
      { serverNow: Date.now(), date, minTtl: 60, source: "degraded", traffic: null, trips: [] },
      200,
      { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120" }
    );
  }
}
