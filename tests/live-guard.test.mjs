import test from "node:test";
import assert from "node:assert/strict";
import { keepExistingLive } from "../functions/api/availability.js";

const liveWith = (n) => ({ minTtl: 60, fetchedAt: 1000, trips: Array.from({ length: n }, (_, i) => ({ id: `t${i}`, route: "a", dep: "07:30" })) });

test("keepExistingLive: 新 trips 非空 → 覆盖（null = 不保留旧值）", () => {
  assert.equal(keepExistingLive(liveWith(17), [{ id: "x" }]), null);
  assert.equal(keepExistingLive(null, [{ id: "x" }]), null);
});

test("keepExistingLive: 新 trips 为空且旧 live 非空 → 保留旧 live（防空污染）", () => {
  const old = liveWith(17);
  const kept = keepExistingLive(old, []);
  assert.equal(kept, old);
});

test("keepExistingLive: 新旧皆空 → 照常写空（首次无数据属正常）", () => {
  assert.equal(keepExistingLive(null, []), null);
  assert.equal(keepExistingLive({ minTtl: 60, trips: [] }, []), null);
});

test("keepExistingLive: 旧 live 形状异常（trips 非数组）→ 不保留", () => {
  assert.equal(keepExistingLive({ minTtl: 60, trips: "oops" }, []), null);
  assert.equal(keepExistingLive("garbage", []), null);
});
