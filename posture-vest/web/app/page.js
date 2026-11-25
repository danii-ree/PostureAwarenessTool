'use client';
import { useState, useEffect, useRef, useCallback, useMemo } from 'react';

const dayKey = t => { const d = new Date(t * 1000); return d.getFullYear() + '-' + d.getMonth() + '-' + d.getDate(); };
const ago = ms => { const m = Math.round((Date.now() - ms) / 60000); return m < 1 ? 'just now' : m < 60 ? m + ' min ago' : m < 1440 ? Math.round(m / 60) + ' h ago' : Math.round(m / 1440) + ' days ago'; };

function Bars({ items, max, label }) {   // items: [{label, parts: [[value, color], ...]}]
  const w = 320 / items.length, h = 96;
  return (
    <svg viewBox="0 0 320 120" role="img" aria-label={label}>
      <line x1="0" x2="320" y1="96.5" y2="96.5" stroke="var(--line)" />
      {items.map((it, i) => { let y = h; return (
        <g key={i}>
          {it.parts.map(([v, c], j) => { const bh = v / max * h; y -= bh; return <rect key={j} x={i * w + 1.5} y={y} width={w - 3} height={bh} fill={c} />; })}
          {it.label !== '' && <text x={i === 0 ? 0 : i === items.length - 1 ? 320 : i * w + w / 2} y="112" textAnchor={i === 0 ? 'start' : i === items.length - 1 ? 'end' : 'middle'}>{it.label}</text>}
        </g>); })}
    </svg>
  );
}

