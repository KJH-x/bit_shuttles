// 客流对比 / 累计统计 纯函数（零 workerd 依赖，可单测）。
// 指标口径：每趟余票比例 availRatio = available/total（越大=越空）。
// 客流越高 → 余票比例越低。
// 满载率口径：loadRatio = (total − available)/total = used/total（越大=越挤）。

import { scheduleKind } from "../../lib/holidays.js";

export function tripRatio(t) {
  if (t == null || t.total == null || t.total <= 0 || t.available == null) return null;
  return Math.max(0, Math.min(1, t.available / t.total));
}

export function dayAvgRatio(trips) {
  const ratios = (trips || []).map(tripRatio).filter((r) => r != null);
  if (!ratios.length) return null;
  return ratios.reduce((s, r) => s + r, 0) / ratios.length;
}

// === 满载率（座位加权）===
// 单趟已用座位 { used, total }；历史口径优先用 bookable（原始余票，clamp≥0）。
export function tripUsed(t) {
  if (t == null || t.total == null || t.total <= 0) return null;
  const avail = t.bookable != null ? Math.max(0, t.bookable) : t.available;
  if (avail == null) return null;
  return { used: t.total - avail, total: t.total };
}

export function tripLoadRatio(t) {
  const u = tripUsed(t);
  return u ? u.used / u.total : null;
}

// 按天座位加权：Σ(total−available) / Σtotal（每趟按其真实容量加权）
export function dayLoadSeatWeighted(trips) {
  let sumUsed = 0;
  let sumTotal = 0;
  for (const t of trips || []) {
    const u = tripUsed(t);
    if (!u) continue;
    sumUsed += u.used;
    sumTotal += u.total;
  }
  return { sumUsed, sumTotal, ratio: sumTotal > 0 ? sumUsed / sumTotal : null };
}

// 累积统计：按工作日/周末分组，天数加权平均（Q7：超过 7 天的历史折入累计）。
// 结构：{ "weekday": { days, sumRatio }, "weekend": { days, sumRatio } }
export function emptyCumulative() {
  return {
    weekday: { days: 0, sumRatio: 0 },
    weekend: { days: 0, sumRatio: 0 }
  };
}

// 历史满载率累计（座位加权）：{ "weekday": { days, sumUsed, sumTotal }, "weekend": {...} }
export function emptyLoadCumulative() {
  return {
    weekday: { days: 0, sumUsed: 0, sumTotal: 0 },
    weekend: { days: 0, sumUsed: 0, sumTotal: 0 }
  };
}

// 分组：调休补班→weekday、法定节假日→weekend、其余按周六日（与 activeTrips/scheduleKind 同口径）
export function groupOf(date) {
  return scheduleKind(date) === "weekend" ? "weekend" : "weekday";
}

export function foldInto(cum, date, ratio) {
  if (ratio == null) return cum;
  const key = groupOf(date);
  const entry = cum[key] || { days: 0, sumRatio: 0 };
  entry.days += 1;
  entry.sumRatio += ratio;
  cum[key] = entry;
  return cum;
}

export function foldLoadInto(cum, date, day) {
  if (!day || day.ratio == null) return cum;
  const key = groupOf(date);
  const entry = cum[key] || { days: 0, sumUsed: 0, sumTotal: 0 };
  entry.days += 1;
  entry.sumUsed += day.sumUsed;
  entry.sumTotal += day.sumTotal;
  cum[key] = entry;
  return cum;
}

export function cumulativeAvg(cum, key) {
  const e = cum && cum[key];
  if (!e || !e.days) return null;
  return e.sumRatio / e.days;
}

// 历史满载率（全量座位加权累计）：Σ used / Σ total
export function cumulativeLoadAvg(cum, key) {
  const e = cum && cum[key];
  if (!e || !e.sumTotal) return null;
  return e.sumUsed / e.sumTotal;
}

// 今日 vs 同期：delta = (今日比例 - 同期比例)/同期比例；客流升高(delta<0，更挤)→ dir=up, color=red
export function trafficDelta(todayRatio, baseRatio) {
  if (todayRatio == null || baseRatio == null || baseRatio === 0) return null;
  return (todayRatio - baseRatio) / baseRatio;
}

export function trafficView(todayRatio, baseRatio) {
  const delta = trafficDelta(todayRatio, baseRatio);
  if (delta == null) return null;
  const dir = delta < 0 ? "up" : "down"; // 比例下降=客流升高
  const color = dir === "up" ? "red" : "green";
  return {
    delta: `${Math.abs(Math.round(delta * 100))}%`,
    dir,
    color,
    raw: delta
  };
}

// 日期偏移（+/- 天），返回 YYYY-MM-DD（Beijing）
export function shiftDate(dateStr, offsetDays) {
  const d = new Date(dateStr + "T00:00:00+08:00");
  d.setDate(d.getDate() + offsetDays);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
