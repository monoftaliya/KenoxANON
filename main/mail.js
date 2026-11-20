// Выгрузка почты для утилит «Забытые аккаунты по почте» и «Отписка от рассылок».
// Читаются только заголовки писем: от кого, тема, дата, ссылка отписки. Тексты писем не читаются.
// Результат отдаётся окну и нигде не сохраняется; путь к выгрузке не запоминается.
const fs = require('fs');
const path = require('path');
const { site } = require('./xray');

const MAX_SENDERS = 20000, MAX_EML = 100000, HEAD_LINES = 400;
const WANT = new Set(['from', 'subject', 'date', 'list-unsubscribe', 'list-unsubscribe-post', 'list-id']);
// письма о регистрации: «добро пожаловать», «подтвердите почту», «аккаунт создан» и то же по-английски
const REG = new RegExp([
  'добро пожаловать', 'подтверд\\S* (свой |ваш |твой )?(адрес|почт|e-?mail|электронн|регистрац|аккаунт|учётн|учетн|профил)', 'подтвержд\\S* (регистрац|почт|адрес)',
  'спасибо за регистрац', 'регистрац\\S* (прошла|завершен|успешн|на сайте|в сервисе)', 'завершите регистрац', 'активир\\S* (аккаунт|учётн|учетн|профил)',
  '(ваш|твой) (аккаунт|профиль|личный кабинет) (создан|готов|зарегистрир)', 'вы зарегистрировал',
  'welcome to', 'welcome,', 'welcome aboard', 'verify your (email|e-mail|account|address)', 'confirm your (email|e-mail|account|address|registration)',
  'activate your (account|profile)', 'account (created|is ready|has been created)', 'thanks? (you )?for (signing up|registering|joining)', 'complete your (registration|sign ?up)',
  'your new account', 'get started with'].join('|'), 'i');
const NOT_REG = /subscription|newsletter|рассылк|подписк/i;

let busy = false, oneClickAllowed = new Set();

