/*
  Standalone posture vest: four LIS3DH accelerometers through a TCA9548A.
  Channels 0-3: cervical, T1, T12, S1. Mount all boards with matching axes.
  D2: calibration button to GND (INPUT_PULLUP). D9: motor transistor driver.
  See README for wiring, voltage levels, settings and validation.

  Needs posture_logic.h (PostureTimer, postureSeverity) in the same folder.
  The Adafruit_LIS3DH library is no longer required: the sensors are
  read directly over I2C so that failed transfers are actually detected.
*/
#include <Wire.h>
#include <EEPROM.h>
#include "posture_logic.h"

// ---------- Hardware ----------
constexpr uint8_t MUX_ADDR     = 0x70;
constexpr uint8_t SENSOR_ADDR  = 0x18;
constexpr uint8_t MOTOR_PIN    = 9;
constexpr uint8_t BUTTON_PIN   = 2;
constexpr uint8_t SENSOR_COUNT = 4;

// LIS3DH registers
constexpr uint8_t REG_WHO_AM_I = 0x0F;
constexpr uint8_t REG_CTRL1    = 0x20;
constexpr uint8_t REG_CTRL4    = 0x23;
constexpr uint8_t REG_OUT_X_L  = 0x28;
constexpr uint8_t WHO_AM_I_ID  = 0x33;
constexpr uint8_t CTRL1_VALUE  = 0x47;  // 50 Hz, normal mode, X/Y/Z enabled
constexpr uint8_t CTRL4_VALUE  = 0x88;  // block data update, high resolution, +/-2 g

// ---------- Settings ----------
// Change these and upload again to adjust the vest without a computer connection.
constexpr float    THRESHOLD_DEG  = 15.0f;   // permitted: 5 to 30 degrees
constexpr uint32_t HOLD_MS        = 30000UL; // permitted: 10000 to 300000 milliseconds
constexpr uint8_t  MOTOR_STRENGTH = 150;     // PWM 0-200; confirm with your motor

static_assert(THRESHOLD_DEG >= 5.0f && THRESHOLD_DEG <= 30.0f, "THRESHOLD_DEG must be 5 to 30");
static_assert(HOLD_MS >= 10000UL && HOLD_MS <= 300000UL, "HOLD_MS must be 10000 to 300000");
static_assert(MOTOR_STRENGTH <= 200, "MOTOR_STRENGTH must be 0 to 200");

constexpr uint16_t PULSE_MS  = 300;
constexpr uint16_t GAP_MS    = 150;
constexpr uint16_t SAMPLE_MS = 50;

// ---------- Tuning ----------
constexpr float    FILTER_ALPHA     = 0.2f;   // low-pass weight of each new sample
constexpr float    MIN_MAGNITUDE_SQ = 0.64f;  // accepted |a|^2 range (0.8 g to 1.2 g)
constexpr float    MAX_MAGNITUDE_SQ = 1.44f;
constexpr uint8_t  CAL_SAMPLES      = 60;     // 3 seconds at 50 ms
constexpr float    CAL_MAX_DRIFT    = 4.0f;   // degrees of movement allowed while calibrating
constexpr uint32_t CAL_MAGIC        = 0x504f5332UL;

// ---------- State ----------
struct Calibration {
  uint32_t magic;
  float pitch[SENSOR_COUNT];
  float roll[SENSOR_COUNT];
};

struct FilteredSensor {
  float x, y, z;
  bool initialized;
};

Calibration cal;
FilteredSensor sensors[SENSOR_COUNT];
PostureTimer timer;

bool calibrated = false;
bool sensorsReady = false;
uint32_t lastSample = 0;
uint32_t lastRetry = 0;

uint8_t cueRemaining = 0;
bool cueOn = false;
uint32_t cueAt = 0;

// ---------- Motor cues ----------
void motorOff() {
  analogWrite(MOTOR_PIN, 0);
  cueOn = false;
  cueRemaining = 0;
}

void cue(uint8_t count) {
  motorOff();
  cueRemaining = count;
  cueAt = millis() - GAP_MS;  // start the first pulse immediately
}

