import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'vest-test-'));
process.chdir(temp);
process.env.APP_PASSWORD = 'test-password'; process.env.DEVICE_KEY = 'test-device-key'; process.env.SESSION_SECRET = 'test-session-secret';
const storeFile = path.join(temp, 'store.mjs');
fs.copyFileSync(path.join(root, 'lib/store.js'), storeFile);
const storeURL = pathToFileURL(storeFile).href;
const store = await import(storeURL);
const routes = {};
for (const name of ['login', 'config', 'hours', 'status', 'recalibrate', 'export', 'device/sync', 'data']) {
 const file = path.join(root, 'app/api', name, 'route.js');
 if (fs.existsSync(file)) { const target = path.join(temp, name.replaceAll('/', '-') + '.mjs'); fs.writeFileSync(target, fs.readFileSync(file, 'utf8').replaceAll("'@/lib/store'", JSON.stringify(storeURL))); routes[name] = await import(pathToFileURL(target).href); }
}
const token = store.makeToken();
const signed = exp => exp + '.' + crypto.createHmac('sha256', process.env.SESSION_SECRET).update(String(exp)).digest('hex');
const call = async (name, method, body, auth = token, extra = {}) => {
 const headers = { 'content-type': 'application/json', ...extra };
 if (auth !== null) headers.authorization = 'Bearer ' + auth;
 const req = new Request('http://localhost/api/' + name, { method, headers, ...(body === undefined ? {} : {body: JSON.stringify(body)}) });
 if (!routes[name]?.[method]) return new Response(null, { status: 404 });
 return routes[name][method](req);
};
const device = b => call('device/sync', 'POST', b, null, {'x-device-key': process.env.DEVICE_KEY});
const protectedRoutes = [['config','PUT'],['hours','GET'],['status','GET'],['recalibrate','POST'],['export','GET'],['data','DELETE']];
function reset() { store.save({ hours: {}, config: {tol:12,delay:4,int:150,en:1},recal:0,lastSeen:0,calibrated:0 }); }
after(() => { process.chdir(root); fs.rmSync(temp, {recursive:true,force:true}); });
test('login: correct, wrong, malformed JSON, missing configuration', async () => {
 assert.equal((await call('login','POST',{password:'wrong'},null)).status,401);
 const r = await call('login','POST',{password:process.env.APP_PASSWORD},null); assert.equal(r.status,200); assert.ok((await r.json()).token);
 assert.equal((await routes.login.POST(new Request('http://localhost', {method:'POST',body:'{'}))).status,401);
 const key = process.env.DEVICE_KEY; delete process.env.DEVICE_KEY;
 try { assert.equal((await call('login','POST',{},null)).status,500); } finally {process.env.DEVICE_KEY=key;}
});
for (const [name,method] of protectedRoutes) test(`${name}: rejects absent, forged, expired and extended tokens`, async () => {
 for (const auth of [null, '123.fake', signed(Date.now()-1000), token+'.extra']) assert.equal((await call(name,method,undefined,auth)).status,401);
});
test('device key check', async () => {
 for (const key of ['', 'wrong']) assert.equal((await call('device/sync','POST',{},null,{'x-device-key':key})).status,401);
 assert.equal((await device({})).status,200);
});
test('config clamps values and status reflects saved settings',async()=>{
 reset(); const r=await call('config','PUT',{tol:-100,delay:900,int:255,en:false}); assert.deepEqual(await r.json(),{tol:5,delay:30,int:200,en:0});
 assert.deepEqual((await (await call('status','GET')).json()).config,{tol:5,delay:30,int:200,en:0});
 assert.deepEqual(await (await call('config','PUT',{tol:900,delay:-10,int:-1,en:true})).json(),{tol:45,delay:1,int:50,en:1});
});
test('ago bucketing, summary clamps, retention and dynamic GETs',async()=>{
 reset(); const real=Date.now, now=Date.UTC(2026,10,4,12,0,30); Date.now=()=>now;
 try {
  await device({cal:1,rows:[{ago:0,g:80,b:-1,c:90},{ago:60,g:20,b:40,c:1}]});
  const h=store.load().hours; assert.deepEqual(h[now/1000-30],{g:60,b:0,c:50}); assert.deepEqual(h[now/1000-3630],{g:20,b:40,c:1});
  assert.equal((await (await call('hours','GET')).json()).length,2);
  for(const name of ['hours','status','export']) assert.equal(routes[name].dynamic,'force-dynamic');
 } finally {Date.now=real;}
});
test('recalibration remains pending until device acknowledges',async()=>{
 reset(); assert.equal((await call('recalibrate','POST')).status,200);
 assert.match(await (await device({cal:0})).text(),/recal=1/);
 assert.match(await (await device({cal:1,recalDone:1})).text(),/recal=0/);
 assert.equal(store.load().calibrated,1);
});
test('export and deletion remove history and backups but preserve settings',async()=>{
 reset(); await device({rows:[{g:30,b:20,c:1}]});
 const e=await call('export','GET'); assert.match(e.headers.get('content-disposition'),/attachment/); assert.equal(Object.keys((await e.json()).hours).length,1);
 assert.equal((await call('data','DELETE')).status,200); assert.deepEqual(store.load().hours,{}); assert.equal(store.load().config.int,150);
 for(const f of fs.readdirSync(path.join(temp,'data/backups'))) assert.deepEqual(JSON.parse(fs.readFileSync(path.join(temp,'data/backups',f))).hours,{});
});
test('concurrent config parse and upload preserve both writes',async()=>{
 reset(); let release; const gate=new Promise(r=>release=r);
 const req={headers:new Headers({authorization:'Bearer '+token}),json:async()=>{await gate;return {tol:20,delay:4,int:150,en:true};}};
 const pending=routes.config.PUT(req); await device({rows:[{g:40,b:20,c:1}]}); release(); await pending;
 assert.equal(Object.keys(store.load().hours).length,1); assert.equal(store.load().config.tol,20);
});
test('null JSON and null rows do not crash handlers',async()=>{
 assert.ok((await call('login','POST',null,null)).status<500);
 assert.ok((await call('config','PUT',null)).status<500);
 assert.ok((await device({rows:[null]})).status<500);
});