/* ---------- заголовки ---------- */
// сырые байты заголовка: UTF-8, а если не получилось — Windows-1251
function rawText(latin1) {
  const b = Buffer.from(latin1, 'latin1');
  try { return new TextDecoder('utf-8', { fatal: true }).decode(b); } catch (e) { try { return new TextDecoder('windows-1251').decode(b); } catch (err) { return latin1; } }
}
// «=?UTF-8?B?...?=» и «=?windows-1251?Q?...?=» → обычный текст
function words(s) {
  return String(s || '').replace(/\?=\s+=\?/g, '?==?').replace(/=\?([^?\s]+)\?([bBqQ])\?([^?]*)\?=/g, (m, cs, enc, txt) => {
    try {
      const bytes = enc.toLowerCase() === 'b' ? Buffer.from(txt, 'base64')
        : Buffer.from(txt.replace(/_/g, ' ').replace(/=([0-9a-fA-F]{2})/g, (x, hx) => String.fromCharCode(parseInt(hx, 16))), 'latin1');
      return new TextDecoder(cs.toLowerCase().replace(/\*.*$/, '')).decode(bytes);
    } catch (e) { return m; }
  });
}
const dec = (v) => words(rawText(v || '')).replace(/\s+/g, ' ').trim();
function headersOf(lines) {
  const h = {}; let cur = null;
  for (let i = 0; i < lines.length && i < HEAD_LINES; i++) {
    const l = lines[i];
    if (/^[ \t]/.test(l)) { if (cur) h[cur] += ' ' + l.trim(); continue; }
    const c = l.indexOf(':'); if (c <= 0) { cur = null; continue; }
    const name = l.slice(0, c).trim().toLowerCase();
    if (WANT.has(name) && !(name in h)) { h[name] = l.slice(c + 1).trim(); cur = name; } else cur = null;
  }
  return h;
}
function parseFrom(v) {
  const m = /<\s*([^<>@\s]+@[^<>\s]+?)\s*>/.exec(v) || /([^\s<>"',;:()]+@[^\s<>"',;:()]+)/.exec(v);
  const addr = m ? m[1].toLowerCase().replace(/[>.]+$/, '') : '';
  let name = v.replace(/<[^>]*>/g, '').replace(/["']/g, '').replace(/\s+/g, ' ').trim();
  if (name.includes('@')) name = '';
  return { addr, name, domain: (addr.split('@')[1] || '').replace(/[^a-z0-9.-]/g, '') };
}
function parseUnsub(v) {
  const out = { https: null, http: null, mailto: null };
  for (const m of String(v).matchAll(/<\s*([^>\s]+)\s*>/g)) {
    const u = m[1];
    if (/^https:\/\//i.test(u) && !out.https) out.https = u.slice(0, 2000);
    else if (/^http:\/\//i.test(u) && !out.http) out.http = u.slice(0, 2000);
    else if (/^mailto:/i.test(u) && !out.mailto) out.mailto = u.slice(7, 400);
  }
  return out;
}
const iso = (v) => { const d = new Date(String(v || '').replace(/\s*\([^)]*\)\s*$/, '')); return Number.isNaN(d.getTime()) || d.getFullYear() < 1995 ? null : d.toISOString(); };

/* ---------- сбор по отправителям ---------- */
function addMessage(agg, h) {
  agg.messages++;
  const from = parseFrom(dec(h.from)); if (!from.domain || !from.domain.includes('.')) return;
  const s = site(from.domain); if (!s) return;
  let e = agg.senders.get(s);
  if (!e) { if (agg.senders.size >= MAX_SENDERS) return; e = { site: s, names: {}, count: 0, first: null, last: null, reg: null, unsub: null }; agg.senders.set(s, e); }
  e.count++;
  const name = (from.name || from.addr).slice(0, 80);
  if (name && (e.names[name] || Object.keys(e.names).length < 12)) e.names[name] = (e.names[name] || 0) + 1;
  const d = iso(h.date);
  if (d) { if (!e.first || d < e.first) e.first = d; if (!e.last || d > e.last) e.last = d; }
  const subj = dec(h.subject);
  if (subj && REG.test(subj) && !NOT_REG.test(subj) && (!e.reg || (d && (!e.reg.date || d < e.reg.date)))) e.reg = { date: d, subject: subj.slice(0, 160) };
  if (h['list-unsubscribe']) {
    const lu = parseUnsub(dec(h['list-unsubscribe'])), one = /list-unsubscribe\s*=\s*one-click/i.test(h['list-unsubscribe-post'] || '');
    const u = e.unsub || (e.unsub = { count: 0, https: null, http: null, mailto: null, oneClick: false, last: null, list: null });
    u.count++;
    if (!u.last || (d && d >= u.last)) {
      if (lu.https) { u.https = lu.https; u.oneClick = one; }
      if (lu.http) u.http = lu.http;
      if (lu.mailto) u.mailto = lu.mailto;
      if (d) u.last = d;
    }
    if (h['list-id']) u.list = dec(h['list-id']).slice(0, 120);
  }
}

/* ---------- чтение: .mbox потоком, .eml по одному ---------- */
async function scanMbox(file, onProgress, agg) {
  const total = fs.statSync(file).size;
  let done = 0, rest = '', inHead = false, head = [], prevBlank = true, nextReport = 0;
  const line = (l) => {
    if (l.charCodeAt(l.length - 1) === 13) l = l.slice(0, -1);
    if (prevBlank && l.startsWith('From ')) { if (inHead && head.length) addMessage(agg, headersOf(head)); inHead = true; head = []; prevBlank = false; return; }
    if (inHead) { if (l === '') { addMessage(agg, headersOf(head)); inHead = false; head = []; } else if (head.length < HEAD_LINES) head.push(l); }
    prevBlank = l === '';
  };
  for await (const chunk of fs.createReadStream(file, { encoding: 'latin1', highWaterMark: 1 << 20 })) {
    done += chunk.length;
    const parts = (rest + chunk).split('\n'); rest = parts.pop();
    for (const l of parts) line(l);
    if (done >= nextReport) { onProgress({ done, total, messages: agg.messages }); nextReport = done + 16 * 1048576; }
  }
  if (rest) line(rest);
  if (inHead && head.length) addMessage(agg, headersOf(head));
  agg.bytes += total; agg.files++;
}
function listEml(dir) {
  const out = [], stack = [dir];
  while (stack.length && out.length < MAX_EML) {
    const d = stack.pop(); let list;
    try { list = fs.readdirSync(d, { withFileTypes: true }); } catch (e) { continue; }
    for (const e of list) {
      if (e.isSymbolicLink()) continue;
      const full = path.join(d, e.name);
      if (e.isDirectory()) stack.push(full); else if (/\.eml$/i.test(e.name)) out.push(full);
      if (out.length >= MAX_EML) break;
    }
  }
  return out;
}
async function scanEml(files, onProgress, agg) {
  const buf = Buffer.alloc(128 * 1024);
  for (let i = 0; i < files.length; i++) {
    let n = 0;
    try { const fd = fs.openSync(files[i], 'r'); try { n = fs.readSync(fd, buf, 0, buf.length, 0); } finally { fs.closeSync(fd); } } catch (e) { continue; }
    const text = buf.toString('latin1', 0, n), end = text.search(/\r?\n\r?\n/);
    addMessage(agg, headersOf((end > 0 ? text.slice(0, end) : text).split(/\r?\n/)));
    agg.bytes += n; agg.files++;
    if (i % 200 === 0) { onProgress({ done: i, total: files.length, messages: agg.messages, files: true }); await new Promise((r) => setImmediate(r)); }
  }
}

function result(agg, t0) {
  const all = [...agg.senders.values()];
  const top = (o) => (Object.entries(o).sort((a, b) => b[1] - a[1])[0] || [''])[0];
  const accounts = all.filter((e) => e.reg).map((e) => ({ site: e.site, name: top(e.names), since: e.reg.date || e.first, subject: e.reg.subject, count: e.count, last: e.last }))
    .sort((a, b) => String(a.since || '9').localeCompare(String(b.since || '9')));
  const lists = all.filter((e) => e.unsub && (e.unsub.https || e.unsub.http || e.unsub.mailto)).map((e) => ({ site: e.site, name: top(e.names), count: e.unsub.count, last: e.unsub.last || e.last,
    https: e.unsub.https, http: e.unsub.http, mailto: e.unsub.mailto, oneClick: !!(e.unsub.oneClick && e.unsub.https), list: e.unsub.list })).sort((a, b) => b.count - a.count);
  oneClickAllowed = new Set(lists.filter((l) => l.oneClick).map((l) => l.https));
  return { ok: true, messages: agg.messages, senders: all.length, files: agg.files, bytes: agg.bytes, ms: Date.now() - t0, accounts, lists };
}

async function scan(p, onProgress) {
  if (busy) return { ok: false, err: 'Уже читаю другую выгрузку — подожди' };
  const file = String(p || '');
  let st; try { st = fs.statSync(file); } catch (e) { return { ok: false, err: 'Файл или папка не найдены' }; }
  busy = true;
  const t0 = Date.now(), agg = { messages: 0, senders: new Map(), files: 0, bytes: 0 };
  try {
    if (st.isDirectory()) {
      const files = listEml(file);
      if (!files.length) return { ok: false, err: 'В папке нет писем .eml. Для Gmail выбери файл .mbox из распакованного архива Google Takeout.' };
      await scanEml(files, onProgress, agg);
    } else if (/\.eml$/i.test(file)) await scanEml([file], onProgress, agg);
    else if (/\.(zip|rar|7z|tgz|gz)$/i.test(file)) return { ok: false, err: 'Это архив. Распакуй его и выбери файл .mbox внутри.' };
    else if (/\.(pst|ost)$/i.test(file)) return { ok: false, err: 'Файлы Outlook (.pst) не поддерживаются. Сохрани письма в .eml или выгрузи почту через Google Takeout или Thunderbird.' };
    else {
      const fd = fs.openSync(file, 'r'), b = Buffer.alloc(4096), n = fs.readSync(fd, b, 0, b.length, 0); fs.closeSync(fd);
      const head = b.toString('latin1', 0, n);
      if (!/^From /.test(head) && !/^(Return-Path|Received|Delivered-To|From|Date|Message-ID|MIME-Version|X-[\w-]+):/im.test(head.slice(0, 2000))) return { ok: false, err: 'Это не похоже на выгрузку почты. Нужен файл .mbox (Google Takeout, Thunderbird) или папка с письмами .eml.' };
      if (/^From /.test(head)) await scanMbox(file, onProgress, agg); else await scanEml([file], onProgress, agg);
    }
    if (!agg.messages) return { ok: false, err: 'Писем не нашлось — проверь, что выбран файл .mbox или папка с письмами .eml' };
    return result(agg, t0);
  } catch (e) { return { ok: false, err: 'Не получилось прочитать: ' + e.message }; }
  finally { busy = false; }
}
// отписка в один клик разрешена только по адресам из последней прочитанной выгрузки
const allowed = (u) => oneClickAllowed.has(u);

module.exports = { scan, allowed, words, parseFrom, parseUnsub, headersOf, REG };
