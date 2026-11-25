#include <cassert>
#include <cmath>
#include "../posture_vest/posture_logic.h"
int main() {
  float p[4] = {20,20,20,20}, r[4] = {0,0,0,0};
  assert(postureSeverity(p,r) == 20); // straight-backed lean
  p[3] = 0; p[2] = 0; assert(postureSeverity(p,r) == 20); // upper-back bend
  p[0] = p[1] = 0; r[2] = -17; assert(postureSeverity(p,r) == 17);
  PostureTimer t;
  assert(!t.update(0, 20, 15, 30000));
  assert(!t.update(29999, 20, 15, 30000));
  assert(t.update(30000, 20, 15, 30000));
  assert(!t.update(59999, 20, 15, 30000));
  assert(t.update(60000, 20, 15, 30000));
  assert(!t.update(61000, 0, 15, 30000));
  assert(!t.update(62000, 20, 15, 30000)); // brief correction does not reset
  assert(t.update(90000, 20, 15, 30000));
  assert(!t.update(91000, 0, 15, 30000));
  assert(!t.update(93000, 0, 15, 30000));
  assert(!t.update(94000, 20, 15, 30000));
  assert(t.update(124000, 20, 15, 30000));
  t.reset();
  assert(!t.update(0xfffffff0U, 20, 15, 10000));
  assert(t.update(9984, 20, 15, 10000)); // millis rollover
}
