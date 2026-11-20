// Проверка утечек.
// Пароль: k-анонимность Pwned Passwords — в сеть уходят только первые 5 символов SHA-1, сам пароль не покидает компьютер.
// Почта: Have I Been Pwned API v3, нужен ключ пользователя (платная подписка HIBP).
const crypto = require('crypto');

const UA = 'KenoxANON-desktop';

async function password(pw) {
  if (typeof pw !== 'string' || !pw) return { ok: false, err: 'Пустой пароль' };
  const h = crypto.createHash('sha1').update(pw, 'utf8').digest('hex').toUpperCase();
  const prefix = h.slice(0, 5), suffix = h.slice(5);
  try {
    const res = await fetch('https://api.pwnedpasswords.com/range/' + prefix, { headers: { 'Add-Padding': 'true', 'User-Agent': UA } });
    if (!res.ok) return { ok: false, err: 'Сервис ответил ' + res.status };
    const text = await res.text();
    const line = text.split('\n').find((l) => l.startsWith(suffix));
    const count = line ? parseInt(line.split(':')[1], 10) || 0 : 0;
    return { ok: true, count, prefix };
  } catch (e) { return { ok: false, err: 'Нет соединения с api.pwnedpasswords.com' }; }
}

async function email(addr, key) {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(addr || '')) return { ok: false, err: 'Неверный адрес почты' };
  if (!key) return { ok: false, err: 'Нужен API-ключ Have I Been Pwned' };
  try {
    const res = await fetch('https://haveibeenpwned.com/api/v3/breachedaccount/' + encodeURIComponent(addr) + '?truncateResponse=false', { headers: { 'hibp-api-key': key, 'User-Agent': UA } });
    if (res.status === 404) return { ok: true, breaches: [] };
    if (res.status === 401) return { ok: false, err: 'Ключ API не подходит' };
    if (res.status === 429) return { ok: false, err: 'Слишком часто: подожди несколько секунд' };
    if (!res.ok) return { ok: false, err: 'Сервис ответил ' + res.status };
    const list = await res.json();
    return { ok: true, breaches: list.map((b) => ({ name: b.Title || b.Name, date: b.BreachDate, data: (b.DataClasses || []).slice(0, 5) })) };
  } catch (e) { return { ok: false, err: 'Нет соединения с haveibeenpwned.com' }; }
}

// Номер телефона: тот же API, номер — цифрами с кодом страны (79991234567). Телефоны в HIBP есть только для нескольких утечек
// (самая крупная — Facebook 2021). Сервис отвечает только названиями утечек и типами данных в них — сами данные не показывает.
async function phone(digits, key) {
  if (!/^\d{8,15}$/.test(digits || '')) return { ok: false, err: 'Неверный номер' };
  if (!key) return { ok: false, err: 'Нужен API-ключ Have I Been Pwned' };
  try {
    const res = await fetch('https://haveibeenpwned.com/api/v3/breachedaccount/' + digits + '?truncateResponse=false', { headers: { 'hibp-api-key': key, 'User-Agent': UA }, signal: AbortSignal.timeout(20000) });
    if (res.status === 404) return { ok: true, breaches: [] };
    if (res.status === 401) return { ok: false, err: 'Ключ API не подходит — проверь, что скопировал его целиком' };
    if (res.status === 403) return { ok: false, err: 'Сервис не принял запрос (403)' };
    if (res.status === 429) return { ok: false, err: 'Слишком часто: подожди несколько секунд' };
    if (!res.ok) return { ok: false, err: 'Сервис ответил ' + res.status };
    const list = await res.json();
    return { ok: true, breaches: list.map((b) => ({ name: b.Title || b.Name, date: b.BreachDate, count: b.PwnCount || 0, data: (b.DataClasses || []).slice(0, 8) })) };
  } catch (e) { return { ok: false, err: 'Нет соединения с haveibeenpwned.com' }; }
}

module.exports = { password, email, phone };
