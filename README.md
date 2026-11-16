# SediGrid

**IoT solar-panel dust monitoring for South Africa.**
*2nd Prize, MICT SETA National Skills Competition Hackathon, Free State (October 2026)*

Dust on solar panels quietly cuts their output, and in the Free State it builds up fast from mine tailings, farm soil and dry winters. Light rain and dew often make it worse instead of washing it off. SediGrid measures that loss on the panel itself, turns it into rand, and tells the owner when a clean is worth paying for.

**Live dashboard:** https://sedigrid-dbef5.web.app/dashboard/
**Simulation (no hardware needed):** https://sedigrid-dbef5.web.app/dashboard/?sim

## How it works

```
 Panel A (kept clean) ─┐
 Panel B (on array)  ──┼─►  ESP32  ──Wi-Fi──►  Firebase Realtime DB  ──►  Web dashboard
 DHT11 temp/humidity ──┘     │                       ▲                     │
                             ▼                       └──── Silence ────────┘
                          Buzzer
```

1. **Two panels, not one.** Clouds and sunset dim both panels equally. Only dust makes Panel B fall behind Panel A. Soiling % = 1 − (Panel B ÷ Panel A).
2. **Decisions at the edge.** The ESP32 averages 20 samples per reading and sounds the buzzer when Panel B is 8% below Panel A for 3 readings in a row. It flags a wiring fault when Panel B reads almost nothing, and it stays quiet at night.
3. **Cloud.** Readings go to Firebase every 2 seconds (`/solarMonitoring`), with a history point every 10 seconds (`/solarHistory`).
4. **Dashboard.** Shows both panels live, soiling %, temperature, humidity, the diagnosis, the rand lost per day, the right cleaning method for the dust type, and an alert log you can download as evidence.
5. **Two-way control.** Pressing **Silence buzzer** on the website writes `/control/buzzerMuted`. The ESP32 reads it and stops the buzzer on site.

## Hardware

| Part | ESP32 pin | Purpose |
|---|---|---|
| Panel A + 10k/10k voltage divider | GPIO34 | Clean reference panel |
| Panel B + 10k/10k voltage divider | GPIO35 | Test panel that collects dust |
| DHT11 | GPIO15 | Temperature and humidity (dew risk) |
| Active buzzer | GPIO23 | On-site alarm |

Prototype cost: about R600.

## Repository layout

| Folder | What's in it |
|---|---|
| `hardware/solar_monitor_firebase/` | Arduino sketch for the ESP32 node (Realtime Database version used at the hackathon) |
| `firmware/` | Earlier Firestore version of the node firmware |
| `site/` | Public website, live dashboard (`site/dashboard/`) and built app (`site/app/`) |
| `src/` | React + Vite source for the SediGrid app (sites, jobs, crew dispatch, verification) |
| `database.rules.json`, `firestore.rules` | Firebase security rules |
| `docs/SETUP.md` | Full setup guide for the app and the Firestore firmware |

## Run it yourself

**Dashboard and app**
```
npm install
npm run dev                                  # app on http://localhost:5173
firebase deploy --only hosting,database      # publish site, dashboard and rules
```

**ESP32 node**
1. Arduino IDE → Boards Manager → install **esp32 by Espressif**.
2. Library Manager → install **Firebase Arduino Client Library for ESP8266 and ESP32** (Mobizt) and **DHT sensor library** (Adafruit).
3. In `hardware/solar_monitor_firebase/`, copy `secrets.example.h` to `secrets.h` and fill in your Wi-Fi and Firebase details.
4. Board **ESP32 Dev Module**, choose the COM port, then **Upload**.

## Tech stack

ESP32 · Arduino (C++) · Firebase Realtime Database · Firestore · Firebase Hosting · React · Vite · JavaScript · HTML/CSS

## What's next

- Load resistors across each panel, since current reacts to dust more strongly than voltage
- A utility-grade node: calibrated reference cells, optical rain sensor, LTE-M, IP66 enclosure
- Logins, plus SMS/WhatsApp alerts to trained local cleaning crews
- A one-month pilot on the CUT Bloemfontein campus solar plant

## Team

Built at the MICT SETA National Skills Competition Hackathon, Central University of Technology, Bloemfontein, 29–30 October 2026.

- Lungile Saliwe ([@Lungile2203](https://github.com/Lungile2203))
- Masego More 
- Khababonina Tshabalala
- Tieho Phohleli
