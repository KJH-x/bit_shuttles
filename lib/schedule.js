function timeToMin(dep) {
  const [h, m] = dep.split(":").map(Number);
  return h * 60 + m;
}

export function lookupDuration(dep, profile) {
  if (!Array.isArray(profile) || profile.length === 0) return null;
  const target = timeToMin(dep);
  let best = null;
  let bestDiff = Infinity;
  for (const entry of profile) {
    const diff = Math.abs(timeToMin(entry.time) - target);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = entry.minutes;
    }
  }
  return best;
}

export function tripDuration(trip, durationByRoute, defaultMin, profiles) {
  if (trip.dur != null) return trip.dur;
  if (profiles && profiles[trip.route]) {
    const fromProfile = lookupDuration(trip.dep, profiles[trip.route]);
    if (fromProfile != null) return fromProfile;
  }
  return durationByRoute[trip.route] ?? defaultMin;
}

export function depToMs(dep, refDate = new Date()) {
  const [h, m] = dep.split(":").map(Number);
  const d = new Date(refDate);
  d.setHours(h, m, 0, 0);
  return d.getTime();
}

export function tripStatus(trip, now, durationByRoute, defaultMin, profiles) {
  const depMs = depToMs(trip.dep, new Date(now));
  const arrMs = depMs + tripDuration(trip, durationByRoute, defaultMin, profiles) * 60000;
  let status;
  let progress;
  if (now < depMs) {
    status = "upcoming";
    progress = 0;
  } else if (now < arrMs) {
    status = "running";
    progress = Math.min(1, (now - depMs) / (arrMs - depMs));
  } else {
    status = "past";
    progress = 1;
  }
  return { ...trip, depMs, arrMs, status, progress };
}

export function computeAll(trips, now, durationByRoute, defaultMin, profiles) {
  return trips.map((t) => tripStatus(t, now, durationByRoute, defaultMin, profiles));
}

export function formatDurationLabel(ms) {
  const totalMin = Math.max(0, Math.round(ms / 60000));
  if (totalMin < 1) return "即将";
  if (totalMin < 60) return `${totalMin} 分钟`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return m ? `${h} 小时 ${m} 分钟` : `${h} 小时`;
}

export function formatClock(date) {
  const p = (n) => String(n).padStart(2, "0");
  return `${p(date.getHours())}:${p(date.getMinutes())}:${p(date.getSeconds())}`;
}

export function formatHM(date) {
  const p = (n) => String(n).padStart(2, "0");
  return `${p(date.getHours())}:${p(date.getMinutes())}`;
}

export function formatHMS(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const p = (n) => String(n).padStart(2, "0");
  return `${p(h)}:${p(m)}:${p(s)}`;
}

export function ticketInfo(trip, now) {
  if (trip.price === "¥0.00") {
    return { type: "free", label: "免费 · 全天可约" };
  }
  if (trip.rainbow) {
    return { type: "rainbow", label: "彩虹 · 全周可约" };
  }
  const saleOpen = trip.depMs - 60 * 60000;
  const saleClose = trip.depMs - 5 * 60000;
  const soldOutAfter = saleOpen + 5 * 60000;
  if (now < saleOpen) {
    return { type: "regular", phase: "wait", label: `距开售 ${formatHMS(saleOpen - now)}`, saleOpen, saleClose };
  }
  if (now < soldOutAfter) {
    return { type: "regular", phase: "onsale", label: "开售中 · 立即抢", saleOpen, saleClose };
  }
  if (now < saleClose) {
    return { type: "regular", phase: "soldout", label: "可能已售罄", saleOpen, saleClose };
  }
  return { type: "regular", phase: "closed", label: "已停止售票", saleOpen, saleClose };
}
