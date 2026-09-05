import test from "node:test";
import assert from "node:assert/strict";
import {
  paidPhaseTtl,
  freeTtl,
  isVisible,
  applyVisibility,
  minTtl,
  depToMs,
  beijingDateStr,
  NAME_TO_ROUTE
} from "../functions/_shared/ttl.js";
import {
  tripRatio,
  dayAvgRatio,
  foldInto,
  emptyCumulative,
  cumulativeAvg,
  trafficView,
  groupOf,
  shiftDate
} from "../functions/_shared/metrics.js";
import { md5Hex } from "../functions/_shared/md5.js";
import { sign } from "../functions/_shared/school.js";

const MIN = 60000;
const T = Date.UTC(2026, 8, 4, 10, 0, 0) - 8 * 3600 * 1000; // Beijing 2026-09-04 10:00

test("md5: 双重 MD5 签名与实测一致", () => {
  const secret = "test-secret-not-production";
  const t = "1788489975368";
  const expected = md5Hex(md5Hex(secret + t));
  assert.equal(md5Hex(md5Hex(secret + t)), expected);
  const sig = sign(secret, Number(t));
  assert.equal(sig.apitime, "1788489975368");
  assert.equal(sig.apitoken, expected);
  // 生产 secret 回归：仅当显式提供 SCHOOL_TEST_SECRET 时校验（避免硬编码进仓库）
  const prod = process.env.SCHOOL_TEST_SECRET;
  if (prod) {
    assert.equal(md5Hex(md5Hex(prod + t)), "827b8c0fbe6fb0118ec55e31df7c8bb5");
  }
});

test("paidPhaseTtl: 各阶段边界（T-70min / T-60min / T-50min / T-5min）", () => {
  const pre = 70 * MIN, open = 60 * MIN, plus = 10 * MIN, stop = 5 * MIN;
  assert.deepEqual(paidPhaseTtl(T - pre - 1, T), { phase: "presale", ttl: 3600 });
  assert.deepEqual(paidPhaseTtl(T - pre + 1, T), { phase: "preboard", ttl: 180 });
  assert.deepEqual(paidPhaseTtl(T - open + 1, T), { phase: "onsale", ttl: 20 });
  assert.deepEqual(paidPhaseTtl(T - open + plus - 1, T), { phase: "onsale", ttl: 20 });
  assert.deepEqual(paidPhaseTtl(T - open + plus + 1, T), { phase: "regular", ttl: 180 });
  assert.deepEqual(paidPhaseTtl(T - stop - 1, T), { phase: "regular", ttl: 180 });
  assert.deepEqual(paidPhaseTtl(T - stop + 1, T), { phase: "closed", ttl: null });
});

test("freeTtl: 2h / 30min / 1day（Q4）", () => {
  assert.equal(freeTtl(T - 4 * 3600 * 1000, T, true), 7200);
  assert.equal(freeTtl(T - 2 * 3600 * 1000, T, true), 1800);
  assert.equal(freeTtl(T - 1 * 60000, T, true), 1800);
  assert.equal(freeTtl(T - 3600 * 1000, T, false), 86400);
  assert.equal(freeTtl(T + 60000, T, true), 86400);
});

test("isVisible: 3h 窗口", () => {
  assert.equal(isVisible(T, T), true);
  assert.equal(isVisible(T - 180 * 60000, T), true);
  assert.equal(isVisible(T - 180 * 60000 - 1, T), false);
  assert.equal(isVisible(T + 1000, T), false);
});

test("minTtl: 双向同 T 取最小", () => {
  assert.equal(minTtl([3600, 180, 20]), 20);
  assert.equal(minTtl([null, null]), null);
  assert.equal(minTtl([180, null]), 180);
});

test("depToMs / beijingDateStr 往返一致", () => {
  const dateStr = beijingDateStr(T);
  assert.equal(dateStr, "2026-09-04");
  assert.equal(depToMs("10:00", dateStr), T);
});

