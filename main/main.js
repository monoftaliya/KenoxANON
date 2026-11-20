// KenoxANON — главный процесс: окно, защищённый протокол app://, команды для интерфейса.
const { app, BrowserWindow, ipcMain, shell, dialog, clipboard, protocol, net, globalShortcut, Notification, Menu, session, powerMonitor } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const sys = require('./system');
const meta = require('./meta');
const leaks = require('./leaks');
const erase = require('./erase');
const vault = require('./vault');
const guard = require('./guard');
const twin = require('./twin');
const search = require('./search');
const utils = require('./utils');
const mail = require('./mail');
const phone = require('./phone');
const mailer = require('./mailer');
const optout = require('./optout');
// встроенный просмотр страниц; если модуль не загрузится, ссылки по-прежнему открываются в браузере
let viewer = null;
try { viewer = require('./viewer'); } catch (e) { viewer = null; }
const { Journal, UndoStore } = require('./journal');

const RENDERER = path.join(__dirname, '..', 'renderer');
protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);

let win, journal, undo, settings = { hotkey: false, panicWipe: false }, quitting = false;
const startHidden = process.argv.includes('--hidden');
const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');
const saveSettings = () => { try { fs.writeFileSync(settingsFile(), JSON.stringify(settings)); } catch (e) { /* без сохранения */ } };

/* ---------- защита ---------- */
// 1. Команды приложения принимаются только от его собственной страницы app://kenox/ — встроенный просмотр сайтов и что угодно ещё их вызвать не может
const rawHandle = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (ch, fn) => rawHandle(ch, (e, ...a) => {
  const u = (e.senderFrame && e.senderFrame.url) || '';
  if (!u.startsWith('app://kenox/') || (win && e.sender !== win.webContents)) throw new Error('Команда отклонена: чужой источник');
  return fn(e, ...a);
});
// 2. Никаких вложенных webview, новых окон и разрешений (камера, микрофон, геопозиция) для окна приложения
app.on('web-contents-created', (e, wc) => {
  wc.on('will-attach-webview', (ev) => ev.preventDefault());
  // 3. В установленной версии инструменты разработчика не открываются
  if (app.isPackaged) wc.on('devtools-opened', () => wc.closeDevTools());
});
app.whenReady().then(() => { session.defaultSession.setPermissionRequestHandler((wc, perm, cb) => cb(false)); session.defaultSession.setPermissionCheckHandler(() => false); });

// Внешние ссылки открываются только в браузере и только по https или в Параметрах Windows
const SAFE_SCHEMES = /^(https:\/\/|ms-settings:|windowsdefender:)/;
function openSafe(url) { if (typeof url === 'string' && SAFE_SCHEMES.test(url)) shell.openExternal(url); }

function createWindow() {
  win = new BrowserWindow({
    width: 1380, height: 880, minWidth: 980, minHeight: 640, show: false,
    backgroundColor: '#07080b', title: 'KenoxANON', icon: path.join(RENDERER, 'icon.png'),
    titleBarStyle: 'hidden', titleBarOverlay: { color: '#07080b', symbolColor: '#c9ced8', height: 44 },
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false },
  });
  win.once('ready-to-show', () => win.show());
  // со Стражем крестик прячет окно, а приложение продолжает охранять в фоне
  win.on('close', (e) => {
    if (quitting || !guard.isOn()) return;
    e.preventDefault(); win.hide();
    if (!settings.trayHint && Notification.isSupported()) { settings.trayHint = true; saveSettings(); new Notification({ title: 'KenoxANON работает в фоне', body: 'Страж продолжает охранять. Окно открывается по значку у часов.', icon: path.join(RENDERER, 'icon.png') }).show(); }
  });
  win.on('closed', () => { if (viewer) viewer.close(); win = null; });
  // встроенное окно сайта прячется и возвращается вместе с окном приложения; по желанию хранилище запирается, когда окно уходит в трей
  win.on('hide', () => { if (viewer) viewer.setVisible(false); if (vaultLockCfg().onHide) vault.lock('hide'); });
  win.on('show', () => { if (viewer) viewer.setVisible(true); });
  win.webContents.setWindowOpenHandler(({ url }) => { openSafe(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('app://kenox/')) { e.preventDefault(); openSafe(url); } });
  win.loadURL('app://kenox/index.html');
}

