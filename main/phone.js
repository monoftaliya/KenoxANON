// «Найти себя по номеру»: номер записывается во всех привычных видах (+7 999 123-45-67, 89991234567…),
// каждый вид ищется в DuckDuckGo через «Анонимный поиск» (его приватную сессию и прокси), а потом каждая найденная
// страница открывается в отдельной приватной сессии и проверяется: есть ли на ней номер на самом деле.
// Номер и найденное нигде не сохраняются — результат живёт только в памяти окна.
const { session } = require('electron');
const search = require('./search');

/* ---------- номер: разбор и варианты записи ---------- */
// коды стран, которые встречаются чаще всего; для остальных номер берётся целиком
const CC = { 7: { trunk: '8' }, 380: { trunk: '0', region: 'ua-uk' }, 375: { trunk: '80' }, 374: { trunk: '0' }, 994: { trunk: '0' }, 995: { trunk: '0' }, 996: { trunk: '0' },
  998: { trunk: '' }, 992: { trunk: '' }, 993: { trunk: '8' }, 373: { trunk: '0' }, 371: { trunk: '' }, 372: { trunk: '' }, 370: { trunk: '8' }, 972: { trunk: '0' },
  49: { trunk: '0', region: 'de-de' }, 44: { trunk: '0' }, 33: { trunk: '0' }, 39: { trunk: '' }, 34: { trunk: '' }, 48: { trunk: '' }, 90: { trunk: '0' }, 1: { trunk: '1', region: 'us-en' } };
const CODES = Object.keys(CC).sort((a, b) => b.length - a.length);

function normalize(raw) {
  const s = String(raw || '').trim().slice(0, 40);
  if (/[a-zа-яё]/i.test(s)) return { ok: false, err: 'В номере должны быть только цифры, пробелы, скобки, «+» и «-»' };
  let d = s.replace(/\D/g, '');
  const intl = /^\s*(\+|00)/.test(s);
  if (/^\s*00/.test(s)) d = d.slice(2);
  let cc = '', nsn = '';
  if (!intl && d.length === 11 && /^[78]/.test(d)) { cc = '7'; nsn = d.slice(1); }
  else if (!intl && d.length === 10 && /^[3-9]/.test(d)) { cc = '7'; nsn = d; }
  else if (intl) { cc = CODES.find((c) => d.startsWith(c)) || ''; nsn = cc ? d.slice(cc.length) : ''; if (!cc && d.length >= 8 && d.length <= 15) { cc = d.slice(0, 2); nsn = d.slice(2); } }
  if (!cc || nsn.length < 6 || nsn.length > 13 || (cc === '7' && nsn.length !== 10)) return { ok: false, err: 'Не похоже на номер телефона. Напиши его целиком, например +7 999 123-45-67' };
  const C = CC[cc] || { trunk: '0' };
  const n = nsn.length, g = n >= 9 ? [n - 7, 3, 2, 2] : [n - 4, 2, 2];
  let i = 0; const groups = g.map((k) => { const p = nsn.slice(i, i + k); i += k; return p; });
  const pretty = '+' + cc + ' ' + groups[0] + ' ' + groups[1] + '-' + groups.slice(2).join('-');
  // варианты для поиска: группами (так совпадает «+7 (999) 123-45-67», «8 999 123 45 67», «8-999-123-45-67»), слитно с местной «8» / «0», с кодом страны и без
  const forms = [groups.join(' ')];
  if (C.trunk && C.trunk !== cc) forms.push(C.trunk + nsn);
  forms.push(cc + nsn, nsn);
  const queries = [...new Set(forms)].map((q) => '"' + q + '"');
  const region = cc === '7' ? (nsn[0] === '7' ? 'kz-ru' : 'ru-ru') : (C.region || 'wt-wt');
  // Яндекс и Google автоматический поиск не разрешают — для них готовые ссылки сразу по всем вариантам записи
  const manual = { yandex: 'https://yandex.ru/search/?text=' + encodeURIComponent(queries.join(' | ')), google: 'https://www.google.com/search?q=' + encodeURIComponent(queries.join(' OR ')) };
  // открытые базы номеров со страницей на каждый номер (адреса — по ссылкам самих сайтов); открываются во встроенном окне по кнопке
  const full = cc + nsn, bases = [];
  if (cc === '7') {
    bases.push({ id: 'yandex', name: 'Яндекс Определитель', what: 'что определитель Яндекса знает о номере: организация, категория, отзывы', url: 'https://yandex.ru/yandexapp/ru/callerid/' + full });
    bases.push({ id: 'ktozvonit', name: 'кто-звонит.рф', what: 'отзывы людей о звонках с номера', url: 'https://xn----dtbofgvdd5ah.xn--p1ai/' + nsn + '/' });
  }
  bases.push({ id: 'ktozvonil', name: 'КтоЗвонил (ktozvonil.net)', what: 'отзывы и рейтинг номера', url: 'https://ktozvonil.net/nomer/' + full });
  bases.push({ id: 'callfilter', name: 'Callfilter', what: 'отзывы и метки «спам» / «мошенники»', url: 'https://callfilter.app/' + full });
  return { ok: true, cc, nsn, trunk: C.trunk, pretty, e164: '+' + cc + nsn, queries, region, manual, bases };
}
// номер с любыми разделителями между цифрами, с кодом страны или местной «8» / «0» и без них
const SEP = '[\\s\\-().\\u00a0\\u2010-\\u2015/]{0,3}';
function matcher(p) {
  const spaced = (x) => x.split('').join(SEP);
  const pre = ['(?:\\+\\s?|00)' + spaced(p.cc), spaced(p.cc)];
  if (p.trunk && p.trunk !== p.cc) pre.push(spaced(p.trunk));
  return new RegExp('(?<!\\d)(?:(?:' + pre.join('|') + ')' + SEP + ')?' + spaced(p.nsn) + '(?!\\d)', 'g');
}

