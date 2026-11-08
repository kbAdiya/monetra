import React, { useState } from 'react';
import { ArrowRight, Eye, EyeOff, LockKeyhole, ShieldCheck, LogOut, KeyRound } from 'lucide-react';
import { request } from './api.js';
import { transitionView } from './Motion.jsx';

export function RecoveryNotice({ code, onContinue }) {
  const [saved, setSaved] = useState(false), [message, setMessage] = useState('');
  async function copy() {
    try { await navigator.clipboard.writeText(code); setMessage('Код скопирован. Сохраните его в менеджере паролей.'); }
    catch { setMessage('Выделите и скопируйте код вручную.'); }
  }
  return <section className="auth-shell"><div className="auth-card recovery-card"><span className="auth-symbol"><KeyRound size={28} /></span><span className="section-kicker">Сохраните доступ</span><h1>Ваш резервный код</h1><p>Этот код позволит восстановить пароль. Он показывается только сейчас. Сохраните его в менеджере паролей и никому не передавайте.</p><label className="auth-label">Одноразовый резервный код<input aria-label="Одноразовый резервный код" className="recovery-code" readOnly value={code} onFocus={event => event.target.select()} /></label><button type="button" className="secondary-button" onClick={copy}>Скопировать код</button>{message && <p role="status" className="auth-hint">{message}</p>}<p className="auth-hint">После использования или создания нового кода прежний перестаёт действовать.</p><label className="auth-checkbox"><input type="checkbox" checked={saved} onChange={e => setSaved(e.target.checked)} />Я сохранил(а) резервный код</label><button disabled={!saved} className="primary-button" onClick={onContinue}>Продолжить<ArrowRight size={17} /></button></div></section>;
}

export function PasswordField({ label, value, setValue, autoComplete = 'current-password', id, minLength }) {
  const [visible, setVisible] = useState(false);
  return <label className="auth-label" htmlFor={id}>{label}<span className="password-wrap"><input id={id} name={id} type={visible ? 'text' : 'password'} value={value} onChange={e => setValue(e.target.value)} autoComplete={autoComplete} minLength={minLength} maxLength={128} required /><button type="button" className="password-eye" aria-label={visible ? 'Скрыть пароль' : 'Показать пароль'} aria-pressed={visible} onClick={() => setVisible(!visible)}>{visible ? <EyeOff size={18} /> : <Eye size={18} />}</button></span></label>;
}

