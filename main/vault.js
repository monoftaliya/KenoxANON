// Персональное хранилище данных: одна локальная база SQLite в папке приложения.
// Сюда попадает только то, что человек сам загрузил (официальные выгрузки сервисов), указал (папки с файлами) или сохранил из «Читалки».
// Ничего не отправляется в сеть. Удалить можно запись, найденное, источник или всё хранилище целиком.
//
// Пароль на хранилище: база целиком шифруется AES-256-GCM. Ключ данных случайный, он сам зашифрован ключом из пароля (scrypt).
// Пока хранилище открыто, расшифрованная база живёт только в памяти; на диске — только зашифрованный файл vault.kxv.
// Пароль нигде не сохраняется. Забыл пароль — данные не вернуть, можно только стереть хранилище.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');
const JSZip = require('jszip');
const { DatabaseSync } = require('node:sqlite');
const { IMPORTERS, isDiscordIndex } = require('./importers');

const CATS = ['history', 'bookmark', 'contact', 'message', 'media', 'file', 'activity'];
const MEDIA = { image: ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.heic', '.heif', '.bmp', '.tif', '.tiff'], video: ['.mp4', '.mov', '.m4v', '.avi', '.mkv', '.webm', '.3gp'], audio: ['.mp3', '.ogg', '.oga', '.opus', '.m4a', '.wav', '.flac', '.aac'] };
const KIND = Object.fromEntries(Object.entries(MEDIA).flatMap(([k, list]) => list.map((e) => [e, k])));
const TEXT = new Set(['.json', '.html', '.htm', '.csv', '.vcf', '.txt']);
const MAX_TEXT = 600 * 1024 * 1024, MAX_ZIP = 1900 * 1024 * 1024, MAX_FILES = 200000;
const tick = () => new Promise((r) => setImmediate(r));
const strip = (t) => (t.charCodeAt(0) === 0xfeff ? t.slice(1) : t);

/* ---------- схема: одна таблица записей для всех видов данных ---------- */
const WAL = 'PRAGMA journal_mode = WAL;';   // только для файла на диске; база в памяти (под паролем) живёт без журнала
const SCHEMA = `
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS sources (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,            -- что загружено: имя архива или папки
  kind TEXT NOT NULL,            -- export (выгрузка сервиса) | folder (папка с файлами) | saved (страницы из «Читалки»)
  origin TEXT,                   -- откуда загружено
  added TEXT NOT NULL,           -- когда
  count INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS items (
  id INTEGER PRIMARY KEY,
  key TEXT UNIQUE,               -- отпечаток записи: повторная загрузка не создаёт дублей
  source_id INTEGER NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  category TEXT NOT NULL,        -- history | bookmark | contact | message | media | file | activity
  service TEXT,                  -- telegram, discord, chrome, youtube, instagram, whatsapp, contacts, files, reader…
  title TEXT, body TEXT, url TEXT,
  who TEXT,                      -- автор сообщения
  place TEXT,                    -- чат, канал, папка, сайт
  ts TEXT,                       -- время в ISO 8601
  extra TEXT                     -- прочие поля в JSON
);
CREATE INDEX IF NOT EXISTS items_cat ON items(category, ts);
CREATE INDEX IF NOT EXISTS items_src ON items(source_id);
CREATE TABLE IF NOT EXISTS tags (
  item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  tag TEXT NOT NULL,
  PRIMARY KEY (item_id, tag)
);
CREATE INDEX IF NOT EXISTS tags_tag ON tags(tag);
CREATE VIRTUAL TABLE IF NOT EXISTS items_fts USING fts5(title, body, url, who, place, content='items', content_rowid='id', tokenize='unicode61 remove_diacritics 2');
CREATE TRIGGER IF NOT EXISTS items_ai AFTER INSERT ON items BEGIN
  INSERT INTO items_fts(rowid, title, body, url, who, place) VALUES (new.id, new.title, new.body, new.url, new.who, new.place);
END;
CREATE TRIGGER IF NOT EXISTS items_ad AFTER DELETE ON items BEGIN
  INSERT INTO items_fts(items_fts, rowid, title, body, url, who, place) VALUES ('delete', old.id, old.title, old.body, old.url, old.who, old.place);
END;`;

let db = null, dbFile = null, encFile = null;
let enc = null;                         // хранилище открыто паролем: { dek, header, headerBuf }
let cfg = { idle: 15 }, onLock = () => {};
let dirtyT = null, idleT = null, busy = 0, pendingLock = null, fails = 0;
const LOCKED = { ok: false, locked: true, err: 'Хранилище заперто паролем' };
const MAGIC = Buffer.from('KXV1'), TAIL = Buffer.from('KXVE');
const KDF = { N: 1 << 17, r: 8, p: 1 }, MAXMEM = 256 * 1024 * 1024;

const all = (sql, ...a) => db.prepare(sql).all(...a);
const one = (sql, ...a) => db.prepare(sql).get(...a);
const run = (sql, ...a) => db.prepare(sql).run(...a);
const txn = (fn) => { db.exec('BEGIN'); try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; } };
const fileSize = (f) => { try { return fs.statSync(f).size; } catch (e) { return 0; } };

