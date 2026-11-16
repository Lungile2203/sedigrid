// Alerts and loss evidence. An incident runs from the moment a node raises its alarm until the
// alarm clears. While it runs, the loss is added up second by second: measured on the sensor
// (Panel A power minus Panel B power) and scaled to the site's capacity and tariff.
import { useEffect, useRef, useState } from 'react';
import { diagnose, isDark, ratioOf, fmt } from './diagnose.js';
import { NODE, SIM } from './config.js';

const KEY = SIM ? 'sedigrid.incidents.sim' : 'sedigrid.incidents';
const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch { return []; } };
const save = (list) => { try { localStorage.setItem(KEY, JSON.stringify(list.slice(0, 20))); } catch { /* storage blocked: keep in memory only */ } };

// Rand with cents, written like the rest of the app: space between thousands, dot before cents.
export const rand2 = (n) => { const [whole, cents] = n.toFixed(2).split('.'); return `R${fmt(+whole)}.${cents}`; };
export const clock = (ms) => new Date(ms).toLocaleTimeString('en-ZA', { hour12: false });
export const duration = (ms) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 60 ? `${s} s` : s < 3600 ? `${Math.floor(s / 60)} min ${s % 60} s` : `${Math.floor(s / 3600)} h ${Math.floor((s % 3600) / 60)} min`;
};

// Power through each 50 Ohm load bank. Older node code only sends volts, so fall back to V^2 / R.
const mw = (v, sent) => sent ?? (v * v / NODE.loadOhms) * 1000;
export const panelPower = (r) => ({ a: mw(r.ref, r.refMw), b: mw(r.test, r.testMw) });
const soiling = (r) => (r && !isDark(r) ? (1 - ratioOf(r)) * 100 : null);

const JOB_TEXT = {
  dispatched: (j) => `${j.crew} dispatched: ${j.method.toLowerCase()}, R${fmt(j.cost || 0)}.`,
  in_progress: (j) => `${j.crew} on site.`,
  done: () => 'Crew marked the panels cleaned. Waiting for the sensor to confirm.',
  verified: (j) => `Clean verified by the sensor: Panel B went from ${Math.round(j.ratioBefore * 100)}% to ${Math.round(j.ratioAfter * 100)}% of Panel A.`,
  not_resolved: () => 'Sensor did not confirm the clean. Output has not recovered.',
};

