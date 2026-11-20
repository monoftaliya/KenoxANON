// Отправка писем со своей почты по SMTP — без сторонних библиотек и серверов.
// Только с шифрованием: порт 465 — сразу TLS, другие порты — STARTTLS. Без шифрования — только к этому компьютеру (для проверки).
// Пароль приходит на одну операцию и нигде не хранится; имя компьютера почтовому серверу не сообщается.
const net = require('net');
const tls = require('tls');
const crypto = require('crypto');
const { StringDecoder } = require('string_decoder');

const PRESETS = {
  gmail: { name: 'Gmail', host: 'smtp.gmail.com', port: 465, domains: ['gmail.com', 'googlemail.com'] },
  yandex: { name: 'Яндекс Почта', host: 'smtp.yandex.ru', port: 465, domains: ['yandex.ru', 'ya.ru', 'yandex.com', 'yandex.by', 'yandex.kz', 'yandex.ua', 'narod.ru'] },
  mailru: { name: 'Mail.ru', host: 'smtp.mail.ru', port: 465, domains: ['mail.ru', 'inbox.ru', 'list.ru', 'bk.ru', 'internet.ru', 'xmail.ru'] },
};
const EHLO = 'EHLO [127.0.0.1]';
const LOOP = /^(127\.0\.0\.1|localhost|::1)$/i;
const HOST = /^(?:[a-z0-9-]{1,63}\.)*[a-z0-9-]{1,63}$|^\d{1,3}(?:\.\d{1,3}){3}$/i;
const EMAIL = /^[^\s@<>()",;:\\[\]]{1,64}@(?:[a-z0-9-]{1,63}\.)+[a-z]{2,24}$/i;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// какую почту выбрал человек: готовая (Gmail, Яндекс, Mail.ru) или свой сервер
function account(a) {
  const x = a && typeof a === 'object' ? a : {};
  const user = String(x.user || '').trim(), pass = String(x.pass || '');
  if (!EMAIL.test(user)) return { ok: false, err: 'Напиши адрес своей почты целиком, например name@gmail.com' };
  let host, port;
  if (PRESETS[x.provider]) ({ host, port } = PRESETS[x.provider]);
  else if (x.provider === 'custom') {
    host = String(x.host || '').trim().toLowerCase(); port = Number(x.port);
    if (!HOST.test(host)) return { ok: false, err: 'Неверный адрес почтового сервера' };
    if (!Number.isInteger(port) || port < 1 || port > 65535) return { ok: false, err: 'Неверный порт почтового сервера' };
  } else return { ok: false, err: 'Выбери почту' };
  if (!pass || pass.length > 300) return { ok: false, err: 'Введи пароль приложения для почты' };
  return { ok: true, host, port, user, pass };
}
const detect = (email) => { const d = String(email || '').split('@')[1] || ''; const k = Object.keys(PRESETS).find((p) => PRESETS[p].domains.includes(d.toLowerCase())); return k || 'custom'; };

/* ---------- SMTP-разговор ---------- */
function reader(sock) {
  const dec = new StringDecoder('utf8');
  let buf = '', lines = [], wait = null, failed = null;
  const pump = () => {
    if (!wait) return;
    const end = lines.findIndex((l) => /^\d{3}(?: |$)/.test(l));
    if (end >= 0) { const part = lines.splice(0, end + 1), w = wait; wait = null; clearTimeout(w.t); w.res({ code: Number(part[end].slice(0, 3)), text: part.map((l) => l.slice(4)).join(' ').trim(), lines: part.map((l) => l.slice(4)) }); return; }
    if (failed) { const w = wait; wait = null; clearTimeout(w.t); w.rej(failed); }
  };
  const onData = (d) => { buf += dec.write(d); let i; while ((i = buf.indexOf('\n')) >= 0) { lines.push(buf.slice(0, i).replace(/\r$/, '')); buf = buf.slice(i + 1); } pump(); };
  const onErr = (e) => { failed = e || new Error('CLOSED'); pump(); };
  const onClose = () => { if (!failed) failed = Object.assign(new Error('CLOSED'), { code: 'CLOSED' }); pump(); };
  sock.on('data', onData); sock.on('error', onErr); sock.on('close', onClose);
  return {
    next: (ms = 25000) => new Promise((res, rej) => { wait = { res, rej, t: setTimeout(() => { wait = null; rej(Object.assign(new Error('TIMEOUT'), { code: 'TIMEOUT' })); }, ms) }; pump(); }),
    detach() { sock.removeListener('data', onData); sock.removeListener('error', onErr); sock.removeListener('close', onClose); },
  };
}
const smtpErr = (rep, stage) => Object.assign(new Error('SMTP ' + rep.code + ' ' + rep.text), { smtp: rep.code, text: rep.text, stage });
// почтовый мост на этом же компьютере (например, Proton Bridge) работает с самодельным сертификатом — для него проверка сертификата не нужна
const tlsOpts = (host, ca) => ({ servername: net.isIP(host) ? undefined : host, ca, minVersion: 'TLSv1.2', rejectUnauthorized: !LOOP.test(host) });
function connect(host, port, secure, ca) {
  return new Promise((resolve, reject) => {
    const s = secure ? tls.connect({ host, port, ...tlsOpts(host, ca) }) : net.connect({ host, port });
    const t = setTimeout(() => { s.destroy(); reject(Object.assign(new Error('TIMEOUT'), { code: 'TIMEOUT' })); }, 15000);
    s.once(secure ? 'secureConnect' : 'connect', () => { clearTimeout(t); s.removeAllListeners('error'); resolve(s); });
    s.once('error', (e) => { clearTimeout(t); reject(e); });
  });
}
function upgrade(sock, host, ca) {
  return new Promise((resolve, reject) => {
    const s = tls.connect({ socket: sock, ...tlsOpts(host, ca) });
    const t = setTimeout(() => { s.destroy(); reject(Object.assign(new Error('TIMEOUT'), { code: 'TIMEOUT' })); }, 15000);
    s.once('secureConnect', () => { clearTimeout(t); s.removeAllListeners('error'); resolve(s); });
    s.once('error', (e) => { clearTimeout(t); reject(e); });
  });
}
// ca — только для проверочных тестов с собственным сертификатом; из интерфейса не передаётся
async function open(acc, opts = {}) {
  const secure = acc.port === 465;
  let sock = await connect(acc.host, acc.port, secure, opts.ca), r = reader(sock);
  const say = async (line, ok, stage) => { sock.write(line + '\r\n'); const rep = await r.next(); if (!ok.includes(rep.code)) throw smtpErr(rep, stage); return rep; };
  try {
    const hi = await r.next();
    if (hi.code !== 220) throw smtpErr(hi, 'greet');
    let ehlo = await say(EHLO, [250], 'ehlo');
    if (!secure) {
      if (ehlo.lines.some((l) => /^STARTTLS\b/i.test(l))) {
        await say('STARTTLS', [220], 'starttls');
        r.detach(); sock.on('error', () => {});   // ошибки старого сокета дальше придут через защищённый
        sock = await upgrade(sock, acc.host, opts.ca); r = reader(sock);
        ehlo = await say(EHLO, [250], 'ehlo');
      } else if (!LOOP.test(acc.host)) throw Object.assign(new Error('NO_TLS'), { code: 'NO_TLS' });
    }
    const auth = (ehlo.lines.find((l) => /^AUTH[ =]/i.test(l)) || '').toUpperCase();
    if (acc.pass) {
      if (/\bPLAIN\b/.test(auth)) await say('AUTH PLAIN ' + Buffer.from('\0' + acc.user + '\0' + acc.pass, 'utf8').toString('base64'), [235], 'auth');
      else if (/\bLOGIN\b/.test(auth)) { await say('AUTH LOGIN', [334], 'auth'); await say(Buffer.from(acc.user, 'utf8').toString('base64'), [334], 'auth'); await say(Buffer.from(acc.pass, 'utf8').toString('base64'), [235], 'auth'); }
      else throw Object.assign(new Error('NO_AUTH'), { code: 'NO_AUTH' });
    }
  } catch (e) { r.detach(); sock.destroy(); throw e; }
  return {
    tls: sock instanceof tls.TLSSocket,
    async send(from, rcpt, data) {
      await say('MAIL FROM:<' + from + '>', [250], 'from');
      for (const t of rcpt) await say('RCPT TO:<' + t + '>', [250, 251], 'rcpt');
      await say('DATA', [354], 'data');
      sock.write(data + '\r\n.\r\n');
      const rep = await r.next(60000);
      if (rep.code !== 250) throw smtpErr(rep, 'body');
      return rep.text;
    },
    async reset() { try { await say('RSET', [250], 'rset'); } catch (e) { /* соединение уже не годится */ } },
    async close() { try { sock.write('QUIT\r\n'); await Promise.race([r.next(3000), sleep(3000)]); } catch (e) { /* уже закрыто */ } finally { r.detach(); sock.destroy(); } },
  };
}

/* ---------- письмо ---------- */
const clean = (s, n) => String(s == null ? '' : s).replace(/[\r\n\t\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, n);
function word(s) {   // заголовок не только латиницей — RFC 2047, кусками не длиннее 45 байт
  if (/^[\x20-\x7e]*$/.test(s)) return s;
  const parts = []; let cur = '';
  for (const ch of s) { if (Buffer.byteLength(cur + ch) > 45) { parts.push(cur); cur = ch; } else cur += ch; }
  if (cur) parts.push(cur);
  return parts.map((p) => '=?UTF-8?B?' + Buffer.from(p, 'utf8').toString('base64') + '?=').join('\r\n ');
}
const who = (name, email) => { const n = clean(name, 80).replace(/["\\<>]/g, ''); return n ? (/^[\x20-\x7e]*$/.test(n) ? '"' + n + '"' : word(n)) + ' <' + email + '>' : '<' + email + '>'; };
const pad = (n) => String(n).padStart(2, '0');
function rfcDate(d) {   // время в UTC: часовой пояс человека письмо не выдаёт
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getUTCDay()] + ', ' + d.getUTCDate() + ' ' + ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()] + ' ' +
    d.getUTCFullYear() + ' ' + pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()) + ':' + pad(d.getUTCSeconds()) + ' +0000';
}
function build({ fromName, from, to, subject, text }) {
  const body = Buffer.from(String(text).replace(/\r?\n/g, '\r\n'), 'utf8').toString('base64').replace(/.{1,76}/g, '$&\r\n').trimEnd();
  return ['From: ' + who(fromName, from), 'To: <' + to + '>', 'Subject: ' + word(clean(subject, 300)), 'Date: ' + rfcDate(new Date()),
    'Message-ID: <' + crypto.randomBytes(12).toString('hex') + '@' + from.split('@')[1] + '>', 'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: base64', '', body].join('\r\n');
}

/* ---------- понятные ошибки ---------- */
function human(e, acc) {
  const c = e && (e.code || ''), m = String(e && e.message || e);
  if (e && e.smtp) {
    if (e.stage === 'auth') return 'Почта не приняла адрес или пароль. Нужен пароль приложения — не обычный пароль от почты (как его получить — в подсказке ниже). Ещё проверь, что в настройках почты разрешён доступ почтовым программам.';
    if (e.stage === 'rcpt') return 'Сервер не принял адрес получателя: ' + e.text;
    if (e.stage === 'from') return 'Сервер не разрешил отправку с этого адреса: ' + e.text;
    if (e.stage === 'body') return e.smtp >= 500 ? 'Сервер почты отклонил письмо: ' + e.text : 'Сервер почты временно не принял письмо — попробуй позже (' + e.text + ')';
    if (e.smtp === 421 || (e.smtp >= 450 && e.smtp < 460)) return 'Сервер почты временно отказал — попробуй позже (' + e.text + ')';
    return 'Сервер почты ответил: ' + e.smtp + ' ' + e.text;
  }
  if (c === 'ENOTFOUND' || c === 'EAI_AGAIN') return 'Сервер ' + acc.host + ' не найден — проверь адрес сервера и подключение к интернету';
  if (c === 'ECONNREFUSED') return 'Сервер ' + acc.host + ' не принимает соединения на порту ' + acc.port;
  if (c === 'TIMEOUT' || c === 'ETIMEDOUT') return 'Сервер почты не ответил вовремя. Возможно, порт ' + acc.port + ' закрыт антивирусом или сетью';
  if (c === 'ECONNRESET' || c === 'CLOSED' || c === 'EPIPE') return 'Соединение с сервером почты оборвалось. Возможно, порт ' + acc.port + ' закрыт антивирусом или сетью';
  if (c === 'NO_TLS') return 'Сервер не поддерживает шифрование — без него письма с паролем не отправляются';
  if (c === 'NO_AUTH') return 'Сервер не предлагает вход по паролю';
  if (/CERT|SSL|TLS|self.signed|certificate/i.test(c + ' ' + m)) return 'Не удалось установить защищённое соединение с сервером почты: ' + m.slice(0, 120);
  return 'Не получилось: ' + m.slice(0, 160);
}

// проверка входа: подключиться, войти и выйти — ничего не отправляя
async function verify(a, opts) {
  const acc = account(a);
  if (!acc.ok) return acc;
  try { const s = await open(acc, opts); await s.close(); return { ok: true, host: acc.host }; }
  catch (e) { return { ok: false, err: human(e, acc) }; }
}
// отправка пачки писем по одному соединению; между письмами пауза, чтобы почта не приняла это за рассылку
async function sendAll(a, letters, onEach, opts = {}) {
  const acc = account(a);
  if (!acc.ok) return acc;
  let s = null;
  const results = [];
  try {
    for (let i = 0; i < letters.length; i++) {
      const L = letters[i];
      if (!s) {
        // не вышло подключиться или войти — остальные письма тоже не уйдут, сообщаем сразу
        try { s = await open(acc, opts); }
        catch (e) { const err = human(e, acc); for (let j = i; j < letters.length; j++) { results.push({ id: letters[j].id, ok: false, err }); if (onEach) onEach(results[j], j, letters.length); } break; }
      }
      try {
        const data = build({ fromName: L.fromName, from: acc.user, to: L.to, subject: L.subject, text: L.text });
        const reply = await s.send(acc.user, [L.to].concat(L.bccSelf ? [acc.user] : []), data);
        results.push({ id: L.id, ok: true, reply: String(reply).slice(0, 200) });
      } catch (e) {
        results.push({ id: L.id, ok: false, err: human(e, acc) });
        // отказ по одному письму — продолжаем в том же соединении; обрыв — переподключимся
        if (e && e.smtp && (e.stage === 'body' || e.stage === 'rcpt')) await s.reset(); else { await s.close(); s = null; }
      }
      if (onEach) onEach(results[i], i, letters.length);
      if (i < letters.length - 1) await sleep(opts.gap == null ? 2500 : opts.gap);
    }
  } finally { if (s) await s.close(); }
  return { ok: true, results };
}

module.exports = { PRESETS, account, detect, verify, sendAll, build, word, human, EMAIL, _open: open };