/* ---------- файлы: затирание и зашифрованный снимок ---------- */
// перезаписать случайными байтами (на месте) — keep: файл остаётся, иначе удаляется
function scrub(f, keep) {
  try {
    if (!fs.existsSync(f)) return;
    const size = fs.statSync(f).size, fd = fs.openSync(f, 'r+'), chunk = Buffer.alloc(1 << 20);
    for (let off = 0; off < size; off += chunk.length) { crypto.randomFillSync(chunk); fs.writeSync(fd, chunk, 0, Math.min(chunk.length, size - off), off); }
    fs.fsyncSync(fd); fs.closeSync(fd);
    if (!keep) fs.rmSync(f, { force: true });
  } catch (e) { /* файл занят — удалится в следующий раз */ }
}
const shred = (list) => list.forEach((f) => scrub(f, false));
// снимок полный, если в конце есть метка и длина совпадает (прерванная запись не подменит рабочий файл)
function complete(buf) {
  if (buf.length < 48 || !buf.subarray(0, 4).equals(MAGIC)) return false;
  const t = buf.subarray(buf.length - 8);
  return t.subarray(0, 4).equals(TAIL) && t.readUInt32BE(4) === buf.length - 8;
}
function parts(buf) {
  if (!complete(buf)) throw new Error('Файл хранилища повреждён');
  const hl = buf.readUInt32BE(4), headerBuf = Buffer.from(buf.subarray(8, 8 + hl));
  return { header: JSON.parse(headerBuf.toString('utf8')), headerBuf, iv: buf.subarray(8 + hl, 20 + hl), tag: buf.subarray(20 + hl, 36 + hl), data: buf.subarray(36 + hl, buf.length - 8) };
}
function decryptImage(p, dek) {
  const d = crypto.createDecipheriv('aes-256-gcm', dek, p.iv); d.setAAD(p.headerBuf); d.setAuthTag(p.tag);
  const z = Buffer.concat([d.update(p.data), d.final()]), img = zlib.gunzipSync(z); z.fill(0);
  return img;
}
// записать зашифрованный снимок: сначала новый файл целиком, потом старый затирается и заменяется новым
function save() {
  if (!enc || !db) return;
  clearTimeout(dirtyT); dirtyT = null;
  const img = db.serialize(), z = zlib.gzipSync(img, { level: 1 }); img.fill(0);
  const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', enc.dek, iv); c.setAAD(enc.headerBuf);
  const ct = Buffer.concat([c.update(z), c.final()]), tag = c.getAuthTag(); z.fill(0);
  const len = Buffer.alloc(4); len.writeUInt32BE(enc.headerBuf.length);
  const bodyBuf = Buffer.concat([MAGIC, len, enc.headerBuf, iv, tag, ct]), tail = Buffer.alloc(8); TAIL.copy(tail); tail.writeUInt32BE(bodyBuf.length, 4);
  const tmp = encFile + '.tmp', fd = fs.openSync(tmp, 'w');
  try { fs.writeSync(fd, bodyBuf); fs.writeSync(fd, tail); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  scrub(encFile, true);
  fs.renameSync(tmp, encFile);
}
const changed = () => { if (!enc) return; clearTimeout(dirtyT); dirtyT = setTimeout(() => { try { save(); } catch (e) { /* повторится при следующем изменении или при запирании */ } }, 1500); };
const touchIdle = () => { clearTimeout(idleT); idleT = null; if (enc && db && cfg.idle > 0) idleT = setTimeout(() => lock('idle'), cfg.idle * 60e3); };

/* ---------- ключи ---------- */
const scrypt = (pw, salt, k) => new Promise((res, rej) => crypto.scrypt(Buffer.from(String(pw).normalize('NFC'), 'utf8'), salt, 32, { N: k.N, r: k.r, p: k.p, maxmem: MAXMEM }, (e, key) => (e ? rej(e) : res(key))));
async function makeHeader(pw, dek) {
  const salt = crypto.randomBytes(16), kek = await scrypt(pw, salt, KDF), iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', kek, iv); c.setAAD(Buffer.from('KXV1-key'));
  const wrapped = Buffer.concat([c.update(dek), c.final(), c.getAuthTag()]); kek.fill(0);
  const header = { v: 1, cipher: 'aes-256-gcm', zip: 'gzip', kdf: { name: 'scrypt', N: KDF.N, r: KDF.r, p: KDF.p, salt: salt.toString('base64') }, key: { iv: iv.toString('base64'), data: wrapped.toString('base64') }, created: new Date().toISOString() };
  return { header, headerBuf: Buffer.from(JSON.stringify(header), 'utf8') };
}
async function unwrap(header, pw) {
  const k = header && header.kdf; if (!k || k.name !== 'scrypt') return null;
  const kek = await scrypt(pw, Buffer.from(k.salt, 'base64'), k);
  try {
    const w = Buffer.from(header.key.data, 'base64'), d = crypto.createDecipheriv('aes-256-gcm', kek, Buffer.from(header.key.iv, 'base64'));
    d.setAAD(Buffer.from('KXV1-key')); d.setAuthTag(w.subarray(w.length - 16));
    return Buffer.concat([d.update(w.subarray(0, w.length - 16)), d.final()]);
  } catch (e) { return null; } finally { kek.fill(0); }
}
function checkPw(pw) {
  const s = String(pw || '');
  if (s.length < 8) return { ok: false, err: 'Пароль короче 8 символов' };
  if (s.length > 256) return { ok: false, err: 'Пароль длиннее 256 символов' };
  if (/^(.)\1+$/.test(s)) return { ok: false, err: 'Пароль из одного повторяющегося символа' };
  return { ok: true };
}
const wrongPause = () => new Promise((r) => setTimeout(r, Math.min(10000, 400 * 2 ** Math.min(fails, 5))));

/* ---------- открытие ---------- */
function open(dir, opts) {
  dbFile = path.join(dir, 'vault.db'); encFile = path.join(dir, 'vault.kxv');
  if (opts && typeof opts.onLock === 'function') onLock = opts.onLock;
  const tmp = encFile + '.tmp';
  // прерванное сохранение: целый новый снимок заменяет старый, оборванный — затирается
  if (fs.existsSync(tmp)) {
    let ok = false; try { ok = complete(fs.readFileSync(tmp)); } catch (e) { ok = false; }
    if (ok) { scrub(encFile, true); try { fs.renameSync(tmp, encFile); } catch (e) { /* попробуем при следующем запуске */ } } else shred([tmp]);
  }
  if (fs.existsSync(encFile)) {
    db = null; enc = null;
    // открытый файл мог остаться, если включение пароля прервалось: данные уже в зашифрованном файле
    shred([dbFile, dbFile + '-wal', dbFile + '-shm']);
    return;
  }
  db = new DatabaseSync(dbFile); db.exec(WAL + SCHEMA);
}
function configure(c) {
  const n = Number(c && c.idle);
  cfg.idle = Number.isFinite(n) ? Math.max(0, Math.min(1440, Math.round(n))) : 15;
  touchIdle();
  return { ok: true, idle: cfg.idle };
}
function status() { return { ok: true, encrypted: !!enc || (!!encFile && fs.existsSync(encFile)), locked: !db, idle: cfg.idle, fails }; }

async function unlock(pw) {
  if (db) return { ok: true };
  if (!fs.existsSync(encFile)) return { ok: false, err: 'Хранилище не защищено паролем' };
  let p; try { p = parts(fs.readFileSync(encFile)); } catch (e) { return { ok: false, err: e.message }; }
  const dek = await unwrap(p.header, pw);
  if (!dek) { fails++; await wrongPause(); return { ok: false, err: 'Неверный пароль' + (fails >= 3 ? ' · неудачных попыток подряд: ' + fails : '') }; }
  if (db) { dek.fill(0); return { ok: true }; }   // пока проверялся пароль, хранилище уже открыли
  let img;
  try { img = decryptImage(p, dek); } catch (e) { dek.fill(0); return { ok: false, err: 'Файл хранилища повреждён или изменён вне приложения' }; }
  const mem = new DatabaseSync(':memory:');
  try { mem.deserialize(img); mem.exec(SCHEMA); } catch (e) { mem.close(); dek.fill(0); return { ok: false, err: 'Не удалось открыть базу: ' + e.message }; } finally { img.fill(0); }
  db = mem; enc = { dek, header: p.header, headerBuf: p.headerBuf }; fails = 0; touchIdle();
  return { ok: true };
}
// запереть: снимок сохраняется, база в памяти закрывается, ключ затирается
function lock(why) {
  if (!enc || !db) return { ok: true, locked: !db };
  if (busy) { pendingLock = why || 'manual'; return { ok: true, deferred: true }; }
  try { save(); } catch (e) { return { ok: false, err: 'Не удалось сохранить хранилище: ' + e.message }; }
  try { db.close(); } catch (e) { /* уже закрыта */ }
  db = null; enc.dek.fill(0); enc = null; clearTimeout(idleT); idleT = null;
  try { onLock(why || 'manual'); } catch (e) { /* окно уже закрыто */ }
  return { ok: true };
}

async function setPassword(pw, journal) {
  if (!db) return LOCKED;
  if (enc) return { ok: false, err: 'Пароль уже стоит' };
  const v = checkPw(pw); if (!v.ok) return v;
  if (busy) return { ok: false, err: 'Подожди, пока закончится загрузка' };
  const before = one('SELECT COUNT(*) AS n FROM items').n;
  const mem = new DatabaseSync(':memory:');
  try {
    mem.exec(SCHEMA);
    try { db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); } catch (e) { /* не страшно: ATTACH прочитает и WAL */ }
    mem.prepare('ATTACH DATABASE ? AS p').run(dbFile);
    mem.exec('BEGIN;'
      + ' INSERT INTO sources (id, name, kind, origin, added, count) SELECT id, name, kind, origin, added, count FROM p.sources;'
      + ' INSERT INTO items (id, key, source_id, category, service, title, body, url, who, place, ts, extra) SELECT id, key, source_id, category, service, title, body, url, who, place, ts, extra FROM p.items;'
      + ' INSERT INTO tags (item_id, tag) SELECT item_id, tag FROM p.tags;'
      + ' COMMIT; DETACH DATABASE p;');
  } catch (e) { try { mem.close(); } catch (err) { /* закрыта */ } return { ok: false, err: 'Не получилось подготовить базу: ' + e.message }; }
  const dek = crypto.randomBytes(32), h = await makeHeader(pw, dek);
  const old = db;
  enc = { dek, header: h.header, headerBuf: h.headerBuf }; db = mem;
  try {
    save();
    // проверка: зашифрованный файл расшифровывается и в нём столько же записей
    const img = decryptImage(parts(fs.readFileSync(encFile)), dek), t = new DatabaseSync(':memory:');
    t.deserialize(img); img.fill(0);
    const n = t.prepare('SELECT COUNT(*) AS n FROM items').get().n; t.close();
    if (n !== before) throw new Error('проверка копии не сошлась');
  } catch (e) {
    db = old; enc = null; dek.fill(0); try { mem.close(); } catch (err) { /* закрыта */ } shred([encFile, encFile + '.tmp']);
    return { ok: false, err: 'Не получилось зашифровать: ' + e.message };
  }
  try { old.close(); } catch (e) { /* закрыта */ }
  shred([dbFile, dbFile + '-wal', dbFile + '-shm']);
  if (journal) journal.add('fix', 'Хранилище: поставлен пароль', 'база зашифрована (AES-256-GCM, ключ из пароля через scrypt), открытый файл перезаписан и удалён');
  touchIdle();
  return { ok: true, items: before };
}
async function changePassword(oldPw, newPw, journal) {
  if (!db) return LOCKED;
  if (!enc) return { ok: false, err: 'Пароль не установлен' };
  const v = checkPw(newPw); if (!v.ok) return v;
  const dek = await unwrap(enc.header, oldPw);
  if (!dek) { fails++; await wrongPause(); return { ok: false, err: 'Текущий пароль неверный' }; }
  dek.fill(0); fails = 0;
  if (!enc || !db) return LOCKED;
  touchIdle();
  const key = Buffer.from(enc.dek), h = await makeHeader(newPw, key); key.fill(0);
  if (!enc || !db) return LOCKED;   // пока считался ключ, хранилище заперли — старый пароль остаётся в силе
  enc.header = h.header; enc.headerBuf = h.headerBuf;
  save();
  if (journal) journal.add('fix', 'Хранилище: пароль сменён', 'ключ данных зашифрован новым паролем');
  touchIdle();
  return { ok: true };
}
async function removePassword(pw, journal) {
  if (!db) return LOCKED;
  if (!enc) return { ok: false, err: 'Пароль не установлен' };
  if (busy) return { ok: false, err: 'Подожди, пока закончится загрузка' };
  const dek = await unwrap(enc.header, pw);
  if (!dek) { fails++; await wrongPause(); return { ok: false, err: 'Неверный пароль' }; }
  dek.fill(0); fails = 0;
  if (!enc || !db) return LOCKED;
  clearTimeout(dirtyT); dirtyT = null;
  const n0 = one('SELECT COUNT(*) AS n FROM items').n;
  let file = null;
  try {
    shred([dbFile + '-wal', dbFile + '-shm']);
    const img = db.serialize(); fs.writeFileSync(dbFile, img); img.fill(0);
    file = new DatabaseSync(dbFile); file.exec(WAL + SCHEMA);
    if (file.prepare('SELECT COUNT(*) AS n FROM items').get().n !== n0) throw new Error('проверка копии не сошлась');
  } catch (e) {
    try { if (file) file.close(); } catch (err) { /* закрыта */ }
    shred([dbFile, dbFile + '-wal', dbFile + '-shm']);
    return { ok: false, err: 'Не получилось снять пароль: ' + e.message };
  }
  try { db.close(); } catch (e) { /* закрыта */ }
  db = file; enc.dek.fill(0); enc = null; clearTimeout(idleT); idleT = null;
  shred([encFile, encFile + '.tmp']);
  if (journal) journal.add('fix', 'Хранилище: пароль снят', 'база снова хранится открытым файлом');
  return { ok: true };
}

