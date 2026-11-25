import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const DATA = path.join(process.cwd(), 'data'), FILE = path.join(DATA, 'posture.json'), BK = path.join(DATA, 'backups');
const DEFAULT = { hours: {}, config: { tol: 12, delay: 4, int: 150, en: 1 }, recal: 0, lastSeen: 0, calibrated: 0 };

// Read from disk on every request so separate route bundles never see stale data.
export function load() {
  try { return { ...DEFAULT, ...JSON.parse(fs.readFileSync(FILE, 'utf8')) }; } catch { return structuredClone(DEFAULT); }
}
export function save(db) {            // atomic write, plus one backup copy per day (last 7 kept)
  fs.mkdirSync(BK, { recursive: true });
  fs.writeFileSync(FILE + '.tmp', JSON.stringify(db)); fs.renameSync(FILE + '.tmp', FILE);
  const bk = path.join(BK, new Date().toISOString().slice(0, 10) + '.json');
  if (!fs.existsSync(bk)) { fs.copyFileSync(FILE, bk); fs.readdirSync(BK).sort().slice(0, -7).forEach(f => fs.unlinkSync(path.join(BK, f))); }
}

export const ready = () => Boolean(process.env.APP_PASSWORD && process.env.DEVICE_KEY);
export const same = (a, b) => { a = Buffer.from(String(a)); b = Buffer.from(String(b)); return a.length === b.length && crypto.timingSafeEqual(a, b); };
export const clamp = (v, lo, hi, d) => { v = Number(v); return Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : d; };
export const json = (data, status = 200) => Response.json(data, { status });
export const deny = () => new Response(null, { status: 401 });
export const notReady = () => json({ error: 'Set APP_PASSWORD and DEVICE_KEY on the server.' }, 500);

// Stateless login token: expiry + HMAC, so it survives restarts and works across routes.
const secret = () => process.env.SESSION_SECRET || process.env.DEVICE_KEY + '|' + process.env.APP_PASSWORD;
const sign = exp => crypto.createHmac('sha256', secret()).update(String(exp)).digest('hex');
export function makeToken() { const exp = Date.now() + 7 * 864e5; return exp + '.' + sign(exp); }
export function authed(req) {
  if (!ready()) return false;
  const [exp, sig] = (req.headers.get('authorization') || '').replace('Bearer ', '').split('.');
  return Boolean(exp && sig && Number(exp) > Date.now() && same(sig, sign(exp)));
}
