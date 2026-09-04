import test from "node:test";
import assert from "node:assert/strict";
import { ROUTES, TRIPS, TRIPS_WEEKEND, DURATION_MIN, DURATION_BY_ROUTE, DURATION_PROFILES, isWeekend, activeTrips, CHECKPOINTS, CAMPUS, ENABLE_XISHAN } from "../schedule-data.js";
import { tripStatus, computeAll, tripDuration, depToMs, formatDurationLabel, formatClock, formatHM, formatHMS, ticketInfo, lookupDuration, departureLabel, fidsStatus, checkpointOffsets, checkpointLabel, checkpointTimes, campusStopAt, arrivalStopAt, tripLocation } from "../lib/schedule.js";

const ROUTE_IDS = new Set(ROUTES.map((r) => r.id));

test("schedule data: trip ids are unique", () => {
  const ids = TRIPS.map((t) => t.id);
  assert.equal(new Set(ids).size, ids.length);
});

test("schedule data: every trip references a known route", () => {
  for (const t of TRIPS) {
    assert.ok(ROUTE_IDS.has(t.route), `unknown route ${t.route} on ${t.id}`);
  }
});

test("schedule data: departure times are valid HH:MM", () => {
  for (const t of TRIPS) {
    assert.match(t.dep, /^([01]\d|2[0-3]):[0-5]\d$/, `bad dep ${t.dep} on ${t.id}`);
  }
});

test("schedule data: prices and rainbow flags are boolean/string consistent", () => {
  for (const t of TRIPS) {
    assert.equal(typeof t.rainbow, "boolean", `rainbow must be boolean on ${t.id}`);
    assert.match(t.price, /^¥\d+\.\d{2}$/, `bad price ${t.price} on ${t.id}`);
  }
});

test("schedule data: route a and c share the bidirectional corridor (良乡⇄中关村)", () => {
  const byRoute = (id) => TRIPS.filter((t) => t.route === id);
  assert.ok(byRoute("a").length >= 20, "route a (良乡→中关村) has trips");
  assert.ok(byRoute("c").length >= 20, "route c (中关村→良乡) has trips");
  assert.equal(ROUTES.length, 4, "回龙观 removed, 西山 routes d/e added");
  assert.ok(ROUTE_IDS.has("d"), "route d (中关村→西山)");
  assert.ok(ROUTE_IDS.has("e"), "route e (西山→中关村)");
});

test("weekend schedule data: valid trips on known routes", () => {
  const ids = TRIPS_WEEKEND.map((t) => t.id);
  assert.equal(new Set(ids).size, ids.length, "weekend trip ids must be unique");
  for (const t of TRIPS_WEEKEND) {
    assert.ok(ROUTE_IDS.has(t.route), `unknown route ${t.route} on ${t.id}`);
    assert.match(t.dep, /^([01]\d|2[0-3]):[0-5]\d$/, `bad dep ${t.dep} on ${t.id}`);
    assert.equal(typeof t.rainbow, "boolean", `rainbow must be boolean on ${t.id}`);
    assert.match(t.price, /^¥\d+\.\d{2}$/, `bad price ${t.price} on ${t.id}`);
  }
});

test("ENABLE_XISHAN off: 往返西山的全部班次被过滤（默认不展示）", () => {
  assert.equal(ENABLE_XISHAN, false, "西山开关默认关闭（未启用不得展示）");
  const weekendTrips = activeTrips(new Date(2026, 8, 5, 12, 0, 0));
  assert.equal(weekendTrips.some((t) => t.route === "d"), false, "中关村→西山 (d) 不应出现");
  assert.equal(weekendTrips.some((t) => t.route === "e"), false, "西山→中关村 (e) 不应出现");
  const weekdayTrips = activeTrips(new Date(2026, 8, 2, 12, 0, 0));
  assert.equal(weekdayTrips.some((t) => t.route === "d" || t.route === "e"), false);
});

test("isWeekend / activeTrips: weekend vs weekday switching", () => {
  const sat = new Date(2026, 8, 5, 12, 0, 0);
  const sun = new Date(2026, 8, 6, 12, 0, 0);
  const wed = new Date(2026, 8, 2, 12, 0, 0);
  assert.equal(isWeekend(sat), true);
  assert.equal(isWeekend(sun), true);
  assert.equal(isWeekend(wed), false);
  assert.equal(activeTrips(wed), TRIPS);
  assert.ok(activeTrips(sat).length > 0, "周末应有班次（过滤掉西山 d/e 后仍非空）");
  assert.ok(activeTrips(sat).every((t) => t.route === "a" || t.route === "c"), "周末启用西山前仅含 a/c");
});