/* ---------- запись ---------- */
const str = (v, n = 20000) => (v == null || v === '' ? null : String(v).slice(0, n));
function writer(sourceId) {
  const ins = db.prepare('INSERT OR IGNORE INTO items (key, source_id, category, service, title, body, url, who, place, ts, extra) VALUES (?,?,?,?,?,?,?,?,?,?,?)');
  let buf = [], added = 0;
  const flush = () => {
    if (!buf.length) return;
    const list = buf; buf = [];
    txn(() => {
      for (const it of list) {
        const f = [it.category, str(it.service), str(it.title, 500), str(it.body), str(it.url, 2000), str(it.who, 200), str(it.place, 500), str(it.ts, 40)];
        const key = crypto.createHash('sha1').update(f.join('\u001f')).digest('hex');
        added += ins.run(key, sourceId, ...f, it.extra ? JSON.stringify(it.extra) : null).changes;
      }
    });
  };
  return { add(it) { if (it && CATS.includes(it.category)) buf.push(it); }, flush, pending: () => buf.length, added: () => added };
}
function addSource(name, kind, origin) { return Number(run('INSERT INTO sources (name, kind, origin, added) VALUES (?,?,?,?)', name, kind, origin, new Date().toISOString()).lastInsertRowid); }
function finishSource(id) {
  const n = one('SELECT COUNT(*) AS n FROM items WHERE source_id = ?', id).n;
  if (n) run('UPDATE sources SET count = ? WHERE id = ?', n, id); else run('DELETE FROM sources WHERE id = ?', id);
  return n;
}

