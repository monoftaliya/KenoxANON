/* Анонимный поиск: DuckDuckGo через свой прокси или Tor, без истории запросов. */
(function () {
  'use strict';
  const { h, toast } = window.UI;
  const head = window.VIEWS.head;
  const K = window.kenox;
  const REGIONS = [['wt-wt', 'Весь мир'], ['ru-ru', 'Россия'], ['us-en', 'США'], ['de-de', 'Германия'], ['kz-ru', 'Казахстан'], ['ua-uk', 'Украина']];
  const TIMES = [['any', 'За всё время'], ['d', 'За день'], ['w', 'За неделю'], ['m', 'За месяц'], ['y', 'За год']];
  const SAFES = [['moderate', 'Безопасный поиск: умеренный'], ['strict', 'Безопасный поиск: строгий'], ['off', 'Безопасный поиск: выключен']];
  const marked = (t) => { const f = document.createDocumentFragment(); String(t).split('\u0001').forEach((p, i) => { if (!i) { f.append(p); return; } const [m, r] = p.split('\u0002'); f.append(h('mark', m), r || ''); }); return f; };
  const select = (list, cur, cb) => { const s = h('select.field.sselect', list.map(([v, n]) => h('option', { value: v }, n))); s.value = cur; s.addEventListener('change', () => cb(s.value)); return s; };
  const via = (p) => (!p || p.type === 'none' ? 'напрямую, без прокси' : (p.type === 'socks5' ? 'SOCKS5 ' : 'HTTP ') + p.host + ':' + p.port + (/^(127\.0\.0\.1|localhost)$/.test(p.host) && /^(9050|9150)$/.test(String(p.port)) ? ' (Tor)' : ''));

  function searchScreen(opts) {
    let cfg = null, next = null, busy = false, time = 'any';
    const s = h('section.screen', head(['Поиск', 'DuckDuckGo без истории'], 'Анонимный', 'поиск',
      'Запросы уходят в DuckDuckGo из отдельной сессии без cookies и кэша — напрямую, через твой прокси или через Tor. Приложение не записывает, что ты искал: ушёл из раздела — запросов не осталось.'));
    const input = h('input.field.sinput', { type: 'search', placeholder: 'что найти?', autocomplete: 'off', spellcheck: 'false' });
    const goBtn = h('button.key.key--accent', { type: 'button', onclick: () => run(false) }, 'Найти');
    const status = h('p.k.sstatus'), list = h('div.slist'), more = h('div.row');
    const filters = h('div.row.sfilters');
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') run(false); });

    /* настройки прокси */
    const ptype = h('div.adv-tabs', { role: 'tablist' }), host = h('input.field', { placeholder: 'адрес, например 127.0.0.1', spellcheck: 'false' }), port = h('input.field.sport', { placeholder: 'порт', inputmode: 'numeric' });
    const checkOut = h('p.muted');
    let type = 'none';
    function drawType() {
      ptype.textContent = '';
      [['none', 'Без прокси'], ['socks5', 'SOCKS5'], ['http', 'HTTP']].forEach(([v, n]) => ptype.append(h('button', { type: 'button', role: 'tab', 'aria-selected': type === v ? 'true' : 'false', onclick: () => { type = v; drawType(); } }, n)));
      host.disabled = port.disabled = type === 'none';
    }
    const proxyNow = () => ({ type, host: host.value.trim(), port: Number(port.value) });
    const preset = (label, t, hst, prt) => h('button.key.key--sm', { type: 'button', onclick: () => { type = t; host.value = hst; port.value = prt; drawType(); } }, label);
    const settings = h('details.plate.ssettings',
      h('summary', h('span', 'Соединение: '), h('b.svia', '…')),
      h('div.stack',
        ptype,
        h('div.row', host, port),
        h('div.row', h('span.k', 'Быстро'), preset('Tor Browser · 127.0.0.1:9150', 'socks5', '127.0.0.1', 9150), preset('Служба Tor · 127.0.0.1:9050', 'socks5', '127.0.0.1', 9050)),
        h('div.row',
          h('button.key.key--snow', { type: 'button', onclick: async () => { const r = await K.searchSet({ proxy: proxyNow() }); if (!r.ok) { toast(r.err, 'bad'); return; } cfg = r.cfg; paintVia(); toast('Сохранено: ' + via(cfg.proxy)); } }, 'Сохранить'),
          h('button.key', { type: 'button', onclick: async () => { checkOut.textContent = 'Проверяю…'; const r = await K.searchCheck(proxyNow()); checkOut.textContent = r.ok ? 'Сайты видят адрес ' + r.ip + ' · ' + (r.tor ? 'это сеть Tor' : 'это не Tor') + ' · ответ за ' + (r.ms / 1000).toFixed(1) + ' с' : r.err; } }, 'Проверить соединение')),
        checkOut,
        h('p.muted', 'Прокси с логином и паролем пока не поддерживаются. Для Tor нужен запущенный Tor Browser или служба Tor. Проверка соединения обращается к check.torproject.org и показывает, какой IP видят сайты.')));
    const paintVia = () => { settings.querySelector('.svia').textContent = via(cfg.proxy); };

    s.append(h('div.ssearch', input, goBtn), filters, settings, status, list, more,
      h('p.muted.snote', 'Найденное открывается прямо здесь, через то же соединение: «Читалка» показывает только текст — без скриптов, картинок и трекеров, «Оригинал» — сам сайт во встроенном окне с блокировкой трекеров. Кнопка «в своём браузере» откроет ссылку в обычном браузере — он ходит в сеть своим путём, мимо прокси.'));

    function drawFilters() {
      filters.textContent = '';
      filters.append(
        select(REGIONS, cfg.region, (v) => { cfg.region = v; K.searchSet({ region: v }); if (input.value.trim()) run(false); }),
        select(TIMES, time, (v) => { time = v; if (input.value.trim()) run(false); }),
        select(SAFES, cfg.safe, (v) => { cfg.safe = v; K.searchSet({ safe: v }); if (input.value.trim()) run(false); }));
    }
    // результат открывается прямо в приложении: читалкой или оригиналом сайта, через тот же прокси
    const openHere = (url) => {
      if (window.VIEWER) window.VIEWER.open(url, { via: via(cfg.proxy), onQuery: (q) => { input.value = q; run(false); } });
      else K.searchOpen(url);
    };
    function result(r) {
      return h('article.sres',
        h('button.sres__title', { type: 'button', onclick: () => openHere(r.url) }, r.title || r.url),
        h('span.sres__url', r.display),
        r.snippet ? h('p.sres__snip', marked(r.snippet)) : null,
        h('div.sres__keys',
          h('button.vrow__btn', { type: 'button', onclick: () => openHere(r.url) }, 'открыть здесь'),
          h('button.vrow__btn', { type: 'button', onclick: () => K.searchOpen(r.url) }, 'в своём браузере ↗'),
          h('button.vrow__btn', { type: 'button', onclick: async () => { await K.copyText(r.url); toast('Ссылка скопирована'); } }, 'копировать ссылку')));
    }
    async function run(append) {
      const q = input.value.trim();
      if (busy || (!append && !q)) return;
      busy = true; goBtn.disabled = true;
      status.textContent = append ? 'Загружаю ещё…' : 'Ищу ' + via(cfg.proxy) + '…';
      const r = await K.searchQuery(append ? { next } : { q, region: cfg.region, safe: cfg.safe, time });
      busy = false; goBtn.disabled = false;
      if (!s.isConnected) return;
      if (!append) { list.textContent = ''; more.textContent = ''; }
      if (!r.ok) {
        status.textContent = '';
        list.append(h('div.plate.warn', h('b', r.err), r.captcha ? h('div.row', h('span', 'Подожди минуту или открой поиск в браузере.'), h('button.key.key--sm', { type: 'button', onclick: () => K.searchOpen('https://duckduckgo.com/?q=' + encodeURIComponent(q)) }, 'Открыть в браузере ↗')) : null));
        return;
      }
      status.textContent = (r.results.length ? 'Найдено на странице: ' + r.results.length : 'Ничего не нашлось') + ' · ' + via(cfg.proxy) + ' · ' + (r.ms / 1000).toFixed(1) + ' с · история не сохраняется';
      r.results.forEach((x) => list.append(result(x)));
      next = r.next;
      more.textContent = '';
      if (next) more.append(h('button.key', { type: 'button', onclick: () => run(true) }, 'Ещё результаты'));
    }
    K.searchGet().then((c) => {
      cfg = c; type = c.proxy.type; host.value = c.proxy.host || ''; port.value = c.proxy.port || '';
      drawType(); drawFilters(); paintVia(); input.focus();
      // переход из утилит с готовым запросом (например, «как удалить аккаунт …»)
      if (opts && typeof opts.q === 'string' && opts.q.trim()) { input.value = opts.q.trim().slice(0, 300); run(false); }
    });
    return s;
  }

  Object.assign(window.TOOLS, { search: searchScreen });
})();
