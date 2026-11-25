import { load, save, authed, deny, json, clamp } from '@/lib/store';
export async function PUT(req) {
  if (!authed(req)) return deny();
  const db = load(), c = db.config, b = await req.json().catch(() => ({}));
  db.config = { tol: clamp(b.tol, 5, 45, c.tol), delay: clamp(b.delay, 1, 30, c.delay), int: clamp(b.int, 50, 200, c.int), en: b.en ? 1 : 0 };
  save(db); return json(db.config);
}