/* ---------- обход архива или папки ---------- */
const SYS = () => [process.env.SystemRoot, process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.ProgramData].filter(Boolean).map((p) => path.resolve(p).toLowerCase());
function tooBroad(p) {
  const n = path.resolve(p).toLowerCase().replace(/[\\/]+$/, '');
  return /^[a-z]:$/.test(n) || SYS().some((s) => n === s || n.startsWith(s + '\\'));
}
async function walk(root, onEntry) {
  const stack = [root]; let n = 0;
  while (stack.length && n < MAX_FILES) {
    const d = stack.pop(); let list;
    try { list = fs.readdirSync(d, { withFileTypes: true }); } catch (e) { continue; }
    for (const e of list) {
      if (e.name.startsWith('.') || e.name === 'node_modules' || e.isSymbolicLink()) continue;
      const full = path.join(d, e.name);
      if (e.isDirectory()) { stack.push(full); continue; }
      if (!e.isFile()) continue;
      let st; try { st = fs.statSync(full); } catch (err) { continue; }
      await onEntry({ rel: path.relative(root, full), size: st.size, mtime: st.mtime.toISOString(), real: full, read: async () => fs.readFileSync(full) });
      if (++n >= MAX_FILES) break;
      if (n % 1000 === 0) await tick();
    }
  }
  return n;
}
async function entriesOf(p) {
  const st = fs.statSync(p), out = [];
  if (st.isDirectory()) { await walk(p, (e) => { out.push(e); }); return out; }
  if (path.extname(p).toLowerCase() === '.zip') {
    if (st.size > MAX_ZIP) throw new Error('архив больше 1,9 ГБ — распакуй его и выбери папку');
    const zip = await JSZip.loadAsync(fs.readFileSync(p));
    zip.forEach((rel, f) => { if (!f.dir) out.push({ rel, size: (f._data && f._data.uncompressedSize) || 0, mtime: f.date ? f.date.toISOString() : null, real: null, read: () => f.async('nodebuffer') }); });
    return out;
  }
  return [{ rel: path.basename(p), size: st.size, mtime: st.mtime.toISOString(), real: p, read: async () => fs.readFileSync(p) }];
}

