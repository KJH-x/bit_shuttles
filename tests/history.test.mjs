import test from "node:test";
import assert from "node:assert/strict";
import {
  writeSnapshot,
  readSnapshot,
  writeLiveCache,
  readLiveCache,
  writeMetaCache,
  readMetaCache,
  writeTripCache,
  readTripCache,
  writeLastFailed,
  rollupExpiredSnapshots,
  trafficForToday,
  readLoadCumulative,
  listSnapshotDates
} from "../functions/_shared/history.js";
import { emptyCumulative, foldInto, dayAvgRatio } from "../functions/_shared/metrics.js";

// 内存 R2 mock（get/put/list/delete），形状对齐 workerd R2Bucket 常用子集
function memoryBucket(initial = {}) {
  const store = new Map(Object.entries(initial));
  return {
    store,
    async get(key) {
      const v = store.get(key);
      if (v == null) return null;
      return { text: async () => v };
    },
    async put(key, value) {
      store.set(key, String(value));
    },
    async delete(key) {
      store.delete(key);
    },
    async list({ prefix = "", cursor } = {}) {
      const keys = [...store.keys()].filter((k) => k.startsWith(prefix)).sort();
      const start = cursor ? Number(cursor) : 0;
      return { objects: keys.slice(start).map((key) => ({ key })), cursor: undefined };
    }
  };
}

test("writeSnapshot/readSnapshot 往返", async () => {
  const b = memoryBucket();
  await writeSnapshot(b, "2026-09-04", [{ route: "a", dep: "07:30", available: 10, total: 51 }]);
  const snap = await readSnapshot(b, "2026-09-04");
  assert.equal(snap.date, "2026-09-04");
  assert.equal(snap.trips.length, 1);
  assert.equal(await readSnapshot(b, "2026-09-03"), null);
});

test("live/meta/trip cache 读写与 fetchedAt", async () => {
  const b = memoryBucket();
  await writeLiveCache(b, "2026-09-04", { minTtl: 60, trips: [] });
  const live = await readLiveCache(b, "2026-09-04");
  assert.equal(live.minTtl, 60);
  assert.ok(typeof live.fetchedAt === "number");

  await writeMetaCache(b, "2026-09-04", [{ id: "x" }]);
  assert.equal((await readMetaCache(b, "2026-09-04")).rows.length, 1);

  await writeTripCache(b, "2026-09-04", "a", "07:30", { available: 5 });
  const t = await readTripCache(b, "2026-09-04", "a", "07:30");
  assert.equal(t.available, 5);
  assert.ok(typeof t.fetchedAt === "number");
});

test("writeLastFailed 覆盖写", async () => {
  const b = memoryBucket();
  await writeLastFailed(b, { date: "2026-09-04", error: "boom", attempts: 3 });
  const v = JSON.parse(b.store.get("avail/last-failed.json"));
  assert.equal(v.error, "boom");
  assert.equal(v.attempts, 3);
});

test("rollupExpiredSnapshots: 7 天内保留，超期折入累计（按工作日/周末）并删除", async () => {
  const b = memoryBucket();
  // 8 天前（2026-08-27，周四=工作日）应折入
  await writeSnapshot(b, "2026-08-27", [
    { route: "a", dep: "07:30", available: 25, total: 51 },
    { route: "a", dep: "08:00", available: 51, total: 51 }
  ]);
  // 今日（2026-09-04，周五）应保留
  await writeSnapshot(b, "2026-09-04", [{ route: "a", dep: "07:30", available: 10, total: 51 }]);

  const cum = await rollupExpiredSnapshots(b, "2026-09-04");
  // 8-27 ratio = (25/51 + 51/51)/2 = (0.490 + 1)/2 ≈ 0.745
  const expectedRatio = dayAvgRatio([
    { available: 25, total: 51 },
    { available: 51, total: 51 }
  ]);
  assert.equal(cum.weekday.days, 1);
  assert.ok(Math.abs(cum.weekday.sumRatio - expectedRatio) < 1e-9);
  // 超期快照被删除，今日保留
  assert.equal(await readSnapshot(b, "2026-08-27"), null);
  assert.ok((await readSnapshot(b, "2026-09-04")) != null);
});

