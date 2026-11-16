/*
  ESP32 SOLAR PANEL MONITORING SYSTEM WITH FIREBASE

  Components:
  - ESP32
  - Two solar panels
  - Two voltage dividers
  - DHT11 temperature and humidity sensor
  - Active buzzer
  - Firebase Realtime Database

  Features:
  1. Measures both solar panel voltages.
  2. Calculates the voltage difference.
  3. Reads temperature and humidity from DHT11.
  4. Activates the buzzer when Panel 2 is dusty (8% below Panel 1 for 3 readings)
     or faulty, and not at night.
  5. Uploads sensor readings to Firebase (/solarMonitoring every 2 s,
     /solarHistory every 10 s).
  6. Silences the buzzer when the dashboard's "Silence buzzer" button is pressed
     (/control/buzzerMuted).
  7. Displays results in the Serial Monitor.

  Dashboard: https://sedigrid-dbef5.web.app/dashboard/
*/

#include <WiFi.h>
#include <Firebase_ESP_Client.h>
#include <DHT.h>

// ==================================================
// WIFI + FIREBASE CONFIGURATION
// ==================================================
// The Wi-Fi password and database secret live in secrets.h, which is
// NOT uploaded to GitHub. Copy secrets.example.h to secrets.h and fill it in.

#include "secrets.h"


// ==================================================
// PIN CONFIGURATION
// ==================================================

const int SOLAR_PANEL_1_PIN = 34;
const int SOLAR_PANEL_2_PIN = 35;

const int DHT_PIN = 15;
const int BUZZER_PIN = 23;

#define DHT_TYPE DHT11

DHT dht(DHT_PIN, DHT_TYPE);


// ==================================================
// FIREBASE OBJECTS
// ==================================================

FirebaseData fbdo;
FirebaseAuth auth;
FirebaseConfig config;


// ==================================================
// VOLTAGE DIVIDER CONFIGURATION
// ==================================================

// Update these values to match your physical resistors.

const float R1 = 10000.0;
const float R2 = 10000.0;

const float VOLTAGE_DIVIDER_RATIO = (R1 + R2) / R2;


// ==================================================
// MONITORING CONFIGURATION
// ==================================================

const float LOW_VOLTAGE_THRESHOLD = 1.0;      // Panel 1 below this = too dark to judge

// SediGrid alarm rules (same numbers as the dashboard):
// Panel 1 (GPIO34) is the clean reference, Panel 2 (GPIO35) is the dusty test panel.
const float SOILING_ALARM_PERCENT = 8.0;       // buzzer when Panel 2 is 8% below Panel 1...
const int   ALARM_CONFIRM_READINGS = 3;        // ...for 3 readings in a row
const float FAULT_RATIO = 0.10;                // Panel 2 under 10% of Panel 1 = wiring fault

const unsigned long READ_INTERVAL = 2000;
const unsigned long HISTORY_INTERVAL = 10000;  // one history record every 10 s

unsigned long previousMillis = 0;
unsigned long lastHistoryMillis = 0;


// ==================================================
// SENSOR VARIABLES
// ==================================================

float panel1Voltage = 0.0;
float panel2Voltage = 0.0;
float voltageDifference = 0.0;

float temperature = NAN;
float humidity = NAN;

bool lowVoltageAlarm = false;   // kept for older dashboards: true while the buzzer alarm is active

float soilingPercent = 0.0;
bool alarmActive = false;
bool buzzerMuted = false;       // set from the dashboard's "Silence buzzer" button
String alarmReason = "none";
int lowCount = 0;
int highCount = 0;


// ==================================================
// WIFI CONNECTION
// ==================================================

void connectWiFi() {

  Serial.println();
  Serial.print("Connecting to Wi-Fi");

  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  unsigned long startAttempt = millis();

  while (WiFi.status() != WL_CONNECTED &&
         millis() - startAttempt < 20000) {

    Serial.print(".");
    delay(500);
  }

  Serial.println();

  if (WiFi.status() == WL_CONNECTED) {

    Serial.println("Wi-Fi connected!");

    Serial.print("IP address: ");
    Serial.println(WiFi.localIP());

  } else {

    Serial.println("Wi-Fi connection failed.");
    Serial.println("Check your Wi-Fi credentials.");
  }
}


// ==================================================
// FIREBASE INITIALIZATION
// ==================================================

void initializeFirebase() {

  config.database_url = DATABASE_URL;

  // Authenticate using the legacy database secret.
  config.signer.tokens.legacy_token = DATABASE_SECRET;

  Firebase.begin(&config, &auth);

  Firebase.reconnectWiFi(true);

  Serial.println("Firebase initialized.");
}


// ==================================================
// READ SOLAR PANEL VOLTAGE
// ==================================================

