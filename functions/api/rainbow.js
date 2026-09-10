// 彩虹巴士余座查询（Pages Function，GET /api/rainbow）。
// 数据源：rainbow-bus.cn（仅 http），凭据为 R2 中的 AES-GCM 加密信封 rainbow/cookie.enc
//         （机器 A 用共享 key 加密 connect.sid 后 SigV4 上传；见 docs/rainbow-bus-api-investigation.md §4）。
// 刷新/TTL 与 /api/availability 一致：R2 live 缓存 + stale-while-revalidate，minTtl=300s。
// 仅取「理工大学」区（area=3804）线路，映射到板内方向 a/c。

import { json, cacheHeaders } from "../_shared/response.js";
import {
  parseEnvelope,
  countSeats,
  pickBoardRoutes,
  buildTrips
} from "../_shared/rainbow.js";
import { beijingDateStr } from "../_shared/ttl.js";
import { shiftDate } from "../_shared/metrics.js";

const BASE = "http://www.rainbow-bus.cn";
const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.49";
const AREA = 3804; // 理工大学（海淀）
const CITY = 1;
const OLNG = "116.407526";
const OLAT = "39.904030";
const PAGE_SIZE = 8;
const MAX_PAGES = 5;
const FUTURE_DAYS = 5; // 与前端 MAX_FUTURE_DAYS 一致：取 today..today+5
const TIMEOUT_MS = 8000;

const LIVE_KEY = "rainbow/live.json";
const COOKIE_KEY = "rainbow/cookie.enc";
const LEGACY_COOKIE_KEY = "rainbow/cookie.json.enc"; // 容错：旧命名（优先用 COOKIE_KEY）
const FAILED_KEY = "rainbow/last-failed.json";
const LIVE_TTL = 300;

async function readJson(bucket, key) {
  const obj = await bucket.get(key);
  if (!obj) return null;
  try {
    return JSON.parse(await obj.text());
  } catch {
    return null;
  }
}

// 读加密信封：优先 rainbow/cookie.enc，回退旧命名；非 JSON 明文时明确报 not_json（便于排查格式错误）
async function readCookieEnvelope(bucket) {
  for (const key of [COOKIE_KEY, LEGACY_COOKIE_KEY]) {
    const obj = await bucket.get(key);
    if (!obj) continue;
    const text = await obj.text();
    try {
      return { key, envelope: JSON.parse(text) };
    } catch {
      throw new Error(`envelope:not_json@${key}`);
    }
  }
  throw new Error("envelope:empty");
}

async function writeJson(bucket, key, data) {
  await bucket.put(key, JSON.stringify(data));
}

function b64ToBytes(b64) {
  const bin = atob(b64);
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u;
}

async function decryptCookie(keyB64, envelope) {
  const key = await crypto.subtle.importKey("raw", b64ToBytes(keyB64), { name: "AES-GCM" }, false, ["decrypt"]);
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: b64ToBytes(envelope.iv) },
    key,
    b64ToBytes(envelope.dataC)
  );
  return new TextDecoder().decode(plain);
}

// 彩虹源站 form POST（带 Cookie + 微信 UA）
async function rbPost(path, params, cookie) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(BASE + path, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "X-Requested-With": "XMLHttpRequest",
        "Cookie": cookie,
        "User-Agent": UA,
        "Referer": BASE + "/rainbow/wechat/sba"
      },
      body: new URLSearchParams(params).toString(),
      signal: ctrl.signal
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    // 源站鉴权失败：{success:false, code:401, msg:"登录已过期…"} → 视为失败降级（勿当空数据）
    if (data && typeof data === "object" && !Array.isArray(data) && data.success === false) {
      throw new Error(`rainbow ${data.code || "auth"}: ${data.msg || ""}`.slice(0, 120));
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}

async function mapLimit(items, limit, fn) {
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      await fn(items[idx]);
    }
  });
  await Promise.all(workers);
}

async function writeFailed(bucket, stage, err) {
  await writeJson(bucket, FAILED_KEY, {
    at: Date.now(),
    stage,
    error: String((err && err.message) || err).slice(0, 200)
  }).catch(() => {});
}

