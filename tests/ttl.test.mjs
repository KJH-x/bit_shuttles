import test from "node:test";
import assert from "node:assert/strict";
import {
  paidPhaseTtl,
  freeTtl,
  isVisible,
  applyVisibility,
  minTtl,
  depToMs,
  dateStartMs,
  beijingDateStr,
  futureDayTtl,
  historyTripView,
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
  shiftDate,
  tripUsed,
  tripLoadRatio,
  dayLoadSeatWeighted,
  emptyLoadCumulative,
  foldLoadInto,
  cumulativeLoadAvg
} from "../functions/_shared/metrics.js";
import { md5Hex } from "../functions/_shared/md5.js";
import { sign } from "../functions/_shared/school.js";
import { mainAvailText } from "../lib/availability.js";

const MIN = 60000;
const T = Date.UTC(2026, 8, 4, 10, 0, 0) - 8 * 3600 * 1000; // Beijing 2026-09-04 10:00

test("md5: 双重 MD5 签名与独立预计算摘要一致", () => {
  const secret = "test-secret-not-production";
  const t = "1788489975368";
  // 独立预计算（PowerShell/openssl 一致）：md5(md5(secret+t))
  assert.equal(md5Hex(md5Hex(secret + t)), "dcd78a8ea923b483dd3ef4b31d2f105a");
  const sig = sign(secret, Number(t));
  assert.equal(sig.apitime, "1788489975368");
  assert.equal(sig.apitoken, "dcd78a8ea923b483dd3ef4b31d2f105a");
  // 生产 secret 回归：仅当显式提供 SCHOOL_TEST_SECRET 时校验（避免硬编码进仓库）
  const prod = process.env.SCHOOL_TEST_SECRET;
  if (prod) {
    assert.equal(md5Hex(md5Hex(prod + t)), "827b8c0fbe6fb0118ec55e31df7c8bb5");
  }
});

test("paidPhaseTtl: 各阶段边界（T-70min / T-60min / T-50min / T-5min）", () => {
  const pre = 70 * MIN, open = 60 * MIN, plus = 10 * MIN, stop = 5 * MIN;
  assert.deepEqual(paidPhaseTtl(T - pre - 1, T), { phase: "presale", ttl: 300 });
  assert.deepEqual(paidPhaseTtl(T - pre + 1, T), { phase: "preboard", ttl: 180 });
  assert.deepEqual(paidPhaseTtl(T - open + 1, T), { phase: "onsale", ttl: 20 });
  assert.deepEqual(paidPhaseTtl(T - open + plus - 1, T), { phase: "onsale", ttl: 20 });
  assert.deepEqual(paidPhaseTtl(T - open + plus + 1, T), { phase: "regular", ttl: 60 });
  assert.deepEqual(paidPhaseTtl(T - stop - 1, T), { phase: "regular", ttl: 60 });
  assert.deepEqual(paidPhaseTtl(T - stop + 1, T), { phase: "closed", ttl: null });
});

