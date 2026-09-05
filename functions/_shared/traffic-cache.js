// 高德实时路况 R2 缓存读取。
// 注意：traffic/live.json 由本地计划任务脚本（SigV4 PUT，见 workspace/campus-shuttle-amap-refresh-20260905/）
// 直接写入，Pages Function 只读。结构：{ fetchedAt, fwd, rev }（fwd/rev 为 computeTraffic 输出，单方向失败可能为 null）。

export const TRAFFIC_LIVE_KEY = "traffic/live.json";

export async function readTrafficLive(bucket) {
  const obj = await bucket.get(TRAFFIC_LIVE_KEY);
  if (!obj) return null;
  const text = await obj.text();
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
