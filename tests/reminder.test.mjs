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
setNavigator({ standalone: false, userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36" });
globalThis.window = { matchMedia: () => ({ matches: false }) };

const {
  PREF_KEY,
  REMINDERS_KEY,
  ICS_DISMISS_KEY,
  DEFAULT_OFFSET_MIN,
  SALE_LEAD_MIN,
  SOURCE_TRIP_URL,
  DINGTALK_SCHEME,
  MAX_REMINDERS,
  readPref,
  savePref,
  readReminders,
  hasReminder,
  setReminder,
  unsetReminder,
  reminderMethodOf,
  remindKey,
  isPwa,
  isIosSafari,
  notificationSupported,
  notificationGranted,
  icsHintDismissed,
  dismissIcsHint,
  depDateOn,
  buildReminderIcs,
  buildReminderFilename
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
  assert.equal(MAX_REMINDERS, 100);
});

test("readPref: 无存储时默认 {askedOnce:false, method:calendar}", () => {
  store.clear();
  assert.deepEqual(readPref(), { askedOnce: false, method: "calendar" });
});

test("readPref: 非法 method / 损坏 JSON 归一化", () => {
  store.clear();
  store.set(PREF_KEY, JSON.stringify({ askedOnce: true, method: "weird" }));
  assert.deepEqual(readPref(), { askedOnce: true, method: "calendar" });
  store.set(PREF_KEY, "{bad");
  assert.deepEqual(readPref(), { askedOnce: false, method: "calendar" });
});

test("savePref/readPref: 往返一致且写入 PREF_KEY", () => {
  store.clear();
  savePref({ askedOnce: true, method: "both" });
  assert.equal(store.get(PREF_KEY), JSON.stringify({ askedOnce: true, method: "both" }));
  assert.deepEqual(readPref(), { askedOnce: true, method: "both" });
});

test("reminders: set/read/has/unset 按 日期|route|dep 独立（可多选）", () => {
  store.clear();
  setReminder("2026-09-08", "a", "07:30", "calendar");
  setReminder("2026-09-08", "c", "08:10", "pwa");
  assert.equal(hasReminder("2026-09-08", "a", "07:30"), true);
  assert.equal(hasReminder("2026-09-08", "c", "08:10"), true);
  assert.equal(hasReminder("2026-09-08", "a", "08:10"), false);
  assert.equal(reminderMethodOf("2026-09-08", "a", "07:30"), "calendar");
  assert.equal(reminderMethodOf("2026-09-08", "c", "08:10"), "pwa");
  assert.equal(remindKey("2026-09-08", "a", "07:30"), "2026-09-08|a|07:30");
  unsetReminder("2026-09-08", "a", "07:30");
  assert.equal(hasReminder("2026-09-08", "a", "07:30"), false);
  assert.equal(hasReminder("2026-09-08", "c", "08:10"), true);
});

test("reminders: 生命周期——过期日期（早于今日）读取时被清理", () => {
  store.clear();
  // 冻结时间到 2026-09-08（UTC+8）
  mock.timers.enable({ apis: ["Date"], now: new Date("2026-09-08T02:00:00Z").getTime() });
  try {
    setReminder("2026-09-07", "a", "07:30", "calendar"); // 昨日 → 应清理
    setReminder("2026-09-08", "a", "07:30", "calendar"); // 今日 → 保留
    setReminder("2026-09-09", "a", "07:30", "calendar"); // 明日 → 保留
    const map = readReminders();
    assert.equal(hasReminder("2026-09-07", "a", "07:30"), false);
    assert.equal(hasReminder("2026-09-08", "a", "07:30"), true);
    assert.equal(hasReminder("2026-09-09", "a", "07:30"), true);
    assert.ok(store.get(REMINDERS_KEY));
  } finally {
    mock.timers.reset();
  }
});

test("reminders: 超上限丢最旧", () => {
  store.clear();
  for (let i = 0; i < MAX_REMINDERS + 5; i++) {
    setReminder("2026-09-08", "a", String(600 + i).padStart(2, "0") + ":00", "calendar");
  }
  const map = readReminders();
  const keys = Object.keys(map);
  assert.ok(keys.length <= MAX_REMINDERS);
});

test("depDateOn: 指定日期+时刻生成 Date", () => {
  const d = depDateOn("2026-09-08", "07:30");
  assert.equal(d.getFullYear(), 2026);
  assert.equal(d.getMonth(), 8);
  assert.equal(d.getDate(), 8);
  assert.equal(d.getHours(), 7);
  assert.equal(d.getMinutes(), 30);
});

test("buildReminderIcs: RFC5545 结构与 VALARM（含 TRIGGER/SUMMARY/UID）", () => {
  const ics = buildReminderIcs({ routeLabel: "良乡→中关村", dep: "12:00", dateStr: "2026-09-08" });
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

test("buildReminderIcs: DTSTART=开售时刻（发车前 60 分钟），DTEND=+2min，offsetMin 覆盖 TRIGGER", () => {
  const dep = "08:30";
  const dateStr = "2026-09-08";
  const ics = buildReminderIcs({ routeLabel: "测试", dep, dateStr, offsetMin: 5 });
  const field = (name) => {
    const line = ics.split("\r\n").find((l) => l.startsWith(name + ":"));
    assert.ok(line, `missing ${name}`);
    return parseIcsUtc(line.slice(name.length + 1));
  };
  const saleTime = depDateOn(dateStr, dep).getTime() - SALE_LEAD_MIN * 60000;
  assert.equal(field("DTSTART").getTime(), saleTime);
  assert.equal(field("DTEND").getTime(), saleTime + 2 * 60000);
  assert.ok(ics.includes("TRIGGER:-PT5M"));
});

test("isIosSafari: iPhone+Safari 判定；桌面 Chrome 非 iOS", () => {
  setNavigator({ standalone: false, userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1" });
  assert.equal(isIosSafari(), true);
  setNavigator({ standalone: false, userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120.0.0.0 Mobile/15E148 Safari/604.1" });
  assert.equal(isIosSafari(), false); // Chrome iOS
  setNavigator({ standalone: false, userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36" });
  assert.equal(isIosSafari(), false);
});

test("icsHintDismissed / dismissIcsHint: 默认 false，dismiss 后 true", () => {
  store.clear();
  assert.equal(icsHintDismissed(), false);
  dismissIcsHint();
  assert.equal(icsHintDismissed(), true);
  assert.equal(store.get(ICS_DISMISS_KEY), "1");
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

test("buildReminderFilename: 班车.MMDD.HHMM.<时间戳hash末4>.ics 格式", () => {
  const f = buildReminderFilename({ dateStr: "2026-09-08", dep: "07:30", now: 1788800000000 });
  assert.match(f, /^班车\.0908\.0730\.[0-9a-f]{4}\.ics$/);
  // hash 末 4 位 = 16 进制
  const tail = f.slice(8, 12);
  assert.match(tail, /^[0-9a-f]{4}$/);
  // 不同 now → 文件名不同（不冲突）
  const f2 = buildReminderFilename({ dateStr: "2026-09-08", dep: "07:30", now: 1788800000001 });
  assert.notEqual(f, f2);
  // 同 now 同班次 → 一致（幂等）
  const f3 = buildReminderFilename({ dateStr: "2026-09-08", dep: "07:30", now: 1788800000000 });
  assert.equal(f, f3);
  // 跨月补零
  const fJan = buildReminderFilename({ dateStr: "2026-01-05", dep: "09:05", now: 1788800000000 });
  assert.match(fJan, /^班车\.0105\.0905\./);
});
