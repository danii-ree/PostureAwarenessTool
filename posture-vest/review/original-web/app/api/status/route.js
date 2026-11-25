import { load, authed, deny, json } from '@/lib/store';
export const dynamic = 'force-dynamic';
export async function GET(req) {
  if (!authed(req)) return deny();
  const { config, lastSeen, calibrated, recal } = load();
  return json({ config, lastSeen, calibrated, recal });
}
