// 统一的 JSON 响应 / 缓存头 封装（两个 Pages Function api 共用）。
// 缓存策略：浏览器/边缘一律不缓存（private, no-store）——新鲜度由 R2 缓存 + SWR
// （服务端 waitUntil 后台刷新）保证，前端每次轮询都打回服务端，
// 避免「刷新不更新、须 Ctrl+F5」的旧缓存问题（v1.18 决策）。

export function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...extraHeaders }
  });
}

export function cacheHeaders(ttl) {
  void ttl; // 兼容旧签名：无论 TTL 多少都不走边缘缓存
  return { "Cache-Control": "private, no-store" };
}
