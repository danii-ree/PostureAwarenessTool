# Posture vest review — 2026-11-04

[VERIFIED] All 18 original archive files were read; the original ZIP remains unchanged and the corrected project is in `posture-vest/`.

[DESK-CHECKED] Evidence labels: VERIFIED means executed or observed; DESK-CHECKED means source/API review, including recommendations; ASSUMED identifies an untested premise.

[DESK-CHECKED] Five-line system summary:
1. [DESK-CHECKED] The UNO R4 WiFi reads MPU6050 accelerometer angles against a user calibration saved in EEPROM.
2. [DESK-CHECKED] Posture outside tolerance starts a two-pulse vibration cue after a delay, with a 200/255 PWM cap and a 30-second posture-cue interval.
3. [DESK-CHECKED] The vest queues minute summaries in RAM and uploads them while receiving settings and recalibration requests.
4. [DESK-CHECKED] A Next.js client uses password-issued HMAC bearer tokens to view hourly history, edit settings, request calibration, and export history.
5. [DESK-CHECKED] The server persists hourly totals plus settings/status in JSON and daily backups; the original archive omits the delete endpoint used by the UI.

## A. Findings, ordered by severity

[DESK-CHECKED] File/line references below identify **original archive lines** unless explicitly marked “current”; original source copies are in `original-web/`, `original-firmware/`, and `original-README.md` beside this report.

### Critical

