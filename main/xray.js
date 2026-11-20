// «Рентген сайта»: что страница во встроенном окне пыталась загрузить, куда ходила, какие cookies ставила и о чём просила.
// Отчёт собирается из сетевых событий приватной сессии — сам сайт его не видит и не может на него повлиять.
// Всё живёт только в памяти и пропадает вместе с окном просмотра.

// [домен, владелец, вид, начало пути (если трекер живёт по отдельному адресу на обычном сайте)]
const RULES = [
  ['google-analytics.com', 'Google', 'аналитика'], ['googletagmanager.com', 'Google', 'менеджер трекеров'], ['googlesyndication.com', 'Google', 'реклама'],
  ['googleadservices.com', 'Google', 'реклама'], ['googletagservices.com', 'Google', 'реклама'], ['doubleclick.net', 'Google', 'реклама'],
  ['adservice.google.com', 'Google', 'реклама'], ['google.com', 'Google', 'реклама', '/pagead/'],
  ['mc.yandex.ru', 'Яндекс', 'Метрика'], ['mc.yandex.com', 'Яндекс', 'Метрика'], ['mc.webvisor.org', 'Яндекс', 'запись действий (Вебвизор)'],
  ['mc.webvisor.com', 'Яндекс', 'запись действий (Вебвизор)'], ['an.yandex.ru', 'Яндекс', 'реклама'], ['yandexadexchange.net', 'Яндекс', 'реклама'],
  ['adfox.ru', 'Яндекс', 'реклама'], ['top-fwz1.mail.ru', 'VK', 'счётчик Top@Mail.ru'], ['top.mail.ru', 'VK', 'счётчик Top@Mail.ru'],
  ['ad.mail.ru', 'VK', 'реклама'], ['vk.com', 'VK', 'пиксель соцсети', '/rtrg'], ['counter.yadro.ru', 'LiveInternet', 'счётчик'],
  ['tns-counter.ru', 'Mediascope', 'измерение аудитории'], ['top100.rambler.ru', 'Rambler', 'счётчик'], ['counter.rambler.ru', 'Rambler', 'счётчик'],
  ['kraken.rambler.ru', 'Rambler', 'счётчик'], ['adriver.ru', 'AdRiver', 'реклама'],
  ['connect.facebook.net', 'Meta', 'пиксель соцсети'], ['pixel.facebook.com', 'Meta', 'пиксель соцсети'], ['facebook.com', 'Meta', 'пиксель соцсети', '/tr'],
  ['analytics.tiktok.com', 'TikTok', 'пиксель соцсети'], ['analytics.twitter.com', 'X (Twitter)', 'пиксель соцсети'], ['static.ads-twitter.com', 'X (Twitter)', 'пиксель соцсети'],
  ['px.ads.linkedin.com', 'LinkedIn', 'пиксель соцсети'], ['snap.licdn.com', 'LinkedIn', 'пиксель соцсети'], ['tr.snapchat.com', 'Snap', 'пиксель соцсети'],
  ['ct.pinterest.com', 'Pinterest', 'пиксель соцсети'], ['bat.bing.com', 'Microsoft', 'реклама'], ['clarity.ms', 'Microsoft', 'запись действий (Clarity)'],
  ['hotjar.com', 'Hotjar', 'запись действий'], ['hotjar.io', 'Hotjar', 'запись действий'], ['fullstory.com', 'FullStory', 'запись действий'],
  ['mouseflow.com', 'Mouseflow', 'запись действий'], ['smartlook.com', 'Smartlook', 'запись действий'], ['smartlook.cloud', 'Smartlook', 'запись действий'],
  ['lr-ingest.io', 'LogRocket', 'запись действий'], ['logrocket.io', 'LogRocket', 'запись действий'],
  ['mixpanel.com', 'Mixpanel', 'аналитика'], ['segment.io', 'Segment', 'аналитика'], ['cdn.segment.com', 'Segment', 'аналитика'], ['amplitude.com', 'Amplitude', 'аналитика'],
  ['optimizely.com', 'Optimizely', 'аналитика'], ['cloudflareinsights.com', 'Cloudflare', 'аналитика'], ['scorecardresearch.com', 'Comscore', 'измерение аудитории'],
  ['quantserve.com', 'Quantcast', 'реклама'], ['criteo.com', 'Criteo', 'реклама'], ['criteo.net', 'Criteo', 'реклама'], ['taboola.com', 'Taboola', 'реклама'],
  ['outbrain.com', 'Outbrain', 'реклама'], ['adnxs.com', 'Xandr', 'реклама'], ['rubiconproject.com', 'Magnite', 'реклама'], ['pubmatic.com', 'PubMatic', 'реклама'],
  ['openx.net', 'OpenX', 'реклама'], ['moatads.com', 'Oracle Moat', 'реклама'], ['bam.nr-data.net', 'New Relic', 'мониторинг'], ['js-agent.newrelic.com', 'New Relic', 'мониторинг'],
  ['sentry.io', 'Sentry', 'мониторинг'], ['top100.ru', 'Rambler', 'счётчик'], ['aidata.io', 'AiData', 'профилирование'], ['aidata.me', 'AiData', 'профилирование'],
  ['digitaltarget.ru', 'Digital Target', 'профилирование'], ['otm-r.com', 'OTM', 'реклама'], ['adhigh.net', 'AdHigh', 'реклама'], ['betweendigital.com', 'Between Digital', 'реклама'],
  ['buzzoola.com', 'Buzzoola', 'реклама'], ['relap.io', 'Relap', 'реклама'], ['smi2.ru', 'СМИ2', 'реклама'], ['smi2.net', 'СМИ2', 'реклама'], ['bidswitch.net', 'BidSwitch', 'реклама'],
  ['adsrvr.org', 'The Trade Desk', 'реклама'], ['casalemedia.com', 'Index Exchange', 'реклама'], ['3lift.com', 'TripleLift', 'реклама'], ['teads.tv', 'Teads', 'реклама'],
  ['amazon-adsystem.com', 'Amazon', 'реклама'], ['demdex.net', 'Adobe', 'профилирование'], ['omtrdc.net', 'Adobe', 'аналитика'], ['everesttech.net', 'Adobe', 'реклама'],
  ['krxd.net', 'Salesforce', 'профилирование'], ['bluekai.com', 'Oracle', 'профилирование'], ['exelator.com', 'Nielsen', 'профилирование'], ['addthis.com', 'Oracle AddThis', 'кнопки соцсетей'],
  ['sharethis.com', 'ShareThis', 'кнопки соцсетей'], ['weborama.fr', 'Weborama', 'профилирование'], ['weborama.com', 'Weborama', 'профилирование'],
];
const KIND_HELP = {
  'аналитика': 'считает визиты и строит профиль твоих посещений',
  'Метрика': 'считает визиты и строит профиль твоих посещений; Яндекс видит, на каких сайтах ты бываешь',
  'менеджер трекеров': 'подгружает на страницу другие трекеры',
  'реклама': 'узнаёт тебя на разных сайтах, чтобы показывать рекламу',
  'пиксель соцсети': 'сообщает соцсети, что ты был на этом сайте, даже если ты ничего не нажимал',
  'запись действий': 'записывает движения мыши, клики и ввод, чтобы потом «проиграть» визит',
  'измерение аудитории': 'панельный счётчик для статистики посещаемости',
  'счётчик': 'счётчик посещаемости, видит адреса страниц, которые ты открываешь',
  'мониторинг': 'следит за ошибками и скоростью страницы, видит адреса страниц',
  'профилирование': 'собирает профиль твоих интересов и продаёт его рекламодателям',
  'кнопки соцсетей': 'кнопки «поделиться», которые следят за посещениями',
};
const kindHelp = (k) => KIND_HELP[k] || KIND_HELP[Object.keys(KIND_HELP).find((x) => k.startsWith(x))] || '';
// чьи серверы: крупные владельцы узнаются по домену, остальные показываются по адресу сайта
const OWNERS = [
  [['google.com', 'google.ru', 'googleapis.com', 'gstatic.com', 'googleusercontent.com', 'googlevideo.com', 'youtube.com', 'youtube-nocookie.com', 'ytimg.com', 'ggpht.com', 'recaptcha.net'], 'Google'],
  [['yandex.ru', 'yandex.net', 'yandex.com', 'yastatic.net', 'ya.ru', 'yandex.by', 'yandex.kz', 'yandexcloud.net'], 'Яндекс'],
  [['vk.com', 'vk.ru', 'userapi.com', 'vkuser.net', 'vk-cdn.net', 'vkuseraudio.net', 'mail.ru', 'mycdn.me', 'ok.ru', 'imgsmail.ru'], 'VK'],
  [['facebook.com', 'facebook.net', 'fbcdn.net', 'instagram.com', 'cdninstagram.com', 'whatsapp.net', 'whatsapp.com'], 'Meta'],
  [['microsoft.com', 'bing.com', 'msn.com', 'live.com', 'azureedge.net', 'azure.com', 'windows.net', 'office.com', 'linkedin.com', 'licdn.com', 'github.com', 'githubusercontent.com', 'github.io'], 'Microsoft'],
  [['cloudflare.com', 'cloudflare.net'], 'Cloudflare'], [['amazonaws.com', 'cloudfront.net', 'amazon.com', 'media-amazon.com'], 'Amazon'],
  [['akamaihd.net', 'akamaized.net', 'akamai.net', 'edgekey.net', 'edgesuite.net'], 'Akamai'], [['twitter.com', 'x.com', 'twimg.com'], 'X (Twitter)'],
  [['tiktok.com', 'tiktokcdn.com', 'ttwstatic.com', 'byteoversea.com'], 'TikTok'], [['jsdelivr.net', 'unpkg.com'], 'открытый CDN'], [['fastly.net', 'fastly.com'], 'Fastly'],
  [['wikimedia.org', 'wikipedia.org'], 'Википедия'], [['apple.com', 'icloud.com', 'mzstatic.com'], 'Apple'], [['telegram.org', 't.me'], 'Telegram'], [['rambler.ru'], 'Rambler'],
];
const OWNER_OF = new Map(OWNERS.flatMap(([list, o]) => list.map((d) => [d, o])));
const COOKIE_WHO = [
  [/^_ga($|_)|^_gid$|^_gat/, 'Google Analytics'], [/^__utm[abcz]$/, 'Google Analytics'], [/^_gcl_/, 'Google Ads'], [/^(IDE|DSID|test_cookie|__gads|__gpi)$/, 'Google, реклама'],
  [/^(NID|1P_JAR|AEC|SOCS|CONSENT)$/, 'Google'], [/^_ym_/, 'Яндекс Метрика'], [/^(yandexuid|yuidss|ymex|yabs-sid|yp|ys|bh|i)$/, 'Яндекс'],
  [/^(_fbp|_fbc|fr)$/, 'Meta, пиксель'], [/^_hj/, 'Hotjar'], [/^(_clck|_clsk|CLID|MUID|_uetsid|_uetvid)$/, 'Microsoft (Clarity, Bing)'],
  [/^tmr_/, 'Top@Mail.ru (VK)'], [/^remix/, 'VK'], [/^(_ttp|_tt_enable_cookie|ttwid)$/, 'TikTok'], [/^(__cf_bm|cf_clearance|__cfruid|_cfuvid)$/, 'Cloudflare, защита от ботов'],
  [/^(_pin_unauth|_pinterest_)/, 'Pinterest'], [/^(li_sugr|bcookie|lidc|UserMatchHistory|AnalyticsSyncHistory)$/, 'LinkedIn'], [/^(mp_|mixpanel)/, 'Mixpanel'],
  [/^(ajs_|_segment)/, 'Segment'], [/^(amplitude|AMP_)/, 'Amplitude'], [/^cto_/, 'Criteo'], [/^t_gid$/, 'Taboola'],
  [/^(PHPSESSID|JSESSIONID|ASP\.NET_SessionId|connect\.sid|sessionid|session|sid)$/i, 'сеанс сайта'], [/^(csrftoken|XSRF-TOKEN|_csrf)$/i, 'защита форм'],
];
const ASK = {
  geolocation: 'геопозицию', notifications: 'показывать уведомления', midi: 'доступ к MIDI-устройствам', midiSysex: 'доступ к MIDI-устройствам',
  'clipboard-read': 'читать буфер обмена', pointerLock: 'захватить указатель мыши', keyboardLock: 'перехватить клавиатуру', openExternal: 'открыть внешнюю программу',
  'idle-detection': 'следить, когда ты отходишь от компьютера', 'window-management': 'узнать расположение окон и экранов', 'display-capture': 'записать экран',
  'storage-access': 'доступ к своим cookies на других сайтах', 'top-level-storage-access': 'доступ к своим cookies на других сайтах', 'speaker-selection': 'выбор динамиков',
  'persistent-storage': 'хранить данные без срока', fullscreen: 'полноэкранный режим',
};

