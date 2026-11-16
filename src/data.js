// Data layer. Same functions in both modes:
//  - FIREBASE mode: reads what the ESP32 writes to Firestore, saves jobs to Firestore.
//  - SIMULATION (DEMO, or ?sim in the URL): an in-browser simulator, for presenting or before the hardware works.
import { initializeApp } from 'firebase/app';
import {
  getFirestore, collection, doc, onSnapshot, query, orderBy, limit,
  addDoc, updateDoc, setDoc, serverTimestamp,
} from 'firebase/firestore';
import { firebaseConfig, DEMO, SIM, NODE } from './config.js';

export const SEED_SITES = [
  { id: 'SITE-001', name: 'Tshepong mine solar plant', type: 'Mine plant', place: 'Near Welkom', capacityKW: 10000, tariff: 2.0, cleanCost: 60000, dustType: 'tailings' },
  { id: 'SITE-002', name: 'Irrigation farm', type: 'Farm', place: 'Near Bultfontein', capacityKW: 300, tariff: 2.5, cleanCost: 3600, dustType: 'farm' },
  { id: 'SITE-003', name: 'Fichardt Park street batch', type: 'Homes (6)', place: 'Bloemfontein', capacityKW: 30, tariff: 3.0, cleanCost: 3600, dustType: 'general' },
  { id: 'SITE-004', name: 'CUT campus plant', type: 'Campus', place: 'Bloemfontein', capacityKW: 153.7, tariff: 2.5, cleanCost: 4500, dustType: 'general' },
];

// Field names written by sedigrid_node_v2.ino. "ref" is Panel A (kept clean), "test" is Panel B (on the array).
// Fields the older node code doesn't send come through as null.
const num = (v) => (typeof v === 'number' ? v : null);
const toReading = (d) => (d && typeof d.test_v === 'number' && typeof d.ref_v === 'number'
  ? {
    test: d.test_v, ref: d.ref_v,
    testMa: num(d.test_ma), refMa: num(d.ref_ma), testMw: num(d.test_mw), refMw: num(d.ref_mw),
    testTempC: num(d.test_temp_c) ?? num(d.temp_c), refTempC: num(d.ref_temp_c),
    rainWet: !!d.rain_wet, rainMv: num(d.rain_mv),
    soilingPct: num(d.soiling_pct), cleanRatio: num(d.clean_ratio),
    at: d.updated_at?.toDate?.() ?? d.at?.toDate?.() ?? null,
  }
  : null);

/* ---------------------------- FIREBASE ---------------------------- */
let db = null;
if (!SIM) db = getFirestore(initializeApp(firebaseConfig));

const fb = {
  subscribeSites(cb, onError) {
    return onSnapshot(collection(db, 'sites'), (snap) => {
      cb(snap.docs.map((d) => {
        const v = d.data();
        // Online is worked out in the app from lastSeen, so it updates even when no new data arrives.
        return { ...v, id: d.id, reading: toReading(v), lastSeen: v.updated_at?.toDate?.() ?? null };
      }));
    }, onError);
  },
  subscribeHistory(siteId, cb) {
    const q = query(collection(db, 'sites', siteId, 'readings'), orderBy('at', 'desc'), limit(40));
    return onSnapshot(q, (snap) => cb(snap.docs.map((d) => toReading(d.data())).filter(Boolean).reverse()));
  },
  subscribeJobs(cb) {
    return onSnapshot(query(collection(db, 'jobs'), orderBy('createdAt', 'desc'), limit(50)), (snap) =>
      cb(snap.docs.map((d) => ({ id: d.id, ...d.data(), createdAt: d.data().createdAt?.toDate?.() ?? new Date() }))));
  },
  createJob: (job) => addDoc(collection(db, 'jobs'), { ...job, createdAt: serverTimestamp(), updatedAt: serverTimestamp() }),
  updateJob: (id, patch) => updateDoc(doc(db, 'jobs', id), { ...patch, updatedAt: serverTimestamp() }),
  muteAlarm: (siteId) => updateDoc(doc(db, 'sites', siteId), { alarm_muted: true }),
  seedSites: () => Promise.all(SEED_SITES.map(({ id, ...meta }) => setDoc(doc(db, 'sites', id), meta, { merge: true }))),
};

/* --------------------------- SIMULATION --------------------------- */
const SCENARIOS = {
  clean: { soil: 0, cloud: 0, rain: false },
  cloud: { cloud: 0.6 },
  dust: { soilJump: 0.12, soilRate: 0.002 },   // straight past the 8% alarm, then keeps building
  night: { cloud: 0.85 },                      // Panel A drops under 1 V: too dark to judge
  drizzle: { rain: true, soilBump: 0.02 },
  storm: { rain: true, soil: 0 },
  fault: { fault: true },
};
const sim = {};
const histories = {};
const listeners = { sites: new Set(), jobs: new Set(), hist: {} };
let jobs = [];
let timer = null;