test("schedule data: no 回龙观 trips remain", () => {
  assert.equal(TRIPS.some((t) => t.route === "b"), false, "route b removed");
  assert.equal(TRIPS.some((t) => t.dep === "06:20" && t.route === "b"), false);
});

test("tripStatus: upcoming / running / past with 1h duration", () => {
  const trip = { id: "x", route: "a", dep: "12:00", price: "¥10.00", rainbow: false };
  const base = depToMs("12:00", new Date("2026-09-01T10:00:00+08:00"));
  const upcoming = tripStatus(trip, base - 5 * 60000, DURATION_BY_ROUTE, DURATION_MIN);
  assert.equal(upcoming.status, "upcoming");
  assert.equal(upcoming.progress, 0);

  const running = tripStatus(trip, base + 30 * 60000, DURATION_BY_ROUTE, DURATION_MIN);
  assert.equal(running.status, "running");
  assert.ok(Math.abs(running.progress - 0.5) < 1e-9);

  const past = tripStatus(trip, base + 61 * 60000, DURATION_BY_ROUTE, DURATION_MIN);
  assert.equal(past.status, "past");
  assert.equal(past.progress, 1);
});

test("tripStatus: per-trip dur override beats per-route and default", () => {
  const trip = { id: "y", route: "a", dep: "12:00", price: "¥10.00", rainbow: false, dur: 45 };
  const base = depToMs("12:00", new Date("2026-09-01T10:00:00+08:00"));
  assert.equal(tripDuration(trip, DURATION_BY_ROUTE, DURATION_MIN), 45);
  const running = tripStatus(trip, base + 22.5 * 60000, DURATION_BY_ROUTE, DURATION_MIN);
  assert.equal(running.status, "running");
  assert.ok(Math.abs(running.progress - 0.5) < 1e-9);
});

test("lookupDuration: nearest profile entry for arbitrary departure", () => {
  const profile = DURATION_PROFILES.c;
  assert.equal(lookupDuration("07:00", profile), 44);
  assert.equal(lookupDuration("07:30", profile), 50);
  assert.equal(lookupDuration("07:45", profile), 53);
  assert.equal(lookupDuration("16:00", profile), 56);
  assert.equal(lookupDuration("17:15", profile), 80);
  assert.equal(lookupDuration("06:00", profile), 41);
  assert.equal(lookupDuration("23:45", profile), 42);
});

test("lookupDuration: route a (良乡→中关村) profile", () => {
  const profile = DURATION_PROFILES.a;
  assert.equal(lookupDuration("06:20", profile), 70);
  assert.equal(lookupDuration("08:10", profile), 69);
  assert.equal(lookupDuration("17:05", profile), 54);
  assert.equal(lookupDuration("12:00", profile), 42);
  assert.equal(lookupDuration("20:15", profile), 43);
  assert.equal(lookupDuration("22:50", profile), 39);
});

test("lookupDuration: uses nearest interpolation for off-grid times", () => {
  const profile = DURATION_PROFILES.c;
  assert.equal(lookupDuration("07:22", profile), 47);
  assert.equal(lookupDuration("16:07", profile), 56);
  assert.equal(lookupDuration("17:50", profile), 77);
  assert.equal(lookupDuration("20:40", profile), 48);
});

test("tripDuration: durations over 1 hour are no longer capped", () => {
  const tripC = { id: "c1", route: "c", dep: "17:20", price: "¥10.00", rainbow: false };
  assert.equal(tripDuration(tripC, DURATION_BY_ROUTE, DURATION_MIN, DURATION_PROFILES), 80);
  const tripA = { id: "a1", route: "a", dep: "17:20", price: "¥10.00", rainbow: false };
  assert.equal(tripDuration(tripA, DURATION_BY_ROUTE, DURATION_MIN, DURATION_PROFILES), 53);
});

