import { YIELD_KWH_PER_KW_DAY, PAYBACK_LIMIT_DAYS, NODE } from './config.js';

// Panel B output as a share of clean Panel A. Uses the node's calibrated soiling figure when it sends one.
export const ratioOf = (r) => (r.soilingPct != null ? 1 - r.soilingPct / 100 : r.test / r.ref);
export const isDark = (r) => r.ref < NODE.minReferenceVolts;

// Cleaning method per dust type. Every method follows common module-maker rules:
// low pressure (under 35 bar), water within 20 °C of the panel, inverter off, no abrasives or ammonia.
export const METHODS = {
  farm: {
    label: 'Farm topsoil dust',
    method: 'Dry soft brush',
    steps: ['Clean at dawn with the inverter off', 'Soft non-conductive brush, top to bottom', 'Rinse with deionised water only if dust has caked'],
    why: 'Loose soil dust brushes off dry, which saves water.',
  },
  tailings: {
    label: 'Gold-tailings dust (silica)',
    method: 'Soft wet clean',
    steps: ['Clean at dawn with the inverter off', 'Wet panels with deionised water to loosen the crust', 'Soft brush, low pressure under 35 bar', 'No dry scrubbing'],
    why: 'Silica is hard. Scrubbing it dry can scratch the glass.',
  },
  livestock: {
    label: 'Livestock ammonia film',
    method: 'Mild detergent wash',
    steps: ['Clean at dawn with the inverter off', 'Mild, non-abrasive detergent (no ammonia)', 'Soft sponge, rinse with deionised water'],
    why: 'Ammonia mixes with dust into a film that water alone does not remove.',
  },
  industrial: {
    label: 'Industrial or coal dust',
    method: 'Soak, then soft brush',
    steps: ['Clean at dawn with the inverter off', 'Soak with deionised water for a few minutes', 'Soft brush, low pressure', 'Repeat on stubborn crust; never scrape'],
    why: 'Humidity cements industrial dust onto the glass.',
  },
  general: {
    label: 'Mixed road and urban dust',
    method: 'Water-fed soft brush',
    steps: ['Clean at dawn with the inverter off', 'Water-fed pole with soft brush from the ground', 'Deionised or low-hardness water to avoid spots'],
    why: 'Hard tap water leaves mineral spots that cut output.',
  },
};

// reading: { test, ref, rainWet, tempC, at }   history: newest last
export function diagnose(site, reading, history = []) {
  if (!reading) return { state: 'offline', title: 'No readings yet', text: 'Waiting for the sensor node to report.' };
  // A silent node's last reading is out of date, so don't diagnose or cost it.
  if (site.online === false) return { state: 'offline', title: 'Node offline', text: 'The sensor node has stopped reporting. Check its power and Wi-Fi. The diagnosis resumes when it reconnects.' };
  const { test, ref, rainWet } = reading;
  if (isDark(reading)) return { state: 'dark', title: 'Too dark to judge', text: `Panel A is under ${NODE.minReferenceVolts} V, so the node isn't judging soiling. Readings resume in daylight.`, ratio: null };

  const ratio = Math.min(1.05, ratioOf(reading));
  const pct = Math.round(ratio * 100);
  const loss = Math.max(0, 1 - ratio);
  const lossKwhDay = site.capacityKW * YIELD_KWH_PER_KW_DAY * loss;
  const lossRandDay = lossKwhDay * site.tariff;
  const payback = lossRandDay > 0 ? site.cleanCost / lossRandDay : Infinity;
  const base = { ratio, pct, loss, lossKwhDay, lossRandDay, payback };

  const recent = history.slice(-4).map((h) => (isDark(h) ? null : ratioOf(h))).filter((x) => x != null);
  const prev = recent.length >= 2 ? recent[recent.length - 2] : null;
  const suddenDrop = prev != null && prev - ratio > 0.08;
  const recovered = prev != null && ratio - prev > 0.04;

  if (test < 0.1 * ref) return { ...base, state: 'fault', title: 'Possible fault', text: 'The array reads almost nothing while the reference panel has light. Check wiring, fuses or the inverter. Call an electrician, not a cleaner.' };
  if (ratio >= 0.97) {
    if (recovered && rainWet) return { ...base, state: 'rain-clean', title: 'Rain cleaned it', text: 'Output recovered after rain. No clean needed.' };
    return { ...base, state: 'clean', title: 'Clean', text: 'The array matches the clean reference panel. No action needed.' };
  }
  if (suddenDrop) return { ...base, state: 'shade', title: 'Sudden drop: shade or blockage', text: 'Output fell quickly, which dust does not do. Check for shade, debris or bird droppings.' };
  if (rainWet) return { ...base, state: 'rain-worse', title: 'Rain did not clean it', text: 'Light rain left the dust stuck to the glass. A clean is still needed.', clean: payback <= PAYBACK_LIMIT_DAYS };
  return {
    ...base,
    state: 'dust',
    title: payback <= PAYBACK_LIMIT_DAYS ? 'Dust: clean now' : 'Dust: wait for now',
    text: payback <= PAYBACK_LIMIT_DAYS
      ? `A clean costs R${fmt(site.cleanCost)} and pays for itself in about ${Math.max(1, Math.round(payback))} days.`
      : `Dust is costing R${fmt(lossRandDay)} a day. A clean would take ${Math.round(payback)} days to pay off, so wait.`,
    clean: payback <= PAYBACK_LIMIT_DAYS,
  };
}

export function verifyJob(job, reading) {
  if (!reading || isDark(reading)) return { ok: null, text: 'Waiting for a daylight reading to check the result.' };
  const after = ratioOf(reading);
  const ok = after >= 0.97 || after - job.ratioBefore >= 0.04;
  return { ok, after, text: ok ? 'Output recovered. Clean verified.' : 'Output has not recovered. Check the clean or look for another cause.' };
}

// Thousands grouped with a plain space; the locale's narrow space is missing from the mono font.
export const fmt = (n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
