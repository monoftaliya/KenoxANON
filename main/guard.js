// Страж — фоновый режим KenoxANON. Живёт значком у часов и работает, даже когда окно закрыто:
// проверяет систему по расписанию и сообщает только об ухудшениях, сам стирает выбранные следы,
// предупреждает, когда программа включает камеру или микрофон, раз в неделю присылает сводку.
const { app, Tray, Menu, Notification, nativeImage } = require('electron');
const fs = require('fs');
const path = require('path');
const sys = require('./system');
const erase = require('./erase');

const H = 3600e3, DAY = 24 * H;
const CLEANABLE = ['recent', 'run', 'search', 'clipboard', 'temp', 'thumbs', 'wer', 'dns', 'recycle'];
const DEFAULTS = { on: false, check: 'day', watch: true, weekly: true, autostart: false, clean: { ids: ['clipboard', 'recent', 'run', 'search', 'temp', 'dns'], onStart: false, every: 0 },
  photos: { on: false, mode: 'gps' } };   // автоочистка и автопилот фото включаются только самим человеком
const meta = require('./meta');
const os = require('os');

let cfg = null, st = null, file = null, hooks = null, tray = null, timer = null, spyTimer = null, live = null, spyCache = null, busy = false;
const now = () => Date.now();
const fresh = () => ({ lastCheck: null, lastClean: null, events: [], week: { start: now(), checks: 0, cleaned: 0, live: 0, worse: 0 } });
function load() { try { return Object.assign(fresh(), JSON.parse(fs.readFileSync(file, 'utf8'))); } catch (e) { return fresh(); } }
const save = () => { try { fs.writeFileSync(file, JSON.stringify(st)); } catch (e) { /* без сохранения */ } };
function event(kind, text) { st.events.unshift({ ts: new Date().toISOString(), kind, text }); st.events = st.events.slice(0, 60); save(); hooks.changed(); }
function notify(title, body) {
  if (!Notification.isSupported()) return;
  const n = new Notification({ title, body, icon: hooks.icon });
  n.on('click', () => hooks.show());
  n.show();
}
const mb = (b) => (b > 1048576 ? (b / 1048576).toFixed(1) + ' МБ' : Math.round(b / 1024) + ' КБ');

/* ---------- проверка системы ---------- */
async function runCheck(manual) {
  if (busy) return { ok: false, err: 'Страж уже занят' };
  busy = true;
  try {
    const r = await sys.audit();
    if (!r.ok) { event('check', 'проверка не удалась: ' + (r.err || '')); return r; }
    const bad = r.items.filter((i) => i.good === false), ids = bad.map((i) => i.id), prev = st.lastCheck;
    const worse = prev ? bad.filter((i) => !prev.bad.includes(i.id)) : [], better = prev ? prev.bad.filter((id) => !ids.includes(id)) : [];
    st.lastCheck = { ts: new Date().toISOString(), score: r.score, bad: ids };
    st.week.checks++; st.week.worse += worse.length;
    hooks.journal.add('scan', 'Страж: проверка системы', 'индекс ' + r.score + '%' + (worse.length ? ', хуже: ' + worse.length : ''));
    if (worse.length) {
      event('worse', 'защита ослабла: ' + worse.map((i) => i.title).join(', '));
      notify('Страж: защита ослабла', worse.map((i) => i.title).join(', ') + '. Индекс ' + r.score + '%.');
    } else {
      event('check', 'индекс ' + r.score + '%' + (better.length ? ', исправлено: ' + better.length : ', без изменений'));
      if (manual) notify('Страж: проверено', 'Индекс невидимости ' + r.score + '%. Ухудшений нет.');
    }
    save();
    return { ok: true, score: r.score, worse: worse.map((i) => i.title), better: better.length };
  } finally { busy = false; }
}

