// Live view for presenting: both panels and every sensor on one screen, and what waiting costs.
import React, { useEffect, useMemo, useState } from 'react';
import { api, SIM } from './data.js';
import { diagnose, isDark, ratioOf, fmt } from './diagnose.js';
import { NODE } from './config.js';
import { panelPower, rand2, clock, duration } from './incidents.js';

const size = (kw) => (kw >= 1000 ? `${kw / 1000} MW` : `${kw} kW`);
const BUFFER = 120; // readings kept on screen

// Conditions the simulator can set. Also used by the site page's Simulation panel.
export const SCENES = [
  { key: 'clean', label: 'Clean panels', say: 'Panel A and Panel B read the same, so soiling is 0%.' },
  { key: 'cloud', label: 'Cloud passes', say: 'Both panels drop together. The ratio holds, so there is no alarm and no clean.' },
  { key: 'dust', label: 'Dust builds up', say: `Only Panel B drops. Soiling passes ${NODE.alarmPercent}%, and after ${NODE.alarmConfirmReadings} readings in a row the buzzer sounds.` },
  { key: 'drizzle', label: 'Light rain', say: 'The rain sensor reads wet, but drizzle glues the dust to the glass. A clean is still needed.' },
  { key: 'storm', label: 'Heavy rain', say: 'After a storm Panel B recovers, so SediGrid calls off the clean.' },
  { key: 'fault', label: 'Wiring fault', say: 'Panel B reads almost nothing while Panel A has light. That needs an electrician, not a cleaner.' },
  { key: 'night', label: 'Night falls', say: `Panel A drops under ${NODE.minReferenceVolts} V, so the node stops judging until daylight.` },
];

// Hover or tap a chart to read one point; returns the index under the pointer.
function usePointer(count, W, L, R) {
  const [i, setI] = useState(null);
  const handlers = {
    onPointerMove: (e) => pick(e), onPointerDown: (e) => pick(e), onPointerLeave: () => setI(null),
  };
  function pick(e) {
    const box = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - box.left) / box.width) * W;
    setI(Math.max(0, Math.min(count - 1, Math.round(((px - L) / (W - L - R)) * (count - 1)))));
  }
  return [i, handlers];
}

function PanelCard({ which, title, pin, v, ma, mw, temp, scale }) {
  return (
    <div className={`live-card ${which}`}>
      <div className="tight"><strong>{title}</strong><span className="label">{pin}</span></div>
      <span className="display mono">{v != null ? `${v.toFixed(2)} V` : '–'}</span>
      <div className="meter thick" aria-hidden="true"><i style={{ width: `${Math.min(100, ((mw || 0) / scale) * 100)}%` }} /></div>
      <dl className="live-dl">
        <div><dt>Current</dt><dd className="mono">{ma != null ? `${ma.toFixed(0)} mA` : '–'}</dd></div>
        <div><dt>Power</dt><dd className="mono">{mw != null ? `${mw.toFixed(0)} mW` : '–'}</dd></div>
        <div><dt>Temperature</dt><dd className="mono">{temp != null ? `${temp.toFixed(1)} °C` : '–'}</dd></div>
      </dl>
    </div>
  );
}

