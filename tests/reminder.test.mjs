import test from "node:test";
import assert from "node:assert/strict";
import { mock } from "node:test";

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear()
};
function setNavigator(obj) {
  Object.defineProperty(globalThis, "navigator", { value: obj, configurable: true, writable: true });
}
setNavigator({ standalone: false });
globalThis.window = { matchMedia: () => ({ matches: false }) };

const {
  REMINDER_KEY,
  DEFAULT_OFFSET_MIN,
  SALE_LEAD_MIN,
  SOURCE_TRIP_URL,
  DINGTALK_SCHEME,
  readSettings,
  saveSettings,
  isPwa,
  notificationSupported,
  notificationGranted,
  depDateOf,
  buildReminderIcs
} = await import("../lib/reminder.js");

function parseIcsUtc(s) {
  const m = s.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
  assert.ok(m, `bad ICS date: ${s}`);
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]));
}

test("reminder: 常量（默认提前量 3 分钟 / 开售提前 60 分钟 / 数据源 URL）", () => {
  assert.equal(DEFAULT_OFFSET_MIN, 3);
  assert.equal(SALE_LEAD_MIN, 60);
  assert.equal(SOURCE_TRIP_URL, "http://hqapp1.bit.edu.cn/newbanche/home");
  assert.equal(DINGTALK_SCHEME, "dingtalk://dingtalkclient/page/link?url=");
});

test("readSettings: 无存储时返回默认 {enabled,calendar,pwa}=true", () => {
  store.clear();
  assert.deepEqual(readSettings(), { enabled: true, calendar: true, pwa: true });
});

test("readSettings: 缺字段归一化 + 损坏 JSON 回退默认", () => {
  store.set(REMINDER_KEY, JSON.stringify({ enabled: false }));
  assert.deepEqual(readSettings(), { enabled: false, calendar: true, pwa: true });
  store.set(REMINDER_KEY, "{not-json");
  assert.deepEqual(readSettings(), { enabled: true, calendar: true, pwa: true });
});

test("saveSettings/readSettings: 往返一致，且写入 REMINDER_KEY", () => {
  store.clear();
  saveSettings({ enabled: true, calendar: false, pwa: true });
  assert.equal(store.get(REMINDER_KEY), JSON.stringify({ enabled: true, calendar: false, pwa: true }));
  assert.deepEqual(readSettings(), { enabled: true, calendar: false, pwa: true });
});

test("depDateOf: 冻结时间下，未过时刻=今日、已过时刻顺延一日", () => {
  mock.timers.enable({ apis: ["Date"], now: new Date(2026, 8, 4, 6, 0, 0).getTime() });
  try {
    const future = depDateOf("08:00");
    assert.equal(future.getFullYear(), 2026);
    assert.equal(future.getMonth(), 8);
    assert.equal(future.getDate(), 4);
    assert.equal(future.getHours(), 8);
    assert.equal(future.getMinutes(), 0);
    const past = depDateOf("05:00");
    assert.equal(past.getDate(), 5);
    assert.equal(past.getHours(), 5);
    assert.equal(past.getMinutes(), 0);
  } finally {
    mock.timers.reset();
  }
});

test("buildReminderIcs: RFC5545 结构与 VALARM（含 TRIGGER/SUMMARY/UID）", () => {
  const ics = buildReminderIcs({ routeLabel: "良乡→中关村", dep: "12:00" });
  const lines = ics.split("\r\n");
  assert.equal(lines[0], "BEGIN:VCALENDAR");
  assert.equal(lines[lines.length - 1], "END:VCALENDAR");
  assert.ok(lines.includes("BEGIN:VEVENT"));
  assert.ok(lines.includes("BEGIN:VALARM"));
  assert.ok(lines.includes("ACTION:DISPLAY"));
  assert.ok(lines.includes("TRIGGER:-PT3M"));
  assert.ok(lines.includes("SUMMARY:校园班车抢票提醒 良乡→中关村 12:00"));
  const uid = lines.find((l) => l.startsWith("UID:"));
  assert.match(uid, /^UID:bitbus-1200-\d+@bitbus$/);
});

test("buildReminderIcs: DTSTART=开售时刻（发车前 60 分钟），DTEND=DTSTART+2min，offsetMin 覆盖 TRIGGER", () => {
  const dep = "08:30";
  const ics = buildReminderIcs({ routeLabel: "测试", dep, offsetMin: 5 });
  const field = (name) => {
    const line = ics.split("\r\n").find((l) => l.startsWith(name + ":"));
    assert.ok(line, `missing ${name}`);
    return parseIcsUtc(line.slice(name.length + 1));
  };
  const saleTime = depDateOf(dep).getTime() - SALE_LEAD_MIN * 60000;
  assert.equal(field("DTSTART").getTime(), saleTime);
  assert.equal(field("DTEND").getTime(), saleTime + 2 * 60000);
  assert.ok(ics.includes("TRIGGER:-PT5M"));
});

test("isPwa / notificationSupported / notificationGranted: 能力判定", () => {
  setNavigator({ standalone: false });
  globalThis.window = { matchMedia: () => ({ matches: false }) };
  assert.equal(isPwa(), false);
  assert.equal(notificationSupported(), false);
  assert.equal(notificationGranted(), false);

  globalThis.window = { matchMedia: () => ({ matches: true }) };
  assert.equal(isPwa(), true);

  globalThis.window = { matchMedia: (q) => ({ matches: q === "(display-mode: minimal-ui)" }) };
  assert.equal(isPwa(), true);

  setNavigator({ standalone: true });
  globalThis.window = { matchMedia: () => ({ matches: false }) };
  assert.equal(isPwa(), true);

  globalThis.Notification = { permission: "granted" };
  globalThis.window = { matchMedia: () => ({ matches: false }), Notification: globalThis.Notification };
  assert.equal(notificationSupported(), true);
  assert.equal(notificationGranted(), true);

  globalThis.Notification = { permission: "denied" };
  assert.equal(notificationGranted(), false);
});
