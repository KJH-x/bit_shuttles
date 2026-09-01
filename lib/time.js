const SOURCES = [
  {
    name: "akamai",
    url: "https://time.akamai.com/",
    parse: (text) => parseInt(String(text).trim(), 10) * 1000
  },
  {
    name: "timeapi",
    url: "https://timeapi.io/api/Time/current/zone?timeZone=Asia/Shanghai",
    parse: (json) => {
      let iso = String(json.dateTime ?? "").replace(/\.\d+/, "");
      if (iso && !/[zZ]|[+-]\d{2}:\d{2}$/.test(iso)) iso += "+08:00";
      const ms = Date.parse(iso);
      if (Number.isNaN(ms)) throw new Error("bad date");
      return ms;
    }
  }
];

const state = {
  offsetMs: 0,
  synced: false,
  source: null,
  lastSync: 0,
  error: null
};

function measure(serverMs, t0) {
  const t1 = Date.now();
  state.offsetMs = serverMs - Math.round((t0 + t1) / 2);
  state.synced = true;
  state.lastSync = t1;
  return state.offsetMs;
}

export function now() {
  return Date.now() + state.offsetMs;
}

export function getSyncState() {
  return { ...state };
}

export async function syncClock() {
  for (const src of SOURCES) {
    const t0 = Date.now();
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 6000);
      const res = await fetch(src.url, { cache: "no-store", signal: ctrl.signal });
      clearTimeout(timer);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.text();
      const serverMs = src.parse(data);
      measure(serverMs, t0);
      state.source = src.name;
      state.error = null;
      return true;
    } catch (err) {
      state.error = `${src.name}: ${err.message}`;
    }
  }
  state.synced = false;
  state.source = null;
  state.offsetMs = 0;
  return false;
}