// 全量刷新：解密 cookie → routesByArea 翻页 → 各线路今日 plan → 座位 → 写 live 缓存
async function refresh(bucket, env, nowMs) {
  const keyB64 = env.RAINBOW_COOKIE_KEY;
  if (!keyB64) throw new Error("no_key");
  const { envelope } = await readCookieEnvelope(bucket);
  const parsed = parseEnvelope(envelope, nowMs);
  if (!parsed.ok) throw new Error(`envelope:${parsed.reason}`);
  const cookie = await decryptCookie(keyB64, envelope);

  const today = beijingDateStr(nowMs);
  const dates = new Set();
  for (let i = 0; i <= FUTURE_DAYS; i++) dates.add(shiftDate(today, i));

  // 1) 理工大学线路（翻页，每页 8）
  const allRoutes = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const list = await rbPost("/rainbow/wechat/r/routesByArea", {
      olng: OLNG, olat: OLAT, dlng: "", dlat: "", destinationStations: "",
      start: "", end: "", stationName: "", soonerOrLater: "",
      area: AREA, nearest: "", page, city: CITY
    }, cookie);
    const arr = Array.isArray(list) ? list : (list && list.data) || [];
    if (!arr.length) break;
    allRoutes.push(...arr);
    if (arr.length < PAGE_SIZE) break;
  }
  const entries = pickBoardRoutes(allRoutes);

  // 2) 各线路 今日..+5 的 plan
  const plansByRoute = new Map();
  const planIds = [];
  for (const e of entries) {
    const plans = await rbPost("/rainbow/wechat/p/searchPlanDates", { routeId: e.routesId }, cookie);
    const arr = Array.isArray(plans) ? plans : (plans && plans.data) || [];
    const rangePlans = arr.filter((p) => p && p.id !== "" && p.id != null && dates.has(p.service_date));
    if (rangePlans.length) {
      plansByRoute.set(e.routesId, rangePlans);
      for (const p of rangePlans) planIds.push(p.id);
    }
  }

  // 3) 座位（并发 ≤3，单班失败忽略）
  const seatsByPlan = new Map();
  await mapLimit(planIds, 3, async (id) => {
    try {
      const seat = await rbPost("/rainbow/wechat/b/getBusSeatsWechat", { planId: id }, cookie);
      seatsByPlan.set(id, countSeats(seat));
    } catch {
      /* 单班座位失败：该班不输出 */
    }
  });

  const trips = buildTrips(entries, plansByRoute, seatsByPlan);
  const payload = { fetchedAt: Date.now(), minTtl: LIVE_TTL, date: today, trips, note: null };
  await writeJson(bucket, LIVE_KEY, payload);
  return payload;
}

export async function onRequest({ request, env, waitUntil }) {
  const url = new URL(request.url);
  const force = url.searchParams.get("refresh") === "1";
  const nowMs = Date.now();
  const bucket = env.AVAIL_BUCKET;

  const live = await readJson(bucket, LIVE_KEY);
  const ttl = live && live.minTtl > 0 ? live.minTtl : LIVE_TTL;
  const fresh = !!(live && live.fetchedAt && nowMs - live.fetchedAt < ttl * 1000);

  // 非强制：有缓存则直出（过期则后台刷新）
  if (!force && live && Array.isArray(live.trips)) {
    if (!fresh) {
      waitUntil(refresh(bucket, env, nowMs).catch((e) => writeFailed(bucket, "swr", e)));
    }
    return json(
      { serverNow: nowMs, source: fresh ? "cache" : "stale", dataFetchedAt: live.fetchedAt, minTtl: ttl, date: live.date || null, trips: live.trips },
      200,
      cacheHeaders(ttl)
    );
  }

  // 强制 / 无缓存：同步刷新
  try {
    const result = await refresh(bucket, env, nowMs);
    return json(
      { serverNow: nowMs, source: "live", dataFetchedAt: result.fetchedAt, minTtl: LIVE_TTL, date: result.date, trips: result.trips },
      200,
      cacheHeaders(LIVE_TTL)
    );
  } catch (err) {
    await writeFailed(bucket, "refresh", err);
    if (live && Array.isArray(live.trips)) {
      return json(
        { serverNow: nowMs, source: "stale", dataFetchedAt: live.fetchedAt, minTtl: ttl, date: live.date || null, trips: live.trips },
        200,
        cacheHeaders(ttl)
      );
    }
    return json(
      { serverNow: nowMs, source: "degraded", dataFetchedAt: null, minTtl: LIVE_TTL, date: null, trips: [], note: String((err && err.message) || err).slice(0, 120) },
      200,
      cacheHeaders(LIVE_TTL)
    );
  }
}
