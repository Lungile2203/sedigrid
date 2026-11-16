/*
  SediGrid sensor node: two-panel ESP32 soiling sensor
  Wiring (see the SediGrid schematic):
    Test panel      -> R_L load + 12k/10k divider -> GPIO34
    Reference panel -> R_L load + 12k/10k divider -> GPIO35  (kept clean)
    Rain sensor AO  -> GPIO32
    DS18B20 DATA    -> GPIO4 (+4.7k pull-up to 3V3)   [optional]
    Relay IN        -> GPIO25, buzzer on relay NO

  What it does:
    - Learns the test/reference mismatch at power-up (both panels must be clean).
    - Every 2 s: soiling ratio = (test x calibration) / reference.
      Clouds dim both panels, so only dust moves the ratio.
    - Buzzer on when ratio stays below ALARM_RATIO for 3 readings; off above CLEAR_RATIO.
    - Every 5 s: writes the latest reading to Firestore  sites/SITE-001
      Every 60 s: adds a history point to              sites/SITE-001/readings
    - Reads alarm_muted from Firestore, so the app's "Silence buzzer" button works.
    - Press BOOT to recalibrate with clean panels.

  Arduino IDE: board "ESP32 Dev Module" (esp32 by Espressif 3.x).
  Libraries: ArduinoJson (Benoit Blanchon, v7). Optional: OneWire + DallasTemperature.
*/
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <time.h>

#define USE_DS18B20 0          // set to 1 if you wired the DS18B20 and installed its libraries
#if USE_DS18B20
#include <OneWire.h>
#include <DallasTemperature.h>
OneWire oneWire(4);
DallasTemperature tempSensor(&oneWire);
#endif

// ===================== EDIT THESE =====================
const char* WIFI_SSID     = "YOUR_PHONE_HOTSPOT";   // 2.4 GHz
const char* WIFI_PASS     = "YOUR_HOTSPOT_PASSWORD";
const char* FB_PROJECT_ID = "YOUR_PROJECT_ID";      // same as src/config.js in the app
const char* FB_API_KEY    = "YOUR_WEB_API_KEY";     // same as src/config.js in the app
const char* SITE_ID       = "SITE-001";
const bool  RELAY_ACTIVE_LOW = true;                // buzzer on at boot? set false
// ======================================================

const int PIN_TEST = 34, PIN_REF = 35, PIN_RAIN = 32, PIN_RELAY = 25, PIN_BOOT = 0;
const float DIVIDER = (12.0 + 10.0) / 10.0;         // undo the 12k/10k divider
const float ALARM_RATIO = 0.85, CLEAR_RATIO = 0.92; // buzzer thresholds
const float MIN_REF_V = 0.3;                        // too dark below this
const int   RAIN_WET_BELOW = 2500;                  // FC-37 analog: lower = wetter; tune on the day
const unsigned long SAMPLE_MS = 2000, PUSH_MS = 5000, HISTORY_MS = 60000;

float cal = 1.0;            // reference / test with both panels clean
float testV = 0, refV = 0, ratio = 1, tempC = NAN;
bool rainWet = false, alarmActive = false, muted = false;
int lowCount = 0, highCount = 0;
unsigned long lastSample = 0, lastPush = 0, lastHistory = 0, lastWifiTry = 0;

float readVolts(int pin) {
  long sum = 0;
  for (int i = 0; i < 20; i++) { sum += analogReadMilliVolts(pin); delay(2); }
  return (sum / 20.0) / 1000.0 * DIVIDER;
}

void setRelay(bool on) { digitalWrite(PIN_RELAY, (RELAY_ACTIVE_LOW ? !on : on) ? HIGH : LOW); }

void calibrate() {
  Serial.println("Calibrating: both panels clean and in the same light...");
  for (int i = 0; i < 3; i++) { setRelay(true); delay(80); setRelay(false); delay(150); }
  float t = 0, r = 0;
  for (int i = 0; i < 10; i++) { t += readVolts(PIN_TEST); r += readVolts(PIN_REF); delay(150); }
  if (t > 0.1 && r > MIN_REF_V) cal = r / t; else cal = 1.0;
  alarmActive = false; muted = false; lowCount = highCount = 0;
  Serial.printf("Calibration factor = %.3f (test %.2f V, ref %.2f V)\n", cal, t / 10, r / 10);
}

void sample() {
  testV = readVolts(PIN_TEST);
  refV = readVolts(PIN_REF);
  rainWet = analogRead(PIN_RAIN) < RAIN_WET_BELOW;
#if USE_DS18B20
  tempSensor.requestTemperatures(); tempC = tempSensor.getTempCByIndex(0);
#endif
  if (refV < MIN_REF_V) { Serial.println("Too dark to judge"); return; }
  ratio = (testV * cal) / refV;

  if (!alarmActive) {
    lowCount = ratio < ALARM_RATIO ? lowCount + 1 : 0;
    if (lowCount >= 3) { alarmActive = true; muted = false; highCount = 0; }
  } else {
    highCount = ratio > CLEAR_RATIO ? highCount + 1 : 0;
    if (highCount >= 3) { alarmActive = false; muted = false; lowCount = 0; }
  }
  setRelay(alarmActive && !muted);
  Serial.printf("test %.2f V | ref %.2f V | ratio %.0f%% | rain %s | alarm %s%s | WiFi %s\n",
    testV, refV, ratio * 100, rainWet ? "wet" : "dry", alarmActive ? "ON" : "off", muted ? " (muted)" : "",
    WiFi.status() == WL_CONNECTED ? "ok" : "--");
}

