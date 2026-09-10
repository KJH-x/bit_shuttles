import test from "node:test";
import assert from "node:assert/strict";
import { availColor, mainAvailText, pidsAvailText } from "../lib/availability.js";

// mainAvailText/pidsAvailText 输入形状：trip.avail = computeTrip 输出子集
function avail({ paid = true, visible = true, available, bookable, total, pct, rainbow = false } = {}) {
  return { paid, visible, available, bookable, total, pct, rainbow };
}

test("availColor: 阈值 ≥15 绿 / 6–14 黄 / ≤5 红 / null 无色", () => {
  assert.equal(availColor(null), "");
  assert.equal(availColor(15), "green");
  assert.equal(availColor(20), "green");
  assert.equal(availColor(14), "yellow");
  assert.equal(availColor(6), "yellow");
  assert.equal(availColor(5), "red");
  assert.equal(availColor(0), "red");
  assert.equal(availColor(-3), "red");
});

test("mainAvailText: 有具体余票 → 数字（非百分比）", () => {
  const r = mainAvailText({ avail: avail({ available: 23, bookable: 23, total: 51, pct: 45 }) });
  assert.deepEqual(r, { value: "23", color: "green" });
});

test("mainAvailText: 仅余票率（available=null，窗口外付费）→ 百分比无色", () => {
  // 已知现状（v1.15 起）：窗口外 available=null → availColor(null)="" 无色
  const r = mainAvailText({ avail: avail({ available: null, bookable: 12, total: 51, pct: 24 }) });
  assert.deepEqual(r, { value: "24%", color: "" });
});

test("mainAvailText: 售罄（available=0 或 bookable<=0）→ 售罄红", () => {
  assert.deepEqual(mainAvailText({ avail: avail({ available: 0, bookable: 0, total: 51, pct: 0 }) }), {
    value: "售罄",
    color: "red"
  });
  // 窗口外 available=null 但 bookable<=0 的售罄也应显示「售罄」
  assert.deepEqual(mainAvailText({ avail: avail({ available: null, bookable: -2, total: 51, pct: 0 }) }), {
    value: "售罄",
    color: "red"
  });
});

test("mainAvailText: 彩虹恒显示占位 -- / 无 avail 返回 null", () => {
  assert.deepEqual(mainAvailText({ avail: avail({ rainbow: true, available: 10, total: 51 }) }), { value: "--", color: "" });
  assert.deepEqual(mainAvailText({ rainbow: true, avail: null }), { value: "--", color: "" });
  assert.equal(mainAvailText({}), null);
  assert.equal(mainAvailText({ avail: null }), null);
});

test("pidsAvailText: 满载率 = 100 − pct（整数），颜色按真实余票", () => {
  const r = pidsAvailText({ avail: avail({ available: 10, total: 51, pct: 20 }) });
  assert.deepEqual(r, { text: "80%", color: "yellow" });
  // 售罄 → 100%
  const s = pidsAvailText({ avail: avail({ available: 0, total: 51, pct: 0 }) });
  assert.deepEqual(s, { text: "100%", color: "red" });
});

test("pidsAvailText: 无数据 / 彩虹 → 占位 --（两个连字符）", () => {
  assert.deepEqual(pidsAvailText({ avail: null }), { text: "--", color: "" });
  assert.deepEqual(pidsAvailText({}), { text: "--", color: "" });
  assert.deepEqual(pidsAvailText({ avail: avail({ rainbow: true, pct: 50 }) }), { text: "--", color: "" });
});
