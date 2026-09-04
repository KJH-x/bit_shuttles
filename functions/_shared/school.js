// 源站签名 + 请求（带重试 3 次与协议回退）。
// 签名：apitime = Date.now() 字符串；apitoken = md5(md5(secret + apitime))。
// 连接性：默认 https 优先、失败回退 http；重试 3 次后放弃（由调用方处理降级/last-failed）。

import { md5Hex } from "./md5.js";

const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 400;
const TIMEOUT_MS = 8000;

export function sign(secret, nowMs = Date.now()) {
  const apitime = String(nowMs);
  const apitoken = md5Hex(md5Hex(secret + apitime));
  return { apitime, apitoken };
}

export function host(schemeOrder = "https,http") {
  return schemeOrder.split(",").filter(Boolean).map((s) => `${s}://hqapp1.bit.edu.cn`);
}

export function apiPath(path) {
  return path;
}

// 对给定完整 URL 列表依次尝试 + 重试 MAX_ATTEMPTS 次；全部失败抛错。
export async function fetchWithRetry(urls, { headers = {}, secret, timeout = TIMEOUT_MS } = {}) {
  const sig = sign(secret);
  let lastErr = null;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    for (const url of urls) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeout);
      try {
        const res = await fetch(url, {
          method: "GET",
          headers: { apitime: sig.apitime, apitoken: sig.apitoken, ...headers },
          signal: ctrl.signal
        });
        clearTimeout(timer);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return { url, res };
      } catch (err) {
        clearTimeout(timer);
        lastErr = err;
      }
    }
    if (attempt < MAX_ATTEMPTS - 1) {
      await new Promise((r) => setTimeout(r, RETRY_DELAY_MS * (attempt + 1)));
    }
  }
  const e = new Error(`school unreachable after ${MAX_ATTEMPTS} attempts: ${lastErr && lastErr.message}`);
  e.cause = lastErr;
  throw e;
}

// 统一 JSON 封装：urls = 完整 URL 数组（同路径不同协议）
// 源站 get-list 成功 code="0"；get-reserved-seats 成功 code="1"。仅识别显式失败码。
export async function fetchJson(urls, secret) {
  const { res } = await fetchWithRetry(urls, { secret });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`bad json from school: ${text.slice(0, 80)}`);
  }
  if (json && json.code != null) {
    const c = String(json.code);
    const failed = c.startsWith("SYS") || c === "2" || c === "3" || c === "ERROR";
    if (failed) throw new Error(`school code ${c}: ${json.message || ""}`);
  }
  return json;
}