test("freeTtl: 全部封顶 5 分钟（v1.25）", () => {
  assert.equal(freeTtl(T - 4 * 3600 * 1000, T, true), 300);
  assert.equal(freeTtl(T - 2 * 3600 * 1000, T, true), 300);
  assert.equal(freeTtl(T - 1 * 60000, T, true), 300);
  assert.equal(freeTtl(T - 3600 * 1000, T, false), 300);
  assert.equal(freeTtl(T + 60000, T, true), 300);
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

test("applyVisibility: bookable 为负（超额售罄）时 available clamp 到 0", () => {
  const date = "2026-09-04";
  const T = depToMs("18:00", date);
  // 源站 reservation_num=1、disable=3 → bookable=-2（售罄）
  const cached = { route: "c", dep: "18:00", paid: true, bookable: -2, available: 0, total: 48, pct: 0 };
  const now = T - 60 * 60000; // 窗口内
  const out = applyVisibility(cached, now, date);
  assert.equal(out.available, 0); // clamp 非负数
  // 窗口外 → null（不展示数字）
  const out2 = applyVisibility(cached, T - 4 * 3600 * 1000, date);
  assert.equal(out2.available, null);
});

test("shiftDate: 前后偏移", () => {
  assert.equal(shiftDate("2026-09-04", 5), "2026-09-09");
  assert.equal(shiftDate("2026-09-04", -8), "2026-08-27");
  assert.equal(shiftDate("2026-01-01", -1), "2025-12-31");
});

test("mainAvailText: 窗口外售罄班次（available=null, bookable≤0）显示「售罄」而非消失", () => {
  // 窗口外：available=null、pct=0、bookable<=0（源站售罄）→ 必须显示「售罄」
  const soldOutOutside = mainAvailText({
    route: "c", dep: "07:30",
    avail: { route: "c", dep: "07:30", paid: true, available: null, bookable: -2, total: 48, pct: 0 }
  });
  assert.deepEqual(soldOutOutside, { value: "售罄", color: "red" });

  // 窗口外非售罄：available=null、pct>0 → 显示百分比
  const pctOnly = mainAvailText({
    route: "a", dep: "07:50",
    avail: { route: "a", dep: "07:50", paid: true, available: null, bookable: 4, total: 48, pct: 8 }
  });
  assert.deepEqual(pctOnly, { value: "8%", color: "" });

  // 窗口内售罄：available=0 → 售罄
  const soldOutIn = mainAvailText({
    route: "c", dep: "20:00",
    avail: { route: "c", dep: "20:00", paid: true, available: 0, bookable: 0, total: 48, pct: 0 }
  });
  assert.deepEqual(soldOutIn, { value: "售罄", color: "red" });

  // 窗口内有余：available>0 → 数字
  const count = mainAvailText({
    route: "a", dep: "20:15",
    avail: { route: "a", dep: "20:15", paid: true, available: 20, bookable: 20, total: 48, pct: 42 }
  });
  assert.deepEqual(count, { value: "20", color: "green" });
});

test("dateStartMs: 某日 Beijing 零点 epoch", () => {
  assert.equal(dateStartMs("2026-09-11"), Date.UTC(2026, 8, 11) - 8 * 3600 * 1000);
  assert.equal(depToMs("00:00", "2026-09-11"), dateStartMs("2026-09-11"));
  assert.equal(depToMs("08:30", "2026-09-11"), dateStartMs("2026-09-11") + 8.5 * 3600 * 1000);
});

test("futureDayTtl: 距该日 3h 前=1 天；活跃窗口=1 小时；结束后=null", () => {
  const start = dateStartMs("2026-09-11");
  const H = 3600 * 1000;
  assert.equal(futureDayTtl(start - 4 * H, "2026-09-11"), 86400);
  assert.equal(futureDayTtl(start - 3 * H - 1, "2026-09-11"), 86400);
  assert.equal(futureDayTtl(start - 3 * H + 1, "2026-09-11"), 3600);
  assert.equal(futureDayTtl(start + 20 * H, "2026-09-11"), 3600);
  assert.equal(futureDayTtl(start + 21 * H - 1, "2026-09-11"), 3600);
  assert.equal(futureDayTtl(start + 21 * H + 1, "2026-09-11"), null);
});

test("historyTripView: 历史口径不套 3h 窗口，用 bookable 直接展示", () => {
  const paid = { route: "a", dep: "07:50", paid: true, bookable: 12, available: null, total: 48 };
  const v = historyTripView(paid);
  assert.equal(v.available, 12);
  assert.equal(v.visible, true);
  // 超额售罄 → clamp 0
  assert.equal(historyTripView({ ...paid, bookable: -2 }).available, 0);
  // 免费班次 / 无 bookable 旧快照 / null → 原样
  const free = { route: "a", dep: "06:20", paid: false, available: 5, total: 48 };
  assert.equal(historyTripView(free), free);
  const legacy = { route: "a", dep: "07:50", paid: true, available: null, total: 48 };
  assert.equal(historyTripView(legacy), legacy);
  assert.equal(historyTripView(null), null);
  // paid+bookable 且 available 已一致 → 不复制（同一引用）
  const already = { route: "a", dep: "07:50", paid: true, bookable: 5, available: 5, visible: true };
  assert.equal(historyTripView(already), already);
});

test("groupOf: 法定节假日按周末分组、调休补班按工作日分组", () => {
  assert.equal(groupOf("2026-09-25"), "weekend"); // 中秋周五
  assert.equal(groupOf("2026-10-01"), "weekend"); // 国庆
  assert.equal(groupOf("2026-09-20"), "weekday"); // 调休补班周日
  assert.equal(groupOf("2026-09-07"), "weekday"); // 普通周一（存量回归）
  assert.equal(groupOf("2026-09-05"), "weekend"); // 普通周六（存量回归）
});

test("满载率：tripUsed / tripLoadRatio / dayLoadSeatWeighted（座位加权）", () => {
  assert.deepEqual(tripUsed({ total: 48, bookable: 12 }), { used: 36, total: 48 });
  assert.deepEqual(tripUsed({ total: 48, bookable: -3 }), { used: 48, total: 48 }); // bookable clamp
  assert.deepEqual(tripUsed({ total: 48, available: 20 }), { used: 28, total: 48 }); // 旧快照无 bookable 用 available
  assert.equal(tripUsed({ total: 0, available: 1 }), null);
  assert.equal(tripUsed({ total: 48, available: null }), null);
  assert.equal(tripLoadRatio({ total: 48, bookable: 12 }), 36 / 48);
  const day = dayLoadSeatWeighted([
    { total: 50, bookable: 25 },
    { total: 50, bookable: 0 }
  ]);
  assert.equal(day.sumUsed, 75);
  assert.equal(day.sumTotal, 100);
  assert.equal(day.ratio, 0.75);
  // 与简单平均对比：一趟 48 座全满 + 一趟 48 座全空 → 简单平均 0.5，座位加权 0.5（两趟同容量时相等）
  assert.equal(dayAvgRatio([{ total: 48, available: 0 }, { total: 48, available: 48 }]), 0.5);
});

test("满载率累计：foldLoadInto / cumulativeLoadAvg（座位加权，天数累计）", () => {
  let cum = emptyLoadCumulative();
  cum = foldLoadInto(cum, "2026-09-01", { sumUsed: 10, sumTotal: 100, ratio: 0.1 }); // 工作日
  cum = foldLoadInto(cum, "2026-09-02", { sumUsed: 40, sumTotal: 100, ratio: 0.4 });
  cum = foldLoadInto(cum, "2026-09-05", { sumUsed: 60, sumTotal: 100, ratio: 0.6 }); // 周末
  assert.equal(cum.weekday.days, 2);
  assert.equal(cum.weekday.sumUsed, 50);
  assert.equal(cum.weekday.sumTotal, 200);
  assert.equal(cumulativeLoadAvg(cum, "weekday"), 0.25);
  assert.equal(cumulativeLoadAvg(cum, "weekend"), 0.6);
  assert.equal(cumulativeLoadAvg(emptyLoadCumulative(), "weekday"), null);
  // 节假日折入周末桶（与 groupOf 一致）
  let cum2 = emptyLoadCumulative();
  cum2 = foldLoadInto(cum2, "2026-09-25", { sumUsed: 10, sumTotal: 50, ratio: 0.2 });
  assert.equal(cum2.weekend.days, 1);
  assert.equal(cumulativeLoadAvg(cum2, "weekend"), 0.2);
});
