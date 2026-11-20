/* Стирание: следы в Windows, шредер файлов, след в интернете. */
(function () {
  'use strict';
  const { h, toast, confirmBox, fmtBytes, fmtDate, plural } = window.UI;
  const A = window.APP = window.APP || {};
  const D = window.ERASE_DATA;
  const head = window.VIEWS.head;
  const K = window.kenox;
  const stack = () => h('div.stack');
  const stat = (n, label, color) => h('div.plate.stat', { style: color ? { '--c': color } : null }, h('b', String(n)), h('span', label));
  const store = { get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* без памяти */ } } };

  /* ---------- следы в Windows ---------- */
  const UNIT = { run: ['запись', 'записи', 'записей'], search: ['запрос', 'запроса', 'запросов'], dns: ['адрес', 'адреса', 'адресов'] };
  function amount(it) {
    const u = UNIT[it.id] || ['файл', 'файла', 'файлов'];
    const parts = [];
    if (it.count != null) parts.push(it.count + ' ' + plural(it.count, ...u));
    if (it.size) parts.push(fmtBytes(it.size));
    return parts.join(' · ') || (it.id === 'clipboard' ? 'сейчас' : '—');
  }
  function winBlock() {
    return h('article.plate.tool',
      h('div.tool__head', h('b', 'Кнопки, которые Windows прячет'), h('span', 'откроются нужные страницы Параметров')),
      h('div.grid2', D.windows.map((w) => h('div.mini', h('b', w.name), h('p.muted', w.text), h('button.key.key--sm', { type: 'button', onclick: () => K.link(w.uri) }, 'Открыть ↗')))));
  }
  function traces(opts) {
    const only = opts && opts.select;
    const s = h('section.screen', head(['Стирание', 'следы на этом компьютере'], 'Стереть', 'следы',
      'Windows и программы тихо копят историю: что ты открывал, искал, копировал и запускал. Отметь, что стереть, — приложение покажет объём и уберёт всё одной кнопкой. Удаление окончательное.'));
    const list = stack(), bar = h('div.erase-bar'), report = h('div');
    const checks = new Map(); let items = [];
    s.append(h('div.row', h('button.key.key--snow', { type: 'button', onclick: () => load() }, 'Пересчитать'), h('button.key', { type: 'button', onclick: () => selectSafe() }, 'Отметить безопасное')),
      report, list, bar, winBlock(),
      h('p.muted', 'Тревожная кнопка может сама стирать журнал Win+V, недавние файлы и историю «Выполнить» при каждом нажатии — это включается в её разделе.'));
    async function load() {
      list.textContent = ''; list.append(h('p.muted', 'Считаю, сколько накопилось…')); bar.textContent = '';
      const r = await K.tracesScan();
      if (!s.isConnected) return;
      list.textContent = '';
      if (!r || !r.ok) { list.append(h('p.plate.warn', 'Не удалось просканировать: ' + ((r && r.err) || ''))); return; }
      items = r.items; checks.clear();
      items.forEach((it) => list.append(row(it)));
      drawBar();
    }
    function row(it) {
      const has = it.id === 'clipboard' || it.admin || it.count || it.size;
      const cb = h('input', { type: 'checkbox' });
      cb.disabled = it.missing || it.running;
      cb.checked = !cb.disabled && (only ? only.includes(it.id) : it.safe && !!has);
      cb.addEventListener('change', drawBar); checks.set(it.id, cb);
      return h('label.plate.trace' + (cb.disabled ? '.is-off' : '') + (has ? '' : '.is-empty') + (only && only.includes(it.id) ? '.is-focus' : ''),
        h('span.switch', cb, h('i')),
        h('span.trace__main', h('b', it.title), h('span.muted', it.why)),
        h('span.trace__amount', h('b', amount(it)), it.note ? h('small' + (it.running ? '.bad-text' : ''), it.note) : null));
    }
    function selectSafe() { items.forEach((it) => { const cb = checks.get(it.id); if (cb && !cb.disabled) cb.checked = it.safe; }); drawBar(); }
    function drawBar() {
      const sel = items.filter((it) => checks.get(it.id) && checks.get(it.id).checked), size = sel.reduce((a, it) => a + (it.size || 0), 0);
      bar.textContent = '';
      bar.append(h('button.key.key--accent', { type: 'button', disabled: sel.length ? null : true, onclick: () => run(sel) }, 'Стереть выбранное · ' + sel.length),
        h('span.muted', size ? 'освободится около ' + fmtBytes(size) : 'отметь, что стереть'));
    }
    async function run(sel) {
      const ok = await confirmBox({ kicker: 'Удаление без возврата', title: 'Стереть ' + sel.length + ' ' + plural(sel.length, 'вид следов', 'вида следов', 'видов следов') + '?', ok: 'Стереть', danger: true, body: [
        h('ul', sel.map((it) => h('li', it.title + (it.size ? ' — ' + fmtBytes(it.size) : '')))),
        sel.some((it) => it.id === 'recycle') ? h('p.warn', 'Корзина очистится целиком — файлы из неё уже не вернуть.') : null,
        sel.some((it) => it.admin) ? h('p.warn', 'Для Prefetch Windows попросит права администратора.') : null,
        h('p.muted', 'Документы, закладки, пароли и настройки программ не затрагиваются. Занятые файлы будут пропущены.')] });
      if (!ok) return;
      bar.classList.add('is-busy');
      const r = await K.tracesClean(sel.map((it) => it.id));
      bar.classList.remove('is-busy');
      const good = r.results.filter((x) => x.ok), freed = good.reduce((a, x) => a + (x.freed || 0), 0);
      toast('Стёрто: ' + good.length + ' из ' + r.results.length + (freed ? ' · освобождено ' + fmtBytes(freed) : ''), good.length === r.results.length ? 'ok' : 'warn');
      report.textContent = '';
      report.append(h('div.plate.result', h('p.plate__title', 'Готово'), h('ul.result__list', r.results.map((x) => {
        const it = items.find((i) => i.id === x.id);
        return h('li' + (x.ok ? '.ok' : '.bad'), h('b', (x.ok ? '✓ ' : '✕ ') + (it ? it.title : x.id)), x.removed ? h('span.muted', ' · удалено ' + x.removed + (x.freed ? ', ' + fmtBytes(x.freed) : '')) : null, x.note ? h('span.muted', ' · ' + x.note) : null);
      }))));
      A.pulse(true); A.refreshStatus(); load();
    }
    load();
    return s;
  }

  /* ---------- шредер ---------- */
  function shredder() {
    let picked = [], busy = false;
    const s = h('section.screen', head(['Стирание', 'без восстановления'], 'Шредер', 'файлов',
      'Обычное удаление стирает только запись о файле — содержимое остаётся на диске, и программы восстановления его находят. Шредер сначала записывает поверх случайные байты, затем даёт файлу случайное имя и удаляет.'));
    const add = (paths) => { if (!paths || !paths.length || busy) return; picked = [...new Set(picked.concat(paths))]; draw(); };
    const drop = h('div.plate.drop.drop--danger',
      h('b', 'Перетащи файлы или папки'),
      h('span.muted', 'системные папки, целые папки профиля и сам KenoxANON защищены'),
      h('div.row', h('button.key.key--snow', { type: 'button', onclick: async () => add(await K.pickAny(false)) }, 'Выбрать файлы'), h('button.key', { type: 'button', onclick: async () => add(await K.pickAny(true)) }, 'Выбрать папку')));
    drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('is-over'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('is-over'));
    drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('is-over'); add(Array.from(e.dataTransfer.files).map((f) => { try { return K.pathOf(f); } catch (err) { return ''; } }).filter(Boolean)); });
    const sel = stack(), prog = h('div.plate.progress-box', { hidden: true }), free = stack();
    s.append(drop, sel, prog, h('p.plate__title', 'Свободное место'), free);

    async function draw() {
      sel.textContent = '';
      if (!picked.length) return;
      const plan = await K.shredPlan(picked);
      if (!s.isConnected) return;
      sel.append(h('div.grid3', stat(plan.files, plural(plan.files, 'файл', 'файла', 'файлов')), stat(fmtBytes(plan.bytes), 'будет перезаписано'), stat(plan.skipped.length, 'пропущено защитой', plan.skipped.length ? 'var(--t-device)' : null)));
      sel.append(h('div.plate.picked', picked.map((p) => h('div.picked__row', h('span.mono.selectable', p), h('button.key.key--sm', { type: 'button', 'aria-label': 'Убрать из списка', onclick: () => { picked = picked.filter((x) => x !== p); draw(); } }, '✕')))));
      if (plan.skipped.length) sel.append(h('div.plate.warn', h('b', 'Не будет стёрто: '), plan.skipped.slice(0, 6).map((x) => h('div.mono', x.path + ' — ' + x.why))));
      if (plan.tooMany) sel.append(h('p.warn', 'За один раз — не больше ' + plan.limit.files + ' файлов и ' + plan.limit.gb + ' ГБ. Раздели на несколько частей.'));
      sel.append(h('div.row', h('button.key.key--accent', { type: 'button', disabled: plan.files && !plan.tooMany ? null : true, onclick: () => run(plan) }, 'Стереть насовсем'), h('button.key', { type: 'button', onclick: () => { picked = []; draw(); } }, 'Очистить список')));
    }
    async function run(plan) {
      const ok = await confirmBox({ kicker: 'Без возможности восстановления', title: 'Стереть ' + plan.files + ' ' + plural(plan.files, 'файл', 'файла', 'файлов') + '?', ok: 'Стереть насовсем', danger: true,
        check: 'Понимаю: восстановить эти файлы будет нельзя', body: [
          h('ul', picked.slice(0, 6).map((p) => h('li', h('code', p))), picked.length > 6 ? h('li', '…и ещё ' + (picked.length - 6)) : null),
          h('p', 'Объём: ' + fmtBytes(plan.bytes) + '. Каждый файл перезаписывается случайными байтами, получает случайное имя и удаляется; пустые папки удаляются следом.'),
          h('p.muted', 'На SSD перезапись не гарантирует стирания: контроллер диска может записать новые байты в другие ячейки. Надёжнее всего — шифрование диска (BitLocker): тогда остатки нечитаемы.')] });
      if (!ok) return;
      busy = true; prog.hidden = false; prog.textContent = '';
      const bar = h('i'), info = h('span.mono'), name = h('span.muted.mono');
      prog.append(h('div.tool__head', h('b', 'Стираю…'), h('button.key.key--sm', { type: 'button', onclick: () => K.shredCancel() }, 'Остановить')), h('div.gauge', bar), info, name);
      const off = K.onProgress((p) => {
        const pct = p.totalBytes ? p.bytes / p.totalBytes * 100 : p.total ? p.done / p.total * 100 : 100;
        bar.style.width = Math.min(100, pct).toFixed(1) + '%';
        info.textContent = p.done + ' из ' + p.total + ' · ' + fmtBytes(p.bytes) + ' из ' + fmtBytes(p.totalBytes);
        name.textContent = p.name || '';
      });
      const r = await K.shredRun(picked);
      off(); busy = false;
      if (!r.ok) { prog.hidden = true; toast(r.err || 'Не получилось', 'bad'); return; }
      prog.textContent = '';
      prog.append(h('div.tool__head', h('b', r.cancelled ? 'Остановлено' : 'Готово'), h('span', r.done + ' из ' + r.total + ' стёрто')),
        r.failed.length ? h('div.warn', h('b', 'Не удалось: '), r.failed.slice(0, 6).map((x) => h('div.mono', x.path + ' — ' + x.err))) : h('p.ok-line', 'Все выбранные файлы перезаписаны и удалены.'));
      toast((r.cancelled ? 'Остановлено. ' : '') + 'Стёрто без восстановления: ' + r.done, r.failed.length || r.cancelled ? 'warn' : 'ok');
      picked = []; draw(); A.pulse(true); A.refreshStatus();
    }
    async function drives() {
      free.textContent = '';
      const r = await K.drives();
      if (!s.isConnected) return;
      if (!r || !r.ok || !r.list.length) { free.append(h('p.muted', 'Не удалось получить список дисков.')); return; }
      free.append(h('p.muted', 'Удалённые раньше файлы остаются в «свободном» месте, пока поверх не запишется что-то новое. Встроенная утилита Windows cipher /w трижды перезаписывает всё свободное место. Это долго — от десятков минут до нескольких часов; окно можно закрыть, чтобы прервать.'));
      r.list.forEach((d) => {
        const ssd = /ssd/i.test(d.media);
        free.append(h('article.plate.drive',
          h('div.drive__main', h('b', d.letter + ':' + (d.label ? ' · ' + d.label : '')), h('span.muted', 'свободно ' + fmtBytes(d.free) + ' из ' + fmtBytes(d.size) + (d.media && d.media !== 'Unspecified' ? ' · ' + d.media : '')),
            h('span' + (ssd ? '.ok-text' : '.muted'), ssd ? 'SSD сам стирает удалённое (TRIM) — затирать обычно не нужно, это только износит диск.' : 'Для HDD затирание реально помогает против восстановления.')),
          h('button.key.key--sm' + (ssd ? '' : '.key--snow'), { type: 'button', onclick: () => wipe(d, ssd) }, 'Затереть свободное место')));
      });
    }
    async function wipe(d, ssd) {
      const ok = await confirmBox({ kicker: 'Долгая операция', title: 'Затереть свободное место на ' + d.letter + ':?', ok: 'Запустить', body: [
        h('p', 'Откроется окно Windows с командой cipher /w:' + d.letter + ':\\ — она по очереди запишет нули, единицы и случайные байты во всё свободное место (' + fmtBytes(d.free) + '). Файлы не пострадают.'),
        ssd ? h('p.warn', 'Это SSD: польза небольшая, а диск получит лишние циклы записи.') : null,
        h('p.muted', 'Пока идёт затирание, место на диске временно заканчивается — не запускай в это время большие загрузки. Чтобы прервать, просто закрой окно.')] });
      if (!ok) return;
      const r = await K.freeSpace(d.letter);
      toast(r.ok ? 'Окно затирания открыто' : (r.err || 'Не получилось'), r.ok ? 'ok' : 'bad');
      if (r.ok) A.refreshStatus();
    }
    drives();
    return s;
  }

  /* ---------- след в интернете ---------- */
  function linkCard(x) {
    return h('article.plate.mini-card', h('b', x.name), h('p.muted', x.text), x.url ? h('button.key.key--sm.key--snow', { type: 'button', onclick: () => K.link(x.url) }, 'Открыть ↗') : null);
  }
  function accounts() {
    const done = store.get('kx.deleted', {});
    const filter = h('input.field.grow', { type: 'search', placeholder: 'найти сервис', spellcheck: 'false' });
    const grid = h('div.svc-grid'), meterBar = h('i'), meterText = h('span.k');
    function draw() {
      const q = filter.value.trim().toLowerCase(), n = Object.keys(done).length;
      meterBar.style.width = (n / D.services.length * 100) + '%'; meterText.textContent = 'отмечено удалённых: ' + n + ' из ' + D.services.length;
      grid.textContent = '';
      D.services.filter((x) => !q || x.name.toLowerCase().includes(q) || x.cat.includes(q)).forEach((x) => grid.append(h('article.plate.svc' + (done[x.id] ? '.is-done' : ''),
        h('div.svc__top', h('b', x.name), h('span.pill', x.cat)),
        x.hint ? h('p.muted', x.hint) : null,
        h('div.row', x.url ? h('button.key.key--sm.key--snow', { type: 'button', onclick: () => K.link(x.url) }, 'Удалить на сайте ↗') : h('span.chk__note', 'только в приложении'),
          h('button.key.key--sm', { type: 'button', onclick: () => { if (done[x.id]) delete done[x.id]; else { done[x.id] = new Date().toISOString(); A.pulse(); } store.set('kx.deleted', done); draw(); } }, done[x.id] ? '✓ ' + fmtDate(done[x.id]) : 'Удалил')))));
    }
    filter.addEventListener('input', draw); draw();
    return h('div.stack',
      h('article.plate.tool', h('div.tool__head', h('b', 'Забытые аккаунты'), h('span', 'каждый — будущая строка в чужой утечке')),
        h('p.muted', 'Открой страницу удаления, подтверди на сайте и отметь здесь. Перед удалением можно скачать свои данные — ссылка обычно рядом. Отметки хранятся только на этом компьютере.'),
        h('div.row', filter), h('div.gauge', meterBar), meterText),
      grid,
      h('p.plate__title', 'Где найти забытые регистрации'), h('div.grid3', D.finders.map(linkCard)));
  }
  function searchTab(goLetter) {
    return h('div.stack',
      h('div.grid2', D.search.map(linkCard)),
      h('article.plate.tool', h('div.tool__head', h('b', 'Право на забвение в России'), h('span', 'ст. 10.3 · 149-ФЗ')), h('p', D.rtbfRu),
        h('div.row', h('button.key.key--snow', { type: 'button', onclick: () => goLetter('rtbf') }, 'Подготовить заявление'))));
  }
  function letterTab(start) {
    const KINDS = [['ru', 'Компании в России · 152-ФЗ'], ['gdpr', 'Компании в ЕС · GDPR'], ['rtbf', 'Поисковику · право на забвение']];
    let kind = start || 'ru';
    const f = {
      company: h('input.field', { placeholder: 'кому: компания или сервис', spellcheck: 'false' }),
      name: h('input.field', { placeholder: 'твои фамилия, имя, отчество', spellcheck: 'false' }),
      contact: h('input.field', { placeholder: 'почта или телефон, привязанные к аккаунту', spellcheck: 'false' }),
      links: h('textarea.field', { rows: '3', placeholder: 'адреса страниц, по одному в строке', spellcheck: 'false' }),
      reason: h('select.field', D.rtbfReasons.map((r) => h('option', { value: r }, r))),
    };
    const tabs = h('div.adv-tabs', { role: 'tablist' }), extra = h('div.stack'), pre = h('pre.letter.selectable');
    const today = () => new Date().toLocaleDateString('ru-RU', { day: '2-digit', month: 'long', year: 'numeric' });
    const todayEn = () => new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
    const text = () => D.letters[kind]({ company: f.company.value.trim(), name: f.name.value.trim(), contact: f.contact.value.trim(), links: f.links.value.trim(), reason: f.reason.value, date: today(), dateEn: todayEn() });
    const paint = () => { pre.textContent = text(); };
    function drawTabs() {
      tabs.textContent = '';
      KINDS.forEach(([id, name]) => tabs.append(h('button', { role: 'tab', type: 'button', 'aria-selected': kind === id ? 'true' : 'false', onclick: () => { kind = id; drawTabs(); } }, name)));
      extra.textContent = '';
      if (kind === 'rtbf') extra.append(f.links, f.reason);
      f.company.placeholder = kind === 'rtbf' ? 'поисковик: Яндекс или Google' : 'кому: компания или сервис';
      paint();
    }
    Object.values(f).forEach((el) => el.addEventListener('input', paint));
    f.reason.addEventListener('change', paint);
    drawTabs();
    return h('div.stack',
      h('article.plate.tool', h('div.tool__head', h('b', 'Требование удалить данные'), h('span', 'текст никуда не отправляется')),
        tabs, h('div.grid2', f.company, f.name), f.contact, extra,
        h('div.row', h('button.key.key--accent', { type: 'button', onclick: async () => { await K.copyText(text()); toast('Текст скопирован — вставь его в письмо или форму сервиса'); } }, 'Скопировать текст')),
        h('p.muted', 'Куда отправлять: адрес для обращений по персональным данным указан в политике конфиденциальности сервиса. Пиши с той почты, что привязана к аккаунту, и сохрани ответ — он пригодится для жалобы в Роскомнадзор или европейский надзорный орган, если компания промолчит.')),
      h('article.plate', pre));
  }
  function activityTab() { return h('div.grid2', D.activity.map(linkCard)); }

  function footprint(opts) {
    const s = h('section.screen', head(['Стирание', 'аккаунты · поиск · требования'], 'Стереть себя', 'из сети',
      'Самые большие копии твоих данных хранятся не на компьютере, а на серверах сервисов. Удали забытые аккаунты, убери себя из поиска и потребуй у компаний уничтожить данные — по закону они обязаны ответить.'));
    const TABS = [['accounts', 'Аккаунты'], ['search', 'Поисковики'], ['letter', 'Требование об удалении'], ['activity', 'История в сервисах']];
    let cur = (opts && opts.tab) || 'accounts', letterKind = opts && opts.kind;
    const tabs = h('div.adv-tabs.tabs-lg', { role: 'tablist' }), body = h('div');
    const goLetter = (k) => { letterKind = k; cur = 'letter'; draw(); };
    function draw() {
      tabs.textContent = '';
      TABS.forEach(([id, name]) => tabs.append(h('button', { role: 'tab', type: 'button', 'aria-selected': cur === id ? 'true' : 'false', onclick: () => { cur = id; draw(); } }, name)));
      body.textContent = '';
      body.append(cur === 'accounts' ? accounts() : cur === 'search' ? searchTab(goLetter) : cur === 'letter' ? letterTab(letterKind) : activityTab());
    }
    draw();
    s.append(tabs, body);
    return s;
  }

  Object.assign(window.TOOLS, { traces, shredder, footprint });
})();