/* ---------- автоочистка ---------- */
async function runClean(reason, manual) {
  const ids = (cfg.clean.ids || []).filter((id) => CLEANABLE.includes(id));
  if (!ids.length) return { ok: false, err: 'Не выбрано, что стирать' };
  const r = await erase.clean(ids, hooks.journal);
  const freed = r.results.reduce((s, x) => s + (x.freed || 0), 0), done = r.results.filter((x) => x.ok).length;
  st.lastClean = { ts: new Date().toISOString(), freed, done, reason }; st.week.cleaned += freed;
  event('clean', 'автоочистка (' + reason + '): ' + done + ' из ' + ids.length + (freed ? ', ' + mb(freed) : ''));
  if (manual) notify('Страж: следы стёрты', done + ' из ' + ids.length + ' видов следов' + (freed ? ', освобождено ' + mb(freed) : '') + '.');
  return { ok: true, freed, done };
}

/* ---------- камера и микрофон ---------- */
const CAP = { webcam: 'камеру', microphone: 'микрофон', location: 'геопозицию' };
async function pollSpy() {
  const r = await sys.spy();
  if (!r || !r.ok) return;
  spyCache = { ts: now(), data: r };
  const on = r.list.filter((e) => e.live), keys = new Set(on.map((e) => e.cap + ':' + e.key));
  if (live) on.filter((e) => !live.has(e.cap + ':' + e.key)).forEach((e) => {
    st.week.live++;
    event('live', e.name + ' включил ' + CAP[e.cap]);
    notify('Страж: ' + e.name, 'Включил ' + CAP[e.cap] + '. Если это не ты — запрети доступ в разделе «Кто подглядывал».');
  });
  live = keys;
}
// окно спрашивает журнал доступа через Стража, чтобы PowerShell не запускался дважды
function cachedSpy() { return spyTimer && spyCache && now() - spyCache.ts < 25000 ? spyCache.data : null; }

/* ---------- расписание ---------- */
async function tick() {
  const t = now();
  const every = cfg.check === 'week' ? 7 * DAY : cfg.check === 'day' ? DAY : 0;
  if (every && (!st.lastCheck || t - new Date(st.lastCheck.ts).getTime() >= every)) await runCheck(false);
  if (cfg.clean.every > 0 && (!st.lastClean || t - new Date(st.lastClean.ts).getTime() >= cfg.clean.every * H)) await runClean('по расписанию');
  if (cfg.weekly && t - st.week.start >= 7 * DAY) {
    const w = st.week;
    notify('Страж: итоги недели', (st.lastCheck ? 'Индекс ' + st.lastCheck.score + '%. ' : '') + 'Проверок: ' + w.checks + ', ухудшений: ' + w.worse + ', стёрто: ' + mb(w.cleaned) + ', камера и микрофон включались: ' + w.live + '.');
    event('week', 'итоги недели отправлены');
    st.week = fresh().week; save();
  }
}

