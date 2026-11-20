// «Удалить себя из баз»: куда писать и что. Адреса взяты из официальных политик конфиденциальности компаний
// (проверены 19 ноября 2026 года, ссылка на источник — в поле src). Письма — на английском: компании зарубежные.
const COMPANIES = [
  { id: 'truecaller', group: 'callers', name: 'Truecaller', email: 'rgo.india@truecaller.com', law: 'other', days: 30, who: 'Truecaller International LLP, Индия — для номеров не из ЕС',
    what: 'определитель номера: имена и метки к номерам из адресных книг пользователей', src: 'https://www.truecaller.com/privacy-policy', form: 'https://www.truecaller.com/unlisting',
    formHow: 'Страница удаления: введи номер в формате +7…, пройди проверку «я не робот». Номер пропадает из поиска обычно за сутки.',
    extra: 'This is also a request to exclude the number from Truecaller\'s search features, as described in section 4 of your Privacy Policy ("Unlisting and opt-out").' },
  { id: 'getcontact', group: 'callers', name: 'GetContact', email: 'support@getcontact.com', law: 'gdpr', who: 'Getverify LDA, Португалия (ЕС)',
    what: 'определитель номера: «теги» — как тебя записали другие люди', src: 'https://getcontact.com/privacy', form: null,
    formHow: 'Формы на сайте нет. Если у тебя стоит GetContact — удали аккаунт в приложении: «Настройки» → «Аккаунт».',
    extra: 'Your Privacy Policy (section 19.3) provides that people who are not Getcontact users may exercise these rights by contacting this address.' },
  { id: 'numbuster', group: 'callers', name: 'NumBuster', email: 'support@numbuster.com', law: 'other', days: 30, who: 'Goodline Softwares W.L.L., Бахрейн',
    what: 'определитель номера: имена, отзывы и рейтинг номера', src: 'https://numbuster.com/en/non-user-information/', form: 'https://numbuster.com/en/remove-personal-data/',
    formHow: 'Страница удаления данных: номер подтверждают через Telegram, WhatsApp или СМС. Иногда способы подтверждения временно недоступны — тогда поможет письмо.',
    extra: 'Your page for people who are not NumBuster users lists this address for deletion requests.' },
  { id: 'callapp', group: 'callers', name: 'CallApp', email: 'support@callapp.com', law: 'other', days: 30, who: 'CallApp Software Ltd., Израиль',
    what: 'определитель номера и записная книжка с именами из чужих контактов', src: 'https://callapp.com/privacy-policy/', form: 'https://www.callapp.com/unlist',
    formHow: 'Страница «Unlist»: введи номер с кодом страны и дождись письма с подтверждением.',
    extra: 'Section 8 of your Privacy Policy provides that collected information is deleted upon a request sent to this address.' },
  { id: 'eyecon', group: 'callers', name: 'Eyecon', email: 'privacy@instabridge.com', law: 'gdpr', who: 'Instabridge Sweden AB, Швеция (ЕС)',
    what: 'определитель номера с именами и фото', src: 'https://www.eyecon-app.com/privacy-policy/', form: null,
    formHow: 'Формы на сайте нет. Если у тебя стоит Eyecon — удали аккаунт в приложении: Account Settings → удаление аккаунта и данных.',
    extra: 'Your Privacy Policy lists this address for privacy and deletion requests concerning Eyecon.' },
  { id: 'syncme', group: 'callers', name: 'Sync.ME', email: 'privacy@sync.me', law: 'other', days: 30, who: 'Sync.Me Technologies Ltd., Израиль',
    what: 'определитель номера: имена и фото из соцсетей и чужих контактов', src: 'https://nllapps.com/apps/cb/sync-me/sync-me-privacy-policy.htm', form: 'https://www.sync.me/unsubscribe',
    formHow: 'Страница «Remove My Info»: имя, почта и номер. Обещают удалить за сутки.',
    extra: 'Section 5.2 of your Privacy Policy allows me to request deletion of my personal information by e-mail to this address.' },
  { id: 'hiya', group: 'callers', name: 'Hiya', email: 'dpo@hiya.com', law: 'other', days: 30, who: 'Hiya, Inc., США',
    what: 'определитель номера и защита от спама (в том числе в телефонах Samsung)', src: 'https://www.hiya.com/legal/app-data-protection-and-privacy-policy', form: null,
    formHow: 'Отдельной формы удаления нет — только письмо.', extra: 'Your Privacy Policy lists this address for contacting your Data Protection Officer.' },
  { id: 'spokeo', group: 'brokers', us: true, name: 'Spokeo', email: 'CustomerCare@spokeo.com', law: 'other', days: 45, who: 'Spokeo, Inc., США',
    what: 'сайт поиска людей: имена, адреса, телефоны, родственники', src: 'https://www.spokeo.com/privacy-policy', form: 'https://www.spokeo.com/optout',
    formHow: 'Форма удаления: найди свою страницу на spokeo.com, вставь её адрес и подтверди по ссылке из письма.', extra: '' },
  { id: 'peopleconnect', group: 'brokers', us: true, name: 'PeopleConnect (Intelius, TruthFinder, Instant Checkmate)', email: 'privacy@peopleconnect.us', law: 'other', days: 45, who: 'PeopleConnect, Inc., США',
    what: 'группа сайтов поиска людей', src: 'https://www.peopleconnect.us/privacy-policy', form: 'https://suppression.peopleconnect.us/login',
    formHow: 'Страница скрытия: вход по коду из письма, найди свою запись и скрой её — сразу на всех сайтах группы.', extra: '' },
];
const BY_ID = new Map(COMPANIES.map((c) => [c.id, c]));
const clean = (s, n) => String(s == null ? '' : s).replace(/[\r\n\t\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, n);

// тема и текст письма; me = { phone: «+7 999 123-45-67», name: подпись (можно пусто), email: адрес отправителя }
function letter(c, me) {
  const phone = clean(me.phone, 30), email = clean(me.email, 120), name = clean(me.name, 80);
  const sign = ['Kind regards,', name || 'The holder of the phone number ' + phone, email];
  const keep = 'If you need to keep the number solely to prevent it from being added again, please keep nothing more than is strictly necessary for that purpose.';
  const verify = 'If you need to verify that the number belongs to me, please tell me how (for example, by a code sent by SMS to this number).';
  const items = ['- the phone number ' + phone + ' and any profile or account linked to it or to my e-mail address ' + email + ';',
    '- all names, tags, comments, spam reports and other information linked to this number, including data obtained from other users\' address books.'];
  if (c.group === 'brokers') {
    return { subject: 'Request to delete my personal information and opt out — ' + (name || phone),
      text: ['Hello,', '',
        'I request that ' + c.name + ' delete all personal information about me and opt me out of any sale or sharing of my personal information. Please search your records using:',
        '- name: ' + (name || 'not provided'), '- phone number: ' + phone, '- e-mail address: ' + email, '',
        'Please also suppress my information so that it does not appear again in your search results, reports or listings on any of your websites. If a privacy law applies to me in your jurisdiction (for example, a U.S. state privacy law), please treat this as a request to delete and to opt out under that law.', '',
        'Please confirm by replying to this e-mail. If you need more details to locate my records or to verify my identity, please tell me what you need.', '', ...sign].join('\n') };
  }
  if (c.law === 'gdpr') {
    return { subject: 'Erasure request under Article 17 GDPR — phone number ' + phone,
      text: ['Dear ' + c.name + ' privacy team,', '', 'I am the holder of the phone number ' + phone + '.', '',
        'Under Article 17 of the General Data Protection Regulation (EU) 2016/679, I request that you erase without undue delay all personal data concerning me that you hold, in particular:', ...items, '',
        'Under Article 21 GDPR, I also object to any further processing of my personal data, including showing a name or tags for this number in search results, caller ID or any other feature of ' + c.name + '. Please inform any recipients of my data about this request, as required by Article 19 GDPR.', '',
        keep, c.extra || null, '',
        'Please confirm the erasure by replying to this e-mail. Under Article 12(3) GDPR, you must respond within one month of receipt. ' + verify, '', ...sign].filter((x) => x !== null).join('\n') };
  }
  return { subject: 'Request to delete my phone number and personal data — ' + phone,
    text: ['Hello,', '', 'I am the holder of the phone number ' + phone + '. I request that ' + c.name + ' delete all personal data about me that it holds, in particular:', ...items, '',
      'Please also unlist the number: stop showing any name or other information for it in search results, caller ID and any other feature, and do not disclose data about it to third parties.', '',
      'I make this request under the data protection law that applies to you and under your privacy policy, which provides for deletion on request. ' + keep, c.extra || null, '',
      'Please confirm the deletion by replying to this e-mail. ' + verify, '', ...sign].filter((x) => x !== null).join('\n') };
}

const pub = (c) => ({ id: c.id, group: c.group, us: !!c.us, name: c.name, email: c.email, law: c.law, days: c.days || null, who: c.who, what: c.what, src: c.src, form: c.form, formHow: c.formHow });
const list = () => COMPANIES.map(pub);
// выбор из интерфейса: только известные компании, без повторов, не больше 20
const pick = (ids) => [...new Set((Array.isArray(ids) ? ids : []).map(String))].map((id) => BY_ID.get(id)).filter(Boolean).slice(0, 20);
const get = (id) => BY_ID.get(String(id)) || null;

module.exports = { list, pick, get, letter, COMPANIES };
