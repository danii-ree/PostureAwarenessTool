import { load, save, ready, same, clamp, deny, notReady } from '@/lib/store';
// The vest posts minute summaries here and gets its current settings back as plain text.
export async function POST(req) {
  if (!ready()) return notReady();
  if (!same(req.headers.get('x-device-key') || '', process.env.DEVICE_KEY)) return deny();
  const b = await req.json().catch(() => ({})), db = load(), now = Date.now();
  (Array.isArray(b.rows) ? b.rows : []).slice(0, 60).forEach(r => {
    const t = now - clamp(r.ago, 0, 604800, 0) * 1000, h = Math.floor(t / 3600000) * 3600;   // hour bucket, epoch seconds
    const e = db.hours[h] || (db.hours[h] = { g: 0, b: 0, c: 0 });
    e.g += clamp(r.g, 0, 60, 0); e.b += clamp(r.b, 0, 60, 0); e.c += clamp(r.c, 0, 50, 0);
  });
  if (b.recalDone) db.recal = 0;
  db.calibrated = b.cal ? 1 : 0; db.lastSeen = now;
  const cutoff = now / 1000 - 400 * 86400; Object.keys(db.hours).forEach(k => { if (k < cutoff) delete db.hours[k]; });
  save(db);
  const c = db.config;
  return new Response(`tol=${c.tol}\ndelay=${c.delay}\nint=${c.int}\nen=${c.en}\nrecal=${db.recal}\n`, { headers: { 'Content-Type': 'text/plain' } });
}
