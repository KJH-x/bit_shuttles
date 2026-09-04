// 高德实时路况查询（Pages Function）。
// 读模式：GET /api/traffic → 返回 R2 缓存的实时路况（fwd/rev 双方向汇总）。
// 刷新模式：GET /api/traffic?refresh=1&token=... → GitHub Actions cron 触发，
//   服务端鉴权（timing-safe）+ 全局限频（5 分钟/次）后并发拉取双方向并写回 R2；
//   单方向失败保留旧值，两方向都失败且无旧缓存 → amap_unreachable。

import {
  ROUTE_CFG,
  buildTrafficUrl,
  fetchTrafficJson,
  parseLive
} from "../_shared/amap.js";
import {
  readTrafficLive,
  writeTrafficLive,
  readTrafficState,
  writeTrafficState
} from "../_shared/traffic-cache.js";

const REFRESH_COOLDOWN_MS = 5 * 60 * 1000;
const DIRS = ["fwd", "rev"];

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...extraHeaders }
  });
}

function cacheHeaders() {
  return { "Cache-Control": "public, max-age=60, s-maxage=60, stale-while-revalidate=60" };
}

// 刷新响应带 token，禁止 CDN 缓存内部请求
function noStoreHeaders() {
  return { "Cache-Control": "no-store" };
}

// 等长 XOR 累加，常数时间比较 token
function tokenMatches(given, expected) {
  if (typeof given !== "string" || typeof expected !== "string") return false;
  if (given.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < given.length; i++) diff |= given.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

function dirsView(live) {
  return live ? { fwd: live.fwd != null ? live.fwd : null, rev: live.rev != null ? live.rev : null } : { fwd: null, rev: null };
}

// 拉取单个方向：失败（!ok 或 parse 为 null）→ 保留旧 live 值，无旧值则 null；不抛
async function refreshDir(dir, old) {
  const cfg = ROUTE_CFG[dir];
  try {
    const res = await fetchTrafficJson(buildTrafficUrl(dir, crypto.randomUUID()));
    if (!res.ok) return old && old[dir] != null ? old[dir] : null;
    const value = parseLive(res.json, { ...cfg, dir });
    if (value != null) return value;
  } catch {
    // 落到下方：保留旧值或 null
  }
  return old && old[dir] != null ? old[dir] : null;
}

export async function onRequest({ request, env, waitUntil }) {
  const url = new URL(request.url);
  const bucket = env.AVAIL_BUCKET;
  const nowMs = Date.now();

  // === 读模式：返回缓存 ===
  if (url.searchParams.get("refresh") !== "1") {
    const live = await readTrafficLive(bucket);
    if (!live) return json({ available: false });
    return json(
      { available: true, fetchedAt: live.fetchedAt, serverNow: nowMs, dirs: dirsView(live) },
      200,
      cacheHeaders()
    );
  }

  // === 刷新模式：鉴权 ===
  if (!env.TRAFFIC_REFRESH_TOKEN) {
    return json({ error: "not_configured" }, 503, noStoreHeaders());
  }
  if (!tokenMatches(url.searchParams.get("token"), env.TRAFFIC_REFRESH_TOKEN)) {
    return json({ error: "unauthorized" }, 403, noStoreHeaders());
  }

  try {
    // 限频闸：距上次刷新不足 5 分钟 → 直接返回当前 live（不触发刷新）
    const state = await readTrafficState(bucket);
    if (state && state.lastRefreshAt && nowMs - state.lastRefreshAt < REFRESH_COOLDOWN_MS) {
      const live = await readTrafficLive(bucket);
      if (!live) return json({ available: false, rateLimited: true }, 200, noStoreHeaders());
      return json(
        { available: true, rateLimited: true, fetchedAt: live.fetchedAt, serverNow: nowMs, dirs: dirsView(live) },
        200,
        noStoreHeaders()
      );
    }

    const old = await readTrafficLive(bucket);
    const results = await Promise.all(DIRS.map((dir) => refreshDir(dir, old)));
    const fwd = results[0];
    const rev = results[1];

    // 两方向都失败且无旧缓存可回退 → amap_unreachable
    if (fwd == null && rev == null) {
      return json({ available: false, rateLimited: false, error: "amap_unreachable" }, 200, noStoreHeaders());
    }

    const fetchedAt = Date.now();
    await writeTrafficLive(bucket, { fwd, rev });
    await writeTrafficState(bucket, { lastRefreshAt: fetchedAt });
    return json(
      { available: true, rateLimited: false, fetchedAt, serverNow: Date.now(), dirs: { fwd, rev } },
      200,
      noStoreHeaders()
    );
  } catch (err) {
    return json({ available: false, rateLimited: false, error: "degraded" }, 200, noStoreHeaders());
  }
}
