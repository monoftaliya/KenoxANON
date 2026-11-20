/* «Проверить всё»: одна кнопка — проверка системы, «Двойник» по своим папкам, следы Windows, запросы на удаление, Страж
   и (по желанию) поиск номера. Итог — один отчёт: что нашлось и кнопка, которая это исправляет. Без спроса ничего не стирается. */
(function () {
  'use strict';
  const { h, toast, confirmBox, plural, fmtBytes } = window.UI;
  const A = window.APP = window.APP || {};
  const K = window.kenox;
  let openNow = null;
  const toUtil = (id) => { if (A.go) A.go('utils', { open: id }); };

  function show() {
    if (openNow) return;
    if (A.closeSheet) A.closeSheet();
    const chk = (label, on) => { const i = h('input', { type: 'checkbox' }); i.checked = on; return { i, el: h('label.ucopy', i, h('span', label)) }; };
    const o = { sys: chk('Настройки Windows — индекс невидимости', true), twin: chk('«Двойник»: что видно по моим фото и документам (Изображения, Рабочий стол, Загрузки, Документы)', true),
      traces: chk('Следы в Windows: недавние файлы, временные файлы, кэш и прочее', true), more: chk('Запросы на удаление и Страж', true) };
    const phone = h('input.field.uphone', { type: 'tel', placeholder: 'номер — по желанию', spellcheck: 'false', autocomplete: 'off', maxlength: '40', 'aria-label': 'Номер телефона' });
    const go = h('button.key.key--accent', { type: 'button', onclick: () => run() }, 'Проверить всё');
    const steps = h('div.stack'), out = h('div.stack');
    const x = h('button.vbtn.usheet__x', { type: 'button', title: 'Закрыть (Esc)', 'aria-label': 'Закрыть' }, '✕');
    const panel = h('div.usheet__panel.ucall', { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Проверить всё', tabindex: '-1', style: { '--c': 'var(--acc)' } },
      h('div.usheet__top', h('span.unum', 'ALL'), h('span.k', 'одна кнопка'), x),
      h('h2.usheet__title', 'Проверить всё'),
      h('p.usheet__lead', 'Приложение по очереди проверит систему, твои файлы, следы в Windows и запросы на удаление — и соберёт один отчёт: что нашлось и что исправить одной кнопкой.'),
      h('div.urisk.urisk--ok', h('i'), h('b', 'только проверяет'), h('span', 'Проверка ничего не меняет. Исправления — отдельными кнопками в отчёте, и перед каждым будет подтверждение.')),
      h('article.plate.uform', h('b', 'Что проверить'), o.sys.el, o.twin.el, o.traces.el, o.more.el,
        h('div.row', phone, h('span.muted', 'если указать номер, приложение поищет его в интернете (около минуты)')), h('div.row', go)),
      steps, out);
    const el = h('div.usheet', panel);
    const onKey = (e) => { if (e.key === 'Escape' && document.getElementById('modal').hidden) close(); };
    function close() { document.removeEventListener('keydown', onKey); el.remove(); openNow = null; if (A.closeSheet === close) A.closeSheet = null; }
    x.addEventListener('click', close); el.addEventListener('mousedown', (e) => { if (e.target === el) close(); });
    document.addEventListener('keydown', onKey); document.body.append(el); openNow = close; A.closeSheet = close; panel.focus({ preventScroll: true });

    const line = (name) => { const st = h('span.unote', 'жду'), row = h('div.ucall__step', h('b', name), st); steps.append(row); return (t, tone) => { st.textContent = t; st.className = 'unote' + (tone ? ' unote--' + tone : ''); }; };
    async function run() {
      go.disabled = true; steps.replaceChildren(); out.replaceChildren();
      const found = [];   // { title, text, tone, actions[] }
      const btn = (label, fn, accent) => h('button.key.key--sm' + (accent ? '.key--accent' : ''), { type: 'button', onclick: fn }, label);
      if (o.sys.i.checked) {
        const s = line('Настройки Windows'); s('проверяю…');
        const r = A.refresh ? await A.refresh(false) : await K.audit();
        if (r && r.ok) {
          const bad = (r.items || []).filter((i) => i.good === false), quick = bad.filter((i) => i.fix && i.fix.kind === 'reg');
          s('индекс ' + r.score + '% · проблем: ' + bad.length, bad.length ? 'due' : 'ok');
          if (bad.length) found.push({ title: 'Настройки Windows: ' + bad.length + ' ' + plural(bad.length, 'проблема', 'проблемы', 'проблем'), text: (quick.length ? quick.length + ' можно исправить сразу, без прав администратора и с откатом. ' : '') + 'Первые: ' + bad.slice(0, 3).map((i) => i.title).join(', ') + '.', actions: [btn('Открыть «Обзор» и исправить', () => { close(); A.go('overview'); }, true)] });
        } else s('не удалось', 'due');
      }
      if (o.twin.i.checked) {
        const s = line('«Двойник» по твоим файлам'); s('смотрю файлы…');
        const off = K.onTwinProgress((p) => s(p.phase === 'photo' ? 'фото ' + p.done + ' из ' + p.total : p.phase === 'doc' ? 'документы ' + p.done + ' из ' + p.total : p.phase === 'files' ? 'файлов ' + p.done : 'система…'));
        let r; try { const d = await K.twinDefaults(); r = await K.twinScan(d.folders || []); } finally { off(); }
        if (r && r.ok) {
          const f = r.findings.filter((x) => x.found);
          s('узнаёт тебя на ' + r.score + '% · фото с местом съёмки: ' + r.stats.gps, r.score >= 30 || r.stats.gps ? 'due' : 'ok');
          if (r.stats.gps) found.push({ title: 'Место съёмки в ' + r.stats.gps + ' ' + plural(r.stats.gps, 'фото', 'фото', 'фото'), text: 'По этим снимкам видно, где ты живёшь и бываешь. Кнопка сотрёт только координаты прямо в файлах — снимки не изменятся.',
            actions: [btn('Стереть место съёмки из всех', async (e) => {
              if (!(await confirmBox({ kicker: 'Двойник', title: 'Стереть координаты из ' + r.stats.gps + ' фото?', ok: 'Стереть', body: [h('p', 'Координаты будут удалены из самих файлов, без копий. Картинки не изменятся.')] }))) return;
              e.currentTarget.disabled = true; const x = await K.twinFix('gps'); toast(x.ok ? 'Стёрто из ' + x.done + ' фото' : x.err, x.ok ? 'ok' : 'bad'); }, true)] });
          if (f.length) found.push({ title: '«Двойник»: ' + f.length + ' ' + plural(f.length, 'вывод', 'вывода', 'выводов') + ' о тебе', text: f.slice(0, 4).map((x) => x.title).join(', ') + '.', actions: [btn('Открыть «Двойник»', () => { close(); A.go('twin'); })] });
        } else s((r && r.err) || 'не удалось', 'due');
      }
      if (o.traces.i.checked) {
        const s = line('Следы в Windows'); s('считаю…');
        const r = await K.tracesScan();
        if (r && r.ok) {
          const safe = r.items.filter((i) => i.safe && !i.admin && !i.running && ((i.size || 0) > 0 || (i.count || 0) > 0)), bytes = safe.reduce((a, i) => a + (i.size || 0), 0);
          s(safe.length ? 'можно стереть: ' + safe.length + (bytes ? ' · ' + fmtBytes(bytes) : '') : 'чисто', safe.length ? 'due' : 'ok');
          if (safe.length) found.push({ title: 'Следы в Windows: ' + safe.map((i) => i.title.toLowerCase()).slice(0, 4).join(', ') + (safe.length > 4 ? '…' : ''), text: 'Это то, что безопасно стирать: программы и файлы не пострадают.',
            actions: [btn('Стереть безопасные следы', async (e) => {
              if (!(await confirmBox({ kicker: 'Следы в Windows', title: 'Стереть ' + safe.length + ' ' + plural(safe.length, 'вид', 'вида', 'видов') + ' следов?', ok: 'Стереть', danger: true, body: [h('ul', safe.map((i) => h('li', i.title))), h('p', 'Стёртое не вернуть. Программы и личные файлы не затрагиваются.')] }))) return;
              e.currentTarget.disabled = true; const x = await K.tracesClean(safe.map((i) => i.id)); const n = ((x && x.results) || []).filter((y) => y.ok).length; toast('Стёрто: ' + n + ' из ' + safe.length, n ? 'ok' : 'warn'); if (A.pulse) A.pulse(); }, true), btn('Подробнее', () => { close(); A.go('traces'); })] });
        } else s('не удалось', 'due');
      }
      if (o.more.i.checked) {
        const s = line('Запросы на удаление'); const u = await K.utilGet(); const today = new Date().toISOString().slice(0, 10);
        const over = ((u && u.requests) || []).filter((q) => q.status === 'sent' && q.deadline < today);
        s(over.length ? 'просрочено: ' + over.length : 'просрочек нет', over.length ? 'due' : 'ok');
        if (over.length) found.push({ title: 'Компании не ответили в срок: ' + over.length, text: over.slice(0, 3).map((q) => q.to).join(', ') + '. Для них готова жалоба или повторное письмо.', actions: [btn('Открыть трекер', () => toUtil('u05'), true)] });
        const g = line('Страж'); const st = await K.guardStatus();
        const on = st && st.cfg && st.cfg.on, ph = on && st.cfg.photos && st.cfg.photos.on;
        g(on ? (ph ? 'охраняет, автопилот фото включён' : 'охраняет, автопилот фото выключен') : 'выключен', on && ph ? 'ok' : 'due');
        if (!on || !ph) found.push({ title: on ? 'Автопилот фото выключен' : 'Страж выключен', text: 'Страж в фоне проверяет систему, стирает следы по расписанию и может сам стирать место съёмки из новых фото.', actions: [btn('Открыть «Страж»', () => { close(); A.go('guard'); }, true)] });
      }
      if (phone.value.trim()) {
        const s = line('Номер в интернете'); s('ищу…');
        const off = K.onPhoneProgress((p) => s(p.stage === 'search' ? 'поиск ' + p.i + ' из ' + p.n : 'проверяю страницы ' + p.done + ' из ' + p.total));
        let r; try { r = await K.phoneFind(phone.value.trim()); } finally { off(); }
        if (r && r.ok) {
          s(r.found.length ? 'найден на ' + r.found.length + ' ' + plural(r.found.length, 'странице', 'страницах', 'страницах') : r.captcha ? 'DuckDuckGo попросил капчу' : 'не найден', r.found.length || r.captcha ? 'due' : 'ok');
          if (r.found.length) found.push({ title: 'Номер найден на ' + r.found.length + ' ' + plural(r.found.length, 'странице', 'страницах', 'страницах'), text: r.found.slice(0, 3).map((x) => x.site).join(', ') + '. Там же — как убрать и письма в определители одной кнопкой.', actions: [btn('Открыть результаты', () => toUtil('u01'), true), btn('Удалить из баз одной кнопкой', () => toUtil('u02'))] });
        } else s((r && r.err) || 'не удалось', 'due');
      }
      go.disabled = false; go.textContent = 'Проверить заново';
      out.replaceChildren(h('div.ucheck.urisk--' + (found.length ? 'warn' : 'ok'), h('b', found.length ? 'Что исправить: ' + found.length : 'Всё в порядке'), h('span', found.length ? 'Ниже — что нашлось и кнопки, которые это исправляют. Перед каждым изменением будет подтверждение.' : 'По выбранным проверкам ничего исправлять не нужно.')),
        ...found.map((f) => h('article.urow', h('div.urow__main', h('b', f.title), h('p', f.text)), h('div.urow__act', h('div.row', f.actions)))));
      if (A.pulse) A.pulse();
    }
  }
  window.CHECK_ALL = { open: show };
})();
