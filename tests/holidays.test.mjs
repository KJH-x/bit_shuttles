import test from "node:test";
import assert from "node:assert/strict";
import {
  HOLIDAYS,
  MAKEUP_WORKDAYS,
  dateKey,
  isHoliday,
  isMakeupWorkday,
  scheduleKind,
  scheduleDepSets,
  inferScheduleKind
} from "../lib/holidays.js";
import { TRIPS, TRIPS_WEEKEND, activeTrips } from "../schedule-data.js";

const D = (y, m, d) => new Date(y, m - 1, d, 12, 0, 0);

test("data integrity: 节假日与调休补班无交集、补班日均为周末、日期合法", () => {
  for (const k of HOLIDAYS) {
    assert.match(k, /^\d{4}-\d{2}-\d{2}$/, `bad holiday key ${k}`);
    assert.ok(!Number.isNaN(Date.parse(k + "T00:00:00+08:00")), `invalid date ${k}`);
  }
  for (const k of MAKEUP_WORKDAYS) {
    assert.match(k, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(HOLIDAYS.has(k), false, `${k} 不应同时出现在节假日`);
    const day = new Date(k + "T00:00:00+08:00").getDay();
    assert.ok(day === 0 || day === 6, `补班日 ${k} 必须是周六或周日`);
  }
});

test("dateKey: 字符串原样、Date 取本地年月日", () => {
  assert.equal(dateKey("2026-09-25"), "2026-09-25");
  assert.equal(dateKey(D(2026, 9, 25)), "2026-09-25");
  assert.equal(dateKey(new Date(Date.parse("2026-10-01T00:00:00Z"))), "2026-10-01");
});

test("isHoliday / isMakeupWorkday", () => {
  assert.equal(isHoliday("2026-09-25"), true); // 中秋（周五）
  assert.equal(isHoliday("2026-10-01"), true); // 国庆
  assert.equal(isHoliday("2026-09-20"), false); // 调休补班（周日）
  assert.equal(isHoliday("2026-09-10"), false);
  assert.equal(isMakeupWorkday("2026-09-20"), true);
  assert.equal(isMakeupWorkday("2026-10-10"), true);
  assert.equal(isMakeupWorkday("2026-09-25"), false);
  assert.equal(isMakeupWorkday("2026-09-10"), false);
});

test("scheduleKind: 法定节假日→weekend、调休补班→weekday、普通日按周六日", () => {
  assert.equal(scheduleKind("2026-09-25"), "weekend"); // 中秋周五（旧逻辑会判工作日）
  assert.equal(scheduleKind("2026-09-26"), "weekend"); // 中秋周六
  assert.equal(scheduleKind("2026-10-01"), "weekend"); // 国庆周四
  assert.equal(scheduleKind("2026-10-07"), "weekend"); // 国庆末
  assert.equal(scheduleKind("2026-09-20"), "weekday"); // 调休补班周日
  assert.equal(scheduleKind("2026-10-10"), "weekday"); // 调休补班周六
  assert.equal(scheduleKind("2026-02-14"), "weekday"); // 春节补班周六
  assert.equal(scheduleKind("2026-09-10"), "weekday"); // 普通周四
  assert.equal(scheduleKind("2026-09-12"), "weekend"); // 普通周六
  assert.equal(scheduleKind("2026-09-13"), "weekend"); // 普通周日
});

test("activeTrips: 节假日周五跑周末班次、调休补班周日跑工作日班次", () => {
  const weekendTrips = activeTrips(D(2026, 9, 25)); // 中秋周五
  assert.notEqual(weekendTrips, TRIPS);
  assert.ok(weekendTrips.length > 0);
  assert.ok(weekendTrips.every((t) => t.route === "a" || t.route === "c"), "西山 d/e 不应出现");
  const makeup = activeTrips(D(2026, 9, 20)); // 调休补班周日
  assert.equal(makeup, TRIPS);
  const makeupSat = activeTrips(D(2026, 10, 10));
  assert.equal(makeupSat, TRIPS);
});

test("scheduleDepSets: 排除彩虹与西山 d/e", () => {
  const sets = scheduleDepSets();
  const weekendA = TRIPS_WEEKEND.filter((t) => t.route === "a" && !t.rainbow);
  for (const t of weekendA) assert.ok(sets.weekend.has(`a:${t.dep}`), `weekend missing a:${t.dep}`);
  const rainbowA = TRIPS.find((t) => t.route === "a" && t.rainbow);
  assert.ok(rainbowA, "存在工作日彩虹班次");
  assert.equal(sets.weekday.has(`a:${rainbowA.dep}`), false, "彩虹不应进入推断集合");
});

test("inferScheduleKind: 工作日表→weekday、周末表→weekend、空/低命中→null", () => {
  assert.equal(inferScheduleKind([{ route: "a", dep: "06:20" }, { route: "a", dep: "07:50" }, { route: "c", dep: "07:50" }]), "weekday");
  assert.equal(inferScheduleKind([{ route: "a", dep: "06:30" }, { route: "a", dep: "07:30" }, { route: "c", dep: "08:10" }]), "weekend");
  assert.equal(inferScheduleKind([]), null);
  assert.equal(inferScheduleKind(null), null);
  assert.equal(inferScheduleKind([{ route: "a", dep: "03:33" }]), null); // 完全未知时刻
  assert.equal(inferScheduleKind([{ route: "a", dep: "06:20" }, { route: "a", dep: "06:30" }]), null); // 1:1 平局
});
