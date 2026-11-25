/*
  Posture vest firmware for the Arduino UNO R4 WiFi (built-in WiFi module).

  Wiring
    MPU6050 IMU  : SDA/SCL to the board's SDA/SCL pins, VCC, GND (I2C address 0x68)
    Motor        : D9 -> 1k resistor -> NPN transistor base / logic-level MOSFET gate.
                   Motor sits between the supply and the transistor, with a flyback
                   diode across it and a 0.1 uF cap at the motor.
    Button       : D2 to GND. Hold 1.5 s to calibrate.

  Cues
    2 pulses            : posture outside your calibrated range
    2 short pulses      : calibration saved
    3 short pulses      : calibration failed (moved too much or sensor problem)
    1 long pulse (1 s)  : sensor not responding, repeats once a minute
*/
#include <Wire.h>
#include <WiFiS3.h>
#include <EEPROM.h>
#include "secrets.h"

#ifdef USE_TLS
WiFiSSLClient net;
#else
WiFiClient net;
#endif

const uint8_t  MOTOR_PIN = 9, BTN_PIN = 2, MPU_ADDR = 0x68;
const uint8_t  MAX_STRENGTH = 200;        // hard cap, the app can never exceed this
const uint16_t SAMPLE_MS = 50, PULSE_MS = 300, GAP_MS = 150;
const uint32_t COOLDOWN_MS = 30000;       // minimum time between cues
const uint8_t  QMAX = 40;

// Settings (the web app can change these)
int  tolDeg = 12, delaySec = 4, strength = 150;
bool enabled = true;

// Calibration
struct Cal { uint32_t magic; float pitch; float roll; };
const uint32_t CAL_MAGIC = 0x50535431;
float baseP = 0, baseR = 0;
bool calibrated = false;

// Filtered accelerometer
float fax = 0, fay = 0, faz = 1; bool filterInit = false;

// Cue state
uint8_t cuePulses = 0; bool cueOn = false; unsigned long cueT = 0, lastCue = 0, lastFailCue = 0;

// Per-minute stats and offline queue
struct Row { uint8_t g, b, c; unsigned long closedAt; };
Row q[QMAX]; uint8_t qn = 0;
unsigned long goodMs = 0, badMs = 0, badSince = 0, minuteStart = 0, lastSample = 0, lastGoodRead = 0, lastWifiTry = 0;
uint8_t cues = 0; bool recalDonePending = false;

void motorWrite(uint8_t v) { analogWrite(MOTOR_PIN, v); }
void stopMotor() { cuePulses = 0; cueOn = false; motorWrite(0); }
uint8_t level() { return (uint8_t)min(max(strength, 0), (int)MAX_STRENGTH); }
void buzz(unsigned ms) { motorWrite(level()); delay(ms); motorWrite(0); }

void startCue(uint8_t n) { cuePulses = n; cueOn = false; cueT = 0; }
void updateCue() {
  if (!cuePulses && !cueOn) return;
  unsigned long now = millis();
  if (cueOn) {
    if (now - cueT >= PULSE_MS) { motorWrite(0); cueOn = false; cueT = now; }
  } else if (now - cueT >= GAP_MS) {
    motorWrite(level()); cueOn = true; cueT = now; cuePulses--;
  }
}

bool readAngles(float &pitch, float &roll) {
  Wire.beginTransmission(MPU_ADDR); Wire.write(0x3B);
  if (Wire.endTransmission(false) != 0) return false;
  if (Wire.requestFrom((int)MPU_ADDR, 6) != 6) return false;
  int16_t x = Wire.read() << 8 | Wire.read();
  int16_t y = Wire.read() << 8 | Wire.read();
  int16_t z = Wire.read() << 8 | Wire.read();
  float ax = x / 16384.0, ay = y / 16384.0, az = z / 16384.0;
  if (!filterInit) { fax = ax; fay = ay; faz = az; filterInit = true; }
  fax += 0.2 * (ax - fax); fay += 0.2 * (ay - fay); faz += 0.2 * (az - faz);
  pitch = atan2(-fax, sqrt(fay * fay + faz * faz)) * 57.2958;
  roll  = atan2(fay, faz) * 57.2958;
  return true;
}

bool calibrate() {
  stopMotor(); buzz(200); delay(2500);            // buzz, then 2.5 s to settle
  float sp = 0, sr = 0, minP = 999, maxP = -999, minR = 999, maxR = -999; int n = 0;
  unsigned long t0 = millis();
  while (millis() - t0 < 3000) {
    float p, r;
    if (readAngles(p, r)) { sp += p; sr += r; n++; minP = min(minP, p); maxP = max(maxP, p); minR = min(minR, r); maxR = max(maxR, r); }
    delay(SAMPLE_MS);
  }
  if (n < 30 || maxP - minP > 8 || maxR - minR > 8) {   // too much movement or no sensor
    for (int i = 0; i < 3; i++) { buzz(100); delay(100); }
    return false;
  }
  baseP = sp / n; baseR = sr / n; calibrated = true;
  Cal c = { CAL_MAGIC, baseP, baseR }; EEPROM.put(0, c);
  buzz(150); delay(150); buzz(150);
  return true;
}

