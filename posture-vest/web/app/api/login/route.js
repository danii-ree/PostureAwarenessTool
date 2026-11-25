import { ready, same, makeToken, json, notReady, readBody } from '@/lib/store';
export async function POST(req) {
  if (!ready()) return notReady();
  const b = await readBody(req);
  if (!same(b.password || '', process.env.APP_PASSWORD)) return json({ error: 'Wrong password' }, 401);
  return json({ token: makeToken() });
}
