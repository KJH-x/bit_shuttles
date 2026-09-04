// R2 历史记录 / 客流对比 / last-failed 日志 读写。
// 依赖 workerd 的 env.AVAIL_BUCKET（R2 bucket 绑定，生产由运行时注入，无需任何 key）。
// 结构：
//   avail/{YYYY-MM-DD}.json      每日快照（保留 7 天）
//   avail/cumulative.json        超过 7 天的累计统计（按工作日/周末，天数加权）
//   avail/last-failed.json       源站不可达时的失败日志（覆盖写）

import {
  dayAvgRatio,
  foldInto,
  emptyCumulative,
  groupOf,
  cumulativeAvg,
  trafficView,
  shiftDate
} from "./metrics.js";

export const SNAPSHOT_PREFIX = "avail/";
export const LIVE_PREFIX = "avail/live/";
export const META_PREFIX = "avail/meta/";
export const TRIP_PREFIX = "avail/trip/";
export const CUMULATIVE_KEY = "avail/cumulative.json";
export const LAST_FAILED_KEY = "avail/last-failed.json";
const SNAPSHOT_KEEP_DAYS = 7;
const DATE_RE = /^avail\/(\d{4}-\d{2}-\d{2})\.json$/;

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

export async function writeSnapshot(bucket, date, trips) {
  await writeJson(bucket, `${SNAPSHOT_PREFIX}${date}.json`, { date, savedAt: Date.now(), trips });
}

export async function readSnapshot(bucket, date) {
  return readJson(bucket, `${SNAPSHOT_PREFIX}${date}.json`);
}

// R2 live 缓存（跨设备共享）：存最近一次成功拉取的余票数据 + 抓取时间
// 命中条件：now - fetchedAt < minTtl*1000（由写入方根据最小 TTL 计算）
export async function writeLiveCache(bucket, date, payload) {
  await writeJson(bucket, `${LIVE_PREFIX}${date}.json`, { ...payload, fetchedAt: Date.now() });
}

export async function readLiveCache(bucket, date) {
  return readJson(bucket, `${LIVE_PREFIX}${date}.json`);
}

// 每日 get-list 元数据缓存（id/name/dep/type/price 映射，1h TTL）
export async function writeMetaCache(bucket, date, rows) {
  await writeJson(bucket, `${META_PREFIX}${date}.json`, { date, savedAt: Date.now(), rows });
}

export async function readMetaCache(bucket, date) {
  return readJson(bucket, `${META_PREFIX}${date}.json`);
}

// 单趟余票缓存（stale-while-revalidate 用）
export async function writeTripCache(bucket, date, route, dep, data) {
  await writeJson(bucket, `${TRIP_PREFIX}${date}/${route}-${dep}.json`, { ...data, fetchedAt: Date.now() });
}

export async function readTripCache(bucket, date, route, dep) {
  return readJson(bucket, `${TRIP_PREFIX}${date}/${route}-${dep}.json`);
}

export async function readCumulative(bucket) {
  const cum = await readJson(bucket, CUMULATIVE_KEY);
  return cum && cum.weekday ? cum : emptyCumulative();
}

export async function writeLastFailed(bucket, { date, error, attempts }) {
  await writeJson(bucket, LAST_FAILED_KEY, { at: Date.now(), date, error, attempts });
}

// 将超过保留期的旧快照折入累计（按天数加权）并删除；只保留最近 7 天。
export async function rollupExpiredSnapshots(bucket, todayStr) {
  let cum = await readCumulative(bucket);
  let cursor;
  const cutoff = shiftDate(todayStr, -SNAPSHOT_KEEP_DAYS); // 严格早于此的才折入
  do {
    const listed = await bucket.list({ prefix: SNAPSHOT_PREFIX, cursor });
    cursor = listed.cursor;
    for (const obj of listed.objects) {
      const m = DATE_RE.exec(obj.key);
      if (!m) continue;
      const date = m[1];
      if (date >= cutoff) continue;
      const snap = await readSnapshot(bucket, date);
      if (snap && snap.trips) {
        const ratio = dayAvgRatio(snap.trips);
        cum = foldInto(cum, date, ratio);
      }
      await bucket.delete(obj.key);
    }
  } while (cursor);
  await writeJson(bucket, CUMULATIVE_KEY, cum);
  return cum;
}

// 今日客流对比：与同期（同工作日/周末）历史平均比较，输出红/绿上下箭头数据。
export async function trafficForToday(bucket, todayStr, todayTrips) {
  const cum = await readCumulative(bucket);
  const key = groupOf(todayStr);
  const base = cumulativeAvg(cum, key);
  const todayRatio = dayAvgRatio(todayTrips);
  return { ...(trafficView(todayRatio, base) || { delta: null, dir: null, color: null, raw: null }), baseRatio: base, todayRatio };
}