test("tripStatus: route c arrival reflects uncapped profile duration", () => {
  const tripC = { id: "c16", route: "c", dep: "17:20", price: "¥10.00", rainbow: false };
  const depMs = depToMs("17:20", new Date("2026-09-01T16:00:00+08:00"));
  const st = tripStatus(tripC, depMs + 30 * 60000, DURATION_BY_ROUTE, DURATION_MIN, DURATION_PROFILES);
  assert.equal(st.arrMs - st.depMs, 80 * 60000);
  assert.equal(st.status, "running");
  assert.ok(Math.abs(st.progress - 0.375) < 1e-9);
});

test("computeAll returns one entry per trip", () => {
  const now = Date.now();
  const all = computeAll(TRIPS, now, DURATION_BY_ROUTE, DURATION_MIN);
  assert.equal(all.length, TRIPS.length);
  for (const t of all) {
    assert.ok(["upcoming", "running", "past"].includes(t.status));
  }
});

test("formatDurationLabel renders minute/hour labels", () => {
  assert.equal(formatDurationLabel(30 * 60000), "30 分钟");
  assert.equal(formatDurationLabel(90 * 60000), "1 小时 30 分钟");
  assert.equal(formatDurationLabel(120 * 60000), "2 小时");
  assert.equal(formatDurationLabel(15 * 1000), "不足 1 分钟");
});

test("formatClock / formatHM pad to HH:MM(:SS)", () => {
  assert.equal(formatHM(new Date(2026, 0, 1, 8, 5)), "08:05");
  assert.equal(formatClock(new Date(2026, 0, 1, 8, 5, 3)), "08:05:03");
});

test("formatHMS renders HH:MM:SS countdown", () => {
  assert.equal(formatHMS(0), "00:00:00");
  assert.equal(formatHMS(5 * 60000 + 3 * 1000), "00:05:03");
  assert.equal(formatHMS(61 * 60000), "01:01:00");
  assert.equal(formatHMS(59 * 1000), "00:00:59");
});

test("ticketInfo: free trips bookable all day", () => {
  const trip = { id: "f", route: "a", dep: "12:00", price: "¥0.00", rainbow: false, depMs: depToMs("12:00", new Date("2026-09-01T10:00:00+08:00")) };
  const info = ticketInfo(trip, trip.depMs - 3 * 60000);
  assert.equal(info.type, "free");
  assert.match(info.label, /全天可约/);
});

test("ticketInfo: rainbow trips bookable all week", () => {
  const trip = { id: "r", route: "c", dep: "12:00", price: "¥10.00", rainbow: true, depMs: depToMs("12:00", new Date("2026-09-01T10:00:00+08:00")) };
  const info = ticketInfo(trip, trip.depMs - 120 * 60000);
  assert.equal(info.type, "rainbow");
  assert.match(info.label, /全周可约/);
});

test("ticketInfo: regular trips open T-1h, countdown before", () => {
  const depMs = depToMs("12:00", new Date("2026-09-01T10:00:00+08:00"));
  const trip = { id: "g", route: "a", dep: "12:00", price: "¥10.00", rainbow: false, depMs };
  const early = ticketInfo(trip, depMs - 90 * 60000);
  assert.equal(early.type, "regular");
  assert.equal(early.phase, "wait");
  assert.match(early.label, /距开售 00:30:00/);

  const justOpened = ticketInfo(trip, depMs - 58 * 60000);
  assert.equal(justOpened.phase, "onsale");

  const soldOut = ticketInfo(trip, depMs - 50 * 60000);
  assert.equal(soldOut.phase, "soldout");
  assert.match(soldOut.label, /可能已售罄/);

  const closed = ticketInfo(trip, depMs - 2 * 60000);
  assert.equal(closed.phase, "closed");
});

test("departureLabel: countdown before, 即将发车 within 1min, 已发车 within T+10, hidden label", () => {
  const depMs = depToMs("12:00", new Date("2026-09-01T10:00:00+08:00"));
  const trip = { id: "g", route: "a", dep: "12:00", price: "¥10.00", rainbow: false, depMs };
  assert.match(departureLabel(trip, depMs - 30 * 60000), /30 分钟后/);
  assert.equal(departureLabel(trip, depMs - 59 * 1000), "即将发车");
  assert.equal(departureLabel(trip, depMs - 1000), "即将发车");
  assert.equal(departureLabel(trip, depMs + 2 * 60000), "已发车 · 可能还在上车点");
  assert.equal(departureLabel(trip, depMs + 6 * 60000), "已发车");
  assert.equal(departureLabel(trip, depMs + 9 * 60000), "已发车");
});