test("rollupExpiredSnapshots: 仅 < cutoff 折入，边界（正好 7 天前）不折", async () => {
  const b = memoryBucket();
  await writeSnapshot(b, "2026-08-28", [{ route: "a", dep: "07:30", available: 10, total: 51 }]); // 正好 7 天前
  const cum = await rollupExpiredSnapshots(b, "2026-09-04");
  assert.equal(cum.weekday.days, 0);
  assert.ok((await readSnapshot(b, "2026-08-28")) != null);
});

test("trafficForToday: 无累计历史 → baseRatio null", async () => {
  const b = memoryBucket();
  const t = await trafficForToday(b, "2026-09-04", [{ route: "a", dep: "07:30", available: 10, total: 51 }]);
  assert.equal(t.baseRatio, null);
  assert.equal(t.todayRatio, 10 / 51);
});

test("trafficForToday: 有累计 → 输出红/绿箭头", async () => {
  const b = memoryBucket();
  // 预置累计：工作日 3 天，平均比例 0.5
  let cum = emptyCumulative();
  for (const r of [0.4, 0.5, 0.6]) cum = foldInto(cum, "2026-09-01", r);
  b.store.set("avail/cumulative.json", JSON.stringify(cum));
  // 今日比例 0.2（更挤）→ dir=up, color=red
  const t = await trafficForToday(b, "2026-09-04", [{ route: "a", dep: "07:30", available: 10, total: 51 }]);
  assert.equal(t.dir, "up");
  assert.equal(t.color, "red");
  assert.ok(Math.abs(t.baseRatio - 0.5) < 1e-9);
  assert.equal(t.todayRatio, 10 / 51);
});

test("writeSnapshot: 空快照不覆盖已有非空快照（防空污染）", async () => {
  const b = memoryBucket();
  await writeSnapshot(b, "2026-09-04", [{ route: "a", dep: "07:30", available: 10, total: 51 }]);
  await writeSnapshot(b, "2026-09-04", []);
  const snap = await readSnapshot(b, "2026-09-04");
  assert.equal(snap.trips.length, 1, "空快照不应覆盖非空快照");
  // 无既有快照时允许写空（记录当日无数据）
  await writeSnapshot(b, "2026-09-05", []);
  assert.equal((await readSnapshot(b, "2026-09-05")).trips.length, 0);
});

test("rollupExpiredSnapshots: 同步折入座位加权满载率累计（load-cumulative.json）", async () => {
  const b = memoryBucket();
  // 8 天前（工作日）：两趟 50 座，一趟满员一趟半满 → sumUsed=75, sumTotal=100
  await writeSnapshot(b, "2026-08-27", [
    { route: "a", dep: "07:30", paid: true, available: 0, bookable: 0, total: 50 },
    { route: "a", dep: "08:00", paid: true, available: 25, bookable: 25, total: 50 }
  ]);
  await rollupExpiredSnapshots(b, "2026-09-04");
  const loadCum = await readLoadCumulative(b);
  assert.equal(loadCum.weekday.days, 1);
  assert.equal(loadCum.weekday.sumUsed, 75);
  assert.equal(loadCum.weekday.sumTotal, 100);
});

test("listSnapshotDates: 仅列 < 今日、降序、带 hasTrips", async () => {
  const b = memoryBucket();
  await writeSnapshot(b, "2026-09-04", [{ route: "a", dep: "07:30", available: 10, total: 51 }]);
  await writeSnapshot(b, "2026-09-05", []); // 空快照
  await writeSnapshot(b, "2026-09-09", [{ route: "a", dep: "07:30", available: 10, total: 51 }]);
  const dates = await listSnapshotDates(b, "2026-09-09"); // 今日 09-09 不入列
  assert.deepEqual(dates, [
    { date: "2026-09-05", hasTrips: false },
    { date: "2026-09-04", hasTrips: true }
  ]);
});