// Both panels' power over time. The red band between the lines is the energy dust is taking.
function PowerChart({ points }) {
  const W = 800, H = 220, L = 48, R = 8, T = 10, B = 22;
  const [hover, handlers] = usePointer(points.length, W, L, R);
  if (points.length < 2) return <div className="skel" style={{ height: H }} />;
  // The axis starts near the lowest reading, not at zero, so the gap between the panels is easy to see.
  const hi = Math.max(100, ...points.map((p) => p.a)) * 1.08;
  const lo = Math.max(0, Math.min(...points.map((p) => p.b)) * 0.7);
  const x = (i) => L + (i / (points.length - 1)) * (W - L - R);
  const y = (v) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
  const lineA = points.map((p, i) => `${x(i)},${y(p.a)}`).join(' ');
  const lineB = points.map((p, i) => `${x(i)},${y(p.b)}`).join(' ');
  const gap = `${lineA} ${points.map((p, i) => `${x(i)},${y(p.b)}`).reverse().join(' ')}`;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(lo + (hi - lo) * f));
  const i = hover ?? points.length - 1;
  const p = points[i];
  return (
    <div className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={`Power from both panels over the last ${points.length} readings. Now Panel A ${p.a.toFixed(0)} mW, Panel B ${p.b.toFixed(0)} mW.`} {...handlers}>
        {ticks.map((t) => (
          <g key={t}>
            <line className="chart-grid" x1={L} x2={W - R} y1={y(t)} y2={y(t)} />
            <text className="chart-text" x={L - 6} y={y(t) + 4} textAnchor="end">{t}</text>
          </g>
        ))}
        <text className="chart-text" x={L} y={H - 6}>mW, older</text>
        <text className="chart-text" x={W - R} y={H - 6} textAnchor="end">now</text>
        <polygon className="gap-band" points={gap} />
        <polyline className="line-a" points={lineA} />
        <polyline className="line-b" points={lineB} />
        <line className="chart-cursor" x1={x(i)} x2={x(i)} y1={T} y2={H - B} />
        <circle className="dot-a" cx={x(i)} cy={y(p.a)} r="5" />
        <circle className="dot-b" cx={x(i)} cy={y(p.b)} r="5" />
      </svg>
      <div className="chart-read small">
        <span className="mono">{clock(p.t)}</span>
        <span><i className="key a" />Panel A <span className="mono">{p.a.toFixed(0)} mW</span></span>
        <span><i className="key b" />Panel B <span className="mono">{p.b.toFixed(0)} mW</span></span>
        <span><i className="key gap" />Lost to dust <strong className="mono">{Math.max(0, p.a - p.b).toFixed(0)} mW</strong></span>
      </div>
    </div>
  );
}

// Money lost since the alert, drawn as it grows.
function LossCurve({ inc, now }) {
  const W = 800, H = 200, L = 64, R = 8, T = 10, B = 22;
  const pts = useMemo(() => {
    const s = inc.series?.length ? inc.series : [{ t: inc.start, rand: 0 }];
    return inc.end ? s : [...s, { t: now, rand: inc.rand }];
  }, [inc, now]);
  const [hover, handlers] = usePointer(pts.length, W, L, R);
  const t0 = inc.start, t1 = Math.max(t0 + 10000, pts[pts.length - 1].t);
  const max = Math.max(1, ...pts.map((p) => p.rand)) * 1.15;
  const x = (t) => L + ((t - t0) / (t1 - t0)) * (W - L - R);
  const y = (v) => T + (1 - v / max) * (H - T - B);
  const line = pts.map((p) => `${x(p.t)},${y(p.rand)}`).join(' ');
  const ticks = [0, 0.5, 1].map((f) => (max / 1.15) * f);
  const p = pts[hover ?? pts.length - 1];
  return (
    <div className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={`Money lost since the alert at ${clock(inc.start)}: ${rand2(inc.rand)}`} {...handlers}>
        {ticks.map((t, k) => (
          <g key={k}>
            <line className="chart-grid" x1={L} x2={W - R} y1={y(t)} y2={y(t)} />
            <text className="chart-text" x={L - 6} y={y(t) + 4} textAnchor="end">{rand2(t)}</text>
          </g>
        ))}
        <polygon className="loss-area" points={`${x(pts[0].t)},${H - B} ${line} ${x(pts[pts.length - 1].t)},${H - B}`} />
        <polyline className="loss-line" points={line} />
        <circle className="dot-loss" cx={x(p.t)} cy={y(p.rand)} r="5" />
        <text className="chart-text" x={L} y={H - 6}>{clock(inc.start)} alert</text>
        <text className="chart-text" x={W - R} y={H - 6} textAnchor="end">{inc.end ? `${clock(inc.end)} cleared` : 'now'}</text>
      </svg>
      <div className="chart-read small">
        <span className="mono">{clock(p.t)}</span>
        <span>{duration(p.t - inc.start)} after the alert</span>
        <span>Lost <strong className="mono">{rand2(p.rand)}</strong></span>
      </div>
    </div>
  );
}

