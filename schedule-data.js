export const DURATION_MIN = 60;

export const DURATION_BY_ROUTE = {};

export { DURATION_PROFILES, DURATION_PROFILE_NOTES } from "./lib/duration-profiles.js?v=20260910-25";

import { TRIPS, TRIPS_WEEKEND } from "./lib/schedule-tables.js";
export { TRIPS, TRIPS_WEEKEND } from "./lib/schedule-tables.js";

import { scheduleKind } from "./lib/holidays.js";
export { scheduleKind, isHoliday, isMakeupWorkday } from "./lib/holidays.js";

export const ROUTES = [
  { id: "a", label: "良乡 → 中关村" },
  { id: "c", label: "中关村 → 良乡" },
  { id: "d", label: "中关村 → 西山" },
  { id: "e", label: "西山 → 中关村" }
];

export function isWeekend(date = new Date()) {
  const day = date.getDay();
  return day === 0 || day === 6;
}

// 西山往返班次（中关村⇄西山，route d/e）主开关。
// 默认关闭：在要求启用之前，往返西山的全部班次不得被展示。
// 启用：改为 true 并同步 bump 各文件 ?v= 版本号。
export const ENABLE_XISHAN = false;

export function activeTrips(date = new Date()) {
  const base = scheduleKind(date) === "weekend" ? TRIPS_WEEKEND : TRIPS;
  if (ENABLE_XISHAN) return base;
  // 默认关闭西山：返回不含 d/e 的班次。工作日本无 d/e，直接复用原数组引用（保持测试/调用方对引用相等的依赖）。
  return base.some((t) => t.route === "d" || t.route === "e") ? base.filter((t) => t.route !== "d" && t.route !== "e") : base;
}

export const CHECKPOINTS = {
  a: [
    { name: "京良", note: "收费站", pos: 0.254, segMin: 17, segKm: 7.2 },
    { name: "杜家坎", note: "收费站", pos: 0.414, segMin: 9, segKm: 9.9 },
    { name: "六里桥", pos: 0.623, segMin: 11, segKm: 10 }
  ],
  c: [
    { name: "六里桥", pos: 0.377, segMin: 25, segKm: 9 },
    { name: "杜家坎", note: "收费站", pos: 0.586, segMin: 14, segKm: 10.7 },
    { name: "京良", note: "收费站", pos: 0.746, segMin: 10, segKm: 10.5 }
  ]
};

export const CAMPUS = {
  a: {
    board: [
      { until: 0, name: "东校区上车点" },
      { until: 3, name: "北校区上车点" },
      { until: 6, name: "南校区上车点" }
    ],
    arrive: [
      { until: 3, name: "南门" },
      { until: 6, name: "西门" }
    ],
    final: { segMin: 20, segKm: 8.9 }
  },
  c: {
    board: [
      { until: 0, name: "西门上车点" },
      { until: 6, name: "南门上车点" }
    ],
    arrive: [
      { until: 2, name: "东校区" },
      { until: 4, name: "北校区" },
      { until: 6, name: "南校区" }
    ],
    final: { segMin: 13, segKm: 6.7 }
  }
};








