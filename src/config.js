// Your Firebase web config (Firebase console > Settings > General > Your apps).
// While apiKey still says "YOUR_API_KEY", the app runs in DEMO mode with simulated sensors.
export const firebaseConfig = {
  apiKey: "AIzaSyCSI2iCBVozhNvG04xbBCMnAJixmp5QSrw",
  authDomain: "sedigrid-dbef5.firebaseapp.com",
  projectId: "sedigrid-dbef5",
  storageBucket: "sedigrid-dbef5.firebasestorage.app",
  messagingSenderId: "222029597381",
  appId: "1:222029597381:web:a0fdadd8842be994153eac"
};

export const DEMO = firebaseConfig.apiKey.startsWith('YOUR_');
// Simulation for presenting: runs the in-browser sensor simulator even when Firebase is set up.
// Open the dashboard with ?sim on the end (e.g. /app/?sim) to start it.
// A build made with VITE_FORCE_SIM=1 always runs the simulation (used for the shareable demo page).
export const SIM = DEMO || import.meta.env.VITE_FORCE_SIM === '1' || new URLSearchParams(window.location.search).has('sim');

// Free State yield: about 2,333 kWh per kWp per year (Harmony Sungazer 1: 70 GWh from 30 MW) = 6.4 kWh/kWp/day.
export const YIELD_KWH_PER_KW_DAY = 6.4;
// Clean now if the clean pays for itself within this many days.
export const PAYBACK_LIMIT_DAYS = 30;
// The ESP32 writes every 5 s. A node that has been silent this long is shown as offline.
export const OFFLINE_AFTER_SECONDS = 30;

// Sensor node settings. Keep in sync with the constants in sedigrid_node_v2.ino.
export const NODE = {
  minReferenceVolts: 1.0,     // MIN_REFERENCE_VOLTAGE: below this Panel A is too dark to judge
  alarmPercent: 8,            // SOILING_ALARM_PERCENT: buzzer threshold
  alarmConfirmReadings: 3,    // ALARM_CONFIRM_READINGS
  sampleSeconds: 2,           // SAMPLE_INTERVAL_MS / 1000
  loadOhms: 50,               // LOAD_RESISTANCE_OHM: 2 x 100 Ohm in parallel
  dividerScale: 2.2,          // DIVIDER_SCALE: 12k / 10k divider
  pins: [
    ['Panel A (reference, kept clean)', 'GPIO34'],
    ['Panel B (test, on the array)', 'GPIO35'],
    ['Rain sensor AO', 'GPIO36'],
    ['DS18B20 probes (one per panel)', 'GPIO33'],
    ['Buzzer, via NPN transistor', 'GPIO32'],
  ],
};
