// 高德实时路况数据层（`/api/traffic`）+ 纯函数。
// 顶层不执行 fetch / DOM 引用，可被 node 测试直接 import。
// 数据超过 TRAFFIC_STALE_MS 视为过期，回退静态耗时表；initTraffic 每 TRAFFIC_POLL_MS 轮询。

export const TRAFFIC_STALE_MS = 30 * 60 * 1000;
export const TRAFFIC_POLL_MS = 60 * 1000;

// 段路况 → 半透明渐变色的映射（lane 色带）
const SEG_COLOR = {
  green: "rgba(74,222,128,.38)",
  yellow: "rgba(250,204,21,.38)",
  orange: "rgba(251,146,60,.38)",
  red: "rgba(248,113,113,.38)"
};

// 规整后端响应：缺字段时降级为 available:false 或对应项为 null，避免前端崩
export function normalizeTraffic(data) {
  if (!data || data.available !== true) return { available: false };
  const dirs = data.dirs && typeof data.dirs === "object" ? data.dirs : {};
  return {
    available: true,
    fetchedAt: typeof data.fetchedAt === "number" ? data.fetchedAt : 0,
    dirs: {
      fwd: dirs.fwd || null,
      rev: dirs.rev || null
    }
  };
}

// route a=良乡→中关村 → dirs.fwd；route c=中关村→良乡 → dirs.rev；其他/无效 → null
export function trafficForRoute(data, route) {
  if (!data || data.available !== true || !data.dirs) return null;
  if (route === "a") return data.dirs.fwd || null;
  if (route === "c") return data.dirs.rev || null;
  return null;
}

// 实时全程耗时（分钟，可小数）：新鲜返回 seg.etaSec/60，否则 null（回退静态表）
export function realtimeDurMin(data, route, nowMs) {
  const seg = trafficForRoute(data, route);
  if (!seg || !(seg.etaSec > 0)) return null;
  if (typeof data.fetchedAt !== "number" || nowMs - data.fetchedAt > TRAFFIC_STALE_MS) return null;
  return seg.etaSec / 60;
}

// marker 位移：实时数据新鲜时按段推进（距离插值），否则用 trip.progress
export function markerProgress(trip, data, nowMs) {
  const fallback = () => Math.max(0, Math.min(1, trip.progress == null ? 0 : trip.progress));
  const seg = trafficForRoute(data, trip.route);
  const t = nowMs - trip.depMs;
  const total = trip.arrMs - trip.depMs;
  if (!seg || !Array.isArray(seg.segments) || seg.segments.length === 0 || t <= 0) return fallback();
  if (t >= total) return 1;
  const totalDist = seg.segments.reduce((s, sg) => s + (sg.distM || 0), 0);
  if (!(totalDist > 0)) return fallback();
  let cumTime = 0;
  let cumDist = 0;
  for (const sg of seg.segments) {
    const segTime = (sg.etaSec || 0) * 1000;
    if (t < cumTime + segTime) {
      const frac = segTime > 0 ? (t - cumTime) / segTime : 0;
      const offset = cumDist + frac * (sg.distM || 0);
      return Math.max(0, Math.min(1, offset / totalDist));
    }
    cumTime += segTime;
    cumDist += sg.distM || 0;
  }
  return 1;
}

// lane 路况色带：linear-gradient(90deg, ...)，色标按段累计距离/总距离百分比（0.1%）。
// fwd（route a）左→右 = S1→S2→S3；rev（route c）显示方向左→右 = S3→S2→S1（色标顺序反转）。
export function laneGradient(segments, route) {
  if (!Array.isArray(segments) || segments.length === 0) return "";
  const total = segments.reduce((s, sg) => s + (sg.distM || 0), 0);
  if (!(total > 0)) return "";
  const order = route === "c" ? segments.slice().reverse() : segments;
  const stops = [];
  let cum = 0;
  for (const sg of order) {
    const color = SEG_COLOR[sg.color];
    if (!color) return "";
    const start = Math.round((cum / total) * 1000) / 10;
    cum += sg.distM || 0;
    const end = Math.round((cum / total) * 1000) / 10;
    stops.push(stops.length === 0 ? `${color} 0 ${end}%` : `${color} ${start}% ${end}%`);
  }
  return `linear-gradient(90deg, ${stops.join(", ")})`;
}

// 数据层：立即拉取一次，之后每 TRAFFIC_POLL_MS 轮询；回调收到规整后的数据。
// fetch/interval 仅存在于本函数内部，返回清理函数。
export function initTraffic(cb) {
  const poll = () => {
    fetch("/api/traffic")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => cb(normalizeTraffic(data)))
      .catch(() => cb(normalizeTraffic(null)));
  };
  poll();
  const timer = setInterval(poll, TRAFFIC_POLL_MS);
  return () => clearInterval(timer);
}
