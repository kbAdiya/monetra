import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { InputError, text } from './domain.js';

const deriveKey = promisify(scrypt);
const SCRYPT = { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 };
const digest = value => createHash('sha256').update(value).digest('hex');
const same = (a, b) => typeof a === 'string' && typeof b === 'string' && a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const DAY = 86400000;
const DUMMY_HASH = `scrypt$32768$8$3$${'0'.repeat(32)}$${'0'.repeat(128)}`;
const COMMON_PASSWORDS = new Set(['passwordpassword', 'password123456789', '123456789012345', '1234567890123456', 'qwertyuiopasdfgh', 'парольпарольпароль']);

export function validateEmail(value) {
  if (typeof value !== 'string') throw new InputError('Введите корректный email.');
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/.test(email) || email.split('@')[0].length > 64 || email.includes('..') || email.startsWith('.') || email.includes('.@')) throw new InputError('Введите корректный email.');
  return email;
}
export function validatePassword(value) {
  if (typeof value !== 'string' || [...value].length < 15 || [...value].length > 128) throw new InputError('Пароль должен содержать от 15 до 128 символов. Можно использовать фразу с пробелами.');
  if (COMMON_PASSWORDS.has(value.toLowerCase()) || /^(.)\1+$/su.test(value)) throw new InputError('Этот пароль слишком распространён. Придумайте другую парольную фразу.');
  return value;
}
export async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const key = await deriveKey(password, salt, 64, SCRYPT);
  return `scrypt$32768$8$3$${salt}$${key.toString('hex')}`;
}
export async function verifyPassword(password, stored = DUMMY_HASH) {
  if (typeof password !== 'string' || [...password].length > 128) return false;
  const [algorithm, n, r, p, salt, expected] = (stored || DUMMY_HASH).split('$');
  if (algorithm !== 'scrypt' || Number(n) !== SCRYPT.N || Number(r) !== SCRYPT.r || Number(p) !== SCRYPT.p || !/^[a-f0-9]{32}$/.test(salt) || !/^[a-f0-9]{128}$/.test(expected)) return false;
  const actual = await deriveKey(password, salt, 64, SCRYPT);
  return timingSafeEqual(actual, Buffer.from(expected, 'hex'));
}
function recoveryCode() { return randomBytes(20).toString('hex').toUpperCase().match(/.{1,8}/g).join('-'); }
function normalizeCode(value) { return typeof value === 'string' ? value.toUpperCase().replace(/[\s-]/g, '') : ''; }
function cookieValue(req) { return req.headers.cookie?.split(';').map(x => x.trim()).find(x => x.startsWith('monetra_session='))?.slice(16); }

