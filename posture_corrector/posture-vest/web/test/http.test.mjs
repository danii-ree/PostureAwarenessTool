import {test} from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
const base=process.env.TEST_URL || 'http://127.0.0.1:3000';
const password=process.env.APP_PASSWORD, key=process.env.DEVICE_KEY;
let token;
async function req(route,method='GET',body,auth=token,deviceKey) {
 return fetch(base+'/api/'+route,{method,headers:{'content-type':'application/json',...(auth?{authorization:'Bearer '+auth}:{}),...(deviceKey?{'x-device-key':deviceKey}:{})},body:body===undefined?undefined:JSON.stringify(body)});
}
const device=b=>req('device/sync','POST',b,null,key);
test('production login, wrong password, forged and expired auth on every protected route',async()=>{
 assert.equal((await req('login','POST',{password:'wrong'},null)).status,401);
 const r=await req('login','POST',{password},null);assert.equal(r.status,200);token=(await r.json()).token;
 const exp=Date.now()-1000, secret=process.env.SESSION_SECRET || key+'|'+password;
 const expired=exp+'.'+crypto.createHmac('sha256',secret).update(String(exp)).digest('hex');
 for(const [route,method] of [['config','PUT'],['hours','GET'],['status','GET'],['export','GET'],['recalibrate','POST'],['data','DELETE']]) {
  for(const auth of [null,'forged',expired,token+'.extra'])assert.equal((await req(route,method,undefined,auth)).status,401,route);
 }
});
test('production device key, clamp, live uncached status, hourly upload and calibration',async()=>{
 assert.equal((await req('device/sync','POST',{},null,'wrong')).status,401);
 assert.equal((await req('data','DELETE')).status,200);
 let r=await req('config','PUT',{tol:999,delay:-9,int:999,en:true});assert.deepEqual(await r.json(),{tol:45,delay:1,int:200,en:1});
 const status=await req('status');assert.match(status.headers.get('cache-control'),/no-store/);assert.equal((await status.json()).config.int,200);
 assert.equal((await req('recalibrate','POST')).status,200);
 r=await device({cal:0,rows:[{ago:3700,g:30,b:30,c:1}]});assert.equal(r.status,200);assert.match(await r.text(),/recal=1/);
 console.log('sync Transfer-Encoding:',r.headers.get('transfer-encoding'),'Content-Length:',r.headers.get('content-length'));
 assert.match(await (await device({cal:1,recalDone:1})).text(),/recal=0/);
 const hours=await (await req('hours')).json();assert.equal(hours.length,1);assert.equal(hours[0].g,30);assert.ok(Math.abs(hours[0].t-Math.floor((Date.now()-3700e3)/36e5)*3600)<=3600);
 const after=await (await req('status')).json();assert.equal(after.recal,0);assert.equal(after.calibrated,1);
});
test('production concurrent uploads, export and delete',async()=>{
 assert.equal((await req('data','DELETE')).status,200);
 const replies=await Promise.all(Array.from({length:25},()=>device({rows:[{g:1,b:1,c:1}]})));assert.ok(replies.every(r=>r.status===200));
 const exported=await req('export');assert.match(exported.headers.get('content-disposition'),/attachment/);const db=await exported.json();assert.equal(Object.values(db.hours).reduce((n,h)=>n+h.g,0),25);
 assert.deepEqual(Object.keys(db).sort(),['calibrated','config','hours','lastSeen','recal']);
 assert.equal((await req('data','DELETE')).status,200);assert.deepEqual(await (await req('hours')).json(),[]);
 await req('config','PUT',{tol:12,delay:4,int:150,en:true});
});