/* ---------- загрузка официальных выгрузок ---------- */
async function importPaths(paths, onProgress, journal) {
  const results = [];
  for (const p of paths.slice(0, 20)) {
    let entries;
    try { entries = await entriesOf(p); } catch (e) { results.push({ origin: p, name: path.basename(p), error: e.message }); continue; }
    const src = addSource(path.basename(p), 'export', p), w = writer(src);
    const ctx = { discordIndex: {}, recognized: {}, unknown: [], skipped: [] };
    for (const e of entries) {
      if (!/messages[\\/]index\.json$/i.test(e.rel)) continue;
      try { const d = JSON.parse(strip((await e.read()).toString('utf8'))); if (isDiscordIndex(e.rel, d)) Object.assign(ctx.discordIndex, d); } catch (err) { /* не индекс */ }
    }
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i], ext = path.extname(e.rel).toLowerCase();
      if (i % 25 === 0) { onProgress({ name: path.basename(p), file: e.rel, done: i, total: entries.length }); await tick(); }
      if (KIND[ext]) {   // медиа из выгрузки: только имя, размер и место, содержимое не читается
        w.add({ category: 'media', service: 'export', title: path.basename(e.rel), place: path.dirname(e.rel) === '.' ? '' : path.dirname(e.rel), url: e.real || '', ts: e.mtime, extra: { size: e.size, kind: KIND[ext] } });
        continue;
      }
      if (!TEXT.has(ext) || /messages[\\/](index|.+[\\/]channel)\.json$/i.test(e.rel)) continue;   // служебные файлы Discord
      if (e.size > MAX_TEXT) { ctx.skipped.push(e.rel + ' — больше 600 МБ'); continue; }
      let data;
      try { data = strip((await e.read()).toString('utf8')); if (ext === '.json') data = JSON.parse(data); } catch (err) { ctx.unknown.push(e.rel); continue; }
      const imp = IMPORTERS.find((x) => { try { return x.ext.includes(ext) && x.test(data, e); } catch (err) { return false; } });
      if (!imp) { ctx.unknown.push(e.rel); continue; }
      try { const items = imp.parse(data, e, ctx); items.forEach((it) => w.add(it)); ctx.recognized[imp.name] = (ctx.recognized[imp.name] || 0) + items.length; }
      catch (err) { (err.skip ? ctx.skipped : ctx.unknown).push(e.rel + (err.skip ? ' — ' + err.message : '')); }
      data = null;
      if (w.pending() > 2000) { w.flush(); await tick(); }
    }
    w.flush();
    const added = finishSource(src);
    onProgress({ name: path.basename(p), done: entries.length, total: entries.length });
    if (added && journal) journal.add('fix', 'Хранилище: загружена выгрузка', path.basename(p) + ' · ' + added + ' записей');
    results.push({ origin: p, name: path.basename(p), files: entries.length, added, recognized: ctx.recognized, unknown: ctx.unknown.slice(0, 30), unknownCount: ctx.unknown.length, skipped: ctx.skipped.slice(0, 30) });
  }
  return { ok: true, results };
}

