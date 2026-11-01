export async function request(path, { method = 'GET', body, signal } = {}) {
  const response = await fetch(`/api${path}`, { method, credentials: 'same-origin', signal, headers: body === undefined ? {} : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  let result;
  try { result = await response.json(); } catch { throw new Error('Сервер недоступен. Запустите проект командой npm run dev.'); }
  if (!response.ok) throw new Error(result.error || 'Не удалось сохранить изменения.');
  return result;
}
