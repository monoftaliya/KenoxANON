// Анонимный поиск через DuckDuckGo (HTML-версия). Отдельная сессия только в памяти, свой прокси SOCKS5/HTTP,
// обычный браузерный User-Agent вместо «Electron», cookies и кэш стираются после каждого запроса, запросы нигде не записываются.
const { session } = require('electron');
const xray = require('./xray');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const ENDPOINT = 'https://html.duckduckgo.com/html/';
const REGIONS = { 'wt-wt': 'Весь мир', 'ru-ru': 'Россия', 'us-en': 'США', 'de-de': 'Германия', 'kz-ru': 'Казахстан', 'ua-uk': 'Украина' };
const SAFE = { strict: '1', moderate: '-1', off: '-2' };
const TIME = { any: '', d: 'd', w: 'w', m: 'm', y: 'y' };
const NEXT_KEYS = ['q', 's', 'nextParams', 'v', 'o', 'dc', 'api', 'vqd', 'kl', 'kp', 'df'];

let ses = null;
function sess() {
  if (ses) return ses;
  ses = session.fromPartition('kx-search');   // без «persist:» — всё живёт только в памяти
  ses.setUserAgent(UA);
  // камера, микрофон, геопозиция, уведомления и прочее — всегда «нет»; просьбы попадают в «Рентген»
  ses.setPermissionRequestHandler((wc, perm, cb, details) => { xray.ask(wc ? wc.id : 0, perm, details); cb(false); });
  ses.setPermissionCheckHandler(() => false);
  ses.on('will-download', (e, item, wc) => { xray.download(wc ? wc.id : 0); e.preventDefault(); });   // загрузки из встроенного просмотра отключены
  ses.cookies.on('changed', (e, cookie, cause, removed) => { if (!removed) xray.cookie(cookie); });
  // трекеры режутся, а каждый запрос учитывается в «Рентгене» (адреса, не содержимое)
  ses.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] }, (d, cb) => cb(xray.request(d.webContentsId || 0, d.url, d.resourceType) ? { cancel: true } : {}));
  const all = { urls: ['http://*/*', 'https://*/*'] };
  // чужим сайтам не сообщаем, откуда ты пришёл
  ses.webRequest.onBeforeSendHeaders(all, (d, cb) => {
    const hd = d.requestHeaders, ref = hd.Referer || hd.referer;
    if (ref) { try { if (new URL(ref).hostname !== new URL(d.url).hostname) { delete hd.Referer; delete hd.referer; } } catch (e) { delete hd.Referer; delete hd.referer; } }
    cb({ requestHeaders: hd });
  });
  return ses;
}
const HOST = /^(?:[a-z0-9-]{1,63}\.)*[a-z0-9-]{1,63}$|^\d{1,3}(?:\.\d{1,3}){3}$|^\[?[0-9a-f:]{2,39}\]?$/i;
function proxyRules(p) {
  if (!p || p.type === 'none') return { ok: true, rules: 'direct://' };
  if (!/^(socks5|http)$/.test(p.type)) return { ok: false, err: 'Неизвестный тип прокси' };
  const host = String(p.host || '').trim(), port = Number(p.port);
  if (!HOST.test(host)) return { ok: false, err: 'Неверный адрес прокси' };
  if (!Number.isInteger(port) || port < 1 || port > 65535) return { ok: false, err: 'Неверный порт прокси' };
  return { ok: true, rules: p.type + '://' + (host.includes(':') && !host.startsWith('[') ? '[' + host + ']' : host) + ':' + port };
}
function netErr(e) {
  const m = String(e && (e.message || e.name) || e);
  if (/PROXY_CONNECTION_FAILED|SOCKS_CONNECTION_FAILED|SOCKS_CONNECTION_HOST_UNREACHABLE/.test(m)) return 'Прокси не отвечает — проверь адрес и порт и что прокси запущен';
  if (/TUNNEL_CONNECTION_FAILED|PROXY_AUTH/.test(m)) return 'Прокси не пропустил соединение (возможно, нужен логин — такие прокси пока не поддерживаются)';
  if (/INTERNET_DISCONNECTED/.test(m)) return 'Нет подключения к интернету';
  if (/NAME_NOT_RESOLVED/.test(m)) return 'Не удалось найти сервер — адрес не существует, заблокирован или нет соединения';
  if (/Timeout|Abort/i.test(m)) return 'Нет ответа за 20 секунд';
  return 'Не получилось: ' + m.slice(0, 120);
}

