/* Движок тренажёров курса «Интеллектуальные информационные технологии».
   Без внешних библиотек. Самопроверка работает целиком в браузере. Зачётные задания хранятся
   на сервере преподавателя (Google Apps Script): браузер получает их без ответов, баллы считает сервер,
   результат записывается в Google Таблицу. В самопроверке ничего не отправляется. */
(function () {
  'use strict';
  const K = window.Kurs = window.Kurs || {};
  const CFG = Object.assign({ resultsUrl: '', operator: {} }, window.KURS_CONFIG || {});
  K.config = CFG;

  // ---------- утилиты ----------
  const $ = (s, r) => (r || document).querySelector(s);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  K.$ = $;
  K.esc = esc;
  const fmtNum = x => String(x).replace('.', ',');
  K.fmtNum = fmtNum;

  K.store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* хранилище недоступно — не страшно */ } }
  };

  // ---------- лекции и тренажёры ----------
  K.LECTURES = [
    { n: 1, letter: 'A', title: 'ИИС, данные и знания', full: 'Понятия интеллектуальной информационной системы и технологии' },
    { n: 2, letter: 'B', title: 'Диалог человека и системы', full: 'Организация диалога между человеком и интеллектуальной системой' },
    { n: 3, letter: 'C', title: 'Естественно-языковой интерфейс', full: 'Предметно-ориентированные системы на основе естественно-языкового интерфейса' },
    { n: 4, letter: 'D', title: 'Искусственные нейронные сети', full: 'Нейробионика и нейрокомпьютеры. Искусственные нейронные сети' },
    { n: 5, letter: 'E', title: 'Нейросети и распознавание образов', full: 'Другие модели нейронных сетей. Системы распознавания образов' },
    { n: 6, letter: 'F', title: 'Генетические алгоритмы', full: 'Технологии, основанные на эволюционных алгоритмах' },
    { n: 7, letter: 'G', title: 'Экспертные системы: структура и вывод', full: 'Назначение, классификация и структура экспертных систем' },
    { n: 8, letter: 'H', title: 'Экспертные системы: знания и инструменты', full: 'Инженер по знаниям и эксперт. Инструментальные средства ЭС' }
  ];
  K.TRAINERS = {};
  K.LECTURES.forEach(l => {
    K.TRAINERS[l.letter] = { letter: l.letter, n: l.n, title: 'Лекция ' + l.n + '. ' + l.title, short: 'Л' + l.n, lecture: l };
  });
  K.TRAINERS.Z = { letter: 'Z', n: 0, title: 'Итоговый зачёт', short: 'Итог', lecture: null };
  K.ORDER = K.LECTURES.map(l => l.letter).concat('Z');
  K.trainerUrl = (letter, room) => 'trainer.html?t=' + letter + (room ? '&room=' + room : '');
  K.FINAL_PER_LECTURE = 3;

  function randInt(n) {
    const a = new Uint32Array(1);
    crypto.getRandomValues(a);
    return a[0] % n;
  }
  K.shuffle = function (arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = randInt(i + 1);
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };

  // ---------- тема ----------
  K.initTheme = function () {
    const root = document.documentElement;
    if (new URLSearchParams(location.search).get('theme') === 'light') root.dataset.theme = 'light';
    const btn = $('.theme-btn');
    const sync = () => { if (btn) btn.textContent = root.dataset.theme === 'light' ? 'Тёмная тема' : 'Светлая тема'; };
    sync();
    if (btn) btn.addEventListener('click', () => {
      if (root.dataset.theme === 'light') delete root.dataset.theme; else root.dataset.theme = 'light';
      sync();
    });
    // светлая тема переносится по ссылкам внутри сайта
    document.addEventListener('click', e => {
      const a = e.target.closest && e.target.closest('a[href]');
      if (!a || root.dataset.theme !== 'light') return;
      const href = a.getAttribute('href');
      if (!/\.html(\?|#|$)/.test(href) || /^[a-z]+:/i.test(href)) return;
      const u = new URL(href, location.href);
      u.searchParams.set('theme', 'light');
      a.href = u.toString();
    });
  };

  // ---------- коды комнат ----------
  // 5 знаков: буква тренажёра, 3 случайных знака, проверочный знак. Без похожих I, L, O, 0, 1.
  const ALPH = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const CYR = { 'А': 'A', 'В': 'B', 'Е': 'E', 'К': 'K', 'М': 'M', 'Н': 'H', 'Р': 'P', 'С': 'C', 'Т': 'T',
                'Х': 'X', 'У': 'Y', 'З': '3' };
  const checkChar = body => {
    let s = 0;
    for (let i = 0; i < body.length; i++) s += ALPH.indexOf(body[i]) * (i + 3);
    return ALPH[s % ALPH.length];
  };
  K.makeRoom = function (letter) {
    let body = letter;
    for (let i = 0; i < 3; i++) body += ALPH[randInt(ALPH.length)];
    return body + checkChar(body);
  };
  // студенты набирают код с телефона на русской раскладке: А, В, Е, К… приводим к латинице
  K.normCode = s => String(s || '').toUpperCase().split('').map(c => CYR[c] || c).join('').replace(/[^A-Z0-9]/g, '');
  K.parseRoom = function (s) {
    const c = K.normCode(s);
    if (!c) return { ok: false, msg: 'Введите код комнаты' };
    if (c.length !== 5) return { ok: false, msg: 'Код состоит из 5 знаков' };
    if (![...c].every(ch => ALPH.includes(ch)) || checkChar(c.slice(0, 4)) !== c[4])
      return { ok: false, msg: 'В коде опечатка — сверьте знаки с экраном преподавателя' };
    const t = K.TRAINERS[c[0]];
    if (!t) return { ok: false, msg: 'Такой комнаты нет' };
    return { ok: true, code: c, letter: c[0], trainer: t };
  };


  K.EXAM_COUNT = 10;          // заданий в зачётном проходе по лекции (сами задания — на сервере)
  K.normName = s => String(s || '').replace(/\s+/g, ' ').trim();
  K.normGroup = s => K.normName(s).toUpperCase();

  K.level = function (pct) {
    if (pct >= 90) return { cls: 'hi', text: 'отлично' };
    if (pct >= 75) return { cls: 'mid', text: 'хорошо' };
    if (pct >= 61) return { cls: 'mid', text: 'удовлетворительно' };
    return { cls: 'lo', text: 'пока не зачтено' };
  };

  // ---------- сервер (Apps Script) ----------
  // Простой POST без заголовков: браузер не делает предварительный запрос CORS.
  // Сетевые сбои повторяются автоматически; повтор безопасен — сервер отсекает дубли.
  K.api = async function (action, data, tries) {
    const url = String(K.store.get('iit-url') || CFG.resultsUrl || '').trim();
    if (!url) throw Object.assign(new Error('no-url'), { code: 'no-url' });
    let lastErr;
    for (let i = 0; i < (tries || 3); i++) {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 45000);
      try {
        const res = await fetch(url, { method: 'POST', body: JSON.stringify(Object.assign({ action }, data)), signal: ctl.signal, redirect: 'follow' });
        const j = await res.json();
        if (j && j.ok) return j;
        const err = new Error((j && j.error) || 'server');
        err.code = (j && j.error) || 'server';
        err.data = j;
        if (err.code !== 'busy') throw err;          // ошибки сервера (кроме занятости) не повторяем
        lastErr = err;
      } catch (e) {
        if (e.code && e.code !== 'busy') throw e;
        lastErr = e;
      } finally { clearTimeout(timer); }
      await new Promise(r => setTimeout(r, 1500 * (i + 1)));
    }
    if (!lastErr.code) lastErr.code = 'network';
    throw lastErr;
  };
  const API_MSG = {
    'no-url': 'Сбор результатов ещё не настроен. Сообщите преподавателю.',
    'no-bank': 'Преподаватель ещё не загрузил зачётные задания. Сообщите ему.',
    room: 'Такой комнаты нет — сверьте код с экраном преподавателя.',
    fields: 'Проверьте фамилию, имя, группу и согласие.',
    attempts: 'Вы уже использовали все попытки в этой комнате.',
    ticket: 'Результат не принят: данные попытки изменены. Начните зачёт заново.',
    late: 'Время на зачётный проход истекло, результат не принят.',
    network: 'Нет связи с сервером. Проверьте интернет и попробуйте ещё раз.',
    busy: 'Сервер перегружен. Подождите несколько секунд и попробуйте ещё раз.',
    server: 'Ошибка сервера. Попробуйте ещё раз или сообщите преподавателю.'
  };
  K.apiMessage = e => (e && e.code === 'attempts' && e.data && e.data.max
    ? 'Вы уже использовали все попытки в этой комнате (' + e.data.max + ').'
    : API_MSG[e && e.code] || API_MSG.network);

  K.copy = function (text, btn) {
    const done = () => { if (btn) { const t = btn.textContent; btn.textContent = 'Скопировано'; setTimeout(() => { btn.textContent = t; }, 1600); } };
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(done, done);
    else {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); } catch (e) { /* выделенный текст можно скопировать вручную */ }
      ta.remove();
      done();
    }
  };

  // ---------- задания ----------
  K.rightText = function (it) {
    if (it.type === 'num') return fmtNum(it.ans) + (it.unit ? ' ' + it.unit : '');
    if (it.type === 'order') return it.o.map((s, i) => (i + 1) + ') ' + s).join('  ');
    return it.o[0].replace(/<[^>]+>/g, '');
  };
  K.plainQ = it => String(it.q).replace(/<div class="kb">[\s\S]*?<\/div>/, '').replace(/<[^>]+>/g, '');
  const TYPE_TAG = { choice: 'Выберите один ответ', num: 'Вычислите', order: 'Расставьте по порядку' };

  // самопроверка: задания из публичного файла, с ответами
  function selfItems(letter) {
    if (letter !== 'Z') return K.shuffle(K.Q[K.TRAINERS[letter].n].self);
    let all = [];
    K.LECTURES.forEach(l => { all = all.concat(K.shuffle(K.Q[l.n].self).slice(0, K.FINAL_PER_LECTURE)); });
    return K.shuffle(all);
  }

  /* Тренажёр. letter — буква тренажёра (A–H — лекции 1–8, Z — итоговый зачёт), mount — контейнер.
     Самопроверка работает в браузере и показывает разбор. Зачётный проход: задания без ответов приходят
     с сервера, ответы уходят на сервер, баллы считает сервер, правильные ответы не показываются. */
  K.trainer = function (letter, mount) {
    const T = K.TRAINERS[letter];
    const isFinal = letter === 'Z';
    const st = {};
    const params = new URLSearchParams(location.search);
    let leaveGuard = false;
    window.addEventListener('beforeunload', e => { if (leaveGuard) { e.preventDefault(); e.returnValue = ''; } });

    function begin(mode, items, extra) {
      st.mode = mode;
      st.i = 0;
      st.right = 0;
      st.answers = {};
      st.answered = false;
      st.items = items;
      st.graded = mode === 'graded';
      st.t0 = Date.now();
      Object.assign(st, extra || {});
      leaveGuard = st.graded;
      card();
    }

    function pendingBox() {
      let p = null;
      try { p = JSON.parse(K.store.get('iit-pending') || 'null'); } catch (e) { p = null; }
      if (!p || !p.sid) return '';
      return '<div class="send" data-state="err" id="k-pending" style="margin:0 0 18px"><h3>Есть неотправленный результат</h3>' +
        '<p>' + esc(p.title || '') + ' · ' + esc(p.fio) + ', ' + esc(p.group) + ', комната ' + esc(p.room) + '. Отправьте его — повторная отправка не создаст дубль.</p>' +
        '<div class="btn-row" style="margin-top:0"><button class="btn" id="k-resend">Отправить результат</button></div><p class="err" id="k-resend-err"></p></div>';
    }
    function bindPending() {
      const b = $('#k-resend', mount);
      if (!b) return;
      b.addEventListener('click', () => {
        const p = JSON.parse(K.store.get('iit-pending'));
        b.disabled = true;
        b.textContent = 'Отправляем…';
        K.api('finish', p).then(res => {
          K.store.set('iit-pending', '');
          st.mode = 'graded';
          st.graded = true;
          st.reg = p;
          showGradedResult(res, p);
        }).catch(e => {
          b.disabled = false;
          b.textContent = 'Отправить результат';
          $('#k-resend-err', mount).textContent = K.apiMessage(e);
          if (e.code === 'ticket' || e.code === 'late') K.store.set('iit-pending', '');
        });
      });
    }

    function intro() {
      leaveGuard = false;
      const nExam = isFinal ? K.LECTURES.length * K.FINAL_PER_LECTURE : K.EXAM_COUNT;
      const nSelf = isFinal ? K.LECTURES.length * K.FINAL_PER_LECTURE : K.Q[T.n].self.length;
      const goals = isFinal
        ? ['проверить знания по всем восьми лекциям курса', 'по 3 случайных задания из каждой лекции — у каждого студента свой набор',
           'в зачётном проходе правильные ответы не показываются — как на настоящем зачёте']
        : K.INFO[T.n].goals;
      const facts = isFinal
        ? [nExam + ' заданий', 'около 30 минут', 'пробный режим — с разбором']
        : [nExam + ' заданий в зачёте', nSelf + ' — в самопроверке', 'разбор — в самопроверке'];
      mount.innerHTML = pendingBox() +
        '<h2>' + (isFinal ? 'Что проверяет зачёт' : 'Чему вы научитесь') + '</h2>' +
        '<ul class="goals">' + goals.map(g => '<li>' + g + '</li>').join('') + '</ul>' +
        '<div class="facts">' + facts.map(f => '<span class="fact">' + esc(f) + '</span>').join('') + '</div>' +
        '<p class="hint" style="margin:-8px 0 16px">В самопроверке и в зачётном проходе — разные задания. Зачётные задания хранятся на сервере преподавателя, ответы на них не видны в браузере.</p>' +
        '<div class="modes">' +
        '<button class="mode" data-mode="self"><b>' + (isFinal ? 'Пробный зачёт' : 'Самопроверка') + '</b><small>Без регистрации. Результат видите только вы, разбор после каждого ответа.</small></button>' +
        '<button class="mode" data-mode="graded"><b>Зачётный проход</b><small>Нужен код комнаты от преподавателя. Результат сразу появится у преподавателя.</small></button>' +
        '</div>';
      bindPending();
      mount.querySelectorAll('.mode').forEach(b => b.addEventListener('click', () => {
        if (b.dataset.mode === 'self') begin('self', selfItems(letter)); else register('');
      }));
    }

    function register(prefill) {
      leaveGuard = false;
      const saved = { fio: K.store.get('iit-fio') || '', group: K.store.get('iit-group') || '' };
      mount.innerHTML = pendingBox() +
        '<h2>Зачётный проход</h2>' +
        '<p class="hint" style="margin:0 0 16px">Код комнаты, фамилия, имя и группа уйдут преподавателю вместе с результатом. Подсказок и правильных ответов в зачёте нет — потренируйтесь сначала в самопроверке.</p>' +
        '<label class="field"><span>Код комнаты</span><input class="code" id="k-room" maxlength="9" autocomplete="off" ' +
        'autocapitalize="characters" spellcheck="false" value="' + esc(prefill) + '"></label>' +
        '<p class="err" id="k-room-err" role="alert"></p>' +
        '<label class="field"><span>Фамилия и имя</span><input id="k-fio" autocomplete="name" placeholder="Иванова Анна" value="' + esc(saved.fio) + '"></label>' +
        '<label class="field"><span>Группа</span><input id="k-group" autocomplete="off" placeholder="ИВ-321" value="' + esc(saved.group) + '"></label>' +
        '<label class="consent"><input type="checkbox" id="k-consent"><span>Я прочитал(а) ' +
        '<a href="consent.html" target="_blank" rel="noopener">согласие на обработку персональных данных</a> и даю его.</span></label>' +
        '<p class="err" id="k-err" role="alert"></p>' +
        '<div class="btn-row"><button class="btn" id="k-go">Начать</button><button class="btn ghost" id="k-back">Назад</button></div>' +
        '<p class="hint">Не хотите давать согласие — выберите самопроверку: в ней ничего не отправляется.</p>';
      bindPending();
      const room = $('#k-room', mount);
      const checkRoom = () => {
        const r = K.parseRoom(room.value);
        const err = $('#k-room-err', mount);
        if (!room.value.trim()) { err.textContent = ''; return null; }
        if (!r.ok) { err.textContent = r.msg; return null; }
        if (r.letter !== letter) {
          err.innerHTML = 'Этот код — для тренажёра «' + esc(r.trainer.title) + '». <a href="' +
            esc(K.trainerUrl(r.letter, r.code)) + '">Перейти к нему</a>';
          return null;
        }
        err.innerHTML = '<span class="okmsg">Комната ' + r.code + ' найдена</span>';
        return r;
      };
      room.addEventListener('input', checkRoom);
      if (prefill) checkRoom();
      $('#k-back', mount).addEventListener('click', intro);
      const go = $('#k-go', mount);
      go.addEventListener('click', () => {
        const r = checkRoom();
        const fio = K.normName($('#k-fio', mount).value);
        const group = K.normGroup($('#k-group', mount).value);
        const err = $('#k-err', mount);
        err.textContent = '';
        if (!r) { if (!room.value.trim()) $('#k-room-err', mount).textContent = 'Введите код комнаты'; room.focus(); return; }
        if (fio.split(' ').length < 2) { err.textContent = 'Укажите фамилию и имя'; $('#k-fio', mount).focus(); return; }
        if (group.length < 2) { err.textContent = 'Укажите группу'; $('#k-group', mount).focus(); return; }
        if (!$('#k-consent', mount).checked) { err.textContent = 'Без согласия результат не может быть отправлен — отметьте его или выберите самопроверку'; return; }
        K.store.set('iit-fio', fio);
        K.store.set('iit-group', group);
        const reg = { room: r.code, fio, group, consent: 'да, ' + new Date().toLocaleString('ru-RU') };
        go.disabled = true;
        go.textContent = 'Загружаем задания…';
        K.api('start', reg).then(res => {
          st.reg = reg;
          st.ticket = { sid: res.sid, t0: res.t0, ids: res.ids, sig: res.sig };
          st.title = res.title || T.title;
          begin('graded', res.items);
        }).catch(e => {
          go.disabled = false;
          go.textContent = 'Начать';
          err.textContent = K.apiMessage(e);
        });
      });
      (prefill ? $('#k-fio', mount) : room).focus();
    }

    function card() {
      st.answered = false;
      const it = st.items[st.i];
      const n = st.items.length;
      const tag = isFinal ? 'Лекция ' + it.lec + ' · ' + TYPE_TAG[it.type] : TYPE_TAG[it.type];
      let body = '';
      if (it.type === 'num') {
        body = '<div class="numrow"><input id="k-num" inputmode="decimal" autocomplete="off" aria-label="Ответ">' +
          (it.unit ? '<span>' + esc(it.unit) + '</span>' : '') +
          '<button class="btn" id="k-check">' + (st.graded ? 'Ответить' : 'Проверить') + '</button></div>' +
          '<p class="hint">Дробную часть отделяйте запятой или точкой. Отрицательное число — со знаком «−».</p>';
      } else if (it.type === 'order') {
        const pool = K.shuffle(it.o.map((s, k) => ({ s, k })));
        body = '<p class="hint" style="margin:0 0 10px">Нажимайте шаги в нужном порядке. Ошиблись — нажмите на шаг в списке, чтобы вернуть его.</p>' +
          '<ol class="ord-seq" id="k-seq" aria-label="Ваш порядок"></ol>' +
          '<div class="ord-pool" id="k-pool">' + pool.map(p => '<button class="opt ord-item" data-k="' + p.k + '">' + p.s + '</button>').join('') + '</div>' +
          '<div class="btn-row" style="margin-top:12px"><button class="btn" id="k-check" disabled>' + (st.graded ? 'Ответить' : 'Проверить') + '</button>' +
          '<button class="btn ghost" id="k-reset">Сбросить</button></div>';
      } else {
        // в зачёте сервер уже перемешал варианты; в самопроверке перемешиваем здесь (правильный в данных — первый)
        const opts = it.o.map((t, k) => ({ v: k, html: t }));
        const list = st.graded ? opts : K.shuffle(opts);
        body = '<div class="opts list" role="group" aria-label="Варианты ответа">' +
          list.map((op, k) => '<button class="opt" data-v="' + op.v + '"><span class="k">' + (k + 1) + '</span>' + op.html + '</button>').join('') +
          '</div>';
      }
      mount.innerHTML =
        '<div class="progress"><span>Задание ' + (st.i + 1) + ' из ' + n + '</span>' +
        '<span class="track"><i style="width:' + (st.i / n * 100) + '%"></i></span>' +
        '<span class="badge' + (st.graded ? ' graded' : '') + '">' + (st.graded ? 'зачёт' : 'самопроверка') + '</span></div>' +
        '<span class="tag">' + esc(tag) + '</span>' +
        '<div class="prompt">' + it.q + '</div>' + body +
        '<div class="verdict hidden" id="k-verdict" aria-live="polite"></div>' +
        '<div class="btn-row hidden" id="k-nav"><button class="btn" id="k-next">' + (st.i === n - 1 ? (st.graded ? 'Завершить и отправить' : 'К итогам') : 'Дальше') + '</button></div>';

      if (it.type === 'num') {
        const inp = $('#k-num', mount);
        const go = () => {
          const v = parseFloat(String(inp.value).trim().replace(/\s/g, '').replace(',', '.').replace(/^[−–—]/, '-'));
          if (isNaN(v)) { inp.focus(); return; }
          answer(it, v);
        };
        $('#k-check', mount).addEventListener('click', go);
        inp.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
        inp.focus({ preventScroll: true });
      } else if (it.type === 'order') {
        const seq = [];
        const seqEl = $('#k-seq', mount), poolEl = $('#k-pool', mount), chk = $('#k-check', mount);
        const draw = () => {
          seqEl.innerHTML = seq.map(k => '<li><button class="ord-placed" data-k="' + k + '">' + it.o[k] + '</button></li>').join('');
          poolEl.querySelectorAll('.ord-item').forEach(b => { b.classList.toggle('hidden', seq.includes(Number(b.dataset.k))); });
          chk.disabled = seq.length !== it.o.length;
          seqEl.classList.toggle('empty', !seq.length);
        };
        poolEl.addEventListener('click', e => {
          const b = e.target.closest('.ord-item');
          if (!b || st.answered) return;
          seq.push(Number(b.dataset.k));
          draw();
        });
        seqEl.addEventListener('click', e => {
          const b = e.target.closest('.ord-placed');
          if (!b || st.answered) return;
          seq.splice(seq.indexOf(Number(b.dataset.k)), 1);
          draw();
        });
        $('#k-reset', mount).addEventListener('click', () => { if (!st.answered) { seq.length = 0; draw(); } });
        chk.addEventListener('click', () => answer(it, seq.slice()));
        draw();
      } else {
        mount.querySelectorAll('.opt').forEach(b => b.addEventListener('click', () => answer(it, Number(b.dataset.v), b)));
      }
      $('#k-next', mount).addEventListener('click', () => {
        if (st.i === n - 1) finish(); else { st.i++; card(); mount.scrollIntoView({ block: 'start', behavior: 'smooth' }); }
      });
    }

    // проверка только для самопроверки; в зачёте правильность знает лишь сервер
    function isRight(it, v) {
      if (it.type === 'num') return Math.abs(v - it.ans) <= (it.tol || 0) + 1e-9;
      if (it.type === 'order') return v.length === it.o.length && v.every((k, i) => k === i);
      return v === 0;
    }
    // ответ для сервера: текст выбранного варианта / тексты шагов по порядку / число
    function wireValue(it, v) {
      if (it.type === 'num') return v;
      if (it.type === 'order') return v.map(k => it.o[k]);
      return it.o[v];
    }

    function answer(it, v, btn) {
      if (st.answered) return;
      st.answered = true;
      const fb = !st.graded;
      let ok = false;
      if (fb) { ok = isRight(it, v); if (ok) st.right++; st.answers[it.id] = { v, ok }; }
      else st.answers[it.id] = wireValue(it, v);
      if (it.type === 'num') {
        const inp = $('#k-num', mount);
        inp.classList.add(fb ? (ok ? 'right' : 'wrong') : 'picked');
        inp.disabled = true;
        $('#k-check', mount).disabled = true;
      } else if (it.type === 'order') {
        $('#k-check', mount).disabled = true;
        $('#k-reset', mount).disabled = true;
        mount.querySelectorAll('.ord-placed').forEach((b, i) => {
          b.disabled = true;
          b.dataset.state = fb ? (Number(b.dataset.k) === i ? 'right' : 'wrong') : 'picked';
        });
      } else {
        mount.querySelectorAll('.opt').forEach(b => {
          b.disabled = true;
          if (fb && Number(b.dataset.v) === 0) b.dataset.state = 'right';
        });
        if (btn) btn.dataset.state = fb ? (ok ? 'right' : 'wrong') : 'picked';
      }
      const ver = $('#k-verdict', mount);
      if (fb) {
        ver.dataset.kind = ok ? 'right' : 'wrong';
        let right = '';
        if (!ok) right = it.type === 'order'
          ? '<div class="right-ans">Правильный порядок:<ol>' + it.o.map(s => '<li>' + s + '</li>').join('') + '</ol></div>'
          : '<p class="right-ans">Правильный ответ: <b>' + (it.type === 'num' ? esc(K.rightText(it)) : it.o[0]) + '</b></p>';
        ver.innerHTML = '<h3>' + (ok ? 'Верно.' : 'Неверно.') + '</h3>' + right +
          '<p>' + it.why + '</p>' + (it.ref ? '<p class="ref">Повторить: ' + esc(it.ref) + '</p>' : '');
      } else {
        ver.dataset.kind = 'neutral';
        ver.innerHTML = '<p style="margin:0">Ответ записан. Результат — после последнего задания.</p>';
      }
      ver.classList.remove('hidden');
      $('#k-nav', mount).classList.remove('hidden');
      $('#k-next', mount).focus({ preventScroll: true });
      ver.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }

    function finish() {
      if (st.graded) return sendGraded();
      leaveGuard = false;
      const n = st.items.length;
      const pct = Math.round(st.right / n * 100);
      const wrong = st.items.filter(it => st.answers[it.id] && !st.answers[it.id].ok);
      const byLec = isFinal ? lectureTable(lec => {
        const its = st.items.filter(it => it.lec === lec);
        return [its.filter(it => st.answers[it.id] && st.answers[it.id].ok).length, its.length];
      }) : '';
      const review = wrong.length
        ? '<h3 style="margin-top:22px">Что повторить</h3><ul class="review">' + wrong.map(it =>
          '<li><div class="q">' + esc(K.plainQ(it)) + '</div><div class="a">Правильно: ' + esc(K.rightText(it)) + ' · ' + esc(it.ref || '') + '</div></li>').join('') + '</ul>'
        : '<p class="note">Ошибок нет.</p>';
      resultScreen(st.right, n, pct, '<p class="hint" style="text-align:center">Это самопроверка — результат никуда не отправлен.</p>' + byLec + review);
    }

    function lectureTable(count) {
      return '<table class="mini bylec"><thead><tr><th>Лекция</th><th>Верно</th></tr></thead><tbody>' +
        K.LECTURES.map(l => {
          const [ok, all] = count(l.n);
          if (!all) return '';
          return '<tr class="' + (ok === all ? 'ok' : ok === 0 ? 'bad' : '') + '"><td>' + l.n + '. ' + esc(l.title) + '</td><td>' + ok + ' из ' + all + '</td></tr>';
        }).join('') + '</tbody></table>';
    }

    function resultScreen(score, n, pct, extra) {
      const lv = K.level(pct);
      mount.innerHTML =
        '<div class="score"><b>' + score + ' из ' + n + '</b><span class="pct">' + pct + ' % верных ответов</span><br>' +
        '<span class="level ' + lv.cls + '">' + lv.text + '</span></div>' +
        '<p class="note">' + esc(finalNote(pct)) + '</p>' + extra +
        '<div class="btn-row">' + (st.graded ? '<button class="btn ghost" id="k-self">Потренироваться в самопроверке</button>'
          : '<button class="btn ghost" id="k-again">Пройти заново</button>') +
        '<a class="btn ghost" href="index.html">Все тренажёры</a></div>';
      const again = $('#k-again', mount), self = $('#k-self', mount);
      if (again) again.addEventListener('click', () => begin('self', selfItems(letter)));
      if (self) self.addEventListener('click', () => begin('self', selfItems(letter)));
      mount.scrollIntoView({ block: 'start', behavior: 'smooth' });
    }

    function sendGraded() {
      const payload = Object.assign({ title: st.title }, st.reg, st.ticket, { answers: st.answers });
      K.store.set('iit-pending', JSON.stringify(payload));    // если связь пропадёт — результат не потеряется
      mount.innerHTML = '<div class="send" data-state="busy"><h3>Отправляем ответы и считаем результат…</h3><p>' +
        esc(st.reg.fio) + ', ' + esc(st.reg.group) + ', комната ' + esc(st.reg.room) + '. Не закрывайте страницу.</p></div>';
      K.api('finish', payload).then(res => {
        K.store.set('iit-pending', '');
        leaveGuard = false;
        showGradedResult(res, payload);
      }).catch(e => {
        if (e.code === 'ticket' || e.code === 'late') { K.store.set('iit-pending', ''); leaveGuard = false; }
        mount.innerHTML = '<div class="send" data-state="err"><h3>Результат пока не отправлен</h3><p>' + esc(K.apiMessage(e)) + '</p>' +
          (e.code === 'ticket' || e.code === 'late' ? '' :
            '<p>Ответы сохранены в этом браузере. Нажмите «Отправить ещё раз» — повторная отправка не создаст дубль. ' +
            'Можно и позже: откройте этот тренажёр на этом же устройстве.</p>' +
            '<div class="btn-row" style="margin-top:0"><button class="btn" id="k-retry">Отправить ещё раз</button></div>') + '</div>';
        const r = $('#k-retry', mount);
        if (r) r.addEventListener('click', sendGraded);
      });
    }

    function showGradedResult(res, p) {
      const who = esc(p.fio) + ', ' + esc(p.group) + ', комната ' + esc(p.room);
      const wrong = res.wrong || [];
      const byLec = isFinal ? lectureTable(lec => {
        const all = (p.ids || []).filter(id => Number(String(id).split('.')[0]) === lec).length;
        const bad = wrong.filter(w => Number(String(w.id).split('.')[0]) === lec).length;
        return [all - bad, all];
      }) : '';
      const review = wrong.length
        ? '<h3 style="margin-top:22px">Где были ошибки</h3><ul class="review">' + wrong.map(w =>
          '<li><div class="q">' + esc(w.q) + '</div><div class="a">Повторить: ' + esc(w.ref) + '</div></li>').join('') + '</ul>' +
          '<p class="hint">Правильные ответы зачётного прохода не показываются. Разберите эти разделы и потренируйтесь в самопроверке — там разбор после каждого ответа.</p>'
        : '<p class="note">Ошибок нет.</p>';
      resultScreen(res.score, res.total, res.pct,
        '<div class="send" data-state="ok"><h3>Результат отправлен преподавателю ✓</h3><p>' + who + '. Преподаватель уже видит его в кабинете.</p></div>' + byLec + review);
    }

    function finalNote(pct) {
      if (pct >= 90) return isFinal ? 'Отличный результат по всему курсу.' : 'Тема усвоена. Можно переходить к следующей лекции.';
      if (pct >= 61) return 'Основное понятно. Повторите разделы из списка ниже и пройдите самопроверку ещё раз.';
      return 'Пока рано сдавать. Перечитайте лекцию по ссылкам ниже и потренируйтесь в самопроверке.';
    }

    // клавиши 1–9 выбирают вариант
    document.addEventListener('keydown', e => {
      if (e.target && /INPUT|TEXTAREA/.test(e.target.tagName)) return;
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      const opts = mount.querySelectorAll('.opts .opt:not(:disabled)');
      const k = parseInt(e.key, 10);
      if (!st.answered && opts.length && k >= 1 && k <= opts.length) { e.preventDefault(); opts[k - 1].click(); }
    });

    const room = params.get('room');
    if (room) register(room); else intro();
  };
})();