// Drag to choose how long to put off the clean; compares the loss with the price of one clean.
function WaitSlider({ rateDay, cleanCost }) {
  const [days, setDays] = useState(7);
  const lost = rateDay * days;
  const dayWord = (n) => `${n} day${n === 1 ? '' : 's'}`;
  const breakeven = rateDay > 0 ? cleanCost / rateDay : Infinity;
  const top = Math.max(lost, cleanCost) || 1;
  return (
    <div className="stack">
      <label className="field" htmlFor="wait">
        <span>If you wait <strong className="mono">{days} day{days === 1 ? '' : 's'}</strong> before cleaning</span>
        <input id="wait" type="range" min="0" max="60" value={days} onChange={(e) => setDays(+e.target.value)} />
      </label>
      <div className="bars">
        <div className="bar-row"><span>Lost to dust</span><span className="bar loss"><i style={{ width: `${(lost / top) * 100}%` }} /></span><strong className="mono">{rand2(lost)}</strong></div>
        <div className="bar-row"><span>One clean</span><span className="bar clean"><i style={{ width: `${(cleanCost / top) * 100}%` }} /></span><strong className="mono">R{fmt(cleanCost)}</strong></div>
      </div>
      <p className={`verdict ${lost > cleanCost ? 't-bad' : 't-ok'}`}>
        {Number.isFinite(breakeven)
          ? lost > cleanCost
            ? `Waiting ${dayWord(days)} costs ${rand2(lost - cleanCost)} more than cleaning. Waiting stopped making sense after ${dayWord(Math.max(1, Math.round(breakeven)))}.`
            : `Waiting ${dayWord(days)} still costs less than a clean. After ${dayWord(Math.max(1, Math.round(breakeven)))} it costs more.`
          : 'No dust loss right now, so there is nothing to lose by waiting.'}
      </p>
      <span className="small muted">At today's loss rate of R{fmt(rateDay)} a day. Dust keeps building, so the real figure grows faster.</span>
    </div>
  );
}

