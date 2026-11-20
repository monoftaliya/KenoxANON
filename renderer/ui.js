/* Общие помощники интерфейса: элементы, уведомления, окно подтверждения, «расшифровка» текста. */
(function () {
  'use strict';
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const GL = 'АБВГДЕЖЗИКЛМНОПРСТУФХЦЧШЭЮЯ0123456789#%&@$<>/\\';
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

  // h('div.plate.pcard', { onclick }, 'текст', child) — короткая сборка DOM без innerHTML
  function h(spec, attrs, ...kids) {
    const [tag, ...cls] = spec.split('.');
    const e = document.createElement(tag || 'div');
    if (cls.length) e.className = cls.join(' ');
    if (attrs && (typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs))) { kids.unshift(attrs); attrs = null; }
    if (attrs) for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else if (k === 'style' && typeof v === 'object') Object.entries(v).forEach(([p, val]) => e.style.setProperty(p, val));
      else if (k === 'text') e.textContent = v;
      else e.setAttribute(k, v === true ? '' : v);
    }
    kids.flat(Infinity).forEach((c) => { if (c == null || c === false) return; e.append(c instanceof Node ? c : document.createTextNode(String(c))); });
    return e;
  }

  function scramble(el, text, dur = 600) {
    if (!el) return;
    if (reduce) { el.textContent = text; return; }
    const start = performance.now(), len = text.length;
    cancelAnimationFrame(el._scr);
    const tick = (now) => {
      const p = Math.min(1, (now - start) / dur), fixed = Math.floor(p * len);
      let s = text.slice(0, fixed);
      for (let i = fixed; i < len; i++) s += text[i] === ' ' ? ' ' : GL[(Math.random() * GL.length) | 0];
      el.textContent = s;
      if (p < 1) el._scr = requestAnimationFrame(tick); else el.textContent = text;
    };
    el._scr = requestAnimationFrame(tick);
  }

  let toastT;
  function toast(text, tone = 'ok') {
    const t = $('#toast');
    t.textContent = text;
    t.style.setProperty('--tc', tone === 'bad' ? 'var(--t-trace)' : tone === 'warn' ? 'var(--t-device)' : 'var(--t-net)');
    t.classList.add('show'); clearTimeout(toastT);
    toastT = setTimeout(() => t.classList.remove('show'), 3800);
  }

  // Окно подтверждения: показывает, что именно изменится, и ждёт решения человека
  // check — подпись галочки, без которой кнопка подтверждения не нажимается (для необратимых действий)
  function confirmBox({ kicker = 'Что изменится', title, body = [], ok = 'Применить', cancel = 'Отмена', danger = false, check = null }) {
    return new Promise((resolve) => {
      const m = $('#modal'), okB = $('#modalOk'), noB = $('#modalCancel');
      $('#modalKicker').textContent = kicker; $('#modalTitle').textContent = title;
      const b = $('#modalBody'); b.textContent = ''; body.filter(Boolean).forEach((n) => b.append(n instanceof Node ? n : h('p', String(n))));
      okB.textContent = ok; noB.textContent = cancel; okB.className = danger ? 'key key--accent' : 'key key--snow';
      okB.disabled = false;
      if (check) {
        const cb = h('input', { type: 'checkbox' });
        cb.addEventListener('change', () => { okB.disabled = !cb.checked; });
        b.append(h('label.switch.modal__check', cb, h('i'), h('span', check)));
        okB.disabled = true;
      }
      m.hidden = false; (check ? noB : okB).focus();
      const done = (v) => { m.hidden = true; okB.onclick = noB.onclick = null; document.removeEventListener('keydown', esc); resolve(v); };
      const esc = (e) => { if (e.key === 'Escape') done(false); };
      okB.onclick = () => done(true); noB.onclick = () => done(false);
      document.addEventListener('keydown', esc);
    });
  }

  const fmtBytes = (n) => (n > 1073741824 ? (n / 1073741824).toFixed(1) + ' ГБ' : n > 1048576 ? (n / 1048576).toFixed(1) + ' МБ' : n > 1024 ? Math.round(n / 1024) + ' КБ' : n + ' Б');
  const fmtDate = (iso) => { if (!iso) return '—'; const d = new Date(iso); return d.toLocaleDateString('ru-RU', { day: '2-digit', month: 'short' }) + ' ' + d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }); };
  const ago = (iso) => { if (!iso) return 'никогда'; const s = (Date.now() - new Date(iso)) / 1000; return s < 90 ? 'только что' : s < 3600 ? Math.round(s / 60) + ' мин назад' : s < 86400 ? Math.round(s / 3600) + ' ч назад' : Math.round(s / 86400) + ' дн. назад'; };
  const plural = (n, one, few, many) => { const a = Math.abs(n) % 100, b = a % 10; return a > 10 && a < 20 ? many : b === 1 ? one : b > 1 && b < 5 ? few : many; };
  const strong = (n = 20) => { const a = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!#%&*+-=?@'; const b = new Uint32Array(n); crypto.getRandomValues(b); return Array.from(b, (x) => a[x % a.length]).join(''); };

  window.UI = { $, $$, h, scramble, toast, confirmBox, fmtBytes, fmtDate, ago, strong, plural, reduce };
})();
