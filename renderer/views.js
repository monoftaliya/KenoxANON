/* Экраны: обзор, слои с живыми проверками, атлас слежки, журнал. */
(function () {
  'use strict';
  const { h, $, toast, confirmBox, scramble, fmtDate } = window.UI;
  const C = window.CONTENT;
  const A = window.APP = window.APP || {};
  const LV = [[25, 'Открытая книга'], [45, 'Заметный след'], [65, 'Размытый силуэт'], [85, 'Тень'], [101, 'Шум']];
  const level = (s) => LV.find((l) => s < l[0])[1];
  const plural = (n, one, few, many) => { const a = Math.abs(n) % 100, b = a % 10; return a > 10 && a < 20 ? many : b === 1 ? one : b > 1 && b < 5 ? few : many; };
  const items = () => (A.audit && A.audit.items) || [];
  const byLayer = (n) => items().filter((i) => i.layer === n);
  const focus = (i) => { const adv = C.adversaries.find((a) => a.id === A.adversary); return i.w * (adv && adv.focus[i.layer] ? 1 + adv.focus[i.layer] : 1); };

  function head(kicker, title, em, lead, extra) {
    return h('header.screen-head', h('p.kicker', kicker.map((k) => h('span', k))), h('h1.title', title + ' ', em ? h('em', em) : null), lead ? h('p.lead', lead) : null, extra || null);
  }
  function termTags(ids) {
    const T = window.ATLAS; if (!T || !ids || !ids.length) return null;
    return h('p.layer__atlas', h('span', 'В атласе'), ids.map((id) => { const t = T.terms.find((x) => x.id === id); if (!t) return null; const tp = T.types.find((x) => x.id === t.type); return h('button.tag', { type: 'button', style: { '--c': tp.color }, onclick: () => A.go('atlas', { term: id }) }, t.name.replace(/\s*\(.*\)$/, '')); }));
  }

  /* ---------- строка проверки ---------- */
  function checkRow(it) {
    const state = it.good === true ? 'is-good' : it.good === false ? 'is-bad' : 'is-unknown';
    const row = h('article.plate.chk.' + state, { 'data-id': it.id });
    const keys = h('div.chk__keys');
    const canUndo = A.undo.has(it.id);
    if (it.fix.kind === 'reg' || it.fix.kind === 'admin') {
      if (it.good === false || !canUndo) keys.append(h('button.key.key--sm' + (it.good === false ? '.key--snow' : ''), { type: 'button', disabled: it.good === true ? true : null, onclick: () => doFix(it, row) }, it.good === true ? 'В порядке' : it.fix.label));
      if (canUndo) keys.append(h('button.key.key--sm', { type: 'button', onclick: () => doRevert(it, row) }, 'Вернуть как было'));
      if (it.fix.kind === 'admin') keys.append(h('span.chk__note', 'нужны права администратора'));
    } else if (it.fix.kind === 'open') {
      keys.append(h('button.key.key--sm' + (it.good === false ? '.key--snow' : ''), { type: 'button', onclick: () => window.kenox.open(it.id) }, it.fix.label + ' ↗'));
      keys.append(h('span.chk__note', 'правится в Windows вручную'));
    } else if (it.fix.kind === 'tool') {
      keys.append(h('button.key.key--sm.key--snow', { type: 'button', onclick: () => A.go(it.fix.tool) }, it.fix.label));
    }
    row.append(h('i.chk__dot', { 'aria-hidden': 'true' }),
      h('div.chk__main', h('h3.chk__title', it.title), h('p.chk__shown', 'сейчас: ' + it.shown), h('p.chk__advice', it.advice)),
      keys);
    return row;
  }
  async function doFix(it, row) {
    const body = [h('p', it.advice)];
    if (it.plan && it.plan.length) body.push(h('ul', it.plan.map((p) => h('li', h('code', p)))));
    if (it.fix.kind === 'admin') body.push(h('p.warn', 'Windows попросит подтвердить права администратора. Прежние значения сохранятся, их можно вернуть одной кнопкой.'));
    else body.push(h('p.muted', 'Меняются только настройки твоей учётной записи. Прежние значения сохранятся для отката.'));
    if (!(await confirmBox({ title: it.title, body, ok: it.fix.label }))) return;
    row.classList.add('is-busy');
    const r = await window.kenox.fix(it.id);
    row.classList.remove('is-busy');
    if (!r.ok) { toast(r.err || 'Не получилось', 'bad'); return; }
    toast('Готово: ' + it.title);
    A.undo.add(it.id); it.good = true; it.shown = 'исправлено';
    row.replaceWith(checkRow(it)); A.pulse(); A.refreshSoon();
  }
  async function doRevert(it, row) {
    if (!(await confirmBox({ kicker: 'Откат', title: 'Вернуть как было: ' + it.title, body: ['Приложение восстановит значения, которые были до исправления.'], ok: 'Вернуть' }))) return;
    row.classList.add('is-busy');
    const r = await window.kenox.revert(it.id);
    row.classList.remove('is-busy');
    if (!r.ok) { toast(r.err || 'Не получилось', 'bad'); return; }
    toast('Возвращено: ' + it.title, 'warn');
    A.undo.delete(it.id); it.good = false; it.shown = 'возвращено как было';
    row.replaceWith(checkRow(it)); A.refreshSoon();
  }

  /* ---------- обзор ---------- */
  function overview() {
    const au = A.audit, s = au ? au.score : 0;
    const bad = items().filter((i) => i.good === false).sort((a, b) => focus(b) - focus(a));
    const quick = bad.filter((i) => i.fix.kind === 'reg');
    const num = h('b', '0');
    const scoreBox = h('div.plate.score',
      h('span.k', 'Индекс невидимости'),
      h('span.score__num', num, h('small', '%')),
      h('span.score__label', level(s)),
      h('div.gauge', { 'aria-hidden': 'true' }, h('i', { style: { width: s + '%', background: s < 45 ? 'var(--t-trace)' : s < 70 ? 'var(--t-device)' : 'var(--t-net)' } })),
      h('p.muted', au ? (au.os ? au.os.caption + ' · ' + au.os.host + ' · ' : '') + 'проверено ' + fmtDate(A.auditedAt) : 'проверка ещё не запускалась'),
      guardLine(),
      h('div.row',
        h('button.key.key--accent', { type: 'button', onclick: () => window.CHECK_ALL && window.CHECK_ALL.open() }, 'Проверить всё'),
        h('button.key.key--snow', { type: 'button', onclick: () => A.refresh(true) }, 'Проверить заново'),
        quick.length ? h('button.key.key--accent', { type: 'button', onclick: () => fixAll(quick) }, 'Исправить безопасное · ' + quick.length) : null));
    requestAnimationFrame(() => { let v = 0; const t0 = performance.now(); const step = (now) => { const p = Math.min(1, (now - t0) / 900); v = Math.round(s * (1 - Math.pow(1 - p, 3))); num.textContent = v; if (p < 1) requestAnimationFrame(step); }; requestAnimationFrame(step); });
    const urgent = h('div.plate.urgent', h('p.plate__title', 'Сначала это'),
      bad.length ? h('ul', { style: { display: 'grid', gap: '8px' } }, bad.slice(0, 5).map((i) => h('li',
        h('i.chk__dot', { style: { background: 'var(--t-trace)', margin: 0 } }),
        h('div', h('b', i.title), h('span', 'сейчас: ' + i.shown)),
        h('button.key.key--sm', { type: 'button', onclick: () => A.go('layer-' + i.layer, { focus: i.id }) }, 'К слою ' + String(i.layer).padStart(2, '0'))))) : h('p.muted', 'Срочных проблем не нашлось. Загляни в инструменты.'));
    const tiles = h('div.grid3', C.layers.map((L) => {
      const own = byLayer(L.n), ok = own.filter((i) => i.good).length, known = own.filter((i) => i.good !== null).length;
      return h('button.plate.tile', { type: 'button', style: { '--c': L.accent }, onclick: () => A.go('layer-' + L.n) },
        h('span.tile__n', String(L.n).padStart(2, '0')), h('span.tile__t', L.title),
        h('span.tile__s', own.length ? ok + ' из ' + known + ' в порядке' : 'знание и привычки'),
        h('div.bar', h('i', { style: { width: (known ? ok / known * 100 : 0) + '%' } })));
    }));
    const live = (A.spy || []).find((e) => e.live);
    const tools = h('div.grid3',
      toolTile('radar', '◎', 'Радар соединений', A.radarTotal != null ? A.radarTotal + ' активных соединений' : 'куда сейчас ходит компьютер'),
      toolTile('spy', '◉', 'Кто подглядывал', live ? live.name + ' сейчас использует ' + capName(live.cap) : 'история камеры, микрофона, геопозиции', !!live),
      toolTile('meta', '▣', 'Метаданные', 'перетащи фото и документы — уберу GPS и автора'),
      toolTile('leaks', '⚿', 'Утечки паролей', 'проверка без отправки пароля и мастер смены'),
      toolTile('browsers', '▤', 'Браузеры', 'кэш, cookies и история одной кнопкой'),
      toolTile('panic', '!', 'Тревожная кнопка', 'очистить буфер и заблокировать экран'));
    const wipes = h('div.grid3',
      toolTile('traces', '⌫', 'Следы в Windows', 'недавние файлы, Win+V, кэши, корзина — одной кнопкой', false, 'var(--t-trace)'),
      toolTile('shredder', '▒', 'Шредер файлов', 'стереть так, чтобы не восстановили', false, 'var(--t-trace)'),
      toolTile('footprint', '◌', 'След в интернете', 'забытые аккаунты, поисковики, требования об удалении', false, 'var(--t-super)'));
    return h('section.screen',
      head(['00 · Обзор', 'всё считается на этом компьютере'], 'Индекс', 'невидимости', 'Приложение проверило настройки Windows, сеть, браузеры и программы. Чем выше индекс, тем сильнее рассыпается воксельный отпечаток на фоне.'),
      h('div.ov', scoreBox, urgent), h('p.plate__title', 'Слои защиты'), tiles, h('p.plate__title', 'Мои данные'), h('div.grid3', toolTile('twin', '◐', 'Двойник', 'досье на тебя по твоим же файлам — и кнопки, которые его стирают', false, 'var(--t-super)'), vaultTile(), toolTile('search', '⌕', 'Анонимный поиск', 'DuckDuckGo через прокси или Tor, без истории запросов', false, 'var(--t-browser)')), h('p.plate__title', 'Стирание'), wipes, h('p.plate__title', 'Инструменты'), tools);
  }
  // плитка хранилища: цифры подгружаются после отрисовки обзора
  // строка Стража в индексе: охраняет ли компьютер в фоне
  function guardLine() {
    const line = h('button.oguard', { type: 'button', onclick: () => A.go('guard') }, h('i'), h('span', 'Страж: …'));
    window.kenox.guardStatus().then((g) => { line.classList.toggle('is-on', g.cfg.on); line.lastChild.textContent = g.cfg.on ? 'Страж охраняет в фоне · проверка ' + ({ day: 'каждый день', week: 'каждую неделю', off: 'выключена' })[g.cfg.check] + ' →' : 'Страж выключен — включи фоновую защиту →'; }).catch(() => {});
    return line;
  }
  function vaultTile() {
    const sub = h('span.tile__s', 'выгрузки Telegram, Discord, Google, Instagram, WhatsApp и папки с фото — поиск, метки, удаление');
    const tile = h('button.plate.tile', { type: 'button', style: { '--c': 'var(--t-net)' }, onclick: () => A.go('vault') }, h('span.tile__n', '◫'), h('span.tile__t', 'Хранилище данных'), sub);
    window.kenox.vaultStats().then((v) => { if (v && v.locked) sub.textContent = '⚿ заперто паролем · база зашифрована на этом компьютере'; else if (v && v.ok && v.total) sub.textContent = v.total + ' ' + window.UI.plural(v.total, 'запись', 'записи', 'записей') + ' из ' + v.sources.length + ' ' + (v.sources.length % 10 === 1 && v.sources.length % 100 !== 11 ? 'источника' : 'источников') + ' · только на этом компьютере'; }).catch(() => {});
    return tile;
  }
  const capName = (c) => ({ webcam: 'камеру', microphone: 'микрофон', location: 'геопозицию' }[c] || c);
  function toolTile(view, icon, title, sub, hot, color) {
    return h('button.plate.tile', { type: 'button', style: { '--c': hot ? 'var(--t-trace)' : color || 'var(--acc)' }, onclick: () => A.go(view) }, h('span.tile__n', icon), h('span.tile__t', title), h('span.tile__s', sub));
  }
  async function fixAll(list) {
    const body = [h('p', 'Будут исправлены настройки твоей учётной записи. Права администратора не нужны, каждое изменение можно вернуть.'), h('ul', list.map((i) => h('li', i.title + ' — ' + i.fix.label.toLowerCase())))];
    if (!(await confirmBox({ title: 'Исправить ' + list.length + ' настроек', body, ok: 'Исправить всё' }))) return;
    let ok = 0;
    for (const it of list) { const r = await window.kenox.fix(it.id); if (r.ok) { ok++; A.undo.add(it.id); } }
    toast('Исправлено ' + ok + ' из ' + list.length); A.pulse(true);
    await A.refresh(false); A.go('overview');
  }

  /* ---------- слой ---------- */
  function layer(n, opts) {
    const L = C.layers.find((x) => x.n === n), own = byLayer(n).slice().sort((a, b) => (a.good === false ? 0 : 1) - (b.good === false ? 0 : 1) || b.w - a.w);
    const s = h('section.screen', head(['Слой ' + String(n).padStart(2, '0') + ' / 09', own.length ? own.filter((i) => i.good).length + ' из ' + own.length + ' в порядке' : 'знание'], L.title, L.em, L.lead, termTags(L.terms)));
    if (n === 1) s.append(adversaryBox());
    if (own.length) own.forEach((i) => s.append(checkRow(i)));
    const related = { 2: [['leaks', 'Проверить пароли на утечки'], ['footprint', 'Удалить забытые аккаунты']], 4: [['radar', 'Открыть радар соединений']], 5: [['browsers', 'Почистить браузеры']], 7: [['spy', 'Кто подглядывал'], ['traces', 'Стереть следы в Windows']], 8: [['meta', 'Удалить метаданные файлов'], ['shredder', 'Шредер файлов']], 9: [['footprint', 'Стереть себя из сети'], ['panic', 'Тревожная кнопка']] }[n];
    if (related) s.append(h('div.row', related.map(([v, t], i) => h('button.key' + (i ? '' : '.key--snow'), { type: 'button', onclick: () => A.go(v) }, t + ' →'))));
    s.append(h('p.plate__title', 'Советы'), h('div.tips', L.tips.map(([t, p]) => h('article.plate.tip', h('h3', t), h('p', p)))));
    if (opts && opts.focus) setTimeout(() => { const r = $('[data-id="' + opts.focus + '"]'); if (r) { r.scrollIntoView({ block: 'center', behavior: 'smooth' }); r.animate([{ boxShadow: '0 0 0 2px var(--acc)' }, { boxShadow: '0 0 0 0 transparent' }], { duration: 1600 }); } }, 200);
    return s;
  }
  function adversaryBox() {
    const box = h('div.plate.tool', h('div.tool__head', h('b', 'Прибор · Противник'), h('span', 'проверки встанут по важности для него')));
    const tabs = h('div.adv-tabs', { role: 'tablist' });
    const note = h('p.muted');
    const draw = () => {
      tabs.textContent = '';
      C.adversaries.forEach((a) => tabs.append(h('button', { role: 'tab', type: 'button', 'aria-selected': A.adversary === a.id ? 'true' : 'false', onclick: () => { A.adversary = a.id; A.save(); draw(); } }, a.name)));
      const adv = C.adversaries.find((a) => a.id === A.adversary);
      note.textContent = adv ? 'Сила противника ' + adv.power + '/10. Важнее всего слои: ' + Object.keys(adv.focus).sort((x, y) => adv.focus[y] - adv.focus[x]).map((k) => C.layers[k - 1].title).join(', ') + '. Список «Сначала это» в обзоре уже перестроен.' : 'Выбери, от кого защищаешься.';
    };
    draw(); box.append(tabs, note); return box;
  }

  /* ---------- атлас (колесо мыши двигает «реку») ---------- */
  function atlas(opts) {
    const T = window.ATLAS, N = T.terms.length, type = Object.fromEntries(T.types.map((t) => [t.id, t])), AA = window.ATLAS_ACTIONS || {};
    const VERD = { yes: 'Можно стереть', part: 'Стирается частично', no: 'Стереть нельзя' };
    const stage = h('div.plate.atlas-app', { 'data-lenis-prevent': '' });
    const field = h('div.atlas__field'), card = h('div.atlas__card.plate', { hidden: true }), wire = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    wire.setAttribute('class', 'atlas__wire'); const path = document.createElementNS('http://www.w3.org/2000/svg', 'path'); wire.append(path);
    const now = h('span.atlas__now'), name = h('span.atlas__name');
    const chips = T.types.map((tp) => h('button.ttype', { type: 'button', style: { '--c': tp.color }, 'aria-pressed': 'false', onclick: () => { go(T.terms.findIndex((t) => t.type === tp.id), false); } }, h('i'), h('span', tp.name), h('small', String(T.terms.filter((t) => t.type === tp.id).length))));
    const els = T.terms.map((t, i) => { const b = h('button.term', { type: 'button', style: { '--c': type[t.type].color, 'pointer-events': 'auto' }, 'aria-label': t.name + (AA[t.id] ? ' — ' + VERD[AA[t.id].wipe].toLowerCase() : ''), 'data-wipe': AA[t.id] ? AA[t.id].wipe : null, onclick: () => go(i, true) }, h('span.term__t', t.code)); field.append(b); return b; });
    stage.append(h('div.atlas__types', chips), field, wire, card, h('div.atlas__hud', now, name, h('span.atlas__legend', h('i.lg.lg--yes'), 'можно стереть', h('i.lg.lg--part'), 'частично'), h('span.atlas__hint', 'колесо мыши или ←→ · нажми на термин')));
    let sv = 0, target = 0, openI = -1, pend = -1;
    function go(i, open) { target = Math.max(0, Math.min(N - 1, i)); pend = open ? target : -1; if (!open) close(); }
    function close() { openI = -1; card.hidden = true; path.setAttribute('d', ''); }
    function show(i) {
      const t = T.terms[i], tp = type[t.type]; openI = i; card.style.setProperty('--acc', tp.color); card.textContent = '';
      const risk = h('span.risk', 'риск ', [0, 1, 2].map((k) => h('i' + (k < t.risk ? '.on' : ''))));
      const L = C.layers.find((x) => 'layer-' + x.n === t.layer), act = AA[t.id];
      const from = (note) => ({ id: t.id, name: t.name, note });
      const wipe = act ? h('div.wipe.wipe--' + act.wipe, h('b', VERD[act.wipe]), h('p', act.why), h('div.row',
        act.erase ? h('button.key.key--sm.key--accent', { type: 'button', onclick: () => window.ATLAS_RUN(t, act.erase) }, act.erase.label) : null,
        act.go ? h('button.key.key--sm' + (act.erase ? '' : '.key--snow'), { type: 'button', onclick: () => A.go(act.go.view, Object.assign({}, act.go.opts, { from: from(act.go.label) })) }, act.go.label + ' →') : null)) : null;
      const layerBtn = L && !(act && act.go && act.go.view === 'layer-' + L.n) ? h('button.key.key--sm', { type: 'button', onclick: () => A.go('layer-' + L.n, { from: from('слой защиты для этого пункта') }) }, 'Слой ' + String(L.n).padStart(2, '0') + ' →') : null;
      card.append(h('header', h('span.tag', { style: { '--c': tp.color } }, tp.name), risk), h('h3', t.name), h('p', t.what), wipe, h('p.def', h('b', 'Как защититься'), t.defend),
        h('footer', layerBtn || h('span'), h('button.key.key--sm', { type: 'button', 'aria-label': 'Закрыть', onclick: close }, '✕')));
      card.scrollTop = 0;
      card.hidden = false; wire.style.setProperty('--wc', tp.color);
    }
    stage.addEventListener('wheel', (e) => { if (card.contains(e.target)) { if (card.scrollHeight <= card.clientHeight + 1) e.preventDefault(); return; } e.preventDefault(); target = Math.max(0, Math.min(N - 1, target + Math.sign(e.deltaY) * (Math.abs(e.deltaY) > 60 ? 1 : 0.5))); if (openI >= 0) close(); }, { passive: false });
    stage.tabIndex = 0;
    stage.addEventListener('keydown', (e) => { const k = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[e.key]; if (k) { e.preventDefault(); go(Math.round(target) + k, false); } if (e.key === 'Escape') close(); });
    if (opts && opts.term) { const i = T.terms.findIndex((t) => t.id === opts.term); if (i >= 0) { sv = target = Math.max(0, i - 3); go(i, true); } }
    let focusI = -1, mounted = false, idle = 0, shiftX = 0;
    (function frame() {
      // экран вставляется в окно после сборки: ждём его появления и останавливаемся, когда его убрали
      if (stage.isConnected) mounted = true; else if (mounted || ++idle > 600) return;
      requestAnimationFrame(frame);
      if (!mounted) return;
      sv += (target - sv) * 0.14;
      const W = stage.clientWidth, H = stage.clientHeight;
      // пока открыто пояснение, «река» отходит влево и освобождает место для карточки справа
      const wantShift = openI >= 0 || pend >= 0 ? -Math.min(card.offsetWidth || 380, W * 0.42) / 2 - 28 : 0;
      shiftX += (wantShift - shiftX) * 0.14;
      els.forEach((el, i) => {
        const d = i - sv, ad = Math.abs(d);
        if (ad > 6) { el.style.visibility = 'hidden'; return; }
        el.style.visibility = 'visible';
        const ang = d * 0.6, x = shiftX + Math.sin(ang) * W * 0.27 + Math.sin(i * 2.17) * W * 0.05 * Math.min(1, ad), y = d * H * 0.13, z = -ad * 230 - (1 - Math.cos(ang)) * 140;
        let op = Math.max(0, 1 - ad * 0.19); if (openI >= 0 && i !== openI) op *= 0.25;
        el.style.opacity = op.toFixed(3);
        el.firstChild.style.filter = ad > 0.7 ? 'blur(' + Math.min(4, (ad - 0.7) * 1.1).toFixed(2) + 'px)' : 'none';
        el.style.transform = 'translate3d(calc(-50% + ' + x.toFixed(1) + 'px), calc(-50% + ' + y.toFixed(1) + 'px), ' + z.toFixed(1) + 'px) rotateY(' + (-Math.sin(ang) * 16).toFixed(2) + 'deg) scale(' + Math.max(0.35, 1 - ad * 0.1).toFixed(3) + ')';
      });
      const f = Math.round(sv);
      if (f !== focusI) { focusI = f; now.textContent = String(f + 1).padStart(2, '0') + ' / ' + N; name.textContent = T.terms[f].name; chips.forEach((c, k) => c.setAttribute('aria-pressed', T.types[k].id === T.terms[f].type ? 'true' : 'false')); }
      if (pend >= 0 && Math.abs(sv - pend) < 0.05) { show(pend); pend = -1; }
      if (openI >= 0) {
        const r = els[openI].getBoundingClientRect(), sr = stage.getBoundingClientRect(), cw = card.offsetWidth, ch = card.offsetHeight;
        const rx = r.right - sr.left, lx = r.left - sr.left, cy = r.top - sr.top + r.height / 2;
        let x, fromX, toX;
        if (rx + 40 + cw < sr.width - 16) { x = rx + 40; fromX = rx + 4; toX = x; } else { x = Math.max(16, lx - 40 - cw); fromX = lx - 4; toX = x + cw; }
        const y = Math.max(60, Math.min(sr.height - ch - 60, cy - ch / 2));
        card.style.left = Math.round(x) + 'px'; card.style.top = Math.round(y) + 'px';
        const mx = Math.round((fromX + toX) / 2), ty = Math.min(Math.max(cy, y + 24), y + ch - 24);
        path.setAttribute('d', 'M' + Math.round(fromX) + ' ' + Math.round(cy) + ' H' + mx + ' V' + Math.round(ty) + ' H' + Math.round(toX));
      }
    })();
    return h('section.screen', head(['Атлас слежки', '32 способа · 6 типов'], 'Как тебя узнают', 'без имени', 'Крути колесо — термины проплывают мимо; нажми — пояснение прикрепится к термину и скажет, можно ли это стереть. Зелёный квадрат — стирается, жёлтый — частично.'), stage);
  }

  /* ---------- журнал ---------- */
  async function journal() {
    const r = await window.kenox.journal();
    const KIND = { fix: ['исправление', 'var(--t-net)'], revert: ['откат', 'var(--t-device)'], scan: ['проверка', 'var(--t-browser)'], clean: ['очистка', 'var(--t-super)'], panic: ['паника', 'var(--t-trace)'] };
    const v = r.verify;
    const ok = h('p.plate', { style: { '--acc': v.ok ? 'var(--t-net)' : 'var(--t-trace)' } }, h('b', v.ok ? 'Цепочка цела' : 'Цепочка нарушена'), ' · ', v.ok ? (v.count + ' ' + plural(v.count, 'запись', 'записи', 'записей') + ', каждая подписана хэшем предыдущей') : 'запись №' + (v.at + 1) + ' изменена вне приложения');
    const list = h('div.plate', r.items.length ? r.items.map((it) => h('div.log-row', { title: it.ts + ' · sha256 ' + it.hash },
      h('span.muted', fmtDate(it.ts)), h('span.k', { style: { '--c': (KIND[it.kind] || ['', 'var(--snow)'])[1] } }, (KIND[it.kind] || [it.kind])[0]),
      h('span', it.title, it.detail ? h('span.muted', ' · ' + it.detail) : null), h('span.h', '#' + it.hash.slice(0, 8)))) : h('p.muted', 'Пока пусто: здесь появится каждое изменение, которое сделает приложение.'));
    return h('section.screen', head(['Журнал', 'хэш-цепочка SHA-256'], 'Что приложение', 'меняло', 'Каждое исправление, откат и очистка записываются со временем и хэшем, в который вшит предыдущий. Так видно, если журнал правили в обход приложения.'),
      ok, h('div.row', h('button.key', { type: 'button', onclick: () => A.go('journal') }, 'Обновить'), h('button.key', { type: 'button', onclick: async () => { if (await confirmBox({ kicker: 'Журнал', title: 'Очистить журнал?', body: ['Записи удалятся, начнётся новая цепочка. Сделанные изменения при этом не откатятся.'], ok: 'Очистить', danger: true })) { await window.kenox.journalClear(); A.go('journal'); } } }, 'Очистить журнал')), list);
  }

  window.VIEWS = { overview, layer, atlas, journal, checkRow, head };
})();
