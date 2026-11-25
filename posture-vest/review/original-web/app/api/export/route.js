import { load, authed, deny } from '@/lib/store';
export const dynamic = 'force-dynamic';
export async function GET(req) {
  if (!authed(req)) return deny();
  return new Response(JSON.stringify(load()), { headers: { 'Content-Type': 'application/json', 'Content-Disposition': 'attachment; filename="posture-data.json"' } });
}