const vaultLockCfg = () => Object.assign({ idle: 15, onHide: false, onSystemLock: true }, settings.vaultLock || {});

function panic() {
  clipboard.clear();
  vault.lock('panic');
  journal.add('panic', 'Тревожная кнопка', 'буфер обмена очищен, экран заблокирован' + (settings.panicWipe ? ', следы стираются' : ''));
  if (win) win.minimize();
  sys.lockScreen();
  // по желанию — сразу после блокировки стираются журнал Win+V, недавние файлы и история «Выполнить»
  if (settings.panicWipe) erase.clean(['clipboard', 'recent', 'run', 'search'], journal);
}
function applyHotkey() {
  globalShortcut.unregisterAll();
  if (settings.hotkey) globalShortcut.register('Control+Alt+Shift+K', panic);
}

// --kx-data=<папка> — отдельный профиль (журнал, откаты, настройки): для проверок и переносной работы
const dataArg = process.argv.find((x) => x.startsWith('--kx-data='));
if (dataArg) app.setPath('userData', path.resolve(dataArg.slice(10)));

// Одно окно на компьютер: повторный запуск просто поднимает уже открытое
const LOCK = app.requestSingleInstanceLock();
if (!LOCK) app.quit();
function showWindow() { if (!win) { createWindow(); return; } if (win.isMinimized()) win.restore(); win.show(); win.focus(); }
app.on('second-instance', () => showWindow());
app.on('before-quit', () => { quitting = true; vault.flush(); vault.lock('quit'); });
app.setAppUserModelId(app.isPackaged ? 'com.kenox.anon' : process.execPath);

