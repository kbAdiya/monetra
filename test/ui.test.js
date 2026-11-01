import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';
import { JSDOM } from 'jsdom';
import { once } from 'node:events';
import { createApp } from '../server/app.js';
import { createStore } from '../server/store.js';

test('interface completes sample → correct/confirm/reject → reminder → settings → reload → add/delete journey',async t=>{
  const dom=new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>',{url:'http://localhost:5173'});
  globalThis.window=dom.window;globalThis.document=dom.window.document;globalThis.localStorage=dom.window.localStorage;
  globalThis.HTMLElement=dom.window.HTMLElement;globalThis.IS_REACT_ACT_ENVIRONMENT=true;
  const hook=registerHooks({load(url,context,next){if(url.endsWith('.jsx'))return {format:'module',shortCircuit:true,source:transformSync(readFileSync(new URL(url),'utf8'),{loader:'jsx',format:'esm'}).code};return next(url,context);}});
  const {default:React,act}=await import('react');const {createRoot}=await import('react-dom/client');const {default:App}=await import('../src/App.jsx');
  const store=createStore(':memory:'),{server}=createApp({store,clock:()=> '2026-11-01'});server.listen(0,'127.0.0.1');await once(server,'listening');
  const realFetch=globalThis.fetch;let cookie='',root;const pending=new Set();
  globalThis.fetch=(path,options={})=>{
    const promise=realFetch(`http://127.0.0.1:${server.address().port}${path}`,{...options,headers:{...options.headers,...(cookie?{Cookie:cookie}:{})}}).then(async response=>{
      if(response.headers.get('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];
      // Read the body before marking this request settled so component updates can flush in act.
      const data=await response.json();return {ok:response.ok,json:async()=>data};
    });pending.add(promise);promise.finally(()=>pending.delete(promise));return promise;
  };
  t.after(async()=>{if(root)await act(async()=>root.unmount());globalThis.fetch=realFetch;hook.deregister();server.closeAllConnections();await new Promise(r=>server.close(r));store.close();dom.window.close();});
  const settle=async()=>{for(let i=0;i<12;i++){await new Promise(r=>setTimeout(r,0));if(pending.size)await Promise.all([...pending]);else break;}};
  const step=async fn=>{await act(async()=>{fn?.();});await act(async()=>{await settle();});};
  const all=(selector)=>[...document.querySelectorAll(selector)];
  const button=(label,scope=document)=>{const node=[...scope.querySelectorAll('button')].find(x=>x.textContent.trim()===label);assert.ok(node,`Button exists: ${label}`);return node;};
  const click=async(label,scope=document)=>step(()=>button(label,scope).click());
  const input=async(selector,value)=>step(()=>{const el=document.querySelector(selector);assert.ok(el,selector);const proto=el.tagName==='SELECT'?window.HTMLSelectElement.prototype:window.HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(el,value);el.dispatchEvent(new window.Event(el.tagName==='SELECT'?'change':'input',{bubbles:true}));});
  const text=()=>document.body.textContent;
  await step(()=>{root=createRoot(document.getElementById('root'));root.render(React.createElement(React.StrictMode,null,React.createElement(App)));});
  assert.match(text(),/Добрый день/);assert.match(text(),/Добавьте первую операцию/);
  await click('Загрузить примеры');assert.equal(all('.suggestion').length,3);assert.equal(all('.subscription-card').length,0);
  const first=all('.suggestion')[0];await click('Исправить',first);
  await input('.payment-editor input[type="number"]','3500.25');await input('.payment-editor input[type="date"]','2026-11-02');
  await click('Сохранить и подтвердить');assert.equal(all('.subscription-card').length,1);assert.equal(all('.suggestion').length,2);assert.match(text(),/Проверьте предстоящие оплаты/);assert.match(document.querySelector('.upcoming-total').textContent,/3\s*500,25/);
  await click('Отклонить',all('.suggestion')[0]);assert.equal(all('.suggestion').length,1);
  await click('Настройки',document.querySelector('.sidebar'));
  await input('.settings-form input[maxlength="40"]','Dana');await input('.settings-form input[type="number"]','0');await click('Сохранить настройки');assert.match(text(),/Настройки сохранены/);
  await click('Обзор',document.querySelector('.sidebar'));assert.match(text(),/Добрый день, Dana/);assert.equal(all('.reminder-banner').length,0);
  await click('Подписка из готовых примеров');await step(()=>{const node=all('.template-picker button').find(x=>x.textContent.includes('YouTube Premium'));assert.ok(node);node.click();});
  await input('.add-panel input[type="datetime-local"]','2026-10-03T12:00');await click('Добавить операцию');assert.equal(all('.subscription-card').length,2);assert.match(text(),/Операция сохранена/);
  await click('Операции',document.querySelector('.sidebar'));await input('input[aria-label="Поиск по операциям"]','YouTube Premium');assert.equal(all('.transaction-row').length,1);
  await step(()=>document.querySelector('.delete-button').click());assert.equal(all('.transaction-row').length,0);
  await step(()=>root.unmount());await step(()=>{root=createRoot(document.getElementById('root'));root.render(React.createElement(App));});
  assert.match(text(),/Добрый день, Dana/);assert.equal(all('.subscription-card').length,2);assert.equal(all('.suggestion').length,1);
  await click('Повторяющиеся',document.querySelector('.sidebar'));await step(()=>all('.subscription-card')[0].click());await click('Убрать из повторяющихся');assert.equal(all('.subscription-card').length,1);
  assert.equal(all('[role="alert"]').length,0);
});