// второй уровень, под которым регистрируют сайты (site.co.uk, site.com.ru)
const SLD2 = new Set(['co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'com.au', 'net.au', 'org.au', 'co.jp', 'ne.jp', 'or.jp', 'com.br', 'com.cn', 'com.tr', 'co.in', 'com.ua', 'org.ua', 'net.ua', 'in.ua', 'kiev.ua',
  'com.ru', 'org.ru', 'net.ru', 'msk.ru', 'spb.ru', 'pp.ru', 'com.kz', 'org.kz', 'co.kr', 'com.mx', 'com.ar', 'com.pl', 'co.za', 'com.sg', 'com.hk', 'com.tw', 'co.nz', 'co.il', 'com.by']);
function site(host) {
  const h = String(host || '').toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (/^[\d.]+$/.test(h) || h.includes(':')) return h;
  const p = h.split('.'); if (p.length <= 2) return h;
  return SLD2.has(p.slice(-2).join('.')) ? p.slice(-3).join('.') : p.slice(-2).join('.');
}
const under = (host, d) => host === d || host.endsWith('.' + d);
function trackerOf(host, pathname) {
  const h = String(host || '').toLowerCase();
  for (const r of RULES) if (under(h, r[0]) && (!r[3] || String(pathname || '').startsWith(r[3]))) return { owner: r[1], kind: r[2] };
  return null;
}
const ownerOf = (host) => OWNER_OF.get(site(host)) || null;