test("filterUpcoming visibility: running trips shown until T+10, hidden after", () => {
  const depMs = depToMs("12:00", new Date("2026-09-01T10:00:00+08:00"));
  const trip = { id: "g", route: "a", dep: "12:00", price: "¥10.00", rainbow: false };
  const runningNow = tripStatus(trip, depMs + 6 * 60000, DURATION_BY_ROUTE, DURATION_MIN, DURATION_PROFILES);
  assert.equal(runningNow.status, "running");
  const hideAfter = depMs + 10 * 60000;
  assert.ok(depMs + 6 * 60000 < hideAfter, "within T+10 -> still visible");
  assert.ok(depMs + 12 * 60000 >= hideAfter, "after T+10 -> hidden");
});

test("CHECKPOINTS: 良乡⇄中关村 双向各 3 个虚拟站点（京良收费站/杜家坎收费站/六里桥）", () => {
  assert.ok(Array.isArray(CHECKPOINTS.a) && CHECKPOINTS.a.length === 3, "route a checkpoints");
  assert.ok(Array.isArray(CHECKPOINTS.c) && CHECKPOINTS.c.length === 3, "route c checkpoints");
  assert.equal(checkpointLabel(CHECKPOINTS.a[0]), "京良收费站");
  assert.equal(checkpointLabel(CHECKPOINTS.a[2]), "六里桥");
  assert.equal(checkpointLabel(CHECKPOINTS.c[0]), "六里桥");
});

test("checkpointOffsets: 使用 pos 字段（双向加权平均），无 pos 回退等分", () => {
  assert.deepEqual(checkpointOffsets(CHECKPOINTS.a), [0.254, 0.414, 0.623]);
  assert.deepEqual(checkpointOffsets(CHECKPOINTS.c), [0.377, 0.586, 0.746]);
  assert.deepEqual(checkpointOffsets([1, 2, 3]), [0.25, 0.5, 0.75]);
  assert.deepEqual(checkpointOffsets([]), []);
});

test("checkpointTimes: 按 pos 比例计算各检查点时刻", () => {
  const depMs = depToMs("12:00", new Date("2026-09-01T10:00:00+08:00"));
  const trip = { id: "g", route: "a", dep: "12:00", price: "¥10.00", rainbow: false, depMs, arrMs: depMs + 60 * 60000 };
  const times = checkpointTimes(trip, CHECKPOINTS.a);
  assert.equal(times.length, 3);
  assert.equal(times[0].ms - depMs, Math.round(0.254 * 60 * 60000));
  assert.equal(times[1].ms - depMs, Math.round(0.414 * 60 * 60000));
  assert.equal(times[2].ms - depMs, Math.round(0.623 * 60 * 60000));
  assert.equal(times[0].label, "京良收费站");
});

test("campusStopAt: 良乡出发 T-10~T+6 显示「开始上车」", () => {
  const depMs = depToMs("12:00", new Date("2026-09-01T10:00:00+08:00"));
  const trip = { id: "g", route: "a", dep: "12:00", price: "¥10.00", rainbow: false, depMs };
  assert.equal(campusStopAt(trip, depMs - 5 * 60000, CAMPUS.a), "开始上车");
  assert.equal(campusStopAt(trip, depMs + 1 * 60000, CAMPUS.a), "开始上车");
  assert.equal(campusStopAt(trip, depMs + 4 * 60000, CAMPUS.a), "开始上车");
  assert.equal(campusStopAt(trip, depMs + 6 * 60000, CAMPUS.a), "开始上车"); // T+6 边界含
  assert.equal(campusStopAt(trip, depMs + 7 * 60000, CAMPUS.a), null);
  assert.equal(campusStopAt(trip, depMs - 12 * 60000, CAMPUS.a), null);
});

