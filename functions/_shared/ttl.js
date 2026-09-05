// 余票查询的阶段 / TTL / 可见窗口 纯函数（零 workerd 依赖，可单测）。
// 时段均相对班次发车时刻 T（同一天，Beijing 时刻）。
//
// 付费班次 TTL 表（§3.1，Q2/Q4 已确认）：
//   预售期   now <  T-70min           → 1 h
//   售票前   T-70min ≤ now < T-60min  → 3 min
//   开售瞬间 T-60min ≤ now < T-50min  → 20 s
//   常规     T-50min ≤ now < T-5min   → 3 min
//   停售后   now ≥  T-5min            → 不再更新（冻结末次值）

export const VISIBLE_WINDOW_MIN = 180;
export const PAID_PRESALE_MIN = 60;
export const PAID_STOP_MIN = 5;
export const ONSALE_PLUS_MIN = 10;
const MIN = 60000;

export function beijingNowMs() {
  return Date.now();
}

export function beijingDateStr(ms) {
  return new Date(ms + 8 * 3600 * 1000).toISOString().slice(0, 10);
}

export function depToMs(dep, dateStr) {
  const [h, m] = dep.split(":").map(Number);
  const [y, mo, d] = dateStr.split("-").map(Number);
  return Date.UTC(y, mo - 1, d, h, m) - 8 * 3600 * 1000;
}

// 付费班次：阶段 + TTL（Q2：预售期 1h）
export function paidPhaseTtl(nowMs, tMs) {
  const T = tMs;
  const pre = PAID_PRESALE_MIN * MIN;
  const plus = ONSALE_PLUS_MIN * MIN;
  if (nowMs < T - pre - plus) return { phase: "presale", ttl: 3600 };
  if (nowMs < T - pre) return { phase: "preboard", ttl: 180 };
  if (nowMs < T - pre + plus) return { phase: "onsale", ttl: 20 };
  if (nowMs < T - PAID_STOP_MIN * MIN) return { phase: "regular", ttl: 180 };
  return { phase: "closed", ttl: null };
}

// 免费班次 TTL（Q4）
export function freeTtl(nowMs, tMs, isToday) {
  if (!isToday) return 86400;
  if (nowMs < tMs - 3 * 3600 * 1000) return 7200;
  if (nowMs < tMs) return 1800;
  return 86400;
}

// 3h 可见窗口：0 ≤ T-now ≤ 3h
export function isVisible(nowMs, tMs) {
  const diff = tMs - nowMs;
  return diff >= 0 && diff <= VISIBLE_WINDOW_MIN * MIN;
}

// 响应前按「当前时刻」重算可见性与 available：
// 缓存里的 available 是快照时刻算的（落入过 paid && !visible → null），班次跨过 3h 窗口
// 边界后 SWR 刷新前读到旧 null 会造成灰色高百分比闪现。这里用缓存的 bookable（原始余票）
// 按现在的时间重新判定，消除闪现；免费班次或老缓存（无 bookable）原样返回。
export function applyVisibility(trip, nowMs, dateStr) {
  if (!trip || typeof trip !== "object") return trip;
  if (trip.paid !== true || trip.bookable == null) return trip;
  const tMs = depToMs(trip.dep, dateStr || beijingDateStr(nowMs));
  const visible = isVisible(nowMs, tMs);
  const available = visible ? trip.bookable : null;
  if (available === trip.available) return trip;
  return { ...trip, available, visible };
}

// 同一响应整份 TTL：取所有相关车次的最小 TTL（双向同 T 共享节拍，§3.1 注）
export function minTtl(ttls) {
  const valid = ttls.filter((t) => t != null);
  if (!valid.length) return null;
  return Math.min(...valid);
}

// 源站 name → route 映射
export const NAME_TO_ROUTE = {
  "良乡校区-中关村校区": "a",
  "中关村校区-良乡校区": "c",
  "中关村校区-西山校区": "d",
  "西山校区-中关村校区": "e"
};
