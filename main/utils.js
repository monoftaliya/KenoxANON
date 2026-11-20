// Утилиты: отметки («отправил», «удалено») и трекер запросов на удаление данных.
// Хранится только на этом компьютере (utilities.json в папке приложения), в сеть ничего не уходит.
// Напоминания не называют компании — только сколько запросов ждут.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

let file = null, data = null;
const fresh = () => ({ v: 1, marks: {}, requests: [] });
// сроки ответа: 152-ФЗ и право на забвение — 10 рабочих дней, GDPR — месяц, иначе — свой срок
const LAWS = { '152': { work: 10 }, search: { work: 10 }, gdpr: { months: 1 }, other: { days: 30 } };
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
const parseYmd = (s) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || '')); return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null; };
function addWork(d, n) { const x = new Date(d); let k = 0; while (k < n) { x.setDate(x.getDate() + 1); const w = x.getDay(); if (w !== 0 && w !== 6) k++; } return x; }
function deadline(sent, law, days) {
  const d = parseYmd(sent) || new Date(), L = LAWS[law] || LAWS.other;
  if (L.work) return ymd(addWork(d, L.work));
  const x = new Date(d);
  if (L.months) {
    // «+1 месяц» от 31 января — это 28 (29) февраля, а не 3 марта
    const day = x.getDate(); x.setDate(1); x.setMonth(x.getMonth() + L.months);
    x.setDate(Math.min(day, new Date(x.getFullYear(), x.getMonth() + 1, 0).getDate()));
  } else x.setDate(x.getDate() + Math.max(1, Math.min(365, Number(days) || L.days)));
  return ymd(x);
}

function load(dir) {
  file = path.join(dir, 'utilities.json');
  try { data = Object.assign(fresh(), JSON.parse(fs.readFileSync(file, 'utf8'))); } catch (e) { data = fresh(); }
  if (!data.marks || typeof data.marks !== 'object' || Array.isArray(data.marks)) data.marks = {};
  if (!Array.isArray(data.requests)) data.requests = [];
}
function save() { try { const tmp = file + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(data)); fs.renameSync(tmp, file); } catch (e) { /* без сохранения */ } }
const get = () => data;
const S = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n);

// отметка вида «группа:пункт» → { s: sent | done | none | keep, at, check }; пустой статус снимает отметку
const KEY = /^[a-z0-9-]{1,24}:[a-z0-9-]{1,40}$/;
// label — подпись для отметок, которые человек добавил сам (например, название сервиса в «Обезличить аккаунт»)
function mark(key, status, checkDays, label) {
  if (!KEY.test(String(key))) return data;
  if (!status) delete data.marks[key];
  else {
    if (!/^(sent|done|none|keep)$/.test(status)) return data;
    const m = { s: status, at: new Date().toISOString() };
    const prev = data.marks[key], l = S(label, 80) || (prev && prev.label) || '';
    if (l) m.label = l;
    if (status === 'sent' && Number(checkDays) > 0) { const x = new Date(); x.setDate(x.getDate() + Math.min(365, Math.round(Number(checkDays)))); m.check = ymd(x); }
    data.marks[key] = m;
  }
  save(); return data;
}

function addRequest(r) {
  const law = Object.prototype.hasOwnProperty.call(LAWS, r.law) ? r.law : 'other';
  const today = ymd(new Date()), sent = parseYmd(r.sent) && r.sent <= today ? r.sent : today;
  const req = { id: crypto.randomBytes(6).toString('hex'), to: S(r.to, 200) || 'без названия', law, days: law === 'other' ? Math.max(1, Math.min(365, Math.round(Number(r.days) || 30))) : null,
    sent, deadline: null, status: 'sent', note: S(r.note, 500), created: new Date().toISOString() };
  req.deadline = deadline(req.sent, req.law, req.days);
  data.requests.unshift(req); data.requests = data.requests.slice(0, 500);
  save(); return data;
}
function setRequest(id, p) {
  const r = data.requests.find((x) => x.id === id);
  if (!r) return data;
  if (p.status && /^(sent|answered|done|refused)$/.test(p.status)) { r.status = p.status; r.changed = new Date().toISOString(); if (p.status === 'sent') r.notified = false; }
  if (p.note != null) r.note = S(p.note, 500);
  save(); return data;
}
function removeRequest(id) { data.requests = data.requests.filter((x) => x.id !== id); save(); return data; }

// раз в полчаса: просроченные запросы и отметки «отправил», которые пора проверить (каждая — одно уведомление)
function remind(notify) {
  if (!data) return;
  const today = ymd(new Date());
  const overdue = data.requests.filter((r) => r.status === 'sent' && r.deadline < today && !r.notified);
  const checks = Object.values(data.marks).filter((m) => m.s === 'sent' && m.check && m.check <= today && !m.notified);
  if (overdue.length) notify('Срок ответа истёк', 'Запросов на удаление без ответа в срок: ' + overdue.length + '. Открой «Утилиты» → «Трекер запросов на удаление».');
  if (checks.length) notify('Пора проверить удаление', 'Отметок «отправил», которые пора проверить: ' + checks.length + '. Открой «Утилиты».');
  overdue.forEach((r) => { r.notified = true; });
  checks.forEach((m) => { m.notified = true; });
  if (overdue.length || checks.length) save();
}

module.exports = { load, get, mark, addRequest, setRequest, removeRequest, remind, deadline };
