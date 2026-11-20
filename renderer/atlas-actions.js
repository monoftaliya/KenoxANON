/* Атлас → действия. Для каждого из 32 способов слежки: можно ли это стереть, чем именно и на какую страницу программы перейти.
   wipe: yes — данные лежат у тебя и стираются; part — стирается только часть; no — стирать нечего (вычисляется заново или хранится у других).
   erase.kind: browsers — стереть в закрытых браузерах; traces — стереть следы Windows; meta — выбрать файлы и стереть метаданные;
               wifi — забыть сети; letter — требование об удалении к владельцу данных; settings — кнопка удаления в Параметрах Windows. */
window.ATLAS_ACTIONS = {
  logs: { wipe: 'part', why: 'Логи хранятся на серверах сервисов, у тебя их нет. Стереть их можно только требованием к владельцу: по 152-ФЗ и GDPR он обязан удалить твои данные.', erase: { kind: 'letter', label: 'Потребовать удалить данные' }, go: { view: 'radar', label: 'Радар: кто сейчас видит твой IP' } },
  timestamp: { wipe: 'part', why: 'Время внутри файлов — дата съёмки фото, даты создания и правки документов, время записи видео — стирается. Метки в журналах сервисов и в отправленных сообщениях остаются у них.', erase: { kind: 'meta', label: 'Выбрать файлы и стереть даты' }, go: { view: 'layer-9', label: 'Поведение: разделение по времени' } },
  hash: { wipe: 'no', why: 'Хэш не хранится у тебя — его вычисляют из почты, телефона или файла. Стереть нельзя: меняется только сам исходник — новый адрес-алиас или новый пароль.', go: { view: 'leaks', label: 'Проверить пароли в утечках' } },
  pixel: { wipe: 'part', why: 'Факт открытия письма уже у отправителя. Но пиксель оставляет в кэше браузера метку ETag, по которой узнаёт тебя повторно, — её можно стереть.', erase: { kind: 'browsers', what: { cache: true }, label: 'Стереть кэш браузеров' }, go: { view: 'layer-6', label: 'Связь: почта без пикселей' } },
  exif: { wipe: 'yes', why: 'Метаданные лежат внутри твоих фото и видео: координаты, время, камера. Приложение стирает их из самих файлов — целиком или по одному полю.', erase: { kind: 'meta', label: 'Выбрать фото и стереть EXIF' }, go: { view: 'layer-8', label: 'Слой 08: метаданные и следы' } },
  prnu: { wipe: 'no', why: 'Шум матрицы — это сами пиксели снимка, а не метаданные: очистка EXIF его не убирает. Мешают только сильное уменьшение и сжатие или съёмка другим устройством.', go: { view: 'meta', label: 'Метаданные: убрать хотя бы EXIF' } },
  fingerprint: { wipe: 'part', why: 'Сам отпечаток не хранится — его снимают заново при каждом визите. Но скрипты отпечатка сохраняют найденный ID в хранилищах сайтов, чтобы узнавать быстрее, — эти метки стираются.', erase: { kind: 'browsers', what: { cookies: true }, label: 'Стереть данные сайтов' }, go: { view: 'layer-5', label: 'Слой 05: браузер и отпечаток' } },
  canvas: { wipe: 'no', why: 'Это не данные на диске: картинку рисуют и измеряют прямо во время визита. Стирать нечего — помогает только браузер, который у всех выдаёт одинаковый результат.', go: { view: 'layer-5', opts: { focus: 'browser' }, label: 'Приватный браузер' } },
  audio: { wipe: 'no', why: 'Звук синтезируется и измеряется заново при каждом визите — на диске ничего не остаётся. Защита — браузер с одинаковым для всех результатом.', go: { view: 'layer-5', opts: { focus: 'browser' }, label: 'Приватный браузер' } },
  fonts: { wipe: 'no', why: 'Сайт каждый раз заново измеряет, какие шрифты установлены. Стирать нечего; меньше лишних шрифтов в системе — меньше уникальность.', go: { view: 'layer-5', label: 'Слой 05: браузер и отпечаток' } },
  visited: { wipe: 'yes', why: 'Утечка возможна, пока в браузере есть история посещений. Её и стираем: историю, список посещённых ссылок, вкладки и подсказки адресной строки.', erase: { kind: 'browsers', what: { history: true }, label: 'Стереть историю браузеров' }, go: { view: 'browsers', opts: { what: { history: true } }, label: 'Браузеры' } },
  evercookie: { wipe: 'yes', why: 'Метка лежит сразу в десятке хранилищ браузера. Стирать нужно всё одновременно — cookies, хранилища сайтов, кэш и историю, — иначе она восстановится из уцелевшего.', erase: { kind: 'browsers', what: { cache: true, cookies: true, history: true }, label: 'Стереть все хранилища' }, go: { view: 'browsers', opts: { what: { cache: true, cookies: true, history: true } }, label: 'Браузеры' } },
  hsts: { wipe: 'yes', why: 'Флаги HSTS хранятся в браузере (файл TransportSecurity). Они стираются вместе с cookies и данными сайтов.', erase: { kind: 'browsers', what: { cookies: true }, label: 'Стереть метки HSTS и cookies' }, go: { view: 'browsers', opts: { what: { cookies: true } }, label: 'Браузеры' } },
  favicon: { wipe: 'yes', why: 'Метка живёт в отдельном кэше значков сайтов (Favicons). Он стирается вместе с историей и кэшем.', erase: { kind: 'browsers', what: { history: true, cache: true }, label: 'Стереть кэш значков' }, go: { view: 'browsers', opts: { what: { history: true, cache: true } }, label: 'Браузеры' } },
  tls: { wipe: 'part', why: 'Билеты TLS-сессий браузер держит в памяти: они исчезают, когда браузер полностью закрыт. Заодно стоит стереть кэш и данные сайтов, где хранятся остальные метки.', erase: { kind: 'browsers', what: { cache: true, cookies: true }, label: 'Стереть кэш и данные сайтов' }, go: { view: 'browsers', opts: { what: { cache: true, cookies: true } }, label: 'Браузеры' } },
  cname: { wipe: 'yes', why: 'Трекер получает обычные cookies сайта — их можно стереть, как любые cookies. Чтобы метки не появлялись снова, нужен DNS с блокировкой трекеров.', erase: { kind: 'browsers', what: { cookies: true }, label: 'Стереть cookies' }, go: { view: 'layer-4', opts: { focus: 'dns' }, label: 'Зашифрованный DNS' } },
  correlation: { wipe: 'no', why: 'Сопоставление идёт на стороне наблюдателя по времени и объёму пакетов — на твоём компьютере ничего не хранится.', go: { view: 'radar', label: 'Радар: какие соединения идут сейчас' } },
  ja3: { wipe: 'no', why: 'Отпечаток TLS-рукопожатия вычисляется из каждого нового подключения — стирать нечего. Помогает популярный обновлённый браузер.', go: { view: 'layer-5', opts: { focus: 'browser' }, label: 'Приватный браузер' } },
  http: { wipe: 'no', why: 'Параметры HTTP/2 и HTTP/3 браузер отправляет в каждом подключении — это свойство программы, а не сохранённые данные.', go: { view: 'layer-5', opts: { focus: 'browser' }, label: 'Приватный браузер' } },
  p0f: { wipe: 'no', why: 'Параметры пакетов задаёт сама Windows, наблюдатель просто смотрит на них в сети. Стирать нечего.', go: { view: 'layer-4', label: 'Слой 04: сеть' } },
  tcpip: { wipe: 'no', why: 'Это ответы системы на чужие пакеты, а не данные на диске. Защита — закрытые порты и включённый брандмауэр.', go: { view: 'layer-4', opts: { focus: 'firewall' }, label: 'Брандмауэр' } },
  dpi: { wipe: 'no', why: 'Разбор трафика идёт на оборудовании провайдера. У себя стереть нечего — шифруй DNS и трафик.', go: { view: 'layer-4', opts: { focus: 'dns' }, label: 'Зашифрованный DNS' } },
  netflow: { wipe: 'no', why: 'Сводки о соединениях хранит провайдер или владелец сети, и закон часто обязывает его хранить их годами. Удалить их по просьбе нельзя.', go: { view: 'radar', label: 'Радар: что попадает в сводки' } },
  bgp: { wipe: 'no', why: 'Маршруты меняются в сетях операторов — к твоим данным это не относится. Защита — сквозное шифрование и проверка сертификатов.', go: { view: 'layer-4', label: 'Слой 04: сеть' } },
  dns: { wipe: 'yes', why: 'Кэш DNS на компьютере хранит адреса недавно открытых сайтов — его можно очистить. Кэш резолвера провайдера уходит из игры, только если перейти на зашифрованный DNS.', erase: { kind: 'traces', ids: ['dns'], label: 'Очистить кэш DNS' }, go: { view: 'layer-4', opts: { focus: 'dns' }, label: 'Зашифрованный DNS' } },
  keys: { wipe: 'part', why: 'То, что записали сайты, не стереть. Но Windows сама копит словарь набора и рукописного ввода для «персонализации» — его можно удалить и выключить сбор.', erase: { kind: 'settings', uri: 'ms-settings:privacy-speechtyping', label: 'Удалить словарь набора Windows ↗' }, go: { view: 'layer-7', opts: { focus: 'typing' }, label: 'Выключить сбор набора' } },
  mouse: { wipe: 'no', why: 'Движения мыши записываются на стороне сайтов и антифрод-систем — у тебя они не хранятся.', go: { view: 'layer-9', label: 'Слой 09: поведение' } },
  clock: { wipe: 'no', why: 'Уход часов — физическое свойство кварца в твоём устройстве. Это не данные, стереть нечего.', go: { view: 'layer-7', label: 'Слой 07: устройство' } },
  battery: { wipe: 'no', why: 'Уровень заряда считывается в момент визита и нигде у тебя не сохраняется. Современные браузеры этот API урезали.', go: { view: 'layer-5', label: 'Слой 05: браузер' } },
  sensors: { wipe: 'no', why: 'Погрешность датчиков — заводская калибровка железа, а не данные. Стирать нечего — не давай сайтам и приложениям доступ к датчикам и месту.', go: { view: 'layer-7', opts: { focus: 'location' }, label: 'Доступ к геопозиции' } },
  ultrasound: { wipe: 'no', why: 'Сигнал ловят приложения с доступом к микрофону, а связь устройств хранится у рекламных сетей. У себя стирать нечего — закрой лишним приложениям микрофон.', go: { view: 'spy', label: 'Кто подглядывал: микрофон' } },
  probes: { wipe: 'yes', why: 'Компьютер выкрикивает имена сохранённых сетей Wi‑Fi. Удали лишние сети — и выкрикивать будет нечего.', erase: { kind: 'wifi', label: 'Забыть сохранённые сети' }, go: { view: 'layer-4', opts: { focus: 'wifi' }, label: 'Сохранённые сети' } },
};

