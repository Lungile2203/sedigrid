// Enquiries are saved to Firestore (collection "enquiries"); the team reads them in the Firebase console.
// The rules let anyone add an enquiry but nobody read one from the web.
// This is the same public web API key the dashboard uses.
const FIRESTORE = 'https://firestore.googleapis.com/v1/projects/sedigrid-dbef5/databases/(default)/documents/enquiries?key=AIzaSyCSI2iCBVozhNvG04xbBCMnAJixmp5QSrw';

// Same yield the dashboard uses: Harmony Sungazer 1, 70 GWh a year from 30 MW = 6.4 kWh/kWp/day.
const YIELD = 6.4;
const DRY_SEASON_DAYS = 120;
const PAYBACK_LIMIT_DAYS = 30;

const $ = (id) => document.getElementById(id);
const rand = (n) => 'R' + Math.round(n).toLocaleString('en-ZA').replace(/,/g, ' ');
const el = (tag, attrs = {}, text) => {
  const e = document.createElement(tag);
  Object.entries(attrs).forEach(([k, v]) => e.setAttribute(k, v));
  if (text != null) e.textContent = text;
  return e;
};

/* ------------------------------ Tabs ------------------------------ */
const tabs = [$('tab-sensor'), $('tab-cost')];
function selectTab(tab) {
  tabs.forEach((t) => {
    const on = t === tab;
    t.setAttribute('aria-selected', on);
    t.tabIndex = on ? 0 : -1;
    $(t.getAttribute('aria-controls')).hidden = !on;
  });
}
tabs.forEach((t, i) => {
  t.addEventListener('click', () => selectTab(t));
  t.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const next = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
    selectTab(next);
    next.focus();
  });
});

/* ------------------------- Sensor simulator ------------------------- */
const SCENARIOS = [
  { key: 'clean', label: 'Clean panels', test: 100, ref: 100, rain: 'dry', tone: 't-ok', verdict: 'Clean', text: 'Both panels match. No action needed.' },
  { key: 'cloud', label: 'Cloud passes', test: 39, ref: 39, rain: 'dry', tone: 't-ok', verdict: 'Cloud, not dust', text: 'Both panels dropped together, so the ratio holds. No action needed.' },
  { key: 'dust', label: 'Dust builds up', test: 91, ref: 100, rain: 'dry', tone: 't-dust', verdict: 'Dust: clean recommended', text: 'Only the array dropped, slowly over 41 days. At this site a clean pays for itself in about 7 days.' },
  { key: 'drizzle', label: 'Light rain', test: 89, ref: 100, rain: 'wet, 3 mm', tone: 't-dust', verdict: 'Rain made it worse', text: 'Drizzle left the dust stuck to the glass. Book a clean.' },
  { key: 'storm', label: 'Heavy rain', test: 99, ref: 100, rain: 'wet, 18 mm', tone: 't-ok', verdict: 'Rain cleaned it', text: 'The ratio recovered after the storm. No clean needed.' },
  { key: 'fault', label: 'Wiring fault', test: 4, ref: 100, rain: 'dry', tone: 't-bad', verdict: 'Possible fault', text: 'The array reads almost nothing while the reference has light. Call an electrician, not a cleaner.' },
];

let current = 'dust';
let timer = null;
const reading = $('reading');
const scenarioBox = $('scenarios');

function meter(label, value, kind) {
  const wrap = el('div', { class: 'stack', style: 'gap: var(--s1)' });
  const line = el('div', { class: 'meter-line' });
  line.append(el('span', {}, label), el('span', {}, value + '%'));
  const bar = el('div', { class: 'meter ' + kind, 'aria-hidden': 'true' });
  const fill = el('i');
  bar.append(fill);
  wrap.append(line, bar);
  return { wrap, fill, value };
}

// Build the reading panel once, then only update values so the bars animate between states.
const meters = { test: meter('Test panel (on the array)', 0, 'test'), ref: meter('Reference panel (kept clean)', 0, 'ref'), ratio: meter('Soiling ratio (test ÷ reference)', 0, 'ratio') };
const rainLine = el('div', { class: 'meter-line' });
const rainVal = el('span');
rainLine.append(el('span', {}, 'Rain sensor'), rainVal);
const verdict = el('div', { class: 'verdict' });
const verdictTitle = el('strong');
const verdictText = el('span', { class: 'small' });
verdict.append(verdictTitle, verdictText);
const loadingBox = el('div', { class: 'stack', hidden: '' });
loadingBox.append(el('span', { class: 'small muted' }, 'Reading both panels…'), el('div', { class: 'skel', style: 'height: 24px' }), el('div', { class: 'skel', style: 'height: 24px' }), el('div', { class: 'skel', style: 'height: 24px; width: 60%' }), el('div', { class: 'skel', style: 'height: 72px; border-radius: var(--r2)' }));
const readyBox = el('div', { class: 'stack' });
readyBox.append(meters.test.wrap, meters.ref.wrap, meters.ratio.wrap, rainLine, verdict);
reading.append(loadingBox, readyBox);

function show(key) {
  const s = SCENARIOS.find((x) => x.key === key);
  const ratio = Math.round((s.test / s.ref) * 100);
  [['test', s.test], ['ref', s.ref], ['ratio', ratio]].forEach(([k, v]) => {
    meters[k].wrap.querySelector('.meter-line span:last-child').textContent = v + '%';
    meters[k].fill.style.width = v + '%';
  });
  rainVal.textContent = s.rain;
  verdict.className = 'verdict ' + s.tone;
  verdictTitle.textContent = s.verdict;
  verdictText.textContent = s.text;
}

