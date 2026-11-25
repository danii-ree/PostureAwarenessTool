# Posture vest: firmware + Next.js website

Targets the **Arduino UNO R4 WiFi** (WiFi/Bluetooth module built in). On a classic Uno R3 you would need an add-on module and different network code.

```
firmware/posture_vest/   Arduino sketch (posture_vest.ino + secrets.h)
web/                     Next.js 14 (App Router): website + API route handlers
```

## Website (Next.js)
Needs Node 18.17 or newer.
```
cd web
npm install
cp .env.example .env.local      # then edit the password and device key
npm run dev                     # development
npm run build && npm start      # production
```
Open `http://<computer-ip>:3000` on a phone on the same network. Data is saved in `web/data/posture.json`, with a daily backup in `web/data/backups/` (last 7).

**Hosting:** the data is stored in a file, so host it somewhere with a persistent disk (a VPS, Raspberry Pi, Render or Fly with a volume). Vercel and other serverless hosts have no persistent disk, so you would need to swap `web/lib/store.js` for a database.

## Firmware
1. Install the **Arduino UNO R4 Boards** package in the Arduino IDE.
2. Edit `secrets.h`: WiFi name and password, the website host's IP address, port 3000, and the same `DEVICE_KEY` as `.env.local`.
3. Wire the IMU, motor driver and button as described at the top of `posture_vest.ino`, then upload.
4. Hold the button for 1.5 s in your target posture (or use "Recalibrate vest" on the website).

## Known limits
- The firmware has not been compiled or run on hardware. The website was built and its API tested with simulated requests.
- No wear detection. One shared password and one shared device key. Use HTTPS if you deploy.
- Vibration strength cap (200/255) and 30 s cooldown are placeholders to confirm with a clinician and the motor datasheet.
- Test EMI with the motor running (Task 1): it can disturb the I2C lines.
