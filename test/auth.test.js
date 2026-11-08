import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createApp } from '../server/app.js';
import { createStore } from '../server/store.js';
import { validateEmail, validatePassword, hashPassword, verifyPassword } from '../server/auth.js';

const PASSWORD='Monetra test password with spaces!';
const NEW_PASSWORD='Another long Monetra password!';
async function setup(t,{store=createStore(':memory:'),...authOptions}={}) {
  const {server}=createApp({store,clock:()=> '2026-11-08',authOptions});server.listen(0,'127.0.0.1');await once(server,'listening');
  let closed=false;
  const close=async()=>{if(closed)return;closed=true;server.closeAllConnections();await new Promise(r=>server.close(r));store.close();};
  t.after(close);
  const base=`http://127.0.0.1:${server.address().port}`;
  const client=(initialCookie='')=>{
    let cookie=initialCookie,csrf='';
    const api=async(path,method='GET',body,headers={})=>{
      const response=await fetch(`${base}/api${path}`,{method,headers:{'X-Monetra-Request':'1',...(cookie?{Cookie:cookie}:{}),...(csrf?{'X-CSRF-Token':csrf}:{}),...(body===undefined?{}:{'Content-Type':'application/json'}),...headers},body:body===undefined?undefined:JSON.stringify(body)});
      const setCookie=response.headers.get('set-cookie');if(setCookie)cookie=setCookie.split(';')[0];const data=await response.json();if(Object.hasOwn(data,'csrfToken'))csrf=data.csrfToken;
      return {status:response.status,data,cookie,csrf,setCookie};
    };
    api.register=(email='alice@example.com',extra={})=>api('/auth/register','POST',{name:'Alice',email,password:PASSWORD,...extra});
    api.login=(email='alice@example.com',password=PASSWORD)=>api('/auth/login','POST',{email,password});
    api.cookie=()=>cookie;
    return api;
  };
  return {base,client,store,close};
}
test('email normalization and password validation',()=>{
  assert.equal(validateEmail(' Alice@Example.com '),'alice@example.com');
  for(const email of ['','bad','a@b','a..b@example.com','a.@example.com','a @example.com'])assert.throws(()=>validateEmail(email));
  for(const password of ['short','1'.repeat(15),'x'.repeat(129),'123456789012345'])assert.throws(()=>validatePassword(password));
  assert.equal(validatePassword('  long phrase with spaces  '),'  long phrase with spaces  ');
});
test('password hashes use random salt and verify without truncation',async()=>{
  const a=await hashPassword(PASSWORD),b=await hashPassword(PASSWORD);assert.notEqual(a,b);assert.match(a,/^scrypt\$/);assert.equal(await verifyPassword(PASSWORD,a),true);assert.equal(await verifyPassword(PASSWORD+'x',a),false);assert.equal(await verifyPassword('wrong',null),false);
});
test('anonymous requests and old UUID cookie cannot access private APIs',async t=>{
  const {client,store}=await setup(t),id=store.createUser();
  const a=client(`monetra_session=${id}`);assert.equal((await a('/state')).status,401);assert.equal((await a('/transactions','POST',{})).status,401);
  const session=await a('/auth/session');assert.equal(session.data.user,null);assert.equal(session.data.legacyAvailable,true);assert.equal(session.setCookie,null);
});
test('registration stores hashes and issues HttpOnly session separate from public user ID',async t=>{
  const {client,store}=await setup(t),a=client();const r=await a.register(' Alice@Example.com ',{remember:true});
  assert.equal(r.status,201);assert.equal(r.data.profile.email,'alice@example.com');assert.match(r.setCookie,/HttpOnly/);assert.match(r.setCookie,/SameSite=Strict/);assert.match(r.setCookie,/Max-Age=2592000/);assert.match(r.cookie,/monetra_session=[a-f0-9]{64}$/);assert.ok(!r.cookie.includes(r.data.profile.id));assert.ok(r.data.recoveryCode);assert.ok(r.data.csrfToken);
  const user=store.db.prepare('SELECT * FROM users WHERE id=?').get(r.data.profile.id);assert.notEqual(user.password_hash,PASSWORD);assert.ok(!JSON.stringify(r.data.profile).includes('hash'));assert.notEqual(user.recovery_hash,r.data.recoveryCode);
  const stored=store.db.prepare('SELECT token_hash FROM sessions').get();assert.ok(!r.cookie.includes(stored.token_hash));assert.equal((await a('/state')).status,200);
  assert.equal((await client().register('alice@example.com')).status,409);
});
test('login rotates session; wrong password is generic; same account sees data in another browser',async t=>{
  const {client}=await setup(t),a=client(),b=client();await a.register();
  await a('/transactions','POST',{name:'Private',amount:-125,category:'Продукты',occurredAt:'2026-11-01T12:00'});
  const bad=await b.login('alice@example.com','bad password value');const missing=await b.login('missing@example.com','bad password value');assert.equal(bad.status,401);assert.equal(bad.data.error,missing.data.error);
  assert.equal((await b.login('ALICE@example.com')).status,200);assert.equal((await b('/state')).data.transactions[0].name,'Private');
  const old=b.cookie();await b.login();assert.notEqual(b.cookie(),old);assert.equal((await client(old)('/state')).status,401);
  const c=client();await c.register('other@example.com');assert.equal((await c('/state')).data.transactions.length,0);
});
test('CSRF, origin, and fetch-metadata validation prevent cross-site mutations',async t=>{
  const {client}=await setup(t),a=client();await a.register();
  assert.equal((await a('/profile','PATCH',{name:'Bad'},{'X-CSRF-Token':''})).status,403);
  assert.equal((await a('/profile','PATCH',{name:'Bad'},{Origin:'https://evil.example'})).status,403);
  assert.equal((await a('/auth/login','POST',{email:'alice@example.com',password:PASSWORD},{'X-Monetra-Request':''})).status,403);
  assert.equal((await a('/state','GET',undefined,{'Sec-Fetch-Site':'cross-site'})).status,403);
  assert.equal((await a('/profile','PATCH',{name:'Good'})).status,200);
});
test('logout revokes only current session; logout all revokes every session',async t=>{
  const {client}=await setup(t),a=client(),b=client();await a.register();await b.login();const copied=a.cookie();
  const logout=await a('/auth/logout','POST',{});assert.equal(logout.status,200);assert.match(logout.setCookie,/Max-Age=0/);assert.equal((await client(copied)('/state')).status,401);assert.equal((await b('/state')).status,200);
  await a.login();await a('/auth/logout-all','POST',{});assert.equal((await b('/state')).status,401);
});
test('password change requires current password and revokes old sessions and recovery code',async t=>{
  const {client}=await setup(t),a=client(),b=client();const original=await a.register();await b.login();const old=a.cookie();
  assert.equal((await a('/auth/password','POST',{currentPassword:'wrong',newPassword:NEW_PASSWORD})).status,400);
  const change=await a('/auth/password','POST',{currentPassword:PASSWORD,newPassword:NEW_PASSWORD});assert.equal(change.status,200);assert.notEqual(change.cookie,old);assert.ok(change.data.recoveryCode);
  assert.equal((await b('/state')).status,401);assert.equal((await client(old)('/state')).status,401);assert.equal((await client().login()).status,401);assert.equal((await client().login('alice@example.com',NEW_PASSWORD)).status,200);
  assert.equal((await client()('/auth/recover','POST',{email:'alice@example.com',recoveryCode:original.data.recoveryCode,newPassword:PASSWORD})).status,401);
});
test('recovery codes reset password once and invalidate sessions without automatically logging in',async t=>{
  const {client}=await setup(t),a=client(),b=client();const registration=await a.register();await b.login();const code=registration.data.recoveryCode;
  const reset=await client()('/auth/recover','POST',{email:'alice@example.com',recoveryCode:code.toLowerCase(),newPassword:NEW_PASSWORD});assert.equal(reset.status,200);assert.ok(reset.data.recoveryCode);assert.equal(reset.setCookie,null);
  assert.equal((await a('/state')).status,401);assert.equal((await b('/state')).status,401);assert.equal((await client()('/auth/recover','POST',{email:'alice@example.com',recoveryCode:code,newPassword:PASSWORD})).status,401);assert.equal((await client().login('alice@example.com',NEW_PASSWORD)).status,200);
});
test('regenerating recovery code requires password and invalidates previous code',async t=>{
  const {client}=await setup(t),a=client();const original=await a.register();const result=await a('/auth/recovery-code','POST',{currentPassword:PASSWORD});assert.equal(result.status,200);assert.notEqual(result.data.recoveryCode,original.data.recoveryCode);
  assert.equal((await client()('/auth/recover','POST',{email:'alice@example.com',recoveryCode:original.data.recoveryCode,newPassword:NEW_PASSWORD})).status,401);
});
test('registration attaches only the current legacy anonymous profile with explicit consent',async t=>{
  const {client,store}=await setup(t),id=store.createUser();store.add(id,{name:'Keep me',amountMinor:-10000,category:'Продукты',occurredAt:'2026-11-01T12:00',note:'',recurring:false});
  const a=client(`monetra_session=${id}`);const registration=await a.register('migrate@example.com',{migrateLegacy:true});assert.equal(registration.data.profile.id,id);assert.equal(registration.data.transactions[0].name,'Keep me');
  assert.equal((await client(`monetra_session=${id}`)('/state')).status,401);
  assert.equal((await client(`monetra_session=${id}`).register('attacker@example.com',{migrateLegacy:true})).data.transactions.length,0);
});
test('account login rate limit is persisted and does not grow unbounded',async t=>{
  const {client,store}=await setup(t),a=client();await a.register();for(let i=0;i<10;i++)assert.equal((await a.login('alice@example.com','wrong password value')).status,401);
  assert.equal((await a.login()).status,429);assert.ok(store.db.prepare('SELECT COUNT(*) AS n FROM auth_limits').get().n<10);
});
test('sessions expire by idle and absolute deadlines',async t=>{
  let time=Date.now();const {client}=await setup(t,{now:()=>time});const a=client();await a.register();time+=2*3600000+1;assert.equal((await a('/state')).status,401);
  await a.login();time+=13*3600000;assert.equal((await a('/state')).status,401);
  await a('/auth/login','POST',{email:'alice@example.com',password:PASSWORD,remember:true});time+=6*86400000;assert.equal((await a('/state')).status,200);time+=8*86400000;assert.equal((await a('/state')).status,401);
});
test('production session cookies are Secure and public origin is explicit',async t=>{
  const {client}=await setup(t,{secureCookies:true,publicOrigin:'https://monetra.example'});const a=client();const r=await a.register();assert.match(r.setCookie,/; Secure/);
  assert.equal((await a('/profile','PATCH',{name:'Alice'},{Origin:'https://monetra.example'})).status,200);assert.equal((await a('/profile','PATCH',{name:'Alice'},{Origin:'http://monetra.example'})).status,403);
});
test('existing SQLite schema migrates without deleting records and sessions survive restart',async t=>{
  const dir=mkdtempSync(join(tmpdir(),'monetra-auth-')),file=join(dir,'db.sqlite');let store;
  const old=new DatabaseSync(file);old.exec("CREATE TABLE users (id TEXT PRIMARY KEY,name TEXT NOT NULL,reminder_days INTEGER NOT NULL DEFAULT 2); INSERT INTO users VALUES('old-profile','Old User',2)");old.close();
  store=createStore(file);assert.equal(store.user('old-profile').name,'Old User');assert.equal(store.user('old-profile').email,null);store.close();store=null;
  const first=createStore(file);const firstApp=await setup(t,{store:first});const a=firstApp.client();assert.equal((await a.register()).status,201);const cookie=a.cookie();await firstApp.close();
  const other=createStore(file);const secondApp=await setup(t,{store:other});assert.equal((await secondApp.client(cookie)('/state')).status,200);await secondApp.close();rmSync(dir,{recursive:true,force:true});
});
