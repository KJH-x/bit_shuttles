// 抢票提醒 / 钉钉跳转 模块（v1.24）。
// 存储（localStorage）：
//   bitbus-reminder-pref        = { askedOnce: bool, method: "calendar"|"pwa"|"both" }
//                                 （全局：只询问 1 次并记住默认方式；可在设置面板修改）
//   bitbus-reminders            = { "YYYY-MM-DD|route|dep": { method, ts } }
//                                 （每班次独立，可多选；读取时自动清理过期条目，管理生命周期）
//   bitbus-reminder-ics-dismiss = "1"（非 iOS Safari 下载 .ics 后的提示不再弹）
// 抢票提醒时刻 = T-1h（开售）− offset（默认 3 分钟）。
// 通知实现：
//   日历 → 生成 .ics（含 VALARM）下载；iOS Safari 原生「添加到日历」，其他平台提示手动打开日历导入。
//   PWA  → Notification API（需 standalone + 授权；到点通知，点击打开钉钉链接）。
// 钉钉跳转目标 = 数据源班次列表界面（勿重复探测）：
//   http://hqapp1.bit.edu.cn/newbanche/home

export const PREF_KEY = "bitbus-reminder-pref";
export const REMINDERS_KEY = "bitbus-reminders";
export const ICS_DISMISS_KEY = "bitbus-reminder-ics-dismiss";
export const DEFAULT_OFFSET_MIN = 3;
export const SALE_LEAD_MIN = 60; // 开售 = T-1h
export const MAX_REMINDERS = 100; // 存储条目上限，防膨胀
// 数据源班次列表界面（钉钉/深链目标；见 README「数据源界面」）
export const SOURCE_TRIP_URL = "http://hqapp1.bit.edu.cn/newbanche/home";
export const DINGTALK_SCHEME = "dingtalk://dingtalkclient/page/link?url=";

import { toBeijingDateStr } from "./time.js";

const DEFAULT_PREF = { askedOnce: false, method: "calendar" };
export const METHODS = ["calendar", "pwa", "both"];

function safeGet(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

// ---- 全局偏好 ----
export function readPref() {
  const p = safeGet(PREF_KEY, null);
  if (!p || typeof p !== "object") return { ...DEFAULT_PREF };
  const method = METHODS.includes(p.method) ? p.method : "calendar";
  return { askedOnce: p.askedOnce === true, method };
}

export function savePref(p) {
  localStorage.setItem(PREF_KEY, JSON.stringify({ askedOnce: p.askedOnce === true, method: METHODS.includes(p.method) ? p.method : "calendar" }));
}

// ---- 每班次提醒（日期+班次限定，可多选，生命周期管理） ----
const todayStr = toBeijingDateStr;

export function remindKey(dateStr, route, dep) {
  return `${dateStr}|${route}|${dep}`;
}

// 读取并清理过期条目（日期 < 今日；超上限丢最旧）
export function readReminders() {
  const map = safeGet(REMINDERS_KEY, {}) || {};
  const today = todayStr();
  const out = {};
  const entries = Object.entries(map).filter(([k]) => {
    const d = k.split("|")[0];
    return d >= today;
  });
  entries.sort((a, b) => (a[1] && a[1].ts || 0) - (b[1] && b[1].ts || 0));
  for (const [k, v] of entries) {
    if (Object.keys(out).length >= MAX_REMINDERS) break;
    out[k] = v;
  }
  if (Object.keys(out).length !== entries.length) {
    saveReminders(out);
  }
  return out;
}

export function saveReminders(map) {
  try {
    localStorage.setItem(REMINDERS_KEY, JSON.stringify(map));
  } catch {
    /* 存满忽略 */
  }
}

export function hasReminder(dateStr, route, dep) {
  return Object.prototype.hasOwnProperty.call(readReminders(), remindKey(dateStr, route, dep));
}

export function setReminder(dateStr, route, dep, method) {
  const map = readReminders();
  map[remindKey(dateStr, route, dep)] = { method: METHODS.includes(method) ? method : "calendar", ts: Date.now() };
  saveReminders(map);
}

export function unsetReminder(dateStr, route, dep) {
  const map = readReminders();
  delete map[remindKey(dateStr, route, dep)];
  saveReminders(map);
}

export function reminderMethodOf(dateStr, route, dep) {
  const map = readReminders();
  const rec = map[remindKey(dateStr, route, dep)];
  return rec && rec.method ? rec.method : null;
}

// ---- iOS Safari 检测（原生「添加到日历」；其他平台下载后需手动打开日历导入） ----
export function isIosSafari() {
  const ua = navigator.userAgent || "";
  const ios = /iPhone|iPad|iPod/i.test(ua);
  const safari = /Safari\//i.test(ua) && !/CriOS|FxiOS|OPiOS|EdgiOS|DingTalk|MicroMessenger/i.test(ua);
  return ios && safari;
}

// ---- 平台 / 通知 ----
export function isPwa() {
  return (
    window.matchMedia &&
    (window.matchMedia("(display-mode: standalone)").matches ||
      navigator.standalone === true ||
      window.matchMedia("(display-mode: minimal-ui)").matches)
  );
}

export function notificationSupported() {
  return "Notification" in window;
}

export function notificationGranted() {
  return notificationSupported() && Notification.permission === "granted";
}

export async function ensureNotificationPermission() {
  if (!notificationSupported()) return false;
  if (Notification.permission === "granted") return true;
  if (Notification.permission === "denied") return false;
  const perm = await Notification.requestPermission();
  return perm === "granted";
}

// ---- 钉钉跳转 ----
export function openDingTalk(targetUrl = SOURCE_TRIP_URL) {
  const scheme = DINGTALK_SCHEME + encodeURIComponent(targetUrl);
  try {
    window.location.href = scheme;
    return true;
  } catch {
    return false;
  }
}

// ---- ICS 生成（RFC 5545，含 VALARM 提醒；按指定日期） ----
function pad2(n) {
  return String(n).padStart(2, "0");
}
function utcStr(d) {
  return (
    d.getUTCFullYear() + pad2(d.getUTCMonth() + 1) + pad2(d.getUTCDate()) +
    "T" + pad2(d.getUTCHours()) + pad2(d.getUTCMinutes()) + pad2(d.getUTCSeconds()) + "Z"
  );
}

// dateStr = "YYYY-MM-DD"，dep = "HH:MM"；返回该日期该时刻的 Date
export function depDateOn(dateStr, dep) {
  const [y, mo, d] = dateStr.split("-").map(Number);
  const [h, m] = dep.split(":").map(Number);
  return new Date(y, mo - 1, d, h, m, 0, 0);
}

export function buildReminderIcs({ routeLabel, dep, dateStr, offsetMin = DEFAULT_OFFSET_MIN }) {
  const depDate = depDateOn(dateStr || todayStr(), dep);
  const saleTime = new Date(depDate.getTime() - SALE_LEAD_MIN * 60000);
  const uid = `bitbus-${dep.replace(":", "")}-${Date.now()}@bitbus`;
  const summary = `校园班车抢票提醒 ${routeLabel} ${dep}`;
  const desc = `班次 ${dep}（${dateStr || todayStr()}）开售（发车前 ${SALE_LEAD_MIN} 分钟）。站点：https://bitbus.nslc.top/`;
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//bitbus//shuttle//CN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    "UID:" + uid,
    "DTSTAMP:" + utcStr(new Date()),
    "DTSTART:" + utcStr(saleTime),
    "DTEND:" + utcStr(new Date(saleTime.getTime() + 2 * 60000)),
    "SUMMARY:" + summary,
    "DESCRIPTION:" + desc,
    "BEGIN:VALARM",
    "ACTION:DISPLAY",
    "DESCRIPTION:" + summary,
    "TRIGGER:-PT" + offsetMin + "M",
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR"
  ];
  return lines.join("\r\n");
}

