# SediGrid app + sensor node

A working app (React + Firebase) and the ESP32 firmware that feeds it.
It runs in **demo mode** straight away, with simulated sensors. Paste your Firebase config and it switches to **live mode**, showing what the ESP32 sends.

## How the pieces connect

```
ESP32 (Arduino IDE)  --Wi-Fi-->  Firebase Firestore  <--live-->  SediGrid app (VS Code)
  reads 2 panels                 sites/SITE-001                  diagnosis, cleaning plan,
  + rain sensor                  sites/SITE-001/readings         jobs, verify
  buzzer via relay   <--mute--   jobs/*
```

The ESP32 and the app never talk to each other directly. Both read and write the same Firestore records:

| Field on `sites/SITE-001` | Written by | Meaning |
|---|---|---|
| `test_v`, `ref_v` | ESP32 | Test panel and clean reference panel voltage |
| `rain_wet` | ESP32 | Rain sensor wet or dry |
| `temp_c` | ESP32 | Panel temperature (if DS18B20 fitted) |
| `alarm_active` | ESP32 | Buzzer condition |
| `alarm_muted` | App → ESP32 | "Silence buzzer" button |
| `updated_at` | ESP32 | App shows offline if older than 2 minutes |
| `name`, `capacityKW`, `tariff`, `cleanCost`, `dustType` | App (Setup) | Site details used for rand and method |

## Should you use Arduino?

Yes. Use the **Arduino IDE with the ESP32 board package** for the hardware, as the organisers advised, and **VS Code** for the app.
- The Arduino IDE handles board drivers, uploading and the Serial Monitor in one place, so it's the fastest way to get the ESP32 working.
- You can read and edit the `.ino` file in VS Code too. Upload it from the Arduino IDE.
- PlatformIO (the VS Code alternative) downloads about 1 GB of tools. Avoid it on venue Wi-Fi.

## Step by step

### 1. Run the app in demo mode (5 min)
```
cd sedigrid-app
npm install
npm run dev
```
Open http://localhost:5173. Click a site, use **Demo controls** (Dust builds up, Cloud passes, Light rain…), dispatch a crew, then go to **Jobs**: Crew on site → Mark cleaned → Verify with sensor.

### 2. Connect Firebase (10 min)
1. Firebase console → Project settings → Your apps → copy the config into `src/config.js`.
2. Firestore → Rules → paste `firestore.rules` → Publish.
3. Restart `npm run dev`. The header now says **live**.
4. Open **Setup → Add pilot sites**. This creates SITE-001 to SITE-004 with their details.

### 3. Flash the ESP32 (15 min)
1. Arduino IDE → Preferences → Boards Manager URL: `https://espressif.github.io/arduino-esp32/package_esp32_index.json` → install **esp32 by Espressif**.
2. Library Manager → install **ArduinoJson** (v7). If you fitted the DS18B20, also install OneWire + DallasTemperature and set `USE_DS18B20 1`.
3. Open `firmware/sedigrid_node/sedigrid_node.ino`. Fill in Wi-Fi (2.4 GHz phone hotspot), `FB_PROJECT_ID` and `FB_API_KEY` (same values as `src/config.js`).
4. Board **ESP32 Dev Module** → Upload (hold BOOT if it hangs on "Connecting…").
5. Serial Monitor at 115200. With **both panels clean** you hear 3 chirps (calibration), then:
   `test 4.61 V | ref 4.63 V | ratio 100% | rain dry | alarm off | WiFi ok`

### 4. Test end to end
| Do this | Serial Monitor | App (Tshepong site, SITE-001) |
|---|---|---|
| Cover **both** panels with your hand | both voltages drop, ratio stays ~100% | "Clean" (cloud, not dust) |
| Translucent paper on the **test** panel | ratio falls | "Dust: clean now" + cleaning plan |
| Keep it covered 6 s | alarm ON, buzzer sounds | "Buzzer sounding" banner → Silence buzzer |
| Spray the rain sensor, paper still on | rain wet | "Rain did not clean it" |
| Dispatch → Crew on site → remove paper → Mark cleaned → Verify | ratio ~100% | Job **Verified** |
| Unplug the test panel wire | test ≈ 0 V | "Possible fault: call an electrician" |

### 5. Deploy
```
npm run build
firebase deploy --only hosting
```
(`firebase init hosting` once, public folder `dist`.)

## Troubleshooting
| Problem | Fix |
|---|---|
| `Firestore PATCH -> 403` | Rules not published, or you skipped Setup → Add pilot sites |
| `-> 404` | Wrong project ID |
| `-> -1` | Hotspot has no data, or the ESP32 is on 5 GHz |
| App says offline | ESP32 clock not synced yet; wait 30 s |
| Ratio not 100% with both panels clean | Press BOOT to recalibrate in steady light |
| Buzzer on at boot | `RELAY_ACTIVE_LOW = false` |

## Files
- `src/App.jsx`: screens (Sites, Site detail, Jobs, Setup)
- `src/diagnose.js`: dust vs cloud vs rain vs fault logic, rand loss, payback, cleaning methods per dust type
- `src/data.js`: Firebase and demo simulator behind the same functions
- `src/config.js`: your Firebase config; demo mode until filled in
- `firmware/sedigrid_node/sedigrid_node.ino`: ESP32 two-panel node
- `firestore.rules`: hackathon rules (no login; add Firebase Auth before real customers)

The firmware has not been compiled here (the ESP32 toolchain download was blocked), so expect to fix small things on first upload.