/* Выполнение кнопки «Стереть» из карточки атласа */
(function () {
  'use strict';
  const { h, toast, confirmBox, fmtBytes, plural } = window.UI;
  const K = window.kenox;
  const WHAT = { cache: 'кэш', cookies: 'cookies и данные сайтов с метками HSTS', history: 'история, вкладки и значки сайтов', forms: 'автозаполнение' };
  const from = (t, note) => ({ id: t.id, name: t.name, note });
  const done = (n) => { if (n) { window.APP.pulse(true); window.APP.refreshStatus(); } };

  async function eraseBrowsers(t, what) {
    const r = await K.browsers(), list = r && r.ok ? r.list : [];
    if (!list.length) { toast('Не нашёл браузеров, которые умею чистить', 'warn'); return; }
    const closed = list.filter((b) => !b.running), open = list.filter((b) => b.running);
    const parts = Object.keys(what).filter((k) => what[k]).map((k) => WHAT[k]);
    if (!closed.length) {
      const goThere = await confirmBox({ kicker: 'Браузеры открыты', title: 'Сначала закрой браузеры', ok: 'Открыть «Браузеры»', body: [h('p', 'Пока браузер работает, его файлы заняты: ' + open.map((b) => b.name).join(', ') + '. Закрой их полностью и нажми «Стереть» ещё раз.')] });
      if (goThere) window.APP.go('browsers', { what, from: from(t, 'отмечено то, что стирается для этого пункта') });
      return;
    }
    const ok = await confirmBox({ kicker: 'Удаление без корзины', title: 'Стереть в браузерах: ' + parts.join(', ') + '?', ok: 'Стереть насовсем', danger: true, body: [
      h('ul', closed.map((b) => h('li', b.name + (what.cache ? ' — кэш ' + fmtBytes(b.cache) : '')))),
      open.length ? h('p.warn', 'Открыты и будут пропущены: ' + open.map((b) => b.name).join(', ') + '. Закрой их и повтори, чтобы стереть и там.') : null,
      what.history && closed.some((b) => b.firefox) ? h('p.muted', 'Историю посещений Firefox хранит вместе с закладками — её стирай в самом Firefox: Ctrl+Shift+Del.') : null,
      what.cookies ? h('p.muted', 'После удаления cookies придётся заново войти на сайты.') : null,
      h('p.muted', 'Закладки, сохранённые пароли и расширения не трогаются. Пункт атласа: ' + t.name + '.')] });
    if (!ok) return;
    let freed = 0, n = 0; const fails = [];
    for (const b of closed) { const x = await K.browsersClean(b.id, what); if (x.ok) { n++; freed += x.freed || 0; } else fails.push(b.name + ': ' + (x.err || 'ошибка')); }
    toast(n ? 'Стёрто в ' + n + ' ' + plural(n, 'браузере', 'браузерах', 'браузерах') + (freed ? ' · освобождено ' + fmtBytes(freed) : '') : 'Ничего не стёрто', fails.length || !n ? 'warn' : 'ok');
    fails.forEach((f) => toast(f, 'bad'));
    done(n);
  }

  const UNIT = { dns: ['адрес', 'адреса', 'адресов'] };
  async function eraseTraces(t, ids) {
    const s = await K.tracesScan(), items = (s && s.ok ? s.items : []).filter((it) => ids.includes(it.id));
    const usable = items.filter((it) => !it.missing && !it.running);
    if (!usable.length) { toast(items.some((it) => it.running) ? 'Сначала закрой программу, которая держит эти файлы' : 'Стирать нечего — здесь пусто', 'warn'); return; }
    const amount = (it) => { const u = UNIT[it.id] || ['файл', 'файла', 'файлов']; return [it.count != null ? it.count + ' ' + plural(it.count, ...u) : null, it.size ? fmtBytes(it.size) : null].filter(Boolean).join(' · ') || 'сейчас'; };
    const ok = await confirmBox({ kicker: 'Удаление без возврата', title: usable.length === 1 ? 'Стереть «' + usable[0].title + '»?' : 'Стереть ' + usable.length + ' ' + plural(usable.length, 'вид', 'вида', 'видов') + ' следов?', ok: 'Стереть', danger: true, body: [
      h('ul', usable.map((it) => h('li', it.title + ' — ' + amount(it)))), h('p.muted', 'Пункт атласа: ' + t.name + '.')] });
    if (!ok) return;
    const r = await K.tracesClean(usable.map((it) => it.id)), good = r.results.filter((x) => x.ok);
    toast(good.length ? 'Стёрто: ' + usable.map((it) => '«' + it.title + '»').join(', ') : 'Не получилось: ' + ((r.results[0] && r.results[0].note) || 'ошибка'), good.length ? 'ok' : 'bad');
    done(good.length);
  }

  window.ATLAS_RUN = async function (t, act) {
    const A = window.APP;
    if (act.kind === 'browsers') return eraseBrowsers(t, act.what);
    if (act.kind === 'traces') return eraseTraces(t, act.ids);
    if (act.kind === 'meta') return A.go('meta', { pick: true, from: from(t, 'выбери фото, видео или документы — у каждого найденного поля будет кнопка «удалить»') });
    if (act.kind === 'wifi') return A.go('air', { from: from(t, 'нажми «Забыть» у сетей, которые больше не нужны') });
    if (act.kind === 'letter') return A.go('footprint', { tab: 'letter', kind: 'ru', from: from(t, 'данные на серверах удаляются по требованию к их владельцу') });
    if (act.kind === 'settings') { K.link(act.uri); toast('Открыл Параметры Windows: нажми там кнопку удаления'); }
  };
})();