void updateCue(uint32_t now) {
  if (cueOn && (uint32_t)(now - cueAt) >= PULSE_MS) {
    analogWrite(MOTOR_PIN, 0);
    cueOn = false;
    cueAt = now;
  } else if (!cueOn && cueRemaining && (uint32_t)(now - cueAt) >= GAP_MS) {
    analogWrite(MOTOR_PIN, MOTOR_STRENGTH);
    cueOn = true;
    --cueRemaining;
    cueAt = now;
  }
}

// ---------- I2C helpers ----------
bool selectSensor(uint8_t channel) {
  Wire.beginTransmission(MUX_ADDR);
  Wire.write((uint8_t)(1U << channel));
  return Wire.endTransmission() == 0;
}

bool writeReg(uint8_t reg, uint8_t value) {
  Wire.beginTransmission(SENSOR_ADDR);
  Wire.write(reg);
  Wire.write(value);
  return Wire.endTransmission() == 0;
}

// Reads len bytes starting at reg (auto-increment). Returns false on any I2C failure.
bool readRegs(uint8_t reg, uint8_t *buf, uint8_t len) {
  Wire.beginTransmission(SENSOR_ADDR);
  Wire.write((uint8_t)(reg | 0x80));  // set MSB for address auto-increment
  if (Wire.endTransmission(false) != 0) return false;
  if (Wire.requestFrom(SENSOR_ADDR, len) != len) return false;
  for (uint8_t i = 0; i < len; ++i) buf[i] = Wire.read();
  return true;
}

// ---------- Sensors ----------
bool initSensors() {
  for (uint8_t i = 0; i < SENSOR_COUNT; ++i) {
    uint8_t id;
    if (!selectSensor(i)) return false;
    if (!readRegs(REG_WHO_AM_I, &id, 1) || id != WHO_AM_I_ID) return false;
    if (!writeReg(REG_CTRL1, CTRL1_VALUE)) return false;
    if (!writeReg(REG_CTRL4, CTRL4_VALUE)) return false;
    sensors[i].initialized = false;
  }
  return true;
}

void tryInitSensors() {
  sensorsReady = initSensors();
  // Wait one full sample period so every sensor has produced real data.
  lastRetry = lastSample = millis();
}

bool readAngles(uint8_t i, float &pitch, float &roll) {
  uint8_t id, raw[6];
  if (!selectSensor(i)) return false;
  if (!readRegs(REG_WHO_AM_I, &id, 1) || id != WHO_AM_I_ID) return false;
  if (!readRegs(REG_OUT_X_L, raw, 6)) return false;

  // 12-bit left-justified two's complement; 1 mg per count in high-resolution +/-2 g mode.
  float a[3];
  for (uint8_t k = 0; k < 3; ++k) {
    int16_t v = (int16_t)((uint16_t)raw[2 * k] | ((uint16_t)raw[2 * k + 1] << 8));
    a[k] = (v >> 4) * 0.001f;
  }

  float magnitudeSq = a[0] * a[0] + a[1] * a[1] + a[2] * a[2];
  if (!isfinite(magnitudeSq) || magnitudeSq < MIN_MAGNITUDE_SQ || magnitudeSq > MAX_MAGNITUDE_SQ) {
    return false;
  }

  FilteredSensor &s = sensors[i];
  if (!s.initialized) {
    s.x = a[0]; s.y = a[1]; s.z = a[2];
    s.initialized = true;
  } else {
    s.x += FILTER_ALPHA * (a[0] - s.x);
    s.y += FILTER_ALPHA * (a[1] - s.y);
    s.z += FILTER_ALPHA * (a[2] - s.z);
  }

  pitch = atan2f(-s.x, sqrtf(s.y * s.y + s.z * s.z)) * RAD_TO_DEG;
  roll = atan2f(s.y, s.z) * RAD_TO_DEG;
  return isfinite(pitch) && isfinite(roll);
}

float difference(float angle, float reference) {
  float d = angle - reference;
  if (d > 180) d -= 360;
  else if (d < -180) d += 360;
  return d;
}

bool allAngles(float *p, float *r) {
  for (uint8_t i = 0; i < SENSOR_COUNT; ++i) {
    if (!readAngles(i, p[i], r[i])) return false;
  }
  return true;
}