void connectWiFi() {
  if (millis() - lastWifiTry < 30000 && lastWifiTry) return;
  lastWifiTry = millis();
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  unsigned long t0 = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - t0 < 8000) delay(200);
}

int httpPost(const char *path, const char *body, char *resp, size_t cap) {
  static char raw[1200];   // Next.js sends longer headers than a bare server
  net.stop();
  if (!net.connect(SERVER_HOST, SERVER_PORT)) return -1;
  net.print("POST "); net.print(path); net.print(" HTTP/1.1\r\nHost: "); net.print(SERVER_HOST);
  net.print("\r\nX-Device-Key: "); net.print(DEVICE_KEY);
  net.print("\r\nContent-Type: application/json\r\nConnection: close\r\nContent-Length: ");
  net.print(strlen(body)); net.print("\r\n\r\n"); net.print(body);
  size_t len = 0; unsigned long t0 = millis();
  while ((net.connected() || net.available()) && millis() - t0 < 5000)
    while (net.available() && len < sizeof raw - 1) raw[len++] = net.read();
  raw[len] = 0; net.stop();
  if (len < 12) return -2;
  int status = atoi(raw + 9);
  char *b = strstr(raw, "\r\n\r\n");
  strncpy(resp, b ? b + 4 : "", cap - 1); resp[cap - 1] = 0;
  return status;
}

int getVal(const char *s, const char *key, int def) { const char *p = strstr(s, key); return p ? atoi(p + strlen(key)) : def; }

void sync() {
  if (WiFi.status() != WL_CONNECTED) { connectWiFi(); if (WiFi.status() != WL_CONNECTED) return; }
  static char body[2000]; char resp[160];
  int n = snprintf(body, sizeof body, "{\"cal\":%d,\"recalDone\":%d,\"rows\":[", calibrated, recalDonePending);
  for (uint8_t i = 0; i < qn; i++)
    n += snprintf(body + n, sizeof body - n, "%s{\"ago\":%lu,\"g\":%u,\"b\":%u,\"c\":%u}",
                  i ? "," : "", (millis() - q[i].closedAt) / 1000, q[i].g, q[i].b, q[i].c);
  snprintf(body + n, sizeof body - n, "]}");
  if (httpPost("/api/device/sync", body, resp, sizeof resp) != 200) return;   // keep queue, retry next minute
  qn = 0; recalDonePending = false;
  tolDeg   = constrain(getVal(resp, "tol=", tolDeg), 5, 45);
  delaySec = constrain(getVal(resp, "delay=", delaySec), 1, 30);
  strength = constrain(getVal(resp, "int=", strength), 50, MAX_STRENGTH);
  enabled  = getVal(resp, "en=", 1) == 1;
  if (getVal(resp, "recal=", 0) == 1 && calibrate()) recalDonePending = true;
}

void pushRow() {
  if (goodMs + badMs < 1000) return;
  if (qn == QMAX) { memmove(q, q + 1, sizeof(Row) * (QMAX - 1)); qn--; }   // drop oldest
  q[qn++] = { (uint8_t)min(60UL, goodMs / 1000), (uint8_t)min(60UL, badMs / 1000), cues, millis() };
  goodMs = badMs = 0; cues = 0;
}

void setup() {
  pinMode(MOTOR_PIN, OUTPUT); motorWrite(0);
  pinMode(BTN_PIN, INPUT_PULLUP); pinMode(LED_BUILTIN, OUTPUT);
  Wire.begin(); Wire.beginTransmission(MPU_ADDR); Wire.write(0x6B); Wire.write(0); Wire.endTransmission();  // wake IMU
  Cal c; EEPROM.get(0, c);
  if (c.magic == CAL_MAGIC) { baseP = c.pitch; baseR = c.roll; calibrated = true; }
  minuteStart = lastSample = millis();
  connectWiFi();
}

void loop() {
  unsigned long now = millis();

  static unsigned long btnDown = 0;
  if (digitalRead(BTN_PIN) == LOW) { if (!btnDown) btnDown = now; else if (now - btnDown > 1500) { calibrate(); btnDown = 0; delay(500); } }
  else btnDown = 0;

  updateCue();

  if (now - lastSample >= SAMPLE_MS) {
    unsigned long dt = now - lastSample; lastSample = now;
    float p, r;
    if (readAngles(p, r)) {
      lastGoodRead = now;
      if (calibrated && enabled) {
        float dp = p - baseP, dr = r - baseR;
        if (sqrt(dp * dp + dr * dr) > tolDeg) {
          badMs += dt; if (!badSince) badSince = now;
          if (now - badSince >= delaySec * 1000UL && now - lastCue >= COOLDOWN_MS) { startCue(2); lastCue = now; cues++; }
        } else { goodMs += dt; badSince = 0; }
      }
    } else if (now - lastGoodRead > 2000 && now - lastFailCue > 60000) {
      lastFailCue = now; stopMotor(); buzz(1000);
    }
  }

  digitalWrite(LED_BUILTIN, calibrated && (now - lastGoodRead < 2000) ? HIGH : (now / 250) % 2);

  if (now - minuteStart >= 60000) { minuteStart = now; pushRow(); stopMotor(); sync(); }
}
