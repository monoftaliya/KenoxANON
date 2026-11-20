/* Страж: фоновая защита — настройки, состояние и события. */
(function () {
  'use strict';
  const { h, toast, fmtBytes, fmtDate } = window.UI;
  const A = window.APP = window.APP || {};
  const head = window.VIEWS.head;
  const K = window.kenox;
  const sw = (on, label, cb, note) => {
    const i = h('input', { type: 'checkbox' }); i.checked = !!on;
    i.addEventListener('change', () => cb(i.checked));
    return h('label.switch.gsw', i, h('i'), h('span', label, note ? h('small.muted.block', note) : null));
  };
  const tabs = (list, cur, cb) => h('div.adv-tabs', { role: 'tablist' }, list.map(([v, name]) => h('button', { type: 'button', role: 'tab', 'aria-selected': cur === v ? 'true' : 'false', onclick: () => cb(v) }, name)));
  const KIND = { worse: 'var(--t-trace)', live: 'var(--t-device)', clean: 'var(--t-super)', check: 'var(--t-net)', week: 'var(--t-browser)', on: 'var(--t-net)', off: 'var(--fog)' };

  function guard() {
    const s = h('section.screen', head(['Страж', 'фоновая защита'], 'Страж', 'охраняет',
      'Работает, даже когда окно закрыто: проверяет систему по расписанию и пишет только об ухудшениях, сам стирает выбранные следы, предупреждает о камере и микрофоне и раз в неделю присылает сводку. Значок — у часов на панели задач.'));
    const body = h('div.stack'); s.append(body);
    let st = null;
    const set = async (patch, msg) => { st = await K.guardSet(patch); A.guardWatch = st.cfg.on && st.cfg.watch; if (msg) toast(msg); draw(); A.refreshStatus(); };
    function draw() {
      if (!s.isConnected) return;
      const c = st.cfg; body.textContent = '';
      const next = c.check === 'off' || !st.lastCheck ? null : new Date(new Date(st.lastCheck.ts).getTime() + (c.check === 'week' ? 7 : 1) * 864e5);
      body.append(h('article.plate.ghero' + (c.on ? '.is-on' : ''),
        h('div.ghero__main',
          h('b.ghero__state', c.on ? 'Страж охраняет' : 'Страж выключен'),
          h('p.muted', c.on ? 'Значок у часов: оттуда можно открыть окно, проверить систему, стереть следы или заблокировать экран. Крестик окна теперь не закрывает приложение, а прячет его.' : 'Включи, и KenoxANON продолжит работать в фоне после закрытия окна.'),
          h('div.ghero__facts',
            h('span', 'Проверка: ' + (st.lastCheck ? fmtDate(st.lastCheck.ts) + ' · индекс ' + st.lastCheck.score + '%' : 'ещё не было') + (next && c.on ? ' · следующая ' + fmtDate(next.toISOString()) : '')),
            h('span', 'Автоочистка: ' + (st.lastClean ? fmtDate(st.lastClean.ts) + (st.lastClean.freed ? ' · ' + fmtBytes(st.lastClean.freed) : '') : 'ещё не было')))),
        h('div.ghero__keys',
          sw(c.on, c.on ? 'Включён' : 'Выключен', (v) => set({ on: v }, v ? 'Страж включён — значок у часов' : 'Страж выключен')),
          h('button.key.key--snow', { type: 'button', onclick: async (e) => { e.currentTarget.disabled = true; toast('Проверяю систему…', 'warn'); const r = await K.guardCheck(); toast(r.ok ? 'Индекс ' + r.score + '%' + (r.worse && r.worse.length ? ' · хуже: ' + r.worse.join(', ') : ' · ухудшений нет') : r.err, r.ok && !(r.worse && r.worse.length) ? 'ok' : 'warn'); load(); } }, 'Проверить сейчас'),
          h('button.key', { type: 'button', onclick: async () => { const r = await K.guardClean(); toast(r.ok ? 'Стёрто: ' + r.done + (r.freed ? ' · ' + fmtBytes(r.freed) : '') : r.err, r.ok ? 'ok' : 'warn'); A.pulse(); load(); } }, 'Стереть следы сейчас'))));

      const grid = h('div.grid2');
      grid.append(
        h('article.plate.tool', h('div.tool__head', h('b', 'Проверка системы'), h('span', 'сообщает только об ухудшениях')),
          tabs([['day', 'Каждый день'], ['week', 'Каждую неделю'], ['off', 'Не проверять']], c.check, (v) => set({ check: v })),
          h('p.muted', 'Если обновление Windows выключит брандмауэр или вернёт рекламный ID, придёт уведомление со списком того, что стало хуже.')),
        h('article.plate.tool', h('div.tool__head', h('b', 'Камера и микрофон'), h('span', 'уведомление сразу')),
          sw(c.watch, 'Сообщать, когда программа включает камеру, микрофон или геопозицию', (v) => set({ watch: v })),
          h('p.muted', 'Страж смотрит в журнал доступа Windows каждые 20 секунд.')),
        h('article.plate.tool', h('div.tool__head', h('b', 'Запуск вместе с Windows'), h('span', st.login ? 'включён' : 'выключен')),
          sw(c.autostart, 'Запускать Стража при входе в Windows', (v) => set({ autostart: v }, v ? 'Страж будет запускаться незаметно, значком у часов' : 'Автозапуск выключен'), 'окно не открывается — только значок у часов')),
        h('article.plate.tool', h('div.tool__head', h('b', 'Сводка за неделю'), h('span', 'проверок ' + st.week.checks + ' · стёрто ' + fmtBytes(st.week.cleaned) + ' · камера ' + st.week.live)),
          sw(c.weekly, 'Раз в неделю присылать итоги одним уведомлением', (v) => set({ weekly: v }))));
      body.append(grid);

      const ids = new Set(c.clean.ids);
      body.append(h('article.plate.tool', h('div.tool__head', h('b', 'Автоочистка'), h('span', 'стирает сама, без вопросов')),
        h('div.gclean', st.traces.map((t) => sw(ids.has(t.id), t.title, (v) => { if (v) ids.add(t.id); else ids.delete(t.id); set({ clean: { ids: [...ids] } }); }))),
        h('div.row.gap-lg',
          sw(c.clean.onStart, 'При запуске компьютера', (v) => set({ clean: { onStart: v } })),
          h('span.k', 'По расписанию'),
          tabs([[0, 'Выкл'], [1, 'Каждый час'], [6, 'Каждые 6 часов'], [24, 'Раз в сутки']], c.clean.every, (v) => set({ clean: { every: v } }))),
        h('p.muted', 'Корзина очищается целиком, поэтому по умолчанию не отмечена. Telegram, Discord и Prefetch сюда не входят: их кэш занят, пока программы открыты, а Prefetch требует прав администратора.')));

      // автопилот фото: правит файлы на месте — поэтому включение только после подтверждения
      const ph = c.photos || { on: false, mode: 'gps' }, pinfo = st.photos || { folders: [], cleaned: 0 };
      body.append(h('article.plate.tool', h('div.tool__head', h('b', 'Автопилот фото и записей'), h('span', ph.on ? 'включён · очищено ' + pinfo.cleaned : 'выключен')),
        sw(ph.on, 'Сам стирать данные из новых фото и аудио', async (v) => {
          if (v && !(await window.UI.confirmBox({ kicker: 'Автопилот фото', title: 'Чистить новые файлы автоматически?', ok: 'Включить', body: [
            window.UI.h('p', 'Страж будет следить за папками:'), window.UI.h('ul', pinfo.folders.map((d) => window.UI.h('li', d))),
            window.UI.h('p', 'В каждом новом снимке (JPEG, PNG, HEIC, AVIF, WebP) и записи (MP3, M4A, FLAC) он сотрёт ' + (ph.mode === 'all' ? 'все метаданные' : 'место съёмки') + ' прямо в файле, без копии. Картинка и звук не меняются.'),
            window.UI.h('p.muted', 'Работает, пока включён Страж. Старые файлы не трогаются — для них есть «Двойник» и «Метаданные».')] }))) { draw(); return; }
          set({ photos: { on: v } }, v ? 'Автопилот фото включён' : 'Автопилот фото выключен');
        }, 'нужен включённый Страж'),
        tabs([['gps', 'Только место съёмки'], ['all', 'Все метаданные']], ph.mode, (v) => set({ photos: { mode: v } })),
        h('p.muted', 'Папки: ' + (pinfo.folders.join(' · ') || 'не найдены') + '. Новый файл чистится через пару секунд после того, как докачается.')));

      body.append(h('article.plate.tool', h('div.tool__head', h('b', 'События'), h('span', st.events.length ? 'последние ' + st.events.length : 'пока пусто')),
        st.events.length ? h('div.gevents', st.events.map((e) => h('div.gevent', { style: { '--c': KIND[e.kind] || 'var(--fog)' } }, h('span.muted', fmtDate(e.ts)), h('span', e.text)))) : h('p.muted', 'Здесь появятся проверки, очистки и срабатывания камеры и микрофона.')));
    }
    async function load() { st = await K.guardStatus(); draw(); }
    const off = K.onGuardChanged(() => { if (s.isConnected) load(); else off(); });
    load();
    return s;
  }

  Object.assign(window.TOOLS, { guard });
})();
