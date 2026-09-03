export const DURATION_MIN = 60;

export const DURATION_BY_ROUTE = {};

export { DURATION_PROFILES, DURATION_PROFILE_NOTES } from "./lib/duration-profiles.js?v=20260902-7";

export const ROUTES = [
  { id: "a", label: "良乡 → 中关村" },
  { id: "c", label: "中关村 → 良乡" },
  { id: "d", label: "中关村 → 西山" },
  { id: "e", label: "西山 → 中关村" }
];

export const TRIPS = [
  { id: "a1",  route: "a", dep: "06:20", price: "¥0.00",  rainbow: false },
  { id: "a2",  route: "a", dep: "06:50", price: "¥0.00",  rainbow: false },
  { id: "a3",  route: "a", dep: "07:30", price: "¥10.00", rainbow: true },
  { id: "a4",  route: "a", dep: "07:50", price: "¥10.00", rainbow: false },
  { id: "a5",  route: "a", dep: "08:10", price: "¥10.00", rainbow: true },
  { id: "a6",  route: "a", dep: "08:30", price: "¥10.00", rainbow: false },
  { id: "a7",  route: "a", dep: "10:10", price: "¥10.00", rainbow: true },
  { id: "a8",  route: "a", dep: "11:20", price: "¥10.00", rainbow: false },
  { id: "a9",  route: "a", dep: "12:00", price: "¥10.00", rainbow: true },
  { id: "a10", route: "a", dep: "12:40", price: "¥10.00", rainbow: false },
  { id: "a11", route: "a", dep: "13:00", price: "¥10.00", rainbow: false },
  { id: "a12", route: "a", dep: "13:50", price: "¥10.00", rainbow: false },
  { id: "a13", route: "a", dep: "14:30", price: "¥10.00", rainbow: false },
  { id: "a14", route: "a", dep: "15:20", price: "¥10.00", rainbow: true },
  { id: "a15", route: "a", dep: "16:10", price: "¥10.00", rainbow: false },
  { id: "a16", route: "a", dep: "17:05", price: "¥10.00", rainbow: true },
  { id: "a17", route: "a", dep: "17:20", price: "¥10.00", rainbow: false },
  { id: "a18", route: "a", dep: "18:00", price: "¥10.00", rainbow: false },
  { id: "a19", route: "a", dep: "18:30", price: "¥10.00", rainbow: false },
  { id: "a20", route: "a", dep: "20:15", price: "¥10.00", rainbow: false },
  { id: "a21", route: "a", dep: "21:10", price: "¥10.00", rainbow: false },
  { id: "a22", route: "a", dep: "22:30", price: "¥0.00",  rainbow: false },
  { id: "a23", route: "a", dep: "22:50", price: "¥0.00",  rainbow: false },

  { id: "c1",  route: "c", dep: "06:40", price: "¥0.00",  rainbow: false },
  { id: "c2",  route: "c", dep: "07:30", price: "¥0.00",  rainbow: false },
  { id: "c3",  route: "c", dep: "07:50", price: "¥10.00", rainbow: false },
  { id: "c4",  route: "c", dep: "08:00", price: "¥10.00", rainbow: true },
  { id: "c5",  route: "c", dep: "08:10", price: "¥10.00", rainbow: false },
  { id: "c6",  route: "c", dep: "08:40", price: "¥10.00", rainbow: false },
  { id: "c7",  route: "c", dep: "10:10", price: "¥10.00", rainbow: true },
  { id: "c8",  route: "c", dep: "11:20", price: "¥10.00", rainbow: false },
  { id: "c9",  route: "c", dep: "12:00", price: "¥10.00", rainbow: true },
  { id: "c10", route: "c", dep: "12:40", price: "¥10.00", rainbow: false },
  { id: "c11", route: "c", dep: "13:10", price: "¥10.00", rainbow: false },
  { id: "c12", route: "c", dep: "13:50", price: "¥10.00", rainbow: true },
  { id: "c13", route: "c", dep: "15:20", price: "¥10.00", rainbow: false },
  { id: "c14", route: "c", dep: "16:10", price: "¥10.00", rainbow: false },
  { id: "c15", route: "c", dep: "17:05", price: "¥10.00", rainbow: true },
  { id: "c16", route: "c", dep: "17:20", price: "¥10.00", rainbow: false },
  { id: "c17", route: "c", dep: "17:40", price: "¥10.00", rainbow: true },
  { id: "c18", route: "c", dep: "18:00", price: "¥10.00", rainbow: false },
  { id: "c19", route: "c", dep: "18:30", price: "¥10.00", rainbow: false },
  { id: "c20", route: "c", dep: "20:00", price: "¥10.00", rainbow: false },
  { id: "c21", route: "c", dep: "21:10", price: "¥10.00", rainbow: false },
  { id: "c22", route: "c", dep: "22:30", price: "¥0.00",  rainbow: false },
  { id: "c23", route: "c", dep: "22:50", price: "¥0.00",  rainbow: false }
];

