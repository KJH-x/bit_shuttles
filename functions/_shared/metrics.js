// 客流对比 / 累计统计 纯函数（零 workerd 依赖，可单测）。
// 指标口径：每趟余票比例 availRatio = available/total（越大=越空）。
// 客流越高 → 余票比例越低。

export function tripRatio(t) {
  if (t == null || t.total == null || t.total <= 0 || t.available == null) return null;
  return Math.max(0, Math.min(1, t.available / t.total));
}

export function dayAvgRatio(trips) {
  const ratios = (trips || []).map(tripRatio).filter((r) => r != null);
  if (!ratios.length) return null;
  return ratios.reduce((s, r) => s + r, 0) / ratios.length;
}

// 累积统计：按工作日/周末分组，天数加权平均（Q7：超过 7 天的历史折入累计）。
// 结构：{ "weekday": { days, sumRatio }, "weekend": { days, sumRatio } }
export function emptyCumulative() {
  return {
    weekday: { days: 0, sumRatio: 0 },
    weekend: { days: 0, sumRatio: 0 }
  };
}

export function groupOf(date) {
  const day = new Date(date + "T00:00:00+08:00").getDay();
  return day === 0 || day === 6 ? "weekend" : "weekday";
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

export function cumulativeAvg(cum, key) {
  const e = cum && cum[key];
  if (!e || !e.days) return null;
  return e.sumRatio / e.days;
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
