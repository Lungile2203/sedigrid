import React, { useEffect, useMemo, useRef, useState } from 'react';
import { api, DEMO, SIM, SEED_SITES } from './data.js';
import { diagnose, verifyJob, METHODS, fmt, ratioOf, isDark } from './diagnose.js';
import { OFFLINE_AFTER_SECONDS, NODE } from './config.js';
import Live, { SCENES } from './Live.jsx';
import { useIncidents, beep, notify, evidenceCsv, panelPower, rand2, clock, duration } from './incidents.js';
import logoMark from '../site/img/logo-mark.svg';

const CREWS = ['Welkom crew', 'Bloemfontein crew', 'Bultfontein crew'];
// Row stripe per status, matching the pill colours.
const STRIPE = { 't-ok': 's-ok', 't-dust': 's-dust', 't-warn': 's-warn', 't-bad': 's-bad', 't-off': 's-off' };
const TONE = { clean: 't-ok', 'rain-clean': 't-ok', dust: 't-dust', 'rain-worse': 't-dust', shade: 't-warn', fault: 't-bad', dark: 't-off', offline: 't-off' };
const JOB_TONE = { dispatched: 't-warn', in_progress: 't-warn', done: 't-dust', verified: 't-ok', not_resolved: 't-bad' };
const JOB_LABEL = { dispatched: 'Dispatched', in_progress: 'In progress', done: 'Cleaned, checking', verified: 'Verified', not_resolved: 'Not resolved' };

const size = (kw) => (kw >= 1000 ? `${kw / 1000} MW` : `${kw} kW`);
const pct = (r) => `${Math.round(r * 100)}%`;
const ago = (date, now) => {
  if (!date) return 'never';
  const s = Math.max(0, Math.round((now - date.getTime()) / 1000));
  if (s < 60) return `${s} s ago`;
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return date.toLocaleDateString('en-ZA');
};

// Button that shows a spinner and disables itself while its async action runs.
function AsyncButton({ onClick, children, busyText, className = 'btn', ...rest }) {
  const [busy, setBusy] = useState(false);
  const run = async () => {
    if (busy) return;
    setBusy(true);
    try { await onClick(); } finally { setBusy(false); }
  };
  return (
    <button className={className} onClick={run} disabled={busy} aria-busy={busy} {...rest}>
      {busy && <span className="spin" aria-hidden="true" />}
      {busy ? busyText : children}
    </button>
  );
}

function Toast({ msg }) {
  return msg ? <div className="toast" role="status">{msg}</div> : null;
}

// The dot on the second i is the sensor node's status LED, as in the logo.
function Logo() {
  return (
    <span className="brand" aria-label="SediGrid">
      <img src={logoMark} alt="" width="47" height="32" />
      <span className="wordmark" aria-hidden="true">SediGr<span className="led">ı</span>d</span>
    </span>
  );
}

function PageHead({ title, children }) {
  return (
    <div className="page-head">
      <h1>{title}</h1>
      {children}
    </div>
  );
}

// Placeholder rows shaped like the list they stand in for.
function SkeletonRows({ cols, label }) {
  return (
    <div className="list" aria-label={label} aria-busy="true">
      {[0, 1, 2, 3].map((i) => (
        <div className={`list-row ${cols}`} key={i}>
          <div className="tight c-name" style={{ gap: 'var(--s1)' }}>
            <div className="skel" style={{ height: 20, width: '70%' }} />
            <div className="skel" style={{ height: 14, width: '45%' }} />
          </div>
          <div className="skel" style={{ height: 14, gridArea: cols === 'sites-cols' ? 'out' : 'ratio' }} />
          <div className="skel" style={{ height: 14, width: '60%', gridArea: cols === 'sites-cols' ? 'loss' : 'act' }} />
          <div className="skel c-status" style={{ height: 28, width: 96 }} />
        </div>
      ))}
    </div>
  );
}