function initSim() {
  if (timer) return;
  const start = { 'SITE-001': 0.07, 'SITE-002': 0.05, 'SITE-003': 0.04, 'SITE-004': 0.01 };
  SEED_SITES.forEach((s) => {
    sim[s.id] = { soil: start[s.id], soilRate: s.id === 'SITE-001' ? 0.0004 : 0.0002, cloud: 0, rain: false, fault: false, muted: false };
    histories[s.id] = [];
    for (let i = 40; i > 0; i--) histories[s.id].push(sample(s.id, Date.now() - i * 2000, (i / 40) * 0.04));
  });
  timer = setInterval(tick, 2000);
}
function sample(id, at, extraSoilBack = 0) {
  const st = sim[id];
  const light = 1 - st.cloud;
  const ref = +(5.0 * light + (Math.random() - 0.5) * 0.03).toFixed(3);
  const soil = Math.max(0, st.soil - extraSoilBack);
  const test = st.fault ? 0.05 : +(ref * (1 - soil) + (Math.random() - 0.5) * 0.02).toFixed(3);
  // Same maths as the node: current and power through the load bank, soiling from the panel ratio.
  const panelTemp = 31 + light * 6 + Math.random() * 0.4;
  return {
    test, ref,
    testMa: (test / NODE.loadOhms) * 1000, refMa: (ref / NODE.loadOhms) * 1000,
    testMw: (test * test / NODE.loadOhms) * 1000, refMw: (ref * ref / NODE.loadOhms) * 1000,
    testTempC: panelTemp + soil * 4, refTempC: panelTemp,
    rainWet: st.rain, rainMv: st.rain ? 1150 + Math.random() * 100 : 2450 + Math.random() * 100,
    soilingPct: ref >= NODE.minReferenceVolts ? (1 - test / ref) * 100 : null, cleanRatio: 1,
    at: new Date(at),
  };
}
function tick() {
  Object.keys(sim).forEach((id) => {
    const st = sim[id];
    if (!st.rain && !st.fault) st.soil = Math.min(0.4, st.soil + st.soilRate);
    const r = sample(id, Date.now());
    histories[id].push(r);
    if (histories[id].length > 40) histories[id].shift();
    (listeners.hist[id] || new Set()).forEach((cb) => cb([...histories[id]]));
  });
  emitSites();
}
function emitSites() {
  const list = SEED_SITES.map((s) => {
    const h = histories[s.id];
    const reading = h[h.length - 1];
    return { ...s, reading, lastSeen: new Date(), alarm_active: reading.soilingPct >= NODE.alarmPercent, alarm_muted: sim[s.id].muted };
  });
  listeners.sites.forEach((cb) => cb(list));
}
const emitJobs = () => listeners.jobs.forEach((cb) => cb([...jobs]));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const demo = {
  subscribeSites(cb) { initSim(); listeners.sites.add(cb); emitSites(); return () => listeners.sites.delete(cb); },
  subscribeHistory(id, cb) {
    initSim();
    (listeners.hist[id] ||= new Set()).add(cb);
    cb([...histories[id]]);
    return () => listeners.hist[id].delete(cb);
  },
  subscribeJobs(cb) { listeners.jobs.add(cb); cb([...jobs]); return () => listeners.jobs.delete(cb); },
  async createJob(job) { await wait(600); jobs = [{ ...job, id: 'J' + Date.now(), createdAt: new Date() }, ...jobs]; emitJobs(); },
  async updateJob(id, patch) {
    await wait(600);
    const j = jobs.find((x) => x.id === id);
    if (patch.status === 'done' && j) sim[j.siteId].soil = 0.005; // the crew cleaned the panels
    jobs = jobs.map((x) => (x.id === id ? { ...x, ...patch } : x));
    emitJobs();
    emitSites();
  },
  async muteAlarm(id) { await wait(400); sim[id].muted = true; emitSites(); },
  async seedSites() { await wait(400); },
  setScenario(id, key) {
    const st = sim[id];
    const sc = SCENARIOS[key];
    st.cloud = 0; st.rain = false; st.fault = false;
    if (key === 'clean') { st.soil = 0; st.soilRate = 0.0002; }
    if (sc.cloud) st.cloud = sc.cloud;
    if (sc.soilRate) st.soilRate = sc.soilRate;
    if (sc.rain) st.rain = true;
    if (sc.soilJump) st.soil = Math.max(st.soil, sc.soilJump);
    if (sc.soilBump) st.soil = Math.min(0.4, st.soil + sc.soilBump);
    if (key === 'storm') st.soil = 0.005;
    if (sc.fault) st.fault = true;
    tick();
  },
};

export const api = SIM ? demo : fb;
export { DEMO, SIM };