/* ---------- отчёты по окнам ---------- */
const pages = new Map();
let current = 0;   // окно, к которому относятся cookies (одновременно открыт один просмотр)
function fresh(url) {
  let host = ''; try { host = new URL(url).hostname.toLowerCase(); } catch (e) { /* без адреса */ }
  return { host, site: host ? site(host) : '', since: Date.now(), requests: 0, thirdRequests: 0, blocked: 0, trackers: new Map(), third: new Map(), cookies: new Map(), asks: new Map(), popups: 0, downloads: 0 };
}
const page = (id) => { let r = pages.get(id); if (!r) { r = fresh(''); pages.set(id, r); } return r; };
function reset(id, url) { pages.set(id, fresh(url)); }
function drop(id) { pages.delete(id); if (current === id) current = 0; }
function focus(id) { current = id || 0; }

// каждый запрос сессии: true — заблокировать (трекер)
function request(id, url, type) {
  let u; try { u = new URL(url); } catch (e) { return false; }
  if (!/^(https?|wss?):$/.test(u.protocol)) return false;
  const host = u.hostname.toLowerCase(), t = trackerOf(host, u.pathname), r = page(id || 0);
  if (type === 'mainFrame' && !t) { r.host = host; r.site = site(host); }
  r.requests++;
  const third = !!r.site && site(host) !== r.site;
  if (third) r.thirdRequests++;
  if (t) {
    r.blocked++;
    const k = t.owner + '\u0001' + t.kind, e = r.trackers.get(k) || { owner: t.owner, kind: t.kind, n: 0, hosts: new Map() };
    e.n++; e.hosts.set(host, (e.hosts.get(host) || 0) + 1); r.trackers.set(k, e);
    return true;
  }
  if (third && r.third.size < 400) r.third.set(host, (r.third.get(host) || 0) + 1);
  return false;
}
function cookie(c) {
  if (!c || !c.name) return;
  const r = page(current), dom = String(c.domain || '').replace(/^\./, '').toLowerCase();
  if (r.cookies.size >= 300) return;
  const who = (COOKIE_WHO.find(([re]) => re.test(c.name)) || [])[1] || '';
  let life = 'до закрытия';
  if (!c.session && c.expirationDate) {
    const days = (c.expirationDate * 1000 - Date.now()) / 864e5;
    life = days < 1 ? 'меньше суток' : days < 60 ? 'на ' + Math.round(days) + ' дн.' : days < 700 ? 'на ' + Math.round(days / 30) + ' мес.' : 'на ' + Math.round(days / 365) + ' г.';
  }
  r.cookies.set(dom + '\u0001' + c.name, { name: c.name, domain: dom, third: !!r.site && site(dom) !== r.site, who, life, httpOnly: !!c.httpOnly });
}
function ask(id, perm, details) {
  let what = ASK[perm];
  if (perm === 'media') { const t = (details && details.mediaTypes) || []; what = t.includes('video') && t.includes('audio') ? 'камеру и микрофон' : t.includes('video') ? 'камеру' : 'микрофон'; }
  if (!what) what = String(perm);
  const r = page(id || 0); r.asks.set(what, (r.asks.get(what) || 0) + 1);
}
const popup = (id) => { page(id || 0).popups++; };
const download = (id) => { page(id || 0).downloads++; };

