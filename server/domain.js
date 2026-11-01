import { categories } from '../src/data.js';

export class InputError extends Error { constructor(message, status = 400) { super(message); this.status = status; } }
export const merchantKey = (name) => name.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('ru-RU');
export function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(+date) && date.toISOString().slice(0, 10) === value && value >= '2000-01-01' && value <= '2100-12-31';
}
export function todayInZone(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Qyzylorda', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}
export const dayDifference = (a, b) => Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86400000);
export function nextMonth(date, anchor = Number(date.slice(8, 10))) {
  const d = new Date(`${date}T00:00:00Z`);
  const year = d.getUTCFullYear(), month = d.getUTCMonth() + 1;
  const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month, Math.min(anchor, last))).toISOString().slice(0, 10);
}
export function text(value, label, max = 120) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) throw new InputError(`${label}: введите от 1 до ${max} символов.`);
  return value.trim();
}
export function amountInMinor(value, signed = false) {
  if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(Math.round(value * 100)) < 1 || (!signed && value < 0) || Math.abs(value) > 1e9 || Math.abs(value * 100 - Math.round(value * 100)) > 0.00001) throw new InputError('Сумма должна быть ненулевой, не больше 1 млрд ₸ и содержать не более двух знаков после запятой.');
  return Math.round(value * 100);
}
export function validateTransaction(input, today = todayInZone()) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new InputError('Операция должна содержать продавца, сумму и дату.');
  const name = text(input.name, 'Название продавца');
  const amountMinor = amountInMinor(input.amount, true);
  if (!categories.includes(input.category)) throw new InputError('Выберите допустимую категорию.');
  if (typeof input.occurredAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(input.occurredAt) || !validDate(input.occurredAt.slice(0, 10)) || Number(input.occurredAt.slice(11, 13)) > 23 || Number(input.occurredAt.slice(14, 16)) > 59) throw new InputError('Укажите корректную дату и время платежа.');
  if (input.occurredAt.slice(0,10) > today) throw new InputError('Операция не может быть в будущем. Будущую дату укажите в повторяющемся платеже.');
  if (input.note !== undefined && (typeof input.note !== 'string' || input.note.length > 500)) throw new InputError('Комментарий: максимум 500 символов.');
  if (input.recurring !== undefined && typeof input.recurring !== 'boolean') throw new InputError('Некорректный признак повторения.');
  if (input.recurring && amountMinor > 0) throw new InputError('Повторение доступно только для расходов.');
  return { name, amountMinor, category: input.category, occurredAt: input.occurredAt, note: input.note?.trim() || '', recurring: Boolean(input.recurring) };
}
export const patternKey = (name, minor) => JSON.stringify([merchantKey(name), Math.abs(minor)]);
export function detectRecurring(transactions) {
  const groups = new Map();
  for (const item of transactions) {
    if (item.amountMinor >= 0) continue;
    const key = patternKey(item.name, item.amountMinor);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  const result = [];
  for (const [key, group] of groups) {
    group.sort((a,b)=>a.occurredAt.localeCompare(b.occurredAt));
    const latest = group.at(-1);
    const monthNumber = x => Number(x.occurredAt.slice(0,4))*12 + Number(x.occurredAt.slice(5,7))-1;
    const byMonth = new Map();
    for (const item of group) { const month=monthNumber(item); if(!byMonth.has(month)) byMonth.set(month,[]); byMonth.get(month).push(item); }
    const chain=[];
    for(let month=monthNumber(latest);byMonth.has(month);month--) {
      const records=byMonth.get(month);
      // Frequent purchases throughout a month are not evidence of a monthly charge.
      if(dayDifference(records.at(-1).occurredAt.slice(0,10),records[0].occurredAt.slice(0,10))>3) break;
      chain.unshift(records.at(-1));
    }
    if(chain.length<3) continue;
    const candidates=Array.from({length:31},(_,i)=>i+1).map(anchor=>({anchor, deviations:chain.map(x=>{
      const date=new Date(`${x.occurredAt.slice(0,10)}T00:00:00Z`);
      const last=new Date(Date.UTC(date.getUTCFullYear(),date.getUTCMonth()+1,0)).getUTCDate();
      return Math.abs(Number(x.occurredAt.slice(8,10))-Math.min(anchor,last));
    })})).filter(x=>x.deviations.every(d=>d<=3)).sort((a,b)=>a.deviations.reduce((s,d)=>s+d,0)-b.deviations.reduce((s,d)=>s+d,0));
    if(!candidates.length) continue;
    const anchorDay=candidates[0].anchor;
    result.push({ key, name: latest.name, price: Math.abs(latest.amountMinor) / 100, category: latest.category, icon: latest.icon || 'wallet', nextDate: nextMonth(latest.occurredAt.slice(0,10), anchorDay), anchorDay, occurrences: chain.length, evidence: chain.map(x=>({ id:x.id, occurredAt:x.occurredAt, amount:x.amountMinor/100 })) });
  }
  return result;
}
export function eligibleReminders(subscriptions, windowDays, today) {
  return subscriptions.filter(x=>x.status === 'confirmed' && validDate(x.nextDate) && dayDifference(x.nextDate,today) >= 0 && dayDifference(x.nextDate,today) <= windowDays);
}
