import test from "node:test";
import assert from "node:assert/strict";
import {
  AMAP_API,
  AMAP_UA,
  ROUTE_CFG,
  buildTrafficUrl,
  fetchTrafficJson,
  selectPath,
  splitSegments,
  computeTraffic,
  parseLive
} from "../functions/_shared/amap.js";

// === fixtures ===
// 良乡→中关村 直连路线（贴近真实响应：含 cost/trafficlights/strategy，应被静默丢弃）
const FULL_PATH = {
  strategy: "速度最快",
  distance: 36489,
  drivetime: 3194,
  cost: 114,
  trafficlights: 14,
  path: [
    {
      name: "良乡东路",
      action: "2",
      length: "16022",
      segments: [
        { name: "step1-a", distance: "2000,2000", status: "1,1" },
        { name: "step1-b", distance: "2000,2000,2000,3000,4022", status: "2,2,2,1,1" }
      ]
    },
    {
      name: "G4京港澳高速",
      action: "2",
      length: "10165",
      segments: [
        { name: "step2-a", distance: "1000,2000", status: "3,3" },
        { name: "step2-b", distance: "2000,2000,3165", status: "4,3,3" }
      ]
    },
    {
      name: "西三环",
      action: "2",
      length: "9302",
      segments: [
        { name: "step3-a", distance: "2000,2000", status: "2,1" },
        { name: "step3-b", distance: "2000,2000,1302", status: "2,2,1" }
      ]
    }
  ]
};

// 路径列表：FULL_PATH 直连(36489m)，另两条绕行
const PATH_LIST = [
  FULL_PATH,
  { strategy: "备选1", distance: 37000, drivetime: 3240, cost: 130 },
  { strategy: "备选2", distance: 37200, drivetime: 3180 }
];

// 累计距离 → 段归属（cutPoints [17022, 27187]），手算：
//   S1: 0→17022 (dist 17022, weighted=23022/17022≈1.35 → green)
//   S2: 17022→27187 (dist 10165, weighted=32495/10165≈3.20 → orange)
//   S3: 27187→36489 (dist 9302, weighted=15302/9302≈1.64 → yellow)

test("ROUTE_CFG: 双方向坐标/目标/切点与规格一致", () => {
  assert.equal(ROUTE_CFG.fwd.route, "a");
  assert.equal(ROUTE_CFG.fwd.targetKm, 36.5);
  assert.deepEqual(ROUTE_CFG.fwd.cutPoints, [17022, 27187]);
  assert.equal(ROUTE_CFG.rev.route, "c");
  assert.equal(ROUTE_CFG.rev.targetKm, 36.8);
  assert.deepEqual(ROUTE_CFG.rev.cutPoints, [18933, 30862]);
});

test("buildTrafficUrl: 参数齐全且 origin 为原始坐标", () => {
  const url = buildTrafficUrl("fwd", "uuid-abc");
  assert.ok(url.startsWith(AMAP_API));
  assert.ok(url.includes("origin=116.170248,39.72822"));
  assert.ok(url.includes("destination=116.315469,39.959984"));
  assert.ok(url.includes("originid=&origintype="));
  assert.ok(url.includes("destinationid=&destinationtype="));
  assert.ok(url.includes("waypoints=&strategy=10&shareParam=&uuid=uuid-abc"));
  const revUrl = buildTrafficUrl("rev", "u2");
  assert.ok(revUrl.includes("origin=116.315469,39.959984"));
  assert.ok(revUrl.includes("destination=116.170248,39.72822"));
  assert.throws(() => buildTrafficUrl("nope", "u"), /unknown dir/);
});

test("selectPath: 直连匹配（fwd 36.5km 目标 → 36489 那条选中）", () => {
  const p = selectPath(PATH_LIST, 36.5);
  assert.ok(p);
  assert.equal(p.distance, 36489);
});

test("selectPath: 无容差内匹配 → 退化取最小 drivetime", () => {
  const p = selectPath(PATH_LIST, 40);
  assert.ok(p);
  assert.equal(p.drivetime, 3180); // 备选2 最小
  const tight = selectPath(PATH_LIST, 36.5, 0.001);
  assert.equal(tight.drivetime, 3180); // 容差 0.001 < 0.011 → 退化
});

test("selectPath: 空列表 → null", () => {
  assert.equal(selectPath([], 36.5), null);
  assert.equal(selectPath(null, 36.5), null);
});

