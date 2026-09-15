// 后台刷新单飞锁：基于 caches.default 的短期标记，TTL 到期自动失效，无需清理。
// 背景：无锁时 N 个并发 stale 请求会各自触发源站刷新 + 并发写同一个 R2 对象，
// 触发 R2 10058「Reduce your concurrent request rate for the same object」，
// writeTripCache 失败 → fetchedAt 永不推进 → 前端判定永久 stale → 热循环自锁。
// match/put 异常时 fail-open（放行刷新），保证数据可用性优先。

export const LOCK_URL_BASE = "https://refresh-lock.internal/";

export async function tryAcquire(cache, key, ttlSec, nowMs = Date.now()) {
  const url = LOCK_URL_BASE + key;
  try {
    const hit = await cache.match(url);
    if (hit) {
      const at = Number(hit.headers.get("x-lock-at") || 0);
      if (!at || nowMs - at < ttlSec * 1000) return false;
    }
  } catch {}
  try {
    await cache.put(url, new Response("1", {
      headers: {
        "Cache-Control": `public, max-age=${ttlSec}`,
        "x-lock-at": String(nowMs)
      }
    }));
  } catch {}
  return true;
}