app.whenReady().then(async () => {
  if (!LOCK) return;
  Menu.setApplicationMenu(null);
  const dir = app.getPath('userData');
  journal = new Journal(dir); undo = new UndoStore(dir);
  try { settings = Object.assign(settings, JSON.parse(fs.readFileSync(settingsFile(), 'utf8'))); } catch (e) { /* по умолчанию */ }
  applyHotkey();
  erase.setGuard([app.getAppPath(), dir, path.dirname(process.execPath)]);
  vault.open(dir, { onLock: (why) => { if (win && !win.isDestroyed()) win.webContents.send('vault:locked', why); } });
  vault.configure(vaultLockCfg());
  utils.load(dir);
  // хранилище под паролем запирается, когда блокируешь Windows или компьютер засыпает
  const sysLock = () => { if (vaultLockCfg().onSystemLock) vault.lock('system'); };
  powerMonitor.on('lock-screen', sysLock); powerMonitor.on('suspend', sysLock);
  guard.init(dir, settings.guard, {
    icon: path.join(RENDERER, 'icon.png'), journal, show: showWindow, panic: () => panic(),
    quit: () => { quitting = true; app.quit(); },
    save: (cfg) => { settings.guard = cfg; saveSettings(); },
    changed: () => { if (win && !win.isDestroyed()) win.webContents.send('guard:changed'); },
  });

  protocol.handle('app', async (req) => {
    const p = decodeURIComponent(new URL(req.url).pathname);
    const file = path.normalize(path.join(RENDERER, p));
    if (!file.startsWith(RENDERER) || !fs.existsSync(file)) return new Response('Not found', { status: 404 });
    // без кэша: после обновления приложения окно всегда получает новые файлы, а не старые из кэша
    const res = await net.fetch(pathToFileURL(file).toString());
    const headers = new Headers(res.headers); headers.set('cache-control', 'no-store');
    return new Response(res.body, { status: res.status, headers });
  });

  /* ---------- проверка и исправления ---------- */
  ipcMain.handle('audit', async () => {
    const r = await sys.audit();
    if (r.ok) { r.undo = Object.keys(undo.map); journal.add('scan', 'Проверка системы', 'индекс ' + r.score + '%'); }
    return r;
  });
  ipcMain.handle('fix', (e, id) => sys.fix(String(id), undo, journal));
  ipcMain.handle('revert', (e, id) => sys.revert(String(id), undo, journal));
  ipcMain.handle('open', (e, id) => { const target = sys.openFor(String(id)); if (target === 'uac') sys.runUac(); else if (target) openSafe(target); return { ok: !!target }; });
  ipcMain.handle('link', (e, url) => { openSafe(url); return { ok: true }; });

  /* ---------- журнал ---------- */
  ipcMain.handle('journal', () => ({ items: journal.items.slice(-300).reverse(), verify: journal.verify() }));
  ipcMain.handle('journal:clear', () => { journal.clear(); journal.add('clean', 'Журнал очищен', 'начата новая цепочка'); return { ok: true }; });

  /* ---------- инструменты ---------- */
  ipcMain.handle('radar', () => sys.radar());
  ipcMain.handle('ptr', (e, ip) => sys.ptr(String(ip)));
  ipcMain.handle('spy', () => guard.cachedSpy() || sys.spy());
  ipcMain.handle('spy:set', (e, cap, key, value) => sys.spySet(String(cap), String(key), value === 'Allow' ? 'Allow' : 'Deny', undo, journal));
  ipcMain.handle('spy:undo', async (e, cap, key) => { const id = 'spy:' + cap + ':' + key; const u = undo.get(id); if (!u) return { ok: false, err: 'Нечего откатывать' }; const s = u.snap[0]; const r = await sys.spySet(String(cap), String(key), s.prev === 'Deny' ? 'Deny' : 'Allow', { get: () => 1, set() {} }, journal); undo.del(id); return r; });
  ipcMain.handle('wifi:forget', (e, name) => sys.forgetWifi(String(name), journal));
  ipcMain.handle('browsers', () => sys.browsers());
  ipcMain.handle('browsers:clean', (e, id, what) => sys.cleanBrowser(String(id), { cache: !!(what && what.cache), cookies: !!(what && what.cookies), history: !!(what && what.history), forms: !!(what && what.forms) }, journal));
  ipcMain.handle('meta:inspect', (e, files) => meta.inspect((files || []).map(String)));
  ipcMain.handle('meta:clean', async (e, files) => { const r = await meta.clean((files || []).map(String)); const ok = r.filter((x) => !x.error).length; if (ok) journal.add('clean', 'Метаданные удалены', ok + ' файл(ов)'); return r; });
  ipcMain.handle('meta:strip', async (e, files) => { const r = await meta.strip((files || []).map(String)); const ok = r.filter((x) => !x.error && x.removed && x.removed.length); if (ok.length) journal.add('clean', 'Метаданные удалены из файлов', ok.length + ' файл(ов): ' + ok.map((x) => path.basename(x.file)).slice(0, 5).join(', ')); return r; });
  ipcMain.handle('meta:field', async (e, file, label) => { const r = await meta.removeField(String(file), String(label)); if (r.ok) journal.add('clean', 'Удалено поле метаданных', label + ' · ' + path.basename(String(file))); return r; });
  // what: 'photo' или 'audio' — для утилит №19 и №20; без него — все форматы «Метаданных»
  ipcMain.handle('pick', async (e, what) => {
    const F = { photo: { name: 'Фото: HEIC, AVIF, WebP, JPEG, PNG', extensions: ['heic', 'heif', 'hif', 'avif', 'webp', 'jpg', 'jpeg', 'jfif', 'png'] }, audio: { name: 'Аудио: MP3, M4A, FLAC', extensions: ['mp3', 'm4a', 'm4b', 'flac'] } };
    const all = { name: 'Фото, видео, аудио и документы', extensions: ['jpg', 'jpeg', 'jfif', 'png', 'heic', 'heif', 'hif', 'avif', 'webp', 'pdf', 'docx', 'xlsx', 'pptx', 'mp4', 'mov', 'm4v', '3gp', 'mp3', 'm4a', 'm4b', 'flac'] };
    const r = await dialog.showOpenDialog(win, { title: 'Файлы для проверки', properties: ['openFile', 'multiSelections'], filters: [F[what] || all] });
    return r.canceled ? [] : r.filePaths;
  });
  ipcMain.handle('pick:any', async (e, folder) => {
    const r = await dialog.showOpenDialog(win, { title: folder ? 'Папка для шредера' : 'Файлы для шредера', properties: folder ? ['openDirectory'] : ['openFile', 'multiSelections'] });
    return r.canceled ? [] : r.filePaths;
  });

  /* ---------- хранилище: только то, что человек сам загрузил, и только на этом компьютере ---------- */
  const vaultProgress = (p) => { if (win && !win.isDestroyed()) win.webContents.send('vault:progress', p); };
  ipcMain.handle('vault:stats', () => vault.stats());
  ipcMain.handle('vault:query', (e, f) => vault.query(f && typeof f === 'object' ? f : {}));
  ipcMain.handle('vault:import', (e, paths) => vault.importPaths((paths || []).map(String).filter((p) => fs.existsSync(p)), vaultProgress, journal));
  ipcMain.handle('vault:index', (e, dir) => vault.indexFolder(String(dir), vaultProgress, journal));
  ipcMain.handle('vault:tag', (e, ids, tag) => vault.tag(ids, String(tag)));
  ipcMain.handle('vault:untag', (e, id, tag) => vault.untag(Number(id), String(tag)));
  ipcMain.handle('vault:delete', (e, ids) => vault.remove(ids, journal));
  ipcMain.handle('vault:deleteQuery', (e, f) => vault.removeQuery(f && typeof f === 'object' ? f : {}, journal));
  ipcMain.handle('vault:deleteSource', (e, id) => vault.removeSource(Number(id), journal));
  ipcMain.handle('vault:wipe', () => vault.wipe(journal));
  // пароль на хранилище: сам пароль нигде не сохраняется и не попадает в журнал
  ipcMain.handle('vault:status', () => ({ ...vault.status(), ...vaultLockCfg() }));
  ipcMain.handle('vault:unlock', (e, pw) => vault.unlock(String(pw || '')));
  ipcMain.handle('vault:lock', () => vault.lock('manual'));
  ipcMain.handle('vault:setPassword', (e, pw) => vault.setPassword(String(pw || ''), journal));
  ipcMain.handle('vault:changePassword', (e, oldPw, newPw) => vault.changePassword(String(oldPw || ''), String(newPw || ''), journal));
  ipcMain.handle('vault:removePassword', (e, pw) => vault.removePassword(String(pw || ''), journal));
  ipcMain.handle('vault:lockSettings', (e, patch) => {
    const c = vaultLockCfg(), p = patch && typeof patch === 'object' ? patch : {};
    if (p.idle != null && Number.isFinite(Number(p.idle))) c.idle = Math.max(0, Math.min(1440, Math.round(Number(p.idle))));
    if (p.onHide != null) c.onHide = !!p.onHide;
    if (p.onSystemLock != null) c.onSystemLock = !!p.onSystemLock;
    settings.vaultLock = c; saveSettings(); vault.configure(c);
    return { ok: true, ...c };
  });
  // тихие закладки: текст страницы из «Читалки» сохраняется в хранилище (в журнал адрес не пишется)
  ipcMain.handle('vault:savePage', (e, p) => vault.savePage(p && typeof p === 'object' ? p : {}));
  ipcMain.handle('vault:aliasAdd', (e, p) => vault.saveAlias(p && typeof p === 'object' ? p : {}));
  ipcMain.handle('vault:aliases', () => vault.aliases());
  ipcMain.handle('vault:pageSaved', (e, url) => vault.pageSaved(String(url || '')));
  ipcMain.handle('vault:item', (e, id) => vault.item(Number(id)));
  // показать в проводнике можно только файл, который уже есть в хранилище
  ipcMain.handle('vault:reveal', (e, p) => { const f = String(p); if (vault.hasPath(f) && fs.existsSync(f)) shell.showItemInFolder(f); return { ok: true }; });
  ipcMain.handle('pick:export', async () => {
    const r = await dialog.showOpenDialog(win, { title: 'Выгрузка данных из сервиса', properties: ['openFile', 'multiSelections'], filters: [{ name: 'Выгрузки: ZIP, JSON, HTML, CSV, VCF, TXT', extensions: ['zip', 'json', 'html', 'htm', 'csv', 'vcf', 'txt'] }] });
    return r.canceled ? [] : r.filePaths;
  });

  /* ---------- стирание ---------- */
  ipcMain.handle('traces:scan', () => erase.scan());
  ipcMain.handle('traces:clean', (e, ids) => erase.clean((ids || []).map(String), journal));
  ipcMain.handle('shred:plan', (e, paths) => erase.summary((paths || []).map(String)));
  ipcMain.handle('shred:run', (e, paths) => erase.shred((paths || []).map(String), (p) => { if (win && !win.isDestroyed()) win.webContents.send('progress', p); }, journal));
  ipcMain.handle('shred:cancel', () => erase.cancel());
  ipcMain.handle('drives', () => erase.drives());
  ipcMain.handle('freespace', (e, letter) => erase.wipeFree(String(letter), journal));
  ipcMain.handle('clip:text', (e, text) => { clipboard.writeText(String(text)); return { ok: true }; });
  ipcMain.handle('panic:wipe', (e, on) => { settings.panicWipe = !!on; saveSettings(); journal.add('fix', 'Стирание следов при тревоге', on ? 'включено' : 'выключено'); return { ok: true, on: settings.panicWipe }; });
  ipcMain.handle('leaks:password', (e, pw) => leaks.password(String(pw)));
  ipcMain.handle('leaks:email', (e, addr, key) => leaks.email(String(addr), String(key || '')));
  // номер в утечках: ключ HIBP приходит на один запрос и не сохраняется
  ipcMain.handle('leaks:phone', (e, raw, key) => { const p = phone.normalize(String(raw || '')); return p.ok ? leaks.phone(p.cc + p.nsn, String(key || '').trim()) : p; });
  // Пароль копируется в буфер и стирается оттуда через 30 секунд
  ipcMain.handle('clip:secret', (e, text) => {
    clipboard.writeText(String(text));
    setTimeout(() => { if (clipboard.readText() === String(text)) clipboard.clear(); }, 30000);
    return { ok: true };
  });
  ipcMain.handle('panic', () => { panic(); return { ok: true }; });
  ipcMain.handle('panic:hotkey', (e, on) => { settings.hotkey = !!on; saveSettings(); applyHotkey(); journal.add('fix', 'Горячая клавиша паники', on ? 'Ctrl+Alt+Shift+K включена' : 'выключена'); return { ok: true, on: settings.hotkey }; });
  ipcMain.handle('settings', () => settings);

  /* ---------- Страж ---------- */
  ipcMain.handle('guard:status', () => guard.status());
  ipcMain.handle('guard:set', (e, patch) => guard.set(patch));
  ipcMain.handle('guard:check', () => guard.runCheck(true));
  ipcMain.handle('guard:clean', () => guard.runClean('вручную', true));

  /* ---------- Двойник ---------- */
  ipcMain.handle('twin:defaults', () => twin.defaults());
  ipcMain.handle('twin:scan', (e, folders) => twin.scan(folders, (p) => { if (win && !win.isDestroyed()) win.webContents.send('twin:progress', p); }));
  ipcMain.handle('twin:fix', (e, kind) => (['gps', 'serial', 'docs'].includes(kind) ? twin.fix(kind, journal) : { ok: false }));

  /* ---------- анонимный поиск: запросы не записываются ни в журнал, ни в настройки ---------- */
  const searchCfg = () => Object.assign({ proxy: { type: 'none', host: '127.0.0.1', port: 9150 }, region: 'wt-wt', safe: 'moderate' }, settings.search || {});
  ipcMain.handle('search:get', () => searchCfg());
  ipcMain.handle('search:set', (e, patch) => {
    const c = searchCfg(), p = patch && typeof patch === 'object' ? patch : {};
    if (p.proxy) { const pr = { type: String(p.proxy.type || 'none'), host: String(p.proxy.host || '').trim(), port: Number(p.proxy.port) || 0 }; const v = search.proxyRules(pr); if (!v.ok) return v; c.proxy = pr; }
    if (search.REGIONS[p.region]) c.region = p.region;
    if (['strict', 'moderate', 'off'].includes(p.safe)) c.safe = p.safe;
    settings.search = c; saveSettings(); return { ok: true, cfg: c };
  });
  ipcMain.handle('search:query', (e, args) => search.search(args, searchCfg().proxy));
  ipcMain.handle('search:check', (e, proxy) => search.check(proxy && typeof proxy === 'object' ? proxy : searchCfg().proxy));
  // по желанию результат можно открыть и во внешнем браузере, в том числе http
  ipcMain.handle('search:open', (e, url) => { const u = String(url); if (/^https?:\/\/[^\s]+$/i.test(u)) shell.openExternal(u); return { ok: true }; });

  /* ---------- встроенный просмотр страниц: «Читалка» и «Оригинал» через ту же приватную сессию и прокси ---------- */
  const viewerState = (s) => { if (win && !win.isDestroyed()) win.webContents.send('viewer:state', s); };
  ipcMain.handle('viewer:available', () => !!viewer);
  ipcMain.handle('viewer:fetch', (e, url) => search.fetchPage(String(url), searchCfg().proxy));
  ipcMain.handle('viewer:open', (e, url, bounds, opts) => (viewer && win ? viewer.open(win, String(url), bounds, { proxy: searchCfg().proxy, js: !(opts && opts.js === false) }, viewerState) : { ok: false, err: 'Просмотр недоступен' }));
  ipcMain.handle('viewer:bounds', (e, bounds) => { if (viewer) viewer.setBounds(bounds); return { ok: true }; });
  ipcMain.handle('viewer:visible', (e, on) => { if (viewer) viewer.setVisible(!!on); return { ok: true }; });
  ipcMain.handle('viewer:nav', (e, cmd, url) => (viewer ? viewer.nav(String(cmd), url ? String(url) : '') : { ok: false }));
  ipcMain.handle('viewer:close', () => (viewer ? viewer.close() : { ok: true }));
  ipcMain.handle('viewer:xray', () => (viewer ? viewer.report() : { ok: false, err: 'Просмотр недоступен' }));

  /* ---------- утилиты: отметки и трекер запросов только на этом компьютере ---------- */
  ipcMain.handle('util:get', () => utils.get());
  ipcMain.handle('util:mark', (e, key, status, days, label) => utils.mark(String(key), status ? String(status) : '', Number(days) || 0, label == null ? '' : String(label)));
  ipcMain.handle('util:reqAdd', (e, r) => utils.addRequest(r && typeof r === 'object' ? r : {}));
  ipcMain.handle('util:reqSet', (e, id, p) => utils.setRequest(String(id), p && typeof p === 'object' ? p : {}));
  ipcMain.handle('util:reqDel', (e, id) => utils.removeRequest(String(id)));
  // проверка страницы идёт через приватную сессию поиска (и его прокси), без cookies
  ipcMain.handle('util:checkUrl', (e, url) => search.probe(String(url || '').trim(), searchCfg().proxy));
  // выгрузка почты: читаются только заголовки, путь не запоминается
  ipcMain.handle('pick:mail', async (e, folder) => {
    const r = await dialog.showOpenDialog(win, folder ? { title: 'Папка с письмами .eml', properties: ['openDirectory'] }
      : { title: 'Выгрузка почты', properties: ['openFile'], filters: [{ name: 'Почта: .mbox, .eml', extensions: ['mbox', 'mbx', 'eml'] }, { name: 'Все файлы (у Thunderbird папки почты без расширения)', extensions: ['*'] }] });
    return r.canceled ? '' : r.filePaths[0];
  });
  ipcMain.handle('mail:scan', (e, p) => mail.scan(String(p || ''), (x) => { if (win && !win.isDestroyed()) win.webContents.send('mail:progress', x); }));
  // отписка в один клик: только адреса из последней прочитанной выгрузки, по одному POST через приватную сессию
  ipcMain.handle('mail:unsub', async (e, urls) => {
    const list = (Array.isArray(urls) ? urls : []).map(String).filter((u) => mail.allowed(u)).slice(0, 100), results = [];
    for (const u of list) results.push({ url: u, ...(await search.oneClick(u, searchCfg().proxy)) });
    return { ok: true, results };
  });
  // «Найти себя по номеру»: поиск через приватную сессию и прокси «Анонимного поиска»; номер и найденное нигде не сохраняются
  const toWin = (ch, x) => { if (win && !win.isDestroyed()) win.webContents.send(ch, x); };
  ipcMain.handle('phone:find', (e, raw) => phone.find(String(raw || ''), searchCfg(), (x) => toWin('phone:progress', x)));
  ipcMain.handle('phone:cancel', () => phone.cancel());
  ipcMain.handle('phone:check', (e, raw) => { const p = phone.normalize(String(raw || '')); return p.ok ? { ok: true, pretty: p.pretty } : p; });
  // «Удалить себя из баз»: письма уходят с почты человека; адреса компаний — только из своего списка, пароль не сохраняется
  ipcMain.handle('optout:list', () => optout.list());
  ipcMain.handle('optout:letter', (e, id, me) => {
    const c = optout.get(id), m = me && typeof me === 'object' ? me : {}, p = phone.normalize(String(m.phone || ''));
    if (!c) return { ok: false, err: 'Нет такой компании' };
    return { ok: true, to: c.email, ...optout.letter(c, { phone: p.ok ? p.pretty : '[your phone number]', name: m.name, email: mailer.EMAIL.test(String(m.email || '').trim()) ? String(m.email).trim() : '[your e-mail]' }) };
  });
  ipcMain.handle('mail:detect', (e, email) => mailer.detect(String(email || '')));
  ipcMain.handle('mail:verify', (e, acc) => mailer.verify(acc));
  let sending = false;
  ipcMain.handle('mail:send', async (e, acc, me, ids, opts) => {
    if (sending) return { ok: false, err: 'Письма уже отправляются' };
    const m = me && typeof me === 'object' ? me : {}, p = phone.normalize(String(m.phone || ''));
    if (!p.ok) return p;
    const a = mailer.account(acc);
    if (!a.ok) return a;
    const chosen = optout.pick(ids);
    if (!chosen.length) return { ok: false, err: 'Отметь, куда отправить письма' };
    const person = { phone: p.pretty, name: String(m.name || ''), email: a.user };
    const letters = chosen.map((c) => ({ id: c.id, to: c.email, fromName: person.name, bccSelf: !!(opts && opts.bccSelf), ...optout.letter(c, person) }));
    sending = true;
    try {
      const out = await mailer.sendAll(acc, letters, (r, i, n) => toWin('mail:sendProgress', { id: r.id, ok: r.ok, err: r.err, i: i + 1, n }));
      if (!out.ok) return out;
      // отправленное — в «Трекер запросов на удаление»: срок ответа посчитается сам, приложение напомнит проверить
      for (const r of out.results) {
        if (!r.ok) continue;
        const c = chosen.find((x) => x.id === r.id);
        utils.addRequest({ to: c.name + (c.group === 'brokers' ? ' — удалить мои данные' : ' — удалить мой номер'), law: c.law, days: c.days || 30, note: 'письмо на ' + c.email + ' отправлено из KenoxANON' });
        utils.mark(c.group + ':' + c.id, 'sent', c.days || 30);
      }
      return { ok: true, results: out.results, store: utils.get() };
    } finally { sending = false; }
  });
  // напоминания о сроках: уведомление Windows без названий компаний, по клику — раздел «Утилиты»
  const remindNow = () => utils.remind((title, body) => {
    if (!Notification.isSupported()) return;
    const n = new Notification({ title, body, icon: path.join(RENDERER, 'icon.png') });
    n.on('click', () => { showWindow(); if (win && !win.isDestroyed()) win.webContents.send('app:go', 'utils'); });
    n.show();
  });
  setTimeout(remindNow, 60e3); setInterval(remindNow, 30 * 60e3);
  ipcMain.handle('notify', (e, title, body) => { if (Notification.isSupported()) new Notification({ title: String(title), body: String(body) }).show(); return { ok: true }; });

  // после обновления версии сбрасываем кэш окна, чтобы не подхватились файлы прошлой версии
  if (settings.version !== app.getVersion()) { try { await session.defaultSession.clearCache(); } catch (e) { /* не критично */ } settings.version = app.getVersion(); saveSettings(); }
  if (!(startHidden && guard.isOn())) createWindow();
});

app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', () => { if (!guard.isOn()) app.quit(); });
