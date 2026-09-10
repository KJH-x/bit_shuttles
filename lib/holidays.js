// 法定节假日 / 调休补班（2026）+ 班次类型推断。纯数据+纯函数（零 DOM、零 ?v= import），
// 可同时被前端（schedule-data.js re-export）与 functions 侧 import。
//
// 数据源：timor.tech/api/holiday/year/2026（国务院公布安排；每年更新一次，维护脚本见 README）。
// 判定优先级：调休补班（周末上班→工作日班次）> 法定节假日（→周末/假日班次）> 周六日兜底。

import { TRIPS, TRIPS_WEEKEND } from "./schedule-tables.js";

// 法定节假日（holiday=true 的日期集合）
export const HOLIDAYS = new Set([
  "2026-01-01", "2026-01-02", "2026-01-03", // 元旦
  "2026-02-15", "2026-02-16", "2026-02-17", "2026-02-18", "2026-02-19", "2026-02-20", "2026-02-21", "2026-02-22", "2026-02-23", // 春节（含除夕 02-16、初一 02-17）
  "2026-04-04", "2026-04-05", "2026-04-06", // 清明
  "2026-05-01", "2026-05-02", "2026-05-03", "2026-05-04", "2026-05-05", // 劳动节
  "2026-06-19", "2026-06-20", "2026-06-21", // 端午
  "2026-09-25", "2026-09-26", "2026-09-27", // 中秋
  "2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04", "2026-10-05", "2026-10-06", "2026-10-07" // 国庆
]);

// 调休补班日（holiday=false 且落在周六/周日 → 按工作日班次）
export const MAKEUP_WORKDAYS = new Set([
  "2026-01-04", // 周日
  "2026-02-14", // 周六
  "2026-02-28", // 周六
  "2026-05-09", // 周六
  "2026-09-20", // 周日
  "2026-10-10"  // 周六
]);

// 统一日期键：接受 Date 或 'YYYY-MM-DD'。Date 用本地年/月/日（与 isWeekend 的 getDay() 口径一致）。
export function dateKey(input) {
  if (typeof input === "string") return input;
  const d = new Date(input);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function isHoliday(input) {
  return HOLIDAYS.has(dateKey(input));
}

export function isMakeupWorkday(input) {
  return MAKEUP_WORKDAYS.has(dateKey(input));
}

function isWeekendDay(dateStr) {
  const day = new Date(dateStr + "T00:00:00+08:00").getDay();
  return day === 0 || day === 6;
}

// 时刻表类型：调休补班 → weekday；法定节假日 → weekend；其余按周六日。
export function scheduleKind(input) {
  const k = dateKey(input);
  if (MAKEUP_WORKDAYS.has(k)) return "weekday";
  if (HOLIDAYS.has(k)) return "weekend";
  return isWeekendDay(k) ? "weekend" : "weekday";
}

// 静态表 route:dep 集合（源站 get-list 过滤口径一致：排除彩虹 type=1、排除西山 d/e）
function depsOf(list) {
  return new Set(list.filter((t) => t.route !== "d" && t.route !== "e" && !t.rainbow).map((t) => `${t.route}:${t.dep}`));
}

export function scheduleDepSets() {
  return { weekday: depsOf(TRIPS), weekend: depsOf(TRIPS_WEEKEND) };
}

// 源站实车推断当天时刻表类型：比较实车 rows（{route, dep}）与静态工作日/周末表的命中率。
// 无数据、命中率过接近或过低 → null（交回静态 scheduleKind 兜底）。
export function inferScheduleKind(rows, sets = scheduleDepSets()) {
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const keys = rows.map((r) => `${r.route}:${r.dep}`);
  const total = keys.length;
  const hit = (set) => keys.filter((k) => set.has(k)).length;
  const wdRatio = hit(sets.weekday) / total;
  const weRatio = hit(sets.weekend) / total;
  const best = wdRatio > weRatio ? "weekday" : weRatio > wdRatio ? "weekend" : null;
  if (best == null) return null;
  if (Math.max(wdRatio, weRatio) < 0.3) return null;
  return best;
}
