// Встроенный просмотр сайтов («Оригинал»): отдельная вставка в окне приложения без доступа к его командам,
// в той же приватной сессии поиска (только в памяти) и через тот же прокси. Трекеры режутся, WebGL выключен,
// WebRTC не может выдать настоящий IP мимо прокси, всплывающие окна и загрузки запрещены.
const { WebContentsView } = require('electron');
const search = require('./search');
const xray = require('./xray');

let view = null, owner = null, send = () => {}, js = true;
const web = (u) => /^https?:\/\//i.test(String(u || ''));
function state(extra) {
  if (!view) return;
  const w = view.webContents, nh = w.navigationHistory, xr = xray.summary(w.id);
  send({ url: w.getURL(), title: w.getTitle(), back: nh.canGoBack(), fwd: nh.canGoForward(), loading: w.isLoading(), blocked: xr.trackers, xr, js, ...extra });
}
function create() {
  view = new WebContentsView({ webPreferences: { session: search.session(), sandbox: true, contextIsolation: true, nodeIntegration: false, javascript: js, webgl: false, spellcheck: false, safeDialogs: true, autoplayPolicy: 'user-gesture-required' } });
  const w = view.webContents;
  w.setWebRTCIPHandlingPolicy('disable_non_proxied_udp');
  xray.reset(w.id, ''); xray.focus(w.id);
  w.setWindowOpenHandler(({ url }) => { xray.popup(w.id); if (web(url)) w.loadURL(url); return { action: 'deny' }; });
  const guardNav = (e, url) => { if (!web(url)) e.preventDefault(); };
  w.on('will-navigate', guardNav); w.on('will-redirect', guardNav);
  // «Рентген» начинается заново на каждой новой странице (переходы внутри страницы его не сбрасывают)
  w.on('did-start-navigation', (e) => { if (e.isMainFrame && !e.isSameDocument && !e.isRedirect) xray.reset(w.id, e.url); });
  ['did-start-loading', 'did-stop-loading', 'did-navigate', 'did-navigate-in-page', 'page-title-updated'].forEach((ev) => w.on(ev, () => state()));
  w.on('did-fail-load', (e, code, desc, url, main) => { if (main && code !== -3) state({ error: desc + ' (' + code + ')' }); });
  w.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'Escape') { e.preventDefault(); send({ escape: true }); }
    if (input.alt && input.key === 'ArrowLeft') { e.preventDefault(); nav('back'); }
    if (input.alt && input.key === 'ArrowRight') { e.preventDefault(); nav('forward'); }
  });
  w.on('devtools-opened', () => w.closeDevTools());
  owner.contentView.addChildView(view);
}
async function open(win, url, bounds, opts, onState) {
  if (!web(url)) return { ok: false, err: 'Открываются только адреса http и https' };
  const p = await search.applyProxy(opts && opts.proxy);
  if (!p.ok) return p;
  const wantJs = !(opts && opts.js === false);
  if (view && (wantJs !== js || owner !== win)) close(true);
  owner = win; send = onState; js = wantJs;
  if (!view) create();
  setBounds(bounds);
  view.setVisible(true);
  view.webContents.loadURL(url).catch(() => {});
  return { ok: true };
}
function setBounds(b) {
  if (!view || !b) return;
  view.setBounds({ x: Math.round(b.x), y: Math.round(b.y), width: Math.max(0, Math.round(b.width)), height: Math.max(0, Math.round(b.height)) });
}
function nav(cmd, url) {
  if (!view) return { ok: false };
  const w = view.webContents, nh = w.navigationHistory;
  if (cmd === 'back' && nh.canGoBack()) nh.goBack();
  else if (cmd === 'forward' && nh.canGoForward()) nh.goForward();
  else if (cmd === 'reload') w.reload();
  else if (cmd === 'stop') w.stop();
  else if (cmd === 'load' && web(url)) w.loadURL(url).catch(() => {});
  return { ok: true };
}
const setVisible = (on) => { if (view) view.setVisible(!!on); };
// закрытие: вставка уничтожается, всё, что сайты успели сохранить в сессии, стирается
function close(keepSession) {
  if (view) {
    xray.drop(view.webContents.id);
    try { owner.contentView.removeChildView(view); } catch (e) { /* окно уже закрыто */ }
    try { view.webContents.close(); } catch (e) { /* уже закрыт */ }
    view = null;
  }
  if (!keepSession) search.forget();
  return { ok: true };
}
const current = () => (view ? view.webContents.getURL() : '');
const report = () => (view ? xray.report(view.webContents.id) : { ok: false, err: 'Сайт не открыт' });

module.exports = { open, setBounds, nav, setVisible, close, current, report };
