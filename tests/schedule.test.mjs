import test from "node:test";
import assert from "node:assert/strict";
import { ROUTES, TRIPS, DURATION_MIN, DURATION_BY_ROUTE } from "../schedule-data.js";
import { tripStatus, computeAll, tripDuration, depToMs, formatDurationLabel, formatClock, formatHM } from "../lib/schedule.js";

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
  assert.ok(byRoute("b").length >= 1, "route b (回龙观→良乡) has a trip");
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