export function useIncidents(sites, jobs, now, onAlert) {
  const [list, setList] = useState(load);
  const listRef = useRef(list);
  const prev = useRef({ t: now, online: {}, muted: {}, jobs: null });

  useEffect(() => {
    if (!sites) return;
    const p = prev.current;
    const dt = Math.min(30, Math.max(0, (now - p.t) / 1000)); // cap gaps such as a sleeping laptop
    p.t = now;
    let next = listRef.current.map((i) => ({ ...i }));
    let changed = false;
    const log = (inc, text) => { inc.events = [...inc.events, { at: now, text }]; changed = true; };

    sites.forEach((s) => {
      const r = s.reading;
      const pct = soiling(r);
      let inc = next.find((i) => i.siteId === s.id && !i.end);

      if (s.online && s.alarm_active && !inc) {
        const d = diagnose(s, r);
        const { a, b } = r ? panelPower(r) : { a: 0, b: 0 };
        inc = { id: `${s.id}-${now}`, siteId: s.id, siteName: s.name || s.id, capacityKW: s.capacityKW, start: now, end: null, peakPct: pct, lastPct: pct, rand: 0, kwh: 0, mwh: 0, rateDay: d.lossRandDay || 0, events: [] };
        next = [inc, ...next];
        log(inc, `Alert from the sensor node: ${d.title}. Soiling ${pct != null ? pct.toFixed(1) : '?'}%, Panel A ${r?.ref.toFixed(2)} V / ${a.toFixed(0)} mW, Panel B ${r?.test.toFixed(2)} V / ${b.toFixed(0)} mW. Buzzer on.`);
        onAlert?.(s, inc);
      }

      if (inc) {
        if (p.online[s.id] !== undefined && s.online !== p.online[s.id]) {
          log(inc, s.online ? 'Sensor node back online.' : 'Sensor node went offline. Loss is not counted until it reports again.');
        }
        if (s.alarm_muted && !p.muted[s.id]) log(inc, 'Buzzer silenced from the dashboard.');
        if (s.online && r && pct != null && dt > 0) {
          const d = diagnose(s, r);
          const { a, b } = panelPower(r);
          inc.rand += ((d.lossRandDay || 0) * dt) / 86400;
          inc.kwh += ((d.lossKwhDay || 0) * dt) / 86400;
          inc.mwh += (Math.max(0, a - b) * dt) / 3600;
          inc.rateDay = d.lossRandDay || 0;
          // Running total every 2 s, for the "longer you wait" curve.
          const last = inc.series?.[inc.series.length - 1];
          if (!last || now - last.t >= 2000) inc.series = [...(inc.series || [{ t: inc.start, rand: 0 }]), { t: now, rand: inc.rand }].slice(-900);
          inc.peakPct = Math.max(inc.peakPct ?? 0, pct);
          inc.lastPct = pct;
          changed = true;
        }
        if (s.online && !s.alarm_active) {
          inc.end = now;
          log(inc, `Alert cleared: Panel B back to ${pct != null ? (100 - pct).toFixed(0) : '?'}% of Panel A. Lost during the alert: ${rand2(inc.rand)} (${inc.kwh.toFixed(2)} kWh at site scale, ${inc.mwh.toFixed(2)} mWh measured on the test panel).`);
        }
      }
      p.online[s.id] = s.online;
      p.muted[s.id] = !!s.alarm_muted;
    });

    // Crew steps go into the site's latest incident, so the log covers the whole job.
    if (jobs) {
      const seen = p.jobs;
      p.jobs = Object.fromEntries(jobs.map((j) => [j.id, j.status]));
      if (seen) {
        jobs.forEach((j) => {
          if (seen[j.id] === j.status || !JOB_TEXT[j.status]) return;
          const inc = next.find((i) => i.siteId === j.siteId);
          if (inc) log(inc, JOB_TEXT[j.status](j));
        });
      }
    }

    if (changed) {
      listRef.current = next;
      setList(next);
      save(next);
    }
  }, [sites, jobs, now]);

  const clear = () => { listRef.current = []; setList([]); save([]); };
  return { incidents: list, active: list.filter((i) => !i.end), clear };
}

// Three short beeps. Browsers only allow sound after the viewer has clicked something on the page.
export function beep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    [0, 0.25, 0.5].forEach((t) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = 880;
      g.gain.setValueAtTime(0.0001, ctx.currentTime + t);
      g.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + t + 0.18);
      o.connect(g).connect(ctx.destination);
      o.start(ctx.currentTime + t);
      o.stop(ctx.currentTime + t + 0.2);
    });
  } catch { /* no audio available */ }
}

export function notify(title, body) {
  try { if ('Notification' in window && Notification.permission === 'granted') new Notification(title, { body, icon: '/img/logo-mark.svg' }); } catch { /* ignore */ }
}

export function evidenceCsv(inc, history) {
  const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = [
    ['SediGrid loss evidence'],
    ['Site', inc.siteName], ['Alert started', new Date(inc.start).toISOString()], ['Alert ended', inc.end ? new Date(inc.end).toISOString() : 'still active'],
    ['Peak soiling %', inc.peakPct?.toFixed(1)], ['Measured loss on test panel (mWh)', inc.mwh.toFixed(3)],
    ['Loss at site scale (kWh)', inc.kwh.toFixed(3)], ['Loss at site scale (R)', inc.rand.toFixed(2)],
    [],
    ['Time', 'Event'],
    ...inc.events.map((e) => [new Date(e.at).toISOString(), e.text]),
    [],
    ['Time', 'Panel A V', 'Panel B V', 'Panel A mW', 'Panel B mW', 'Soiling %', 'Rain'],
    ...(history || []).map((r) => {
      const { a, b } = panelPower(r);
      return [r.at ? new Date(r.at).toISOString() : '', r.ref.toFixed(3), r.test.toFixed(3), a.toFixed(1), b.toFixed(1), soiling(r)?.toFixed(1) ?? 'dark', r.rainWet ? 'wet' : 'dry'];
    }),
  ];
  const blob = new Blob([rows.map((r) => r.map(q).join(',')).join('\n')], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `sedigrid-evidence-${inc.siteId}-${new Date(inc.start).toISOString().slice(0, 16).replace(':', '')}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