test("campusStopAt: 中关村出发 T-10~T+5 显示「开始上车」", () => {
  const depMs = depToMs("12:00", new Date("2026-09-01T10:00:00+08:00"));
  const trip = { id: "h", route: "c", dep: "12:00", price: "¥10.00", rainbow: false, depMs };
  assert.equal(campusStopAt(trip, depMs - 5 * 60000, CAMPUS.c), "开始上车");
  assert.equal(campusStopAt(trip, depMs + 3 * 60000, CAMPUS.c), "开始上车");
  assert.equal(campusStopAt(trip, depMs + 5 * 60000, CAMPUS.c), "开始上车"); // T+5 边界含
  assert.equal(campusStopAt(trip, depMs + 6 * 60000, CAMPUS.c), null);
});

test("arrivalStopAt: 到达顺序按时间窗口推进，最后停留在末站", () => {
  const depMs = depToMs("12:00", new Date("2026-09-01T10:00:00+08:00"));
  const arrMs = depMs + 60 * 60000;
  const trip = { id: "g", route: "a", dep: "12:00", price: "¥10.00", rainbow: false, depMs, arrMs };
  assert.equal(arrivalStopAt(trip, arrMs + 1 * 60000, CAMPUS.a), "南门");
  assert.equal(arrivalStopAt(trip, arrMs + 4 * 60000, CAMPUS.a), "西门");
  assert.equal(arrivalStopAt(trip, arrMs + 61 * 60000, CAMPUS.a), "西门");
  const tripC = { id: "h", route: "c", dep: "12:00", price: "¥10.00", rainbow: false, depMs, arrMs };
  assert.equal(arrivalStopAt(tripC, arrMs + 1 * 60000, CAMPUS.c), "东校区");
  assert.equal(arrivalStopAt(tripC, arrMs + 3 * 60000, CAMPUS.c), "北校区");
  assert.equal(arrivalStopAt(tripC, arrMs + 5 * 60000, CAMPUS.c), "南校区");
  assert.equal(arrivalStopAt(tripC, arrMs + 30 * 60000, CAMPUS.c), "南校区");
  assert.equal(arrivalStopAt(tripC, arrMs - 1 * 60000, CAMPUS.c), null);
});

test("tripLocation: 校内 / 路上距下一站 / 已到达（停站推进）", () => {
  const depMs = depToMs("12:00", new Date("2026-09-01T10:00:00+08:00"));
  const trip = { id: "g", route: "a", dep: "12:00", price: "¥10.00", rainbow: false, depMs, arrMs: depMs + 60 * 60000 };
  assert.equal(tripLocation(trip, depMs - 5 * 60000, CHECKPOINTS.a, CAMPUS.a).text, "开始上车");
  // 等待发车：位置显示出发点（良乡=东校区上车点）
  const wait = tripLocation(trip, depMs - 12 * 60000, CHECKPOINTS.a, CAMPUS.a);
  assert.equal(wait.kind, "wait");
  assert.match(wait.text, /东校区上车点/);
  const road = tripLocation(trip, depMs + 20 * 60000, CHECKPOINTS.a, CAMPUS.a);
  assert.equal(road.kind, "road");
  assert.match(road.text, /距/);
  assert.match(road.text, /分钟/);
  const arr1 = tripLocation(trip, trip.arrMs + 1 * 60000, CHECKPOINTS.a, CAMPUS.a);
  assert.equal(arr1.kind, "arrived");
  assert.match(arr1.text, /南门/);
  const arr2 = tripLocation(trip, trip.arrMs + 15 * 60000, CHECKPOINTS.a, CAMPUS.a);
  assert.equal(arr2.kind, "arrived");
  assert.match(arr2.text, /西门/);
});

test("fidsStatus: 等待发车 / 催促上车 / 已出发 / 已到达 四态", () => {
  const depMs = depToMs("12:00", new Date("2026-09-01T10:00:00+08:00"));
  const trip = { id: "g", route: "a", dep: "12:00", price: "¥10.00", rainbow: false, depMs, arrMs: depMs + 60 * 60000 };
  assert.deepEqual(fidsStatus(trip, depMs - 6 * 60000), { phase: "wait", label: "等待发车" });
  assert.deepEqual(fidsStatus(trip, depMs - 60 * 1000), { phase: "urge", label: "催促上车" });
  assert.deepEqual(fidsStatus(trip, depMs + 30 * 60000), { phase: "dep", label: "已出发" });
  assert.deepEqual(fidsStatus(trip, depMs + 61 * 60000), { phase: "arr", label: "已到达" });
});
