let csrfToken = null;
let authEpoch = 0;
export function clearAuth() { csrfToken = null; authEpoch++; }
export async function request(path, { method = 'GET', body, signal } = {}) {
  const epoch = authEpoch;
  const response = await fetch(`/api${path}`, { method, credentials: 'same-origin', signal, headers: { 'X-Monetra-Request': '1', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(csrfToken && method !== 'GET' ? { 'X-CSRF-Token': csrfToken } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  let result;
  try { result = await response.json(); } catch { throw new Error('Сервер недоступен. Запустите проект командой npm run dev.'); }
  if (!response.ok) { const error = new Error(result.error || 'Не удалось сохранить изменения.'); error.status = response.status; throw error; }
  if (Object.hasOwn(result, 'csrfToken') && epoch === authEpoch) { csrfToken = result.csrfToken; if (method !== 'GET') authEpoch++; }
  return result;
}