test("NAME_TO_ROUTE: 四向映射", () => {
  assert.equal(NAME_TO_ROUTE["良乡校区-中关村校区"], "a");
  assert.equal(NAME_TO_ROUTE["中关村校区-良乡校区"], "c");
  assert.equal(NAME_TO_ROUTE["中关村校区-西山校区"], "d");
  assert.equal(NAME_TO_ROUTE["西山校区-中关村校区"], "e");
});

test("tripRatio / dayAvgRatio", () => {
  assert.equal(tripRatio({ available: 20, total: 50 }), 0.4);
  assert.equal(tripRatio({ available: null, total: 50 }), null);
  assert.equal(tripRatio({ available: 10, total: 0 }), null);
  assert.equal(dayAvgRatio([{ available: 10, total: 20 }, { available: 30, total: 60 }]), 0.5);
  assert.equal(dayAvgRatio([]), null);
});

test("foldInto / cumulativeAvg: 按工作日周末分组，天数加权", () => {
  let cum = emptyCumulative();
  cum = foldInto(cum, "2026-09-01", 0.5); // 周二 工作日
  cum = foldInto(cum, "2026-09-02", 0.7);
  cum = foldInto(cum, "2026-09-05", 0.2); // 周六 周末
  assert.equal(cum.weekday.days, 2);
  assert.equal(cum.weekday.sumRatio, 1.2);
  assert.equal(cumulativeAvg(cum, "weekday"), 0.6);
  assert.equal(cumulativeAvg(cum, "weekend"), 0.2);
  assert.equal(groupOf("2026-09-05"), "weekend");
  assert.equal(groupOf("2026-09-07"), "weekday");
});

test("trafficView: 客流升高=红 up / 降低=绿 down", () => {
  // 今日比例 0.4 < 同期 0.6 → 更挤 → up/red
  const up = trafficView(0.4, 0.6);
  assert.equal(up.delta, "33%");
  assert.equal(up.dir, "up");
  assert.equal(up.color, "red");
  assert.ok(Math.abs(up.raw + 1 / 3) < 1e-9);
  // 今日比例 0.7 > 同期 0.5 → 更空 → down/green
  const down = trafficView(0.7, 0.5);
  assert.equal(down.delta, "40%");
  assert.equal(down.dir, "down");
  assert.equal(down.color, "green");
  assert.equal(trafficView(null, 0.5), null);
  assert.equal(trafficView(0.5, null), null);
});

test("applyVisibility: 缓存里冻结的 available=null 按当前时刻重算（窗口内恢复数字）", () => {
  const date = "2026-09-04";
  const T = depToMs("18:00", date);
  // 快照时为窗口外（T-now>3h）→ available=null 被写入缓存
  const cached = { route: "a", dep: "18:00", paid: true, bookable: 12, available: null, total: 51, pct: 24 };
  // 现在进入窗口（T-now=1h）→ 重算恢复数字
  const inside = applyVisibility(cached, T - 60 * 60000, date);
  assert.equal(inside.available, 12);
  // 仍窗口外 → 保持 null（值未变，常返回同一对象引用）
  assert.equal(applyVisibility(cached, T - 4 * 3600 * 1000, date), cached);
});

test("applyVisibility: 免费班次 / 无 bookable 的老缓存原样返回", () => {
  const date = "2026-09-04";
  const freeTrip = { route: "a", dep: "18:00", paid: false, bookable: 5, available: 5, total: 51 };
  assert.equal(applyVisibility(freeTrip, Date.now(), date), freeTrip);
  const legacy = { route: "a", dep: "18:00", paid: true, available: null, total: 51, pct: 24 };
  assert.equal(applyVisibility(legacy, Date.now(), date), legacy);
  assert.equal(applyVisibility(null, Date.now(), date), null);
  assert.deepEqual(applyVisibility({}, Date.now(), date), {});
});

test("shiftDate: 前后偏移", () => {
  assert.equal(shiftDate("2026-09-04", 5), "2026-09-09");
  assert.equal(shiftDate("2026-09-04", -8), "2026-08-27");
  assert.equal(shiftDate("2026-01-01", -1), "2025-12-31");
});
