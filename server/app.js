import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { createStore } from './store.js';
import { InputError, text, validDate, amountInMinor, validateTransaction, todayInZone, patternKey } from './domain.js';
import { sampleTransactions } from './samples.js';

async function body(req) {
  if (!req.headers['content-type']?.startsWith('application/json')) throw new InputError('Требуется JSON.',415);
  const chunks=[];let size=0;
  for await(const chunk of req) { size+=chunk.length; if(size>524288) throw new InputError('Слишком большой запрос.',413);chunks.push(chunk); }
  try { const value=JSON.parse(Buffer.concat(chunks).toString('utf8'));if(!value || typeof value!=='object' || Array.isArray(value)) throw Error();return value; } catch { throw new InputError('Некорректный JSON.'); }
}
function paymentInput(input) {
  const name=text(input.name,'Название продавца');
  const amountMinor=amountInMinor(input.price);
  if(!validDate(input.nextDate)) throw new InputError('Укажите корректную ожидаемую дату оплаты.');
  return {name,amountMinor,nextDate:input.nextDate,anchorDay:Number(input.nextDate.slice(8,10))};
}
export function createApp({store=createStore(), clock=()=>todayInZone(), staticDir=resolve('dist')}={}) {
  const server=http.createServer(async(req,res)=>{
    const json=(status,value)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(value));};
    try {
      const url=new URL(req.url,'http://localhost');
      if(!url.pathname.startsWith('/api/')) {
        if(req.method!=='GET') throw new InputError('Метод не поддерживается.',405);
        const requested=resolve(staticDir,'.'+decodeURIComponent(url.pathname));
        if(requested!==staticDir && !requested.startsWith(staticDir+sep)) throw new InputError('Недопустимый путь.',403);
        let file;
        try { file=await readFile(requested); } catch { if(extname(requested)) throw new InputError('Файл не найден.',404);file=await readFile(resolve(staticDir,'index.html')); }
        res.writeHead(200,{'Content-Type':({'':'text/html','.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png'})[extname(requested)]||'application/octet-stream','X-Content-Type-Options':'nosniff'});res.end(file);return;
      }
      if(url.pathname==='/api/health') return json(200,{status:'ok'});
      // Browser requests are same-origin through Vite or the production server.
      if(req.headers.origin && req.headers.origin!==`http://${req.headers.host}`) throw new InputError('Недопустимый источник запроса.',403);
      const cookie=req.headers.cookie?.split(';').map(x=>x.trim()).find(x=>x.startsWith('monetra_session='))?.slice(16);
      let id=cookie && /^[a-f0-9-]{36}$/.test(cookie) && store.user(cookie) ? cookie : null;
      if(!id) {id=store.createUser();res.setHeader('Set-Cookie',`monetra_session=${id}; HttpOnly; SameSite=Strict; Path=/; Max-Age=31536000`);}
      if(req.method==='GET' && url.pathname==='/api/state') return json(200,store.state(id,clock()));
      if(req.method==='POST' && url.pathname==='/api/transactions') {
        const input=validateTransaction(await body(req),clock());
        store.atomic(()=>store.add(id,input));return json(201,store.state(id,clock()));
      }
      const txMatch=url.pathname.match(/^\/api\/transactions\/([^/]+)$/);
      if(req.method==='DELETE' && txMatch) {
        const changes=store.db.prepare('DELETE FROM transactions WHERE id=? AND user_id=?').run(txMatch[1],id).changes;
        if(!changes) throw new InputError('Операция не найдена.',404);
        return json(200,store.state(id,clock()));
      }
      if(req.method==='POST' && url.pathname==='/api/samples') {
        await body(req);
        store.atomic(()=>sampleTransactions(clock()).forEach((x,i)=>store.add(id,x,`demo-${i}`)));
        return json(200,store.state(id,clock()));
      }
      if(req.method==='POST' && url.pathname==='/api/import-local') {
        const input=await body(req);
        if(!Array.isArray(input.transactions)||input.transactions.length>1000) throw new InputError('Импорт: максимум 1000 операций.');
        const records=input.transactions.map((x,index)=>{if(!x || typeof x!=='object' || Array.isArray(x)) throw new InputError('Некорректная операция в импортируемой истории.');return {key:`legacy-${typeof x.id==='string'?x.id:index}`,value:validateTransaction({...x,recurring:Boolean(x.recurring||x.isSubscription)},clock())};});
        store.atomic(()=>records.sort((a,b)=>a.value.occurredAt.localeCompare(b.value.occurredAt)).forEach(x=>store.add(id,x.value,x.key)));
        return json(200,store.state(id,clock()));
      }
      if(req.method==='POST' && url.pathname==='/api/suggestions/review') {
        const input=await body(req);
        const suggestion=store.suggestions(id).find(x=>x.key===input.key);
        if(!suggestion) throw new InputError('Предложение уже обработано или больше не подтверждается историей.',409);
        if(!['confirm','reject'].includes(input.action)) throw new InputError('Выберите подтверждение или отклонение.');
        const corrected=input.action==='confirm'?paymentInput({...suggestion,...input.correction}):null;
        if(corrected && corrected.nextDate===suggestion.nextDate) corrected.anchorDay=suggestion.anchorDay;
        store.atomic(()=>{
          if(corrected) store.confirm(id,suggestion.key,corrected);
          else store.db.prepare("INSERT OR REPLACE INTO decisions VALUES(?,?,'rejected')").run(id,suggestion.key);
        });return json(200,store.state(id,clock()));
      }
      const subMatch=url.pathname.match(/^\/api\/subscriptions\/([^/]+)$/);
      if(subMatch && ['PATCH','DELETE'].includes(req.method)) {
        const existing=store.db.prepare('SELECT * FROM subscriptions WHERE id=? AND user_id=?').get(subMatch[1],id);
        if(!existing) throw new InputError('Повторяющийся платёж не найден.',404);
        if(req.method==='DELETE') store.atomic(()=>{
          store.db.prepare('DELETE FROM subscriptions WHERE id=?').run(existing.id);
          store.db.prepare("INSERT OR REPLACE INTO decisions VALUES(?,?,'rejected')").run(id,existing.pattern_key);
        });
        else {
          const input=await body(req);
          const p=paymentInput({name:existing.name,price:existing.amount_minor/100,nextDate:existing.next_date,...input});
          if(store.subscriptions(id).some(x=>x.id!==existing.id && patternKey(x.name,Math.round(x.price*100))===patternKey(p.name,p.amountMinor))) throw new InputError('Такой повторяющийся платёж уже есть в списке.',409);
          if(p.nextDate===existing.next_date) p.anchorDay=existing.anchor_day;
          if(input.reminderEnabled!==undefined && typeof input.reminderEnabled!=='boolean') throw new InputError('Некорректная настройка напоминания.');
          store.db.prepare('UPDATE subscriptions SET name=?,amount_minor=?,next_date=?,anchor_day=?,reminder_enabled=? WHERE id=?').run(p.name,p.amountMinor,p.nextDate,p.anchorDay,input.reminderEnabled===undefined?existing.reminder_enabled:Number(input.reminderEnabled),existing.id);
        }
        return json(200,store.state(id,clock()));
      }
      if(req.method==='PATCH' && url.pathname==='/api/profile') {
        const input=await body(req), profile=store.user(id);
        const name=input.name===undefined?profile.name:text(input.name,'Имя',40);
        const days=input.reminderDays===undefined?profile.reminderDays:input.reminderDays;
        if(!Number.isInteger(days)||days<0||days>30) throw new InputError('Окно напоминаний: от 0 до 30 дней.');
        store.db.prepare('UPDATE users SET name=?,reminder_days=? WHERE id=?').run(name,days,id);
        return json(200,store.state(id,clock()));
      }
      throw new InputError('Маршрут не найден.',404);
    } catch(e) { if(!e.status) console.error(e);json(e.status||500,{error:e.status?e.message:'Ошибка сервера. Повторите попытку.'}); }
  });
  return {server,store};
}
