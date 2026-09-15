import test from "node:test";
import assert from "node:assert/strict";
import { tryAcquire, LOCK_URL_BASE } from "../functions/_shared/refresh-lock.js";

// 内存 mock cache：match/put 语义按 max-age 过期，时钟手动推进
function mockCache() {
  const store = new Map();
  const clock = { now: 1000000 };
  return {
    clock,
    async match(url) {
      const e = store.get(url);
      if (!e) return undefined;
      if (clock.now - e.at >= e.ttl * 1000) return undefined;
      return e.response;
    },
    async put(url, resp) {
      const m = /max-age=(\d+)/.exec(resp.headers.get("Cache-Control") || "");
      store.set(url, { response: resp, ttl: m ? Number(m[1]) : 0, at: clock.now });
    }
  };
}

test("refresh-lock: 首次获取成功，TTL 内重复获取失败", async () => {
  const c = mockCache();
  assert.equal(await tryAcquire(c, "trip/d/a-07:30", 30, c.clock.now), true);
  assert.equal(await tryAcquire(c, "trip/d/a-07:30", 30, c.clock.now), false);
});

test("refresh-lock: TTL 过期后可重新获取", async () => {
  const c = mockCache();
  assert.equal(await tryAcquire(c, "bulk/d", 60, c.clock.now), true);
  c.clock.now += 59000;
  assert.equal(await tryAcquire(c, "bulk/d", 60, c.clock.now), false);
  c.clock.now += 2000;
  assert.equal(await tryAcquire(c, "bulk/d", 60, c.clock.now), true);
});

test("refresh-lock: 不同 key 互不影响", async () => {
  const c = mockCache();
  assert.equal(await tryAcquire(c, "trip/d/a-07:30", 30, c.clock.now), true);
  assert.equal(await tryAcquire(c, "trip/d/c-08:00", 30, c.clock.now), true);
  assert.equal(await tryAcquire(c, "trip/d/a-07:30", 30, c.clock.now), false);
});

test("refresh-lock: 锁 URL 走独立命名空间", async () => {
  const c = mockCache();
  await tryAcquire(c, "k1", 30, c.clock.now);
  const hit = await c.match(LOCK_URL_BASE + "k1");
  assert.ok(hit, "lock entry stored under LOCK_URL_BASE");
  assert.equal(hit.headers.get("x-lock-at"), String(c.clock.now));
});

test("refresh-lock: 无 x-lock-at 头的命中仍视为持锁（由 max-age 保证过期）", async () => {
  const c = mockCache();
  await c.put(LOCK_URL_BASE + "k2", new Response("1", { headers: { "Cache-Control": "max-age=30" } }));
  assert.equal(await tryAcquire(c, "k2", 30, c.clock.now), false);
  c.clock.now += 31000;
  assert.equal(await tryAcquire(c, "k2", 30, c.clock.now), true);
});

test("refresh-lock: match 抛异常时 fail-open 放行刷新", async () => {
  const c = {
    async match() { throw new Error("boom"); },
    async put() {}
  };
  assert.equal(await tryAcquire(c, "k3", 30), true);
});
