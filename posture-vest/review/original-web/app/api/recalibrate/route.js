import { load, save, authed, deny, json } from '@/lib/store';
export async function POST(req) {
  if (!authed(req)) return deny();
  const db = load(); db.recal = 1; save(db); return json({ ok: true });
}