// ---------- Calibration ----------
// Takes a stable three-second reference; the previous one is kept on failure.
bool calibrate() {
  motorOff();
  timer.reset();

  float sumP[SENSOR_COUNT] = {}, sumR[SENSOR_COUNT] = {};
  float firstP[SENSOR_COUNT] = {}, firstR[SENSOR_COUNT] = {};
  float p[SENSOR_COUNT], r[SENSOR_COUNT];

  for (uint8_t i = 0; i < SENSOR_COUNT; ++i) sensors[i].initialized = false;

  for (uint8_t n = 0; n < CAL_SAMPLES; ++n) {
    if (!allAngles(p, r)) { cue(3); return false; }
    for (uint8_t i = 0; i < SENSOR_COUNT; ++i) {
      if (n == 0) { firstP[i] = p[i]; firstR[i] = r[i]; }
      float dp = difference(p[i], firstP[i]);
      float dr = difference(r[i], firstR[i]);
      if (fabsf(dp) > CAL_MAX_DRIFT || fabsf(dr) > CAL_MAX_DRIFT) { cue(3); return false; }
      sumP[i] += dp;
      sumR[i] += dr;
    }
    delay(SAMPLE_MS);
  }

  cal.magic = CAL_MAGIC;
  for (uint8_t i = 0; i < SENSOR_COUNT; ++i) {
    cal.pitch[i] = firstP[i] + sumP[i] / CAL_SAMPLES;
    cal.roll[i] = firstR[i] + sumR[i] / CAL_SAMPLES;
  }
  EEPROM.put(0, cal);
  calibrated = true;
  cue(2);
  return true;
}

bool calibrationValid() {
  if (cal.magic != CAL_MAGIC) return false;
  for (uint8_t i = 0; i < SENSOR_COUNT; ++i) {
    if (!isfinite(cal.pitch[i]) || !isfinite(cal.roll[i])) return false;
    if (fabsf(cal.pitch[i]) > 180 || fabsf(cal.roll[i]) > 180) return false;
  }
  return true;
}

// ---------- Arduino entry points ----------
void setup() {
  pinMode(MOTOR_PIN, OUTPUT);
  motorOff();
  pinMode(BUTTON_PIN, INPUT_PULLUP);
  pinMode(LED_BUILTIN, OUTPUT);

  Wire.begin();
#if defined(WIRE_HAS_TIMEOUT)
  Wire.setWireTimeout(25000, true);
#endif

  EEPROM.get(0, cal);
  calibrated = calibrationValid();
  tryInitSensors();
}

void loop() {
  uint32_t now = millis();

  // Calibration button with 50 ms debounce.
  static bool pressed = false;
  static uint32_t buttonAt = 0;
  bool down = digitalRead(BUTTON_PIN) == LOW;
  if (down && !pressed && (uint32_t)(now - buttonAt) >= 50) {
    pressed = true;
    buttonAt = now;
    if (sensorsReady) calibrate();
    else cue(3);
  } else if (!down && pressed) {
    pressed = false;
    buttonAt = now;
  }

  now = millis();
  updateCue(now);

  // Retry sensor start-up every 2 seconds after a fault.
  if (!sensorsReady && (uint32_t)(now - lastRetry) >= 2000) {
    motorOff();
    tryInitSensors();
    now = millis();
  }

  if (sensorsReady && (uint32_t)(now - lastSample) >= SAMPLE_MS) {
    lastSample = now;
    float p[SENSOR_COUNT], r[SENSOR_COUNT];
    if (!allAngles(p, r)) {
      // Discard an uncertain interval; never let a sensor fault trigger an alert.
      timer.reset();
      motorOff();
      sensorsReady = false;
      lastRetry = now;
    } else if (calibrated) {
      for (uint8_t i = 0; i < SENSOR_COUNT; ++i) {
        p[i] = difference(p[i], cal.pitch[i]);
        r[i] = difference(r[i], cal.roll[i]);
      }
      if (timer.update(now, postureSeverity(p, r), THRESHOLD_DEG, HOLD_MS)) cue(2);
    }
  }

  // LED: solid when ready and calibrated, blinking otherwise.
  bool blinkPhase = (now / 250) % 2;
  digitalWrite(LED_BUILTIN, ((calibrated && sensorsReady) || blinkPhase) ? HIGH : LOW);
}
