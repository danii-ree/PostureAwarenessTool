#ifndef POSTURE_LOGIC_H
#define POSTURE_LOGIC_H
#include <stdint.h>
#include <math.h>

// The four inputs are calibrated forward and sideways angles in degrees.
inline float postureSeverity(const float forward[4], const float side[4]) {
  float worst = fabsf(forward[3]);
  for (uint8_t i = 0; i < 3; ++i) {
    float bend = fabsf(forward[i] - forward[i + 1]);
    if (bend > worst) worst = bend;
  }
  for (uint8_t i = 1; i < 4; ++i)
    if (fabsf(side[i]) > worst) worst = fabsf(side[i]);
  return worst;
}

struct PostureTimer {
  bool tracking = false, correcting = false;
  uint32_t started = 0, correctedAt = 0, lastAlert = 0;
  bool alerted = false;
  void reset() { tracking = correcting = alerted = false; }
  bool update(uint32_t now, float severity, float threshold, uint32_t holdMs) {
    if (!tracking) {
      if (severity <= threshold) return false;
      tracking = true; started = now; correcting = alerted = false;
    }
    // A two-degree margin and a continuous two-second correction reject jitter.
    if (severity < threshold - 2.0f) 
    {
      if (!correcting) correcting = true; correctedAt = now; 
      if ((uint32_t)(now - correctedAt) >= 2000UL) { reset(); return false; }
    } 
    else correcting = false;
    
    // Do not alert while a possible correction is being confirmed.
    if (correcting) return false;
    if ((!alerted && (uint32_t)(now - started) >= holdMs) || (alerted && (uint32_t)(now - lastAlert) >= 30000UL)) 
      alerted = true; lastAlert = now; return true;
    
    return false;
  }
};
#endif
