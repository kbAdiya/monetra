import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { detectRecurring, eligibleReminders, patternKey, merchantKey, nextMonth, todayInZone, dayDifference, validDate, InputError } from './domain.js';

export function createStore(path = 'data/monetra.sqlite') {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, name TEXT NOT NULL DEFAULT 'Айгерим', reminder_days INTEGER NOT NULL DEFAULT 2);
    CREATE TABLE IF NOT EXISTS transactions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), name TEXT NOT NULL, amount_minor INTEGER NOT NULL, category TEXT NOT NULL, occurred_at TEXT NOT NULL, note TEXT NOT NULL, sample_key TEXT, UNIQUE(user_id,sample_key));
    CREATE INDEX IF NOT EXISTS tx_user ON transactions(user_id, occurred_at);
    CREATE TABLE IF NOT EXISTS decisions (user_id TEXT NOT NULL REFERENCES users(id), pattern_key TEXT NOT NULL, status TEXT NOT NULL, PRIMARY KEY(user_id,pattern_key));
    CREATE TABLE IF NOT EXISTS subscriptions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), pattern_key TEXT NOT NULL, name TEXT NOT NULL, amount_minor INTEGER NOT NULL, next_date TEXT NOT NULL, anchor_day INTEGER NOT NULL, reminder_enabled INTEGER NOT NULL DEFAULT 1, UNIQUE(user_id,pattern_key));`);
  // Additive migration preserves existing anonymous profiles and all finance records.
  const columns = new Set(db.prepare('PRAGMA table_info(users)').all().map(x => x.name));
  for (const [name, type] of [['email', 'TEXT'], ['password_hash', 'TEXT'], ['recovery_hash', 'TEXT']]) {
    if (!columns.has(name)) db.exec(`ALTER TABLE users ADD COLUMN ${name} ${type}`);
  }
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS users_email ON users(email) WHERE email IS NOT NULL;
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, last_seen INTEGER NOT NULL, idle_ms INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
    CREATE TABLE IF NOT EXISTS auth_limits (key TEXT PRIMARY KEY, attempts INTEGER NOT NULL, reset_at INTEGER NOT NULL);`);
  const atomic = (fn) => { db.exec('BEGIN IMMEDIATE'); try { const result=fn(); db.exec('COMMIT'); return result; } catch(e) { db.exec('ROLLBACK'); throw e; } };
  const user = (id) => db.prepare('SELECT id,name,email,reminder_days AS reminderDays FROM users WHERE id=?').get(id);
  const transactions = (id) => db.prepare('SELECT id,name,amount_minor AS amountMinor,category,occurred_at AS occurredAt,note FROM transactions WHERE user_id=? ORDER BY occurred_at DESC,id').all(id);
  const subscriptions = (id) => db.prepare("SELECT id,name,amount_minor / 100.0 AS price,next_date AS nextDate,anchor_day AS anchorDay,reminder_enabled AS reminderEnabled,'confirmed' AS status FROM subscriptions WHERE user_id=? ORDER BY next_date,name").all(id);
  function suggestions(id) {
    const decisions = new Set(db.prepare('SELECT pattern_key FROM decisions WHERE user_id=?').all(id).map(x=>x.pattern_key));
    subscriptions(id).forEach(x=>decisions.add(patternKey(x.name,Math.round(x.price*100))));
    return detectRecurring(transactions(id)).filter(x=>!decisions.has(x.key)).map(x=>({...x,status:'unconfirmed'}));
  }
  function confirm(id, key, input) {
    const duplicate=subscriptions(id).some(x=>patternKey(x.name,Math.round(x.price*100))===patternKey(input.name,input.amountMinor));
    if(duplicate) throw new InputError('Такой повторяющийся платёж уже есть в списке.',409);
    db.prepare(`INSERT INTO subscriptions(id,user_id,pattern_key,name,amount_minor,next_date,anchor_day) VALUES(?,?,?,?,?,?,?)
      ON CONFLICT(user_id,pattern_key) DO UPDATE SET name=excluded.name,amount_minor=excluded.amount_minor,next_date=excluded.next_date,anchor_day=excluded.anchor_day`).run(randomUUID(),id,key,input.name,Math.abs(input.amountMinor),input.nextDate,input.anchorDay);
    db.prepare("INSERT OR REPLACE INTO decisions VALUES(?,?,'confirmed')").run(id,key);
  }
  function add(id, input, sampleKey = null) {
    const txId = randomUUID();
    const inserted = db.prepare('INSERT OR IGNORE INTO transactions VALUES(?,?,?,?,?,?,?,?)').run(txId,id,input.name,input.amountMinor,input.category,input.occurredAt,input.note,sampleKey);
    if (!inserted.changes) return;
    const key = patternKey(input.name,input.amountMinor);
    const existing = db.prepare('SELECT * FROM subscriptions WHERE user_id=? AND pattern_key=?').get(id,key) || db.prepare('SELECT * FROM subscriptions WHERE user_id=?').all(id).find(x=>merchantKey(x.name)===merchantKey(input.name) && x.amount_minor===Math.abs(input.amountMinor));
    if (input.amountMinor < 0 && existing && input.occurredAt.slice(0,10) >= existing.next_date) {
      db.prepare('UPDATE subscriptions SET next_date=? WHERE id=?').run(nextMonth(input.occurredAt.slice(0,10),existing.anchor_day),existing.id);
    } else if (input.recurring && !existing) {
      const latest = transactions(id).find(x=>patternKey(x.name,x.amountMinor)===key && x.amountMinor<0);
      const anchorDay=Number(input.occurredAt.slice(8,10));
      confirm(id,key,{...input,nextDate:nextMonth(latest.occurredAt.slice(0,10),anchorDay),anchorDay});
    }
    return txId;
  }
  function state(id, today = todayInZone()) {
    const tx = transactions(id);
    const subs = subscriptions(id);
    const profile = user(id);
    return { profile, today, transactions:tx.map(x=>({...x,amount:x.amountMinor/100,recurring:x.amountMinor<0 && subs.some(s=>merchantKey(s.name)===merchantKey(x.name) && Math.round(s.price*100)===Math.abs(x.amountMinor))})), subscriptions:subs, suggestions:suggestions(id), reminders:eligibleReminders(subs.filter(x=>x.reminderEnabled),profile.reminderDays,today), forecastTotal:subs.filter(x=>validDate(x.nextDate) && dayDifference(x.nextDate,today)>=0 && dayDifference(x.nextDate,today)<=30).reduce((sum,x)=>sum+Math.round(x.price*100),0)/100 };
  }
  return { db, atomic, user, transactions, subscriptions, suggestions, confirm, add, state, createUser:()=>{const id=randomUUID();db.prepare('INSERT INTO users(id,name) VALUES(?,?)').run(id,'Айгерим');return id;}, close:()=>db.close() };
}