/* ---------- текст страницы и отрывок вокруг номера ---------- */
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', laquo: '«', raquo: '»', mdash: '—', ndash: '–', hellip: '…' };
const decode = (s) => s.replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, e) => {
  if (e[0] === '#') { const c = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return c > 0 && c < 0x110000 ? String.fromCodePoint(c) : ' '; }
  const v = ENT[e.toLowerCase()]; return v !== undefined ? v : m;
});
function pageText(html) {
  return decode(String(html || '').replace(/<(script|style|noscript|template|svg|head)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ').replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(br|\/p|\/div|\/li|\/tr|\/h\d)\b[^>]*>/gi, '\n').replace(/<[^>]+>/g, ' ')).replace(/[ \t\r\f\v ]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();
}
// код страницы без тегов: так находятся номера в разметке, в tel:-ссылках и данных для поисковиков
const codeText = (html) => decode(String(html || '').replace(/<[^>]+?(?:href|content|value)="([^"]*)"[^>]*>/gi, ' $1 ').replace(/<[^>]+>/g, ' ')).replace(/\\u002[bB]/g, '+').replace(/\s+/g, ' ');
function excerpt(text, re) {
  re.lastIndex = 0;
  const m = re.exec(text);
  if (!m) return null;
  const a = m.index, b = a + m[0].length;
  let pre = text.slice(Math.max(0, a - 110), a), post = text.slice(b, b + 110);
  if (a > 110) pre = '…' + pre.replace(/^\S*\s/, '');
  if (b + 110 < text.length) post = post.replace(/\s\S*$/, '') + '…';
  const flat = (x) => x.replace(/\s+/g, ' ');
  return { pre: flat(pre), hit: flat(m[0]).trim(), post: flat(post) };
}

/* ---------- куда отнести найденный сайт ---------- */
const siteOf = (host) => { const p = String(host || '').toLowerCase().replace(/^www\./, '').split('.'); if (p.length <= 2) return p.join('.'); const l2 = p.slice(-2).join('.'); return /^(co|com|net|org|ac|gov|edu|or|ne|msk|spb|pp|in|kiev)\.[a-z]{2}$/.test(l2) ? p.slice(-3).join('.') : l2; };
const SITES = {
  ads: ['avito.ru', 'youla.ru', 'cian.ru', 'auto.ru', 'drom.ru', 'farpost.ru', 'irr.ru', 'domclick.ru', 'n1.ru', 'move.ru', 'mirkvartir.ru', 'sob.ru', 'am.ru', 'kupiprodai.ru', 'moyareklama.ru', 'barahla.net',
    'olx.kz', 'olx.ua', 'olx.uz', 'kufar.by', 'krisha.kz', 'kolesa.kz', 'hh.ru', 'hh.kz', 'superjob.ru', 'rabota.ru', 'zarplata.ru', 'trudvsem.ru', 'gorodrabot.ru', 'profi.ru', 'youdo.com', 'work.ua', 'rabota.by'],
  callers: ['zvonili.com', 'ktozvonil.net', 'neberitrubku.ru', 'tellows.ru', 'tellows.net', 'callfilter.app', 'getcontact.com', 'numbuster.com', 'truecaller.com', 'sync.me', 'callapp.com', 'eyecon-app.com', 'hiya.com',
    'spamcalls.net', 'phoneradar.ru', 'ktozvonit.com', 'kto-zvonil.com', 'zvonok.org', 'otzyvy-o-nomere.ru'],
  social: ['vk.com', 'vk.ru', 'ok.ru', 'facebook.com', 'instagram.com', 't.me', 'telegram.me', 'x.com', 'twitter.com', 'livejournal.com', 'pikabu.ru', 'dzen.ru', 'youtube.com', 'tiktok.com', 'reddit.com',
    'otzovik.com', 'irecommend.ru', 'drive2.ru', '4pda.to', 'woman.ru', 'babyblog.ru', 'linkedin.com', 'habr.com', 'vc.ru', 'mamba.ru', 'fotostrana.ru', 'liveinternet.ru', 'diary.ru'],
  biz: ['2gis.ru', '2gis.kz', '2gis.com', 'zoon.ru', 'yell.ru', 'rusprofile.ru', 'list-org.com', 'checko.ru', 'sbis.ru', 'spark-interfax.ru', 'orgpage.ru', 'spr.ru', 'flamp.ru', 'cataloxy.ru', 'zakupki.gov.ru',
    'nalog.ru', 'audit-it.ru', 'kartoteka.ru', 'zachestnyibiznes.ru', 'synapsenet.ru', 'kontur.ru', 'vsenomera.ru'],
  people: ['spokeo.com', 'whitepages.com', 'beenverified.com', 'intelius.com', 'truthfinder.com', 'instantcheckmate.com', 'fastpeoplesearch.com', 'truepeoplesearch.com', 'thatsthem.com', 'usphonebook.com',
    'nuwber.com', 'clustrmaps.com', 'familytreenow.com', 'radaris.com', 'mylife.com', 'peoplefinders.com', 'numlookup.com', 'spravkaru.net', 'nomer.org', 'numberway.com'],
};
const BY_SITE = new Map(); Object.entries(SITES).forEach(([g, list]) => list.forEach((s) => BY_SITE.set(s, g)));
function groupOf(host, title) {
  const h = String(host || '').toLowerCase(), s = siteOf(h);
  if (/^(otvet|my)\.mail\.ru$/.test(h.replace(/^www\./, '')) || /(^|\.)forums?\./.test(h)) return 'social';
  if (/^(realty|uslugi)\./.test(h) && /yandex|ya\.ru/.test(h)) return 'ads';
  if (BY_SITE.has(s)) return BY_SITE.get(s);
  if (/кто звонил|кто звонит|чей (это )?номер|отзывы о номере|who called|spam call/i.test(String(title || ''))) return 'callers';
  return 'other';
}

/* ---------- отдельная приватная сессия для проверки страниц ---------- */
let pses = null;
function psess() {
  if (pses) return pses;
  pses = session.fromPartition('kx-phone');   // без «persist:» — только в памяти
  pses.setUserAgent(search.UA);
  pses.setPermissionRequestHandler((wc, perm, cb) => cb(false));
  pses.setPermissionCheckHandler(() => false);
  pses.on('will-download', (e) => e.preventDefault());
  return pses;
}
const wipe = () => { const s = psess(); return Promise.all([s.clearStorageData(), s.clearCache(), s.clearAuthCache(), s.clearHostResolverCache()]).catch(() => {}); };
const MAX_PAGE = 2.5 * 1024 * 1024;
async function grab(url, signal) {
  let res;
  try {
    res = await psess().fetch(url, { method: 'GET', redirect: 'follow', cache: 'no-store', signal: AbortSignal.any([AbortSignal.timeout(12000), signal]),
      headers: { Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5', 'Accept-Language': 'ru-RU,ru;q=0.9,en;q=0.7' } });
  } catch (e) { return { ok: false, err: /Timeout|Abort/i.test(String(e && (e.name + e.message))) ? 'не ответил за 12 секунд' : 'не открылся' }; }
  const type = (res.headers.get('content-type') || '').toLowerCase(), status = res.status, final = res.url || url;
  if (status >= 400) { try { await res.body.cancel(); } catch (e) { /* уже закрыто */ } return { ok: false, status, url: final, err: status === 403 || status === 429 ? 'закрыт от автоматических проверок' : 'ответил ошибкой ' + status }; }
  if (!/html|xml|text\/plain|json/.test(type)) { try { await res.body.cancel(); } catch (e) { /* уже закрыто */ } return { ok: false, status, url: final, err: /pdf/.test(type) ? 'это PDF — проверь сам' : 'это не веб-страница' }; }
  const chunks = []; let size = 0;
  try {
    const rd = res.body.getReader();
    for (;;) { const { done, value } = await rd.read(); if (done) break; chunks.push(value); size += value.length; if (size >= MAX_PAGE) { await rd.cancel(); break; } }
  } catch (e) { if (!chunks.length) return { ok: false, status, url: final, err: 'не загрузился' }; }
  const buf = Buffer.concat(chunks.map((c) => Buffer.from(c)));
  const cs = (/charset=([\w-]+)/i.exec(type) || /<meta[^>]+charset=["']?([\w-]+)/i.exec(buf.subarray(0, 4096).toString('latin1')) || [])[1] || 'utf-8';
  let html; try { html = new TextDecoder(cs.toLowerCase()).decode(buf); } catch (e) { html = buf.toString('utf8'); }
  return { ok: true, status, url: final, html };
}

/* ---------- сам поиск ---------- */
let busy = false, stopper = null;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const keyOf = (u) => { try { const x = new URL(u); x.hash = ''; return (x.hostname.replace(/^www\./, '') + x.pathname.replace(/\/+$/, '') + x.search).toLowerCase(); } catch (e) { return u; } };

async function find(raw, cfg, onProgress) {
  if (busy) return { ok: false, err: 'Поиск уже идёт' };
  const p = normalize(raw);
  if (!p.ok) return p;
  busy = true; stopper = new AbortController();
  const stop = stopper.signal, t0 = Date.now(), tell = (x) => { try { onProgress(x); } catch (e) { /* окно закрыто */ } };
  const re = matcher(p), hits = new Map();
  let captcha = false, searchErr = '', done = 0;
  try {
    // 1. поисковые запросы — по одному, с паузами в несколько секунд: так ищет человек, и DuckDuckGo не принимает это за робота
    for (let i = 0; i < p.queries.length && !stop.aborted; i++) {
      tell({ stage: 'search', i: i + 1, n: p.queries.length, q: p.queries[i] });
      const r = await search.search({ q: p.queries[i], region: p.region, safe: cfg.safe }, cfg.proxy);
      if (!r.ok) { if (r.captcha) captcha = true; else searchErr = r.err || 'поиск не ответил'; break; }
      for (const x of r.results) {
        const k = keyOf(x.url), seen = hits.get(k);
        if (seen) { seen.q.add(i); continue; }
        let host = ''; try { host = new URL(x.url).hostname.toLowerCase(); } catch (e) { continue; }
        if (/(^|\.)duckduckgo\.com$/.test(host)) continue;
        hits.set(k, { url: x.url, host, title: x.title, snippet: x.snippet, q: new Set([i]) });
      }
      done = i + 1;
      if (i < p.queries.length - 1) { const w = 3500 + Math.random() * 2500; for (let t = 0; t < w && !stop.aborted; t += 250) await sleep(250); }
    }
    // 2. проверка страниц: сначала те, где номер виден уже в описании поиска
    const list = [...hits.values()].map((x) => { re.lastIndex = 0; x.inSnippet = re.test(x.title + ' \n ' + x.snippet); return x; })
      .sort((a, b) => (b.inSnippet - a.inSnippet) || (b.q.size - a.q.size)).slice(0, 40);
    const rules = search.proxyRules(cfg.proxy);
    await psess().setProxy({ proxyRules: rules.ok ? rules.rules : 'direct://' });
    let checked = 0, k = 0;
    const found = [], unchecked = [];
    tell({ stage: 'check', done: 0, total: list.length, found: 0 });
    const item = (x, how, ex, status) => ({ url: x.url, site: siteOf(x.host), host: x.host, title: x.title || siteOf(x.host), group: groupOf(x.host, x.title), how, excerpt: ex, status: status || 0 });
    const worker = async () => {
      while (k < list.length && !stop.aborted) {
        const x = list[k++];
        const g = await grab(x.url, stop);
        let how = null, ex = null;
        if (g.ok) {
          ex = excerpt(pageText(g.html), re);
          if (ex) how = 'page';
          else { ex = excerpt(codeText(g.html), re); if (ex) how = 'code'; }
        }
        if (!how && x.inSnippet) { how = 'snippet'; ex = excerpt(x.title + ' · ' + x.snippet, re); }
        if (how) found.push(item(x, how, ex, g.status));
        else if (!g.ok && !stop.aborted) unchecked.push({ ...item(x, null, null, g.status), snippet: x.snippet, err: g.err });
        checked++;
        tell({ stage: 'check', done: checked, total: list.length, found: found.length });
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
    // остановили раньше времени — непроверенные страницы с номером в описании поиска всё равно показываем
    for (; k < list.length; k++) if (list[k].inSnippet) found.push(item(list[k], 'snippet', excerpt(list[k].title + ' · ' + list[k].snippet, re), 0));
    const order = { page: 0, code: 1, snippet: 2 };
    found.sort((a, b) => order[a.how] - order[b.how]);
    return { ok: true, number: p.pretty, e164: p.e164, manual: p.manual, bases: p.bases, queries: done, totalQueries: p.queries.length, captcha, searchErr, stopped: stop.aborted, results: hits.size,
      checked, dropped: checked - found.length - unchecked.length, found, unchecked: unchecked.slice(0, 30), sites: new Set(found.map((f) => f.site)).size, ms: Date.now() - t0 };
  } catch (e) {
    return { ok: false, err: 'Поиск прервался: ' + String(e && e.message || e).slice(0, 160) };
  } finally {
    busy = false; stopper = null;
    await wipe(); await search.forget();
  }
}
function cancel() { if (stopper) stopper.abort(); return { ok: true }; }

module.exports = { find, cancel, normalize, matcher, pageText, codeText, excerpt, groupOf, siteOf };
