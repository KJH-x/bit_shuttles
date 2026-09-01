import test from "node:test";
import assert from "node:assert/strict";
import { ROUTES, TRIPS, DURATION_MIN, DURATION_BY_ROUTE, DURATION_PROFILES } from "../schedule-data.js";
import { tripStatus, computeAll, tripDuration, depToMs, formatDurationLabel, formatClock, formatHM, formatHMS, ticketInfo, lookupDuration } from "../lib/schedule.js";

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
  assert.equal(ROUTES.length, 2, "回龙观 route removed");
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
  const trip = { id: "y", route: "a", dep: "12:00", price: "¥10.00", rainbow: false, dur: 90 };
  const base = depToMs("12:00", new Date("2026-09-01T10:00:00+08:00"));
  assert.equal(tripDuration(trip, DURATION_BY_ROUTE, DURATION_MIN), 90);
  const running = tripStatus(trip, base + 45 * 60000, DURATION_BY_ROUTE, DURATION_MIN);
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

test("tripDuration: route c uses profile, route a uses profile", () => {
  const tripC = { id: "c1", route: "c", dep: "17:20", price: "¥10.00", rainbow: false };
  assert.equal(tripDuration(tripC, DURATION_BY_ROUTE, DURATION_MIN, DURATION_PROFILES), 80);
  const tripA = { id: "a1", route: "a", dep: "17:20", price: "¥10.00", rainbow: false };
  assert.equal(tripDuration(tripA, DURATION_BY_ROUTE, DURATION_MIN, DURATION_PROFILES), 53);
});

test("tripStatus: route c arrival reflects profile duration", () => {
  const base = depToMs("17:20", new Date("2026-09-01T16:00:00+08:00"));
  const tripC = { id: "c16", route: "c", dep: "17:20", price: "¥10.00", rainbow: false };
  const st = tripStatus(tripC, base + 40 * 60000, DURATION_BY_ROUTE, DURATION_MIN, DURATION_PROFILES);
  assert.equal(st.arrMs - st.depMs, 80 * 60000);
  assert.equal(st.status, "running");
  assert.ok(Math.abs(st.progress - 0.5) < 1e-9);
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
  assert.equal(formatDurationLabel(15 * 1000), "即将");
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