export default function AuthScreen({ onAuthenticated, legacyAvailable, legacyName, initialMessage = '', onBusyChange = () => {} }) {
  const [mode, setMode] = useState('login'), [email, setEmail] = useState(''), [name, setName] = useState(legacyName || '');
  const [password, setPassword] = useState(''), [confirm, setConfirm] = useState(''), [code, setCode] = useState('');
  const [remember, setRemember] = useState(false), [migrate, setMigrate] = useState(true);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState(initialMessage), [newCode, setNewCode] = useState(null);
  const registration = mode === 'register', recovery = mode === 'recover';
  function switchMode(next, nextMessage = '') { if(next===mode)return; transitionView(() => { setNewCode(null); setMode(next); setPassword(''); setConfirm(''); setCode(''); setError(''); setMessage(nextMessage); }, () => document.getElementById('auth-heading')?.focus({preventScroll:true})); }
  async function submit(event) {
    event.preventDefault(); setError(''); setMessage('');
    if ((registration || recovery) && password !== confirm) return setError('Пароли не совпадают.');
    setBusy(true); onBusyChange(true);
    try {
      if (recovery) {
        const result = await request('/auth/recover', { method: 'POST', body: { email, recoveryCode: code, newPassword: password } });
        setNewCode(result.recoveryCode); setPassword(''); setConfirm(''); setCode('');
      } else {
        const data = await request(registration ? '/auth/register' : '/auth/login', { method: 'POST', body: { email, password, remember, ...(registration ? { name, migrateLegacy: Boolean(legacyAvailable && migrate) } : {}) } });
        setPassword(''); setConfirm(''); onAuthenticated(data);
      }
    } catch (e) { setError(e.message); } finally { setBusy(false); onBusyChange(false); }
  }
  if (newCode) return <RecoveryNotice code={newCode} onContinue={() => switchMode('login', 'Пароль изменён. Войдите с новым паролем.')} />;
  return <div className="auth-shell"><aside className="auth-intro"><div className="brand"><span className="brand-mark"><i /><i /></span>Monetra</div><span className="section-kicker">Ваши финансы под контролем</span><h2>Один аккаунт.<br />Вся картина.</h2><p>Записывайте расходы, проверяйте подписки и замечайте предстоящие оплаты вовремя.</p><div className="auth-benefit"><ShieldCheck size={22} /><span>Личная история доступна после входа в ваш аккаунт.</span></div></aside><section key={mode} className="auth-card" data-fallback={!document.startViewTransition || undefined}><span className="auth-symbol"><LockKeyhole size={25} /></span><h1 id="auth-heading" tabIndex={-1}>{registration ? 'Создать аккаунт' : recovery ? 'Восстановить доступ' : 'С возвращением'}</h1><p>{registration ? 'Начните с имени, email и надёжного пароля.' : recovery ? 'Введите email, сохранённый резервный код и новый пароль.' : 'Войдите, чтобы открыть свои операции и подписки.'}</p>{!recovery && <div className="switcher auth-tabs"><button type="button" disabled={busy} className={!registration ? 'selected' : ''} onClick={() => switchMode('login')}>Вход</button><button type="button" disabled={busy} className={registration ? 'selected' : ''} onClick={() => switchMode('register')}>Регистрация</button></div>}{error && <p className="form-error auth-feedback" role="alert">{error}</p>}{message && <p className="auth-feedback" role="status">{message}</p>}<form onSubmit={submit}><fieldset disabled={busy}>{registration && <label className="auth-label" htmlFor="register-name">Ваше имя<input id="register-name" name="name" autoComplete="name" required maxLength={40} value={name} onChange={e => setName(e.target.value)} /></label>}<label className="auth-label" htmlFor="auth-email">Email<input id="auth-email" name="email" type="email" required maxLength={254} autoComplete="username" autoCapitalize="none" spellCheck={false} value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" /></label>{recovery && <label className="auth-label" htmlFor="recovery-code">Резервный код<input id="recovery-code" required autoComplete="off" maxLength={64} value={code} onChange={e => setCode(e.target.value)} placeholder="Код, сохранённый при регистрации" /></label>}<PasswordField id="auth-password" label={recovery ? 'Новый пароль' : 'Пароль'} value={password} setValue={setPassword} autoComplete={registration || recovery ? 'new-password' : 'current-password'} minLength={registration || recovery ? 15 : undefined} />{(registration || recovery) && <><p className="auth-hint">От 15 до 128 символов. Подойдёт длинная фраза с пробелами.</p><PasswordField id="auth-confirm" label="Повторите пароль" value={confirm} setValue={setConfirm} autoComplete="new-password" minLength={15} /></>}{!recovery && <label className="auth-checkbox"><input type="checkbox" checked={remember} onChange={e => setRemember(e.target.checked)} />Запомнить меня на 30 дней</label>}{registration && legacyAvailable && <label className="auth-checkbox"><input type="checkbox" checked={migrate} onChange={e => setMigrate(e.target.checked)} />Сохранить операции из прежнего профиля этого браузера</label>}<button className="primary-button">{busy ? 'Подождите…' : registration ? 'Создать аккаунт' : recovery ? 'Восстановить пароль' : 'Войти'}<ArrowRight size={17} /></button></fieldset></form><button disabled={busy} type="button" className="text-button auth-back" onClick={() => switchMode(recovery ? 'login' : 'recover')}>{recovery ? 'Вернуться ко входу' : 'Забыли пароль?'}</button>{recovery && <p className="auth-hint">Без резервного кода восстановить доступ нельзя. Письма для сброса пароля пока не отправляются.</p>}</section></div>;
}

export function AccountSecurity({ email, onResult, onLogout, busy: appBusy, onBusyChange = () => {} }) {
  const [current, setCurrent] = useState(''), [password, setPassword] = useState(''), [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  async function perform(path, values) {
    setBusy(true); setError(''); onBusyChange(true);
    try { const result = await request(path, { method: 'POST', body: values }); setCurrent(''); setPassword(''); setConfirm(''); onResult(result); }
    catch (e) { setError(e.message); if (e.status === 401) onLogout('Сеанс завершён. Войдите снова.'); }
    finally { setBusy(false); onBusyChange(false); }
  }
  return <section className="surface account-security"><span className="section-kicker">Безопасность</span><h2>Доступ к аккаунту</h2><p className="account-email">{email}</p><p className="muted">Входите с этим email и паролем из любого браузера, подключённого к этому серверу Monetra.</p>{error && <p role="alert" className="form-error">{error}</p>}<form onSubmit={event => { event.preventDefault(); if (password !== confirm) return setError('Пароли не совпадают.'); perform('/auth/password', { currentPassword: current, newPassword: password }); }}><fieldset disabled={busy || appBusy}><PasswordField id="current-password" label="Текущий пароль" value={current} setValue={setCurrent} /><PasswordField id="new-password" label="Новый пароль" value={password} setValue={setPassword} autoComplete="new-password" minLength={15} /><p className="auth-hint">От 15 до 128 символов. После смены пароля остальные сеансы завершатся.</p><PasswordField id="confirm-password" label="Повторите новый пароль" value={confirm} setValue={setConfirm} autoComplete="new-password" minLength={15} /><button className="primary-button">Изменить пароль</button><button type="button" className="secondary-button recovery-regenerate" onClick={() => { if (!current) return setError('Введите текущий пароль для создания нового резервного кода.'); perform('/auth/recovery-code', { currentPassword: current }); }}>Создать новый резервный код</button></fieldset></form><button type="button" disabled={busy || appBusy} className="text-button logout-all" onClick={() => onLogout(null,true)}><LogOut size={16} />Выйти со всех устройств</button></section>;
}
