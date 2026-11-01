import test from 'node:test';
import assert from 'node:assert/strict';
import { detectRecurring, nextMonth, eligibleReminders, validDate, todayInZone, validateTransaction, amountInMinor } from '../server/domain.js';

const tx=(date,name='StreamBox',amount=-300000)=>({id:`${date}-${name}`,name,amountMinor:amount,category:'Подписки',occurredAt:`${date}T12:00`});
const detect=(dates)=>detectRecurring(dates.map(d=>tx(d)));
test('three monthly payments produce one unconfirmed suggestion with evidence',()=>{
  const result=detect(['2026-08-03','2026-09-03','2026-10-03']);assert.equal(result.length,1);assert.equal(result[0].nextDate,'2026-11-03');assert.equal(result[0].occurrences,3);assert.equal(result[0].price,3000);
});
test('one or two months do not qualify',()=>{assert.deepEqual(detect(['2026-09-03']),[]);assert.deepEqual(detect(['2026-09-03','2026-10-03']),[]);});
test('same amount across different merchants is not recurrence',()=>assert.deepEqual(detectRecurring([tx('2026-08-03','A'),tx('2026-09-03','B'),tx('2026-10-03','C')]),[]));
test('merchant case, whitespace and Unicode width are normalized',()=>assert.equal(detectRecurring([tx('2026-08-03',' StreamBox '),tx('2026-09-03','streambox'),tx('2026-10-03','ＳｔｒｅａｍＢｏｘ')]).length,1));
test('different amounts do not qualify',()=>assert.deepEqual(detectRecurring([tx('2026-08-03'),tx('2026-09-03'),tx('2026-10-03','StreamBox',-310000)]),[]));
test('income is excluded',()=>assert.deepEqual(detectRecurring(['2026-08-03','2026-09-03','2026-10-03'].map(d=>tx(d,'Salary',300000))),[]));
test('duplicates in one month do not count as separate months',()=>{assert.deepEqual(detect(['2026-10-03','2026-10-03','2026-10-03']),[]);assert.equal(detect(['2026-08-03','2026-09-03','2026-10-03','2026-10-03'])[0].occurrences,3);});
test('month numbers are distinguished across years',()=>{assert.equal(detect(['2025-12-03','2026-01-03','2026-02-03']).length,1);assert.deepEqual(detect(['2024-10-03','2025-10-03','2026-10-03']),[]);});
test('skipped months are not monthly recurrence',()=>assert.deepEqual(detect(['2026-06-03','2026-08-03','2026-10-03']),[]));
test('date variation of three days is accepted',()=>assert.equal(detect(['2026-08-03','2026-09-06','2026-10-03']).length,1));
test('inconsistent dates do not qualify',()=>assert.deepEqual(detect(['2026-08-03','2026-09-16','2026-10-03']),[]));
test('frequent purchases are not mistaken for monthly subscriptions',()=>assert.deepEqual(detect(['2026-08-03','2026-08-16','2026-09-03','2026-09-16','2026-10-03','2026-10-16']),[]));
test('end-of-month date uses last day without losing day 31',()=>{const item=detect(['2026-01-31','2026-02-28','2026-03-31'])[0];assert.equal(item.anchorDay,31);assert.equal(item.nextDate,'2026-04-30');assert.equal(nextMonth('2026-04-30',31),'2026-05-31');});
test('leap-year and December rollover',()=>{assert.equal(nextMonth('2028-01-31'),'2028-02-29');assert.equal(nextMonth('2026-12-31'),'2027-01-31');});
test('reminders require confirmed status and valid date inside inclusive window',()=>{
  const items=[['today','2026-11-01','confirmed'],['edge','2026-11-03','confirmed'],['late','2026-11-04','confirmed'],['past','2026-10-31','confirmed'],['guess','2026-11-02','unconfirmed'],['invalid','2026-02-30','confirmed'],['missing',null,'confirmed']].map(([id,nextDate,status])=>({id,nextDate,status}));
  assert.deepEqual(eligibleReminders(items,2,'2026-11-01').map(x=>x.id),['today','edge']);assert.deepEqual(eligibleReminders(items,0,'2026-11-01').map(x=>x.id),['today']);
});
test('calendar dates reject normalization and invalid formats',()=>{assert.equal(validDate('2026-02-30'),false);assert.equal(validDate('2026-2-1'),false);assert.equal(validDate('2028-02-29'),true);});
test('business date uses Qyzylorda timezone',()=>assert.equal(todayInZone(new Date('2026-10-31T20:30:00Z')),'2026-11-01'));
test('validation rejects missing merchant, invalid amount, time and future dates',()=>{
  const input={name:'Shop',amount:-1.25,category:'Продукты',occurredAt:'2026-10-31T12:00'};
  assert.equal(validateTransaction(input,'2026-11-01').amountMinor,-125);
  for(const bad of [{name:' '},{amount:0},{amount:'5'},{amount:-1.001},{amount:1e-20},{category:'Bad'},{occurredAt:'2026-02-30T12:00'},{occurredAt:'2026-10-31T24:00'},{occurredAt:'2026-11-02T12:00'},{recurring:'true'},{amount:5,recurring:true}]) assert.throws(()=>validateTransaction({...input,...bad},'2026-11-01'));
  assert.equal(amountInMinor(0.29),29);
});
