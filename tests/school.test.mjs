import test from "node:test";
import assert from "node:assert/strict";
import { sign, host, fetchWithRetry, fetchJson } from "../functions/_shared/school.js";
import { md5Hex } from "../functions/_shared/md5.js";

const SECRET = "test-secret-not-production";

function okRes(body, status = 200) {
  return { ok: true, status, text: async () => body };
}
function failRes(status = 500) {
  return { ok: false, status, text: async () => "" };
}

test("sign: apitoken = md5(md5(secret + apitime))", () => {
  const s = sign(SECRET, 1788489975368);
  assert.equal(s.apitime, "1788489975368");
  assert.equal(s.apitoken, md5Hex(md5Hex(SECRET + s.apitime)));
});

test("host: 默认 https,http 顺序", () => {
  assert.deepEqual(host(), ["https://hqapp1.bit.edu.cn", "http://hqapp1.bit.edu.cn"]);
  assert.deepEqual(host("http,https"), ["http://hqapp1.bit.edu.cn", "https://hqapp1.bit.edu.cn"]);
});

test("fetchWithRetry: 首跳成功即返回（带签名头）", async () => {
  const saved = globalThis.fetch;
  const calls = [];
  try {
    globalThis.fetch = async (url, opts) => {
      calls.push({ url, headers: opts.headers });
      return okRes('{"code":"0"}');
    };
    const { url, res } = await fetchWithRetry(host(), { secret: SECRET });
    assert.ok(calls.length >= 1);
    assert.ok(url.startsWith("https://hqapp1.bit.edu.cn"));
    assert.ok(calls[0].headers.apitime);
    assert.ok(calls[0].headers.apitoken);
    assert.equal(await res.text(), '{"code":"0"}');
  } finally {
    globalThis.fetch = saved;
  }
});

test("fetchWithRetry: https 失败 → 回退 http（协议回退）", async () => {
  const saved = globalThis.fetch;
  const urlsHit = [];
  try {
    globalThis.fetch = async (url) => {
      urlsHit.push(url);
      if (url.startsWith("https://")) throw new Error("https down");
      return okRes('{"code":"0"}');
    };
    const { url } = await fetchWithRetry(host(), { secret: SECRET });
    assert.ok(url.startsWith("http://hqapp1.bit.edu.cn"));
    assert.ok(urlsHit[0].startsWith("https://"));
    assert.ok(urlsHit[1].startsWith("http://"));
  } finally {
    globalThis.fetch = saved;
  }
});

test("fetchWithRetry: 全部失败（重试 3 轮）→ 抛错", async () => {
  const saved = globalThis.fetch;
  let n = 0;
  try {
    globalThis.fetch = async () => {
      n++;
      throw new Error("down");
    };
    await assert.rejects(() => fetchWithRetry(host(), { secret: SECRET }), /school unreachable after 3 attempts/);
    assert.ok(n >= 3, `expected >=3 fetch calls, got ${n}`);
  } finally {
    globalThis.fetch = saved;
  }
});

test("fetchWithRetry: 非 200 → 抛错", async () => {
  const saved = globalThis.fetch;
  try {
    globalThis.fetch = async () => failRes(503);
    await assert.rejects(() => fetchWithRetry(host(), { secret: SECRET }), /HTTP 503/);
  } finally {
    globalThis.fetch = saved;
  }
});

test("fetchJson: 良码 code=0 / code=1 透传", async () => {
  const saved = globalThis.fetch;
  try {
    globalThis.fetch = async () => okRes('{"code":"0","data":[]}');
    assert.equal((await fetchJson(host(), SECRET)).code, "0");
    globalThis.fetch = async () => okRes('{"code":"1","data":{}}');
    assert.equal((await fetchJson(host(), SECRET)).code, "1");
  } finally {
    globalThis.fetch = saved;
  }
});

test("fetchJson: 显式失败码 SYS_* / 2 / 3 / ERROR → 抛错", async () => {
  const saved = globalThis.fetch;
  try {
    for (const code of ["SYS_UNKNOWN", "2", "3", "ERROR"]) {
      globalThis.fetch = async () => okRes(`{"code":"${code}","message":"bad"}`);
      await assert.rejects(() => fetchJson(host(), SECRET), /school code/);
    }
  } finally {
    globalThis.fetch = saved;
  }
});

test("fetchJson: 坏 JSON → 抛错", async () => {
  const saved = globalThis.fetch;
  try {
    globalThis.fetch = async () => okRes("not-json");
    await assert.rejects(() => fetchJson(host(), SECRET), /bad json from school/);
  } finally {
    globalThis.fetch = saved;
  }
});
