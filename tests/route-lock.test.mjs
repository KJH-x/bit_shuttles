import test from "node:test";
import assert from "node:assert/strict";
import { ROUTE_CFG } from "../functions/_shared/amap.js";
import { FWD_ROUTE, REV_ROUTE, trafficDirForRoute } from "../lib/traffic-routes.js";

// 前端 lib/traffic-routes.js 与后端 functions/_shared/amap.js#ROUTE_CFG 的
// fwd/rev ↔ route 字母映射必须一致；任一端改动即失败（复用性交叉锁定）。

test("后端 ROUTE_CFG.fwd.route 与前端 FWD_ROUTE 一致", () => {
  assert.equal(ROUTE_CFG.fwd.route, FWD_ROUTE);
});

test("后端 ROUTE_CFG.rev.route 与前端 REV_ROUTE 一致", () => {
  assert.equal(ROUTE_CFG.rev.route, REV_ROUTE);
});

test("后端 fwd/rev 方向键与前端 trafficDirForRoute 互补", () => {
  assert.equal(trafficDirForRoute(ROUTE_CFG.fwd.route), "fwd");
  assert.equal(trafficDirForRoute(ROUTE_CFG.rev.route), "rev");
});

test("trafficDirForRoute: 非 a/c 返回 null（西山等无路况）", () => {
  assert.equal(trafficDirForRoute("d"), null);
  assert.equal(trafficDirForRoute("e"), null);
  assert.equal(trafficDirForRoute(null), null);
  assert.equal(trafficDirForRoute(undefined), null);
});

test("FWD/REV_ROUTE 为合法 route 字母（a/c）", () => {
  assert.ok(["a", "b", "c", "d", "e"].includes(FWD_ROUTE));
  assert.ok(["a", "b", "c", "d", "e"].includes(REV_ROUTE));
});