export default function Home() {
  const [token, setToken] = useState(null);       // null = still checking storage, '' = signed out
  const [pw, setPw] = useState(''), [loginErr, setLoginErr] = useState(''), [msg, setMsg] = useState('');
  const [hours, setHours] = useState([]), [status, setStatus] = useState(null);
  const [form, setForm] = useState({ tol: 12, delay: 4, int: 150, en: true });
  const formLoaded = useRef(false);

  useEffect(() => { try { setToken(localStorage.getItem('pv_token') || ''); } catch { setToken(''); } }, []);
  const signOut = () => { try { localStorage.removeItem('pv_token'); } catch {} formLoaded.current = false; setToken(''); };
  const flash = t => { setMsg(t); setTimeout(() => setMsg(''), 3500); };

  const api = useCallback(async (method, url, body) => {
    const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: body ? JSON.stringify(body) : undefined });
    if (r.status === 401) { signOut(); throw new Error('auth'); }
    if (!r.ok) throw new Error('Request failed (' + r.status + ')');
    return r;
  }, [token]);

  const load = useCallback(async () => {
    try {
      const [h, s] = await Promise.all([api('GET', '/api/hours?days=15').then(r => r.json()), api('GET', '/api/status').then(r => r.json())]);
      setHours(h); setStatus(s);
      if (!formLoaded.current) { setForm({ ...s.config, en: !!s.config.en }); formLoaded.current = true; }   // never overwrite unsaved edits
    } catch (error) { if (error.message !== 'auth') setMsg('Could not load data. Please retry.'); }
  }, [api]);

  useEffect(() => { if (token) { load(); const i = setInterval(load, 60000); return () => clearInterval(i); } }, [token, load]);

  const action = fn => async () => { try { await fn(); } catch (error) { if (error.message !== 'auth') flash('Request failed. Please retry.'); } };

  async function login() {
    const r = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: pw }) });
    if (!r.ok) { setLoginErr(r.status === 401 ? 'That password is not right.' : 'Sign in failed. Please retry.'); return; }
    const { token: t } = await r.json(); try { localStorage.setItem('pv_token', t); } catch {} setPw(''); setLoginErr(''); setToken(t);
  }

  const { today, tg, tb, days } = useMemo(() => {
    const mid = new Date(); mid.setHours(0, 0, 0, 0); const m0 = mid.getTime() / 1000;
    const today = Array.from({ length: 24 }, () => ({ g: 0, b: 0 }));
    hours.filter(h => h.t >= m0).forEach(h => { const i = new Date(h.t * 1000).getHours(); if (today[i]) { today[i].g += h.g; today[i].b += h.b; } });
    const byDay = {}; hours.forEach(h => { const k = dayKey(h.t); byDay[k] = byDay[k] || { g: 0, b: 0 }; byDay[k].g += h.g; byDay[k].b += h.b; });
    const days = []; for (let i = 13; i >= 0; i--) { const d = new Date(); d.setDate(d.getDate() - i); const x = byDay[dayKey(d / 1000)];
      days.push({ label: d.getDate(), pct: x && x.g + x.b > 300 ? x.g / (x.g + x.b) : 0 }); }
    return { today, tg: today.reduce((s, x) => s + x.g, 0), tb: today.reduce((s, x) => s + x.b, 0), days };
  }, [hours]);

  if (token === null) return null;
  if (!token) return (
    <main>
      <h1>Posture progress</h1>
      <p className="muted">Enter the password for this vest.</p>
      <form onSubmit={e => { e.preventDefault(); action(login)(); }}>
      <label htmlFor="pw" className="muted">Password</label>
      <input id="pw" type="password" autoComplete="current-password" value={pw} onChange={e => setPw(e.target.value)} />
      <button type="submit">Sign in</button>
      </form>
      <p role="alert" className="err">{loginErr}</p>
    </main>
  );

  const set = k => e => setForm({ ...form, [k]: e.target.type === 'checkbox' ? e.target.checked : +e.target.value });
  const save = async () => { await api('PUT', '/api/config', form); flash('Settings saved. The vest picks them up within a minute.'); };
  const recal = async () => { await api('POST', '/api/recalibrate'); flash('Recalibration requested. Get into your target posture and hold still.'); load(); };
  const exportData = async () => { const b = await (await api('GET', '/api/export')).blob(); const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = 'posture-data.json'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); };
  const wipe = async () => { if (confirm('Delete all recorded posture data? This cannot be undone.')) { await api('DELETE', '/api/data'); flash('All data deleted.'); load(); } };

  return (
    <main>
      <h1>Today</h1>
      <p>{tg + tb < 60 ? 'No tracked time recorded yet today.' : `You held your target posture for ${Math.round(tg / (tg + tb) * 100)}% of ${Math.round((tg + tb) / 60)} minutes tracked.`}</p>
      <Bars label={'Posture by hour today: ' + today.map((x, i) => i + ':00, target ' + x.g + ' seconds, outside ' + x.b + ' seconds').join('; ')} max={3600} items={today.map((x, i) => ({ label: i % 6 === 0 ? i + ':00' : '', parts: [[x.g, 'var(--good)'], [x.b, 'var(--bad)']] }))} />
      <p className="muted"><span className="swatch" style={{ background: 'var(--good)' }} />Target posture <span className="swatch" style={{ background: 'var(--bad)', marginLeft: 14 }} />Outside target</p>

      <h2>Last 14 days</h2>
      <p className="muted">Share of tracked time spent in your target posture each day.</p>
      <Bars label={'Daily posture: ' + days.map(d => d.label + ': ' + Math.round(d.pct * 100) + '%').join(', ')} max={100} items={days.map(d => ({ label: d.label, parts: [[d.pct * 100, 'var(--good)']] }))} />

      <h2>Vest</h2>
      <p>{status ? (status.lastSeen ? 'Last heard from the vest ' + ago(status.lastSeen) + '. ' : 'The vest has not connected yet. ') + (status.calibrated ? 'It is calibrated.' : 'It is not calibrated yet.') + (status.recal ? ' Recalibration is waiting for the vest to check in (up to a minute).' : '') : ''}</p>
      <div className="btns"><button className="alt" onClick={action(recal)}>Recalibrate vest</button></div>
      <p className="muted" style={{ marginTop: 8 }}>Sit or stand in your best comfortable posture, then press the button. The vest buzzes once, waits 2.5 seconds for you to settle, then records for 3 seconds. Calibration may wait for the 30-second cooldown.</p>

      <h2>Settings</h2>
      <div className="row"><label htmlFor="tol">Allowed movement <output>{form.tol} degrees</output></label><input id="tol" type="range" min="5" max="45" value={form.tol} onChange={set('tol')} /></div>
      <div className="row"><label htmlFor="delay">Wait before buzzing <output>{form.delay} seconds</output></label><input id="delay" type="range" min="1" max="30" value={form.delay} onChange={set('delay')} /></div>
      <div className="row"><label htmlFor="int">Buzz strength <output>{Math.round(form.int / 2.55)}%</output></label><input id="int" type="range" min="50" max="200" value={form.int} onChange={set('int')} /></div>
      <div className="row"><label><span>Buzzing on</span><input type="checkbox" checked={form.en} onChange={set('en')} /></label></div>
      <div className="btns"><button onClick={action(save)}>Save settings</button></div>
      <p className="msg" role="status">{msg}</p>

      <h2>Your data</h2>
      <p className="muted">Posture history contains hourly totals of time in and out of target posture and number of buzzes. Settings, calibration status, and the last connection time are also stored. No name, location, or raw movement.</p>
      <div className="btns"><button className="alt" onClick={action(exportData)}>Download my data</button><button className="danger" onClick={action(wipe)}>Delete all data</button><button className="alt" onClick={signOut}>Sign out</button></div>
    </main>
  );
}