test('default days, numeric fallbacks, and expired history retention', async () => {
 reset(); const db=store.load(), now=Date.now();
 db.hours[Math.floor((now-2*864e5)/36e5)*3600]={g:10,b:0,c:0};
 db.hours[Math.floor((now-401*864e5)/36e5)*3600]={g:10,b:0,c:0}; store.save(db);
 assert.equal((await (await call('hours','GET')).json()).length,1);
 await device({}); assert.equal(Object.keys(store.load().hours).length,1);
 assert.deepEqual(await (await call('config','PUT',{tol:'bad',delay:'bad',int:'bad',en:true})).json(),{tol:12,delay:4,int:150,en:1});
});
test('concurrent uploads are all preserved', async () => {
 reset(); await Promise.all(Array.from({length:20},()=>device({rows:[{g:1,b:1,c:1}]})));
 assert.equal(Object.values(store.load().hours).reduce((n,h)=>n+h.g,0),20);
});

test('four processes share the disk transaction lock without losing writes', async () => {
 reset();
 const worker=path.join(temp,'worker.mjs');
 fs.writeFileSync(worker,`import {update} from ${JSON.stringify(storeURL)}; for(let i=0;i<10;i++) await update(db=>{const h=db.hours['1'] ||= {g:0,b:0,c:0};h.g++;});`);
 await Promise.all(Array.from({length:4},()=>new Promise((resolve,reject)=>{
  const child=spawn(process.execPath,[worker],{cwd:temp,stdio:['ignore','ignore','pipe']}); let errors=''; child.stderr.on('data',x=>errors+=x);
  child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(new Error(errors)));
 })));
 assert.equal(store.load().hours['1'].g,40);
});