function summary(id) {
  const r = pages.get(id); if (!r) return { trackers: 0, third: 0, cookies: 0 };
  return { trackers: r.blocked, third: r.third.size, cookies: r.cookies.size };
}
function report(id) {
  const r = pages.get(id); if (!r) return { ok: false, err: 'Отчёта пока нет' };
  const byOwner = new Map();
  for (const [host, n] of r.third) { const o = ownerOf(host) || site(host); const e = byOwner.get(o) || { owner: o, n: 0, hosts: [] }; e.n += n; e.hosts.push({ host, n }); byOwner.set(o, e); }
  return {
    ok: true, host: r.host, since: r.since,
    totals: { requests: r.requests, third: r.thirdRequests, blocked: r.blocked, thirdHosts: r.third.size, cookies: r.cookies.size, thirdCookies: [...r.cookies.values()].filter((c) => c.third).length },
    trackers: [...r.trackers.values()].map((e) => ({ owner: e.owner, kind: e.kind, help: kindHelp(e.kind), n: e.n, hosts: [...e.hosts.keys()] })).sort((a, b) => b.n - a.n),
    third: [...byOwner.values()].map((e) => ({ ...e, hosts: e.hosts.sort((a, b) => b.n - a.n) })).sort((a, b) => b.n - a.n),
    cookies: [...r.cookies.values()].sort((a, b) => (b.third - a.third) || (!!b.who - !!a.who)),
    asks: [...r.asks.entries()].map(([what, n]) => ({ what, n })), popups: r.popups, downloads: r.downloads,
  };
}
// трекеры в коде страницы — для «Читалки», где сама страница не запускается
function scanHtml(html, base) {
  const seen = new Map(); let own = '';
  try { own = site(new URL(base).hostname); } catch (e) { /* без адреса */ }
  const re = /(?:https?:)?\/\/([a-z0-9][a-z0-9.-]*\.[a-z]{2,})(\/[^\s"'<>)\\]*)?/gi;
  let m, guard = 0;
  while ((m = re.exec(String(html).slice(0, 3e6))) && guard++ < 20000) {
    const host = m[1].toLowerCase(), t = trackerOf(host, m[2] || '/');
    if (!t || site(host) === own) continue;
    const k = t.owner + '\u0001' + t.kind; if (!seen.has(k)) seen.set(k, { owner: t.owner, kind: t.kind, help: kindHelp(t.kind), host });
  }
  return [...seen.values()];
}

module.exports = { request, cookie, ask, popup, download, reset, drop, focus, summary, report, scanHtml, site, trackerOf };