export function createAuth(store, { now = Date.now, secureCookies = false, publicOrigin } = {}) {
  const { db } = store;
  if (publicOrigin && !/^https?:\/\/[^/]+$/.test(publicOrigin)) throw new Error('MONETRA_ORIGIN должен содержать только origin, например https://monetra.example');
  let activeHashes = 0;
  async function hashWork(fn) {
    if (activeHashes >= 4) throw new InputError('Сервер занят. Повторите попытку через несколько секунд.', 429);
    activeHashes++;
    try { return await fn(); } finally { activeHashes--; }
  }
  function limit(key, max = 10, windowMs = 15 * 60000) {
    const time = now();
    db.prepare('DELETE FROM auth_limits WHERE reset_at<=?').run(time);
    const row = db.prepare('SELECT attempts FROM auth_limits WHERE key=?').get(digest(key));
    if (row?.attempts >= max) throw new InputError('Слишком много попыток. Повторите через 15 минут.', 429);
    db.prepare('INSERT INTO auth_limits VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET attempts=attempts+1').run(digest(key), time + windowMs);
  }
  function clearLimit(key) { db.prepare('DELETE FROM auth_limits WHERE key=?').run(digest(key)); }
  function checkOrigin(req) {
    const expected = publicOrigin || `http://${req.headers.host}`;
    if (req.headers.origin && req.headers.origin !== expected) throw new InputError('Недопустимый источник запроса.', 403);
    if (req.headers['sec-fetch-site'] === 'cross-site') throw new InputError('Недопустимый источник запроса.', 403);
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.headers['x-monetra-request'] !== '1') throw new InputError('Запрос отклонён. Обновите страницу.', 403);
  }
  function resolveSession(req) {
    const token = cookieValue(req);
    if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
    const tokenHash = digest(token), time = now();
    const row = db.prepare('SELECT * FROM sessions WHERE token_hash=?').get(tokenHash);
    if (!row) return null;
    if (row.expires_at <= time || row.last_seen + row.idle_ms <= time) { db.prepare('DELETE FROM sessions WHERE token_hash=?').run(tokenHash); return null; }
    db.prepare('UPDATE sessions SET last_seen=? WHERE token_hash=?').run(time, tokenHash);
    return { id: row.user_id, tokenHash, csrfToken: digest(`csrf:${token}`) };
  }
  function legacyProfile(req) {
    const cookie = cookieValue(req);
    if (!cookie || !/^[a-f0-9-]{36}$/.test(cookie)) return null;
    const profile = store.user(cookie);
    return profile && !profile.email ? profile : null;
  }
  function setCookie(res, token, remember = false) {
    res.setHeader('Set-Cookie', `monetra_session=${token}; HttpOnly; SameSite=Strict; Path=/${remember ? `; Max-Age=${30 * 86400}` : ''}${secureCookies ? '; Secure' : ''}`);
  }
  function clearCookie(res) { res.setHeader('Set-Cookie', `monetra_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secureCookies ? '; Secure' : ''}`); }
  function newSession(id, remember) {
    const token = randomBytes(32).toString('hex'), time = now();
    db.prepare('DELETE FROM sessions WHERE expires_at<=? OR last_seen+idle_ms<=?').run(time, time);
    db.prepare('INSERT INTO sessions VALUES(?,?,?,?,?,?)').run(digest(token), id, time, time + (remember ? 30 * DAY : DAY / 2), time, remember ? 7 * DAY : DAY / 12);
    // Keep a bounded number of sessions, always preserving the session just issued.
    db.prepare('DELETE FROM sessions WHERE user_id=? AND token_hash NOT IN (SELECT token_hash FROM sessions WHERE user_id=? ORDER BY created_at DESC, rowid DESC LIMIT 10)').run(id,id);
    return { token, csrfToken: digest(`csrf:${token}`) };
  }
  function requireCsrf(req, session) {
    if (!session) throw new InputError('Войдите в аккаунт, чтобы продолжить.', 401);
    if (!['GET','HEAD'].includes(req.method) && !same(req.headers['x-csrf-token'], session.csrfToken)) throw new InputError('Сеанс изменился. Обновите страницу и повторите действие.', 403);
  }
  function ipKey(req) { return req.socket.remoteAddress || 'unknown'; }
  function payload(id, session, date, extra = {}) { return { ...store.state(id, date), csrfToken: session.csrfToken, ...extra }; }

  async function handle(req, res, path, readBody, date) {
    checkOrigin(req);
    const session = resolveSession(req);
    if (path === '/api/auth/session' && req.method === 'GET') {
      const legacy = !session ? legacyProfile(req) : null;
      return { handled: true, status: 200, data: { user: session ? store.user(session.id) : null, csrfToken: session?.csrfToken || null, legacyAvailable: Boolean(legacy), legacyName: legacy?.name || null } };
    }
    if (['/api/auth/register','/api/auth/login','/api/auth/recover'].includes(path) && req.method === 'POST') {
      limit(`auth-ip:${ipKey(req)}`, 60);
      const input = await readBody(req);
      const email = validateEmail(input.email);
      const rateKey = `${path}:${email}`;
      limit(rateKey, path.endsWith('register') ? 5 : 10);
      if (input.remember !== undefined && typeof input.remember !== 'boolean') throw new InputError('Некорректная настройка сохранения входа.');
      if (path.endsWith('/register')) {
        if (session) throw new InputError('Сначала выйдите из текущего аккаунта.', 409);
        const name = text(input.name, 'Имя', 40), password = validatePassword(input.password);
        if (db.prepare('SELECT id FROM users WHERE email=?').get(email)) throw new InputError('Не удалось зарегистрироваться с этим email. Попробуйте войти или восстановить доступ.', 409);
        const passwordHash = await hashWork(() => hashPassword(password));
        const code = recoveryCode();
        const legacy = input.migrateLegacy === true ? legacyProfile(req) : null;
        const result = store.atomic(() => {
          if (db.prepare('SELECT id FROM users WHERE email=?').get(email)) throw new InputError('Не удалось зарегистрироваться с этим email. Попробуйте войти.', 409);
          const id = legacy?.id || store.createUser();
          const updated = db.prepare('UPDATE users SET email=?,name=?,password_hash=?,recovery_hash=? WHERE id=? AND email IS NULL').run(email,name,passwordHash,digest(normalizeCode(code)),id).changes;
          if (!updated) throw new InputError('Этот профиль уже привязан к аккаунту. Войдите в него.', 409);
          return { id, session: newSession(id, Boolean(input.remember)) };
        });
        setCookie(res,result.session.token,input.remember);
        return { handled:true,status:201,data:payload(result.id,result.session,date,{recoveryCode:code}) };
      }
      const account = db.prepare('SELECT id,password_hash,recovery_hash FROM users WHERE email=?').get(email);
      if (path.endsWith('/login')) {
        const ok = await hashWork(() => verifyPassword(input.password,account?.password_hash));
        if (!account || !ok) throw new InputError('Неверный email или пароль.',401);
        // A password change during hashing must not grant a session with the old password.
        if (db.prepare('SELECT password_hash FROM users WHERE id=?').get(account.id)?.password_hash !== account.password_hash) throw new InputError('Пароль изменён. Повторите вход.',401);
        const issued = store.atomic(() => {
          if (session) db.prepare('DELETE FROM sessions WHERE token_hash=?').run(session.tokenHash);
          return newSession(account.id,Boolean(input.remember));
        });
        clearLimit(rateKey);setCookie(res,issued.token,input.remember);
        return {handled:true,status:200,data:payload(account.id,issued,date)};
      }
      const code = normalizeCode(input.recoveryCode);
      if (!account?.recovery_hash || !/^[A-F0-9]{40}$/.test(code) || !same(digest(code),account.recovery_hash)) throw new InputError('Неверный email или резервный код.',401);
      const password = validatePassword(input.newPassword);
      const passwordHash = await hashWork(() => hashPassword(password));
      const freshCode = recoveryCode();
      store.atomic(() => {
        const changed = db.prepare('UPDATE users SET password_hash=?,recovery_hash=? WHERE id=? AND recovery_hash=?').run(passwordHash,digest(normalizeCode(freshCode)),account.id,account.recovery_hash).changes;
        if (!changed) throw new InputError('Резервный код уже использован. Повторите вход.',401);
        db.prepare('DELETE FROM sessions WHERE user_id=?').run(account.id);
      });
      clearLimit(rateKey);clearLimit(`/api/auth/login:${email}`);
      if (session?.id === account.id) clearCookie(res);
      return {handled:true,status:200,data:{message:'Пароль изменён. Войдите с новым паролем.',recoveryCode:freshCode}};
    }
    if (path.startsWith('/api/auth/')) {
      requireCsrf(req,session);
      if (path === '/api/auth/logout' && req.method === 'POST') {
        await readBody(req);db.prepare('DELETE FROM sessions WHERE token_hash=?').run(session.tokenHash);clearCookie(res);
        return {handled:true,status:200,data:{message:'Вы вышли из аккаунта.'}};
      }
      if (path === '/api/auth/logout-all' && req.method === 'POST') {
        await readBody(req);db.prepare('DELETE FROM sessions WHERE user_id=?').run(session.id);clearCookie(res);
        return {handled:true,status:200,data:{message:'Все сеансы завершены.'}};
      }
      if (['/api/auth/password','/api/auth/recovery-code'].includes(path) && req.method === 'POST') {
        limit(`sensitive:${session.id}`,10);
        const input = await readBody(req);
        const account = db.prepare('SELECT password_hash FROM users WHERE id=?').get(session.id);
        const ok = await hashWork(() => verifyPassword(input.currentPassword,account.password_hash));
        if (!ok) throw new InputError('Текущий пароль неверен.',400);
        const changedPassword = path.endsWith('/password');
        const passwordHash = changedPassword ? await hashWork(() => hashPassword(validatePassword(input.newPassword))) : account.password_hash;
        const code = recoveryCode();
        const issued = store.atomic(() => {
          // Revalidate after asynchronous hashing: logout/password rotation invalidates this operation.
          if (!db.prepare('SELECT 1 FROM sessions WHERE token_hash=?').get(session.tokenHash)) throw new InputError('Сеанс завершён. Войдите снова.',401);
          const changed = db.prepare('UPDATE users SET password_hash=?,recovery_hash=? WHERE id=? AND password_hash=?').run(passwordHash,digest(normalizeCode(code)),session.id,account.password_hash).changes;
          if (!changed) throw new InputError('Пароль уже изменён. Войдите снова.',401);
          db.prepare('DELETE FROM sessions WHERE user_id=?').run(session.id);
          return newSession(session.id,false);
        });
        setCookie(res,issued.token,false);
        return {handled:true,status:200,data:payload(session.id,issued,date,{recoveryCode:code})};
      }
      throw new InputError('Маршрут не найден.',404);
    }
    requireCsrf(req,session);
    return {handled:false,id:session.id};
  }
  return {handle};
}