/* ---------- индекс выбранной папки: имена, размеры и даты файлов (содержимое не читается) ---------- */
async function indexFolder(dir, onProgress, journal) {
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return { ok: false, err: 'Папка не найдена' };
  if (tooBroad(dir)) return { ok: false, err: 'Выбери конкретную папку — не весь диск и не системную папку' };
  const src = addSource(path.basename(dir) || dir, 'folder', dir), w = writer(src);
  const n = await walk(dir, async (e) => {
    const ext = path.extname(e.rel).toLowerCase(), rel = path.dirname(e.rel);
    w.add({ category: KIND[ext] ? 'media' : 'file', service: 'files', title: path.basename(e.rel), url: e.real, place: rel === '.' ? '' : rel, ts: e.mtime, extra: { size: e.size, ext, kind: KIND[ext] || null } });
    if (w.pending() >= 1000) { w.flush(); onProgress({ name: path.basename(dir), done: w.added(), total: 0 }); }
  });
  w.flush();
  const added = finishSource(src);
  if (added && journal) journal.add('fix', 'Хранилище: проиндексирована папка', dir + ' · ' + added + ' файлов');
  return { ok: true, files: n, added, limited: n >= MAX_FILES };
}

/* ---------- тихие закладки: текст страницы из «Читалки» ---------- */
const pageKey = (url) => 'page:' + crypto.createHash('sha1').update(String(url)).digest('hex');
function savePage(p) {
  const url = String((p && p.url) || '');
  if (!/^https?:\/\/\S+$/i.test(url)) return { ok: false, err: 'У страницы нет адреса' };
  const key = pageKey(url), old = one('SELECT id FROM items WHERE key = ?', key);
  const oldTags = old ? all('SELECT tag FROM tags WHERE item_id = ?', old.id).map((r) => r.tag) : [];
  const s = one("SELECT id FROM sources WHERE kind = 'saved'"), srcId = s ? s.id : addSource('Сохранённые страницы', 'saved', 'KenoxANON · Читалка');
  const extra = { saved: true, site: str(p.site, 200), words: Number(p.words) || 0, blocks: Array.isArray(p.blocks) ? p.blocks : null };
  let ej = JSON.stringify(extra);
  if (ej.length > 3e6) { extra.blocks = null; ej = JSON.stringify(extra); }   // очень большие статьи хранятся только текстом
  const id = txn(() => {
    if (old) run('DELETE FROM items WHERE id = ?', old.id);
    return Number(run('INSERT INTO items (key, source_id, category, service, title, body, url, who, place, ts, extra) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
      key, srcId, 'bookmark', 'reader', str(p.title, 500) || url, str(p.text, 600000), str(url, 2000), null, str(p.site, 500), new Date().toISOString(), ej).lastInsertRowid);
  });
  const tags = [...new Set([...oldTags, ...(Array.isArray(p.tags) ? p.tags : []).map(cleanTag).filter(Boolean)])].slice(0, 20);
  if (tags.length) { const ins = db.prepare('INSERT OR IGNORE INTO tags (item_id, tag) VALUES (?, ?)'); txn(() => tags.forEach((t) => ins.run(id, t))); }
  finishSource(srcId);
  return { ok: true, id, updated: !!old, tags };
}
const pageSaved = (url) => { const r = one('SELECT id FROM items WHERE key = ?', pageKey(url)); return { ok: true, saved: !!r, id: r ? r.id : null }; };