// 导出日历文件名：班车.MMDD.HHMM.<时间戳hash末4>.ics
// 时间 hash 用下载时刻 ms 做乘法散列取 16 进制末 4 位（同一班次重复下载名不冲突）
export function buildReminderFilename({ dateStr, dep, now = Date.now() }) {
  const date = depDateOn(dateStr || todayStr(), dep);
  const mmdd = String(date.getMonth() + 1).padStart(2, "0") + String(date.getDate()).padStart(2, "0");
  const hhmm = dep.replace(":", "");
  // 时间 hash：位移 + 乘法散列混合，取 16 进制末 4 位（相邻毫秒也产生不同尾位）
  const n = Math.floor(now) ^ (Math.floor(now) >>> 8);
  const h = (((n >>> 0) * 2654435761) >>> 0).toString(16).padStart(5, "0").slice(-4);
  return `班车.${mmdd}.${hhmm}.${h}.ics`;
}

export function downloadIcs(ics, filename = "bitbus-reminder.ics") {
  const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// 非 iOS Safari 下载后提示「打开日历导入」是否已关闭
export function icsHintDismissed() {
  return localStorage.getItem(ICS_DISMISS_KEY) === "1";
}
export function dismissIcsHint() {
  localStorage.setItem(ICS_DISMISS_KEY, "1");
}

// ---- PWA 到点通知（按指定日期） ----
export function schedulePwaNotify({ routeLabel, dep, dateStr, offsetMin = DEFAULT_OFFSET_MIN, sourceUrl = SOURCE_TRIP_URL }) {
  if (!isPwa()) return false;
  if (!notificationGranted()) return false;
  const depDate = depDateOn(dateStr || todayStr(), dep);
  const saleTime = new Date(depDate.getTime() - SALE_LEAD_MIN * 60000);
  const remindTime = new Date(saleTime.getTime() - offsetMin * 60000);
  const delayMs = Math.max(0, remindTime.getTime() - Date.now());
  setTimeout(() => {
    const notif = new Notification(`校园班车抢票提醒 ${routeLabel} ${dep}`, {
      body: `已到开售前 ${offsetMin} 分钟，点击打开预约列表抢票。`,
      tag: `bitbus-${dep}`
    });
    notif.onclick = () => {
      window.focus();
      openDingTalk(sourceUrl);
    };
  }, delayMs);
  return true;
}
