export function tripDuration(trip, durationByRoute, defaultMin) {
  return trip.dur ?? durationByRoute[trip.route] ?? defaultMin;
}

export function depToMs(dep, refDate = new Date()) {
  const [h, m] = dep.split(":").map(Number);
  const d = new Date(refDate);
  d.setHours(h, m, 0, 0);
  return d.getTime();
}

export function tripStatus(trip, now, durationByRoute, defaultMin) {
  const depMs = depToMs(trip.dep, new Date(now));
  const arrMs = depMs + tripDuration(trip, durationByRoute, defaultMin) * 60000;
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

export function computeAll(trips, now, durationByRoute, defaultMin) {
  return trips.map((t) => tripStatus(t, now, durationByRoute, defaultMin));
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