function pick(key) {
  if (key === current || timer) return;
  current = key;
  renderChips();
  // A short pause stands in for the node taking a fresh reading.
  loadingBox.hidden = false;
  readyBox.hidden = true;
  timer = setTimeout(() => {
    timer = null;
    loadingBox.hidden = true;
    readyBox.hidden = false;
    requestAnimationFrame(() => show(key));
  }, 600);
}

function renderChips() {
  scenarioBox.replaceChildren(...SCENARIOS.map((s) => {
    const b = el('button', { class: 'chip', type: 'button', 'aria-pressed': s.key === current }, s.label);
    b.addEventListener('click', () => pick(s.key));
    return b;
  }));
}
renderChips();
requestAnimationFrame(() => show(current));

/* ------------------------- Loss calculator ------------------------- */
// Example sites from the pilot plan. Clean costs are working assumptions, not quotes.
const PRESETS = [
  { label: 'Home, 4 kWp', kw: 4, tariff: 3, clean: 600 },
  { label: 'Farm, 300 kWp', kw: 300, tariff: 2.5, clean: 3600 },
  { label: 'CUT campus, 153.7 kWp', kw: 153.7, tariff: 2.5, clean: 4500 },
  { label: 'Mine plant, 10 MWp', kw: 10000, tariff: 2, clean: 60000 },
];
const inputs = { kw: $('kw'), tariff: $('tariff'), clean: $('clean'), soil: $('soil') };
let preset = 1;

function renderPresets() {
  $('presets').replaceChildren(...PRESETS.map((p, i) => {
    const b = el('button', { class: 'chip', type: 'button', 'aria-pressed': i === preset }, p.label);
    b.addEventListener('click', () => applyPreset(i));
    return b;
  }));
}
function applyPreset(i) {
  preset = i;
  const p = PRESETS[i];
  inputs.kw.value = p.kw;
  inputs.tariff.value = p.tariff;
  inputs.clean.value = p.clean;
  renderPresets();
  calc();
}

function calc() {
  const kw = Math.max(0, parseFloat(inputs.kw.value) || 0);
  const tariff = Math.max(0, parseFloat(inputs.tariff.value) || 0);
  const clean = Math.max(0, parseFloat(inputs.clean.value) || 0);
  const soil = parseInt(inputs.soil.value, 10) / 100;
  const kwh = kw * YIELD * soil;
  const day = kwh * tariff;
  const payback = day > 0 ? clean / day : Infinity;

  $('soil-out').textContent = Math.round(soil * 100) + '%';
  $('r-day').textContent = rand(day);
  $('r-kwh').textContent = Math.round(kwh).toLocaleString('en-ZA').replace(/,/g, ' ') + ' kWh';
  $('r-season').textContent = rand(day * DRY_SEASON_DAYS);
  $('r-payback').textContent = Number.isFinite(payback) ? `${Math.max(1, Math.round(payback))} days` : '–';

  const v = $('r-verdict');
  v.replaceChildren();
  if (!Number.isFinite(payback)) {
    v.className = 'verdict t-ok';
    v.append(el('strong', {}, 'Enter your system'), el('span', { class: 'small' }, 'Add a size and an electricity value to see the call.'));
  } else if (payback <= PAYBACK_LIMIT_DAYS) {
    v.className = 'verdict t-dust';
    v.append(el('strong', {}, 'Clean now'), el('span', { class: 'small' }, `The clean earns back its ${rand(clean)} within ${PAYBACK_LIMIT_DAYS} days.`));
  } else {
    v.className = 'verdict t-ok';
    v.append(el('strong', {}, 'Wait for now'), el('span', { class: 'small' }, `At ${Math.round(soil * 100)}% the clean takes longer than ${PAYBACK_LIMIT_DAYS} days to pay off. SediGrid would keep watching.`));
  }
}

Object.values(inputs).forEach((i) => i.addEventListener('input', () => {
  if (i !== inputs.soil && preset !== -1) { preset = -1; renderPresets(); }
  calc();
}));
$('calc').addEventListener('submit', (e) => e.preventDefault());
applyPreset(preset);

/* --------------------------- Contact form --------------------------- */
const form = $('contact');
const f = form.elements; // form.name would be the form's own name, not the input
const note = $('f-note');
const send = $('f-send');

function check(input, ok) {
  input.setAttribute('aria-invalid', !ok);
  input.parentElement.querySelector('.error').hidden = ok;
  return ok;
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = f.name.value.trim();
  const email = f.email.value.trim();
  const okName = check(f.name, name.length > 1);
  const okEmail = check(f.email, /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email));
  if (!okName || !okEmail) { (okName ? f.email : f.name).focus(); return; }

  send.disabled = true;
  note.hidden = true;
  send.replaceChildren(el('span', { class: 'spin', 'aria-hidden': 'true' }), document.createTextNode('Sending…'));
  const str = (v) => ({ stringValue: v.trim().slice(0, 2000) });
  const fields = {
    name: str(name), org: str(f.org.value), email: str(email), phone: str(f.phone.value),
    role: str(f.role.value), message: str(f.message.value), at: { timestampValue: new Date().toISOString() },
  };

  try {
    const res = await fetch(FIRESTORE, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fields }) });
    if (!res.ok) throw new Error(res.status);
    form.reset();
    note.className = 'form-note t-ok';
    note.textContent = `Thanks, ${name.split(' ')[0]}. Your message reached the team and we'll reply to ${email}.`;
  } catch {
    note.className = 'form-note t-bad';
    note.textContent = 'Your message did not send. Check your connection and try again.';
  } finally {
    send.disabled = false;
    send.textContent = 'Send to the team';
    note.hidden = false;
  }
});
