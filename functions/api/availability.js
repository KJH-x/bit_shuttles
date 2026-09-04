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
  readLiveCache,
  writeLiveCache,
  rollupExpiredSnapshots,
  trafficForToday,
  writeLastFailed
} from "../_shared/history.js";
import { shiftDate } from "../_shared/metrics.js";

const MAX_ATTEMPTS = 3;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_TS_SKEW_MS = 30 * 60000;
const LIVE_DEFAULT_TTL = 60; // R2 live 缓存默认 TTL（秒）

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
  return { "Cache-Control": `public, max-age=${ttl}, s-maxage=${ttl}, stale-while-revalidate=${ttl * 2}` };
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
  const cacheKey = request.url;

  // === 主缓存：R2 live 缓存（跨设备共享）===
  // 命中：now - fetchedAt < minTtl（读 R2 不碰源站，第二台设备秒开）
  const live = await readLiveCache(bucket, date);
  if (live && Array.isArray(live.trips)) {
    const ttl = live.minTtl != null && live.minTtl > 0 ? live.minTtl : LIVE_DEFAULT_TTL;
    const fresh = live.fetchedAt != null && Date.now() - live.fetchedAt < ttl * 1000;
    if (fresh) {
      return json(
        {
          serverNow: Date.now(),
          date,
          minTtl: ttl,
          source: "r2-cache",
          traffic: live.traffic || null,
          trips: live.trips
        },
        200,
        cacheHeaders(ttl)
      );
    }
  }

  // CF Cache API 次级缓存（跨边缘，快速兜底）
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
      cacheHeaders(3600)
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

    // 逐趟查询 get-reserved-seats 获取真实余票：
    //   available = reservation_num（剩余可约座位）
    //   total     = reserved_count + reservation_num（总坐席）
    //   get-list 的 reservation_num_able 是总坐席（51/55），不是余票，不能当 available。
    const needSeats = rows
      .filter((r) => NAME_TO_ROUTE[r.name])
      .filter((r) => String(r.type) !== "1")
      .filter((r) => !enableXishan || !["d", "e"].includes(NAME_TO_ROUTE[r.name]))
      .filter((r) => {
        const dep = r.origin_time;
        if (!dep) return false;
        const tMs = depToMs(dep, date);
        return nowMs < tMs - 5 * 60000; // 停售后不再反推
      });

    const seatInfo = new Map(); // name|dep -> { available, total }
    const CHUNK = 4;
    for (let i = 0; i < needSeats.length; i += CHUNK) {
      const chunk = needSeats.slice(i, i + CHUNK);
      await Promise.all(
        chunk.map(async (r) => {
          try {
            const seat = await fetchJson(
              makeSchoolUrls(`/vehicle/get-reserved-seats?id=${encodeURIComponent(r.id)}&date=${date}`, schemeOrder),
              secret
            );
            const seatData = seat && seat.data ? seat.data : seat;
            const reserved = Number(seatData.reserved_count ?? 0);
            const avail = Number(seatData.reservation_num ?? 0);
            const total = reserved + avail;
            if (total > 0) seatInfo.set(r.name + "|" + r.origin_time, { available: avail, total });
          } catch {
            seatInfo.set(r.name + "|" + r.origin_time, null);
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
        const si = seatInfo.get(r.name + "|" + r.origin_time);
        const availableRaw = si ? si.available : null;
        const total = si ? si.total : null;
        // 付费窗口外（>3h）：不返回具体数字，但保留 pct（开售前百分比，颜色按真实余量）
        const available = paid && !visible ? null : availableRaw;
        const pct = availableRaw != null && total != null && total > 0 ? Math.round((availableRaw / total) * 100) : null;
        return { route, dep, name: r.name, paid, rainbow, phase, ttl, visible, available, total, pct };
      })
      .filter(Boolean);

    const ttlList = trips.map((t) => (t.ttl == null ? null : t.ttl));
    const mTtl = minTtl(ttlList) || 60;

    // 今日客流对比
    let traffic = null;
    if (isToday) {
      traffic = await trafficForToday(bucket, todayStr, trips);
    }

    // 写 R2 live 缓存（主缓存，跨设备共享）+ 当日快照 + 折入过期快照
    waitUntil(
      (async () => {
        await writeLiveCache(bucket, date, { minTtl: mTtl, traffic, trips });
        if (isToday) {
          const snapTrips = trips.map((t) => ({ route: t.route, dep: t.dep, available: t.available, total: t.total }));
          await writeSnapshot(bucket, date, snapTrips);
          await rollupExpiredSnapshots(bucket, todayStr);
        }
      })().catch(() => {})
    );

    const res = json(
      { serverNow: nowMs, date, minTtl: mTtl, source: "live", traffic, trips },
      200,
      cacheHeaders(mTtl)
    );
    waitUntil(cache.put(cacheKey, res.clone(), { expirationTtl: mTtl * 2 }));
    return res;
  } catch (err) {
    // 重试 3 次后放弃：写 last-failed 日志到 R2，返回降级响应
    waitUntil(
      writeLastFailed(bucket, { date, error: String((err && err.message) || err), attempts: MAX_ATTEMPTS }).catch(() => {})
    );
    // degraded 也写短 TTL 的 R2 live 缓存，避免每台设备都重试源站
    waitUntil(writeLiveCache(bucket, date, { minTtl: 60, traffic: null, trips: [] }).catch(() => {}));
    return json(
      { serverNow: Date.now(), date, minTtl: 60, source: "degraded", traffic: null, trips: [] },
      200,
      cacheHeaders(60)
    );
  }
}
