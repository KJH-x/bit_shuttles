// 高德实时路况 纯逻辑 + fetch 封装（零 workerd 专属依赖，可 node 单测）。
// 数据源：m.amap.com 免鉴权 driving.json（iPhone Safari UA + Referer）。
// 输出约定：只保留 dir/etaSec/distM/segments 汇总，静默丢弃 cost/trafficlights/strategy/路径细节。
//
// 三分段模型（按累计距离切）：
//   每段 weighted = Σ(status_i×dist_i)/Σdist_i（status: 1畅通 2缓行 3拥堵 4严重拥堵）
//   color: <1.5 green / <2.5 yellow / <3.5 orange / else red；k: 1.0/1.4/1.9/2.5
//   etaSec 归一化：t_seg = drivetime×(D_seg×k_seg)/Σ(D_seg×k_seg)，天然 Σ=drivetime

export const AMAP_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
export const AMAP_API = "https://m.amap.com/service/navigation/driving.json";

// fwd=良乡→中关村（route a），rev=中关村→良乡（route c）
export const ROUTE_CFG = {
  fwd: { route: "a", origin: "116.170248,39.72822", destination: "116.315469,39.959984", targetKm: 36.5, cutPoints: [17022, 27187] },
  rev: { route: "c", origin: "116.315469,39.959984", destination: "116.170248,39.72822", targetKm: 36.8, cutPoints: [18933, 30862] }
};

const AMAP_REFERER = "https://m.amap.com/navigation/carmap/";

const COLOR_K = { green: 1.0, yellow: 1.4, orange: 1.9, red: 2.5 };

// 方向 → 实时路况查询 URL（origin/destination 原样坐标，整个 URL 由调用方编码）
export function buildTrafficUrl(dir, uuid) {
  const cfg = ROUTE_CFG[dir];
  if (!cfg) throw new Error(`unknown dir: ${dir}`);
  return `${AMAP_API}?origin=${cfg.origin}&originid=&origintype=&destination=${cfg.destination}&destinationid=&destinationtype=&waypoints=&strategy=10&shareParam=&uuid=${uuid}`;
}

// 拉取 driving.json 并判定正常/惩罚页：返回 { ok, status, isPunish, json }
export async function fetchTrafficJson(url, { timeoutMs = 15000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: {
        "user-agent": AMAP_UA,
        accept: "application/json",
        "x-requested-with": "XMLHttpRequest",
        referer: AMAP_REFERER
      },
      signal: ctrl.signal
    });
    if (!res.ok) return { ok: false, status: res.status };
    const text = await res.text();
    // 惩罚页（阿里滑块）或非法响应：无 path_list 或含 punish/NCTOKENSTR/nocaptcha → 静默失败
    if (!text.includes('"path_list"') || /punish|NCTOKENSTR|nocaptcha/i.test(text)) {
      return { ok: false, status: res.status, isPunish: true };
    }
    try {
      return { ok: true, status: res.status, json: JSON.parse(text) };
    } catch {
      return { ok: false, status: res.status, isPunish: true };
    }
  } catch {
    return { ok: false, status: 0 };
  } finally {
    clearTimeout(timer);
  }
}

// 选直连路线：|distance/1000 − targetKm| 最小；无容差内匹配 → 退化取 drivetime 最小；无路径 → null
export function selectPath(pathList, targetKm, tolKm = 0.3) {
  if (!Array.isArray(pathList) || pathList.length === 0) return null;
  let best = null;
  let bestDiff = Infinity;
  for (const p of pathList) {
    const d = Number(p && p.distance);
    if (!Number.isFinite(d)) continue;
    const diff = Math.abs(d / 1000 - targetKm);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = p;
    }
  }
  if (best && bestDiff <= tolKm) return best;
  let fallback = null;
  let minT = Infinity;
  for (const p of pathList) {
    const t = Number(p && p.drivetime);
    if (!Number.isFinite(t)) continue;
    if (t < minT) {
      minT = t;
      fallback = p;
    }
  }
  return fallback;
}

function colorOf(weighted) {
  if (weighted < 1.5) return "green";
  if (weighted < 2.5) return "yellow";
  if (weighted < 3.5) return "orange";
  return "red";
}

// 按累计距离切 3 段（cutPoints=[b0,b1]：S1=(0,b0] S2=(b0,b1] S3=(b1,总距离]；边界≥总距离则钳制）。
// 返回 [{ name:"S1"|"S2"|"S3", distM, weighted, color, k, etaSec }]
export function splitSegments(path, cutPoints) {
  const total = Number(path.distance) || 0;
  const drivetime = Number(path.drivetime) || 0;
  const c0 = Math.min(cutPoints[0], total);
  const c1 = Math.min(cutPoints[1], total);

  const sums = [
    { d: 0, w: 0 },
    { d: 0, w: 0 },
    { d: 0, w: 0 }
  ];

  let cum = 0;
  const steps = Array.isArray(path.path) ? path.path : [];
  for (const step of steps) {
    const segList = Array.isArray(step && step.segments) ? step.segments : [];
    for (const seg of segList) {
      const ds = String(seg && seg.distance != null ? seg.distance : "").split(",").map(Number);
      const ss = String(seg && seg.status != null ? seg.status : "").split(",").map(Number);
      for (let i = 0; i < ds.length; i++) {
        const d = ds[i] || 0;
        const s = ss[i] || 1; // 缺路况视为畅通
        cum += d;
        const idx = cum <= c0 ? 0 : cum <= c1 ? 1 : 2;
        sums[idx].d += d;
        sums[idx].w += s * d;
      }
    }
  }

  const segs = ["S1", "S2", "S3"].map((name, idx) => {
    const distM = Math.round(sums[idx].d);
    const weighted = sums[idx].d > 0 ? Math.round((sums[idx].w / sums[idx].d) * 100) / 100 : 0;
    const color = colorOf(weighted);
    return { name, distM, weighted, color, k: COLOR_K[color], etaSec: 0, _d: sums[idx].d, _k: COLOR_K[color] };
  });

  const denom = segs.reduce((a, s) => a + s._d * s._k, 0);
  if (denom > 0 && drivetime > 0) {
    const rounded = segs.map((s) => Math.round((drivetime * s._d * s._k) / denom));
    const drift = Math.round(drivetime) - rounded.reduce((a, b) => a + b, 0);
    rounded[rounded.length - 1] += drift; // 四舍五入余数并入末段，保证 Σ=drivetime
    segs.forEach((s, i) => {
      s.etaSec = rounded[i];
    });
  }
  return segs.map(({ name, distM, weighted, color, k, etaSec }) => ({ name, distM, weighted, color, k, etaSec }));
}

// 汇总输出：只保留 dir/etaSec/distM/segments（严格不输出 cost/trafficlights/strategy/路径细节）
export function computeTraffic(dir, path) {
  const cfg = ROUTE_CFG[dir];
  return {
    dir,
    etaSec: Number(path.drivetime),
    distM: Number(path.distance),
    segments: splitSegments(path, cfg.cutPoints)
  };
}

// 单个方向：选直连路线后计算汇总；无可选路径 → null（供 api 端点对 fwd/rev 复用）
export function parseLive(json, cfg) {
  if (!json || !Array.isArray(json.path_list)) return null;
  const path = selectPath(json.path_list, cfg.targetKm);
  if (!path) return null;
  return computeTraffic(cfg.dir, path);
}