/* ---------- разбор выдачи ---------- */
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'", '#x27': "'" };
const text = (h) => String(h || '').replace(/<b>/gi, '\u0001').replace(/<\/b>/gi, '\u0002').replace(/<[^>]+>/g, '')
  .replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, e) => (ENT[e.toLowerCase()] !== undefined ? ENT[e.toLowerCase()] : e[0] === '#' ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : m))
  .replace(/\s+/g, ' ').trim();
// ссылки иногда идут через перенаправление duckduckgo.com/l/?uddg= — достаём настоящий адрес, чтобы не ходить через DuckDuckGo
function realUrl(href) {
  let u = text(href).replace(/[\u0001\u0002]/g, '');
  if (u.startsWith('//')) u = 'https:' + u;
  try { const x = new URL(u); if (/duckduckgo\.com$/.test(x.hostname) && x.pathname === '/l/' && x.searchParams.get('uddg')) return x.searchParams.get('uddg'); } catch (e) { return ''; }
  return u;
}
function parse(html) {
  const results = [];
  const blocks = html.split(/<div class="result results_links/).slice(1);
  for (const b of blocks) {
    if (/result--ad/.test(b.slice(0, 200))) continue;   // реклама не показывается
    const a = /class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/.exec(b) || /href="([^"]+)"[^>]*class="result__a"[^>]*>([\s\S]*?)<\/a>/.exec(b);
    if (!a) continue;
    const url = realUrl(a[1]);
    if (!/^https?:\/\//i.test(url)) continue;
    const sn = /class="result__snippet"[^>]*>([\s\S]*?)<\/(?:a|div)>/.exec(b), disp = /class="result__url"[^>]*>([\s\S]*?)<\/a>/.exec(b);
    results.push({ title: text(a[2]).replace(/[\u0001\u0002]/g, ''), url, display: disp ? text(disp[1]).replace(/[\u0001\u0002]/g, '') : url.replace(/^https?:\/\//, ''), snippet: sn ? text(sn[1]) : '' });
  }
  // форма «Next» — параметры следующей страницы
  let next = null;
  for (const f of html.split('<div class="nav-link">').slice(1)) {
    const form = f.slice(0, f.indexOf('</form>'));
    if (!/value="Next"/i.test(form)) continue;
    next = {};
    for (const m of form.matchAll(/<input[^>]*name="([^"]+)"[^>]*value="([^"]*)"|<input[^>]*value="([^"]*)"[^>]*name="([^"]+)"/g)) {
      const k = m[1] || m[4], v = m[2] !== undefined ? m[2] : m[3];
      if (NEXT_KEYS.includes(k)) next[k] = text(v).replace(/[\u0001\u0002]/g, '');
    }
  }
  return { results, next, empty: !results.length };
}

async function fetchVia(proxy, url, init) {
  const r = proxyRules(proxy);
  if (!r.ok) return { ok: false, err: r.err };
  const s = sess();
  await s.setProxy({ proxyRules: r.rules });
  try { return { ok: true, res: await s.fetch(url, { ...init, cache: 'no-store', signal: AbortSignal.timeout(20000) }) }; }
  catch (e) { return { ok: false, err: netErr(e) }; }
}
// после каждого запроса стираем всё, что сессия могла запомнить
const forget = () => { const s = sess(); return Promise.all([s.clearStorageData(), s.clearCache(), s.clearAuthCache(), s.clearHostResolverCache()]).catch(() => {}); };

async function search(args, proxy) {
  const a = args && typeof args === 'object' ? args : {};
  let form;
  if (a.next && typeof a.next === 'object') { form = {}; for (const k of NEXT_KEYS) if (typeof a.next[k] === 'string') form[k] = a.next[k].slice(0, 500); }
  else {
    const q = String(a.q || '').trim().slice(0, 500);
    if (!q) return { ok: false, err: 'Пустой запрос' };
    form = { q, kl: REGIONS[a.region] ? a.region : 'wt-wt', kp: SAFE[a.safe] || SAFE.moderate };
    if (TIME[a.time]) form.df = TIME[a.time];
  }
  const t0 = Date.now();
  const r = await fetchVia(proxy, ENDPOINT, { method: 'POST', body: new URLSearchParams(form).toString(), headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'text/html', 'Accept-Language': form.kl === 'ru-ru' ? 'ru-RU,ru;q=0.9,en;q=0.6' : 'en-US,en;q=0.8' } });
  try {
    if (!r.ok) return r;
    const html = await r.res.text();
    if (r.res.status === 202 || /anomaly-modal|challenge-form|bots use DuckDuckGo/i.test(html)) return { ok: false, captcha: true, err: 'DuckDuckGo решил, что запросов слишком много, и просит подтвердить, что ты человек.' };
    if (!r.res.ok) return { ok: false, err: 'DuckDuckGo ответил ' + r.res.status };
    return { ok: true, ms: Date.now() - t0, ...parse(html) };
  } catch (e) { return { ok: false, err: netErr(e) }; }
  finally { await forget(); }
}
// Проверка соединения: какой IP видят сайты и идёт ли трафик через Tor
async function check(proxy) {
  const t0 = Date.now();
  const r = await fetchVia(proxy, 'https://check.torproject.org/api/ip', { method: 'GET', headers: { Accept: 'application/json' } });
  try {
    if (!r.ok) return r;
    const j = await r.res.json();
    return { ok: true, ip: String(j.IP || ''), tor: !!j.IsTor, ms: Date.now() - t0 };
  } catch (e) { return { ok: false, err: netErr(e) }; }
  finally { await forget(); }
}

// Страница для «Читалки»: загружается через ту же приватную сессию и прокси, кодировка определяется по заголовку или <meta>
async function fetchPage(url, proxy) {
  if (!/^https?:\/\/[^\s]+$/i.test(String(url))) return { ok: false, err: 'Открываются только адреса http и https' };
  xray.reset(0, String(url));
  const r = await fetchVia(proxy, String(url), { method: 'GET', redirect: 'follow', headers: { Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5', 'Accept-Language': 'ru-RU,ru;q=0.9,en;q=0.7' } });
  try {
    if (!r.ok) return r;
    const type = r.res.headers.get('content-type') || '', final = r.res.url || String(url);
    if (!/html|xml/i.test(type)) return { ok: false, notPage: true, url: final, err: 'Это не веб-страница (' + (type.split(';')[0] || 'неизвестный тип') + ') — её можно открыть оригиналом или в браузере' };
    if (Number(r.res.headers.get('content-length')) > 8 * 1024 * 1024) return { ok: false, url: final, err: 'Страница слишком большая для читалки' };
    const buf = Buffer.from(await r.res.arrayBuffer()).subarray(0, 6 * 1024 * 1024);
    const cs = (/charset=([\w-]+)/i.exec(type) || /<meta[^>]+charset=["']?([\w-]+)/i.exec(buf.subarray(0, 4096).toString('latin1')) || [])[1] || 'utf-8';
    let html; try { html = new TextDecoder(cs.toLowerCase()).decode(buf); } catch (e) { html = buf.toString('utf8'); }
    return { ok: true, url: final, status: r.res.status, html, trackersInCode: xray.scanHtml(html, final) };
  } catch (e) { return { ok: false, err: netErr(e) }; }
  finally { xray.reset(0, ''); await forget(); }
}
// Проверка адреса для утилит: код ответа и куда в итоге ведёт ссылка — страница целиком не скачивается
async function probe(url, proxy) {
  if (!/^https?:\/\/\S+$/i.test(String(url))) return { ok: false, err: 'Нужен адрес вида https://…' };
  const t0 = Date.now();
  const r = await fetchVia(proxy, String(url), { method: 'GET', redirect: 'follow', headers: { Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5', 'Accept-Language': 'ru-RU,ru;q=0.9,en;q=0.7' } });
  try {
    if (!r.ok) return r;
    const out = { ok: true, status: r.res.status, url: r.res.url || String(url), redirected: !!r.res.redirected, type: (r.res.headers.get('content-type') || '').split(';')[0], ms: Date.now() - t0 };
    try { if (r.res.body) await r.res.body.cancel(); } catch (e) { /* тело уже закрыто */ }
    return out;
  } catch (e) { return { ok: false, err: netErr(e) }; }
  finally { await forget(); }
}
// Отписка от рассылки «в один клик» (RFC 8058): один POST на адрес из заголовка письма, через приватную сессию и прокси, без cookies
async function oneClick(url, proxy) {
  if (!/^https:\/\/\S+$/i.test(String(url))) return { ok: false, err: 'Нужна ссылка https' };
  const r = await fetchVia(proxy, String(url), { method: 'POST', redirect: 'follow', body: 'List-Unsubscribe=One-Click', headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
  try {
    if (!r.ok) return r;
    const status = r.res.status;
    try { if (r.res.body) await r.res.body.cancel(); } catch (e) { /* тело уже закрыто */ }
    return { ok: status >= 200 && status < 400, status, err: status >= 400 ? 'сервер ответил ' + status : undefined };
  } catch (e) { return { ok: false, err: netErr(e) }; }
  finally { await forget(); }
}
async function applyProxy(proxy) { const r = proxyRules(proxy); if (r.ok) await sess().setProxy({ proxyRules: r.rules }); return r; }

module.exports = { search, check, fetchPage, probe, oneClick, applyProxy, forget, session: sess, proxyRules, parse, REGIONS, UA };