export default function Live({ sites, incidents, now }) {
  const [siteId, setSiteId] = useState(null);
  const [scene, setScene] = useState(null);
  const [hist, setHist] = useState([]);
  const [buf, setBuf] = useState([]);
  const alerted = incidents.find((i) => !i.end)?.siteId;
  const site = sites?.find((s) => s.id === (siteId || alerted || 'SITE-001')) || sites?.[0];
  const r = site?.reading;

  // Older points from the history log, then every new reading as it arrives.
  useEffect(() => { setBuf([]); setHist([]); return site ? api.subscribeHistory(site.id, setHist) : undefined; }, [site?.id]);
  useEffect(() => {
    if (!r) return;
    const t = r.at ? new Date(r.at).getTime() : Date.now();
    setBuf((b) => (b.length && b[b.length - 1].t === t ? b : [...b, { t, ...panelPower(r) }].slice(-BUFFER)));
  }, [r?.at, r?.test, r?.ref]);
  const points = useMemo(() => {
    const first = buf[0]?.t ?? Infinity;
    const older = hist.filter((h) => h.at && new Date(h.at).getTime() < first).map((h) => ({ t: new Date(h.at).getTime(), ...panelPower(h) }));
    return [...older, ...buf].slice(-BUFFER);
  }, [hist, buf]);

  if (!sites) return <div className="page"><div className="skel" style={{ height: 400 }} /></div>;
  if (!site) return <div className="page"><div className="panel"><h2>No sites yet</h2><p className="muted">Add the pilot sites under Setup first.</p></div></div>;

  const d = diagnose(site, r);
  const inc = incidents.find((i) => i.siteId === site.id);
  const soil = r && !isDark(r) ? (1 - ratioOf(r)) * 100 : null;
  const scale = Math.max(100, ...points.map((p) => p.a)) * 1.05;
  const rateDay = d.state === 'dust' || d.state === 'rain-worse' ? d.lossRandDay : inc && !inc.end ? inc.rateDay : 0;

  return (
    <div className="page">
      <div className="row between">
        <div className="page-head">
          <h1>Live</h1>
          <p className="muted">{site.name}, {size(site.capacityKW)}. {site.online ? `Reading every ${NODE.sampleSeconds} s, last ${clock(site.lastSeen || now)}.` : 'Sensor node offline.'}</p>
        </div>
        <select aria-label="Site" value={site.id} onChange={(e) => setSiteId(e.target.value)}>
          {sites.map((s) => <option key={s.id} value={s.id}>{s.name || s.id}</option>)}
        </select>
      </div>

      {SIM && (
        <div className="row" role="group" aria-label="Simulate a condition">
          {SCENES.map((s) => <button key={s.key} className="chip" aria-pressed={scene === s.key} onClick={() => { setScene(s.key); api.setScenario(site.id, s.key); }}>{s.label}</button>)}
        </div>
      )}

      <div className="live-panels">
        <PanelCard which="a" title="Panel A, reference (kept clean)" pin="GPIO34" v={r?.ref} ma={r?.refMa ?? (r ? (r.ref / NODE.loadOhms) * 1000 : null)} mw={r ? panelPower(r).a : null} temp={r?.refTempC} scale={scale} />
        <PanelCard which="b" title="Panel B, test (on the array)" pin="GPIO35" v={r?.test} ma={r?.testMa ?? (r ? (r.test / NODE.loadOhms) * 1000 : null)} mw={r ? panelPower(r).b : null} temp={r?.testTempC} scale={scale} />
        <div className="live-card sensors">
          <strong>Sensors</strong>
          <div className="sensor"><span>Soiling</span><span className={`display-sm mono ${soil != null && soil >= NODE.alarmPercent ? 'bad' : ''}`}>{soil != null ? `${soil.toFixed(1)}%` : isDark(r || { ref: 0 }) ? 'dark' : '–'}</span></div>
          <div className="gauge" aria-hidden="true"><i style={{ width: `${Math.min(100, ((soil || 0) / 20) * 100)}%` }} /><b style={{ left: `${(NODE.alarmPercent / 20) * 100}%` }} /></div>
          <span className="small muted">Buzzer at {NODE.alarmPercent}%, after {NODE.alarmConfirmReadings} readings</span>
          <div className="sensor"><span>Rain (GPIO36)</span><span className="mono">{r ? `${r.rainMv != null ? `${fmt(r.rainMv)} mV ` : ''}${r.rainWet ? 'wet' : 'dry'}` : '–'}</span></div>
          <div className="sensor"><span>Buzzer (GPIO32)</span><span className={`pill ${site.alarm_active && site.online ? (site.alarm_muted ? 't-off' : 't-bad') : 't-ok'}`}>{site.alarm_active && site.online ? (site.alarm_muted ? 'silenced' : 'sounding') : 'off'}</span></div>
          <div className="sensor"><span>Diagnosis</span><span className="small"><strong>{d.title}</strong></span></div>
        </div>
      </div>

      <div className="panel">
        <div className="row between">
          <h2>Both panels, live</h2>
          <span className="small muted">Hover or tap the chart to read any moment</span>
        </div>
        <PowerChart points={points} />
      </div>

      <div className="panel live-loss">
        <div className="row between">
          <div className="tight">
            <h2>The longer you wait, the more you lose</h2>
            <span className="small muted">Measured soiling, scaled to {site.name}'s {size(site.capacityKW)} at R{site.tariff}/kWh</span>
          </div>
          {inc && <div className="tight" style={{ textAlign: 'right' }}>
            <span className="display mono loss-now">{rand2(inc.rand)}</span>
            <span className="small muted">{inc.end ? `lost in ${duration(inc.end - inc.start)}, then cleared` : `lost in ${duration(now - inc.start)}, still counting`}</span>
          </div>}
        </div>
        {inc ? <LossCurve inc={inc} now={now} /> : (
          <p className="verdict t-off">No alert yet at this site. {SIM ? 'Press Dust builds up above to start one.' : 'Cover Panel B to start one.'}</p>
        )}
        <WaitSlider rateDay={rateDay} cleanCost={site.cleanCost || 0} />
      </div>
    </div>
  );
}
