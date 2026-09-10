// 彩虹巴士余座数据层：拉取 /api/rainbow（R2 live 缓存 + SWR，minTtl 与余票一致，封顶 300s）。
// 顶层不执行 fetch；数据更新通过回调通知 app.js。

import { availColor } from "./availability.js";

const MIN_TTL_MS = 3000;

let callback = null;
let timer = null;
let inFlight = false;
let lastFetchAt = 0;
let lastDataFetchedAt = 0;

function normTtl(minTtl) {
  const t = Number(minTtl);
  if (!Number.isFinite(t) || t <= 0) return 300;
  return Math.max(10, Math.min(300, Math.round(t)));
}

async function fetchJson(url) {
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

async function poll() {
  if (inFlight) return;
  inFlight = true;
  try {
    const data = await fetchJson("/api/rainbow");
    lastFetchAt = Date.now();
    if (data && typeof data.dataFetchedAt === "number") lastDataFetchedAt = data.dataFetchedAt;
    if (callback) callback(data);
    const ttl = data && data.minTtl != null ? normTtl(data.minTtl) : 300;
    clearTimeout(timer);
    timer = setTimeout(poll, Math.max(MIN_TTL_MS, ttl * 1000));
  } finally {
    inFlight = false;
  }
}

export function initRainbow(cb) {
  callback = cb;
  poll();
  return () => clearTimeout(timer);
}

// 手动刷新（⟳ 与余票/路况一起触发）
export function refreshRainbowNow() {
  clearTimeout(timer);
  poll();
}

export function rainbowAgeMs() {
  const base = lastDataFetchedAt || lastFetchAt;
  return base ? Date.now() - base : null;
}

// 主屏彩虹班次余座文案：有数据 → 余N / 售罄（配色同余票）；无数据 → null（调用方回退占位 "--"）
export function rainbowAvailText(rb) {
  if (!rb || !(rb.seatsTotal > 0)) return null;
  const left = Number(rb.seatsLeft);
  if (!(left > 0)) return { value: "售罄", color: availColor(0) };
  return { value: `${left}`, color: availColor(left) };
}
