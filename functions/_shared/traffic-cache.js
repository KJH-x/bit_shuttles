// 高德实时路况 R2 缓存读写（仿 history.js：私有 readJson/writeJson 辅助）。
// 结构：
//   traffic/live.json   最近一次成功拉取的双方向路况（{ fetchedAt, fwd, rev }）
//   traffic/state.json  刷新状态（{ lastRefreshAt }，供限频闸）

export const TRAFFIC_LIVE_KEY = "traffic/live.json";
export const TRAFFIC_STATE_KEY = "traffic/state.json";

async function readJson(bucket, key) {
  const obj = await bucket.get(key);
  if (!obj) return null;
  const text = await obj.text();
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function writeJson(bucket, key, data) {
  await bucket.put(key, JSON.stringify(data));
}

// 实时路况 live 缓存：{ fetchedAt, fwd, rev }（fwd/rev 为 computeTraffic 输出，单方向失败可能为 null）
export async function readTrafficLive(bucket) {
  return readJson(bucket, TRAFFIC_LIVE_KEY);
}

export async function writeTrafficLive(bucket, { fwd, rev }) {
  await writeJson(bucket, TRAFFIC_LIVE_KEY, { fwd, rev, fetchedAt: Date.now() });
}

// 刷新状态（限频闸）：{ lastRefreshAt }
export async function readTrafficState(bucket) {
  return readJson(bucket, TRAFFIC_STATE_KEY);
}

export async function writeTrafficState(bucket, state) {
  await writeJson(bucket, TRAFFIC_STATE_KEY, state);
}
