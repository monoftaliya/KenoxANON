/* Утилиты: небольшие помощники для конкретных дел. Список с поиском; у каждой утилиты — окно:
   сначала справка (что делает, как пользоваться, что произойдёт), потом кнопки действий.
   Готовые утилиты описаны в IMPL ниже, остальные помечены «скоро» и открываются со справкой о том, что будут уметь. */
(function () {
  'use strict';
  const { h, toast, confirmBox, plural } = window.UI;
  const A = window.APP = window.APP || {};
  const head = window.VIEWS.head;
  const K = window.kenox;
  const D = window.UTILS;
  const CAT = Object.fromEntries(D.cats.map((c) => [c.id, c]));
  const READY = D.list.filter((u) => u.ready).length;

  const norm = (s) => String(s || '').toLowerCase().replace(/ё/g, 'е');
  const pad = (n) => String(n).padStart(2, '0');
  const num = (n) => '#' + pad(n);
  const ymd = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const ru = (s) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || '')); return m ? m[3] + '.' + m[2] + '.' + m[1] : ''; };
  const daysTo = (s) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || '')); if (!m) return 0; const a = new Date(+m[1], +m[2] - 1, +m[3]), b = new Date(); b.setHours(0, 0, 0, 0); return Math.round((a - b) / 864e5); };
  const dn = (n) => n + ' ' + plural(n, 'день', 'дня', 'дней');
  let store = { marks: {}, requests: [] };   // отметки и запросы из main/utils.js

  /* ---------- общие кусочки для готовых утилит ---------- */
  const seg = (opts, value, pick) => h('div.useg', { role: 'group' }, opts.map(([v, label]) => h('button', { type: 'button', 'aria-pressed': value === v ? 'true' : 'false', onclick: () => pick(v) }, label)));
  const link = (label, url, primary) => h('button.key.key--sm' + (primary ? '.key--snow' : ''), { type: 'button', onclick: () => K.link(url) }, label + ' ↗');
  const markOf = (key) => (store.marks && store.marks[key]) || null;
  function markNote(m) {
    if (!m) return null;
    if (m.s === 'sent') return m.check && daysTo(m.check) <= 0 ? h('span.unote.unote--due', 'пора проверить, удалили ли') : h('span.unote', m.check ? 'проверить после ' + ru(m.check) : 'отправлено ' + ru(m.at));
    if (m.s === 'done') return h('span.unote.unote--ok', 'готово · ' + ru(m.at));
    if (m.s === 'none') return h('span.unote', 'тебя там нет');
    if (m.s === 'keep') return h('span.unote', 'оставляю · ' + ru(m.at));
    return null;
  }
  // адрес сайта без поддоменов (mail.vk.com → vk.com) и ключ для отметок
  const siteOf = (host) => { const p = String(host || '').toLowerCase().replace(/^www\./, '').split('.'); if (p.length <= 2) return p.join('.'); const l2 = p.slice(-2).join('.'); return /^(co|com|net|org|ac|gov|edu|or|ne|msk|spb|pp|in|kiev)\.[a-z]{2}$/.test(l2) ? p.slice(-3).join('.') : l2; };
  const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'x';
  // известные сервисы со страницей удаления (из раздела «След в интернете»), по адресу сайта
  const KNOWN = (() => {
    const m = new Map(), E = window.ERASE_DATA, list = (E && E.services) || [];
    list.forEach((s) => { if (!s.url) return; try { m.set(siteOf(new URL(s.url).hostname), s); } catch (e) { /* без адреса */ } });
    [['microsoft.com', 'microsoft'], ['outlook.com', 'microsoft'], ['twitter.com', 'x'], ['facebookmail.com', 'facebook'], ['steamcommunity.com', 'steam'], ['youtube.com', 'google'], ['google.ru', 'google'], ['vk.ru', 'vk'], ['vkontakte.ru', 'vk'], ['yandex.com', 'yandex'], ['ya.ru', 'yandex']]
      .forEach(([d, id]) => { const s = list.find((x) => x.id === id); if (s && !m.has(d)) m.set(d, s); });
    return m;
  })();
  const toSearch = (q) => { if (A.go) A.go('search', { q }); };

  /* ---------- выгрузка почты: общая для «Забытых аккаунтов» и «Отписки от рассылок», живёт только в памяти окна ---------- */
  let mailRes = null;
  const MAILHELP = [
    h('p', h('b', 'Gmail. '), 'Открой takeout.google.com, нажми «Отменить выбор», отметь только «Почта», формат — MBOX. Скачай архив, распакуй и выбери файл .mbox внутри.'),
    h('p', h('b', 'Яндекс Почта, Mail.ru и другие. '), 'Подключи ящик в почтовой программе Thunderbird. Папки почты она хранит файлами без расширения (Входящие — это файл INBOX в папке профиля Thunderbird). Можно выбрать такой файл. Другой вариант — выдели письма и сохрани их как .eml в отдельную папку.'),
    h('p', h('b', 'Outlook. '), 'Файлы .pst не читаются — подключи ящик в Thunderbird или сохрани письма в .eml.'),
    h('p.muted', 'После работы удали выгрузку шредером: в ней вся твоя переписка.'),
  ];
  function mailPicker(onDone) {
    const status = h('p.muted.umail__status'), b1 = h('button.key.key--snow', { type: 'button', onclick: async () => go(await K.pickMail(false)) }, 'Выбрать файл .mbox');
    const drop = h('div.plate.drop.umail', h('b', 'Перетащи сюда выгрузку почты'), h('span.muted', 'файл .mbox (Google Takeout, Thunderbird) или папку с письмами .eml'),
      h('div.row', b1, h('button.key', { type: 'button', onclick: async () => go(await K.pickMail(true)) }, 'Выбрать папку с .eml')), status);
    drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('is-over'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('is-over'));
    drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('is-over'); const f = e.dataTransfer.files[0]; let p = ''; try { p = f ? K.pathOf(f) : ''; } catch (err) { p = ''; } go(p); });
    let busy = false;
    async function go(p) {
      if (!p || busy) return;
      busy = true; status.classList.remove('is-bad'); status.textContent = 'Читаю заголовки писем…';
      const off = K.onMailProgress((x) => { status.textContent = x.files ? 'Прочитано писем: ' + x.done + ' из ' + x.total : 'Прочитано ' + Math.round(x.done / Math.max(1, x.total) * 100) + '% · писем: ' + x.messages; });
      let r; try { r = await K.mailScan(p); } finally { off(); busy = false; }
      if (!r || !r.ok) { status.textContent = (r && r.err) || 'Не получилось прочитать'; status.classList.add('is-bad'); return; }
      mailRes = r; onDone(r);
    }
    return h('div.stack', drop, h('details.plate.uhelp', h('summary', 'Где взять выгрузку почты'), MAILHELP.map((n) => n.cloneNode(true))));
  }
  const mailSummary = (r, extra) => h('div.ucheck.urisk--ok', h('b', extra), h('span', 'Прочитано писем: ' + r.messages + ' · отправителей: ' + r.senders + ' · заняло ' + (r.ms < 1000 ? 'меньше секунды' : (r.ms / 1000).toFixed(1) + ' с') + '. Читались только заголовки — тексты писем не открывались.'));
  const who = (x) => (x.name && x.name.toLowerCase() !== x.site ? x.name + ' · ' : '') + x.site;

  /* ---------- #06 «что обо мне знают»: запрос на доступ к своим данным ---------- */
  const ACCESS = {
    152: (f) => [f.company || '[кому: название компании]', 'от ' + (f.name || '[фамилия, имя, отчество]'), f.contact || '[почта или телефон, привязанные к аккаунту]', '',
      'ЗАПРОС', 'субъекта персональных данных о предоставлении сведений об обработке его персональных данных', '',
      'В соответствии с частью 7 статьи 14 Федерального закона от 27.07.2006 № 152-ФЗ «О персональных данных» прошу сообщить:',
      '1) обрабатываете ли вы мои персональные данные и какие именно, а также источник их получения;', '2) правовые основания и цели обработки;', '3) способы обработки, сроки обработки и хранения;',
      '4) каким лицам мои данные раскрыты или могут быть раскрыты, в том числе передаются ли они за границу;', '5) наименование и адрес лица, которое обрабатывает мои данные по вашему поручению, если такое есть.', '',
      'Для идентификации: ' + (f.contact || '[почта или телефон аккаунта]') + (f.account ? ', аккаунт: ' + f.account : '') + '.' + (f.passport ? ' Паспорт: ' + f.passport + '.' : ''),
      'Ответ прошу направить в течение 10 рабочих дней (часть 1 статьи 20 Федерального закона № 152-ФЗ) на адрес: ' + (f.contact || '[почта для ответа]') + '.', '',
      new Date().toLocaleDateString('ru-RU', { day: '2-digit', month: 'long', year: 'numeric' }) + '                  ________ / ' + (f.name || '[ФИО]')].join('\n'),
    gdpr: (f) => ['To: ' + (f.company || '[company]') + ' — Data Protection Officer', 'Subject: Data subject access request (Article 15 GDPR)', '',
      'I am making a subject access request under Article 15 of the General Data Protection Regulation. Please provide:',
      '1. confirmation of whether you process my personal data and a copy of that data;', '2. the purposes of the processing and the categories of personal data concerned;',
      '3. the recipients to whom my data has been or will be disclosed, including recipients in third countries;', '4. the retention period, or the criteria used to determine it;',
      '5. the source of the data, if it was not collected from me;', '6. whether you use automated decision-making, including profiling, and meaningful information about the logic involved.', '',
      'To identify me: ' + (f.contact || '[email or phone linked to my account]') + (f.account ? ', account: ' + f.account : '') + '.',
      'Please respond within one month of receipt, as required by Article 12(3) GDPR.', '', f.name || '[your full name]', new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })].join('\n'),
  };
  /* ---------- #09 объявления и резюме ---------- */
  const ADS = [
    { id: 'avito', name: 'Авито', what: 'объявления с телефоном и фото, отзывы', url: 'https://www.avito.ru/profile', steps: ['«Мои объявления»: сними объявления и удали их, в том числе из архива.', 'Если аккаунт не нужен: профиль → «Настройки» → удаление профиля.'] },
    { id: 'youla', name: 'Юла', what: 'объявления с телефоном и фото', url: 'https://youla.ru/', steps: ['Профиль → мои объявления: удали объявления.', 'Настройки профиля → удаление. Юла входит в VK, вход через VK ID.'] },
    { id: 'hh', name: 'hh.ru', what: 'резюме: ФИО, телефон, почта, места работы, фото', url: 'https://hh.ru/applicant/resumes', steps: ['«Мои резюме»: удали старые резюме или скрой их, чтобы их не видел никто.', 'Если аккаунт не нужен — удаление в настройках аккаунта.'] },
    { id: 'superjob', name: 'SuperJob', what: 'резюме с контактами', url: 'https://www.superjob.ru/', steps: ['Раздел с твоими резюме: удали или скрой их.', 'Настройки → удаление учётной записи.'] },
    { id: 'rabotaru', name: 'Работа.ру', what: 'резюме с контактами', url: 'https://www.rabota.ru/', steps: ['«Мои резюме»: удали резюме.', 'Настройки профиля → удаление.'] },
    { id: 'cian', name: 'ЦИАН', what: 'объявления о жилье с телефоном', url: 'https://www.cian.ru/', steps: ['«Мои объявления»: сними и удали, в том числе из архива.', 'Настройки → удаление аккаунта.'] },
    { id: 'autoru', name: 'Авто.ру', what: 'объявления о машинах с телефоном', url: 'https://auto.ru/', steps: ['«Мои объявления»: сними и удали.', 'Аккаунт Авто.ру — это Яндекс ID: можно оставить его без объявлений или удалить вместе с Яндекс ID.'] },
    { id: 'drom', name: 'Дром', what: 'объявления о машинах с телефоном', url: 'https://www.drom.ru/', steps: ['«Мои объявления»: сними и удали.', 'Настройки → удаление аккаунта.'] },
  ];
  /* ---------- #10 аккаунты из 2000-х ---------- */
  const OLD = [
    { id: 'ok', name: 'Одноклассники', url: 'https://ok.ru/regulations', steps: ['Открой «Регламент» и пролистай в самый низ — там ссылка «Отказаться от услуг».', 'Укажи причину и подтверди паролем.'] },
    { id: 'vk', name: 'ВКонтакте (старая страница)', url: 'https://vk.com/settings?act=deactivate', steps: ['Войди в старую страницу — доступ восстанавливается по номеру или почте.', 'Удали страницу. Какое-то время её ещё можно восстановить — не заходи в неё.'] },
    { id: 'mymail', name: 'Мой Мир (Mail.ru)', url: 'https://my.mail.ru/', steps: ['Войди почтой Mail.ru.', 'В настройках «Моего Мира» удали его. Почта при этом останется.'] },
    { id: 'lj', name: 'Живой Журнал', url: 'https://www.livejournal.com/accountstatus.bml', steps: ['Войди в ЖЖ и открой страницу статуса аккаунта.', 'Выбери «Удалён» и сохрани. Какое-то время журнал можно восстановить, потом он удалится.'] },
    { id: 'liru', name: 'LiveInternet', url: 'https://www.liveinternet.ru/', steps: ['Войди в дневник.', 'В настройках дневника — удаление.'] },
    { id: 'diary', name: 'Дневники (diary.ru)', url: 'https://diary.ru/', steps: ['Войди в дневник.', 'В настройках — удаление дневника и аккаунта.'] },
    { id: 'askfm', name: 'Ask.fm', url: 'https://ask.fm/', steps: ['Войди и открой настройки аккаунта.', 'Внизу — удаление аккаунта. Вопросы и ответы удалятся вместе с ним.', 'Сайт может не открываться из России. Если он недоступен, старые ответы могли остаться в кэше поисковиков — для них есть утилита «Старые страницы в поиске».'] },
    { id: 'blogger', name: 'Blogger (blogspot)', url: 'https://www.blogger.com/', steps: ['Открой блог → «Настройки» → «Удалить блог».', 'Если нужен текст — сначала скачай резервную копию там же.'] },
  ];
  // список сайтов с шагами и отметкой «сделал» — для №09–№15; без адреса — шаги делаются в приложении на телефоне
  function siteList(ctx, group, items) {
    const box = h('div.stack'), walkBox = h('div');
    // мастер «пройти по списку»: по одному сервису за раз, отметка «сделал» ставится сама, следующий сервис открывается сам
    const autoNext = h('input', { type: 'checkbox' }); autoNext.checked = true;
    const isDone = (x) => (markOf(group + ':' + x.id) || {}).s === 'done';
    const openItem = (x) => { if (x.url) K.link(x.url); };
    function walk(k) {
      const todo = items.filter((x) => !isDone(x));
      if (!todo.length) { walkBox.replaceChildren(h('div.ucheck.urisk--ok', h('b', 'Список пройден'), h('span', 'Все пункты отмечены «сделал». Отметки хранятся на этом компьютере.'))); return; }
      const x = items[k] && !isDone(items[k]) ? items[k] : todo[0], pos = todo.indexOf(x);
      const nextOf = () => todo[(pos + 1) % todo.length] === x ? null : todo[(pos + 1) % todo.length];
      walkBox.replaceChildren(h('article.plate.uwalk',
        h('span.uwalk__step', 'Осталось ' + todo.length + ' · сейчас ' + (pos + 1) + '-й'),
        h('b', x.name), x.what ? h('span.urow__what', x.what) : null, h('ol.usteps.usteps--sm', x.steps.map((s) => h('li', s))),
        h('div.row',
          x.url ? link(x.urlLabel || 'Открыть ' + x.name, x.url, true) : h('span.unote', x.where || 'в приложении на телефоне'),
          h('button.key.key--sm.key--accent', { type: 'button', onclick: async () => {
            await ctx.mark(group + ':' + x.id, 'done'); draw();
            const n = items.filter((y) => !isDone(y));
            const nx = n.find((y) => items.indexOf(y) > items.indexOf(x)) || n[0];
            if (nx && autoNext.checked) openItem(nx);
            walk(nx ? items.indexOf(nx) : -1);
          } }, 'Сделал, дальше →'),
          h('button.key.key--sm', { type: 'button', onclick: () => { const nx = nextOf(); walk(nx ? items.indexOf(nx) : k); } }, 'Пропустить'),
          h('button.key.key--sm', { type: 'button', onclick: () => walkBox.replaceChildren(startB) }, 'Закончить')),
        h('label.ucopy', autoNext, h('span', 'После «Сделал» сразу открывать следующий сервис в браузере'))));
    }
    const startB = h('button.key.key--snow', { type: 'button', onclick: () => { const first = items.find((x) => !isDone(x)); walk(first ? items.indexOf(first) : -1); } }, 'Пройти по списку: по одному сервису за раз');
    walkBox.append(startB);
    const draw = () => {
      const done = items.filter((x) => (markOf(group + ':' + x.id) || {}).s === 'done').length;
      box.replaceChildren(h('div.uprog', h('div.gauge', h('i', { style: { width: (done / items.length * 100) + '%' } })), h('span.k', 'сделано ' + done + ' из ' + items.length)), walkBox,
        ...items.map((x) => {
          const m = markOf(group + ':' + x.id);
          return h('article.urow', h('div.urow__main', h('b', x.name), x.what ? h('span.urow__what', x.what) : null, h('ol.usteps.usteps--sm', x.steps.map((s) => h('li', s)))),
            h('div.urow__act', x.url ? link(x.urlLabel || ('Открыть ' + x.name), x.url, true) : h('span.unote.uwhere', x.where || 'в приложении на телефоне'),
              seg([['', 'не сделал'], ['done', 'сделал']], m ? m.s : '', async (v) => { await ctx.mark(group + ':' + x.id, v); draw(); }), markNote(m)));
        }));
    };
    draw();
    return box;
  }
  const listProgress = (group, items) => { const n = items.filter((x) => (markOf(group + ':' + x.id) || {}).s === 'done').length; return n ? 'сделано ' + n + ' из ' + items.length : null; };
  const LIST_STEPS = ['Начни с сервисов, которыми пользуешься чаще всего.', 'Нажми «Открыть» — страница откроется в твоём браузере, войди в аккаунт. Если адреса нет, шаги делаются в приложении на телефоне.',
    'Сделай шаги из карточки и отметь «сделал» — отметка останется на этом компьютере.'];
  /* ---------- #11 записи голоса ассистентов ---------- */
  const WIN = 'Открыть настройку Windows';
  const VOICE = [
    { id: 'google', name: 'Google Ассистент', what: 'голосовые запросы и «Окей, Google»', url: 'https://myactivity.google.com/activitycontrols', steps: [
      'Открой «История приложений и веб-поиска» → «Управление историей» и удали всё за всё время.',
      'Там же сними галочку о сохранении голосовых и аудиозаписей — новые записи хранить не будут.'] },
    { id: 'alice', name: 'Алиса (Яндекс)', what: 'запросы к Алисе в приложениях и на колонках', url: 'https://id.yandex.ru/personal/data', steps: [
      'Яндекс ID → «Данные»: там видно, какие данные хранят сервисы Яндекса, и их можно удалить.',
      'Если у тебя колонка с Алисой — загляни в настройки устройства в приложении «Дом с Алисой».'] },
    { id: 'alexa', name: 'Amazon Alexa', what: 'записи голоса с колонок Echo', url: 'https://www.amazon.com/alexaprivacy', steps: [
      '«Alexa Privacy» → «Review Voice History»: удали всю историю.',
      '«Manage Your Alexa Data»: выбери автоматическое удаление записей.'] },
    { id: 'siri', name: 'Siri (Apple)', what: 'история Siri и диктовки на серверах Apple', where: 'на iPhone, iPad или Mac', steps: [
      'iPhone: «Настройки» → «Siri» → «История Siri и диктовки» → «Удалить историю Siri и диктовки».',
      '«Настройки» → «Конфиденциальность и безопасность» → «Аналитика и улучшения»: выключи «Улучшение Siri и Диктовки».'] },
    { id: 'windows', name: 'Распознавание речи Windows', what: 'голосовой ввод через облако Microsoft', url: 'ms-settings:privacy-speech', urlLabel: WIN, steps: [
      'Выключи «Распознавание голоса в сети»: голос перестанет уходить на серверы Microsoft.'] },
  ];
  /* ---------- #12 история местоположений ---------- */
  const GEO = [
    { id: 'google', name: 'Google — Хронология', what: 'места и маршруты с Android и Google Карт', url: 'https://myactivity.google.com/activitycontrols?settings=location', steps: [
      'Хронология теперь хранится на самом телефоне: Google Карты → фото профиля → «Хронология» → в её настройках удали всю Хронологию.',
      'На открывшейся странице выключи сохранение истории местоположений.',
      'Если включено резервное копирование Хронологии — удали и копию.'] },
    { id: 'apple', name: 'Apple — Важные геопозиции', what: 'места, где ты часто бываешь', where: 'на iPhone', steps: [
      '«Настройки» → «Конфиденциальность и безопасность» → «Службы геолокации» → «Системные службы» → «Важные геопозиции» → «Очистить историю».',
      'Там же выключи «Важные геопозиции», чтобы новые места не записывались.'] },
    { id: 'yandex', name: 'Яндекс', what: 'история Карт, Навигатора и поездок', url: 'https://id.yandex.ru/personal/data', steps: [
      'Яндекс ID → «Данные»: посмотри, что хранят Карты, Навигатор и Go, и удали лишнее.',
      'В Картах и Навигаторе очисти историю поиска и маршрутов в настройках приложения.'] },
    { id: 'windows', name: 'Windows', what: 'журнал расположений этого компьютера', url: 'ms-settings:privacy-location', urlLabel: WIN, steps: [
      '«Журнал расположений» → «Очистить».', 'Если геолокация не нужна, выключи «Службы расположения».'] },
  ];
  /* ---------- #13 рекламный профиль ---------- */
  const ADPROF = [
    { id: 'google', name: 'Google — «Мой Ad Center»', what: 'интересы, возраст и другие сведения, которые приписал тебе Google', url: 'https://myadcenter.google.com/', steps: [
      'Посмотри, что Google о тебе думает: темы, интересы, возраст, семейное положение.', 'Выключи персонализированную рекламу.'] },
    { id: 'yandex', name: 'Яндекс — настройки рекламы', what: 'учёт интересов и местоположения в рекламе', url: 'https://yandex.ru/tune/adv', steps: [
      'Отключи учёт своих интересов и местоположения при показе рекламы.'] },
    { id: 'meta', name: 'Meta — Facebook и Instagram', what: 'интересы и данные от рекламных партнёров', url: 'https://accountscenter.facebook.com/ad_preferences', steps: [
      '«Рекламные предпочтения»: посмотри темы и рекламодателей.', 'В настройках рекламы отключи использование данных о твоих действиях от рекламных партнёров.'] },
    { id: 'microsoft', name: 'Microsoft', what: 'реклама в Bing, MSN и Windows', url: 'https://account.microsoft.com/privacy/ad-settings', steps: [
      'Выключи персонализированную рекламу для своего аккаунта.'] },
    { id: 'windows', name: 'Рекламный ID Windows', what: 'метка, по которой приложения узнают тебя для рекламы', url: 'ms-settings:privacy-general', urlLabel: WIN, steps: [
      'Выключи «Разрешить приложениям показывать персонализированную рекламу с помощью моего рекламного идентификатора».'] },
    { id: 'phone', name: 'Рекламный ID телефона', what: 'та же метка на Android и iPhone', where: 'на телефоне', steps: [
      'Android: «Настройки» → «Google» → «Реклама» → «Удалить рекламный идентификатор».',
      'iPhone: «Настройки» → «Конфиденциальность и безопасность» → «Отслеживание»: запрети приложениям запрашивать отслеживание; там же «Реклама от Apple» — выключи персонализированную рекламу.'] },
  ];
  /* ---------- #14 доступ сторонних приложений ---------- */
  const OAUTH = [
    { id: 'google', name: 'Google', what: 'сайты и приложения со входом через Google', url: 'https://myaccount.google.com/connections', steps: ['Открой список сторонних приложений и сервисов и удали доступ всему, чем больше не пользуешься.'] },
    { id: 'yandex', name: 'Яндекс ID', what: 'приложения с доступом к аккаунту Яндекса', url: 'https://id.yandex.ru/security', steps: ['В разделе «Безопасность» найди приложения с доступом к аккаунту и отзови лишние.'] },
    { id: 'vk', name: 'ВКонтакте и VK ID', what: 'сайты и игры со входом через VK', url: 'https://vk.com/settings?act=apps', steps: ['Удали из списка ненужные приложения и сайты.'] },
    { id: 'microsoft', name: 'Microsoft', what: 'приложения с доступом к аккаунту Microsoft', url: 'https://account.live.com/consent/Manage', steps: ['Удали разрешения приложениям, которыми не пользуешься.'] },
    { id: 'apple', name: 'Apple', what: 'приложения со «Входом с Apple»', url: 'https://account.apple.com/', steps: ['«Вход и безопасность» → «Вход с Apple»: прекрати использовать Apple ID в ненужных приложениях.'] },
    { id: 'facebook', name: 'Facebook', what: 'приложения и сайты со входом через Facebook', url: 'https://www.facebook.com/settings?tab=applications', steps: ['Удали ненужные приложения и сайты.'] },
    { id: 'github', name: 'GitHub', what: 'приложения с доступом к коду и аккаунту', url: 'https://github.com/settings/applications', steps: ['На вкладках «Authorized OAuth Apps» и «Authorized GitHub Apps» отзови доступ у лишних (Revoke).'] },
    { id: 'telegram', name: 'Telegram', what: 'сайты со входом через Telegram', where: 'в приложении Telegram', steps: ['«Настройки» → «Устройства» (на компьютере — «Конфиденциальность») → «Активные сайты»: отключи те, которыми не пользуешься.'] },
    { id: 'discord', name: 'Discord', what: 'боты и приложения с доступом к аккаунту', where: 'в приложении Discord', steps: ['«Настройки пользователя» → «Авторизованные приложения»: удали лишние.'] },
  ];
  /* ---------- #16 отметки на чужих фото ---------- */
  const TAGS = [
    { id: 'vk', name: 'ВКонтакте', what: 'фото и видео, где тебя отметили', url: 'https://vk.com/settings?act=privacy', steps: [
      '«Приватность» → «Кто видит фотографии, на которых меня отметили» → «Только я».',
      'Чтобы снять отметку с чужого фото: открой фото, нажми на отметку со своим именем и удали её.'] },
    { id: 'instagram', name: 'Instagram', what: 'публикации с отметкой и упоминания', where: 'в приложении Instagram', steps: [
      '«Настройки» → «Отметки и упоминания»: разреши отмечать тебя только тем, на кого ты подписан, или никому; включи ручное подтверждение отметок.',
      'Чтобы убрать отметку: открой публикацию → нажми на своё имя → «Удалить меня из публикации».'] },
    { id: 'facebook', name: 'Facebook', what: 'отметки на фото и в публикациях', url: 'https://www.facebook.com/settings?tab=profile_and_tagging', steps: [
      'Включи проверку отметок, которые добавляют другие люди, и проверку публикаций с твоей отметкой перед показом в профиле.',
      'Чтобы снять отметку: на фото → «…» → «Удалить отметку».'] },
    { id: 'ok', name: 'Одноклассники', what: 'фото, где тебя отметили друзья', url: 'https://ok.ru/settings', steps: [
      '«Настройки» → «Публичность»: разреши отмечать себя на фото только друзьям или никому.',
      'На чужом фото с отметкой нажми на своё имя и удали отметку.'] },
    { id: 'tiktok', name: 'TikTok', what: 'упоминания и отметки в видео', where: 'в приложении TikTok', steps: [
      '«Настройки и конфиденциальность» → «Конфиденциальность» → «Упоминания и отметки»: ограничь, кто может тебя упоминать и отмечать.'] },
  ];
  /* ---------- #17 обезличить аккаунт ---------- */
  const ADJ = ['tihiy', 'seryy', 'bystryy', 'yasnyy', 'dalniy', 'nochnoy', 'tumannyy', 'lesnoy', 'siniy', 'zimniy', 'zorkiy', 'staryy'];
  const NOUN = ['lis', 'veter', 'kamen', 'sokol', 'klen', 'bereg', 'most', 'fonar', 'kit', 'dozhd', 'sneg', 'pesok'];
  const rnd = (n) => { const a = new Uint32Array(1); crypto.getRandomValues(a); return a[0] % n; };
  const nick = () => ADJ[rnd(ADJ.length)] + '_' + NOUN[rnd(NOUN.length)] + '_' + String(100 + rnd(900));
  const ANON_STEPS = [
    ['Фото профиля и обложка', 'Удали их. Не заменяй своим фото — если без картинки нельзя, подойдёт однотонная.'],
    ['Имя и фамилия', 'Замени на нейтральный ник — кнопка «Придумать ник» выше. Не используй ник, который у тебя есть где-то ещё.'],
    ['Дата рождения, город, школа, работа', 'Удали или скрой. Если дата обязательна — поставь нейтральную, например 1 января.'],
    ['Почта и телефон', 'Почту замени на псевдоним (утилита «Псевдонимы почты»), телефон отвяжи, если сервис позволяет.'],
    ['Посты, комментарии, отзывы, переписка', 'Удали всё, что можно удалить. То, что удалить нельзя, отредактируй — сотри текст.'],
    ['Выход', 'Выйди со всех устройств (утилита «Чужие входы в аккаунты») и больше не входи.'],
  ];
  /* ---------- #18 псевдонимы почты ---------- */
  const ALIASES = [
    { id: 'simplelogin', name: 'SimpleLogin', what: 'бесплатно 10 псевдонимов, сервис принадлежит Proton, открытый код', url: 'https://simplelogin.io/', steps: [
      'Зарегистрируйся и поставь расширение для браузера или приложение — новый псевдоним создаётся одной кнопкой.'] },
    { id: 'addy', name: 'addy.io', what: 'много бесплатных псевдонимов, открытый код', url: 'https://addy.io/', steps: [
      'Зарегистрируйся: псевдонимы на твоём поддомене появляются сами, как только на них придёт первое письмо.'] },
    { id: 'relay', name: 'Firefox Relay', what: 'бесплатно 5 псевдонимов, от Mozilla', url: 'https://relay.firefox.com/', steps: [
      'Войди с аккаунтом Mozilla и поставь дополнение Firefox Relay — кнопка псевдонима появится в полях почты на сайтах.'] },
    { id: 'duck', name: 'DuckDuckGo Email Protection', what: 'бесплатные адреса @duck.com, ещё и вырезает трекеры из писем', url: 'https://duckduckgo.com/email/', steps: [
      'Заведи адрес @duck.com через расширение или приложение DuckDuckGo, дальше создавай одноразовые адреса для каждого сайта.'] },
    { id: 'apple', name: 'Apple «Скрыть e-mail»', what: 'для владельцев iPhone и Mac с подпиской iCloud+', where: 'на iPhone или Mac', steps: [
      '«Настройки» → твоё имя → «iCloud» → «Скрыть e-mail» → «Создать новый адрес».'] },
  ];
  /* ---------- #15 чужие входы в аккаунты ---------- */
  const SESS = [
    { id: 'telegram', name: 'Telegram', what: 'телефоны, компьютеры и веб-версии', where: 'в приложении Telegram', steps: ['«Настройки» → «Устройства»: посмотри список и нажми «Завершить все другие сеансы».', 'Там же можно выбрать, через сколько бездействия сеансы будут завершаться сами.'] },
    { id: 'google', name: 'Google', what: 'все устройства с твоим аккаунтом Google', url: 'https://myaccount.google.com/device-activity', steps: ['Посмотри устройства и выйди из незнакомых.'] },
    { id: 'vk', name: 'ВКонтакте', what: 'входы в VK со всех устройств', url: 'https://vk.com/settings?act=security', steps: ['Посмотри историю активности и заверши все сеансы, кроме текущего.'] },
    { id: 'yandex', name: 'Яндекс ID', what: 'входы в Почту, Диск и другие сервисы Яндекса', url: 'https://id.yandex.ru/security', steps: ['«Безопасность»: посмотри устройства и входы и выбери выход на всех устройствах.'] },
    { id: 'microsoft', name: 'Microsoft', what: 'Outlook, Xbox, Windows и Office', url: 'https://account.live.com/proofs/manage/additional', steps: ['Внизу страницы — выход на всех устройствах. Он может занять до суток.'] },
    { id: 'whatsapp', name: 'WhatsApp', what: 'компьютеры и планшеты, связанные с телефоном', where: 'в приложении WhatsApp', steps: ['«Настройки» → «Связанные устройства»: выйди со всех незнакомых.'] },
    { id: 'instagram', name: 'Instagram', what: 'где выполнен вход в аккаунт', url: 'https://accountscenter.instagram.com/password_and_security/login_activity/', steps: ['«Где вы вошли»: выйди с незнакомых устройств.'] },
    { id: 'steam', name: 'Steam', what: 'компьютеры и телефоны с доступом к Steam', url: 'https://store.steampowered.com/account/authorizeddevices', steps: ['Посмотри авторизованные устройства и выйди со всех других.'] },
    { id: 'discord', name: 'Discord', what: 'устройства со входом в Discord', where: 'в приложении Discord', steps: ['«Настройки пользователя» → «Устройства»: выйди из всех известных устройств.'] },
  ];

  /* ---------- №01–02: номер — общий для поиска и писем, живёт только в памяти окна ---------- */
  const me = { phone: '', name: '' };
  let phoneRes = null, companies = null;
  const openUtil = (id) => { const u = D.list.find((x) => x.id === id); if (u) sheet(u); };
  const secs = (ms) => (ms < 1000 ? 'меньше секунды' : ms < 60000 ? Math.round(ms / 1000) + ' с' : Math.floor(ms / 60000) + ' мин ' + Math.round(ms % 60000 / 1000) + ' с');
  const outBtn = (label, url) => h('button.key.key--sm', { type: 'button', title: url, onclick: () => K.searchOpen(url) }, label + ' ↗');
  // латиница как в загранпаспорте — письма компаниям на английском
  const TR = { а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'i', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'shch', ъ: 'ie', ы: 'y', ь: '', э: 'e', ю: 'iu', я: 'ia' };
  const translit = (s) => String(s || '').replace(/[а-яё]/gi, (ch) => { const l = ch.toLowerCase(), t = TR[l] !== undefined ? TR[l] : ch; return ch === l ? t : t.charAt(0).toUpperCase() + t.slice(1); });
  // что делать с найденной страницей — по типу сайта
  const PGROUPS = [
    ['people', 'Сайты поиска людей', 'Такие сайты продают данные о людях. Удалить — одной кнопкой в утилите «Удалить себя из баз» или через форму удаления на самом сайте.'],
    ['callers', '«Кто звонил» и определители', 'Здесь люди оставляют отзывы о номерах. Внизу страницы обычно есть «Связаться» или «Удалить номер» — попроси убрать страницу или отзыв с твоим номером. Определители — одной кнопкой в «Удалить себя из баз».'],
    ['ads', 'Объявления и резюме', 'Удали объявление или резюме в своём аккаунте, в том числе из архива, — утилита «Объявления и резюме» подскажет, где это сделать. Если это копия на чужом сайте, попроси владельца удалить её.'],
    ['social', 'Соцсети, форумы, отзывы', 'Если пост твой — удали его или убери из него номер. Если чужой — попроси автора удалить номер или пожалуйся модераторам площадки.'],
    ['biz', 'Справочники и компании', 'Если номер стоит в карточке организации — исправь карточку (в 2ГИС и Яндекс Картах есть «Исправить информацию») или попроси сайт убрать номер.'],
    ['other', 'Другие сайты', 'Напиши владельцу сайта и попроси удалить номер — контакты обычно внизу страницы. Готовый текст требования есть в разделе «След в интернете» → «Требование об удалении».'],
  ];
  const PG = Object.fromEntries(PGROUPS.map(([id, name, hint]) => [id, { name, hint }]));
  const HOW = { page: ['номер на странице', 'ok'], code: ['номер в коде страницы', 'mid'], snippet: ['номер в описании поиска', 'mid'] };
  function openReader(url, mode) {
    if (!window.VIEWER) { K.searchOpen(url); return; }
    closeSheet();
    window.VIEWER.open(url, { mode, back: '← К поиску по номеру', onClose: () => openUtil('u01') });
  }
  // открытые базы — сразу «оригиналом»: у них защита от ботов и страницы на JavaScript
  const openBase = (url) => openReader(url, 'original');
  // проверка номера по утечкам через Have I Been Pwned (ключ вводится на один запрос)
  const DC = { 'Email addresses': 'почта', 'Phone numbers': 'телефон', Names: 'имя', 'Dates of birth': 'дата рождения', Genders: 'пол', 'Geographic locations': 'местоположение',
    'Physical addresses': 'адрес', Passwords: 'пароли', Usernames: 'логины', Employers: 'место работы', 'Job titles': 'должность', 'Relationship statuses': 'семейное положение',
    'IP addresses': 'IP-адреса', 'Social media profiles': 'профили в соцсетях', 'Spoken languages': 'языки', 'Account balances': 'балансы счетов', 'Credit cards': 'банковские карты' };
  function leakBlock(r) {
    const key = h('input.field.grow', { type: 'password', placeholder: 'ключ API Have I Been Pwned', autocomplete: 'off', spellcheck: 'false', 'aria-label': 'Ключ API Have I Been Pwned' });
    const res = h('div.stack');
    const go = h('button.key.key--sm.key--snow', { type: 'button', onclick: async () => {
      if (!key.value.trim()) {
        res.replaceChildren(h('div.ucheck.urisk--mid', h('b', 'Нужен ключ'), h('span', 'Сайт Have I Been Pwned больше не ищет номера через форму поиска — только через API с ключом. Ключ платный, его покупают на сайте сервиса; тот же ключ подходит для проверки почт в разделе «Утечки паролей».')));
        key.focus(); return;
      }
      go.disabled = true; res.replaceChildren(h('p.umail__status', 'Проверяю…'));
      const x = await K.leakPhone(r.e164, key.value.trim());
      go.disabled = false;
      if (!x || !x.ok) { res.replaceChildren(h('div.ucheck.urisk--bad', h('b', 'Проверка не удалась'), h('span', (x && x.err) || 'Не получилось'))); return; }
      key.value = '';
      if (!x.breaches.length) { res.replaceChildren(h('div.ucheck.urisk--ok', h('b', 'В утечках с телефонами номер не найден'), h('span', 'Телефоны в Have I Been Pwned есть только для нескольких утечек, так что это не гарантия, что номера нет в других базах.'))); return; }
      res.replaceChildren(h('div.ucheck.urisk--warn', h('b', 'Номер найден в утечках: ' + x.breaches.length),
        h('span', 'Из чужих копий утечку уже не убрать, но вред можно уменьшить: не доверяй звонкам «из банка» и «службы безопасности», спроси у оператора, как запретить замену SIM-карты без твоего личного визита, и там, где можно, входи по приложению-аутентификатору, а не по СМС.')),
        ...x.breaches.map((b) => h('article.urow', h('div.urow__main', h('b', b.name), h('span.urow__what', 'утечка ' + (ru(b.date) || b.date || '—') + (b.count ? ' · записей: ' + b.count.toLocaleString('ru-RU') : '')),
          h('p', 'Что утекло: ' + (b.data.map((d) => DC[d] || d).join(', ') || 'не указано'))))));
    } }, 'Проверить по утечкам');
    key.addEventListener('keydown', (e) => { if (e.key === 'Enter') go.click(); });
    return h('article.plate.uform', h('b', 'Утечки: был ли номер в слитых базах'),
      h('p.muted', 'Проверка через Have I Been Pwned: сервис отвечает только названиями утечек и тем, что в них было (имя, почта, телефон…), — сами данные не показывает. Номер уходит только туда, а ключ используется для одного запроса и не сохраняется.'),
      h('div.row', key, go, link('Где взять ключ', 'https://haveibeenpwned.com/API/Key')), res);
  }
  function removal(ctx, x) {
    const known = KNOWN.get(x.site), g = x.group;
    return [h('p', PG[g].hint),
      h('div.row',
        known ? link('Удаление на ' + known.name, known.url, true) : null,
        g === 'people' || g === 'callers' ? h('button.key.key--sm.key--accent', { type: 'button', onclick: () => openUtil('u02') }, 'Удалить себя из баз →') : null,
        g === 'ads' ? h('button.key.key--sm', { type: 'button', onclick: () => openUtil('u09') }, 'Объявления и резюме →') : null,
        h('button.key.key--sm', { type: 'button', onclick: async () => { await K.copyText(x.url); toast('Адрес скопирован. Когда страницу удалят, вставь его сюда — поисковики уберут её копию'); openUtil('u04'); } }, 'Убрать копию из поиска →'),
        h('button.key.key--sm', { type: 'button', onclick: () => ctx.addReq({ to: x.site + ': убрать номер со страницы', law: 'other', days: 14, note: x.url }) }, '+ В трекер запросов'))];
  }
  function hitRow(ctx, x) {
    const [label, tone] = HOW[x.how] || HOW.snippet;
    const help = h('div.uhit__help'); help.hidden = true;
    const howB = h('button.key.key--sm', { type: 'button', 'aria-expanded': 'false', onclick: () => {
      if (!help.childNodes.length) help.append(...removal(ctx, x));
      help.hidden = !help.hidden; howB.setAttribute('aria-expanded', String(!help.hidden)); howB.textContent = help.hidden ? 'Как убрать' : 'Скрыть';
    } }, 'Как убрать');
    return h('article.urow.uhit',
      h('div.urow__main', h('b', x.title), h('span.urow__what', x.host), h('span.uhit__how.urisk--' + tone, label),
        x.excerpt ? h('p.uhit__ex', x.excerpt.pre, h('mark', x.excerpt.hit), x.excerpt.post) : null, help),
      h('div.urow__act', h('div.row', h('button.key.key--sm.key--snow', { type: 'button', onclick: () => openReader(x.url) }, 'Открыть'), outBtn('В браузере', x.url)), howB));
  }
  function phoneResults(ctx, r, again) {
    const n = r.found.length, cut = r.captcha || !!r.searchErr || r.stopped;
    const notes = [r.captcha ? 'DuckDuckGo временно ограничил поиск с твоего адреса и попросил подтвердить, что ты человек. Подожди 10–15 минут и нажми «Искать заново», включи прокси или Tor в «Анонимном поиске» — или проверь номер в Яндексе и Google кнопками ниже.' : null,
      r.searchErr ? 'Поиск прервался: ' + r.searchErr + '.' : null, r.stopped ? 'Поиск остановлен — показано то, что нашлось до остановки.' : null,
      !n && !cut ? 'DuckDuckGo не нашёл страниц с этим номером. Яндекс и Google проверь кнопками ниже — у них свой индекс.' : null].filter(Boolean);
    const copy = async () => { await K.copyText(['Номер ' + r.number + ' найден на страницах:', ...r.found.map((x) => '- ' + x.title + ' — ' + x.url)].join('\n')); toast('Список ссылок скопирован'); };
    const head = n ? 'Номер ' + r.number + ' найден на ' + n + ' ' + plural(n, 'странице', 'страницах', 'страницах') + ' · ' + r.sites + ' ' + plural(r.sites, 'сайт', 'сайта', 'сайтов')
      : cut ? 'Поиск не закончен — пока ничего не найдено' : 'Номер ' + r.number + ' в DuckDuckGo не найден';
    const out = [h('div.ucheck.urisk--' + (n ? 'warn' : cut ? 'mid' : 'ok'), h('b', head),
      h('span', 'Вариантов записи номера проверено: ' + r.queries + ' из ' + r.totalQueries + ' · страниц в выдаче: ' + r.results + ' · открыто и проверено: ' + r.checked + (r.dropped ? ' · без номера, отсеяно: ' + r.dropped : '') + ' · заняло ' + secs(r.ms) + '.'),
      ...notes.map((t) => h('span', t))),
      h('div.row', n ? h('button.key.key--sm', { type: 'button', onclick: copy }, 'Скопировать список ссылок') : null, h('button.key.key--sm', { type: 'button', onclick: again }, 'Искать заново'))];
    for (const [id] of PGROUPS) {
      const items = r.found.filter((x) => x.group === id);
      if (items.length) out.push(h('section.uhits', h('div.uhits__head', h('b', PG[id].name), h('span.k', String(items.length))), ...items.map((x) => hitRow(ctx, x))));
    }
    if (r.bases && r.bases.length) {
      out.push(h('article.plate.uform', h('b', 'Открытые базы номеров'),
        h('p.muted', 'У этих баз есть страница на каждый номер: там видно, что о нём пишут люди и что знает определитель. Откроются здесь же, во встроенном окне, через приватное соединение — база увидит одно обычное посещение. Если сайт попросит подтвердить, что ты не робот, подтверди сам.'),
        ...r.bases.map((b) => h('div.urow.ubase', h('div.urow__main', h('b', b.name), h('span.urow__what', b.what)),
          h('div.urow__act', h('button.key.key--sm.key--snow', { type: 'button', onclick: () => openBase(b.url) }, 'Открыть'))))));
    }
    out.push(leakBlock(r));
    if (r.manual) {
      out.push(h('article.plate.uform', h('b', 'Проверь ещё в Яндексе и Google'),
        h('p.muted', 'Они не разрешают искать автоматически, поэтому откроются в твоём браузере — с готовым запросом сразу по всем вариантам записи номера. Поисковик увидит этот запрос, как если бы ты набрал его сам.'),
        h('div.row', link('Искать в Яндексе', r.manual.yandex), link('Искать в Google', r.manual.google),
          h('button.key.key--sm', { type: 'button', onclick: () => openUtil('u03') }, 'Google сам следит за номером →'))));
    }
    if (r.unchecked.length) {
      out.push(h('details.plate.uhelp', h('summary', 'Не удалось проверить: ' + r.unchecked.length + ' — посмотри сам'),
        h('p', 'Эти страницы были в выдаче, но не открылись или закрыты от автоматических проверок. В их описании номера нет, но на самой странице он может быть.'),
        ...r.unchecked.map((x) => h('div.uhit__mini', h('span', x.title + ' · ' + x.site + ' — ' + x.err), outBtn('Открыть', x.url)))));
    }
    return out;
  }
  // сайты поиска людей в США, которые удаляют только через форму на сайте (письмом — Spokeo и PeopleConnect, они в общем списке)
  const BROKERS = [
    { id: 'whitepages', name: 'Whitepages', what: 'адреса, телефоны, возраст', url: 'https://www.whitepages.com/suppression-requests', how: 'Вставь адрес своей страницы с whitepages.com. Подтверждают звонком с кодом на телефон — так сайт узнает номер, реши, готов ли ты на это.' },
    { id: 'beenverified', name: 'BeenVerified', what: 'отчёты о людях: адреса, телефоны, родственники', url: 'https://www.beenverified.com/app/optout/search', how: 'Найди себя по имени и штату, выбери свою запись и подтверди по ссылке из письма.' },
    { id: 'fastpeoplesearch', name: 'FastPeopleSearch', what: 'адреса, телефоны, родственники', url: 'https://www.fastpeoplesearch.com/removal', how: 'Найди свою запись и нажми удаление. Подтверждение — по ссылке из письма.' },
    { id: 'truepeoplesearch', name: 'TruePeopleSearch', what: 'адреса, телефоны, родственники', url: 'https://www.truepeoplesearch.com/removal', how: 'Найди свою запись и нажми удаление. Подтверждение — по ссылке из письма.' },
    { id: 'thatsthem', name: "That's Them", what: 'адреса, телефоны, почта, IP-адреса', url: 'https://thatsthem.com/optout', how: 'Заполни форму: укажи то, что нужно скрыть, — имя, адрес, телефон или почту.' },
    { id: 'usphonebook', name: 'USPhoneBook', what: 'телефоны и адреса', url: 'https://www.usphonebook.com/opt-out', how: 'Найди свой номер и запись, нажми удаление.' },
    { id: 'nuwber', name: 'Nuwber', what: 'адреса, телефоны, родственники', url: 'https://nuwber.com/removal/link', how: 'Вставь адрес своей страницы с nuwber.com и подтверди по ссылке из письма.' },
    { id: 'clustrmaps', name: 'ClustrMaps', what: 'адреса и соседи', url: 'https://clustrmaps.com/bl/opt-out', how: 'Найди свою запись и отправь запрос на удаление.' },
    { id: 'familytreenow', name: 'FamilyTreeNow', what: 'родственники и адреса', url: 'https://www.familytreenow.com/optout', how: 'Подтверди, что ты не робот, найди свою запись и нажми удаление.' },
  ];
  /* ---------- #02 письма в определители и базы: какой почтой отправлять и как получить пароль приложения ---------- */
  const PROVIDERS = [
    ['gmail', 'Gmail', 'Включи двухэтапную проверку в аккаунте Google, потом открой «Пароли приложений», впиши любое название (например, KenoxANON) и нажми «Создать». 16 букв, которые покажет Google, — это и есть пароль приложения.', 'https://myaccount.google.com/apppasswords'],
    ['yandex', 'Яндекс Почта', 'Открой Яндекс ID → «Безопасность» → «Пароли приложений», выбери «Почта» и создай пароль. Ещё в настройках Почты → «Почтовые программы» должен быть включён доступ по протоколу IMAP.', 'https://id.yandex.ru/security/app-passwords'],
    ['mailru', 'Mail.ru', 'Открой настройки аккаунта Mail.ru → «Безопасность» → «Пароли для внешних приложений», нажми «Добавить», впиши название и создай пароль.', 'https://account.mail.ru/user/2-step-auth/passwords/'],
    ['custom', 'Другой сервер', 'Найди в справке своей почты адрес сервера SMTP и порт: 465 (сразу шифрование) или 587 (STARTTLS). Если почта умеет пароли приложений — используй такой пароль.', null],
  ];
  const lawText = (c) => (c.law === 'gdpr' ? 'GDPR · ответ за месяц' : 'ждём ответа ' + dn(c.days || 30));
  function brokerRows(ctx) {
    const box = h('div.stack'), st = (b) => (markOf('brokers:' + b.id) || {}).s || '';
    const draw = () => box.replaceChildren(...BROKERS.map((b) => h('article.urow',
      h('div.urow__main', h('b', b.name), h('span.urow__what', b.what), h('p', b.how)),
      h('div.urow__act', link('Страница удаления', b.url, true),
        seg([['', 'не начато'], ['sent', 'отправил'], ['done', 'удалено'], ['none', 'меня нет']], st(b), async (v) => { await ctx.mark('brokers:' + b.id, v, 30); draw(); }),
        markNote(markOf('brokers:' + b.id))))));
    draw();
    return box;
  }
  // окно №02: номер, почта отправителя, список компаний и одна кнопка
  function optoutUi(ctx, list) {
    const keyOf = (c) => c.group + ':' + c.id;
    const sel = new Set(list.filter((c) => !c.us && !/^(sent|done)$/.test((markOf(keyOf(c)) || {}).s || '')).map((c) => c.id));
    const res = new Map();
    let sending = false;
    // 1. номер и подпись
    const phoneI = h('input.field.uphone', { type: 'tel', placeholder: 'твой номер: +7 999 123-45-67', spellcheck: 'false', autocomplete: 'off', maxlength: '40', 'aria-label': 'Номер телефона' });
    const nameI = h('input.field.grow', { placeholder: 'подпись, например Ivan Petrov — необязательно', spellcheck: 'false', autocomplete: 'off', maxlength: '80', 'aria-label': 'Подпись в письме' });
    phoneI.value = me.phone; nameI.value = me.name;
    phoneI.addEventListener('input', () => { me.phone = phoneI.value; });
    nameI.addEventListener('input', () => { me.name = nameI.value; });
    const latB = h('button.key.key--sm', { type: 'button', title: 'Переписать подпись латиницей, как в загранпаспорте', onclick: () => { nameI.value = me.name = translit(nameI.value); } }, 'Латиницей');
    // 2. почта отправителя
    const prov = h('select.field.uprov', { 'aria-label': 'Какая почта' }, PROVIDERS.map(([id, n]) => h('option', { value: id }, n)));
    const user = h('input.field.grow', { type: 'email', placeholder: 'адрес почты, например name@gmail.com', spellcheck: 'false', autocomplete: 'off', maxlength: '120', 'aria-label': 'Адрес почты' });
    const pass = h('input.field.grow', { type: 'password', placeholder: 'пароль приложения — не пароль от почты', autocomplete: 'new-password', maxlength: '300', 'aria-label': 'Пароль приложения' });
    const hostI = h('input.field.grow', { placeholder: 'сервер SMTP, например smtp.example.com', spellcheck: 'false', autocomplete: 'off', maxlength: '120', 'aria-label': 'Сервер SMTP' });
    const portI = h('input.field.uport', { type: 'number', min: '1', max: '65535', value: '465', 'aria-label': 'Порт сервера' });
    const custom = h('div.row', hostI, portI);
    const copyMe = h('input', { type: 'checkbox' }); copyMe.checked = true;
    const accSt = h('p.umail__status', { 'aria-live': 'polite' }), help = h('p'), helpLink = h('div.row');
    const syncProv = () => {
      const p = PROVIDERS.find((x) => x[0] === prov.value) || PROVIDERS[0];
      custom.hidden = prov.value !== 'custom';
      help.textContent = p[2];
      helpLink.replaceChildren(...(p[3] ? [link('Открыть «Пароли приложений» — ' + p[1], p[3])] : []));
    };
    prov.addEventListener('change', syncProv);
    user.addEventListener('change', async () => { const d = await K.mailDetect(user.value.trim()); if (d && d !== prov.value) { prov.value = d; syncProv(); } });
    syncProv();
    const acc = () => ({ provider: prov.value, user: user.value.trim(), pass: pass.value, host: hostI.value.trim(), port: Number(portI.value) });
    const verifyB = h('button.key.key--sm', { type: 'button', onclick: async () => {
      verifyB.disabled = true; accSt.classList.remove('is-bad', 'is-ok'); accSt.textContent = 'Проверяю вход…';
      const r = await K.mailVerify(acc());
      verifyB.disabled = false;
      accSt.textContent = r.ok ? 'Вход работает: ' + r.host + ' принял адрес и пароль. Ничего не отправлено.' : r.err;
      accSt.classList.add(r.ok ? 'is-ok' : 'is-bad');
    } }, 'Проверить вход');
    // 3. куда отправить
    const callers = list.filter((c) => !c.us), us = list.filter((c) => c.us);
    const listBox = h('div.stack'), summary = h('div');
    const goB = h('button.key.key--accent.ugo', { type: 'button', onclick: () => sendAll() });
    const syncGo = () => { if (sending) return; const n = sel.size; goB.disabled = !n; goB.textContent = n ? 'Удалить меня отовсюду — отправить ' + n + ' ' + plural(n, 'письмо', 'письма', 'писем') : 'Отметь, куда отправить письма'; };
    const preview = async (c, pre) => {
      const r = await K.optoutLetter(c.id, { phone: phoneI.value, name: nameI.value, email: user.value });
      pre.textContent = r.ok ? 'Кому: ' + r.to + '\nТема: ' + r.subject + '\n\n' + r.text : (r.err || '');
    };
    const row = (c) => {
      const cb = h('input', { type: 'checkbox', 'aria-label': 'Отправить письмо: ' + c.name });
      cb.checked = sel.has(c.id);
      cb.addEventListener('change', () => { if (cb.checked) sel.add(c.id); else sel.delete(c.id); syncGo(); });
      const pre = h('pre.letter.selectable.uletter'); pre.hidden = true;
      const pv = h('button.key.key--sm', { type: 'button', 'aria-expanded': 'false', onclick: async () => {
        if (pre.hidden) await preview(c, pre);
        pre.hidden = !pre.hidden; pv.setAttribute('aria-expanded', String(!pre.hidden)); pv.textContent = pre.hidden ? 'Текст письма' : 'Скрыть письмо';
      } }, 'Текст письма');
      const r = res.get(c.id), m = markOf(keyOf(c));
      return h('article.urow.uco' + (m && /^(sent|done)$/.test(m.s) ? '.is-sent' : ''),
        h('label.uunsub__pick', cb, h('span.urow__main', h('b', c.name), h('span.urow__what', c.who + ' · ' + lawText(c)), h('p', c.what), h('span.urow__what', 'письмо на ' + c.email))),
        h('div.urow__act', h('div.row', pv, link('Откуда адрес', c.src)), markNote(m),
          r ? h('span.unote' + (r.ok ? '.unote--ok' : '.unote--due'), r.ok ? 'письмо отправлено' : 'не ушло: ' + r.err) : null),
        pre);
    };
    function paint() {
      listBox.replaceChildren(
        h('div.row', h('button.key.key--sm', { type: 'button', onclick: () => { callers.forEach((c) => sel.add(c.id)); paint(); } }, 'Отметить все определители'),
          h('button.key.key--sm', { type: 'button', onclick: () => { sel.clear(); paint(); } }, 'Снять все')),
        ...callers.map(row),
        h('div.uhits__head', h('b', 'Если жил, учился или работал в США'), h('span.k', 'сайты поиска людей · по умолчанию не отмечены')),
        ...us.map(row));
      syncGo();
    }
    async function sendAll() {
      if (sending) return;
      const chk = await K.phoneCheck(phoneI.value.trim());
      if (!chk.ok) { toast(chk.err, 'warn'); phoneI.focus(); return; }
      phoneI.value = me.phone = chk.pretty;
      const a = acc();
      if (!a.user) { toast('Напиши адрес своей почты', 'warn'); user.focus(); return; }
      if (!a.pass) { toast('Введи пароль приложения для почты', 'warn'); pass.focus(); return; }
      const picked = list.filter((c) => sel.has(c.id)), n = picked.length;
      if (!n) return;
      const ok = await confirmBox({ kicker: 'Удалить себя из баз', title: 'Отправить ' + n + ' ' + plural(n, 'письмо', 'письма', 'писем') + ' с адреса ' + a.user + '?', ok: 'Отправить письма', danger: true,
        body: [h('p', 'Каждой компании уйдёт отдельное письмо с требованием удалить номер ' + chk.pretty + ' и всё, что к нему привязано:'),
          h('ul.uhappen', picked.map((c) => h('li', c.name + ' — ' + c.email))),
          h('p', copyMe.checked ? 'Копии писем придут тебе на ' + a.user + '.' : 'Копии писем тебе не придут.'),
          h('p', 'Отправленные письма не вернуть. Запросы попадут в «Трекер запросов на удаление» со сроками ответа.')],
        check: 'Это мой номер, и я отправляю требования от своего имени' });
      if (!ok) return;
      sending = true; goB.disabled = true; goB.textContent = 'Подключаюсь к почте…'; summary.replaceChildren();
      const off = K.onMailSendProgress((x) => { res.set(x.id, x); sending = false; paint(); sending = true; goB.disabled = true; goB.textContent = 'Отправлено ' + x.i + ' из ' + x.n + '…'; });
      let r;
      try { r = await K.mailSend(a, { phone: chk.pretty, name: nameI.value.trim() }, picked.map((c) => c.id), { bccSelf: copyMe.checked }); }
      finally { off(); sending = false; }
      if (!r || !r.ok) { paint(); summary.replaceChildren(h('div.ucheck.urisk--bad', h('b', 'Письма не отправлены'), h('span', (r && r.err) || 'Не получилось'))); return; }
      if (r.store) store = r.store;
      r.results.forEach((x) => { res.set(x.id, x); if (x.ok) sel.delete(x.id); });
      const good = r.results.filter((x) => x.ok).length, bad = r.results.length - good;
      if (!bad) pass.value = '';
      paint();
      summary.replaceChildren(h('div.ucheck.urisk--' + (bad ? (good ? 'warn' : 'bad') : 'ok'),
        h('b', good ? 'Отправлено писем: ' + good + ' из ' + r.results.length : 'Письма не ушли'),
        h('span', good ? 'Запросы добавлены в «Трекер запросов на удаление» — там видно, до какого числа компании должны ответить. Ответы придут на ' + a.user + '. Через 30 дней приложение напомнит проверить, удалили ли номер.' : 'Причина — в строке каждой компании.'),
        bad && good ? h('span', 'Не ушло: ' + bad + '. Причина — в строке компании; такие письма можно отправить ещё раз.') : null),
        good ? h('div.row', h('button.key.key--sm', { type: 'button', onclick: () => openUtil('u05') }, 'Открыть трекер запросов →')) : null);
      toast(bad ? 'Отправлено ' + good + ' из ' + r.results.length : 'Все письма отправлены', bad ? 'warn' : 'ok');
    }
    paint();
    // формы удаления на сайтах — у них свои отметки, чтобы не смешивать со статусом письма
    const forms = list.filter((c) => c.formHow).map((c) => {
      const box = h('div');
      const draw = () => { const m = markOf('form:' + c.id); box.replaceChildren(h('article.urow', h('div.urow__main', h('b', c.name), h('p', c.formHow)),
        h('div.urow__act', c.form ? link('Открыть страницу удаления', c.form, true) : null, seg([['', 'не сделал'], ['done', 'сделал']], m ? m.s : '', async (v) => { await ctx.mark('form:' + c.id, v); draw(); }), markNote(m)))); };
      draw();
      return box;
    });
    return [
      h('article.plate.uform', h('b', '1. Твой номер'), h('div.row', phoneI, nameI, latB),
        h('p.muted', 'Подпись — по желанию: компаниям хватает номера. Имя поможет им найти записи, но и подскажет, чей это номер.')),
      h('article.plate.uform', h('b', '2. С какой почты отправить'), h('div.row', prov, user), custom, h('div.row', pass, verifyB), accSt,
        h('label.ucopy', copyMe, h('span', 'Прислать мне копии писем — пригодятся как доказательство отправки')),
        h('details.uhelp', h('summary', 'Как получить пароль приложения'), help, helpLink,
          h('p.muted', 'Пароль приложения — отдельный пароль только для почтовых программ. Приложение использует его, только пока отправляет письма, и нигде не сохраняет. Удалить его можно там же, где создал.'))),
      h('article.plate.uform', h('b', '3. Куда отправить'), listBox, goB, summary),
      h('details.plate.uhelp', h('summary', 'Быстрее писем — формы удаления на сайтах'),
        h('p', 'У некоторых сервисов есть своя страница удаления: номер пропадает из поиска обычно за сутки, без ожидания ответа. Письмо — требование по закону, на которое компания обязана ответить; форма — быстрое скрытие. Можно сделать и то и другое.'), ...forms),
      h('details.plate.uhelp', h('summary', 'Сайты поиска людей в США — только через формы (' + BROKERS.length + ')'),
        h('p', 'Эти сайты не принимают требования письмом — только через форму, где нужно найти свою запись. Это нужно, только если ты жил, учился или работал в США. Часть сайтов не открывается из России — тогда понадобится VPN.'),
        brokerRows(ctx))];
  }
  /* ---------- #04 инструменты поисковиков ---------- */
  const OUTDATED = [
    ['Google: устаревший контент', 'https://search.google.com/search-console/remove-outdated-content'],
    ['Яндекс: удалить из поиска', 'https://webmaster.yandex.ru/tools/del-url/'],
    ['Bing: удаление контента', 'https://www.bing.com/webmasters/tools/contentremoval'],
  ];
  /* ---------- #05 трекер запросов ---------- */
  const LAWS = [
    ['152', '152-ФЗ — компания в России, ответ за 10 рабочих дней'],
    ['search', 'Право на забвение — поисковик, 10 рабочих дней'],
    ['gdpr', 'GDPR — компания в ЕС, ответ за 1 месяц'],
    ['other', 'Другое — свой срок в днях'],
  ];
  const LAWNAME = { 152: '152-ФЗ', search: 'право на забвение', gdpr: 'GDPR', other: 'свой срок' };
  const STATUS = { sent: 'ждём ответа', answered: 'ответили', done: 'данные удалены', refused: 'отказали' };
  const RKN = 'https://rkn.gov.ru/treatments/ask-question/';
  const EDPB = 'https://www.edpb.europa.eu/about-edpb/about-edpb/members_en';
  const enDate = (s) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || '')); return m ? new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : s; };
  function complaintText(r, name, contact) {
    const who = name || '[фамилия, имя, отчество]', where = contact || '[почта или адрес для ответа]';
    const today = new Date().toLocaleDateString('ru-RU', { day: '2-digit', month: 'long', year: 'numeric' });
    if (r.law === 'gdpr') {
      return ['To: [national data protection authority]', 'Complaint: failure to respond to a data subject request under the GDPR', '',
        'Complainant: ' + (name || '[your full name]') + ', ' + (contact || '[email for reply]'), 'Controller: ' + r.to, '',
        'On ' + enDate(r.sent) + ' I sent the controller a request under the GDPR concerning my personal data (access under Article 15 and/or erasure under Article 17).' + (r.note ? ' Details: ' + r.note + '.' : ''),
        'Under Article 12(3) GDPR the controller had to respond without undue delay and at the latest within one month, i.e. by ' + enDate(r.deadline) + '. ' + (r.status === 'refused' ? 'The controller refused without a valid legal basis.' : 'I have received no response.'), '',
        'I ask the authority to investigate and to order the controller to comply with my request.', '',
        'Attachments: copy of my request; proof of sending.', new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })].join('\n');
    }
    if (r.law === '152') {
      return ['В Роскомнадзор', 'от ' + who + ', ' + where, '', 'ЖАЛОБА', 'на нарушение прав субъекта персональных данных', '',
        ru(r.sent) + ' я направил(а) оператору персональных данных «' + r.to + '» требование, связанное с обработкой моих персональных данных (уточнение, блокирование или уничтожение — статьи 14, 20 и 21 Федерального закона от 27.07.2006 № 152-ФЗ «О персональных данных»).' + (r.note ? ' Способ отправки: ' + r.note + '.' : ''),
        'Срок ответа на требование (не более 10 рабочих дней по части 1 статьи 20 Федерального закона № 152-ФЗ) истёк ' + ru(r.deadline) + '. ' + (r.status === 'refused' ? 'Оператор отказал без законных оснований.' : 'Ответ от оператора не получен.'), '',
        'Прошу провести проверку соблюдения оператором требований Федерального закона № 152-ФЗ, обязать оператора прекратить обработку и уничтожить мои персональные данные и сообщить мне о результатах рассмотрения жалобы.', '',
        'Приложения: копия требования; подтверждение его отправки.', '', today + '                  ________ / ' + who].join('\n');
    }
    // свой срок: повторное письмо в сервис
    return ['Здравствуйте!', '',
      ru(r.sent) + ' я просил(а) удалить мой аккаунт и мои персональные данные' + (r.note ? ' (' + r.note + ')' : '') + '. Прошло ' + dn(Math.max(0, -daysTo(r.sent))) + ', ответа нет.',
      'Повторно прошу удалить мои данные и подтвердить удаление ответным письмом. Если ответа не будет, я обращусь в надзорный орган по защите персональных данных.', '', who].join('\n');
  }

  // готовые утилиты: справка (что делает, как пользоваться, что произойдёт) и действия
  const IMPL = {
    u01: {
      what: ['Введи свой номер телефона — приложение само найдёт в интернете страницы, где он упоминается: объявления, сайты «кто звонил», соцсети и форумы, справочники, сайты поиска людей. У каждой находки — ссылка на источник и отрывок текста, где стоит номер.',
        'Номер ищется во всех привычных видах записи: +7 999 123-45-67, 8 (999) 123-45-67, 89991234567 и другие. Каждую найденную страницу приложение открывает и проверяет, есть ли на ней номер на самом деле, — случайные совпадения отсеиваются.',
        'После поиска — ещё две проверки: открытые базы номеров (Яндекс Определитель и сайты отзывов о звонках) открываются одной кнопкой с уже подставленным номером, а через Have I Been Pwned можно узнать, был ли номер в утечках.',
        'Закрытые базы — определители номеров (GetContact, Truecaller и другие) — поисковикам не видны. Номер оттуда удаляется одной кнопкой в утилите «Удалить себя из баз». Базы «пробива» приложение не проверяет: они собраны из украденных данных, и запрос туда сам передал бы им номер.'],
      steps: ['Введи свой номер и нажми «Найти меня». Поиск занимает около минуты.',
        'Посмотри, где нашёлся номер: у каждой страницы — сайт и отрывок текста с номером. Страницу можно открыть в читалке прямо в приложении.',
        'Нажми «Как убрать» — там будет, что делать именно с таким сайтом.',
        'Проверь номер ещё в Яндексе и Google — кнопками под результатами: запрос уже составлен.',
        'Чтобы убрать номер из определителей, нажми «Удалить себя из баз одной кнопкой».'],
      happens: ['Номер ищется в DuckDuckGo через приватное соединение «Анонимного поиска» (через твой прокси, если он настроен), без cookies: DuckDuckGo увидит запросы с номером, но не узнает, кто ищет.',
        'Найденные страницы открываются по одной через отдельную приватную сессию. Каждый сайт увидит одно обычное обращение, как от посетителя.',
        'Номер и результаты нигде не сохраняются — они живут, пока открыто приложение.',
        'Находится только то, что есть в поисковике. Ищи только свой номер: собирать сведения о других людях без их согласия нельзя.',
        'Яндекс и Google автоматический поиск не разрешают. Для них под результатами будут кнопки: запрос откроется в твоём браузере, и поисковик его увидит.',
        'Открытая база открывается только по кнопке — во встроенном окне через то же приватное соединение. База увидит одно посещение страницы твоего номера, как от обычного посетителя.',
        'Проверка утечек отправляет номер в Have I Been Pwned вместе с твоим ключом. Ключ нигде не сохраняется, сервис не показывает сами утёкшие данные.',
        'Если искать много раз подряд, DuckDuckGo может на время попросить подтвердить, что ты человек. Тогда подожди 10–15 минут или включи прокси.'],
      progress: () => (phoneRes ? 'последний поиск: ' + (phoneRes.found.length ? 'найдено ' + phoneRes.found.length + ' ' + plural(phoneRes.found.length, 'страница', 'страницы', 'страниц') : 'ничего не найдено') : null),
      render(ctx) {
        const input = h('input.field.grow', { type: 'tel', placeholder: 'твой номер, например +7 999 123-45-67', spellcheck: 'false', autocomplete: 'off', maxlength: '40', 'aria-label': 'Номер телефона' });
        input.value = me.phone;
        const go = h('button.key.key--snow', { type: 'button', onclick: () => run() }, 'Найти меня');
        const stop = h('button.key.key--sm', { type: 'button', onclick: () => { K.phoneCancel(); stop.disabled = true; } }, 'Остановить');
        stop.hidden = true;
        const status = h('p.umail__status', { 'aria-live': 'polite' }), out = h('div.stack');
        input.addEventListener('input', () => { me.phone = input.value; });
        input.addEventListener('keydown', (e) => { if (e.key === 'Enter') run(); });
        let busy = false;
        const show = (r) => out.replaceChildren(...phoneResults(ctx, r, () => { phoneRes = null; out.replaceChildren(); input.focus(); input.select(); }));
        async function run() {
          const v = input.value.trim();
          if (busy) return;
          if (!v) { input.focus(); return; }
          const chk = await K.phoneCheck(v);
          status.classList.remove('is-bad');
          if (!chk.ok) { status.textContent = chk.err; status.classList.add('is-bad'); return; }
          input.value = me.phone = chk.pretty;
          busy = true; go.disabled = true; stop.hidden = false; stop.disabled = false; out.replaceChildren();
          status.textContent = 'Начинаю поиск…';
          const off = K.onPhoneProgress((x) => {
            status.textContent = x.stage === 'search' ? 'Ищу в DuckDuckGo: вариант записи ' + x.i + ' из ' + x.n + ' — ' + x.q
              : 'Проверяю найденные страницы: ' + x.done + ' из ' + x.total + (x.found ? ' · номер есть на ' + x.found : '');
          });
          let r;
          try { r = await K.phoneFind(v); } finally { off(); busy = false; go.disabled = false; stop.hidden = true; }
          if (!r || !r.ok) { status.textContent = (r && r.err) || 'Поиск не удался'; status.classList.add('is-bad'); return; }
          status.textContent = '';
          phoneRes = r; show(r);
        }
        if (phoneRes) show(phoneRes);
        return h('div.stack',
          h('article.plate.uform', h('b', 'Твой номер телефона'), h('div.row', input, go, stop), status,
            h('p.muted', 'Ищи только свой номер. Поиск идёт через приватное соединение «Анонимного поиска», номер нигде не сохраняется.')),
          out,
          h('article.plate.ucta', h('b', 'Номер в определителях и базах'),
            h('p', 'GetContact, Truecaller, NumBuster и другие определители поисковикам не видны: что записано на твой номер, показывают только их приложения. Удалить номер оттуда можно одной кнопкой — приложение отправит каждой компании требование с твоей почты.'),
            h('div.row', h('button.key.key--accent', { type: 'button', onclick: () => openUtil('u02') }, 'Удалить себя из баз одной кнопкой →'))),
          h('details.plate.uhelp', h('summary', 'Где ещё узнают человека по номеру — это не проверить автоматически'),
            h('p', h('b', 'Telegram. '), '«Настройки» → «Конфиденциальность» → «Номер телефона» → «Кто может найти меня по номеру» → «Мои контакты».'),
            h('p', h('b', 'ВКонтакте. '), '«Настройки» → «Приватность» → «Кто может найти меня при импорте контактов по номеру» → «Никто».'),
            h('p', h('b', 'WhatsApp. '), '«Настройки» → «Конфиденциальность»: для фото, сведений и времени «был(а)» выбери «Мои контакты».'),
            h('p', h('b', 'Переводы по номеру (СБП). '), 'Тот, кто переводит деньги по номеру, видит имя, отчество и первую букву фамилии получателя. В настройках СБП некоторых банков можно отключить входящие переводы по номеру.')),
          h('article.plate.uaside', h('b', 'А боты «пробива» в Telegram?'),
            h('p', 'Их базы собраны из утечек и незаконны, поэтому приложение их не проверяет: запрос туда сам передал бы им твой номер. По-настоящему удалить себя оттуда нельзя — данные копируются и перепродаются, а платное «скрытие» ничего не гарантирует. Что реально помогает: сообщить в Роскомнадзор о незаконной обработке своих данных, сменить номер и почту в важных сервисах и включить двухфакторную защиту.')));
      },
    },
    u02: {
      what: ['Определители номеров — GetContact, Truecaller, NumBuster, CallApp, Eyecon, Sync.ME, Hiya — берут имена из адресных книг тех, кто их установил. Если знакомый записал тебя «Ваня ремонт» или «не брать», это видят все пользователи сервиса — даже если сам ты этими приложениями не пользуешься.',
        'Утилита одной кнопкой отправит каждой компании письмо с требованием удалить номер и всё, что к нему привязано, и перестать показывать его в поиске. Письма уходят с твоей почты на официальные адреса из политик конфиденциальности компаний, а запросы сразу попадают в «Трекер запросов на удаление» со сроками ответа.',
        'Если ты жил, учился или работал в США, можно отправить такие же письма двум крупным сайтам поиска людей. Остальные удаляют только через формы — они собраны внизу.'],
      steps: ['Проверь номер. Подпись в письме — по желанию: компаниям хватает номера.',
        'Подключи почту: выбери Gmail, Яндекс или Mail.ru, введи адрес и пароль приложения (как его получить — в подсказке) и нажми «Проверить вход».',
        'Отметь, куда отправить: по умолчанию отмечены все определители. Текст каждого письма можно посмотреть заранее.',
        'Нажми «Удалить меня отовсюду» и подтверди. Через 30 дней приложение напомнит проверить, удалили ли номер.'],
      happens: ['Каждой отмеченной компании уйдёт одно письмо с твоей почты, с паузой в пару секунд между письмами. Перед отправкой приложение покажет, сколько писем и куда уйдёт. Отправленное письмо не вернуть.',
        'Пароль приложения нужен только на время отправки и нигде не сохраняется. Это не пароль от почты: его можно удалить в настройках почты в любой момент.',
        'Компании узнают твой адрес почты, а он может выдать имя. Если не хочешь — отправляй с отдельного ящика.',
        'Письма на английском: компании зарубежные. GetContact (Португалия) и Eyecon (Швеция) подчиняются GDPR и обязаны ответить за месяц; остальным приложение даёт 30 дней.',
        'Компания может попросить подтвердить, что номер твой, — например, кодом из СМС. Подписи, которые люди сделали у себя в телефонах, останутся у них — исчезнет только их показ в сервисе.',
        'Если у тебя самого установлен определитель, сначала удали аккаунт в нём — иначе номер вернётся при следующем входе.'],
      progress: () => { const M = Object.entries(store.marks || {}).filter(([k]) => /^(callers|brokers):/.test(k)), s = M.filter(([, m]) => m.s === 'sent').length, d = M.filter(([, m]) => m.s === 'done').length; return s || d ? [s ? 'ждут ответа: ' + s : '', d ? 'удалено: ' + d : ''].filter(Boolean).join(' · ') : null; },
      render(ctx) {
        const box = h('div.stack', h('p.muted', 'Загружаю список компаний…'));
        (companies ? Promise.resolve(companies) : K.optoutList()).then((list) => { companies = list; box.replaceChildren(...optoutUi(ctx, list)); })
          .catch(() => box.replaceChildren(h('p.plate.warn', 'Список компаний не загрузился — закрой окно и открой снова.')));
        return box;
      },
    },
    u03: {
      what: ['В Google есть официальный инструмент «Результаты о вас». Он сам ищет в выдаче страницы с твоим телефоном, домашним адресом и почтой — и по твоему запросу убирает их из поиска.',
        'Там же можно включить уведомления: Google сообщит, когда такие данные снова появятся в выдаче.'],
      steps: ['Нажми «Открыть «Результаты о вас»» — страница Google откроется в твоём браузере. Нужен вход в аккаунт Google.',
        'Укажи, что искать: имя, телефон, адрес, почту.', 'Google покажет найденные страницы — у лишних нажми «Запросить удаление».',
        'Вернись сюда и отметь «подал запрос» — через 14 дней приложение напомнит проверить.'],
      happens: ['Google убирает ссылку только из своей выдачи. Сама страница остаётся на сайте и видна в Яндексе и других поисковиках — для них есть утилита «Старые страницы в поиске» и требование по закону.',
        'Телефон, адрес и почту, которые ты введёшь, Google использует для поиска таких страниц — так устроен инструмент.',
        'Рассмотрение занимает от нескольких часов до нескольких дней.', 'Приложение только открывает страницы Google в твоём браузере.'],
      progress: () => { const m = markOf('google:results'); return m ? { sent: 'запрос подан', done: 'убрано из поиска' }[m.s] || null : null; },
      render(ctx) {
        const box = h('div.stack');
        const draw = () => {
          const m = markOf('google:results');
          box.replaceChildren(
            h('div.row', link('Открыть «Результаты о вас»', 'https://myactivity.google.com/results-about-you', true), link('Форма удаления личных данных', 'https://support.google.com/websearch/troubleshooter/3111061')),
            h('article.urow', h('div.urow__main', h('b', 'Как дела с запросом?'), h('p', 'Отметь, когда подашь запрос, — через 14 дней будет напоминание проверить выдачу.')),
              h('div.urow__act', seg([['', 'не подавал'], ['sent', 'подал запрос'], ['done', 'убрали']], m ? m.s : '', async (v) => { await ctx.mark('google:results', v, 14); draw(); }), markNote(m))),
            h('div.row', h('button.key.key--sm', { type: 'button', onclick: () => ctx.addReq({ to: 'Google: убрать личные данные из поиска', law: 'other', days: 14, note: 'через «Результаты о вас»' }) }, '+ В трекер запросов')));
        };
        draw();
        return box;
      },
    },
    u04: {
      what: ['Ты удалил пост, профиль или страницу, а поисковик ещё недели показывает старый заголовок и кусок текста. Это копия в индексе поисковика — её можно убрать быстрее, если попросить.',
        'Утилита сначала проверит, что страница действительно удалена (Google и Яндекс этого требуют), а потом откроет нужный инструмент.'],
      steps: ['Вставь адрес страницы и нажми «Проверить».', 'Если страницы больше нет — открой инструмент Google, Яндекса или Bing: адрес уже будет в буфере обмена, вставь его в форму.',
        'Если страница ещё открывается — сначала удали её на сайте или попроси владельца. Если изменился только текст, Google всё равно можно попросить обновить устаревший фрагмент.'],
      happens: ['Проверка делает один запрос к этой странице через приватное соединение «Анонимного поиска» (через твой прокси, если он настроен), без cookies. Сайт увидит одно обращение, как от обычного посетителя.',
        'Инструменты поисковиков открываются в твоём браузере. Для Google нужен аккаунт Google, для Яндекса — вход в Яндекс ID.',
        'Удаляется только копия в поиске, а не сама страница на сайте.'],
      render(ctx) {
        const box = h('div.stack');
        const input = h('input.field.grow', { type: 'url', placeholder: 'https://… адрес удалённой страницы', spellcheck: 'false', 'aria-label': 'Адрес страницы' });
        const out = h('div.stack'), go = h('button.key.key--snow', { type: 'button', onclick: () => check() }, 'Проверить');
        input.addEventListener('keydown', (e) => { if (e.key === 'Enter') check(); });
        const tools = h('div.row', OUTDATED.map(([label, url]) => h('button.key.key--sm', { type: 'button', onclick: async () => { const v = input.value.trim(); if (v) { await K.copyText(v); toast('Адрес скопирован — вставь его в форму поисковика'); } K.link(url); } }, label + ' ↗')));
        async function check() {
          let v = input.value.trim(); if (!v || go.disabled) return;
          if (!/^https?:\/\//i.test(v)) { v = 'https://' + v; input.value = v; }
          go.disabled = true; out.replaceChildren(h('p.muted', 'Проверяю через приватное соединение…'));
          const r = await K.utilCheckUrl(v);
          go.disabled = false;
          let tone, text;
          if (!r.ok) { tone = 'bad'; text = r.err || 'Не получилось проверить'; }
          else if (r.status === 404 || r.status === 410) { tone = 'ok'; text = 'Страницы больше нет (код ' + r.status + '). Можно просить поисковики убрать её копию.'; }
          else if (r.status >= 200 && r.status < 300) {
            let home = false; try { home = r.redirected && new URL(r.url).pathname.replace(/\/+$/, '') === ''; } catch (e) { home = false; }
            tone = home ? 'ok' : 'warn';
            text = home ? 'Ссылка теперь ведёт на главную страницу сайта (' + r.url + ') — для поисковиков это обычно значит, что страницы больше нет.'
              : 'Страница ещё открывается (код ' + r.status + (r.redirected ? ', ведёт на ' + r.url : '') + '). Сначала удали её на сайте или попроси владельца. Если изменился только текст, Google всё равно можно попросить обновить устаревший фрагмент.';
          } else if (r.status === 401 || r.status === 403) { tone = 'mid'; text = 'Страница закрыта (код ' + r.status + '). Поисковик может не сразу посчитать её удалённой — запрос подать можно.'; }
          else if (r.status >= 500) { tone = 'mid'; text = 'Сайт ответил ошибкой (код ' + r.status + '). Попробуй проверить позже.'; }
          else { tone = 'mid'; text = 'Сайт ответил кодом ' + r.status + '.'; }
          out.replaceChildren(h('div.ucheck.urisk--' + tone, h('b', { ok: 'Можно убирать из поиска', warn: 'Страница ещё на месте', mid: 'Нужно присмотреться', bad: 'Проверка не удалась' }[tone]), h('span', text)),
            h('div.row', h('button.key.key--sm', { type: 'button', onclick: () => { let host = v; try { host = new URL(v).hostname; } catch (e) { /* как есть */ } ctx.addReq({ to: 'Поисковики: убрать копию страницы ' + host, law: 'other', days: 14, note: v }); } }, '+ В трекер запросов')));
        }
        box.append(h('div.row', input, go), out, h('p.k', 'Инструменты поисковиков'), tools);
        return box;
      },
    },
    u05: {
      what: ['Отправил требование удалить данные — и забыл? Компании этим пользуются. Здесь все твои запросы в одном списке: кому, по какому закону, когда отправлен и до какого числа обязаны ответить.',
        'Когда срок выходит, приложение напомнит и подготовит жалобу: в Роскомнадзор — для российских компаний, в надзорный орган ЕС — для GDPR.',
        'Текст самого требования можно подготовить в разделе «След в интернете» → «Требование об удалении».'],
      steps: ['Отправь требование компании (письмом или через форму на сайте) и сохрани подтверждение отправки.', 'Добавь запрос сюда: кому, по какому закону и когда отправлен — срок посчитается сам.',
        'Когда придёт ответ, поменяй статус. Если срок выйдет, а ответа нет, — нажми «Жалоба», заполни имя и почту и скопируй готовый текст.'],
      happens: ['Список хранится только на этом компьютере. Приложение ничего не отправляет само — запросы и жалобы ты отправляешь сам.',
        'Сроки посчитаны по общим правилам: 152-ФЗ и право на забвение — 10 рабочих дней (выходные не считаются, праздники учти сам), GDPR — 1 месяц. Компания может продлить срок, если предупредит. Это не юридическая консультация.',
        'Когда срок выйдет, придёт уведомление Windows без названия компании — только число просроченных запросов.',
        'Имя и почта для жалобы нигде не сохраняются — только подставляются в текст.'],
      progress: () => { const R = store.requests || [], wait = R.filter((r) => r.status === 'sent'), over = wait.filter((r) => daysTo(r.deadline) < 0).length; return R.length ? 'запросов: ' + R.length + (wait.length ? ' · ждут ответа: ' + wait.length : '') + (over ? ' · просрочено: ' + over : '') : null; },
      render(ctx) {
        const box = h('div.stack');
        const to = h('input.field.grow', { placeholder: 'кому: компания, сервис или поисковик', maxlength: '200', spellcheck: 'false', 'aria-label': 'Кому отправлен запрос' });
        const law = h('select.field.ulaw', { 'aria-label': 'По какому закону' }, LAWS.map(([v, n]) => h('option', { value: v }, n)));
        const days = h('input.field.udays', { type: 'number', min: '1', max: '365', value: '30', 'aria-label': 'Срок в днях' });
        const sent = h('input.field.udate', { type: 'date', value: ymd(new Date()), max: ymd(new Date()), 'aria-label': 'Когда отправлен' });
        const note = h('input.field.grow', { placeholder: 'заметка: как отправил, номер обращения (необязательно)', maxlength: '500', spellcheck: 'false' });
        const syncDays = () => { days.hidden = law.value !== 'other'; };
        law.addEventListener('change', syncDays); syncDays();
        const listBox = h('div.stack'), complaint = h('div');
        const add = h('button.key.key--snow', { type: 'button', onclick: async () => {
          if (!to.value.trim()) { toast('Напиши, кому отправлен запрос', 'warn'); to.focus(); return; }
          await ctx.addReq({ to: to.value, law: law.value, days: Number(days.value), sent: sent.value, note: note.value }, true);
          to.value = ''; note.value = ''; draw();
        } }, 'Добавить запрос');
        function openComplaint(r) {
          const name = h('input.field', { placeholder: 'твои фамилия, имя, отчество', spellcheck: 'false', autocomplete: 'off' });
          const contact = h('input.field', { placeholder: 'почта или адрес для ответа', spellcheck: 'false', autocomplete: 'off' });
          const pre = h('pre.letter.selectable');
          const paint = () => { pre.textContent = complaintText(r, name.value.trim(), contact.value.trim()); };
          [name, contact].forEach((i) => i.addEventListener('input', paint));
          paint();
          const closeB = h('button.key.key--sm', { type: 'button', onclick: () => complaint.replaceChildren() }, 'Скрыть');
          if (r.law === 'search') {
            complaint.replaceChildren(h('article.plate.ucompl', h('div.tool__head', h('b', 'Поисковик отказал или молчит'), h('span', r.to)),
              h('p', 'Отказ поисковика или молчание дольше 10 рабочих дней по закону можно обжаловать в суде (часть 5 статьи 10.3 закона № 149-ФЗ «Об информации»). Роскомнадзор такие споры не рассматривает.'),
              h('p.muted', 'Часто помогает и повторное заявление: укажи точные адреса страниц и подробнее объясни, почему сведения недостоверны или неактуальны. Шаблон — в «След в интернете» → «Требование об удалении» → «Поисковику».'),
              h('div.row', closeB)));
          } else {
            const title = r.law === '152' ? 'Жалоба в Роскомнадзор' : r.law === 'gdpr' ? 'Complaint to a data protection authority' : 'Повторное письмо в сервис';
            const where = r.law === '152' ? link('Подать на сайте Роскомнадзора', RKN, true) : r.law === 'gdpr' ? link('Надзорные органы стран ЕС', EDPB, true) : null;
            complaint.replaceChildren(h('article.plate.ucompl', h('div.tool__head', h('b', title), h('span', 'текст никуда не отправляется')),
              h('div.grid2', name, contact), pre,
              h('div.row', h('button.key.key--sm.key--accent', { type: 'button', onclick: async () => { await K.copyText(pre.textContent); toast('Текст скопирован'); } }, 'Скопировать текст'), where, closeB),
              r.law === 'gdpr' ? h('p.muted', 'Жалобу подают в надзорный орган страны, где компания зарегистрирована в ЕС, или страны, где ты живёшь. Список органов — по ссылке.') : null,
              r.law === '152' ? h('p.muted', 'Сайт Роскомнадзора иногда отвечает очень долго — если страница не открылась, попробуй позже. Приложи копию требования и подтверждение отправки.') : null));
          }
          complaint.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
        function row(r) {
          const left = daysTo(r.deadline), over = r.status === 'sent' && left < 0;
          const state = r.status !== 'sent' ? STATUS[r.status] : over ? 'срок вышел ' + dn(-left) + ' назад' : left === 0 ? 'срок истекает сегодня' : 'осталось ' + dn(left);
          return h('article.urow.ureq' + (over ? '.is-over' : ''),
            h('div.urow__main', h('b', r.to),
              h('span.urow__what', LAWNAME[r.law] + (r.law === 'other' ? ' · ' + dn(r.days) : '') + ' · отправлен ' + ru(r.sent) + ' · ответ до ' + ru(r.deadline)),
              r.note ? h('p', r.note) : null,
              h('span.unote' + (over ? '.unote--due' : r.status === 'done' ? '.unote--ok' : ''), state)),
            h('div.urow__act',
              seg([['sent', 'ждём'], ['answered', 'ответили'], ['done', 'удалили'], ['refused', 'отказ']], r.status, async (v) => { await ctx.setReq(r.id, { status: v }); draw(); }),
              h('div.row',
                over || r.status === 'refused' ? h('button.key.key--sm.key--accent', { type: 'button', onclick: () => openComplaint(r) }, r.law === 'search' ? 'Что дальше' : r.law === 'other' ? 'Напомнить' : 'Жалоба') : null,
                h('button.vrow__btn.vrow__del', { type: 'button', onclick: async () => {
                  if (!(await confirmBox({ kicker: 'Трекер запросов', title: 'Убрать запрос «' + r.to + '» из списка?', ok: 'Убрать', body: [h('p', 'Запрос исчезнет только из этого списка. Само требование, отправленное компании, никуда не денется.')] }))) return;
                  await ctx.delReq(r.id); draw();
                } }, 'убрать'))));
        }
        function draw() {
          const R = store.requests || [], wait = R.filter((r) => r.status === 'sent'), over = wait.filter((r) => daysTo(r.deadline) < 0);
          listBox.replaceChildren(
            R.length ? h('p.k', 'Запросов: ' + R.length + ' · ждут ответа: ' + wait.length + ' · просрочено: ' + over.length + ' · данные удалены: ' + R.filter((r) => r.status === 'done').length)
              : h('p.muted', 'Запросов пока нет. Добавь первый — или отправь письма одной кнопкой в утилите «Удалить себя из баз»: они попадут сюда сами.'),
            ...R.map(row));
        }
        draw();
        box.append(h('article.plate.uform', h('b', 'Новый запрос'), h('div.row', to), h('div.row', law, days, sent), h('div.row', note, add)), listBox, complaint);
        return box;
      },
    },
    u06: {
      what: ['По закону компания обязана по твоему запросу рассказать, какие данные о тебе хранит: что именно, зачем, откуда взяла, кому передавала и сколько будет хранить. В России это статья 14 закона № 152-ФЗ, в ЕС — статья 15 GDPR (там ещё и копию самих данных).',
        'Такой запрос часто полезнее требования удалить: становится видно, что о тебе собрали на самом деле и кому успели передать, — и что потом требовать удалить.'],
      steps: ['Выбери, где компания: в России или в ЕС.', 'Заполни, кому пишешь и как тебя найти у них: почта или телефон аккаунта, логин.',
        'Скопируй текст и отправь его на адрес для обращений по персональным данным — он есть в политике конфиденциальности сервиса. Пиши с той почты, что привязана к аккаунту.',
        'Нажми «+ В трекер запросов» — приложение посчитает срок ответа и напомнит, если компания промолчит.'],
      happens: ['Текст собирается на этом компьютере и никуда не отправляется — письмо отправляешь ты сам.',
        'Имя, почта и паспортные данные только подставляются в текст и нигде не сохраняются.',
        'По 152-ФЗ в запросе должны быть данные паспорта, и без них компания вправе отказать. Можно сначала отправить запрос без паспорта с почты аккаунта — многие отвечают и так.',
        'Компания должна ответить за 10 рабочих дней (152-ФЗ) или за месяц (GDPR).'],
      render(ctx) {
        let kind = '152';
        const f = {
          company: h('input.field', { placeholder: 'кому: компания или сервис', spellcheck: 'false', 'aria-label': 'Кому' }),
          name: h('input.field', { placeholder: 'твои фамилия, имя, отчество', spellcheck: 'false', autocomplete: 'off', 'aria-label': 'ФИО' }),
          contact: h('input.field', { placeholder: 'почта или телефон аккаунта', spellcheck: 'false', autocomplete: 'off', 'aria-label': 'Почта или телефон' }),
          account: h('input.field', { placeholder: 'логин или номер аккаунта (необязательно)', spellcheck: 'false', autocomplete: 'off', 'aria-label': 'Логин' }),
          passport: h('input.field', { placeholder: 'паспорт: серия и номер, дата выдачи, кем выдан (необязательно)', spellcheck: 'false', autocomplete: 'off', 'aria-label': 'Паспорт' }),
        };
        const tabs = h('div.adv-tabs', { role: 'tablist' }), pre = h('pre.letter.selectable'), passRow = h('div');
        const val = () => Object.fromEntries(Object.entries(f).map(([k, el]) => [k, el.value.trim()]));
        const paint = () => { pre.textContent = ACCESS[kind](val()); };
        const drawTabs = () => {
          tabs.replaceChildren(...[['152', 'Компания в России · 152-ФЗ'], ['gdpr', 'Компания в ЕС · GDPR']].map(([id, n]) => h('button', { type: 'button', role: 'tab', 'aria-selected': kind === id ? 'true' : 'false', onclick: () => { kind = id; drawTabs(); } }, n)));
          passRow.replaceChildren(kind === '152' ? f.passport : '');
          paint();
        };
        Object.values(f).forEach((el) => el.addEventListener('input', paint));
        drawTabs();
        return h('div.stack', tabs, h('div.grid2', f.company, f.name), h('div.grid2', f.contact, f.account), passRow,
          h('div.row', h('button.key.key--accent', { type: 'button', onclick: async () => { await K.copyText(pre.textContent); toast('Текст скопирован — вставь его в письмо или форму сервиса'); } }, 'Скопировать текст'),
            h('button.key.key--sm', { type: 'button', onclick: () => ctx.addReq({ to: f.company.value.trim() || 'компания', law: kind === 'gdpr' ? 'gdpr' : '152', note: 'запрос «что вы обо мне храните»' }) }, '+ В трекер запросов')),
          h('article.plate', pre));
      },
    },
    u07: {
      what: ['Почти каждая регистрация оставляет в почте письмо: «Добро пожаловать», «Подтвердите адрес», «Аккаунт создан». Утилита находит такие письма в выгрузке твоей почты и собирает список сервисов, где у тебя есть аккаунт, — даже тех, о которых ты давно забыл.',
        'Для известных сервисов сразу будет ссылка на страницу удаления, для остальных — поиск инструкции через «Анонимный поиск».'],
      steps: ['Скачай выгрузку почты: для Gmail — Google Takeout (только «Почта», формат MBOX), для Яндекса и Mail.ru — через Thunderbird. Подробнее — в подсказке «Где взять выгрузку почты».',
        'Распакуй архив и перетащи файл .mbox сюда (или папку с письмами .eml).', 'Пройдись по списку: удали ненужные аккаунты и отметь «удалил» или «оставлю».'],
      happens: ['Читаются только заголовки писем: от кого, тема и дата. Тексты писем не открываются.',
        'Всё происходит на этом компьютере: выгрузка никуда не отправляется, а найденный список живёт, только пока открыто приложение. Путь к файлу не запоминается.',
        'Сохраняются только твои отметки «удалил / оставлю» — по адресу сайта, без писем.',
        'Большая выгрузка (несколько гигабайт) читается несколько минут.',
        'Файл выгрузки после работы стоит удалить шредером: в нём вся твоя переписка.'],
      progress: () => { const n = Object.keys(store.marks || {}).filter((k) => k.startsWith('mailacc:')).length; return n ? 'разобрано аккаунтов: ' + n : null; },
      render(ctx) {
        const box = h('div.stack');
        const draw = (r) => {
          const filter = h('input.field.grow', { type: 'search', placeholder: 'найти сервис в списке', spellcheck: 'false', 'aria-label': 'Найти сервис' });
          const list = h('div.stack');
          const row = (a) => {
            const k = 'mailacc:' + slug(a.site), m = markOf(k), known = KNOWN.get(a.site);
            return h('article.urow', h('div.urow__main', h('b', who(a)), h('span.urow__what', 'регистрация ~ ' + (ru(a.since) || 'дата неизвестна') + ' · писем от сервиса: ' + a.count), h('p', '«' + a.subject + '»')),
              h('div.urow__act', known ? link('Страница удаления', known.url, true) : h('button.key.key--sm', { type: 'button', onclick: () => toSearch('как удалить аккаунт ' + a.site) }, 'Как удалить → поиск'),
                seg([['', 'не решил'], ['done', 'удалил'], ['keep', 'оставлю']], m ? m.s : '', async (v) => { await ctx.mark(k, v); paint(); }), markNote(m)));
          };
          const paint = () => {
            const q = filter.value.trim().toLowerCase(), items = r.accounts.filter((a) => !q || a.site.includes(q) || (a.name || '').toLowerCase().includes(q));
            const done = r.accounts.filter((a) => /^(done|keep)$/.test((markOf('mailacc:' + slug(a.site)) || {}).s || '')).length;
            list.replaceChildren(h('div.uprog', h('div.gauge', h('i', { style: { width: (r.accounts.length ? done / r.accounts.length * 100 : 0) + '%' } })), h('span.k', 'разобрано ' + done + ' из ' + r.accounts.length + ' · известных сервисов со страницей удаления: ' + r.accounts.filter((a) => KNOWN.has(a.site)).length)),
              ...items.slice(0, 500).map(row));
          };
          filter.addEventListener('input', paint);
          box.replaceChildren(mailSummary(r, 'Найдено регистраций: ' + r.accounts.length),
            h('div.row', filter, h('button.key.key--sm', { type: 'button', onclick: () => { mailRes = null; box.replaceChildren(mailPicker(draw)); } }, 'Прочитать другую выгрузку')),
            r.accounts.length ? list : h('p.muted', 'Писем о регистрации не нашлось. Возможно, они удалены или выгрузка неполная.'));
          if (r.accounts.length) paint();
        };
        if (mailRes) draw(mailRes); else box.append(mailPicker(draw));
        return box;
      },
    },
    u08: {
      what: ['Магазины, сервисы и соцсети шлют письма годами — и многие письма сообщают отправителю, что ты их открыл. Утилита собирает из выгрузки почты все рассылки и даёт отписаться от них списком.',
        'Многие рассылки поддерживают отписку «в один клик» — это стандарт, которым пользуются Gmail и Яндекс Почта: приложение само отправит запрос отписки. Для остальных будет страница отписки или адрес для письма.'],
      steps: ['Перетащи сюда выгрузку почты (.mbox или папку .eml). Если ты уже открывал её в «Забытых аккаунтах», она подхватится сама.',
        'Отметь рассылки, от которых хочешь отписаться, и нажми «Отписаться от выбранных».', 'Для рассылок без отписки в один клик открой страницу отписки или напиши письмо на указанный адрес.'],
      happens: ['При отписке в один клик приложение отправляет по одному запросу на адрес отписки из письма — через приватное соединение «Анонимного поиска» (через прокси, если он настроен), без cookies. Перед отправкой покажет, сколько запросов уйдёт.',
        'Не отписывайся так от явного спама и писем от незнакомых: ответ на отписку подтверждает, что адрес живой. Такие письма лучше отмечать в почте как спам.',
        'Почтовый ящик не меняется: старые письма остаются, новые перестанут приходить обычно в течение нескольких дней.',
        'Выгрузка читается на этом компьютере (только заголовки) и никуда не отправляется.'],
      progress: () => { const n = Object.entries(store.marks || {}).filter(([k, m]) => k.startsWith('unsub:') && m.s === 'done').length; return n ? 'отписано: ' + n : null; },
      render(ctx) {
        const box = h('div.stack');
        const draw = (r) => {
          const lists = r.lists, one = lists.filter((l) => l.oneClick), sel = new Set(), res = new Map();
          const isDone = (l) => ((markOf('unsub:' + slug(l.site)) || {}).s === 'done');
          const list = h('div.stack');
          const go = h('button.key.key--accent', { type: 'button', onclick: async () => {
            const urls = [...sel]; if (!urls.length) return;
            const ok = await confirmBox({ kicker: 'Отписка в один клик', title: 'Отписаться от ' + urls.length + ' ' + plural(urls.length, 'рассылки', 'рассылок', 'рассылок') + '?', ok: 'Отписаться', body: [
              h('p', 'Приложение отправит ' + urls.length + ' ' + plural(urls.length, 'запрос', 'запроса', 'запросов') + ' отписки — по одному на адрес, указанный в письмах самого отправителя. Запросы идут через приватное соединение «Анонимного поиска» (через прокси, если он настроен), без cookies.'),
              h('p', 'Отправители увидят только запрос отписки. Почтовый ящик не меняется: новые письма перестанут приходить обычно в течение нескольких дней.')] });
            if (!ok) return;
            go.disabled = true; go.textContent = 'Отписываю…';
            const out = await K.mailUnsub(urls);
            for (const x of (out && out.results) || []) {
              res.set(x.url, x);
              const l = lists.find((y) => y.https === x.url);
              if (x.ok && l) await ctx.mark('unsub:' + slug(l.site), 'done');
            }
            const n = ((out && out.results) || []).filter((x) => x.ok).length;
            sel.clear(); paint();
            toast('Отписано: ' + n + ' из ' + urls.length, n === urls.length ? 'ok' : 'warn');
          } }, 'Отписаться от выбранных');
          const sync = () => { go.textContent = 'Отписаться от выбранных' + (sel.size ? ' (' + sel.size + ')' : ''); go.disabled = !sel.size; };
          const row = (l) => {
            const k = 'unsub:' + slug(l.site), m = markOf(k), rr = l.https ? res.get(l.https) : null;
            let pick = h('span.uunsub__none', { title: l.oneClick ? 'уже отписан' : 'отписка в один клик не поддерживается' }, l.oneClick ? '✓' : '—');
            if (l.oneClick && !isDone(l)) {
              pick = h('input', { type: 'checkbox', 'aria-label': 'Выбрать ' + l.site });
              pick.checked = sel.has(l.https);
              pick.addEventListener('change', () => { if (pick.checked) sel.add(l.https); else sel.delete(l.https); sync(); });
            }
            let how = null;
            if (!l.oneClick) {
              if (l.https) how = link('Страница отписки', l.https);
              else if (l.mailto) {
                const [addr, qs] = l.mailto.split('?'), subj = new URLSearchParams(qs || '').get('subject') || 'unsubscribe';
                how = h('button.key.key--sm', { type: 'button', onclick: async () => { await K.copyText(decodeURIComponent(addr)); toast('Адрес скопирован — отправь на него письмо с темой «' + subj + '»'); } }, 'Скопировать адрес отписки');
              } else how = h('span.unote', 'ссылка без https — отпишись из самого письма в почте');
            }
            return h('article.urow.uunsub' + (isDone(l) ? '.is-done' : ''),
              h('label.uunsub__pick', pick, h('span.urow__main', h('b', who(l)), h('span.urow__what', 'писем: ' + l.count + ' · последнее ' + (ru(l.last) || '—') + (l.oneClick ? ' · отписка в один клик' : '')))),
              h('div.urow__act', how, rr ? h('span.unote' + (rr.ok ? '.unote--ok' : '.unote--due'), rr.ok ? 'запрос отписки принят' : 'не вышло: ' + (rr.err || rr.status)) : null,
                seg([['', 'не отписан'], ['done', 'отписался']], m ? m.s : '', async (v) => { await ctx.mark(k, v); paint(); })));
          };
          const paint = () => { list.replaceChildren(...lists.slice(0, 500).map(row)); sync(); };
          box.replaceChildren(mailSummary(r, 'Рассылок: ' + lists.length + ' · с отпиской в один клик: ' + one.length),
            h('div.row', h('button.key.key--sm', { type: 'button', onclick: () => { one.forEach((l) => { if (!isDone(l)) sel.add(l.https); }); paint(); } }, 'Выбрать все с отпиской в один клик'),
              h('button.key.key--sm', { type: 'button', onclick: () => { sel.clear(); paint(); } }, 'Снять выбор'), go,
              h('button.key.key--sm', { type: 'button', onclick: () => { mailRes = null; box.replaceChildren(mailPicker(draw)); } }, 'Другая выгрузка')),
            lists.length ? list : h('p.muted', 'Рассылок не нашлось.'));
          paint();
        };
        if (mailRes) draw(mailRes); else box.append(mailPicker(draw));
        return box;
      },
    },
    u09: {
      what: ['В старых объявлениях и резюме остаются телефон, ФИО, фото, адрес и места работы. Их видят все, а ещё их копируют сайты-агрегаторы и базы «пробива».',
        'Здесь — куда зайти на каждом сайте, чтобы удалить объявления и резюме, а если аккаунт не нужен — и сам профиль.'],
      steps: ['Открой сайт и войди в аккаунт.', 'Удали объявления и резюме — в том числе из архива: снятые с публикации объявления часто хранятся там годами.',
        'Если аккаунт больше не нужен — удали профиль.', 'Отметь «сделал».'],
      happens: ['Приложение только открывает сайты в твоём браузере и показывает шаги.',
        'Удаление профиля обычно необратимо: пропадут отзывы, рейтинг и история.',
        'Работодатели, которые уже скачали твоё резюме, хранят копии у себя — у них удалить можно только требованием по 152-ФЗ.',
        'После удаления проверь свой номер в «Анонимном поиске»: старые объявления могли скопировать другие сайты.'],
      progress: () => { const n = ADS.filter((x) => (markOf('ads:' + x.id) || {}).s === 'done').length; return n ? 'сделано ' + n + ' из ' + ADS.length : null; },
      render(ctx) { return siteList(ctx, 'ads', ADS); },
    },
    u10: {
      what: ['Старые соцсети, блоги и форумы живут дольше, чем кажется: страницы из 2008 года с фото, школой и друзьями до сих пор находятся поиском по имени.',
        'Здесь — как удалить или закрыть старые страницы в популярных сервисах тех лет и как найти свои старые ники.'],
      steps: ['Вспомни, где был зарегистрирован: проверь список ниже и поищи свои старые ники.', 'Восстанови доступ (обычно по почте или номеру) и удали страницу по шагам из карточки.',
        'Если удалить нельзя — напиши администрации требование по 152-ФЗ: шаблон есть в разделе «След в интернете» → «Требование об удалении».'],
      happens: ['Приложение открывает сайты в твоём браузере. Поиск ника идёт через «Анонимный поиск» — через приватное соединение, без истории.',
        'Удалённую страницу какое-то время можно восстановить — потом она исчезает насовсем.',
        'Копии страниц могут остаться в кэше поисковиков — для них есть утилита «Старые страницы в поиске».'],
      progress: () => { const n = OLD.filter((x) => (markOf('old:' + x.id) || {}).s === 'done').length; return n ? 'сделано ' + n + ' из ' + OLD.length : null; },
      render(ctx) {
        const nick = h('input.field.grow', { placeholder: 'старый ник или адрес почты, например ivan_1999', spellcheck: 'false', autocomplete: 'off', 'aria-label': 'Ник или почта' });
        const find = () => { const v = nick.value.trim().replace(/"/g, ''); if (!v) { nick.focus(); return; } toSearch('"' + v + '"'); };
        nick.addEventListener('keydown', (e) => { if (e.key === 'Enter') find(); });
        return h('div.stack',
          h('article.plate.uform', h('b', 'Найти свои старые страницы по нику'), h('p.muted', 'Ник в кавычках ищется через «Анонимный поиск» — так находятся профили на старых форумах и в блогах.'),
            h('div.row', nick, h('button.key.key--snow', { type: 'button', onclick: find }, 'Искать'))),
          siteList(ctx, 'old', OLD),
          h('article.plate.uaside', h('b', 'А ICQ?'), h('p', 'ICQ закрылась летом 2024 года — аккаунты удалены вместе с сервисом, там ничего делать не нужно.')));
      },
    },
    u11: {
      what: ['Голосовые помощники хранят записи того, что ты им говорил, — иногда годами. Часть записей прослушивают люди, чтобы улучшать распознавание речи.',
        'Здесь — где у каждого помощника лежит история голосовых запросов, как стереть её целиком и выключить хранение новых записей.'],
      steps: LIST_STEPS,
      happens: ['Приложение только открывает страницы сервисов в твоём браузере и показывает шаги. Настройки Windows открываются в «Параметрах» — меняешь их ты сам.',
        'Удаление истории необратимо. Первое время помощник может хуже понимать твой голос.',
        'Колонки и умные устройства слушают слово-активацию и после удаления истории. Надёжнее всего — кнопка выключения микрофона на самом устройстве.'],
      progress: () => listProgress('voice', VOICE),
      render(ctx) { return siteList(ctx, 'voice', VOICE); },
    },
    u12: {
      what: ['Телефон, карты и компьютер записывают, где ты бываешь: дом, работа, маршруты, время. По такой истории легко восстановить весь распорядок дня.',
        'Здесь — где эта история хранится у Google, Apple, Яндекса и Windows и как удалить её целиком.'],
      steps: LIST_STEPS,
      happens: ['Приложение только открывает страницы и настройки и показывает шаги — само ничего не удаляет.',
        'Удалённую историю не вернуть: исчезнут и подсказки вроде «Вы были здесь» и воспоминания о поездках.',
        'Если выключить запись местоположения, карты и такси продолжат работать — просто без истории.'],
      progress: () => listProgress('geo', GEO),
      render(ctx) {
        return h('div.stack', siteList(ctx, 'geo', GEO),
          h('article.plate.uaside', h('b', 'А фотографии?'),
            h('p', 'Фото с телефона хранят координаты места съёмки. Перед отправкой их стоит стереть — для этого есть раздел «Метаданные».'),
            h('div.row', h('button.key.key--sm', { type: 'button', onclick: () => { if (A.go) A.go('meta'); } }, 'Открыть «Метаданные» →'))));
      },
    },
    u13: {
      what: ['Рекламные сервисы составляют на тебя профиль: интересы, возраст, доход, семейное положение, недавние покупки. Его можно посмотреть — часто он неожиданно точный.',
        'Здесь — где посмотреть свой рекламный профиль у Google, Яндекса, Meta и Microsoft, как запретить персонализацию и сбросить рекламный идентификатор на компьютере и телефоне.'],
      steps: LIST_STEPS,
      happens: ['Приложение только открывает страницы и настройки и показывает шаги.',
        'Рекламы меньше не станет — она просто перестанет подстраиваться под тебя.',
        'Сервисы продолжают собирать данные для других целей. Блокировать трекеры на сайтах помогают «Рентген» во встроенном просмотре и слой «Браузер».'],
      progress: () => listProgress('adprof', ADPROF),
      render(ctx) { return siteList(ctx, 'adprof', ADPROF); },
    },
    u14: {
      what: ['Каждый раз, когда ты входишь на сайт «через Google», «через VK» или даёшь приложению доступ к почте, это приложение получает ключ к части твоего аккаунта — и часто сохраняет его на годы.',
        'Здесь — страницы, где у каждого сервиса виден список приложений с доступом. Убери всё, чем не пользуешься: забытое приложение — частый путь утечки.'],
      steps: LIST_STEPS,
      happens: ['Приложение только открывает страницы сервисов в твоём браузере.',
        'Отзыв доступа не удаляет твой аккаунт на том сайте — его удаляют на самом сайте.',
        'В приложение, у которого отозван доступ, придётся войти заново, если оно ещё нужно.'],
      progress: () => listProgress('oauth', OAUTH),
      render(ctx) { return siteList(ctx, 'oauth', OAUTH); },
    },
    u15: {
      what: ['Если кто-то знает твой пароль или когда-то входил с твоего телефона, сеанс может оставаться открытым месяцами. В списке активных входов видно все устройства, где открыт аккаунт.',
        'Здесь — где посмотреть активные входы в популярных сервисах и одним нажатием завершить все, кроме своего.'],
      steps: LIST_STEPS,
      happens: ['Приложение только открывает страницы сервисов в твоём браузере и показывает шаги.',
        '«Выйти везде» выкинет и тебя на других твоих устройствах — там придётся войти заново.',
        'Если видишь вход, который сделал не ты, сначала смени пароль и включи двухфакторную защиту, а потом заверши сеансы — иначе злоумышленник войдёт снова.'],
      progress: () => listProgress('sess', SESS),
      render(ctx) {
        return h('div.stack', siteList(ctx, 'sess', SESS),
          h('article.plate.uaside', h('b', 'Нашёл чужой вход?'),
            h('p', 'Смени пароль этого аккаунта и почты, к которой он привязан, включи вход с подтверждением через приложение-аутентификатор и только потом заверши все сеансы. Не засветился ли пароль в утечках — можно проверить в разделе «Утечки паролей».'),
            h('div.row', h('button.key.key--sm', { type: 'button', onclick: () => { if (A.go) A.go('leaks'); } }, 'Открыть «Утечки паролей» →'))));
      },
    },
    u16: {
      what: ['Друзья и знакомые отмечают тебя на своих фото — и по этим отметкам видно, где ты был, с кем общаешься и как выглядишь сейчас, даже если твой профиль закрыт.',
        'Здесь — как снять отметки с уже опубликованных фото и сделать так, чтобы новые появлялись только с твоего согласия.'],
      steps: LIST_STEPS,
      happens: ['Приложение только открывает страницы соцсетей в твоём браузере и показывает шаги.',
        'Снятая отметка убирает с фото твоё имя, но сам снимок остаётся у автора: удалить его может только он или модераторы по жалобе.',
        'Если фото с тобой выложили без разрешения, его можно потребовать удалить: изображение человека охраняется законом (статья 152.1 ГК РФ). Пожалуйся через кнопку жалобы в соцсети.'],
      progress: () => listProgress('tags', TAGS),
      render(ctx) { return siteList(ctx, 'tags', TAGS); },
    },
    u17: {
      what: ['Не каждый аккаунт можно удалить: у старых форумов и некоторых сервисов нет такой кнопки, а где-то к аккаунту привязаны покупки или переписка. Но почти везде можно убрать из него всё, что указывает на тебя.',
        'Утилита — пошаговый мастер: что и на что поменять перед уходом, нейтральный ник одной кнопкой и список твоих аккаунтов с отметкой «обезличен».'],
      steps: ['Добавь аккаунт в список ниже.', 'Пройди шаги мастера на сайте этого сервиса: фото, имя, дата рождения, почта и телефон, посты и переписка, выход.', 'Отметь «обезличен» и больше не входи в этот аккаунт.'],
      happens: ['Сам аккаунт приложение не трогает — данные меняешь ты на сайте сервиса.',
        'Список аккаунтов хранится только на этом компьютере: в нём только названия, которые ты ввёл.',
        'Удалённые посты и сообщения могут остаться в копиях у собеседников и в поисковиках — для поисковиков есть утилита «Старые страницы в поиске».',
        'Если сервис не даёт ничего менять, отправь ему требование удалить данные по 152-ФЗ: шаблон — в «След в интернете» → «Требование об удалении».'],
      progress: () => { const M = Object.entries(store.marks || {}).filter(([k]) => k.startsWith('anon:')), d = M.filter(([, m]) => m.s === 'done').length; return M.length ? 'обезличено ' + d + ' из ' + M.length : null; },
      render(ctx) {
        const nk = h('code.unick.selectable', nick());
        const gen = h('div.row', nk, h('button.key.key--sm', { type: 'button', onclick: () => { nk.textContent = nick(); } }, 'Придумать ник'),
          h('button.key.key--sm', { type: 'button', onclick: async () => { await K.copyText(nk.textContent); toast('Ник скопирован'); } }, 'Скопировать'));
        const name = h('input.field.grow', { placeholder: 'аккаунт: например, старый форум или сервис', maxlength: '80', spellcheck: 'false', autocomplete: 'off', 'aria-label': 'Название аккаунта' });
        const list = h('div.stack');
        const keyOf = (s) => 'anon:' + slug(translit(s)).slice(0, 34) + '-' + (Array.from(s).reduce((a, c) => (a * 31 + c.codePointAt(0)) >>> 0, 7) % 1296).toString(36);
        const draw = () => {
          const M = Object.entries(store.marks || {}).filter(([k]) => k.startsWith('anon:')).sort((a, b) => String(b[1].at).localeCompare(String(a[1].at)));
          list.replaceChildren(...(M.length ? M.map(([k, m]) => h('article.urow', h('div.urow__main', h('b', m.label || k.slice(5)), h('span.urow__what', m.s === 'done' ? 'обезличен ' + ru(m.at) : 'добавлен ' + ru(m.at))),
            h('div.urow__act', seg([['keep', 'в работе'], ['done', 'обезличен']], m.s, async (v) => { await ctx.mark(k, v, 0, m.label); draw(); }),
              h('button.vrow__btn.vrow__del', { type: 'button', onclick: async () => { await ctx.mark(k, ''); draw(); } }, 'убрать из списка')))) : [h('p.muted', 'Список пуст. Добавь аккаунт, который нельзя удалить.')]));
        };
        const add = async () => {
          const v = name.value.trim(); if (!v) { name.focus(); return; }
          await ctx.mark(keyOf(v), 'keep', 0, v); name.value = ''; draw();
        };
        name.addEventListener('keydown', (e) => { if (e.key === 'Enter') add(); });
        draw();
        return h('div.stack',
          h('article.plate.uform', h('b', 'Нейтральный ник'), h('p.muted', 'Случайное сочетание слов и цифр: ни имени, ни года рождения. Для каждого аккаунта — свой.'), gen),
          h('article.plate.uform', h('b', 'Что поменять перед уходом'), h('ol.usteps', ANON_STEPS.map(([t, d]) => h('li', h('b', t + '. '), d)))),
          h('article.plate.uform', h('b', 'Мои аккаунты'), h('div.row', name, h('button.key.key--snow', { type: 'button', onclick: add }, 'Добавить')), list));
      },
    },
    u18: {
      what: ['Псевдоним — отдельный адрес почты для каждого сайта: письма с него приходят в твой обычный ящик. Сайт не узнает настоящий адрес, а если на псевдоним пошёл спам — сразу видно, кто слил почту, и псевдоним можно просто выключить.',
        'Здесь — проверенные сервисы псевдонимов и журнал: какой псевдоним где использован. Журнал хранится в «Хранилище данных» — в зашифрованном виде, если на хранилище стоит пароль.'],
      steps: ['Выбери сервис псевдонимов и заведи в нём аккаунт — с той почтой, куда должны приходить письма.', 'Для каждого нового сайта создавай свой псевдоним.',
        'Записывай в журнал ниже: псевдоним → сайт. Если на псевдоним пошёл спам, по журналу видно, откуда утечка.'],
      happens: ['Приложение открывает сайты сервисов в твоём браузере и ведёт журнал в «Хранилище данных» на этом компьютере — в сеть журнал не уходит.',
        'Сервис псевдонимов видит, от кого и кому идут письма. Выбирай тот, которому доверяешь: у SimpleLogin, addy.io и Firefox Relay открытый код.',
        'Если закрыть аккаунт в сервисе псевдонимов, письма на псевдонимы перестанут приходить — сначала перенеси важные аккаунты на основной адрес.'],
      progress: () => listProgress('alias', ALIASES),
      render(ctx) {
        const alias = h('input.field.grow', { type: 'email', placeholder: 'псевдоним, например shop.x7@simplelogin.com', maxlength: '120', spellcheck: 'false', autocomplete: 'off', 'aria-label': 'Псевдоним' });
        const site = h('input.field.grow', { placeholder: 'где используется: сайт или магазин', maxlength: '200', spellcheck: 'false', autocomplete: 'off', 'aria-label': 'Где используется' });
        const prov = h('select.field.uprov', { 'aria-label': 'Сервис псевдонимов' }, ALIASES.map((a) => h('option', { value: a.name }, a.name)).concat(h('option', { value: '' }, 'другой')));
        const pw = h('input.field.grow', { type: 'password', placeholder: 'пароль хранилища', autocomplete: 'off', 'aria-label': 'Пароль хранилища' });
        const lockRow = h('div.row', pw, h('button.key.key--sm', { type: 'button', onclick: () => unlock() }, 'Открыть хранилище')); lockRow.hidden = true;
        const st = h('p.umail__status', { 'aria-live': 'polite' }), list = h('div.stack');
        async function unlock() {
          const r = await K.vaultUnlock(pw.value); pw.value = '';
          if (!r.ok) { st.textContent = r.err || 'Не получилось открыть хранилище'; st.classList.add('is-bad'); return; }
          lockRow.hidden = true; st.textContent = ''; if (A.refreshStatus) A.refreshStatus(); load();
        }
        async function load() {
          const r = await K.vaultAliases();
          if (r && r.locked) { lockRow.hidden = false; list.replaceChildren(h('p.muted', 'Хранилище заперто паролем — введи его, чтобы увидеть журнал.')); return; }
          const L = (r && r.list) || [];
          list.replaceChildren(...(L.length ? L.map((x) => h('article.urow', h('div.urow__main', h('b', x.alias), h('span.urow__what', 'для: ' + x.site + (x.provider ? ' · ' + x.provider : '') + ' · ' + ru(x.ts))),
            h('div.urow__act', h('div.row', h('button.key.key--sm', { type: 'button', onclick: async () => { await K.copyText(x.alias); toast('Псевдоним скопирован'); } }, 'Скопировать'),
              h('button.vrow__btn.vrow__del', { type: 'button', onclick: async () => { await K.vaultDelete([x.id]); load(); } }, 'удалить'))))) : [h('p.muted', 'Журнал пуст. Запиши первый псевдоним.')]));
        }
        async function save() {
          st.classList.remove('is-bad'); st.textContent = '';
          const r = await K.vaultAliasAdd({ alias: alias.value, site: site.value, provider: prov.value });
          if (r && r.locked) { lockRow.hidden = false; pw.focus(); st.textContent = 'Хранилище заперто паролем — введи его и нажми «Записать» ещё раз.'; return; }
          if (!r || !r.ok) { st.textContent = (r && r.err) || 'Не получилось записать'; st.classList.add('is-bad'); return; }
          alias.value = ''; site.value = ''; toast('Записано в «Хранилище данных»', 'ok'); load();
        }
        load();
        return h('div.stack', siteList(ctx, 'alias', ALIASES),
          h('article.plate.uform', h('b', 'Журнал псевдонимов'), h('div.row', alias, site), h('div.row', prov, h('button.key.key--snow', { type: 'button', onclick: save }, 'Записать')), lockRow, st, list));
      },
    },
    u19: {
      what: ['Фото с iPhone сохраняются в формате HEIC — и в нём то же, что и в обычных JPEG: координаты места съёмки, модель телефона, дата и время, программа, служебные данные камеры, уникальный номер снимка. Многие программы этого не показывают, поэтому кажется, что данных нет.',
        'Утилита показывает всё это по полям и стирает — целиком или по одному полю. Работает и с форматами WebP и AVIF, а также с обычными JPEG и PNG.'],
      steps: ['Перетащи фото сюда или нажми «Выбрать файлы».', 'Посмотри, что записано в каждом снимке: место съёмки помечено отдельно.',
        'Нажми «удалить» у поля, «Удалить метаданные» у всего снимка или «Чистая копия» — тогда оригинал останется как был.'],
      happens: ['Всё происходит на этом компьютере: фото никуда не отправляются.',
        '«Удалить метаданные» и «удалить» у поля меняют сам файл, без копии — вернуть стёртое нельзя. Картинка и её поворот не меняются, дата файла сохраняется.',
        '«Чистая копия» создаёт рядом файл с пометкой «-чистый», оригинал не трогается.',
        'Перед заменой новый файл проверяется: если он не читается, оригинал остаётся как был.'],
      render() {
        return h('div.stack', window.META_PANEL ? window.META_PANEL({ what: 'photo', hint: 'HEIC, HEIF, AVIF, WebP, а также JPEG и PNG' }) : h('p.plate.warn', 'Раздел «Метаданные» не загрузился'),
          h('article.plate.uaside', h('b', 'Чтобы iPhone не записывал место'),
            h('p', '«Настройки» → «Конфиденциальность и безопасность» → «Службы геолокации» → «Камера» → «Никогда». А когда отправляешь снимок из «Фото», нажми «Параметры» и выключи «Геопозиция».')));
      },
    },
    u20: {
      what: ['Записи диктофона и другие аудиофайлы хранят теги: название (диктофон iPhone часто называет запись адресом, где она сделана), программу и устройство записи, дату, иногда координаты.',
        'Утилита показывает эти теги в файлах MP3, M4A и FLAC и стирает их — целиком или по одному. Сам звук не меняется.'],
      steps: ['Перетащи записи сюда или нажми «Выбрать файлы».', 'Посмотри, что записано в каждом файле.', 'Нажми «удалить» у поля, «Удалить метаданные» у всего файла или «Чистая копия».'],
      happens: ['Всё происходит на этом компьютере: записи никуда не отправляются.',
        '«Удалить метаданные» и «удалить» у поля меняют сам файл, без копии — вернуть стёртое нельзя. Звук не меняется, дата файла сохраняется.',
        'В M4A и FLAC стёртое место заполняется пустотой того же размера, а в MP3 тег удаляется целиком — звук при этом не трогается.',
        'Название записи в диктофоне iPhone хранится ещё и в самом приложении «Диктофон» — переименуй запись там, если будешь делиться ею снова.'],
      render() {
        return h('div.stack', window.META_PANEL ? window.META_PANEL({ what: 'audio', hint: 'MP3, M4A, FLAC' }) : h('p.plate.warn', 'Раздел «Метаданные» не загрузился'),
          h('article.plate.uaside', h('b', 'Чтобы диктофон iPhone не называл записи адресом'),
            h('p', '«Настройки» → «Диктофон» → выключи «Названия по геопозиции». Новые записи будут называться «Новая запись» с номером.')));
      },
    },
  };

  /* ---------- окно утилиты: сначала справка, потом действия ---------- */
  let sheetOpen = null, refreshList = null;   // refreshList — обновить карточки раздела после закрытия окна
  function closeSheet() { if (sheetOpen) sheetOpen(); }
  function sheet(u, onClose) {
    closeSheet();
    if (!onClose) onClose = () => { if (refreshList) refreshList(); };
    const impl = u.ready ? IMPL[u.id] : null, cat = CAT[u.cat], risk = D.risks[u.r];
    const back = document.activeElement;
    const ctx = {
      mark: async (key, s, days, label) => { store = await K.utilMark(key, s, days || 0, label || ''); return store; },
      addReq: async (r, quiet) => { store = await K.utilReqAdd(r); toast(quiet ? 'Запрос добавлен — срок ответа посчитан' : 'Добавлено в «Трекер запросов на удаление»', 'ok'); return store; },
      setReq: async (id, p) => { store = await K.utilReqSet(id, p); return store; },
      delReq: async (id) => { store = await K.utilReqDel(id); return store; },
    };
    let actions;
    try { actions = impl ? impl.render(ctx) : null; } catch (e) { actions = h('p.plate.warn', 'Утилита не открылась: ' + e.message); }
    const help = impl ? [
      h('section.usec', h('p.k', 'Что делает'), impl.what.map((p) => h('p', p))),
      impl.steps ? h('section.usec', h('p.k', 'Как пользоваться'), h('ol.usteps', impl.steps.map((s) => h('li', s)))) : null,
      h('section.usec.usec--warn', h('p.k', 'Что произойдёт'), h('ul.uhappen', impl.happens.map((s) => h('li', s)))),
    ] : [
      h('section.usec', h('p.k', 'Что будет делать'), h('p', u.d || u.s)),
      h('section.usec.usec--warn', h('p.k', 'Что произойдёт'), h('ul.uhappen', h('li', risk.text))),
    ];
    const x = h('button.vbtn.usheet__x', { type: 'button', title: 'Закрыть (Esc)', 'aria-label': 'Закрыть' }, '✕');
    const panel = h('div.usheet__panel', { role: 'dialog', 'aria-modal': 'true', 'aria-label': u.t, tabindex: '-1', style: { '--c': cat.color } },
      h('div.usheet__top', h('span.unum', num(u.n)), h('span.k', cat.icon + ' ' + cat.name), h('span.uchip' + (u.ready ? '.uchip--ready' : '.uchip--soon'), u.ready ? 'готово' : 'скоро'), x),
      h('h2.usheet__title', u.t),
      h('p.usheet__lead', u.s),
      h('div.urisk.urisk--' + risk.tone, h('i'), h('b', risk.label), h('span', risk.text)),
      help,
      h('div.usheet__divider', h('span', impl ? 'Действия' : 'В работе')),
      impl ? actions : h('div.plate.usoon', h('b', 'Эта утилита ещё в работе'), h('p.muted', 'Утилиты появляются по пять за раз. Когда эта будет готова, здесь появятся кнопки, а в списке — отметка «готово».')));
    const el = h('div.usheet', panel);
    el.addEventListener('mousedown', (e) => { if (e.target === el) close(); });
    const onKey = (e) => { if (e.key === 'Escape' && document.getElementById('modal').hidden) { e.preventDefault(); close(); } };
    function close() {
      if (sheetOpen !== close) return;
      sheetOpen = null; A.closeSheet = null;
      document.removeEventListener('keydown', onKey); el.remove();
      if (back && back.isConnected) back.focus();
      if (onClose) onClose();
    }
    x.addEventListener('click', close);
    document.addEventListener('keydown', onKey);
    document.body.append(el);
    sheetOpen = close; A.closeSheet = close;
    panel.focus({ preventScroll: true });   // фокус сразу в окне: Esc и Tab работают внутри него
  }

  /* ---------- раздел «Утилиты»: поиск, группы, список ---------- */
  function screen(opts) {
    const s = h('section.screen.utils', head(['Утилиты', READY + ' готово из ' + D.list.length], 'Утилиты', 'для защиты',
      'Небольшие помощники для конкретных дел: убрать себя из интернета, стереть следы, проверить файлы перед отправкой, настроить сеть и аккаунты. Нажми на утилиту — сначала будет справка: что она делает и что произойдёт. Кнопки — после неё.'));
    const input = h('input.field.grow.usearch', { type: 'search', placeholder: 'Найти утилиту: «телефон», «Google», «флешка», «PDF», «12»…', spellcheck: 'false', autocomplete: 'off', 'aria-label': 'Поиск утилит' });
    const readyOnly = h('input', { type: 'checkbox' });
    const cats = h('div.ucats', { role: 'group', 'aria-label': 'Группы утилит' });
    const count = h('p.k.ucount'), list = h('div.ulist');
    let cat = null, q = '';
    const fresh = D.list.filter((u) => u.ready);
    // после закрытия окна утилиты — свежие отметки и запросы для счётчиков на карточках
    const afterSheet = () => K.utilGet().then((d) => { if (d) store = d; drawList(); }).catch(() => drawList());
    refreshList = afterSheet;
    s.append(
      h('div.usearchbar', h('div.row.usearch__row', h('span.usearch__ico', '⌕'), input), h('div.utoolbar', cats, h('label.uready', readyOnly, h('span', 'только готовые')))),
      h('div.plate.unew', h('div.tool__head', h('b', 'Готовы сейчас'), h('span', 'новые появляются по пять')),
        h('div.unew__list', fresh.map((u) => h('button.unew__item', { type: 'button', style: { '--c': CAT[u.cat].color }, onclick: () => sheet(u, afterSheet) }, h('span.unum', num(u.n)), h('span', u.t)))),
        h('div.uprog', h('div.gauge', h('i', { style: { width: (READY / D.list.length * 100) + '%' } })), h('span.k', 'готово ' + READY + ' из ' + D.list.length)),
        h('div.row', h('button.key.key--accent', { type: 'button', onclick: () => window.CHECK_ALL && window.CHECK_ALL.open() }, 'Проверить всё одной кнопкой'), h('span.muted', 'система, файлы, следы, запросы и номер — один отчёт'))),
      count, list);

    const tokens = () => norm(q).split(/[\s,.;:!?«»"'()]+/).map((t) => t.replace(/^#/, '')).filter((t) => t.length >= 2 || /^\d$/.test(t));
    function score(u, T) {
      if (!T.length) return 1;
      const title = norm(u.t), short = norm(u.s), more = norm(u.k + ' ' + (u.d || '') + ' ' + CAT[u.cat].name);
      let sc = 0;
      for (const t of T) {
        if (/^\d+$/.test(t)) { if (Number(t) === u.n) { sc += 20; continue; } return 0; }
        if (title.includes(t)) sc += 6; else if (short.includes(t)) sc += 3; else if (more.includes(t)) sc += 2; else return 0;
      }
      return sc + (u.ready ? 1 : 0);
    }
    // подсветка найденных слов в названии без innerHTML
    function marked(text, T) {
      const words = T.filter((t) => !/^\d+$/.test(t));
      if (!words.length) return text;
      const re = new RegExp('(' + words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')', 'gi');
      const n = norm(text), out = []; let last = 0, m;
      while ((m = re.exec(n))) { if (m.index > last) out.push(text.slice(last, m.index)); out.push(h('mark', text.slice(m.index, m.index + m[0].length))); last = m.index + m[0].length; if (!m[0].length) re.lastIndex++; }
      if (last < text.length) out.push(text.slice(last));
      return out;
    }
    function card(u, T, showCat) {
      const c = CAT[u.cat], r = D.risks[u.r], impl = u.ready ? IMPL[u.id] : null;
      let prog = null; try { prog = impl && impl.progress ? impl.progress() : null; } catch (e) { prog = null; }
      return h('button.ucard' + (u.ready ? '' : '.is-soon'), { type: 'button', style: { '--c': c.color }, 'data-id': u.id, 'aria-label': num(u.n) + ' ' + u.t + (u.ready ? '' : ', скоро') + '. ' + u.s, onclick: () => sheet(u, afterSheet) },
        h('span.ucard__num', num(u.n)), h('span.ucard__ico', c.icon),
        h('span.ucard__main', h('b.ucard__title', marked(u.t, T)), h('span.ucard__short', u.s),
          showCat ? h('span.ucard__cat', c.name) : null, prog ? h('span.ucard__prog', prog) : null),
        h('span.ucard__side', h('span.uchip' + (u.ready ? '.uchip--ready' : '.uchip--soon'), u.ready ? 'готово' : 'скоро'), h('span.urisk-dot.urisk--' + r.tone, r.label)));
    }
    function drawCats() {
      cats.replaceChildren(h('button.ucat', { type: 'button', 'aria-pressed': cat ? 'false' : 'true', style: { '--c': 'var(--snow)' }, onclick: () => { cat = null; drawCats(); drawList(); } }, 'Все', h('small', String(D.list.length))),
        ...D.cats.map((c) => h('button.ucat', { type: 'button', 'aria-pressed': cat === c.id ? 'true' : 'false', style: { '--c': c.color }, onclick: () => { cat = cat === c.id ? null : c.id; drawCats(); drawList(); } },
          h('span', c.icon), c.name, h('small', String(D.list.filter((u) => u.cat === c.id).length)))));
    }
    function drawList() {
      if (!s.isConnected && list.childNodes.length) return;
      const T = tokens();
      let items = D.list.filter((u) => (!cat || u.cat === cat) && (!readyOnly.checked || u.ready));
      if (T.length) {
        items = items.map((u) => [u, score(u, T)]).filter(([, sc]) => sc > 0).sort((a, b) => b[1] - a[1] || a[0].n - b[0].n).map(([u]) => u);
        count.textContent = items.length ? 'Найдено: ' + items.length + ' · Enter — открыть первую' : '';
        list.replaceChildren(items.length ? h('div.ugrid', items.map((u) => card(u, T, true)))
          : h('div.plate.uempty', h('b', 'Ничего не нашлось'), h('p.muted', 'Попробуй другое слово: например, «номер», «поиск», «фото», «Wi-Fi», «пароль» — или номер утилиты из списка идей.')));
        return;
      }
      count.textContent = (cat || readyOnly.checked) ? 'Показано: ' + items.length + ' из ' + D.list.length : '';
      list.replaceChildren(...D.cats.filter((c) => items.some((u) => u.cat === c.id)).map((c) => {
        const inCat = items.filter((u) => u.cat === c.id), all = D.list.filter((u) => u.cat === c.id);
        return h('section.ugroup', { style: { '--c': c.color } },
          h('div.ugroup__head', h('span.ugroup__n', c.n), h('b', c.icon + ' ' + c.name), h('span.k', all.filter((u) => u.ready).length + ' готово из ' + all.length)),
          h('div.ugrid', inCat.map((u) => card(u, T, false))));
      }));
    }
    let t;
    input.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => { q = input.value; drawList(); }, 120); });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { q = input.value; drawList(); const first = list.querySelector('.ucard'); if (first && tokens().length) first.click(); }
      if (e.key === 'ArrowDown') { const first = list.querySelector('.ucard'); if (first) { e.preventDefault(); first.focus(); } }
      if (e.key === 'Escape' && input.value && !sheetOpen) { e.stopPropagation(); input.value = ''; q = ''; drawList(); }
    });
    readyOnly.addEventListener('change', drawList);
    // «/» в любом месте раздела — к поиску
    const onSlash = (e) => { if (e.key === '/' && !sheetOpen && document.activeElement !== input && !/^(INPUT|TEXTAREA|SELECT)$/.test((document.activeElement || {}).tagName)) { e.preventDefault(); input.focus(); } };
    document.addEventListener('keydown', onSlash);
    const obs = new MutationObserver(() => { if (!s.isConnected) { document.removeEventListener('keydown', onSlash); obs.disconnect(); } });
    requestAnimationFrame(() => obs.observe(document.getElementById('viewIn'), { childList: true }));
    drawCats(); drawList();
    K.utilGet().then((d) => { if (d) store = d; drawList(); }).catch(() => {});
    if (opts && opts.open) { const u = D.list.find((x) => x.id === opts.open || x.n === Number(opts.open)); if (u) requestAnimationFrame(() => sheet(u, afterSheet)); }
    requestAnimationFrame(() => input.focus());
    return s;
  }

  // счётчик в меню: сколько утилит готово
  const cnt = document.getElementById('cnt-utils');
  if (cnt) { cnt.textContent = READY + '/' + D.list.length; cnt.title = 'готово утилит: ' + READY + ' из ' + D.list.length; }
  Object.assign(window.TOOLS, { utils: screen });
  window.UTILS_UI = { open: (id) => { const u = D.list.find((x) => x.id === id); if (u) sheet(u); }, close: closeSheet };
})();