/* ------------------------------ SITES ------------------------------ */
function Sites({ sites, open, now }) {
  const totals = useMemo(() => {
    if (!sites) return null;
    let lossDay = 0, needClean = 0, offline = 0;
    sites.forEach((s) => {
      if (s.reading && !s.online) offline += 1;
      const d = diagnose(s, s.reading);
      if (d.lossRandDay && (d.state === 'dust' || d.state === 'rain-worse')) lossDay += d.lossRandDay;
      if (d.clean) needClean += 1;
    });
    return { lossDay, needClean, offline };
  }, [sites]);

  return (
    <div className="page">
      <PageHead title="Sites">
        {totals && !sites.some((s) => s.reading && s.online) ? (
          <p className="muted">No sensor node is reporting right now, so there is no live figure.{totals.offline > 0 && ` ${totals.offline} node${totals.offline > 1 ? 's' : ''} offline.`}</p>
        ) : totals ? (
          <p className="muted">
            Dust costs <strong className="mono">R{fmt(totals.lossDay)}</strong> a day across {sites.length} site{sites.length === 1 ? '' : 's'}.{' '}
            {totals.needClean === 0 ? 'None needs a clean yet.' : `${totals.needClean} would pay back a clean within 30 days.`}
            {totals.offline > 0 && ` ${totals.offline} sensor node${totals.offline > 1 ? 's are' : ' is'} offline.`}
          </p>
        ) : <div className="skel" style={{ height: 20, width: 320, maxWidth: '100%', marginTop: 4 }} />}
      </PageHead>
      {!sites ? <SkeletonRows cols="sites-cols" label="Loading sites" /> : sites.length === 0 ? (
        <div className="panel"><h2>No sites yet</h2><p className="muted">Open Setup and add the pilot sites, or switch on your ESP32 node.</p></div>
      ) : (
        <div className="list">
          <div className="list-row list-head sites-cols label" aria-hidden="true">
            <span className="c-name">Site</span><span className="c-out">Output vs reference</span><span className="c-loss">Loss a day</span><span className="c-status">Status</span>
          </div>
          {sites.map((s) => {
            const d = diagnose(s, s.reading);
            return (
              <button key={s.id} className={`list-row sites-cols ${STRIPE[TONE[d.state]]}`} onClick={() => open(s.id)}>
                <span className="tight c-name">
                  <strong>{s.name || s.id}</strong>
                  <span className="small muted">{[s.type, s.capacityKW && size(s.capacityKW), s.place].filter(Boolean).join(' · ')}</span>
                  {s.reading && !s.online && <span className="small muted">Last reading {ago(s.lastSeen, now)}</span>}
                </span>
                <span className="meter-row c-out">
                  <span className={`meter ${s.alarm_active && s.online ? 'alarm' : d.pct != null && d.pct < 97 ? 'low' : ''}`} aria-hidden="true"><i style={{ width: `${d.pct ?? 0}%` }} /></span>
                  <span className="num small">{d.pct != null ? `${d.pct}%` : '–'}</span>
                </span>
                <span className="num small c-loss">{d.lossRandDay > 1 ? `R${fmt(d.lossRandDay)}` : <span className="muted">{s.online ? 'none' : 'offline'}</span>}</span>
                <span className="c-status"><span className={`pill ${TONE[d.state]}`}>{d.title}</span></span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* --------------------------- SITE DETAIL --------------------------- */
// Panel B as a share of Panel A. Hover or tap the chart to read any point; the shaded band is where the buzzer sounds.
function RatioChart({ history }) {
  const [hover, setHover] = useState(null);
  const data = history.filter((h) => !isDark(h));
  if (data.length < 2) return <div className="skel" style={{ height: 160 }} />;
  const pts = data.map((h) => Math.min(1.02, ratioOf(h)));
  const W = 600, H = 160, L = 40, R = 8, B = 20, T = 8, min = Math.min(0.8, ...pts), max = 1.02;
  const x = (i) => L + (i / (pts.length - 1)) * (W - L - R);
  const y = (v) => T + ((max - v) / (max - min)) * (H - B - T);
  const ticks = [1, 0.95, 0.9, 0.85, 0.8].filter((t) => t >= min);
  const alarm = 1 - NODE.alarmPercent / 100;
  const line = pts.map((v, i) => `${x(i)},${y(v)}`).join(' ');
  const i = hover ?? pts.length - 1;
  const h = data[i];
  const { a, b } = panelPower(h);
  const pick = (e) => {
    const box = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - box.left) / box.width) * W;
    setHover(Math.max(0, Math.min(pts.length - 1, Math.round(((px - L) / (W - L - R)) * (pts.length - 1)))));
  };
  return (
    <div className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={`Panel B as a share of Panel A over the last ${pts.length} readings, now ${pct(pts[pts.length - 1])}. The buzzer sounds below ${pct(alarm)}.`}
        onPointerMove={pick} onPointerDown={pick} onPointerLeave={() => setHover(null)}>
        <rect className="chart-danger" x={L} y={y(alarm)} width={W - L - R} height={Math.max(0, H - B - y(alarm))} />
        {ticks.map((t) => (
          <g key={t}>
            <line className="chart-grid" x1={L} x2={W - R} y1={y(t)} y2={y(t)} />
            <text className="chart-text" x={L - 6} y={y(t) + 4} textAnchor="end">{pct(t)}</text>
          </g>
        ))}
        <line className="chart-alarm" x1={L} x2={W - R} y1={y(alarm)} y2={y(alarm)} />
        <text className="chart-text" x={L + 6} y={y(alarm) + 14}>buzzer at {NODE.alarmPercent}% soiling</text>
        <polygon className="chart-area" points={`${x(0)},${H - B} ${line} ${x(pts.length - 1)},${H - B}`} />
        <polyline className="chart-line" points={line} />
        <line className="chart-cursor" x1={x(i)} x2={x(i)} y1={T} y2={H - B} />
        <circle className={pts[i] < alarm ? 'chart-dot bad' : 'chart-dot'} cx={x(i)} cy={y(pts[i])} r="5" />
        <text className="chart-text" x={L} y={H - 4}>older</text>
        <text className="chart-text" x={W - R} y={H - 4} textAnchor="end">now</text>
      </svg>
      <div className="chart-read small" aria-live="polite">
        <span className="mono">{h.at ? clock(h.at) : hover == null ? 'now' : ''}</span>
        <span><i className="key a" />A <span className="mono">{h.ref.toFixed(2)} V · {a.toFixed(0)} mW</span></span>
        <span><i className="key b" />B <span className="mono">{h.test.toFixed(2)} V · {b.toFixed(0)} mW</span></span>
        <span>Soiling <strong className="mono">{((1 - ratioOf(h)) * 100).toFixed(1)}%</strong></span>
      </div>
    </div>
  );
}

// Shown on every page while any node is in alarm.
function AlertBar({ active, now, open, openId, sound, setSound }) {
  if (!active.length) return null;
  return (
    <div className="alertbar" role="alert">
      {active.map((inc) => (
        <div className="alertbar-in" key={inc.id}>
          <span className="pulse" aria-hidden="true" />
          <span className="alertbar-text">
            <strong>Alert: {inc.siteName}</strong>
            <span>soiling {inc.lastPct != null ? `${inc.lastPct.toFixed(1)}%` : '–'} for {duration(now - inc.start)}, lost so far <strong className="mono">{rand2(inc.rand)}</strong></span>
          </span>
          <span className="row" style={{ gap: 'var(--s2)' }}>
            <button className="btn ghost compact on-dark" onClick={() => setSound(!sound)} aria-pressed={sound}>{sound ? 'Sound on' : 'Sound off'}</button>
            {openId !== inc.siteId && <button className="btn compact" onClick={() => open(inc.siteId)}>View site</button>}
          </span>
        </div>
      ))}
    </div>
  );
}

// What the alert has cost so far: measured on the sensor, and scaled to the site.
function LossEvidence({ inc, site, history, now }) {
  const r = site.reading;
  const live = !inc.end;
  const { a, b } = r ? panelPower(r) : { a: 0, b: 0 };
  const gap = Math.max(0, a - b);
  return (
    <div className={`panel evidence ${live ? 'live' : ''}`}>
      <div className="row between">
        <div className="tight">
          <h2>Loss evidence</h2>
          <span className="small muted">Alert started {clock(inc.start)}{inc.end ? `, cleared ${clock(inc.end)}` : ''} · {duration((inc.end || now) - inc.start)}</span>
        </div>
        <span className={`pill ${live ? 't-bad' : 't-ok'}`}>{live ? 'Alert active, counting' : 'Resolved'}</span>
      </div>
      <div className="figures">
        <div className="fig-box loss">
          <span className="label">Lost at {size(site.capacityKW)} scale</span>
          <span className="figure">{rand2(inc.rand)}</span>
          <span className="small muted">{inc.kwh.toFixed(2)} kWh · {live ? `R${fmt(inc.rateDay / 24)} an hour` : 'loss stopped'}</span>
        </div>
        <div className="fig-box b">
          <span className="label">Measured on the test panel</span>
          <span className="figure">{inc.mwh.toFixed(2)} mWh</span>
          <span className="small muted">{live && r ? `Panel B ${gap.toFixed(0)} mW below Panel A right now` : 'energy Panel B did not produce'}</span>
        </div>
        <div className="fig-box a">
          <span className="label">Peak soiling</span>
          <span className="figure">{inc.peakPct != null ? `${inc.peakPct.toFixed(1)}%` : '–'}</span>
          <span className="small muted">buzzer threshold {NODE.alarmPercent}%</span>
        </div>
      </div>
      <ol className="log">
        {inc.events.map((e, k) => <li key={k}><span className="mono">{clock(e.at)}</span><span>{e.text}</span></li>)}
      </ol>
      <div className="row">
        <button className="btn ghost compact" onClick={() => evidenceCsv(inc, history)}>Download evidence (CSV)</button>
        <span className="small muted">Measured figures come from the two panels. Rand and kWh scale the measured soiling to this site's {size(site.capacityKW)} at R{site.tariff}/kWh.</span>
      </div>
    </div>
  );
}

const show = (v, f, empty = '–') => (v != null ? f(v) : empty);

// The two panels side by side, as the node measures them through the 50 Ohm load banks.
function PanelTable({ r }) {
  const cells = (a, b, f) => [a, b].map((v, i) => <td key={i} className="num">{r ? show(v, f) : '–'}</td>);
  return (
    <div className="tw">
      <table>
        <thead><tr><th /><th className="num"><i className="key a" />Panel A, reference (GPIO34)</th><th className="num"><i className="key b" />Panel B, test (GPIO35)</th></tr></thead>
        <tbody>
          <tr><td>Voltage</td>{cells(r?.ref, r?.test, (v) => `${v.toFixed(2)} V`)}</tr>
          <tr><td>Current through {NODE.loadOhms} Ω</td>{cells(r?.refMa, r?.testMa, (v) => `${v.toFixed(0)} mA`)}</tr>
          <tr><td>Power</td>{cells(r?.refMw, r?.testMw, (v) => `${v.toFixed(0)} mW`)}</tr>
          <tr><td>Panel temperature</td>{cells(r?.refTempC, r?.testTempC, (v) => `${v.toFixed(1)} °C`)}</tr>
        </tbody>
      </table>
    </div>
  );
}

// Presenting without the hardware: conditions to pick by hand, or a timed walkthrough of all of them.
const SCENE_SECONDS = 8;

function Simulator({ siteId }) {
  const [scene, setScene] = useState(null);
  const [step, setStep] = useState(null); // walkthrough position, null when not playing
  const pick = (key) => { setScene(key); api.setScenario(siteId, key); };

  useEffect(() => {
    if (step == null) return undefined;
    if (step >= SCENES.length) { setStep(null); return undefined; }
    pick(SCENES[step].key);
    const t = setTimeout(() => setStep(step + 1), SCENE_SECONDS * 1000);
    return () => clearTimeout(t);
  }, [step]);

  const current = SCENES.find((s) => s.key === scene);
  return (
    <div className="panel">
      <div className="row between">
        <div className="tight">
          <h2>Simulation</h2>
          <span className="small muted">Sets what the sensor node would report. Live data is not touched.</span>
        </div>
        {step == null
          ? <button className="btn compact" onClick={() => setStep(0)}>Play walkthrough</button>
          : <button className="btn ghost compact" onClick={() => setStep(null)}>Stop walkthrough</button>}
      </div>
      <div className="row" role="group" aria-label="Simulate a condition">
        {SCENES.map((s) => (
          <button key={s.key} className="chip" aria-pressed={scene === s.key} disabled={step != null} onClick={() => pick(s.key)}>{s.label}</button>
        ))}
      </div>
      {current && (
        <div className="verdict t-off" aria-live="polite">
          <strong>{step != null ? `Step ${step + 1} of ${SCENES.length}: ` : ''}{current.label}</strong>
          <span className="small">{current.say}</span>
        </div>
      )}
    </div>
  );
}

function SiteDetail({ site, back, toast, goJobs, now, incident }) {
  const [history, setHistory] = useState(null);
  const [crew, setCrew] = useState(CREWS[0]);
  useEffect(() => api.subscribeHistory(site.id, setHistory), [site.id]);
  const d = diagnose(site, site.reading, history || []);
  const r = site.reading;
  const m = METHODS[site.dustType] || METHODS.general;
  const canPlan = d.state === 'dust' || d.state === 'rain-worse';

  const dispatch = async () => {
    await api.createJob({ siteId: site.id, siteName: site.name || site.id, status: 'dispatched', method: m.method, dustType: site.dustType || 'general', crew, ratioBefore: d.ratio, cost: site.cleanCost || 0 });
    toast(`${crew} dispatched to ${site.name || site.id}`);
    goJobs();
  };

  return (
    <div className="page">
      <button className="back" onClick={back}>← All sites</button>
      <PageHead title={site.name || site.id}>
        <p className="muted">{[site.type, site.capacityKW && size(site.capacityKW), site.place || site.id].filter(Boolean).join(' · ')}</p>
      </PageHead>

      {site.online && site.alarm_active && !site.alarm_muted && (
        <div className="panel flag row between">
          <span><strong>Buzzer sounding on site.</strong> <span className="muted">Soiling has been at or above {NODE.alarmPercent}% for {NODE.alarmConfirmReadings} readings in a row.</span></span>
          <AsyncButton className="btn ghost compact" busyText="Silencing…" onClick={async () => { await api.muteAlarm(site.id); toast('Buzzer silenced'); }}>Silence buzzer</AsyncButton>
        </div>
      )}

      {incident && <LossEvidence inc={incident} site={site} history={history} now={now} />}

      <div className="grid">
        <div className="panel">
          <span className="label">Right now</span>
          <div className={`verdict ${TONE[d.state]}`}>
            <strong>{d.title}</strong>
            <span className="small">{d.text}</span>
          </div>
          {canPlan && d.lossRandDay > 1 && <p><span className="figure">R{fmt(d.lossRandDay)}</span> <span className="muted">a day lost, about {fmt(d.lossKwhDay)} kWh</span></p>}
        </div>
        <div className="panel">
          <span className="label">Panel B output as a share of clean Panel A</span>
          {history ? <RatioChart history={history} /> : <div className="skel" style={{ height: 140 }} />}
        </div>
      </div>

      <div className="panel">
        <div className="row between">
          <h2>Latest reading</h2>
          <span className={`pill ${site.online ? 't-ok' : 't-off'}`}>{site.online ? 'Node online' : 'Node offline'}</span>
        </div>
        <PanelTable r={site.reading} />
        <div className="tw">
          <table>
            <tbody>
              <tr><td>Soiling (node, calibrated)</td><td className="num">{show(r?.soilingPct, (v) => `${v.toFixed(1)}%`, r && isDark(r) ? 'too dark' : '–')}</td></tr>
              <tr><td>Rain sensor (GPIO36)</td><td className="num">{r ? `${r.rainMv != null ? `${fmt(r.rainMv)} mV, ` : ''}${r.rainWet ? 'wet' : 'dry'}` : '–'}</td></tr>
              <tr><td>Clean B/A ratio set on the node</td><td className="num">{show(r?.cleanRatio, (v) => v.toFixed(3))}</td></tr>
              <tr><td>Received</td><td className="num">{ago(site.lastSeen, now)}</td></tr>
            </tbody>
          </table>
        </div>
      </div>

      {canPlan && (
        <div className="panel">
          <div className="tight">
            <h2>Cleaning plan: {m.method.toLowerCase()}</h2>
            <span className="small muted">For {m.label.toLowerCase()}. {m.why}</span>
          </div>
          <ol className="steps">{m.steps.map((s) => <li key={s}>{s}</li>)}</ol>
          <div className="row small">
            <span>Cost <strong className="mono">R{fmt(site.cleanCost || 0)}</strong></span>
            <span>Expected gain <strong className="mono">R{fmt(d.lossRandDay)} a day</strong></span>
          </div>
          <div className="row">
            <label htmlFor="crew" className="small">Crew</label>
            <select id="crew" value={crew} onChange={(e) => setCrew(e.target.value)}>{CREWS.map((c) => <option key={c}>{c}</option>)}</select>
            <AsyncButton busyText="Dispatching…" onClick={dispatch}>Dispatch crew</AsyncButton>
          </div>
        </div>
      )}

      {SIM && <Simulator siteId={site.id} />}
    </div>
  );
}

/* ------------------------------- JOBS ------------------------------- */
function Jobs({ jobs, sites, toast }) {
  const siteById = Object.fromEntries((sites || []).map((s) => [s.id, s]));
  const latest = useRef(siteById);
  latest.current = siteById; // read the newest reading after the wait, not the one from click time
  return (
    <div className="page">
      <PageHead title="Cleaning jobs">
        <p className="muted">A job only counts as done when the sensor shows output recovered.</p>
      </PageHead>
      {!jobs ? <SkeletonRows cols="jobs-cols" label="Loading jobs" /> : jobs.length === 0 ? (
        <div className="panel"><h2>No jobs yet</h2><p className="muted">Open a site that needs a clean and dispatch a crew.</p></div>
      ) : (
        <div className="list">
          <div className="list-row list-head jobs-cols label" aria-hidden="true">
            <span className="c-name">Site</span><span className="c-ratio">Before → after</span><span className="c-status">Status</span><span className="c-act">Next step</span>
          </div>
          {jobs.map((j) => (
            <div className="list-row jobs-cols" key={j.id}>
              <span className="tight c-name">
                <strong>{j.siteName}</strong>
                <span className="small muted">{j.crew} · {j.method} · R{fmt(j.cost || 0)}</span>
              </span>
              <span className="num small c-ratio">{pct(j.ratioBefore || 0)} → {j.ratioAfter != null ? pct(j.ratioAfter) : <span className="muted">?</span>}</span>
              <span className="c-status"><span className={`pill ${JOB_TONE[j.status]}`}>{JOB_LABEL[j.status]}</span></span>
              <span className="c-act">
                {j.status === 'dispatched' && <AsyncButton className="btn ghost compact" busyText="Updating…" onClick={() => api.updateJob(j.id, { status: 'in_progress' })}>Crew on site</AsyncButton>}
                {j.status === 'in_progress' && <AsyncButton className="btn ghost compact" busyText="Updating…" onClick={() => api.updateJob(j.id, { status: 'done' })}>Mark cleaned</AsyncButton>}
                {j.status === 'done' && (
                  <AsyncButton className="btn compact" busyText="Checking sensor…" onClick={async () => {
                    await new Promise((r) => setTimeout(r, 2500)); // let a fresh reading arrive
                    const s = latest.current[j.siteId];
                    const v = s?.online ? verifyJob(j, s.reading) : { ok: null, text: 'The sensor node is offline, so the clean cannot be checked yet.' };
                    if (v.ok == null) { toast(v.text); return; }
                    await api.updateJob(j.id, { status: v.ok ? 'verified' : 'not_resolved', ratioAfter: v.after });
                    toast(v.text);
                  }}>Verify with sensor</AsyncButton>
                )}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ------------------------------ SETUP ------------------------------ */
function Alerts({ toast, clearIncidents, incidentCount }) {
  const supported = typeof window !== 'undefined' && 'Notification' in window;
  const [perm, setPerm] = useState(supported ? Notification.permission : 'unsupported');
  return (
    <div className="panel">
      <h2>Alerts</h2>
      <p className="small muted">When a sensor node raises its alarm, this dashboard shows a red bar on every page, beeps, and starts counting the loss. Desktop notifications also reach you when the tab is in the background.</p>
      <div className="row">
        {perm === 'granted' ? <span className="pill t-ok">Desktop notifications on</span>
          : perm === 'denied' ? <span className="small muted">Notifications are blocked for this site in your browser settings.</span>
            : supported && <AsyncButton busyText="Asking…" onClick={async () => setPerm(await Notification.requestPermission())}>Turn on desktop notifications</AsyncButton>}
        <button className="btn ghost compact" onClick={beep}>Test the alert sound</button>
        {incidentCount > 0 && <button className="btn ghost compact" onClick={() => { clearIncidents(); toast('Alert history cleared'); }}>Clear alert history ({incidentCount})</button>}
      </div>
    </div>
  );
}

function Setup({ toast, clearIncidents, incidentCount }) {
  return (
    <div className="page">
      <PageHead title="Setup">
        <p className="muted">Where this app gets its readings from.</p>
      </PageHead>
      <div className="panel">
        <div className="row between"><h2>Connection</h2><span className={`mode ${SIM ? 'demo' : 'live'}`}>{SIM ? 'Simulated sensors' : 'Live: Firebase'}</span></div>
        {DEMO ? (
          <p className="small">Paste your Firebase web config into <span className="mono">src/config.js</span> to switch to live mode. The ESP32 then writes to <span className="mono">sites/SITE-001</span> and this app shows it.</p>
        ) : SIM ? (
          <p className="small">This tab is running the simulation, so nothing here reads or changes live data. <a href={window.location.pathname}>Back to live data</a>.</p>
        ) : (
          <p className="small">Connected to Firebase. Add the pilot sites once, then switch on the sensor node.</p>
        )}
      </div>
      <Alerts toast={toast} clearIncidents={clearIncidents} incidentCount={incidentCount} />
      {!DEMO && !SIM && (
        <div className="panel">
          <h2>Presenting</h2>
          <p className="small muted">The simulation runs in the browser with all four sites, so you can show every case without the hardware. Open a site and press Play walkthrough, or pick conditions by hand.</p>
          <a className="btn" href="?sim">Open the simulation</a>
        </div>
      )}
      <div className="panel">
        <h2>Sensor node</h2>
        <p className="small muted">The app reads what <span className="mono">sedigrid_node_v2.ino</span> sends. These settings match the constants in that sketch; change both together.</p>
        <div className="tw">
          <table>
            <tbody>
              {NODE.pins.map(([what, pin]) => <tr key={pin}><td>{what}</td><td className="num">{pin}</td></tr>)}
              <tr><td>Voltage divider (12 kΩ / 10 kΩ)</td><td className="num">× {NODE.dividerScale}</td></tr>
              <tr><td>Load bank per panel (2 × 100 Ω)</td><td className="num">{NODE.loadOhms} Ω</td></tr>
              <tr><td>Buzzer</td><td className="num">{NODE.alarmPercent}% soiling, {NODE.alarmConfirmReadings} readings</td></tr>
              <tr><td>Too dark below (Panel A)</td><td className="num">{NODE.minReferenceVolts.toFixed(1)} V</td></tr>
              <tr><td>Reading every</td><td className="num">{NODE.sampleSeconds} s, sent every 5 s</td></tr>
            </tbody>
          </table>
        </div>
      </div>
      {!SIM && (
        <div className="panel">
          <h2>Pilot sites</h2>
          <p className="small muted">Creates {SEED_SITES.length} site records with capacity, tariff, cleaning cost and dust type. The ESP32 node fills in readings for SITE-001.</p>
          <AsyncButton busyText="Adding sites…" onClick={async () => { await api.seedSites(); toast('Pilot sites added'); }}>Add pilot sites</AsyncButton>
        </div>
      )}
    </div>
  );
}

/* ------------------------------- APP ------------------------------- */
export default function App() {
  const [tab, setTab] = useState('sites');
  const [openId, setOpenId] = useState(null);
  const [sites, setSites] = useState(null);
  const [jobs, setJobs] = useState(null);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [now, setNow] = useState(Date.now());

  useEffect(() => api.subscribeSites((list) => setSites(list.sort((a, b) => a.id.localeCompare(b.id))), (e) => setErr(e.message)), []);
  useEffect(() => api.subscribeJobs(setJobs), []);
  // Tick every second: the loss counter runs live, and a node that goes quiet turns offline without waiting for new data.
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  const liveSites = useMemo(() => sites && sites.map((s) => ({ ...s, online: !!s.lastSeen && now - s.lastSeen.getTime() < OFFLINE_AFTER_SECONDS * 1000 })), [sites, now]);
  const toast = (t) => { setMsg(t); setTimeout(() => setMsg(''), 2800); };
  const [sound, setSound] = useState(true);
  const soundRef = useRef(sound);
  soundRef.current = sound;
  const { incidents, active, clear } = useIncidents(liveSites, jobs, now, (s, inc) => {
    if (soundRef.current) beep();
    notify(`SediGrid alert: ${inc.siteName}`, inc.events[0]?.text || 'Soiling alarm from the sensor node.');
  });
  const site = openId && liveSites?.find((s) => s.id === openId);
  const openJobs = jobs ? jobs.filter((j) => j.status !== 'verified').length : 0;
  const openSite = (id) => { setTab('sites'); setOpenId(id); };

  return (
    <>
      <header className="top">
        <div className="top-in">
          <div className="row" style={{ gap: 'var(--s2)' }}><Logo />{SIM && <span className="mode demo">simulation</span>}</div>
          <nav className="tabs" aria-label="Main">
            {[['sites', 'Sites'], ['live', 'Live'], ['jobs', 'Jobs'], ['setup', 'Setup']].map(([k, l]) => (
              <button key={k} className="tab" aria-current={tab === k ? 'page' : undefined} onClick={() => { setTab(k); setOpenId(null); }}>{l}{k === 'jobs' && openJobs ? ` (${openJobs})` : ''}</button>
            ))}
          </nav>
        </div>
        <AlertBar active={active} now={now} open={openSite} openId={openId} sound={sound} setSound={setSound} />
      </header>
      <main className="shell">
        {err && <div className="alert t-bad small">Could not reach Firebase: {err}. Check src/config.js and your Firestore rules.</div>}
        {tab === 'sites' && !site && <Sites sites={liveSites} open={setOpenId} now={now} />}
        {tab === 'sites' && site && <SiteDetail site={site} now={now} incident={incidents.find((i) => i.siteId === site.id)} back={() => setOpenId(null)} toast={toast} goJobs={() => { setTab('jobs'); setOpenId(null); }} />}
        {tab === 'live' && <Live sites={liveSites} incidents={incidents} now={now} />}
        {tab === 'jobs' && <Jobs jobs={jobs} sites={liveSites} toast={toast} />}
        {tab === 'setup' && <Setup toast={toast} clearIncidents={clear} incidentCount={incidents.length} />}
      </main>
      <Toast msg={msg} />
    </>
  );
}
