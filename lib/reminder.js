// 抢票提醒 / 钉钉跳转 模块（v1.23）。
// - PWA 检测：standalone 显示模式（已安装到主屏幕）才启用 PWA 通知；
//   未安装 PWA 时仍可用「添加到日历」(ICS)。
// - 设置存储 localStorage：`bitbus-reminder` = { enabled, calendar, pwa }
// - 抢票提醒时刻 = T-1h（开售）− offset（默认 3 分钟）。
// - 通知实现：
//     · 日历 → 生成 .ics（含 VALARM）触发下载，系统日历导入；
//     · PWA  → Notification API（需 standalone + 用户授权；到点即通知，点击打开钉钉链接）。
// - 钉钉跳转目标 = 数据源班次列表界面（勿重复探测）：
//     http://hqapp1.bit.edu.cn/newbanche/home

export const REMINDER_KEY = "bitbus-reminder";
export const DEFAULT_OFFSET_MIN = 3;
export const SALE_LEAD_MIN = 60; // 开售 = T-1h
// 数据源班次列表界面（钉钉/深链目标；见 README「数据源界面」）
export const SOURCE_TRIP_URL = "http://hqapp1.bit.edu.cn/newbanche/home";
export const DINGTALK_SCHEME = "dingtalk://dingtalkclient/page/link?url=";

const DEFAULT_SETTINGS = { enabled: true, calendar: true, pwa: true };

export function readSettings() {
  try {
    const raw = localStorage.getItem(REMINDER_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw);
    return {
      enabled: parsed.enabled !== false,
      calendar: parsed.calendar !== false,
      pwa: parsed.pwa !== false
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(s) {
  localStorage.setItem(REMINDER_KEY, JSON.stringify(s));
}

// 是否以 PWA（已安装到主屏幕）方式运行：display-mode standalone
export function isPwa() {
  return (
    window.matchMedia &&
    (window.matchMedia("(display-mode: standalone)").matches ||
      navigator.standalone === true ||
      window.matchMedia("(display-mode: minimal-ui)").matches)
  );
}

// Notification 是否可用（浏览器支持 + 已授权）
export function notificationSupported() {
  return "Notification" in window;
}

export function notificationGranted() {
  return notificationSupported() && Notification.permission === "granted";
}

// 请求通知授权（须在用户手势内调用）
export async function ensureNotificationPermission() {
  if (!notificationSupported()) return false;
  if (Notification.permission === "granted") return true;
  if (Notification.permission === "denied") return false;
  const perm = await Notification.requestPermission();
  return perm === "granted";
}

// 打开钉钉（目标=数据源班次列表）；失败时提示用系统日历导入 ICS 兜底
export function openDingTalk(targetUrl = SOURCE_TRIP_URL) {
  const scheme = DINGTALK_SCHEME + encodeURIComponent(targetUrl);
  try {
    window.location.href = scheme;
    return true;
  } catch {
    return false;
  }
}

// ---- ICS 生成（RFC 5545，含 VALARM 提醒） ----
function pad2(n) {
  return String(n).padStart(2, "0");
}
function utcStr(d) {
  return (
    d.getUTCFullYear() + pad2(d.getUTCMonth() + 1) + pad2(d.getUTCDate()) +
    "T" + pad2(d.getUTCHours()) + pad2(d.getUTCMinutes()) + pad2(d.getUTCSeconds()) + "Z"
  );
}

// dep = "HH:MM"；返回当日该时刻的 Date（若已过则顺延一天）
export function depDateOf(dep) {
  const [h, m] = dep.split(":").map(Number);
  const d = new Date();
  d.setHours(h, m, 0, 0);
  if (d.getTime() <= Date.now()) d.setDate(d.getDate() + 1);
  return d;
}

export function buildReminderIcs({ routeLabel, dep, offsetMin = DEFAULT_OFFSET_MIN }) {
  const depDate = depDateOf(dep);
  const saleTime = new Date(depDate.getTime() - SALE_LEAD_MIN * 60000);
  const uid = `bitbus-${dep.replace(":", "")}-${Date.now()}@bitbus`;
  const summary = `校园班车抢票提醒 ${routeLabel} ${dep}`;
  const desc = `班次 ${dep} 开售（发车前 ${SALE_LEAD_MIN} 分钟）。站点：https://bitbus.nslc.top/`;
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

export function downloadIcs(ics, filename = "bitbus-reminder.ics") {
  const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// ---- PWA 到点通知 ----
// 到点后弹系统通知；点击通知 → 打开钉钉链接。
export function schedulePwaNotify({ routeLabel, dep, offsetMin = DEFAULT_OFFSET_MIN, sourceUrl = SOURCE_TRIP_URL }) {
  if (!isPwa()) return false;
  if (!notificationGranted()) return false;
  const depDate = depDateOf(dep);
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
