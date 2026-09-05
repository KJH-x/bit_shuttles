import test from "node:test";
import assert from "node:assert/strict";
import { trafficForRoute, realtimeDurMin, markerProgress, laneGradient, normalizeTraffic } from "../lib/traffic.js";

const T0 = 1788537600000;

const LIVE = {
  available: true,
  fetchedAt: T0,
  dirs: {
    fwd: {
      etaSec: 3180,
      distM: 36489,
      segments: [
        { name: "S1", distM: 17022, weighted: 1.1, color: "green", k: 1.0, etaSec: 1484 },
        { name: "S2", distM: 10165, weighted: 2.0, color: "yellow", k: 1.4, etaSec: 1030 },
        { name: "S3", distM: 9302, weighted: 3.0, color: "orange", k: 1.9, etaSec: 666 }
      ]
    },
    rev: {
      etaSec: 3722,
      distM: 36773,
      segments: [
        { name: "S1", distM: 17022, weighted: 1.1, color: "green", k: 1.0, etaSec: 1580 },
        { name: "S2", distM: 10165, weighted: 2.0, color: "yellow", k: 1.4, etaSec: 1190 },
        { name: "S3", distM: 9302, weighted: 3.0, color: "orange", k: 1.9, etaSec: 952 }
      ]
    }
  }
};

const NO_DATA = { available: false };

const depMs = T0 + 600 * 60000;
const tripUp = { id: "x", route: "a", dep: "12:00", depMs, arrMs: depMs + 3180 * 1000, progress: 0 };
const tripMid = { id: "y", route: "a", dep: "12:00", depMs, arrMs: depMs + 3180 * 1000, progress: 0.5 };

test("trafficForRoute: a → fwd, c → rev", () => {
  assert.equal(trafficForRoute(LIVE, "a"), LIVE.dirs.fwd);
  assert.equal(trafficForRoute(LIVE, "c"), LIVE.dirs.rev);
});

test("trafficForRoute: invalid route or data → null", () => {
  assert.equal(trafficForRoute(LIVE, "d"), null);
  assert.equal(trafficForRoute(LIVE, "b"), null);
  assert.equal(trafficForRoute(null, "a"), null);
  assert.equal(trafficForRoute(NO_DATA, "a"), null);
});

test("realtimeDurMin: fresh data returns etaSec/60", () => {
  assert.equal(realtimeDurMin(LIVE, "a", T0 + 60000), 53);
  assert.equal(realtimeDurMin(LIVE, "c", T0 + 60000), 3722 / 60);
});

test("realtimeDurMin: stale data returns null", () => {
  assert.equal(realtimeDurMin(LIVE, "a", T0 + 31 * 60000), null);
});

test("realtimeDurMin: unavailable data returns null", () => {
  assert.equal(realtimeDurMin(NO_DATA, "a", T0 + 60000), null);
  assert.equal(realtimeDurMin(null, "a", T0 + 60000), null);
});

test("markerProgress: at departure → 0, at arrival → 1", () => {
  assert.equal(markerProgress(tripUp, LIVE, depMs), 0);
  assert.equal(markerProgress(tripUp, LIVE, depMs + 3180 * 1000), 1);
});

test("markerProgress: segment-by-segment distance interpolation", () => {
  const p = markerProgress(tripUp, LIVE, depMs + 1484 * 1000);
  assert.ok(Math.abs(p - 17022 / 36489) < 1e-6);
});

test("markerProgress: no live data falls back to trip.progress", () => {
  assert.equal(markerProgress(tripMid, null, depMs + 1000), 0.5);
  assert.equal(markerProgress(tripMid, NO_DATA, depMs + 1000), 0.5);
});

test("laneGradient: fwd (a) S1→S2→S3 with rounded stops", () => {
  const g = laneGradient(LIVE.dirs.fwd.segments, "a");
  assert.ok(g.startsWith("linear-gradient(90deg, "));
  assert.ok(g.includes("rgba(74,222,128,.38) 0 46.6%"));
  assert.ok(g.includes("rgba(250,204,21,.38) 46.6% 74.5%"));
  assert.ok(g.includes("rgba(251,146,60,.38) 74.5% 100%"));
  assert.equal(g.split("%, ").length, 3);
});

test("laneGradient: rev (c) reverses stop order to S3→S2→S1", () => {
  const g = laneGradient(LIVE.dirs.rev.segments, "c");
  const orangeIdx = g.indexOf("rgba(251,146,60,.38)");
  const greenIdx = g.indexOf("rgba(74,222,128,.38)");
  assert.ok(orangeIdx >= 0 && greenIdx >= 0, "both S3 and S1 colors present");
  assert.ok(orangeIdx < greenIdx, "S3 color appears before S1 color");
});

test("laneGradient: empty or invalid segments → empty string", () => {
  assert.equal(laneGradient([], "a"), "");
  assert.equal(laneGradient(null, "a"), "");
});

test("normalizeTraffic: valid response is kept normalized", () => {
  assert.deepEqual(normalizeTraffic(LIVE), {
    available: true,
    fetchedAt: T0,
    dirs: { fwd: LIVE.dirs.fwd, rev: LIVE.dirs.rev }
  });
});

test("normalizeTraffic: null / missing availability → { available:false }", () => {
  assert.deepEqual(normalizeTraffic(null), { available: false });
  assert.deepEqual(normalizeTraffic({}), { available: false });
  assert.deepEqual(normalizeTraffic(NO_DATA), { available: false });
});

test("normalizeTraffic: missing dirs entries become null", () => {
  const partial = normalizeTraffic({ available: true });
  assert.equal(partial.available, true);
  assert.equal(partial.dirs.fwd, null);
  assert.equal(partial.dirs.rev, null);
});
