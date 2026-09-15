import test from "node:test";
import assert from "node:assert/strict";
import { staleBackoffMs, orphanKeys } from "../lib/availability.js";

test("staleBackoffMs: 10s→20s→40s→60s 封顶指数退避", () => {
  assert.equal(staleBackoffMs(0), 10000);
  assert.equal(staleBackoffMs(1), 20000);
  assert.equal(staleBackoffMs(2), 40000);
  assert.equal(staleBackoffMs(3), 60000);
  assert.equal(staleBackoffMs(9), 60000);
});

test("staleBackoffMs: 非法/负数输入按 0 处理", () => {
  assert.equal(staleBackoffMs(undefined), 10000);
  assert.equal(staleBackoffMs(-5), 10000);
  assert.equal(staleBackoffMs(NaN), 10000);
});

test("orphanKeys: 在列表中的 key 永不清扫", () => {
  const entries = new Map([
    ["d|a|07:30", { inflight: false, lastSeenAt: 0 }],
    ["d|c|08:00", { inflight: false, lastSeenAt: 0 }]
  ]);
  const seen = new Set(["d|a|07:30"]);
  const out = orphanKeys(entries, seen, 60 * 60000);
  assert.deepEqual(out, ["d|c|08:00"]);
});

test("orphanKeys: 列表外但未超 orphanMs 的保留，超时的清除", () => {
  const now = 100 * 60000;
  const entries = new Map([
    ["d|a|07:30", { inflight: false, lastSeenAt: now - 9 * 60000 }],
    ["d|c|08:00", { inflight: false, lastSeenAt: now - 11 * 60000 }],
    ["d|e|09:00", { inflight: false, lastSeenAt: undefined }]
  ]);
  const out = orphanKeys(entries, new Set(), now);
  assert.deepEqual(out, ["d|c|08:00", "d|e|09:00"]);
});

test("orphanKeys: inflight 永不清扫（等 finally 后下一轮处理）", () => {
  const now = 100 * 60000;
  const entries = new Map([
    ["d|a|07:30", { inflight: true, lastSeenAt: now - 99 * 60000 }]
  ]);
  assert.deepEqual(orphanKeys(entries, new Set(), now), []);
});

test("orphanKeys: 自定义 orphanMs 生效", () => {
  const now = 100 * 60000;
  const entries = new Map([
    ["d|a|07:30", { inflight: false, lastSeenAt: now - 2 * 60000 }]
  ]);
  assert.deepEqual(orphanKeys(entries, new Set(), now, 60000), ["d|a|07:30"]);
  assert.deepEqual(orphanKeys(entries, new Set(), now, 3 * 60000), []);
});
