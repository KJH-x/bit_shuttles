// 高德实时路况的方向 ↔ route 映射（前端单一事实来源）。
// fwd=良乡→中关村（route a），rev=中关村→良乡（route c）。
// 后端对应：functions/_shared/amap.js#ROUTE_CFG（route 字段须与此一致，
// 由 tests/route-lock.test.mjs 交叉锁定，任一端改动即失败）。

export const FWD_ROUTE = "a";
export const REV_ROUTE = "c";

// route → 实时路况方向（dir）；非 a/c 返回 null（西山/其他无路况）
export function trafficDirForRoute(route) {
  if (route === FWD_ROUTE) return "fwd";
  if (route === REV_ROUTE) return "rev";
  return null;
}
