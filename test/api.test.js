import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/app.js';
import { createStore } from '../server/store.js';

async function setup(t, store=createStore(':memory:')) {
  const {server}=createApp({store,clock:()=> '2026-11-01'});server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));store.close();});
  const base=`http://127.0.0.1:${server.address().port}`;
  let clientNumber=0;
  function client(){let cookie='',csrf='',registered=false;const number=++clientNumber;return async function api(path,method='GET',body){
    if(!registered){registered=true;await api('/auth/register','POST',{name:'Айгерим',email:`test-${number}@example.com`,password:'A long test password 2026!'});}
    const response=await fetch(base+'/api'+path,{method,headers:{'X-Monetra-Request':'1',...(body===undefined?{}:{'Content-Type':'application/json'}),...(cookie?{Cookie:cookie}:{}),...(csrf?{'X-CSRF-Token':csrf}:{})},body:body===undefined?undefined:JSON.stringify(body)});
    if(response.headers.get('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];const data=await response.json();if(data.csrfToken)csrf=data.csrfToken;return {status:response.status,data,cookie};};}
  return {client,store,base};
}
const payment=(date='2026-10-03T12:00',extra={})=>({name:'StreamBox',amount:-3000,category:'Подписки',occurredAt:date,...extra});

test('sample data loads idempotently and creates only unconfirmed suggestions',async t=>{
  const {client}=await setup(t),api=client();let {data}=await api('/samples','POST',{});assert.equal(data.transactions.length,15);assert.equal(data.suggestions.length,3);assert.equal(data.subscriptions.length,0);assert.equal(data.reminders.length,0);assert.equal(data.forecastTotal,0);
  ({data}=await api('/samples','POST',{}));assert.equal(data.transactions.length,15);
});
test('confirm, reject and correct suggestions persist with no duplicates',async t=>{
  const {client}=await setup(t),api=client();let {data}=await api('/samples','POST',{});const first=data.suggestions[0];
  let response=await api('/suggestions/review','POST',{key:first.key,action:'confirm',correction:{name:'Corrected service',price:3500.25,nextDate:'2026-11-02'}});
  assert.equal(response.status,200);assert.equal(response.data.subscriptions.length,1);assert.equal(response.data.reminders.length,1);assert.equal(response.data.forecastTotal,3500.25);assert.equal(response.data.subscriptions[0].name,'Corrected service');
  response=await api('/suggestions/review','POST',{key:first.key,action:'confirm'});assert.equal(response.status,409);
  const second=(await api('/state')).data.suggestions[0];await api('/suggestions/review','POST',{key:second.key,action:'reject'});
  ({data}=await api('/state'));assert.equal(data.suggestions.length,1);assert.equal(data.subscriptions.length,1);
});
test('invalid correction is atomic and leaves suggestion unconfirmed',async t=>{
  const {client}=await setup(t),api=client();const {data}=await api('/samples','POST',{});const key=data.suggestions[0].key;
  assert.equal((await api('/suggestions/review','POST',{key,action:'confirm',correction:{price:0,nextDate:'2026-02-30'}})).status,400);
  const state=(await api('/state')).data;assert.equal(state.subscriptions.length,0);assert.equal(state.suggestions.length,3);
});
test('category alone does not confirm recurrence; explicit repeat creates one schedule',async t=>{
  const {client}=await setup(t),api=client();await api('/transactions','POST',payment());assert.equal((await api('/state')).data.subscriptions.length,0);
  let {data}=await api('/transactions','POST',payment('2026-09-03T12:00',{recurring:true}));assert.equal(data.subscriptions.length,1);
  ({data}=await api('/transactions','POST',payment('2026-10-03T12:00',{recurring:true})));assert.equal(data.subscriptions.length,1);assert.equal(data.forecastTotal,3000);assert.equal(data.subscriptions[0].nextDate,'2026-11-03');
});
test('reminder preferences and cancelled schedule change forecast without deleting history',async t=>{
  const {client}=await setup(t),api=client();let {data}=await api('/transactions','POST',payment('2026-10-03T12:00',{recurring:true}));const id=data.subscriptions[0].id;
  assert.equal(data.reminders.length,1);({data}=await api(`/subscriptions/${id}`,'PATCH',{reminderEnabled:false}));assert.equal(data.reminders.length,0);assert.equal(data.forecastTotal,3000);
  ({data}=await api('/profile','PATCH',{name:'Dana',reminderDays:0}));assert.equal(data.profile.name,'Dana');
  ({data}=await api(`/subscriptions/${id}`,'DELETE'));assert.equal(data.subscriptions.length,0);assert.equal(data.transactions.length,1);assert.equal(data.forecastTotal,0);
});
test('overdue dates are retained but excluded from forecast and reminders',async t=>{
  const {client}=await setup(t),api=client();const {data}=await api('/transactions','POST',payment('2026-08-03T12:00',{recurring:true}));assert.equal(data.subscriptions[0].nextDate,'2026-09-03');assert.equal(data.reminders.length,0);assert.equal(data.forecastTotal,0);
});
test('manual confirmation uses latest recorded payment and paid month-end advances without drifting',async t=>{
  const {client}=await setup(t),api=client();await api('/transactions','POST',payment('2026-10-03T12:00'));
  let {data}=await api('/transactions','POST',payment('2026-09-03T12:00',{recurring:true}));assert.equal(data.subscriptions[0].nextDate,'2026-11-03');
  await api('/transactions','POST',payment('2026-01-31T12:00',{name:'MonthEnd',recurring:true}));
  ({data}=await api('/transactions','POST',payment('2026-02-28T12:00',{name:'MonthEnd'})));assert.equal(data.subscriptions.find(x=>x.name==='MonthEnd').nextDate,'2026-03-31');
});
test('editing merchant and amount keeps one schedule when matching corrected payment is recorded',async t=>{
  const {client}=await setup(t),api=client();let {data}=await api('/transactions','POST',payment('2026-09-03T12:00',{recurring:true}));const id=data.subscriptions[0].id;
  await api('/subscriptions/'+id,'PATCH',{name:'New service',price:3200,nextDate:'2026-10-03'});
  ({data}=await api('/transactions','POST',payment('2026-10-03T12:00',{name:'New service',amount:-3200,recurring:true})));assert.equal(data.subscriptions.length,1);assert.equal(data.subscriptions[0].nextDate,'2026-11-03');
});
test('users cannot read, change or delete another browser history',async t=>{
  const {client}=await setup(t),a=client(),b=client();const {data}=await a('/transactions','POST',payment('2026-10-03T12:00',{recurring:true}));
  assert.equal((await b('/state')).data.transactions.length,0);assert.equal((await b('/transactions/'+data.transactions[0].id,'DELETE')).status,404);assert.equal((await b('/subscriptions/'+data.subscriptions[0].id,'PATCH',{name:'Hijacked'})).status,404);
});
test('delete supporting history recalculates suggestions',async t=>{
  const {client}=await setup(t),api=client();const {data}=await api('/samples','POST',{});const item=data.suggestions[0];const next=await api('/transactions/'+item.evidence[0].id,'DELETE');assert.equal(next.data.suggestions.length,2);
});
test('invalid input is rejected and no partial transaction is saved',async t=>{
  const {client,base}=await setup(t),api=client();assert.equal((await api('/transactions','POST',payment(undefined,{name:''}))).status,400);assert.equal((await api('/state')).data.transactions.length,0);
  const response=await fetch(base+'/api/profile',{method:'PATCH',headers:{'Content-Type':'application/json','Origin':'http://evil.example'},body:'{}'});assert.equal(response.status,403);
  assert.equal((await api('/profile','PATCH',{reminderDays:-1})).status,400);
});
test('legacy import is idempotent and rejects invalid batches atomically',async t=>{
  const {client}=await setup(t),api=client();const records=[{...payment(),id:'old-1',isSubscription:true}];let {data}=await api('/import-local','POST',{transactions:records});assert.equal(data.transactions.length,1);assert.equal(data.subscriptions.length,1);
  ({data}=await api('/import-local','POST',{transactions:records}));assert.equal(data.transactions.length,1);
  assert.equal((await api('/import-local','POST',{transactions:[{...payment(),id:'old-2'},{...payment(),name:''}]})).status,400);assert.equal((await api('/state')).data.transactions.length,1);
});
test('end of month anchor survives confirmation and preference edits',async t=>{
  const {client}=await setup(t),api=client();for(const date of ['2026-08-31','2026-09-30','2026-10-31'])await api('/transactions','POST',payment(date+'T12:00'));
  const item=(await api('/state')).data.suggestions[0];let {data}=await api('/suggestions/review','POST',{key:item.key,action:'confirm'});assert.equal(data.subscriptions[0].anchorDay,31);assert.equal(data.subscriptions[0].nextDate,'2026-11-30');
  ({data}=await api('/subscriptions/'+data.subscriptions[0].id,'PATCH',{reminderEnabled:false}));assert.equal(data.subscriptions[0].anchorDay,31);
});
test('SQLite preserves history, decisions and settings across store restart',()=>{
  const dir=mkdtempSync(join(tmpdir(),'monetra-test-')),file=join(dir,'db.sqlite');let store;
  try{store=createStore(file);const id=store.createUser();store.atomic(()=>store.add(id,{name:'Persisted',amountMinor:-125,category:'Продукты',occurredAt:'2026-10-03T12:00',note:'saved',recurring:true}));store.db.prepare('UPDATE users SET name=? WHERE id=?').run('Dana',id);store.close();store=createStore(file);assert.equal(store.state(id,'2026-11-01').transactions.length,1);assert.equal(store.state(id,'2026-11-01').subscriptions.length,1);assert.equal(store.user(id).name,'Dana');}finally{store?.close();rmSync(dir,{recursive:true,force:true});}
});