test("splitSegments: 按累计距离切 3 段 + distM/weighted/color/k 映射", () => {
  const segs = splitSegments(FULL_PATH, ROUTE_CFG.fwd.cutPoints);
  assert.equal(segs.length, 3);
  const [s1, s2, s3] = segs;
  assert.equal(s1.name, "S1");
  assert.equal(s1.distM, 17022);
  assert.equal(s2.distM, 10165);
  assert.equal(s3.distM, 9302);
  assert.equal(s1.distM + s2.distM + s3.distM, FULL_PATH.distance); // 段距离总和 = 总距离
  // weighted 符合手算（四舍五入到 2 位）
  assert.equal(s1.weighted, Math.round((23022 / 17022) * 100) / 100);
  assert.equal(s2.weighted, Math.round((32495 / 10165) * 100) / 100);
  assert.equal(s3.weighted, Math.round((15302 / 9302) * 100) / 100);
  // color / k 映射
  assert.equal(s1.color, "green");
  assert.equal(s1.k, 1.0);
  assert.equal(s2.color, "orange");
  assert.equal(s2.k, 1.9);
  assert.equal(s3.color, "yellow");
  assert.equal(s3.k, 1.4);
});

test("splitSegments: 归一化 ΣetaSec = drivetime（≤1s）", () => {
  const segs = splitSegments(FULL_PATH, ROUTE_CFG.fwd.cutPoints);
  const sum = segs.reduce((a, s) => a + s.etaSec, 0);
  assert.ok(Math.abs(sum - FULL_PATH.drivetime) <= 1);
  assert.equal(sum, FULL_PATH.drivetime); // 精确归位
  segs.forEach((s) => assert.ok(s.etaSec > 0));
});

test("splitSegments: 边界 ≥ 总距离 → 钳制（全部落入 S1，S2/S3 为 0）", () => {
  const segs = splitSegments(FULL_PATH, [50000, 60000]);
  assert.equal(segs[0].distM, FULL_PATH.distance);
  assert.equal(segs[1].distM, 0);
  assert.equal(segs[2].distM, 0);
  assert.equal(segs[0].color, "yellow"); // 整段加权 70819/36489≈1.94 → yellow
});

test("computeTraffic: 只输出 dir/etaSec/distM/segments，无 cost/trafficlights", () => {
  const out = computeTraffic("fwd", FULL_PATH);
  assert.equal("cost" in out, false);
  assert.equal("trafficlights" in out, false);
  assert.equal("strategy" in out, false);
  assert.equal("path" in out, false);
  assert.equal(out.dir, "fwd");
  assert.equal(out.etaSec, FULL_PATH.drivetime);
  assert.equal(out.distM, FULL_PATH.distance);
  assert.equal(out.segments.length, 3);
});

test("parseLive: 合法 JSON → 对象（选直连并汇总）", () => {
  const json = { status: 1, info: "OK", count: 3, path_list: PATH_LIST };
  const out = parseLive(json, { ...ROUTE_CFG.fwd, dir: "fwd" });
  assert.ok(out);
  assert.equal(out.dir, "fwd");
  assert.equal(out.distM, 36489);
  assert.equal(out.segments.length, 3);
  assert.equal("cost" in out, false);
});

test("parseLive: 无可选路径（空 path_list）→ null", () => {
  const cfg = { ...ROUTE_CFG.fwd, dir: "fwd" };
  assert.equal(parseLive({ path_list: [] }, cfg), null);
  assert.equal(parseLive({}, cfg), null);
  assert.equal(parseLive(null, cfg), null);
});

test("fetchTrafficJson: 正常/惩罚页/非JSON/非200（mock fetch）", async () => {
  const saved = globalThis.fetch;
  const calls = [];
  try {
    globalThis.fetch = async (url, opts) => {
      calls.push({ url, headers: opts.headers });
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ status: 1, path_list: [FULL_PATH] })
      };
    };
    const ok = await fetchTrafficJson("https://example.test/driving.json");
    assert.equal(ok.ok, true);
    assert.equal(ok.status, 200);
    assert.ok(Array.isArray(ok.json.path_list));
    assert.equal(calls[0].headers["user-agent"], AMAP_UA);
    assert.equal(calls[0].headers["x-requested-with"], "XMLHttpRequest");
    assert.equal(calls[0].headers.referer, "https://m.amap.com/navigation/carmap/");

    // 惩罚页（阿里滑块）
    globalThis.fetch = async () => ({ ok: true, status: 200, text: async () => "<html>punishpage NCTOKENSTR nocaptcha</html>" });
    const pun = await fetchTrafficJson("https://example.test/driving.json");
    assert.equal(pun.ok, false);
    assert.equal(pun.isPunish, true);

    // 非 JSON / 缺 path_list
    globalThis.fetch = async () => ({ ok: true, status: 200, text: async () => "not-json-or-error" });
    const bad = await fetchTrafficJson("https://example.test/driving.json");
    assert.equal(bad.ok, false);
    assert.equal(bad.isPunish, true);

    // 非 200
    globalThis.fetch = async () => ({ ok: false, status: 429, text: async () => "" });
    const nok = await fetchTrafficJson("https://example.test/driving.json");
    assert.equal(nok.ok, false);
    assert.equal(nok.status, 429);
    assert.equal(nok.isPunish, undefined);
  } finally {
    globalThis.fetch = saved;
  }
});
