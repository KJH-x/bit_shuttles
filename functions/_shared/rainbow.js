// 彩虹巴士（rainbow-bus.cn）数据解析纯函数（零 workerd/DOM 依赖，可 node 单测）。
// 链路：routesByArea(area=3804 理工大学) → searchPlanDates{routeId} → getBusSeatsWechat{planId}
// 座位口径：type===0 且非过道且 seatNum>0 为物理座；seats[] 为已占 redis 键（r=split[3], c=split[5]）。
// 详见 docs/rainbow-bus-api-investigation.md。

// 加密信封新鲜度上限（cookie 可能已轮换/过期）
export const COOKIE_MAX_AGE_MS = 7 * 24 * 3600 * 1000;

// 解析 R2 加密信封：{v:1, alg:"AES-GCM-256", iv, ts, dataC}
export function parseEnvelope(obj, nowMs, maxAgeMs = COOKIE_MAX_AGE_MS) {
  if (!obj || typeof obj !== "object") return { ok: false, reason: "empty" };
  if (obj.v !== 1 || obj.alg !== "AES-GCM-256") return { ok: false, reason: "unsupported" };
  if (typeof obj.iv !== "string" || !obj.iv || typeof obj.dataC !== "string" || !obj.dataC) {
    return { ok: false, reason: "malformed" };
  }
  const ts = Number(obj.ts);
  if (!Number.isFinite(ts)) return { ok: false, reason: "bad_ts" };
  const ageMs = nowMs - ts;
  if (ageMs > maxAgeMs) return { ok: false, reason: "stale", ts, ageMs };
  return { ok: true, ts, ageMs };
}

// getBusSeatsWechat 响应 → 座位统计
export function countSeats(payload) {
  const rows = payload && Array.isArray(payload.rows) ? payload.rows : [];
  const seats = payload && Array.isArray(payload.seats) ? payload.seats : [];
  const cells = rows.filter((r) => r && Number(r.is_passageway) === 0 && Number(r.seatNum) > 0);
  const taken = new Set();
  for (const s of seats) {
    if (typeof s !== "string") continue;
    const p = s.split(":");
    // os:<planId>:r:<row>:c:<col>:seat
    if (p.length >= 7 && p[2] === "r" && p[4] === "c") taken.add(`${p[3]}_${p[5]}`);
  }
  let seatsTaken = 0;
  for (const c of cells) {
    if (taken.has(`${c.row_index}_${c.col_index}`)) seatsTaken++;
  }
  const seatsTotal = cells.length;
  return { seatsTotal, seatsTaken, seatsLeft: Math.max(0, seatsTotal - seatsTaken) };
}

// 线路名 → 板内方向（理工大学：早班「良乡-中关村」=a，晚班「中关村-良乡」=c）
export function mapRouteToBoard(name) {
  const n = String(name || "");
  if (/良乡[-—–→]{1,2}中关村/.test(n)) return "a";
  if (/中关村[-—–→]{1,2}良乡/.test(n)) return "c";
  return null;
}

// routesByArea 列表 → 理工大学线路（仅名称含「理工」且方向可映射者）
export function pickBoardRoutes(routes) {
  const out = [];
  for (const r of routes || []) {
    if (!r || r.id == null || r.id === "") continue;
    if (!String(r.name || "").includes("理工")) continue;
    const boardRoute = mapRouteToBoard(r.name);
    if (!boardRoute) continue;
    out.push({
      routesId: r.id,
      name: r.name,
      boardRoute,
      dep: r.first_station_time || r.service_time || null,
      serviceDate: r.service_date || null
    });
  }
  return out;
}

// 组合最终 trips：routeEntries × plans(该 routesId 今日 plan) × seats(planId)
export function buildTrips(routeEntries, plansByRoute, seatsByPlan) {
  const out = [];
  for (const r of routeEntries || []) {
    const plans = (plansByRoute && plansByRoute.get && plansByRoute.get(r.routesId)) || [];
    for (const p of plans) {
      const seat = seatsByPlan && seatsByPlan.get ? seatsByPlan.get(p.id) : null;
      if (!seat) continue;
      out.push({
        routesId: r.routesId,
        planId: p.id,
        boardRoute: r.boardRoute,
        name: r.name,
        serviceDate: p.service_date || r.serviceDate || null,
        dep: r.dep,
        seatsTotal: seat.seatsTotal,
        seatsTaken: seat.seatsTaken,
        seatsLeft: seat.seatsLeft
      });
    }
  }
  return out;
}