float readSolarVoltage(int pin) {

  const int samples = 20;

  unsigned long totalMillivolts = 0;

  for (int i = 0; i < samples; i++) {

    totalMillivolts += analogReadMilliVolts(pin);

    delay(5);
  }

  float averageMillivolts =
      (float)totalMillivolts / samples;

  float adcVoltage = averageMillivolts / 1000.0;

  float solarVoltage =
      adcVoltage * VOLTAGE_DIVIDER_RATIO;

  return solarVoltage;
}


// ==================================================
// READ DHT11
// ==================================================

void readDHT11() {

  float newTemperature = dht.readTemperature();
  float newHumidity = dht.readHumidity();

  if (!isnan(newTemperature)) {
    temperature = newTemperature;
  }

  if (!isnan(newHumidity)) {
    humidity = newHumidity;
  }
}


// ==================================================
// UPDATE BUZZER
// ==================================================

void updateBuzzer() {

  bool wasActive = alarmActive;

  if (panel1Voltage < LOW_VOLTAGE_THRESHOLD) {

    // Too dark (night or heavy cloud): don't judge dust, and stop any alarm.
    soilingPercent = 0.0;
    lowCount = 0;
    alarmActive = false;
    alarmReason = "dark";

  } else {

    float ratio = panel2Voltage / panel1Voltage;
    soilingPercent = max(0.0f, (1.0f - ratio) * 100.0f);

    bool fault = ratio < FAULT_RATIO;
    bool dusty = soilingPercent >= SOILING_ALARM_PERCENT;

    lowCount  = (dusty || fault) ? lowCount + 1 : 0;
    highCount = (dusty || fault) ? 0 : highCount + 1;

    if (fault) {
      alarmActive = true;
      alarmReason = "fault";
    } else if (lowCount >= ALARM_CONFIRM_READINGS) {
      alarmActive = true;
      alarmReason = "dust";
    } else if (alarmActive && highCount >= ALARM_CONFIRM_READINGS) {
      alarmActive = false;
      alarmReason = "none";
    }
  }

  // A new alarm, or one that just cleared, resets the dashboard's silence button.
  if (alarmActive != wasActive) {
    buzzerMuted = false;
    if (Firebase.ready()) Firebase.RTDB.setBool(&fbdo, "/control/buzzerMuted", false);
  }

  lowVoltageAlarm = alarmActive;
  digitalWrite(BUZZER_PIN, (alarmActive && !buzzerMuted) ? HIGH : LOW);
}


// ==================================================
// READ "SILENCE BUZZER" FROM THE DASHBOARD
// ==================================================

void readMuteFromDashboard() {

  if (!alarmActive || buzzerMuted || !Firebase.ready()) return;

  if (Firebase.RTDB.getBool(&fbdo, "/control/buzzerMuted") && fbdo.boolData()) {
    buzzerMuted = true;
    digitalWrite(BUZZER_PIN, LOW);
    Serial.println(">> Buzzer silenced from the dashboard");
  }
}


// ==================================================
// DISPLAY READINGS
// ==================================================

void displayReadings() {

  Serial.println();
  Serial.println("========== SOLAR READINGS ==========");

  Serial.print("Panel 1 Voltage: ");
  Serial.print(panel1Voltage, 3);
  Serial.println(" V");

  Serial.print("Panel 2 Voltage: ");
  Serial.print(panel2Voltage, 3);
  Serial.println(" V");

  Serial.print("Voltage Difference: ");
  Serial.print(voltageDifference, 3);
  Serial.println(" V");

  Serial.println();
  Serial.println("=========== DHT11 DATA =============");

  if (!isnan(temperature)) {

    Serial.print("Temperature: ");
    Serial.print(temperature, 1);
    Serial.println(" C");

  } else {

    Serial.println("Temperature reading failed.");

  }

  if (!isnan(humidity)) {

    Serial.print("Humidity: ");
    Serial.print(humidity, 1);
    Serial.println(" %");

  } else {

    Serial.println("Humidity reading failed.");

  }

  Serial.println();
  Serial.println("=========== SYSTEM STATUS ==========");

  Serial.print("Soiling: ");
  Serial.print(soilingPercent, 1);
  Serial.println(" %");

  if (alarmActive) {

    Serial.print("ALARM: ");
    Serial.println(alarmReason);
    Serial.println(buzzerMuted ? "BUZZER: SILENCED" : "BUZZER: ON");

  } else {

    Serial.println(alarmReason == "dark" ? "Too dark to judge dust." : "Panels OK.");
    Serial.println("BUZZER: OFF");

  }

  Serial.println("====================================");
}


// ==================================================
// UPLOAD DATA TO FIREBASE
// ==================================================

