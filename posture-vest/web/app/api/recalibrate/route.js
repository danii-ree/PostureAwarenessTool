import { update, authed, deny, json } from '@/lib/store';
export async function POST(req) {
  if (!authed(req)) return deny();
  await update(db => { db.recal = 1; }); return json({ ok: true });
}
