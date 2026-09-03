function timeToMin(dep) {
  const [h, m] = dep.split(":").map(Number);
  return h * 60 + m;
}

export const MAX_DURATION_MIN = 60;

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
  let minutes;
  if (trip.dur != null) {
    minutes = trip.dur;
  } else if (profiles && profiles[trip.route]) {
    const fromProfile = lookupDuration(trip.dep, profiles[trip.route]);
    minutes = fromProfile != null ? fromProfile : (durationByRoute[trip.route] ?? defaultMin);
  } else {
    minutes = durationByRoute[trip.route] ?? defaultMin;
  }
  return Math.min(minutes, MAX_DURATION_MIN);
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
  if (totalMin < 1) return "不足 1 分钟";
  if (totalMin < 60) return `${totalMin} 分钟`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return m ? `${h} 小时 ${m} 分钟` : `${h} 小时`;
}

export function departureLabel(trip, now) {
  const diff = trip.depMs - now;
  if (diff > 0) {
    if (diff < 60000) return "即将发车";
    return `${formatDurationLabel(diff)}后`;
  }
  const elapsed = now - trip.depMs;
  if (elapsed < 5 * 60000) return "已发车 · 可能还在上车点";
  return "已发车";
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

export const BOARDING_WINDOW_MIN = 5;

export function fidsStatus(trip, now) {
  if (now < trip.depMs - BOARDING_WINDOW_MIN * 60000) return { phase: "wait", label: "等待发车" };
  if (now < trip.depMs) return { phase: "urge", label: "催促上车" };
  if (now < trip.arrMs) return { phase: "dep", label: "已出发" };
  return { phase: "arr", label: "已到达" };
}

export function checkpointOffsets(checkpoints) {
  if (!Array.isArray(checkpoints) || checkpoints.length === 0) return [];
  return checkpoints.map((_, i) => (i + 1) / (checkpoints.length + 1));
}

export function checkpointLabel(cp) {
  return cp.note ? `${cp.name}${cp.note}` : cp.name;
}

export function checkpointTimes(trip, checkpoints) {
  if (!Array.isArray(checkpoints) || checkpoints.length === 0) return [];
  const span = Math.max(0, trip.arrMs - trip.depMs);
  const offsets = checkpointOffsets(checkpoints);
  return checkpoints.map((cp, i) => ({
    label: checkpointLabel(cp),
    ms: trip.depMs + Math.round(span * offsets[i])
  }));
}

export function ticketInfo(trip, now) {
  if (trip.price === "¥0.00") {
    return { type: "free", label: "全天可约" };
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
