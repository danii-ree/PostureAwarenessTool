import { load, authed, deny, json, clamp } from '@/lib/store';
export const dynamic = 'force-dynamic';
export async function GET(req) {
  if (!authed(req)) return deny();
  const since = Date.now() / 1000 - clamp(new URL(req.url).searchParams.get('days'), 1, 400, 14) * 86400;
  return json(Object.entries(load().hours).filter(([t]) => t >= since).map(([t, v]) => ({ t: +t, ...v })));
}