1. [VERIFIED] **Dependency audit remains unresolved** — `web/package.json:3`: npm installed Next.js **14.2.35** and reports **2 vulnerabilities (1 high, 1 critical)**, with Next.js rated critical and transitive PostCSS rated high; see [full audit](npm-audit.json). [DESK-CHECKED] The critical advisories include Windows-hosted RCE and image-optimizer conditions; this audit does **not** prove those paths are exploitable in this Linux prototype. [DESK-CHECKED] Next.js lists 14 as unsupported in its [support policy](https://nextjs.org/support-policy); its [App Router DoS advisory](https://github.com/vercel/next.js/security/advisories/GHSA-q4gf-8mx6-v5v3) also includes 14. [DESK-CHECKED] The smallest durable dependency fix requires moving to a currently patched supported Next.js release and retesting; I left the requested Next.js 14 prototype intact rather than silently performing a major upgrade.

### Major

2. [DESK-CHECKED] **PWM can remain on through blocking sensor I/O** — `firmware/posture_vest/posture_vest.ino:176` and `:181`: the original loop starts/updates PWM before I2C reads; installed Wire 1.2.0 can wait up to 1,000 ms for an I2C transaction, extending a nominal 300 ms pulse. [DESK-CHECKED] Fixed by holding PWM at zero throughout sensor transactions and restoring it only if the scheduled pulse has not expired. [DESK-CHECKED] Network sync already stopped PWM in the original minute branch; the fix also stops it at network entry points. [ASSUMED] A CPU freeze or shorted driver can still leave a physical motor running; software alone cannot guarantee a hard cutoff.

3. [DESK-CHECKED] **The original cooldown is bypassable through recalibration** — firmware `:87`, `:149`, `:173`, `:187`, `:191`: the 30-second check originally applied only to posture cues; website recalibration and button holds could start calibration buzz sequences without it, and sensor-fault buzzes used a separate clock. [DESK-CHECKED] Fixed by sharing `lastCue` for calibration/fault/posture sequence starts and handling one calibration per button hold. [DESK-CHECKED] Short pulses within a calibration acknowledgment or a two-pulse posture sequence are intentionally less than 30 seconds apart; the interval applies to **sequence starts**, not individual pulses. [DESK-CHECKED] `MAX_STRENGTH=200` and `COOLDOWN_MS=30000` are unchanged.

4. [VERIFIED] **Deletion is missing** — `web/app/page.js:80`: the original UI calls `/api/data`, but the archive contains no such route; baseline tests return 404. [DESK-CHECKED] The UI previously announced success even for HTTP errors. [VERIFIED] Added authenticated deletion, removal of the local daily backup history, and error checking; deletion/export/auth tests now pass. [DESK-CHECKED] Settings and device status remain, externally managed backups are outside this endpoint, and offline vest summaries can upload afterward.

5. [VERIFIED] **Storage loses concurrent writes** — `web/app/api/config/route.js:4`: delaying `req.json()` while uploading a row reproduces a lost row because configuration loads before the await. [DESK-CHECKED] `web/lib/store.js:14` also uses one fixed temporary filename across processes, and atomic rename does not make the whole read/modify/write transactional. [VERIFIED] Fixed with parse-before-transaction, an exclusive directory lock around mutations, and unique temporary files; 20 concurrent direct uploads, 25 production HTTP uploads, and 4 processes performing 40 total updates preserve all expected increments. [DESK-CHECKED] Lock ownership assumes an ordinary shared local filesystem; a crash leaves a stale lock, so stop all writers before removing it. [DESK-CHECKED] Contention times out after two seconds and fails the request instead of accepting a lost write; this is not a distributed storage solution or an fsync/power-loss durability guarantee.

6. [VERIFIED] **Sync uses chunked HTTP** — `web/app/api/device/sync/route.js:17`: the running production server replies `Transfer-Encoding: chunked` and has no Content-Length; see [captured response](fixed-sync.http). [DESK-CHECKED] Firmware `:114` and `:129` originally copied the wire body without decoding chunks and accepted truncated responses with a 200 status, then cleared queued rows; a single chunk can happen to work with substring parsing, but a key/value split across chunks fails. [DESK-CHECKED] The supplied code actually had **`resp[160]`**, plus a 1,200-byte header-and-body buffer, rather than a 400-byte response buffer. [VERIFIED] Added chunk decoding and framing/bounds checks, made the body buffer 400 bytes including its NUL terminator, and passed 13 host cases plus the actual captured reply. [DESK-CHECKED] Oversized headers/chunk framing beyond the 1,199-byte raw limit, oversized bodies, unsupported transfer coding/trailers, and incomplete framing fail closed and retain the queue; proxies may require a larger raw limit, subject to SRAM measurement.

7. [DESK-CHECKED] **Retry accounting is not idempotent** — firmware `:143` and API `device/sync/route.js:10`: if the server commits an upload but its response is lost, the vest retries the rows and the server adds them twice. [DESK-CHECKED] The 40-entry RAM queue also drops oldest summaries after roughly 40 tracked minutes offline and disappears on reset. [DESK-CHECKED] These remain limitations; an eventual fix needs a non-personal batch sequence/acknowledgment protocol and bounded deduplication state, not raw motion or user identifiers. [DESK-CHECKED] Hour assignment uses the minute row's closing timestamp; a minute spanning an hour boundary is assigned wholly to the closing hour.

8. [VERIFIED] **Blocked localStorage crashes the original page** — `web/app/page.js:28`: injecting a storage `SecurityError` produces the Next.js client exception screen. [VERIFIED] The corrected page shows sign-in when storage is blocked and keyboard login still works. [DESK-CHECKED] Initial `token=null` is consistent between prerendering and the first client render; the token check occurs in an effect, so it is not itself a hydration mismatch. [VERIFIED] No hydration mismatch appeared in tested browser logs. [DESK-CHECKED] With JavaScript unavailable the initial page remains empty; no offline/PWA manifest or service worker was supplied.

9. [VERIFIED] **Null input crashes route handlers** — login `route.js:5`, config `route.js:5`, device sync `route.js:8`: baseline tests raise `TypeError: Cannot read properties of null (reading 'password')`. [VERIFIED] Normalizing object bodies and skipping null rows fixes the regression tests. [DESK-CHECKED] Malformed JSON still falls back to an empty object, and request bytes are not bounded before JSON parsing; put a small body-size limit at the reverse proxy and consider returning 400 for invalid schemas.

10. [DESK-CHECKED] **Calibration and elapsed-time accounting accept invalid conditions** — firmware `:79`, `:96`, `:164`, `:179`, `:186`: original EEPROM validity checked only magic, zero/implausible accelerometer vectors could calibrate, blocking time was assigned to the next posture sample, and `badSince` survived disabled tracking/sensor failures. [DESK-CHECKED] Fixed finite/range checks for EEPROM, a 0.8–1.2 g accelerometer magnitude check, filter reset for calibration, elapsed-sample capping, explicit bad-posture tracking reset, fresh time after button calibration, and circular roll difference. [DESK-CHECKED] The original 30-sample minimum and 8-degree spread check remain; low-pass filtering can still hide motion, and plausible sensor/EEPROM corruption is not detected by these checks. [ASSUMED] The added acceleration range needs validation against actual mounting and expected movements.

11. [DESK-CHECKED] **Persistent local disk is required** — `web/lib/store.js:5`, `:13`; `README.md:21`: read-only deployments reject writes; ephemeral deployments lose data at instance replacement; multiple isolated serverless instances disagree about history/settings/recalibration. [DESK-CHECKED] The smallest fix within the requested architecture is one service with a writable persistent volume, a common working directory, and all writers using the same local volume; no database was added. [DESK-CHECKED] Actual serverless deployment was not attempted. [DESK-CHECKED] Original `load()` masked corruption/permission errors as an empty database; it now defaults only for ENOENT and surfaces other errors.

### Minor

12. [VERIFIED] **Malformed token suffixes accepted** — `web/lib/store.js:32`: appending `.extra` to a valid token was accepted by every original protected route. [DESK-CHECKED] This requires possession of a valid token and is not a signature forgery bypass. [VERIFIED] Strict Bearer/token grammar now rejects suffixes, forged tokens, missing tokens, and correctly signed expired tokens on every protected route.

13. [VERIFIED] **Missing days parameter selected one day, not fourteen** — hours `route.js:5`, store `:21`: `Number(null)` became zero and clamped to one. [VERIFIED] The null/empty fallback now preserves the intended default and the regression test passes; out-of-range tolerance/delay/strength tests also pass.

14. [VERIFIED] **375 px layout/accessibility** — `web/app/page.js:15`, `:69`, `:99`, `:102`; CSS `:5`, `:16`: login and dashboard document widths are 375 px at a 375 px viewport, buttons wrap, Enter signs in, Tab reaches controls, and Chromium's accessibility tree names password/settings/buttons/charts. [VERIFIED] A chart-edge time label was visibly clipped and is fixed; the hourly chart now exposes numeric values in its accessible name; see [full mobile screenshot](fixed-full.png). [DESK-CHECKED] Native sliders/checkboxes retain standard keyboard behavior; an actual screen reader session and 200% text scaling were not run. [DESK-CHECKED] Corrected the chart's elapsed-hours indexing to use local clock hours across DST; a DST browser fixture was not run.

15. [VERIFIED] **Remaining browser messages** — `web/app/layout.js:4` and page password form: favicon request returns `404 (Not Found)`; Chromium recommends an optionally hidden username field for the password-only form. [DESK-CHECKED] No username collection was added; the form has an explicit password label. [VERIFIED] The original browser additionally warned that the password field was outside a form; the login form fix removes that warning.

16. [DESK-CHECKED] **Privacy wording and XSS exposure** — `web/app/page.js:107`, `layout.js:8`: the original “only hourly totals” wording omitted settings and status metadata, and loading Google Fonts contacted a third party. [DESK-CHECKED] Removed the external font request and corrected disclosure; no new data fields were added. [DESK-CHECKED] React text rendering is used, with no `dangerouslySetInnerHTML`, HTML injection, or user-controlled link/script URL found; this is source review, not a complete XSS penetration test. [DESK-CHECKED] A successful same-origin XSS could read the localStorage bearer token; an HttpOnly cookie session plus appropriate request-origin/CSRF controls would reduce that exposure.

### Security/privacy weaknesses and smallest reasonable fixes

| Evidence | Weakness and location (original) | Smallest reasonable fix; implementation status |
|---|---|---|
| DESK-CHECKED | Shared password, `api/login/route.js:5` | Use one strong random password for this single-user prototype and restrict access; separate accounts would be a later scope change. Not changed. |
| DESK-CHECKED | Shared device key, `api/device/sync/route.js:5`, `secrets.h:6` | Generate a long independent random key, keep it out of distributed source/logs, rotate on exposure; one key per vest only if multi-vest support is requested. Not changed; archive contains placeholders. |
| DESK-CHECKED | No login rate limit, `api/login/route.js:2` | Add a small global login rate/body-size limit at the reverse proxy; this need not store user/IP identifiers in the application. Not implemented/deployed. |
| DESK-CHECKED | Plain HTTP default, firmware `:22`, `:118`; `secrets.h:5` | Enable HTTPS at the website and compile with `USE_TLS`, using a matching hostname/port and provisioned trusted certificates; test failed certificate behavior. Normal build verified; TLS/hardware behavior unverified. |
| DESK-CHECKED | Seven-day stateless token, store `:27`, `:29` | Configure an independent random `SESSION_SECRET`, shorten token life in a later policy change, and rotate that secret for global revocation. Immediate per-token logout/revocation needs server session state; browser sign-out alone does not revoke copied tokens. Not changed. |
| DESK-CHECKED | localStorage token, page `:28`, `:51` | For internet deployment use an HttpOnly/Secure/SameSite cookie and add the corresponding CSRF/origin checks; the current minimal fix only handles storage exceptions. |
| DESK-CHECKED | File and backup exposure, store `:5`, `:14` | Keep data outside public assets, protect the persistent volume and external backups, run with a private service account; new primary file writes use mode 0600, and the new delete endpoint clears local backups. |
| VERIFIED | Dependency vulnerabilities, package `:3` | Full npm audit is saved; upgrade to a supported patched Next.js release before public deployment, retaining Next.js. No major upgrade applied. |

[VERIFIED] The production export contains exactly `hours`, `config`, `recal`, `lastSeen`, and `calibrated`. [DESK-CHECKED] **Posture history is only hourly `g/b/c` totals**, with hour timestamps; no raw angles, individual cue timestamps, names, location, or device identifiers are persisted by application code. [DESK-CHECKED] It is inaccurate to say that the *entire file* contains only hourly totals: settings, calibration/recalibration flags, and a millisecond last-connection timestamp are also stored; minute summaries remain in vest RAM until upload. [DESK-CHECKED] Infrastructure access logs and independent backups require a separate host review and were not verified.

### Executed checks and exact relevant output

[VERIFIED] Runtime: Node `v26.13.0`, npm `12.2.1`, installed Next.js `14.2.35`; no dependency was added for automated testing, and `package-lock.json` records the installation.

[VERIFIED] Initial sandbox `npm install` failed, and the permitted network retry succeeded:
```text
npm error code EAI_AGAIN
npm error syscall getaddrinfo
npm error errno EAI_AGAIN
npm error request to https://registry.npmjs.org/next failed, reason: getaddrinfo EAI_AGAIN registry.npmjs.org
npm error Log files were not written due to an error writing to the directory: /home/daniel/.npm/_logs

added 21 packages, and audited 22 packages in 16s
3 packages are looking for funding
2 vulnerabilities (1 high, 1 critical)
To address all issues (including breaking changes), run:
  npm audit fix --force
```
[VERIFIED] npm also offered an update from `12.2.1` to `12.2.2`; no global npm update or forced audit fix was performed.

[VERIFIED] Both original and final `APP_PASSWORD=review-password DEVICE_KEY=review-device-key npm run build` exited 0, compiled, linted/type-checked, and generated production output without build warnings; all API routes are marked `ƒ` dynamic, while `/` is prerendered. [VERIFIED] See [original build](baseline-build.log) and [final build](fixed-build.log). [DESK-CHECKED] Protected GET handlers already had `dynamic = 'force-dynamic'`; retained those declarations and added `Cache-Control: no-store` to successful API/export/sync responses. [VERIFIED] Production tests read current status following writes and confirm the no-store header.

[VERIFIED] Original sandbox `npm start` failed with:
```text
Error: listen EPERM: operation not permitted 0.0.0.0:3000
```
[VERIFIED] Permitted retries started both builds; the final server printed `✓ Ready in 307ms` in its first corrected run; see [final startup](fixed-start.log) for the last run's exact timing. [VERIFIED] One intermediate request returned 500 with `TypeError: (0 , s.Nv) is not a function` because I rebuilt `.next` while the original server was still running; stopping the old process and starting the completed build resolved this test-procedure error, and the final production suite passes. [VERIFIED] The intermediate log is preserved in `baseline-start-network.log` and `intermediate-sync.http`.

[VERIFIED] The initial `node --test` invocation reported only a file-level failure without individual assertion output; its cause was not established. [VERIFIED] Running the module directly exposes all `node:test` assertions and is now the `npm test` command; a final `node --test` invocation reports the file passing, but still summarizes only one file-level test rather than the 17 individual tests. [VERIFIED] Baseline and final outputs are saved, including failures:
```text
Baseline: tests 14, pass 5, fail 9
Final npm test: tests 17, pass 17, fail 0
Production HTTP: tests 3, pass 3, fail 0
sync Transfer-Encoding: chunked Content-Length: null
PASS: 13 HTTP parser cases plus captured Next.js chunked response
```
[VERIFIED] See [baseline route failures](baseline-tests.tap), [final route output](fixed-tests.tap), [production HTTP output](production-tests.tap), and [parser output](http-parser.log). [VERIFIED] The direct tests run source handlers with real Request/Response objects in a temporary data directory, resolving only the existing alias; production tests exercise compiled Next.js routes over HTTP.

[VERIFIED] `arduino-cli compile --fqbn arduino:renesas_uno:unor4wifi posture-vest/firmware/posture_vest` succeeds with installed **Arduino UNO R4 Boards 1.2.0**:
```text
Original: Sketch uses 77572 bytes (29%) of program storage space. Maximum is 262144 bytes.
Original: Global variables use 13404 bytes (40%) of dynamic memory, leaving 19364 bytes for local variables. Maximum is 32768 bytes.
Final: Sketch uses 78948 bytes (30%) of program storage space. Maximum is 262144 bytes.
Final: Global variables use 13404 bytes (40%) of dynamic memory, leaving 19364 bytes for local variables. Maximum is 32768 bytes.
```
[VERIFIED] No sketch compilation errors or warnings were printed in the successful runs; [final compile log](fixed-compile.log). [VERIFIED] Initial tool setup errors were `updating platform metadata: open /home/daniel/.arduino15/packages/arduino/hardware/avr/1.8.6/installed.json: read-only file system` and `Error during build: The instance is no longer valid and needs to be reinitialized`; permitting initialization and running `arduino-cli core list` resolved them. [DESK-CHECKED] Installed source confirms `WiFi.begin(const char*, const char*)`, WiFiClient/SSLClient host/port connect, Wire's address/quantity overload, EEPROM.get/put, and analogWrite match the sketch; EEPROM.put writes through this core without an AVR-style commit call. [DESK-CHECKED] WiFi.begin itself waits up to 10 seconds in this core before the sketch's additional 8-second loop, and connect/read calls can add blocking latency; the sketch's five-second response timer is not a bound on the entire sync operation.

[VERIFIED] Host parser test command:
```sh
g++ -Wall -Wextra -fsanitize=address,undefined review/http-parser.test.cpp -o /tmp/vest-http-test
ASAN_OPTIONS=detect_leaks=0 /tmp/vest-http-test review/fixed-sync.http
```
[VERIFIED] Address/undefined-behavior checks pass for the test cases; LeakSanitizer initially failed with `LeakSanitizer does not work under ptrace (strace, gdb, etc)` in this environment, so leak detection alone was disabled. [DESK-CHECKED] This does not simulate WiFiS3 delivery timing or hardware memory/stack usage.

## B. Changes made, as diffs

[VERIFIED] **Every changed/new implementation, test, lockfile, and README file is included in [changes.diff](changes.diff)**, generated against the untouched ZIP; no framework switch, database, extra runtime dependency, changed cap/cooldown value, or new application data field was introduced.

[DESK-CHECKED] One-sentence rationale for each changed file:

- [DESK-CHECKED] `web/lib/store.js`: serialize complete disk transactions, avoid temporary-name collisions, surface storage errors, normalize bodies/defaults, prevent caching, and strictly parse signed bearer tokens.
- [DESK-CHECKED] `web/app/api/config/route.js`: parse the request before reading/mutating the latest locked configuration and retain the existing clamps.
- [DESK-CHECKED] `web/app/api/device/sync/route.js`: commit hourly rows/status atomically, skip null rows, and mark sync replies no-store.
- [DESK-CHECKED] `web/app/api/data/route.js`: implement the missing authenticated deletion endpoint and purge local historical backups while preserving configuration/status.
- [DESK-CHECKED] `web/app/api/login/route.js`: normalize malformed/null bodies before checking the password.
- [DESK-CHECKED] `web/app/api/recalibrate/route.js`: persist the existing boolean handshake within a storage transaction.
- [DESK-CHECKED] `web/app/api/export/route.js`: prevent caching of downloaded private data.
- [DESK-CHECKED] `web/app/page.js`: survive unavailable storage, report request failures, use a login form, expose hourly values to assistive technology, fix edge-label clipping/local-hour indexing, release blob URLs, and correct tracking/privacy/calibration wording.
- [DESK-CHECKED] `web/app/layout.js`: remove the external Google Fonts request and use the existing system-font fallback.
- [DESK-CHECKED] `firmware/posture_vest/posture_vest.ino`: enforce unchanged PWM/cooldown limits at all relevant sequence starts, keep PWM off during blocking I/O, validate calibration, and correct stale posture/time/roll state.
- [DESK-CHECKED] `firmware/posture_vest/http_response.h`: decode bounded chunked, Content-Length, or completed close-delimited responses and reject incomplete/oversized framing.
- [DESK-CHECKED] `web/package.json`: expose the dependency-free route suite through `npm test`.
- [DESK-CHECKED] `web/package-lock.json`: lock the exact dependencies used for the recorded checks.
- [DESK-CHECKED] `web/test/routes.test.mjs`: test every handler's relevant behavior plus deterministic lost-update and multi-process regressions using isolated temporary data.
- [DESK-CHECKED] `web/test/http.test.mjs`: test the compiled production routes, authentication, actual sync framing, concurrent uploads, export, and deletion.
- [DESK-CHECKED] `review/browser-check.py`: make the 375 px layout, keyboard, accessibility-tree, console, and blocked-storage observations reproducible using installed ChromeDriver.
- [DESK-CHECKED] `review/http-parser.test.cpp`: verify split keys, chunk extensions/case, framing, capacity boundaries, truncation, and the actual Next.js reply on the host.
- [DESK-CHECKED] `README.md`: document test commands, destructive integration-test scope, storage-lock recovery, deletion limits, and remaining blocking/dependency risks.

## C. What remains unverified and real-hardware checks

[DESK-CHECKED] **Software safety result:** the website cannot configure more than 200/255 duty because API config clamps strength to 200, firmware clamps received settings again, and `motorWrite` clamps all writes; setup now explicitly uses 8-bit PWM. [DESK-CHECKED] Website settings contain no cooldown field; normal posture, calibration, and sensor-fault sequence starts now consult the same fixed 30,000 ms interval. [DESK-CHECKED] Website recalibration can still cause the designed acknowledgment buzzes even when posture buzzing is disabled; the enable setting is not a physical emergency stop. [DESK-CHECKED] Calibration acknowledgments are shorter-spaced pulses within one sequence, fault indication intentionally lasts one second, and restarting the board resets cooldown eligibility; none of these is a verified physical safety guarantee.

[DESK-CHECKED] Unsigned subtraction in sample, pulse, cooldown, calibration, connection, and row-age clocks handles ordinary 32-bit millis rollover when serviced within the relevant interval; replacing the `badSince==0` sentinel with a separate boolean avoids that particular wrap/start ambiguity. [DESK-CHECKED] A persistent bad-posture run spanning an entire 49.7-day counter cycle, the remaining button-down zero sentinel, and actual long-duration operation have not been hardware-tested. [DESK-CHECKED] Calibration/fault buzzes use blocking delay and no hardware cutoff/watchdog is provided; driver failure, firmware lockup during a buzz, incorrect supply, thermal load, or a different motor can exceed safe physical exposure despite a PWM cap.

- [DESK-CHECKED] **Bench first:** scope D9, motor current and supply voltage; verify 8-bit duty never exceeds 200/255 for forged/out-of-range API settings and repeated recalibration requests, and measure ≥30 seconds between independent sequence starts.
- [DESK-CHECKED] **Fault timing:** unplug/hold I2C, disconnect WiFi, black-hole TCP, send oversized/partial/split chunks, and power-cycle the AP; confirm PWM stays off during blocking operations and queues survive failed sync until their documented capacity/reset limits.
- [DESK-CHECKED] **Lost acknowledgments:** drop the HTTP response after server commit and measure duplicate accounting; similarly test repeated/pending/new calibration requests during lost acknowledgments, because the boolean handshake has no request generation ID.
- [DESK-CHECKED] **Posture timing:** verify good posture resets the delay, disable/enable does not reuse stale bad posture, sensor failures reset tracking, and blocking calibration/network time is not reported as measured posture time; test thresholds, roll wrap, inverted mounting, ordinary movement, and millis wrap with an injectable bench clock.
- [DESK-CHECKED] **Calibration/EEPROM:** test steady and moving calibration, disconnected/stuck/zero-vector sensor data, corrupted EEPROM floats/magic, power loss during write, calibration after reset, and repeated button holds; validate the 0.8–1.2 g check and inspect EEPROM endurance for the expected recalibration frequency.
- [DESK-CHECKED] **Electrical:** confirm motor-driver choice, gate/base bias and off state during reset, flyback diode orientation, supply/current ratings, thermal behavior, common ground, sensor module voltage compatibility, and motor EMI; the supplied wiring alone cannot establish these properties.
- [DESK-CHECKED] **TLS:** build the SSL variant, provision the proper trust certificate, and test expired/untrusted/mismatched certificates and actual deployed response header sizes; only the default plain-client firmware build was compiled here.
- [DESK-CHECKED] **Usability:** test on a real phone with the intended screen reader, large text/zoom, dark mode, unreliable networking, and keyboard/slider interaction; only Chromium headless keyboard traversal and accessibility-tree inspection were executed.
- [DESK-CHECKED] **Hosting:** verify a persistent writable local volume, private file/backup permissions, lock recovery after a killed writer, infrastructure logging/retention, backups/restores, HTTPS, proxy login/body limits, and behavior under disk full/corrupt JSON; no remote deployment, power-loss durability, or serverless host was tested.

[ASSUMED] No board, IMU, motor, driver, battery, or clinical comfort/safety specification was connected or available for this review; physical comfort and safe use duration remain unverified.

## D. Two-line AI-use log

[DESK-CHECKED] Tool/model: OpenAI Codex, GPT-6 family (exact model variant not exposed); date: 2026-11-04, America/Toronto.
[VERIFIED] Asked to read, review, test, minimally fix, and document the posture-vest Next.js/API and Arduino prototype, including security/privacy, HTTP parsing, motor safety, diffs, and hardware limitations.
