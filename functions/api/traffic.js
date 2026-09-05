// 高德实时路况查询（Pages Function）—— 纯读模式。
// GET /api/traffic → 返回 R2 缓存的实时路况（fwd/rev 双方向汇总）。
// 数据由本地计划任务脚本（workspace/campus-shuttle-amap-refresh-20260905/amap-refresh.mjs）
// 直接 SigV4 PUT 到 R2 bucket 的 traffic/live.json，本端点只负责读取缓存供前端轮询。

import { readTrafficLive } from "../_shared/traffic-cache.js";

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...extraHeaders }
  });
}

function cacheHeaders() {
  // 与 availability 一致：实时数据不加浏览器/边缘缓存（前端 60s 轮询即可）
  return { "Cache-Control": "private, no-store" };
}

function dirsView(live) {
  return live ? { fwd: live.fwd != null ? live.fwd : null, rev: live.rev != null ? live.rev : null } : { fwd: null, rev: null };
}

export async function onRequest({ env }) {
  const bucket = env.AVAIL_BUCKET;
  const live = await readTrafficLive(bucket);
  if (!live) return json({ available: false });
  return json(
    { available: true, fetchedAt: live.fetchedAt, serverNow: Date.now(), dirs: dirsView(live) },
    200,
    cacheHeaders()
  );
}
