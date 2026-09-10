// 历史查询辅助：GET /api/history/dates → 近 7 天内有快照的历史日期列表（供日期选择器驱动）。
import { json, cacheHeaders } from "../../_shared/response.js";
import { listSnapshotDates } from "../../_shared/history.js";
import { beijingDateStr } from "../../_shared/ttl.js";

export async function onRequest({ env }) {
  const bucket = env.AVAIL_BUCKET;
  const today = beijingDateStr(Date.now());
  const dates = await listSnapshotDates(bucket, today);
  return json({ serverNow: Date.now(), dates }, 200, cacheHeaders(300));
}