/* ---------- автопилот фото: новые снимки и записи в «Загрузках», на «Рабочем столе» и в «Изображениях» чистятся сами ---------- */
// Режим 'gps' стирает только место съёмки (и XMP с координатами), 'all' — все метаданные. Картинка и звук не меняются.
const MEDIA = /\.(jpe?g|jfif|png|heic|heif|hif|avif|webp|mp3|m4a|flac)$/i;
// KX_PHOTO_DIRS — только для автотестов: следить за тестовыми папками вместо настоящих
const photoFolders = () => (process.env.KX_PHOTO_DIRS ? process.env.KX_PHOTO_DIRS.split(';') : ['Downloads', 'Desktop', 'Pictures', 'OneDrive\\Desktop', 'OneDrive\\Pictures'].map((d) => path.join(os.homedir(), d))).filter((d) => { try { return fs.statSync(d).isDirectory(); } catch (e) { return false; } });
let watchers = [], pending = new Map(), recent = new Map(), batch = 0, batchT = null;
function startPhotos() {
  stopPhotos();
  if (!cfg.on || !cfg.photos.on) return;
  for (const d of photoFolders()) {
    try { const w = fs.watch(d, { recursive: true }, (ev, name) => { if (name) queuePhoto(path.join(d, String(name))); }); w.on('error', () => {}); watchers.push(w); } catch (e) { /* папка недоступна */ }
  }
}
function stopPhotos() { watchers.forEach((w) => { try { w.close(); } catch (e) { /* уже закрыт */ } }); watchers = []; pending.forEach((t) => clearTimeout(t)); pending.clear(); }
function queuePhoto(f) {
  if (!MEDIA.test(f) || /-чистый\.[^.\\/]+$/i.test(f)) return;
  const last = recent.get(f); if (last && now() - last < 120e3) return;   // свою же запись не трогаем по второму кругу
  clearTimeout(pending.get(f)); pending.set(f, setTimeout(() => settle(f, -1, 0), 2500));
}
// ждём, пока файл докачается: размер не меняется 2 секунды
function settle(f, prev, tries) {
  pending.delete(f);
  let s; try { s = fs.statSync(f); } catch (e) { return; }
  if (!s.isFile() || s.size > 300 * 1024 * 1024) return;
  if (s.size !== prev && tries < 15) { pending.set(f, setTimeout(() => settle(f, s.size, tries + 1), 2000)); return; }
  cleanPhoto(f).catch(() => {});
}
async function cleanPhoto(f) {
  recent.set(f, now()); if (recent.size > 2000) recent = new Map([...recent].slice(-500));
  const r = (await meta.inspect([f]))[0];
  if (!r || r.error || !r.found) return;
  let labels = Object.keys(r.found);
  if (cfg.photos.mode !== 'all') labels = labels.filter((l) => l === 'GPS' || (l === 'XMP' && /координаты/.test(r.found.XMP)));
  if (!labels.length) return;
  let ok = false;
  if (cfg.photos.mode === 'all') { const x = (await meta.strip([f]))[0]; ok = x && !x.error; }
  else for (const l of labels) { const x = await meta.removeField(f, l); if (x.ok) ok = true; }
  recent.set(f, now());
  if (!ok) return;
  st.photos = (st.photos || 0) + 1;
  event('clean', 'Автопилот: ' + (cfg.photos.mode === 'all' ? 'метаданные стёрты' : 'место съёмки стёрто') + ' · ' + path.basename(f));
  batch++; clearTimeout(batchT);
  batchT = setTimeout(() => { notify('Автопилот фото', (cfg.photos.mode === 'all' ? 'Метаданные стёрты' : 'Место съёмки стёрто') + ' в ' + batch + ' ' + (batch === 1 ? 'файле' : 'файлах') + '. Список — в разделе «Страж».'); batch = 0; }, 8000);
}

/* ---------- значок у часов ---------- */
function menu() {
  return Menu.buildFromTemplate([
    { label: 'Страж охраняет', enabled: false },
    { type: 'separator' },
    { label: 'Открыть KenoxANON', click: () => hooks.show() },
    { label: 'Проверить систему сейчас', click: () => runCheck(true) },
    { label: 'Стереть следы сейчас', click: () => runClean('вручную', true) },
    { label: 'Тревога: заблокировать экран', click: () => hooks.panic() },
    { type: 'separator' },
    { label: 'Выключить Стража', click: () => set({ on: false }) },
    { label: 'Выйти из KenoxANON', click: () => hooks.quit() },
  ]);
}
function start(atBoot) {
  if (!tray) {
    tray = new Tray(nativeImage.createFromPath(hooks.icon).resize({ width: 16, height: 16 }));
    tray.setToolTip('KenoxANON · Страж охраняет');
    tray.setContextMenu(menu());
    tray.on('click', () => hooks.show());
  }
  clearInterval(timer); timer = setInterval(() => tick().catch(() => {}), 5 * 60e3);
  setTimeout(() => tick().catch(() => {}), atBoot ? 90e3 : 5e3);
  clearInterval(spyTimer); spyTimer = null; live = null;
  if (cfg.watch) { spyTimer = setInterval(() => pollSpy().catch(() => {}), 20e3); pollSpy().catch(() => {}); }
  if (atBoot && cfg.clean.onStart) setTimeout(() => runClean('при запуске').catch(() => {}), 45e3);
  startPhotos();
}
function stop() {
  stopPhotos();
  clearInterval(timer); clearInterval(spyTimer); timer = spyTimer = null; live = null;
  if (tray) { tray.destroy(); tray = null; }
}
function autostart(on) {
  try { app.setLoginItemSettings({ openAtLogin: !!on, path: process.execPath, args: app.isPackaged ? ['--hidden'] : [app.getAppPath(), '--hidden'] }); } catch (e) { /* нет прав */ }
}

