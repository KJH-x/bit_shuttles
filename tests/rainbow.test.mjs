import test from "node:test";
import assert from "node:assert/strict";
import {
  parseEnvelope,
  countSeats,
  mapRouteToBoard,
  pickBoardRoutes,
  buildTrips,
  COOKIE_MAX_AGE_MS
} from "../functions/_shared/rainbow.js";

test("parseEnvelope: 合法 / 超龄 / 算法不符 / 缺字段 / 空", () => {
  const ok = { v: 1, alg: "AES-GCM-256", iv: "aXY=", ts: 1000, dataC: "Y2lwaGVy" };
  assert.equal(parseEnvelope(ok, 2000).ok, true);
  assert.equal(parseEnvelope(ok, 1000 + COOKIE_MAX_AGE_MS).ok, true); // 恰为上限（> 才 stale）
  const stale = parseEnvelope(ok, 1000 + COOKIE_MAX_AGE_MS + 1);
  assert.equal(stale.ok, false);
  assert.equal(stale.reason, "stale");
  assert.equal(parseEnvelope({ ...ok, alg: "RSA-OAEP" }, 2000).reason, "unsupported");
  assert.equal(parseEnvelope({ ...ok, iv: "" }, 2000).reason, "malformed");
  assert.equal(parseEnvelope({ ...ok, ts: "x" }, 2000).reason, "bad_ts");
  assert.equal(parseEnvelope(null, 2000).reason, "empty");
});

test("countSeats: 过道/seatNum=0 不计；seats 去重后从物理座扣除", () => {
  const payload = {
    rows: [
      { row_index: 1, col_index: 1, is_passageway: 0, seatNum: 1, type: 0 },
      { row_index: 1, col_index: 2, is_passageway: 0, seatNum: 2, type: 0 },
      { row_index: 1, col_index: 3, is_passageway: 1, seatNum: 0, type: 0 }, // 过道
      { row_index: 1, col_index: 4, is_passageway: 0, seatNum: 0, type: 3 }, // seatNum=0
      { row_index: 2, col_index: 1, is_passageway: 0, seatNum: 3, type: 0 },
      { row_index: 2, col_index: 2, is_passageway: 0, seatNum: 4, type: 0 }
    ],
    seats: [
      "os:1:r:1:c:1:seat",
      "os:1:r:2:c:2:seat",
      "os:1:r:1:c:1:seat", // 重复 → 去重
      "garbage",
      null
    ]
  };
  assert.deepEqual(countSeats(payload), { seatsTotal: 4, seatsTaken: 2, seatsLeft: 2 });
});

test("countSeats: 空/缺字段 → 全 0；满座 → seatsLeft=0", () => {
  assert.deepEqual(countSeats(null), { seatsTotal: 0, seatsTaken: 0, seatsLeft: 0 });
  assert.deepEqual(countSeats({}), { seatsTotal: 0, seatsTaken: 0, seatsLeft: 0 });
  const full = {
    rows: [
      { row_index: 1, col_index: 1, is_passageway: 0, seatNum: 1 },
      { row_index: 1, col_index: 2, is_passageway: 0, seatNum: 2 }
    ],
    seats: ["os:9:r:1:c:1:seat", "os:9:r:1:c:2:seat"]
  };
  assert.deepEqual(countSeats(full), { seatsTotal: 2, seatsTaken: 2, seatsLeft: 0 });
});

test("mapRouteToBoard: 良乡-中关村→a（早班）、中关村-良乡→c（晚班）、其他→null", () => {
  assert.equal(mapRouteToBoard("理工01良乡-中关村（首班）"), "a");
  assert.equal(mapRouteToBoard("理工03中关村-良乡（首班）"), "c");
  assert.equal(mapRouteToBoard("理工01良乡→中关村"), "a");
  assert.equal(mapRouteToBoard("理工02中关村—良乡"), "c");
  assert.equal(mapRouteToBoard("某某环线"), null);
  assert.equal(mapRouteToBoard(""), null);
});

test("pickBoardRoutes: 仅取名称含「理工」且方向可映射且有 id 者（含 presentPrice）", () => {
  const routes = [
    { id: 788, name: "理工01良乡-中关村（首班）", first_station_time: "07:30", service_date: "2026-09-11", presentPrice: "9" },
    { id: 2110, name: "理工03中关村-良乡（首班）", first_station_time: "08:00" },
    { id: 999, name: "某某专线良乡-中关村" }, // 非理工 → 排除
    { id: 1000, name: "理工99西山环线" }, // 方向不可映射 → 排除
    { id: "", name: "理工01良乡-中关村" } // 空 id → 排除
  ];
  const out = pickBoardRoutes(routes);
  assert.equal(out.length, 2);
  assert.deepEqual(out[0], { routesId: 788, name: "理工01良乡-中关村（首班）", boardRoute: "a", dep: "07:30", serviceDate: "2026-09-11", price: "9" });
  assert.equal(out[1].boardRoute, "c");
  assert.equal(out[1].price, null);
});

test("buildTrips: routes × plan × seats 组合（含 price/serviceDate）", () => {
  const entries = [{ routesId: 788, name: "理工01良乡-中关村（首班）", boardRoute: "a", dep: "07:30", serviceDate: "2026-09-11", price: "9" }];
  const plansByRoute = new Map([[788, [{ id: 417302, service_date: "2026-09-14" }]]]);
  const seatsByPlan = new Map([[417302, { seatsTotal: 49, seatsTaken: 49, seatsLeft: 0 }]]);
  const trips = buildTrips(entries, plansByRoute, seatsByPlan);
  assert.equal(trips.length, 1);
  assert.deepEqual(trips[0], {
    routesId: 788,
    planId: 417302,
    boardRoute: "a",
    name: "理工01良乡-中关村（首班）",
    serviceDate: "2026-09-14",
    dep: "07:30",
    price: "9",
    seatsTotal: 49,
    seatsTaken: 49,
    seatsLeft: 0
  });
  // 无 plan / 无 seats → 不输出
  assert.equal(buildTrips(entries, new Map(), new Map()).length, 0);
});
