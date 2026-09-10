// 余票查询的阶段 / TTL / 可见窗口 纯函数（零 workerd 依赖，可单测）。
// 时段均相对班次发车时刻 T（同一天，Beijing 时刻）。
//
// 付费班次 TTL 表（§3.1，Q2/Q4 已确认；v1.25 起全部封顶 ≤5 分钟）：
//   预售期   now <  T-70min           → 5 min（原 1h）
//   售票前   T-70min ≤ now < T-60min  → 3 min
//   开售瞬间 T-60min ≤ now < T-50min  → 20 s
//   常规     T-50min ≤ now < T-5min   → 1 min
//   停售后   now ≥  T-5min            → 不再更新（冻结末次值）
//
// 免费班次 TTL：非今日 / 距发车 >3h / 已过 → 5 min（原 2h/1d）；距发车 ≤3h → 5 min（原 30min）
// （用户要求：所有 TTL max=5 分钟，保证余票变化及时反映）

export const VISIBLE_WINDOW_MIN = 180;
export const PAID_PRESALE_MIN = 60;
export const PAID_STOP_MIN = 5;
export const ONSALE_PLUS_MIN = 10;
const MIN = 60000;
const TTL_MAX = 5 * 60; // 全量余票 TTL 上限（秒）

export function beijingNowMs() {
  return Date.now();
}

export function beijingDateStr(ms) {
  return new Date(ms + 8 * 3600 * 1000).toISOString().slice(0, 10);
}

// 某日 00:00（Beijing）对应 epoch ms
export function dateStartMs(dateStr) {
  const [y, mo, d] = dateStr.split("-").map(Number);
  return Date.UTC(y, mo - 1, d) - 8 * 3600 * 1000;
}

export function depToMs(dep, dateStr) {
  const [h, m] = dep.split(":").map(Number);
  return dateStartMs(dateStr) + h * 3600 * 1000 + m * 60000;
}

// 付费班次：阶段 + TTL（全部封顶 ≤5 分钟）
export function paidPhaseTtl(nowMs, tMs) {
  const T = tMs;
  const pre = PAID_PRESALE_MIN * MIN;
  const plus = ONSALE_PLUS_MIN * MIN;
  if (nowMs < T - pre - plus) return { phase: "presale", ttl: Math.min(3600, TTL_MAX) };
  if (nowMs < T - pre) return { phase: "preboard", ttl: 180 };
  if (nowMs < T - pre + plus) return { phase: "onsale", ttl: 20 };
  if (nowMs < T - PAID_STOP_MIN * MIN) return { phase: "regular", ttl: 60 };
  return { phase: "closed", ttl: null };
}

// 免费班次 TTL（全部封顶 ≤5 分钟）
export function freeTtl(nowMs, tMs, isToday) {
  void nowMs; void tMs; void isToday;
  return TTL_MAX;
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
  // bookable 可为负（超额售罄）；clamp 到 ≥0，避免负数余票/百分比
  const bookable = trip.bookable > 0 ? trip.bookable : 0;
  const available = visible ? bookable : null;
  if (available === trip.available) return trip;
  return { ...trip, available, visible };
}

// 同一响应整份 TTL：取所有相关车次的最小 TTL（双向同 T 共享节拍，§3.1 注）
export function minTtl(ttls) {
  const valid = ttls.filter((t) => t != null);
  if (!valid.length) return null;
  return Math.min(...valid);
}

// 未来某日「整份数据」的 TTL（源站实车可能变动/加开，需限刷新节奏）：
//   距该日 3h 前                       → 1 天（遥远远期，仅预览）
//   该日 3h 前 ~ 该日结束 3h 前          → 1 小时（临近活跃期，及时反映变动）
//   该日结束 3h 后（已结束）             → null（不会再作为未来日期被查询）
export function futureDayTtl(nowMs, dateStr) {
  const start = dateStartMs(dateStr);
  const end = start + 24 * 3600 * 1000;
  const THREE_H = 3 * 3600 * 1000;
  if (nowMs < start - THREE_H) return 86400;
  if (nowMs < end - THREE_H) return 3600;
  return null;
}

// 历史回看口径：付费班次不再套 3h 可见窗口，用 bookable（原始余票，clamp≥0）直接展示；
// 无 bookable 的旧快照原样返回（available 可能为 null，由前端降级）。
export function historyTripView(t) {
  if (!t || typeof t !== "object") return t;
  if (t.paid === true && t.bookable != null) {
    const bookable = t.bookable > 0 ? t.bookable : 0;
    if (bookable !== t.available || t.visible !== true) return { ...t, available: bookable, visible: true };
    return t;
  }
  return t;
}

// 源站 name → route 映射
export const NAME_TO_ROUTE = {
  "良乡校区-中关村校区": "a",
  "中关村校区-良乡校区": "c",
  "中关村校区-西山校区": "d",
  "西山校区-中关村校区": "e"
};