/* ---------- псевдонимы почты: какой адрес где использован (утилита «Псевдонимы почты») ---------- */
const ALIAS = /^[^\s@<>()",;:\\[\]]{1,64}@(?:[a-z0-9-]{1,63}\.)+[a-z]{2,24}$/i;
function saveAlias(p) {
  const alias = String((p && p.alias) || '').trim().toLowerCase(), site = str(String((p && p.site) || '').trim(), 200), provider = str(String((p && p.provider) || '').trim(), 100);
  if (!ALIAS.test(alias)) return { ok: false, err: 'Это не похоже на адрес почты' };
  if (!site) return { ok: false, err: 'Напиши, где используется этот адрес' };
  const key = 'alias:' + crypto.createHash('sha1').update(alias + '\u001f' + site.toLowerCase()).digest('hex');
  if (one('SELECT id FROM items WHERE key = ?', key)) return { ok: false, err: 'Такая запись уже есть' };
  const s = one("SELECT id FROM sources WHERE kind = 'alias'"), srcId = s ? s.id : addSource('Псевдонимы почты', 'alias', 'KenoxANON · Утилиты');
  const id = Number(run('INSERT INTO items (key, source_id, category, service, title, body, url, who, place, ts, extra) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
    key, srcId, 'contact', 'alias', alias, 'Псевдоним почты для: ' + site + (provider ? ' · сервис псевдонимов: ' + provider : ''), null, site, provider, new Date().toISOString(), JSON.stringify({ alias: true })).lastInsertRowid);
  finishSource(srcId);
  return { ok: true, id };
}
const aliases = () => ({ ok: true, list: all("SELECT id, title AS alias, who AS site, place AS provider, ts FROM items WHERE service = 'alias' ORDER BY ts DESC LIMIT 2000") });
function item(id) {
  const r = one('SELECT * FROM items WHERE id = ?', Number(id));
  if (!r) return { ok: false, err: 'Запись не найдена' };
  return { ok: true, item: { ...r, extra: r.extra ? JSON.parse(r.extra) : null } };
}

/* ---------- поиск и фильтры ---------- */
// Запрос пользователя превращается в безопасный запрос FTS5: каждое слово — в кавычках и с поиском по началу слова
const ftsQuery = (q) => (String(q).match(/[\p{L}\p{N}_@.+-]+/gu) || []).slice(0, 12).map((w) => '"' + w.replace(/"/g, '') + '"*').join(' ');
function where(f) {
  const w = [], a = []; let from = 'items i';
  const q = f.q ? ftsQuery(f.q) : '';
  if (q) { from = 'items_fts JOIN items i ON i.id = items_fts.rowid'; w.push('items_fts MATCH ?'); a.push(q); }
  if (f.category && CATS.includes(f.category)) { w.push('i.category = ?'); a.push(f.category); }
  if (f.source) { w.push('i.source_id = ?'); a.push(Number(f.source)); }
  if (f.tag) { w.push('EXISTS (SELECT 1 FROM tags t WHERE t.item_id = i.id AND t.tag = ?)'); a.push(String(f.tag)); }
  return { from, sql: w.length ? ' WHERE ' + w.join(' AND ') : '', a, q };
}
// в списке не нужен весь текст сохранённых страниц и их разметка — только начало и признак
const slim = (x) => { if (!x || !x.blocks) return x; const { blocks, ...rest } = x; return { ...rest, hasBlocks: true }; };
function query(f) {
  const { from, sql, a, q } = where(f), limit = Math.min(200, Number(f.limit) || 50), offset = Math.max(0, Number(f.offset) || 0);
  const total = one('SELECT COUNT(*) AS n FROM ' + from + sql, ...a).n;
  const rows = all('SELECT i.id, i.category, i.service, i.title, substr(i.body, 1, 2000) AS body, i.url, i.who, i.place, i.ts, i.extra, i.source_id,' +
    (q ? " snippet(items_fts, 1, char(1), char(2), '…', 18) AS snip," : ' NULL AS snip,') +
    " (SELECT group_concat(tag, char(31)) FROM tags t WHERE t.item_id = i.id) AS tagl FROM " + from + sql +
    (q ? ' ORDER BY bm25(items_fts), i.ts DESC' : ' ORDER BY i.ts IS NULL, i.ts DESC, i.id DESC') + ' LIMIT ? OFFSET ?', ...a, limit, offset);
  const months = all('SELECT substr(i.ts, 1, 7) AS m, COUNT(*) AS n FROM ' + from + sql + (sql ? ' AND' : ' WHERE') + " i.ts IS NOT NULL AND i.ts >= '1990' GROUP BY m ORDER BY m DESC LIMIT 36", ...a).reverse();
  const people = all('SELECT i.who AS who, COUNT(*) AS n FROM ' + from + sql + (sql ? ' AND' : ' WHERE') + " i.who IS NOT NULL AND i.who NOT IN ('ты', 'Ты') GROUP BY i.who ORDER BY n DESC LIMIT 5", ...a);
  return { ok: true, total, rows: rows.map((r) => ({ ...r, tags: r.tagl ? r.tagl.split('\u001f') : [], extra: r.extra ? slim(JSON.parse(r.extra)) : null, tagl: undefined })), months, people };
}
function stats() {
  const by = Object.fromEntries(CATS.map((c) => [c, 0]));
  if (!db) return { ok: true, locked: true, encrypted: true, total: 0, by, sources: [], tags: [], file: encFile, size: fileSize(encFile) };
  all('SELECT category, COUNT(*) AS n FROM items GROUP BY category').forEach((r) => { by[r.category] = r.n; });
  return { ok: true, locked: false, encrypted: !!enc, total: Object.values(by).reduce((x, y) => x + y, 0), by, sources: all('SELECT * FROM sources ORDER BY added DESC'),
    tags: all('SELECT tag, COUNT(*) AS n FROM tags GROUP BY tag ORDER BY n DESC, tag LIMIT 40'), file: enc ? encFile : dbFile, size: enc ? fileSize(encFile) : dbSize() };
}
const dbSize = () => [dbFile, dbFile + '-wal'].reduce((s, f) => s + fileSize(f), 0);

/* ---------- метки и удаление ---------- */
const ids = (list) => (Array.isArray(list) ? list : [list]).map(Number).filter((n) => Number.isInteger(n) && n > 0).slice(0, 100000);
const cleanTag = (t) => String(t).replace(/[\u0000-\u001f#]/g, '').trim().slice(0, 32);
function tag(list, t) { const v = cleanTag(t); if (!v) return { ok: false, err: 'Пустая метка' }; const ins = db.prepare('INSERT OR IGNORE INTO tags (item_id, tag) VALUES (?, ?)'); txn(() => ids(list).forEach((id) => ins.run(id, v))); return { ok: true, tag: v }; }
function untag(id, t) { run('DELETE FROM tags WHERE item_id = ? AND tag = ?', Number(id), String(t)); return { ok: true }; }
function removeIds(list) {
  const all_ = ids(list); let n = 0;
  txn(() => { for (let i = 0; i < all_.length; i += 500) { const part = all_.slice(i, i + 500); n += run('DELETE FROM items WHERE id IN (' + part.map(() => '?').join(',') + ')', ...part).changes; } });
  all('SELECT id FROM sources').forEach((s) => finishSource(s.id));
  return n;
}
function remove(list, journal) { const n = removeIds(list); if (n && journal) journal.add('clean', 'Хранилище: удалены записи', String(n)); return { ok: true, removed: n }; }
function removeQuery(f, journal) {
  const { from, sql, a } = where(f), list = all('SELECT i.id AS id FROM ' + from + sql, ...a).map((r) => r.id);
  const n = removeIds(list); if (n && journal) journal.add('clean', 'Хранилище: удалено найденное', n + ' записей'); return { ok: true, removed: n };
}
function removeSource(id, journal) {
  const s = one('SELECT * FROM sources WHERE id = ?', Number(id)); if (!s) return { ok: false, err: 'Источник не найден' };
  const n = txn(() => { const c = run('DELETE FROM items WHERE source_id = ?', s.id).changes; run('DELETE FROM sources WHERE id = ?', s.id); return c; });
  if (journal) journal.add('clean', 'Хранилище: удалён источник', s.name + ' · ' + n + ' записей');
  return { ok: true, removed: n };
}
// Стереть всё. Открытое хранилище: файл базы перезаписывается случайными байтами и удаляется, создаётся пустое.
// Под паролем и открыто: все записи стираются, пароль остаётся. Под паролем и заперто (забыт пароль): зашифрованный файл затирается, пароль снимается.
function wipe(journal) {
  if (busy) return { ok: false, err: 'Подожди, пока закончится загрузка' };
  if (enc && db) {
    try { db.close(); } catch (e) { /* закрыта */ }
    db = new DatabaseSync(':memory:'); db.exec(SCHEMA);
    scrub(encFile, true); save();
    if (journal) journal.add('clean', 'Хранилище стёрто целиком', 'все записи удалены, старый зашифрованный файл перезаписан, пароль остался');
    return { ok: true, keptPassword: true };
  }
  if (!db) {
    shred([encFile, encFile + '.tmp']); fails = 0;
    db = new DatabaseSync(dbFile); db.exec(WAL + SCHEMA);
    if (journal) journal.add('clean', 'Хранилище стёрто целиком', 'зашифрованный файл перезаписан и удалён, пароль снят');
    return { ok: true };
  }
  const dir = path.dirname(dbFile); db.close();
  shred([dbFile, dbFile + '-wal', dbFile + '-shm']);
  open(dir);
  if (journal) journal.add('clean', 'Хранилище стёрто целиком', 'файл базы перезаписан и удалён');
  return { ok: true };
}
const hasPath = (p) => !!db && !!one('SELECT 1 AS x FROM items WHERE url = ? LIMIT 1', String(p));

/* ---------- обёртки: заперто — данных нет; любое действие продлевает время до автозапирания; изменения сохраняются ---------- */
const read = (fn) => (...a) => { if (!db) return LOCKED; touchIdle(); return fn(...a); };
const write = (fn) => (...a) => { if (!db) return LOCKED; touchIdle(); const r = fn(...a); changed(); return r; };
const heavy = (fn) => async (...a) => {
  if (!db) return LOCKED;
  busy++; touchIdle();
  try { return await fn(...a); } finally {
    busy--; changed(); touchIdle();
    if (!busy && pendingLock) { const why = pendingLock; pendingLock = null; lock(why); }
  }
};

// при выходе: последние изменения записываются в зашифрованный файл, даже если идёт загрузка
const flush = () => { try { save(); } catch (e) { /* не удалось — останется прошлый снимок */ } };

module.exports = {
  open, configure, status, unlock, lock, flush, setPassword, changePassword, removePassword, stats, hasPath, wipe, CATS,
  importPaths: heavy(importPaths), indexFolder: heavy(indexFolder), query: read(query), item: read(item), pageSaved: read(pageSaved),
  tag: write(tag), untag: write(untag), remove: write(remove), removeQuery: write(removeQuery), removeSource: write(removeSource), savePage: write(savePage),
  saveAlias: write(saveAlias), aliases: read(aliases),
};