void uploadToFirebase() {

  if (WiFi.status() != WL_CONNECTED) {

    Serial.println("Firebase upload skipped: Wi-Fi disconnected.");

    return;
  }

  if (!Firebase.ready()) {

    Serial.println("Firebase is not ready yet.");

    return;
  }

  // Create a JSON object for the sensor data.
  FirebaseJson json;

  json.set("panel1Voltage", panel1Voltage);
  json.set("panel2Voltage", panel2Voltage);

  json.set("voltageDifference", voltageDifference);

  // Leave temperature and humidity out when the DHT11 failed (the dashboard shows "–").
  if (!isnan(temperature)) {
    json.set("temperature", temperature);
  }

  if (!isnan(humidity)) {
    json.set("humidity", humidity);
  }

  json.set("soilingPercent", soilingPercent);
  json.set("alarmActive", alarmActive);
  json.set("alarmReason", alarmReason);
  json.set("lowVoltageAlarm", lowVoltageAlarm);

  json.set("buzzerStatus",
           (alarmActive && !buzzerMuted) ? "ON" : "OFF");

  json.set("timestampMillis", (double)millis());

  // Real date and time, filled in by Firebase's server.
  json.set("updatedAt/.sv", "timestamp");

  // Upload all readings to one database node.
  if (Firebase.RTDB.setJSON(
        &fbdo,
        "/solarMonitoring",
        &json)) {

    Serial.println();
    Serial.println("Firebase upload successful!");

    Serial.print("Database path: ");
    Serial.println("/solarMonitoring");

  } else {

    Serial.println();
    Serial.println("Firebase upload FAILED!");

    Serial.print("Error: ");
    Serial.println(fbdo.errorReason());

  }

  // Every 10 s, also add one record to the history list the dashboard charts.
  if (millis() - lastHistoryMillis >= HISTORY_INTERVAL) {

    lastHistoryMillis = millis();

    FirebaseJson rec;
    rec.set("panel1Voltage", panel1Voltage);
    rec.set("panel2Voltage", panel2Voltage);
    if (!isnan(temperature)) rec.set("temperature", temperature);
    if (!isnan(humidity)) rec.set("humidity", humidity);
    rec.set("soilingPercent", soilingPercent);
    rec.set("alarmActive", alarmActive);
    rec.set("timestamp/.sv", "timestamp");

    if (!Firebase.RTDB.pushJSON(&fbdo, "/solarHistory", &rec)) {
      Serial.print("History upload failed: ");
      Serial.println(fbdo.errorReason());
    }
  }
}


// ==================================================
// SETUP
// ==================================================

void setup() {

  Serial.begin(115200);

  delay(1000);

  pinMode(SOLAR_PANEL_1_PIN, INPUT);
  pinMode(SOLAR_PANEL_2_PIN, INPUT);

  pinMode(BUZZER_PIN, OUTPUT);
  digitalWrite(BUZZER_PIN, LOW);

  analogReadResolution(12);

  analogSetPinAttenuation(
      SOLAR_PANEL_1_PIN, ADC_11db);

  analogSetPinAttenuation(
      SOLAR_PANEL_2_PIN, ADC_11db);

  dht.begin();

  Serial.println();
  Serial.println("====================================");
  Serial.println("SOLAR MONITORING + FIREBASE");
  Serial.println("====================================");

  connectWiFi();

  if (WiFi.status() == WL_CONNECTED) {
    initializeFirebase();
  }

  Serial.println();
  Serial.println("System initialization complete.");
  Serial.println();
}


// ==================================================
// MAIN LOOP
// ==================================================

void loop() {

  unsigned long currentMillis = millis();

  // Retry Wi-Fi connection if necessary.
  if (WiFi.status() != WL_CONNECTED) {

    static unsigned long lastWiFiRetry = 0;

    if (millis() - lastWiFiRetry >= 10000) {

      lastWiFiRetry = millis();

      Serial.println("Retrying Wi-Fi connection...");

      WiFi.reconnect();
    }
  }

  // Read sensors and upload data every 2 seconds.
  if (currentMillis - previousMillis >= READ_INTERVAL) {

    previousMillis = currentMillis;

    // Read both solar panels.
    panel1Voltage =
        readSolarVoltage(SOLAR_PANEL_1_PIN);

    panel2Voltage =
        readSolarVoltage(SOLAR_PANEL_2_PIN);

    // Calculate the voltage difference.
    voltageDifference =
        abs(panel1Voltage - panel2Voltage);

    // Read DHT11.
    readDHT11();

    // Update buzzer status, then check the dashboard's silence button.
    updateBuzzer();
    readMuteFromDashboard();

    // Display all measurements.
    displayReadings();

    // Upload readings to Firebase.
    uploadToFirebase();
  }
}