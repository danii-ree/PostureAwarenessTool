# Standalone posture vest

The firmware follows the team's design portfolio: four MPU6050 accelerometer/gyroscope modules on the cervical spine, T1, T12 and S1, with an Arduino Uno, calibration button and vibration motor. The vest works without a computer or network. The existing Next.js website in `web/` is a separate earlier prototype; this firmware does not send data to it or accept its settings.

## Hardware and wiring

The sketch assumes a TCA9548A-compatible I²C multiplexer at address `0x70` and four MPU6050 boards at `0x68` (AD0 low), one on each multiplexer channel:

| Multiplexer channel | Position |
| --- | --- |
| 0 | Cervical / neck |
| 1 | T1 |
| 2 | T12 |
| 3 | S1 |

Connect the Uno SDA/SCL to the multiplexer upstream SDA/SCL and each accelerometer to its own downstream SDA/SCL pair. Share ground. Confirm power, pull-up voltages and logic levels for the actual breakout boards: a bare MPU6050 is a 3.3 V device and must not receive 5 V logic. Use compatible breakout boards or appropriate level shifting. Configure the multiplexer address pins for `0x70` and each sensor AD0 pin for `0x68`.

Mount all four sensors with the same axis directions. The angle formulas assume the positive Z axis points along gravity in the calibrated upright position; X and Y measure the two tilt directions. Verify forward and sideways readings with the installed orientation before use. Connect a normally open button from D2 to ground. Drive the vibration motor from D9 through a suitable transistor or MOSFET and a flyback diode; do not connect the motor directly to an Arduino pin. Use a suitable protected supply and common ground.

## Operation

1. Install the Arduino AVR Boards package, select **Arduino Uno**, and upload `firmware/posture_vest/posture_vest.ino`. Install **Adafruit MPU6050** in Arduino Library Manager, along with its dependencies **Adafruit Unified Sensor** and **Adafruit BusIO**. No Wi-Fi credentials are needed.
2. Sit in the intended reference posture, press the button and stay still for three seconds. Two vibration pulses indicate a saved reference; three indicate failure. The previous reference is retained if calibration fails. The reference is stored in EEPROM until recalibration. Recalibrate after switching from the LIS3DH firmware or changing sensor placement.
3. The LED is steady when calibration exists and all sensors are responding, and flashes otherwise. Sensor faults suspend detection and the firmware retries the sensors.
4. A deviation exceeding 15° for 30 seconds causes two pulses. Alerts repeat every 30 seconds while the deviation continues. Returning at least 2° below the threshold for two seconds resets the timer. The metrics are the three differences between neighboring forward angles, S1 forward lean, and the largest sideways tilt of T1, T12 or S1.

The constants near the top of the sketch set the threshold (5–30°), initial hold time (10 seconds–5 minutes) and motor strength. Change them and upload again to adjust them. The repeat interval is 30 seconds. These are firmware settings; there are no physical adjustment controls in this version.

## Verification and limitations

The portfolio describes a proposed design, not a tested device. Verify sensor orientation and accuracy against an inclinometer at 0°, 15°, 30° and 45°, and sideways at 15°. Test calibration, transient movement, the 30-second alert and two-second reset on the assembled vest. Confirm motor strength, power supply, battery protection, runtime and temperature on the actual hardware. Accelerometers cannot distinguish gravity from all movement, and the filter, thresholds and mounting require real-world tuning. This is an awareness prototype, not a medical device.

The firmware uses a short low-pass filter, and rejects implausible acceleration readings. If a sensor read fails, the current posture timer resets and monitoring resumes after reconnection. I²C timeout support depends on the board's Wire implementation. The library does not report errors from its individual acceleration data reads; the firmware checks device presence and rejects implausible values, but these checks cannot detect every read failure. The firmware uses the MPU6050 accelerometer for gravity-based tilt; it does not use the gyroscope for posture classification.

To run the host-side posture and timer checks:

```sh
g++ -std=c++11 -Wall -Wextra -pedantic firmware/test/posture_logic_test.cpp -o /tmp/posture-logic-test
/tmp/posture-logic-test
```