// ---------- Wi-Fi + Firestore REST ----------
void keepWifi() {
  if (WiFi.status() == WL_CONNECTED || millis() - lastWifiTry < 10000) return;
  lastWifiTry = millis(); WiFi.disconnect(); WiFi.begin(WIFI_SSID, WIFI_PASS);
}
String isoNow() {
  struct tm t; if (!getLocalTime(&t, 50)) return "";
  char b[30]; strftime(b, sizeof(b), "%Y-%m-%dT%H:%M:%SZ", &t); return String(b);
}
String siteUrl() {
  return String("https://firestore.googleapis.com/v1/projects/") + FB_PROJECT_ID +
         "/databases/(default)/documents/sites/" + SITE_ID;
}
int send(const char* method, const String& url, const String& body, String* resp = nullptr) {
  WiFiClientSecure c; c.setInsecure();   // hackathon shortcut: no certificate check
  HTTPClient h; h.setTimeout(4000); h.begin(c, url); h.addHeader("Content-Type", "application/json");
  int code = !strcmp(method, "GET") ? h.GET() : !strcmp(method, "PATCH") ? h.PATCH(body) : h.POST(body);
  if (resp) *resp = h.getString(); else if (code != 200) Serial.printf("Firestore %s -> %d %s\n", method, code, h.getString().c_str());
  h.end(); return code;
}
void pullMute() {
  String r;
  if (send("GET", siteUrl() + "?key=" + FB_API_KEY + "&mask.fieldPaths=alarm_muted", "", &r) != 200) return;
  JsonDocument d; if (deserializeJson(d, r)) return;
  if (alarmActive && (d["fields"]["alarm_muted"]["booleanValue"] | false) && !muted) { muted = true; setRelay(false); Serial.println("Silenced from the app"); }
}
void fields(JsonObject f, const String& ts, bool latest) {
  f["test_v"]["doubleValue"] = round(testV * 1000) / 1000.0;
  f["ref_v"]["doubleValue"]  = round(refV * 1000) / 1000.0;
  f["rain_wet"]["booleanValue"] = rainWet;
  if (!isnan(tempC)) f["temp_c"]["doubleValue"] = round(tempC * 10) / 10.0; else f["temp_c"]["nullValue"] = nullptr;
  if (latest) {
    f["alarm_active"]["booleanValue"] = alarmActive;
    f["alarm_muted"]["booleanValue"] = alarmActive && muted;
    f["source"]["stringValue"] = "esp32";
    if (ts.length()) f["updated_at"]["timestampValue"] = ts;
  } else if (ts.length()) f["at"]["timestampValue"] = ts;
}
void pushLatest() {
  const char* keys[] = {"test_v", "ref_v", "rain_wet", "temp_c", "alarm_active", "alarm_muted", "source", "updated_at"};
  String url = siteUrl() + "?key=" + FB_API_KEY;
  for (auto k : keys) url += String("&updateMask.fieldPaths=") + k;   // never touches the site's name, tariff etc.
  JsonDocument d; fields(d["fields"].to<JsonObject>(), isoNow(), true);
  String b; serializeJson(d, b); send("PATCH", url, b);
}
void pushHistory() {
  JsonDocument d; fields(d["fields"].to<JsonObject>(), isoNow(), false);
  String b; serializeJson(d, b); send("POST", siteUrl() + "/readings?key=" + FB_API_KEY, b);
}

void setup() {
  Serial.begin(115200);
  digitalWrite(PIN_RELAY, RELAY_ACTIVE_LOW ? HIGH : LOW);
  pinMode(PIN_RELAY, OUTPUT); setRelay(false);
  pinMode(PIN_BOOT, INPUT_PULLUP);
  analogReadResolution(12);
  analogSetPinAttenuation(PIN_TEST, ADC_11db); analogSetPinAttenuation(PIN_REF, ADC_11db); analogSetPinAttenuation(PIN_RAIN, ADC_11db);
#if USE_DS18B20
  tempSensor.begin();
#endif
  WiFi.mode(WIFI_STA); WiFi.begin(WIFI_SSID, WIFI_PASS); lastWifiTry = millis();
  configTime(0, 0, "pool.ntp.org", "time.google.com");
  delay(1500);
  calibrate();
}

void loop() {
  if (digitalRead(PIN_BOOT) == LOW) { delay(50); if (digitalRead(PIN_BOOT) == LOW) { calibrate(); while (digitalRead(PIN_BOOT) == LOW) delay(10); } }
  keepWifi();
  unsigned long now = millis();
  if (now - lastSample >= SAMPLE_MS) { lastSample = now; sample(); }
  if (WiFi.status() == WL_CONNECTED && now - lastPush >= PUSH_MS) {
    lastPush = now; pullMute(); pushLatest();
    if (now - lastHistory >= HISTORY_MS) { lastHistory = now; pushHistory(); }
  }
}