/* ---------- настройки ---------- */
function set(patch) {
  const p = patch && typeof patch === 'object' ? patch : {};
  const was = cfg.on;
  if ('on' in p) cfg.on = !!p.on;
  if (['day', 'week', 'off'].includes(p.check)) cfg.check = p.check;
  if ('watch' in p) cfg.watch = !!p.watch;
  if ('weekly' in p) cfg.weekly = !!p.weekly;
  if ('autostart' in p) { cfg.autostart = !!p.autostart; autostart(cfg.on && cfg.autostart); }
  if (p.clean && typeof p.clean === 'object') {
    if (Array.isArray(p.clean.ids)) cfg.clean.ids = p.clean.ids.map(String).filter((id) => CLEANABLE.includes(id));
    if ('onStart' in p.clean) cfg.clean.onStart = !!p.clean.onStart;
    if ([0, 1, 6, 24].includes(Number(p.clean.every))) cfg.clean.every = Number(p.clean.every);
  }
  if (p.photos && typeof p.photos === 'object') {
    const before = cfg.photos.on;
    if ('on' in p.photos) cfg.photos.on = !!p.photos.on;
    if (['gps', 'all'].includes(p.photos.mode)) cfg.photos.mode = p.photos.mode;
    if (cfg.photos.on !== before) event('clean', cfg.photos.on ? 'Автопилот фото включён' : 'Автопилот фото выключен');
  }
  if (cfg.on && !was) { start(false); event('on', 'Страж включён'); notify('Страж включён', 'KenoxANON будет охранять компьютер в фоне. Значок — у часов на панели задач.'); }
  else if (!cfg.on && was) { stop(); autostart(false); event('off', 'Страж выключен'); }
  else if (cfg.on) start(false);
  if (cfg.on && !('autostart' in p) && cfg.autostart) autostart(true);
  hooks.save(cfg); hooks.changed();
  return status();
}
function status() {
  const login = (() => { try { return app.getLoginItemSettings({ path: process.execPath, args: app.isPackaged ? ['--hidden'] : [app.getAppPath(), '--hidden'] }).openAtLogin; } catch (e) { return false; } })();
  return { ok: true, cfg, photos: { folders: photoFolders(), cleaned: st.photos || 0, watching: watchers.length > 0 }, lastCheck: st.lastCheck, lastClean: st.lastClean, events: st.events.slice(0, 30), week: st.week, running: !!tray, login, traces: erase.TRACES.filter((t) => CLEANABLE.includes(t.id)).map((t) => ({ id: t.id, title: t.title })) };
}
function init(dir, saved, h) {
  file = path.join(dir, 'guard.json'); hooks = h; st = load();
  cfg = Object.assign({}, DEFAULTS, saved || {}); cfg.clean = Object.assign({}, DEFAULTS.clean, (saved && saved.clean) || {});
  cfg.photos = Object.assign({}, DEFAULTS.photos, (saved && saved.photos) || {});
  if (cfg.on) start(true);
}
const isOn = () => !!(cfg && cfg.on);

module.exports = { init, set, status, runCheck, runClean, cachedSpy, isOn };