export const TRIPS_WEEKEND = [
  { id: "wa1",  route: "a", dep: "06:30", price: "¥10.00", rainbow: false },
  { id: "wa2",  route: "a", dep: "07:30", price: "¥10.00", rainbow: false },
  { id: "wa3",  route: "a", dep: "08:00", price: "¥10.00", rainbow: false },
  { id: "wa4",  route: "a", dep: "08:30", price: "¥10.00", rainbow: false },
  { id: "wa5",  route: "a", dep: "09:00", price: "¥10.00", rainbow: false },
  { id: "wa6",  route: "a", dep: "10:10", price: "¥10.00", rainbow: false },
  { id: "wa7",  route: "a", dep: "11:30", price: "¥10.00", rainbow: false },
  { id: "wa8",  route: "a", dep: "12:00", price: "¥10.00", rainbow: false },
  { id: "wa9",  route: "a", dep: "12:40", price: "¥10.00", rainbow: false },
  { id: "wa10", route: "a", dep: "14:30", price: "¥10.00", rainbow: false },
  { id: "wa11", route: "a", dep: "16:10", price: "¥10.00", rainbow: false },
  { id: "wa12", route: "a", dep: "17:00", price: "¥10.00", rainbow: false },
  { id: "wa13", route: "a", dep: "18:30", price: "¥10.00", rainbow: false },
  { id: "wa14", route: "a", dep: "20:30", price: "¥10.00", rainbow: false },
  { id: "wa15", route: "a", dep: "21:10", price: "¥10.00", rainbow: false },

  { id: "wc1",  route: "c", dep: "07:30", price: "¥10.00", rainbow: false },
  { id: "wc2",  route: "c", dep: "08:10", price: "¥10.00", rainbow: false },
  { id: "wc3",  route: "c", dep: "09:00", price: "¥10.00", rainbow: false },
  { id: "wc4",  route: "c", dep: "10:10", price: "¥10.00", rainbow: false },
  { id: "wc5",  route: "c", dep: "12:00", price: "¥10.00", rainbow: false },
  { id: "wc6",  route: "c", dep: "12:40", price: "¥10.00", rainbow: false },
  { id: "wc7",  route: "c", dep: "13:30", price: "¥10.00", rainbow: false },
  { id: "wc8",  route: "c", dep: "15:00", price: "¥10.00", rainbow: false },
  { id: "wc9",  route: "c", dep: "16:10", price: "¥10.00", rainbow: false },
  { id: "wc10", route: "c", dep: "17:00", price: "¥10.00", rainbow: false },
  { id: "wc11", route: "c", dep: "18:00", price: "¥10.00", rainbow: false },
  { id: "wc12", route: "c", dep: "18:30", price: "¥10.00", rainbow: false },
  { id: "wc13", route: "c", dep: "19:00", price: "¥10.00", rainbow: false },
  { id: "wc14", route: "c", dep: "20:00", price: "¥10.00", rainbow: false },
  { id: "wc15", route: "c", dep: "21:10", price: "¥10.00", rainbow: false },

  { id: "wd1", route: "d", dep: "08:00", price: "¥0.00",  rainbow: false },
  { id: "we1", route: "e", dep: "16:30", price: "¥0.00",  rainbow: false }
];

export function isWeekend(date = new Date()) {
  const day = date.getDay();
  return day === 0 || day === 6;
}

export function activeTrips(date = new Date()) {
  return isWeekend(date) ? TRIPS_WEEKEND : TRIPS;
}

export const CHECKPOINTS = {
  a: [
    { name: "京良", note: "收费站", pos: 0.254, segMin: 17, segKm: 7.2 },
    { name: "杜家坎", note: "收费站", pos: 0.414, segMin: 9, segKm: 9.9 },
    { name: "六里桥", pos: 0.623, segMin: 11, segKm: 10 }
  ],
  c: [
    { name: "六里桥", pos: 0.377, segMin: 25, segKm: 9 },
    { name: "杜家坎", note: "收费站", pos: 0.586, segMin: 14, segKm: 10.7 },
    { name: "京良", note: "收费站", pos: 0.746, segMin: 10, segKm: 10.5 }
  ]
};

export const CAMPUS = {
  a: {
    board: [
      { until: 0, name: "东校区上车点" },
      { until: 3, name: "北校区上车点" },
      { until: 6, name: "南校区上车点" }
    ],
    arrive: [
      { until: 3, name: "南门" },
      { until: 6, name: "西门" }
    ],
    final: { segMin: 20, segKm: 8.9 }
  },
  c: {
    board: [
      { until: 0, name: "西门上车点" },
      { until: 6, name: "南门上车点" }
    ],
    arrive: [
      { until: 2, name: "东校区" },
      { until: 4, name: "北校区" },
      { until: 6, name: "南校区" }
    ],
    final: { segMin: 13, segKm: 6.7 }
  }
};

