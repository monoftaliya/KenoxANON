/* Просмотр страниц внутри приложения.
   «Читалка» — текст страницы в нашем оформлении: без скриптов, картинок и трекеров. Страницу можно тихо сохранить в хранилище.
   «Оригинал» — сам сайт во встроенном окне, изолированном от приложения, и «Рентген»: что сайт пытался загрузить, куда ходил и что ставил.
   Оба режима ходят в сеть через ту же приватную сессию и тот же прокси, что и поиск, история не сохраняется. */
(function () {
  'use strict';
  const { h, toast, plural } = window.UI;
  const K = window.kenox;
  const A = window.APP = window.APP || {};
  let cur = null;

  // метки слежки в ссылках (utm_*, fbclid, yclid…) убираются перед переходом
  const TRACKING = /^(utm_\w+|fbclid|gclid|dclid|yclid|ysclid|mc_cid|mc_eid|_openstat|igshid|ref_src|_hsenc|_hsmi)$/i;
  function cleanUrl(u) { try { const x = new URL(u); [...x.searchParams.keys()].forEach((k) => { if (TRACKING.test(k)) x.searchParams.delete(k); }); return x.toString(); } catch (e) { return u; } }
  const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch (e) { return String(u); } };
  const store = (key, def) => ({ get() { try { const v = localStorage.getItem(key); return v === null ? def : v; } catch (e) { return def; } }, set(v) { try { localStorage.setItem(key, v); } catch (e) { /* без памяти */ } } });
  const pref = store('kx.viewer.mode', 'reader'), xrPref = store('kx.viewer.xray', '1');
  const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  const fmtWhen = (ts) => { const x = new Date(ts); return Number.isNaN(x.getTime()) ? '' : x.toLocaleDateString('ru-RU') + ' ' + x.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }); };

  /* ---------- читалка: из HTML остаются заголовки, абзацы, списки, цитаты и ссылки ---------- */
  const JUNK = 'script,style,noscript,template,svg,canvas,iframe,frame,object,embed,video,audio,form,button,input,select,textarea,nav,header,footer,aside,menu,dialog,[hidden],[aria-hidden="true"],[role="navigation"],[role="banner"],[role="contentinfo"],[role="complementary"],[role="dialog"]'
    // служебное на Википедии и похожих сайтах: сноски [1], «[править]», навигационные таблицы, оглавление
    + ',sup.reference,.mw-editsection,.mw-cite-backlink,.mw-jump-link,.navbox,.vertical-navbox,.sidebar,.noprint,.catlinks,.printfooter,#toc,.toc';
  // блоки «поделиться», cookie-плашки, реклама, комментарии и «похожие статьи» — если в них нет основного текста
  const UNLIKELY = /(^|[\s_-])(share|sharing|social|cookies?|consent|gdpr|newsletter|subscribe|subscription|advert|advertisement|ads?|promo|banner|breadcrumbs?|related|recommended|comments?|disqus|sponsored?|popup|modal|pagination|pager)([\s_-]|$)/i;
  const BLOCK = /^(P|DIV|UL|OL|TABLE|H[1-6]|BLOCKQUOTE|PRE|SECTION|ARTICLE|FIGURE|MAIN|DL|HR)$/;
  function inline(node, base, out = []) {
    for (const n of node.childNodes) {
      if (n.nodeType === 3) { const v = n.nodeValue.replace(/\s+/g, ' '); if (v.trim() || (v === ' ' && out.length)) out.push({ t: 'text', v }); continue; }
      if (n.nodeType !== 1) continue;
      const tag = n.tagName;
      if (tag === 'BR') out.push({ t: 'br' });
      else if (tag === 'A') {
        const v = n.textContent.replace(/\s+/g, ' ').trim(); let href = '';
        try { href = new URL(n.getAttribute('href') || '', base).toString(); } catch (e) { href = ''; }
        if (v) out.push(/^https?:\/\//i.test(href) ? { t: 'a', v, href: cleanUrl(href) } : { t: 'text', v });
      } else if (tag === 'CODE' || tag === 'KBD' || tag === 'SAMP') out.push({ t: 'code', v: n.textContent });
      else if (tag === 'B' || tag === 'STRONG') out.push({ t: 'b', v: n.textContent.replace(/\s+/g, ' ') });
      else if (tag === 'IMG' || tag === 'UL' || tag === 'OL') continue;
      else inline(n, base, out);
    }
    return out;
  }
  const plain = (parts) => parts.map((p) => p.v || '').join('').trim();

  function readable(html, base) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const metaOf = (sel) => { const m = doc.querySelector(sel); return m ? (m.getAttribute('content') || '').trim() : ''; };
    let title = metaOf('meta[property="og:title"]') || (doc.title || '').trim() || (doc.querySelector('h1') ? doc.querySelector('h1').textContent.trim() : '') || hostOf(base);
    let site = metaOf('meta[property="og:site_name"]');
    // «Статья - Wikipedia» → заголовок «Статья», а название сайта уходит в подпись над ним
    const tail = /^(.{8,}?)\s+[-|–—·]\s+([^-|–—·]{2,40})$/.exec(title);
    if (tail) {
      const brand = tail[2].trim(), key = brand.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (brand === site || (key.length >= 3 && hostOf(base).toLowerCase().replace(/[^a-z0-9]/g, '').includes(key))) { title = tail[1].trim(); site = site || brand; }
    }
    site = site || hostOf(base);
    const descr = metaOf('meta[name="description"]') || metaOf('meta[property="og:description"]');
    const images = doc.querySelectorAll('img').length, scripts = doc.querySelectorAll('script').length;
    // признаки страницы, которую целиком рисуют скрипты: пустой корневой блок или просьба включить JavaScript
    const jsApp = !!doc.querySelector('#root:empty, #app:empty, #__next, #__nuxt, #svelte, app-root, [data-reactroot], [ng-version]')
      || [...doc.querySelectorAll('noscript')].some((n) => /javascript|\bjs\b/i.test(n.textContent));
    doc.querySelectorAll(JUNK).forEach((e) => e.remove());
    doc.querySelectorAll('[class], [id]').forEach((e) => {
      if (/^(HTML|BODY|ARTICLE|MAIN)$/.test(e.tagName)) return;
      const sig = (typeof e.className === 'string' ? e.className : '') + ' ' + (e.id || '');
      if (UNLIKELY.test(sig) && e.querySelectorAll('p').length < 3) e.remove();
    });
    // блок с основным текстом: абзацы «голосуют» за родителя и деда, ссылочный мусор теряет очки
    const scores = new Map();
    for (const p of doc.querySelectorAll('p, pre, blockquote')) {
      const len = p.textContent.trim().length; if (len < 25) continue;
      const val = 1 + Math.min(3, Math.floor(len / 100)) + (p.textContent.match(/[,.;]/g) || []).length * 0.1;
      let el = p.parentElement, k = 0;
      while (el && k < 3) { scores.set(el, (scores.get(el) || 0) + val / (k + 1)); el = el.parentElement; k++; }
    }
    let root = null, best = 0;
    for (const [el, sc] of scores) {
      const text = el.textContent.length || 1; let links = 0; el.querySelectorAll('a').forEach((a) => { links += a.textContent.length; });
      const s = sc * (1 - Math.min(0.9, links / text)) + (/^(ARTICLE|MAIN)$/.test(el.tagName) ? 3 : 0);
      if (s > best) { best = s; root = el; }
    }
    root = root || doc.body || doc.documentElement;
    const blocks = [];
    const push = (b) => { if (blocks.length < 900) blocks.push(b); };
    (function walk(el) {
      for (const n of el.children) {
        const tag = n.tagName;
        if (/^H[1-6]$/.test(tag)) { const parts = inline(n, base); if (plain(parts)) push({ type: 'h', level: Math.min(4, Math.max(2, Number(tag[1]))), parts }); }
        else if (tag === 'P') { const parts = inline(n, base); if (plain(parts)) push({ type: 'p', parts }); }
        else if (tag === 'LI') {
          const ref = !!n.closest('.references, .reflist, .refbegin');   // список источников не входит во время чтения
          const parts = inline(n, base); if (plain(parts)) push({ type: 'li', parts, ref });
          n.querySelectorAll(':scope > ul > li, :scope > ol > li').forEach((li) => { const pp = inline(li, base); if (plain(pp)) push({ type: 'li', parts: pp, sub: true, ref }); });
        }
        else if (tag === 'BLOCKQUOTE') { const parts = inline(n, base); if (plain(parts)) push({ type: 'quote', parts }); }
        else if (tag === 'PRE') { const v = n.textContent.replace(/\s+$/, ''); if (v) push({ type: 'pre', v: v.slice(0, 6000) }); }
        else if (tag === 'IMG') push({ type: 'img', v: (n.getAttribute('alt') || '').trim() });
        else if (tag === 'FIGURE') { const cap = n.querySelector('figcaption'); push({ type: 'img', v: ((cap && cap.textContent) || (n.querySelector('img') && n.querySelector('img').getAttribute('alt')) || '').trim() }); }
        else if (tag === 'HR') push({ type: 'hr' });
        else if (tag === 'TABLE') n.querySelectorAll('tr').forEach((tr) => { const v = [...tr.children].map((c) => c.textContent.replace(/\s+/g, ' ').trim()).filter(Boolean).join(' · '); if (v) push({ type: 'p', parts: [{ t: 'text', v }] }); });
        else if (tag === 'DT' || tag === 'DD') { const parts = inline(n, base); if (plain(parts)) push({ type: tag === 'DT' ? 'h' : 'p', level: 4, parts }); }
        else if (n.children.length && [...n.children].some((c) => BLOCK.test(c.tagName) || c.tagName === 'LI')) walk(n);
        else { const parts = inline(n, base); if (plain(parts).length > 30) push({ type: 'p', parts }); }
      }
    })(root);
    // заголовок страницы не дублируем первым блоком
    if (blocks[0] && blocks[0].type === 'h' && plain(blocks[0].parts) === title) blocks.shift();
    const words = blocks.reduce((n, b) => n + (b.parts && !b.ref ? plain(b.parts).split(/\s+/).length : 0), 0);
    return { title, site, descr, blocks, images, scripts, words, jsApp };
  }
  const textOf = (d) => d.blocks.map((b) => (b.parts ? plain(b.parts) : b.v || '')).filter(Boolean).join('\n\n');

  function partsEl(parts, go) {
    const frag = document.createDocumentFragment();
    for (const p of parts) {
      if (p.t === 'text') frag.append(p.v);
      else if (p.t === 'br') frag.append(h('br'));
      else if (p.t === 'code') frag.append(h('code', p.v));
      else if (p.t === 'b') frag.append(h('b', p.v));
      else if (p.t === 'a') frag.append(h('button.rlink', { type: 'button', title: p.href, onclick: () => go(p.href) }, p.v));
    }
    return frag;
  }
  function renderReader(d, url, go, actions, savedAt) {
    const minutes = Math.max(1, Math.round(d.words / 180));
    const el = h('article.reader',
      h('p.reader__kicker', d.site.toLowerCase() === hostOf(url).toLowerCase() ? d.site : d.site + ' · ' + hostOf(url)),
      h('h1.reader__title', d.title),
      d.descr && (!d.blocks[0] || plain(d.blocks[0].parts || []).indexOf(d.descr.slice(0, 40)) < 0) ? h('p.reader__descr', d.descr) : null,
      h('p.reader__meta', savedAt
        ? 'Копия из хранилища' + (typeof savedAt === 'string' ? ' от ' + fmtWhen(savedAt) : '') + ' · читаешь без сети · ≈ ' + minutes + ' мин'
        : 'Читать ≈ ' + minutes + ' мин · скриптов не выполнено: ' + d.scripts + ' · картинок скрыто: ' + d.images));
    const tic = d.trackersInCode || [];
    if (!savedAt && tic.length) {
      el.append(h('div.reader__xray', h('b', 'В коде страницы ' + tic.length + ' ' + plural(tic.length, 'трекер', 'трекера', 'трекеров') + ':'),
        tic.map((t) => h('span.rx', { title: t.help + (t.host ? ' · ' + t.host : '') }, t.owner + ' · ' + t.kind)), h('span.muted', 'В «Читалке» они не запускаются.')));
    }
    if (!savedAt) el.append(actions.save(d, url));
    for (const b of d.blocks) {
      if (b.type === 'h') el.append(h('h' + b.level, partsEl(b.parts, go)));
      else if (b.type === 'p') el.append(h('p', partsEl(b.parts, go)));
      else if (b.type === 'li') el.append(h('p.rli' + (b.sub ? '.rli--sub' : ''), partsEl(b.parts, go)));
      else if (b.type === 'quote') el.append(h('blockquote', partsEl(b.parts, go)));
      else if (b.type === 'pre') el.append(h('pre', b.v));
      else if (b.type === 'img') el.append(h('p.rimg', '▣ картинка скрыта' + (b.v ? ': ' + b.v : '')));
      else if (b.type === 'hr') el.append(h('hr'));
    }
    // мало текста и явные признаки страницы-приложения — текст рисуют скрипты (короткие простые страницы не трогаем)
    if (!savedAt && d.words < 60 && (d.jsApp || d.scripts >= 5)) el.append(h('div.plate.warn', h('b', 'Почти весь текст этой страницы создаётся скриптами.'), ' В читалке его не видно — открой оригинал сайта.', h('div.row', actions.original())));
    el.append(h('div.reader__foot', h('span.k', savedAt ? 'Сохранено со страницы' : 'Источник'), h('span.mono.selectable', url), actions.original(), actions.external()));
    return el;
  }

  /* ---------- «Рентген сайта»: отчёт собирается из сетевых событий, сам сайт его не видит ---------- */
  const num = (n, label, color) => h('div.xray__num', { style: { '--c': color } }, h('b', String(n)), h('span', label));
  function xrayContent(r) {
    if (!r || !r.ok) return [h('p.muted', 'Отчёт появится, как только страница начнёт загружаться.')];
    const t = r.totals, sec = (title, items, empty) => h('section.xray__sec', h('p.k', title), items.length ? items : h('p.muted', empty));
    const out = [
      h('p.xray__host', r.host || '—'),
      h('p.xray__since', 'с ' + new Date(r.since).toLocaleTimeString('ru-RU') + ' · ' + t.requests + ' ' + plural(t.requests, 'запрос', 'запроса', 'запросов')),
      h('div.xray__nums',
        num(t.blocked, plural(t.blocked, 'трекер остановлен', 'трекера остановлено', 'трекеров остановлено'), 'var(--t-trace)'),
        num(t.thirdHosts, plural(t.thirdHosts, 'чужой сервер', 'чужих сервера', 'чужих серверов'), 'var(--t-net)'),
        num(t.cookies, 'cookies' + (t.thirdCookies ? ', чужих ' + t.thirdCookies : ''), 'var(--t-browser)')),
      sec('Остановлено', r.trackers.map((e) => h('div.xray__row',
        h('div.xray__top', h('b', e.owner + ' · ' + e.kind), h('span.xray__n', '×' + e.n)),
        e.help ? h('p.xray__help', e.help) : null, h('p.xray__hosts', e.hosts.join(', ')))), 'Трекеров не видно: сайт их не использует или они ещё не загрузились.'),
      sec('Куда ещё ходил сайт', r.third.slice(0, 15).map((e) => h('div.xray__row',
        h('div.xray__top', h('b', e.owner), h('span.xray__n', '×' + e.n)),
        h('p.xray__hosts', e.hosts.slice(0, 4).map((x) => x.host + (x.n > 1 ? ' ×' + x.n : '')).join(', ') + (e.hosts.length > 4 ? ' и ещё ' + (e.hosts.length - 4) : '')))), 'Только на свой сервер.'),
      sec('Cookies', r.cookies.slice(0, 40).map((c) => h('div.xray__ck', h('b', c.name), h('span', [c.who, c.third ? 'чужой · ' + c.domain : 'свой', c.life].filter(Boolean).join(' · ')))), 'Сайт не ставил cookies.'),
    ];
    const asks = r.asks.map((a) => h('div.xray__ck', h('b', a.what), h('span', 'отказано' + (a.n > 1 ? ' ×' + a.n : ''))));
    if (r.popups) asks.push(h('div.xray__ck', h('b', 'всплывающие окна'), h('span', 'открыты здесь же ×' + r.popups)));
    if (r.downloads) asks.push(h('div.xray__ck', h('b', 'скачивание файлов'), h('span', 'запрещено ×' + r.downloads)));
    if (asks.length) out.push(sec('Что сайт просил', asks, ''));
    out.push(h('p.xray__foot', 'Сайт не видит этот отчёт: он собирается из сетевых запросов, а не из страницы. На новой странице отчёт начинается заново.'));
    return out;
  }

  /* ---------- окно просмотра ---------- */
  function make(opts) {
    // opts.mode — с какого режима начать (для сайтов, которым нужен JavaScript); сохранённый выбор человека при этом не меняется
    let mode = /^(original|reader)$/.test(opts.mode || '') ? opts.mode : pref.get() === 'original' ? 'original' : 'reader', js = true, hist = [], idx = -1, url = '', alive = true, token = 0;
    let state = { back: false, fwd: false, loading: false }, xr = { trackers: 0 }, xrOpen = xrPref.get() !== '0', xrTimer = null, xrLast = '';
    const saved = new Map();   // копии из хранилища, открытые в этом окне: адрес → запись
    const btn = (label, title, fn) => h('button.vbtn', { type: 'button', title, 'aria-label': title, onclick: fn }, label);
    const backB = btn('◀', 'Назад (Alt+←)', () => step(-1)), fwdB = btn('▶', 'Вперёд (Alt+→)', () => step(1));
    const reloadB = btn('⟳', 'Обновить', () => { if (mode === 'original') K.viewerNav(state.loading ? 'stop' : 'reload'); else load(url, false); });
    const addr = h('input.viewer__addr', { type: 'text', spellcheck: 'false', autocomplete: 'off', 'aria-label': 'Адрес страницы или запрос' });
    const modeBox = h('div.vmode', { role: 'group', 'aria-label': 'Режим просмотра' });
    const xrB = btn('Рентген', 'Рентген сайта: какие трекеры он пытался загрузить, куда ходил и какие cookies ставил', () => toggleXray());
    const jsB = btn('JS', 'JavaScript на сайтах', () => { js = !js; if (mode === 'original') loadOriginal(url); paint(); });
    const extB = btn('↗', 'Открыть в своём браузере', () => K.searchOpen(url));
    const info = h('div.viewer__info'), body = h('div.viewer__body'), xrBox = h('aside.xray', { hidden: true, 'aria-label': 'Рентген сайта' });
    const el = h('div.viewer', { role: 'dialog', 'aria-label': 'Просмотр страницы' },
      h('div.viewer__bar', btn(opts.back || '← Результаты', 'Вернуться (Esc)', () => close()), backB, fwdB, reloadB, addr, modeBox, xrB, jsB, extB),
      info, h('div.viewer__main', body, xrBox));
    document.body.append(el);
    A.closeViewer = close;

    const actions = {
      original: () => h('button.key.key--sm.key--snow', { type: 'button', onclick: () => setMode('original') }, 'Открыть оригинал сайта'),
      external: () => h('button.key.key--sm', { type: 'button', onclick: () => K.searchOpen(url) }, 'В своём браузере ↗'),
      // тихая закладка: текст страницы — в хранилище; браузер и его история об этом не узнают
      save: (d, pageUrl) => {
        const box = h('div.reader__save');
        const sbtn = h('button.key.key--sm', { type: 'button', onclick: () => form() }, '★ Сохранить в хранилище');
        box.append(sbtn);
        K.vaultPageSaved(pageUrl).then((r) => { if (r && r.saved && sbtn.isConnected) sbtn.textContent = '★ Уже в хранилище · обновить копию'; }).catch(() => {});
        async function form() {
          const st = await K.vaultStatus();
          const tags = h('input.field.grow', { placeholder: 'метки через запятую: статьи, tor', maxlength: '200', spellcheck: 'false', 'aria-label': 'Метки' });
          const pw = st.locked ? h('input.field', { type: 'password', placeholder: 'пароль хранилища', autocomplete: 'off', 'aria-label': 'Пароль хранилища' }) : null;
          const note = h('p.muted', st.locked ? 'Хранилище заперто паролем — введи его, чтобы сохранить.' : 'Сохранится текст страницы. Читать его можно без сети: «Хранилище данных» → «Закладки». Браузер и его история об этом не узнают.');
          const ok = h('button.key.key--sm.key--snow', { type: 'button', onclick: () => doSave() }, st.locked ? 'Открыть и сохранить' : 'Сохранить');
          const back = () => box.replaceChildren(sbtn);
          box.replaceChildren(h('div.row', tags, pw, ok, h('button.key.key--sm', { type: 'button', onclick: back }, 'Отмена')), note);
          [tags, pw].forEach((i) => i && i.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); doSave(); } if (e.key === 'Escape') { e.stopPropagation(); back(); } }));
          (pw || tags).focus();
          async function doSave() {
            if (ok.disabled) return;
            ok.disabled = true;
            if (pw) {
              note.textContent = 'Проверяю пароль…';
              const u = await K.vaultUnlock(pw.value); pw.value = '';
              if (!u.ok) { ok.disabled = false; note.textContent = u.err || 'Не получилось открыть хранилище'; pw.focus(); return; }
              if (A.refreshStatus) A.refreshStatus();
            }
            const r = await K.vaultSavePage({ url: pageUrl, title: d.title, site: d.site, text: textOf(d), blocks: d.blocks, words: d.words, tags: tags.value.split(',') });
            if (!r.ok) { ok.disabled = false; note.textContent = r.err || 'Не получилось сохранить'; return; }
            sbtn.textContent = '★ Сохранено' + (r.tags && r.tags.length ? ' · ' + r.tags.map((x) => '#' + x).join(' ') : '');
            back();
            toast(r.updated ? 'Копия страницы в хранилище обновлена' : 'Страница сохранена в хранилище · «Закладки»', 'ok');
            if (A.refreshStatus) A.refreshStatus();
          }
        }
        return box;
      },
    };
    function paint() {
      modeBox.textContent = '';
      [['reader', 'Читалка'], ['original', 'Оригинал']].forEach(([m, n]) => modeBox.append(h('button', { type: 'button', 'aria-pressed': mode === m ? 'true' : 'false', onclick: () => setMode(m) }, n)));
      const canBack = mode === 'original' ? state.back : idx > 0, canFwd = mode === 'original' ? state.fwd : idx < hist.length - 1;
      backB.disabled = !canBack; fwdB.disabled = !canFwd;
      reloadB.textContent = mode === 'original' && state.loading ? '✕' : '⟳';
      jsB.hidden = mode !== 'original'; jsB.setAttribute('aria-pressed', js ? 'true' : 'false'); jsB.textContent = js ? 'JS вкл' : 'JS выкл';
      xrB.hidden = mode !== 'original'; xrB.setAttribute('aria-pressed', xrOpen ? 'true' : 'false'); xrB.textContent = 'Рентген' + (xr.trackers ? ' · ' + xr.trackers : '');
      const show = xrOpen && mode === 'original';
      if (xrBox.hidden === show) { xrBox.hidden = !show; if (show) startXray(); else stopXray(); }
    }
    const setInfo = (t) => { info.textContent = t + ' · ' + (opts.via || 'приватная сессия') + ' · история не сохраняется'; };

    /* «Рентген»: панель справа от сайта, обновляется раз в секунду, пока открыта */
    function toggleXray() { xrOpen = !xrOpen; xrPref.set(xrOpen ? '1' : '0'); paint(); }
    const xrHead = () => h('div.xray__head', h('p.k', 'Рентген сайта'), h('button.vbtn.xray__x', { type: 'button', title: 'Скрыть рентген', 'aria-label': 'Скрыть рентген', onclick: toggleXray }, '✕'));
    function startXray() { stopXray(); xrLast = ''; xrBox.replaceChildren(xrHead(), ...xrayContent(null)); refreshXray(); xrTimer = setInterval(refreshXray, 1000); }
    function stopXray() { clearInterval(xrTimer); xrTimer = null; }
    async function refreshXray() {
      let r; try { r = await K.viewerXray(); } catch (e) { return; }
      if (!alive || xrBox.hidden) return;
      const s = JSON.stringify(r); if (s === xrLast) return; xrLast = s;
      if (r && r.ok) { xr = { ...xr, trackers: r.totals.blocked }; xrB.textContent = 'Рентген' + (xr.trackers ? ' · ' + xr.trackers : ''); }
      xrBox.replaceChildren(xrHead(), ...xrayContent(r));
    }

    async function load(u, push = true) {
      if (!alive || !u) return;
      u = cleanUrl(u); url = u; addr.value = u;
      if (push) { hist = hist.slice(0, idx + 1); hist.push(u); idx = hist.length - 1; }
      paint();
      if (mode === 'reader') await loadReader(u); else await loadOriginal(u);
    }
    async function loadReader(u) {
      const my = ++token;
      K.viewerClose();
      body.textContent = ''; body.append(h('p.viewer__loading', 'Загружаю страницу через приватное соединение…'));
      setInfo('Читалка');
      const r = await K.viewerFetch(u);
      if (my !== token || !alive || mode !== 'reader') return;
      body.textContent = '';
      if (!r.ok) {
        body.append(h('div.reader', h('div.plate.warn', h('b', r.err || 'Не получилось открыть страницу'), h('div.row', actions.original(), actions.external()))));
        setInfo('Читалка · ошибка');
        return;
      }
      if (r.url && r.url !== u) { url = cleanUrl(r.url); addr.value = url; hist[idx] = url; }
      let d;
      try { d = readable(r.html, r.url || u); d.trackersInCode = r.trackersInCode || []; } catch (e) { d = null; }
      if (!d) { body.append(h('div.reader', h('div.plate.warn', h('b', 'Не удалось разобрать страницу.'), h('div.row', actions.original(), actions.external())))); return; }
      body.append(renderReader(d, url, (href) => load(href), actions));
      body.scrollTop = 0;
      setInfo('Читалка · только текст: скрипты и картинки не загружаются' + (d.trackersInCode.length ? ' · трекеров в коде: ' + d.trackersInCode.length : ''));
    }
    async function loadOriginal(u) {
      const my = ++token;
      body.textContent = ''; body.append(h('p.viewer__loading', 'Открываю сайт во встроенном окне…'));
      setInfo('Оригинал сайта');
      await frame();
      if (my !== token || !alive) return;
      const r = await K.viewerOpen(u, body.getBoundingClientRect().toJSON(), { js });
      if (!r.ok) { body.textContent = ''; body.append(h('div.reader', h('div.plate.warn', h('b', r.err || 'Не получилось'), h('div.row', actions.external())))); }
    }
    // копия страницы из хранилища: показывается без сети
    function renderSaved(it) {
      token++; K.viewerClose();
      mode = 'reader'; state = { back: false, fwd: false, loading: false };
      url = it.url; addr.value = url;
      const ex = it.extra || {};
      const blocks = Array.isArray(ex.blocks) && ex.blocks.length ? ex.blocks : String(it.body || '').split(/\n{2,}/).filter(Boolean).map((v) => ({ type: 'p', parts: [{ t: 'text', v }] }));
      const d = { title: it.title || url, site: ex.site || hostOf(url), descr: '', blocks, images: 0, scripts: 0, words: ex.words || String(it.body || '').split(/\s+/).length, jsApp: false };
      body.replaceChildren(renderReader(d, url, (href) => load(href), actions, it.ts || true));
      body.scrollTop = 0; paint();
      info.textContent = 'Копия из хранилища · читаешь без сети · ссылки откроются через приватное соединение';
    }
    function showSaved(it) {
      if (!alive || !it || !it.url) return;
      saved.set(it.url, it);
      hist = hist.slice(0, idx + 1); hist.push(it.url); idx = hist.length - 1;
      renderSaved(it);
    }
    function setMode(m) {
      if (m === mode) return;
      mode = m; pref.set(m); state = { back: false, fwd: false, loading: false };
      if (m === 'reader') { K.viewerClose(); if (saved.has(url)) renderSaved(saved.get(url)); else load(url, false); } else loadOriginal(url);
      paint();
    }
    function step(dir) {
      if (mode === 'original') { K.viewerNav(dir < 0 ? 'back' : 'forward'); return; }
      const i = idx + dir; if (i < 0 || i >= hist.length) return;
      idx = i;
      if (saved.has(hist[idx])) renderSaved(saved.get(hist[idx])); else load(hist[idx], false);
    }
    const offState = K.onViewerState((s) => {
      if (!alive || mode !== 'original') return;
      if (s.escape) { close(); return; }
      state = { back: !!s.back, fwd: !!s.fwd, loading: !!s.loading };
      if (s.xr) xr = s.xr;
      if (s.url && document.activeElement !== addr) { url = s.url; addr.value = s.url; }
      if (body.firstChild && body.firstChild.classList && body.firstChild.classList.contains('viewer__loading') && !s.loading) body.firstChild.textContent = '';
      paint();
      setInfo('Оригинал сайта · ' + (s.js ? 'JavaScript включён' : 'JavaScript выключен') + ' · WebGL выключен · трекеров заблокировано: ' + (s.blocked || 0) + (s.error ? ' · ошибка: ' + s.error : ''));
    });
    addr.addEventListener('focus', () => addr.select());
    addr.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      const v = addr.value.trim(); if (!v) return;
      if (/^https?:\/\//i.test(v)) load(v);
      else if (/^[\w-]+(\.[\w-]+)+(:\d+)?(\/\S*)?$/.test(v) && !/\s/.test(v)) load('https://' + v);
      else if (opts.onQuery) { close(); opts.onQuery(v); }
      else toast('Впиши адрес сайта, например example.com', 'warn');
    });
    const onKey = (e) => {
      // Esc закрывает просмотр, если сейчас не открыто окно подтверждения
      if (e.key === 'Escape' && document.getElementById('modal').hidden) { close(); return; }
      if (e.altKey && e.key === 'ArrowLeft') { e.preventDefault(); step(-1); }
      if (e.altKey && e.key === 'ArrowRight') { e.preventDefault(); step(1); }
    };
    // встроенное окно сайта следует за областью просмотра при любом изменении её размера (в том числе когда открывается «Рентген»)
    const ro = new ResizeObserver(() => { if (mode === 'original' && alive) K.viewerBounds(body.getBoundingClientRect().toJSON()); });
    ro.observe(body);
    document.addEventListener('keydown', onKey);

    function close() {
      if (!alive) return;
      alive = false; token++; stopXray();
      K.viewerClose(); offState();
      document.removeEventListener('keydown', onKey); ro.disconnect();
      el.remove(); cur = null; if (A.closeViewer === close) A.closeViewer = null;
      if (opts.onClose) opts.onClose();
    }
    paint();
    return { load, close, showSaved };
  }

  function open(url, opts) {
    if (!/^https?:\/\//i.test(String(url || ''))) { toast('Открываются только адреса http и https', 'warn'); return; }
    if (!cur) cur = make(opts || {});
    cur.load(url);
  }
  function openSaved(it, opts) {
    if (!it || !/^https?:\/\//i.test(String(it.url || ''))) { toast('У этой записи нет адреса страницы', 'warn'); return; }
    if (!cur) cur = make(Object.assign({ back: '← Хранилище' }, opts || {}));
    cur.showSaved(it);
  }
  window.VIEWER = { open, openSaved, close: () => { if (cur) cur.close(); }, readable };
})();
