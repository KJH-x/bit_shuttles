import test from "node:test";
import assert from "node:assert/strict";
import { computeTrip } from "../functions/api/availability.js";

// 固定 Beijing 日期与时刻（UTC+8）
const DATE = "2026-09-04";
// Beijing 2026-09-04 10:00（UTC）= 2026-09-04T02:00:00Z
const NOW = Date.UTC(2026, 8, 4, 2, 0, 0);

// 良乡→中关村 12:00（付费，普通车）
const ROW = {
  name: "良乡校区-中关村校区",
  origin_time: "12:00",
  type: "0",
  teacher_ticket_price: "10.0"
};

function seat(over = {}) {
  return { reserved_count: 48, reservation_num: 51, disable_seat: [1, 2, 49], ...over };
}

test("computeTrip: 真实余票 = reservation_num − disable 数（Q1/Q4 口径）", () => {
  const t = computeTrip(ROW, seat(), NOW, DATE, true);
  assert.equal(t.route, "a");
  assert.equal(t.dep, "12:00");
  assert.equal(t.paid, true);
  assert.equal(t.rainbow, false);
  assert.equal(t.bookable, 51 - 3); // 48
  assert.equal(t.total, 48 + 51 - 3); // 96
  assert.equal(t.available, 48);
  assert.equal(t.pct, Math.round((48 / 96) * 100)); // 50
});

test("computeTrip: 免费班次恒有 available（不受 3h 窗口限制）", () => {
  const row = { ...ROW, teacher_ticket_price: "0.0" };
  const tMs = Date.UTC(2026, 8, 4, 12, 0, 0) - 8 * 3600 * 1000; // Beijing 12:00
  // 距发车 4h（>3h 窗口外）
  const t = computeTrip(row, seat(), tMs - 4 * 3600 * 1000, DATE, true);
  assert.equal(t.paid, false);
  assert.equal(t.phase, "free");
  assert.equal(t.visible, false);
  assert.equal(t.available, 48); // 免费不受窗口限制
});

test("computeTrip: 付费班次窗口外（T-now>3h）available=null 但保留 bookable", () => {
  const tMs = Date.UTC(2026, 8, 4, 12, 0, 0) - 8 * 3600 * 1000; // Beijing 12:00
  const far = tMs - 4 * 3600 * 1000;
  const t = computeTrip(ROW, seat(), far, DATE, true);
  assert.equal(t.visible, false);
  assert.equal(t.available, null);
  assert.equal(t.bookable, 48); // 缓存用原始余票
});

test("computeTrip: 超额售罄（reservation_num < disable）bookable 为负 → available 钳制 0", () => {
  const t = computeTrip(ROW, seat({ reservation_num: 2, disable_seat: [1, 2, 3] }), NOW, DATE, true);
  assert.equal(t.bookable, 2 - 3); // -1
  assert.equal(t.available, 0);
});

test("computeTrip: 未知线路 / 缺发车时间 → null", () => {
  assert.equal(computeTrip({ name: "不存在线路", origin_time: "12:00", type: "0" }, seat(), NOW, DATE, true), null);
  assert.equal(computeTrip({ ...ROW, origin_time: "" }, seat(), NOW, DATE, true), null);
});

test("computeTrip: 彩虹巴士（type=1）标记但不过滤（过滤在上游 refreshAll）", () => {
  const t = computeTrip({ ...ROW, type: "1" }, seat(), NOW, DATE, true);
  assert.equal(t.rainbow, true);
});

test("computeTrip: seatData 缺 disable_seat → disable=0", () => {
  const t = computeTrip(ROW, { reserved_count: 48, reservation_num: 51 }, NOW, DATE, true);
  assert.equal(t.bookable, 51);
  assert.equal(t.total, 48 + 51);
});

test("computeTrip: total=0 时 pct=null（防除零）", () => {
  const t = computeTrip(ROW, { reserved_count: 0, reservation_num: 0, disable_seat: [] }, NOW, DATE, true);
  assert.equal(t.total, 0);
  assert.equal(t.pct, null);
});

test("computeTrip: 付费 TTL 阶段随 now 变化（开售瞬间 20s / 常规 60s / 预售 300s）", () => {
  const tMs = Date.UTC(2026, 8, 4, 12, 0, 0) - 8 * 3600 * 1000; // Beijing 12:00
  const cases = [
    { at: tMs - 55 * 60000, phase: "onsale", ttl: 20 },
    { at: tMs - 30 * 60000, phase: "regular", ttl: 60 },
    { at: tMs - 3 * 3600 * 1000, phase: "presale", ttl: 300 }
  ];
  for (const c of cases) {
    const t = computeTrip(ROW, seat(), c.at, DATE, true);
    assert.equal(t.phase, c.phase, `at ${c.at}`);
    assert.equal(t.ttl, c.ttl, `at ${c.at}`);
  }
});

test("computeTrip: 输出源站 id 与格式化 price（未来实车列表驱动用）", () => {
  const row = { ...ROW, id: "abc123" };
  const t = computeTrip(row, seat(), NOW, DATE, true);
  assert.equal(t.id, "abc123");
  assert.equal(t.price, "¥10.00");
  const free = computeTrip({ ...ROW, teacher_ticket_price: "0.0" }, seat(), NOW, DATE, true);
  assert.equal(free.price, "¥0.00");
  // 老行无 id → 空串（不崩溃）
  assert.equal(computeTrip({ ...ROW, id: undefined }, seat(), NOW, DATE, true).id, "");
});
