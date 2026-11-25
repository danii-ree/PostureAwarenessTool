import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const DATA = path.join(process.cwd(), 'data'), FILE = path.join(DATA, 'posture.json'), BK = path.join(DATA, 'backups');
const DEFAULT = { hours: {}, config: { tol: 12, delay: 4, int: 150, en: 1 }, recal: 0, lastSeen: 0, calibrated: 0 };

// Read from disk on every request so separate route bundles never see stale data.
export function load() {
  try { return { ...DEFAULT, ...JSON.parse(fs.readFileSync(FILE, 'utf8')) }; } catch (error) { if (error.code === 'ENOENT') return structuredClone(DEFAULT); throw error; }
}
export function save(db) {            // atomic write, plus one backup copy per day (last 7 kept)
  fs.mkdirSync(BK, { recursive: true });
  const tmp = FILE + '.' + crypto.randomUUID() + '.tmp';
  try { fs.writeFileSync(tmp, JSON.stringify(db), { mode: 0o600 }); fs.renameSync(tmp, FILE); }
  finally { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); }
  const bk = path.join(BK, new Date().toISOString().slice(0, 10) + '.json');
  if (!fs.existsSync(bk)) { fs.copyFileSync(FILE, bk); fs.readdirSync(BK).sort().slice(0, -7).forEach(f => fs.unlinkSync(path.join(BK, f))); }
}

// A disk lock protects the complete read/modify/write across route bundles/processes.
// A crash leaves the lock in place: remove it only after stopping every writer.
export async function update(change, purgeBackups = false) {
  fs.mkdirSync(DATA, { recursive: true });
  const lock = path.join(DATA, '.write-lock'), deadline = Date.now() + 2000;
  for (;;) {
    try { fs.mkdirSync(lock); break; }
    catch (error) {
      if (error.code !== 'EEXIST' || Date.now() >= deadline) throw error;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
  }
  try {
    const db = load(); change(db);
    if (purgeBackups && fs.existsSync(BK)) {
      for (const file of fs.readdirSync(BK)) fs.unlinkSync(path.join(BK, file));
    }
    save(db); return db;
  } finally { fs.rmdirSync(lock); }
}
export const readBody = async req => {
  const body = await req.json().catch(() => null);
  return body && typeof body === 'object' && !Array.isArray(body) ? body : {};
};

export const ready = () => Boolean(process.env.APP_PASSWORD && process.env.DEVICE_KEY);
export const same = (a, b) => { a = Buffer.from(String(a)); b = Buffer.from(String(b)); return a.length === b.length && crypto.timingSafeEqual(a, b); };
export const clamp = (v, lo, hi, d) => { if (v === null || v === undefined || v === '') return d; v = Number(v); return Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : d; };
export const json = (data, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
export const deny = () => new Response(null, { status: 401 });
export const notReady = () => json({ error: 'Set APP_PASSWORD and DEVICE_KEY on the server.' }, 500);

// Stateless login token: expiry + HMAC, so it survives restarts and works across routes.
const secret = () => process.env.SESSION_SECRET || process.env.DEVICE_KEY + '|' + process.env.APP_PASSWORD;
const sign = exp => crypto.createHmac('sha256', secret()).update(String(exp)).digest('hex');
export function makeToken() { const exp = Date.now() + 7 * 864e5; return exp + '.' + sign(exp); }
export function authed(req) {
  if (!ready()) return false;
  const match = /^Bearer ([0-9]+)\.([a-f0-9]{64})$/.exec(req.headers.get('authorization') || '');
  if (!match) return false;
  const [, exp, sig] = match;
  return Boolean(exp && sig && Number(exp) > Date.now() && same(sig, sign(exp)));
}
