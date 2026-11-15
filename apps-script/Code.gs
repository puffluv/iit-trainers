/**
 * Сервер тренажёров ИИТ: выдаёт зачётные задания без ответов, сам считает баллы
 * и записывает результаты в эту Google Таблицу.
 *
 * Проект Apps Script состоит из ДВУХ файлов:
 *  Code.gs — этот файл (публичный, есть на сайте);
 *  Bank.gs — зачётные задания с ответами (приватный, хранится только у преподавателя).
 *
 * Как подключить (подробно — в README.md и в кабинете преподавателя):
 *  1. Создайте Google Таблицу «Результаты тренажёров ИИТ».
 *  2. Расширения → Apps Script. Вставьте этот файл в Code.gs целиком.
 *  3. «+» → «Скрипт» → имя Bank. Вставьте содержимое приватного файла Bank.gs.
 *  4. Замените TEACHER_KEY ниже на свой пароль — по нему кабинет преподавателя читает результаты.
 *  5. Сохраните. «Развернуть» → «Новое развёртывание» → тип «Веб-приложение»:
 *     «Запуск от имени» — Я, «У кого есть доступ» — Все. Разрешите доступ к таблице.
 *  6. Скопируйте URL веб-приложения (…/exec) в config.js сайта, в строку resultsUrl.
 *
 * Что появляется в таблице:
 *  «Все результаты»      — каждая попытка отдельной строкой;
 *  «Группа …»            — те же строки, отдельный лист на каждую группу;
 *  «Сводка по группам»   — журнал: лучший процент каждого студента по каждому тренажёру;
 *  «Комнаты»             — по каждой комнате (занятию): тренажёр, дата, сколько прошло, средний процент.
 *  Сводка и комнаты пересчитываются не чаще раза в минуту (и пока открыт кабинет преподавателя);
 *  пересчитать сразу — меню «Тренажёры ИИТ» → «Обновить сводку и комнаты».
 *
 * Изменили код? «Развернуть» → «Управление развёртываниями» → карандаш → версия «Новая» → «Развернуть».
 * Адрес /exec при этом не меняется.
 */

const TEACHER_KEY = 'ЗАМЕНИТЕ-НА-СВОЙ-ПАРОЛЬ';

// Сколько зачётных попыток даётся студенту в одной комнате (0 — без ограничений).
const MAX_ATTEMPTS = 3;

// Сколько минут даётся на зачётный проход; результат, присланный позже, не принимается (0 — без ограничения).
const TIME_LIMIT_MIN = 90;

// заготовка по умолчанию; собрана из частей, чтобы «заменить все» в редакторе её не задело
const DEFAULT_KEY = ['ЗАМЕНИТЕ', 'НА', 'СВОЙ', 'ПАРОЛЬ'].join('-');

const SHEET_ALL = 'Все результаты';
const SHEET_SUMMARY = 'Сводка по группам';
const SHEET_ROOMS = 'Комнаты';
const GROUP_PREFIX = 'Группа ';
const FINAL_PER_LECTURE = 3;

// порядок столбцов листа результатов
const COLS = [
  ['received', 'Получено'], ['group', 'Группа'], ['fio', 'ФИО'], ['room', 'Комната'], ['title', 'Тренажёр'],
  ['trainer', 'Код тренажёра'], ['score', 'Баллы'], ['total', 'Всего заданий'], ['pct', 'Процент'],
  ['mistakes', 'Ошибки (номера заданий)'], ['seconds', 'Длительность, с'], ['started', 'Начало'],
  ['check', 'Контроль'], ['consent', 'Согласие'], ['uid', 'ID попытки']
];
const KEYS = COLS.map(c => c[0]);
const NUMERIC = { score: 1, total: 1, pct: 1, seconds: 1 };
// столбцы тренажёров в сводке
const TRAINERS = [['A', 'Л1'], ['B', 'Л2'], ['C', 'Л3'], ['D', 'Л4'], ['E', 'Л5'], ['F', 'Л6'], ['G', 'Л7'], ['H', 'Л8'], ['Z', 'Итоговый']];
const LECTURE_OF = { A: 1, B: 2, C: 3, D: 4, E: 5, F: 6, G: 7, H: 8, Z: 0 };
const TITLES = {
  A: 'Лекция 1. ИИС, данные и знания', B: 'Лекция 2. Диалог человека и системы', C: 'Лекция 3. Естественно-языковой интерфейс',
  D: 'Лекция 4. Искусственные нейронные сети', E: 'Лекция 5. Нейросети и распознавание образов', F: 'Лекция 6. Генетические алгоритмы',
  G: 'Лекция 7. Экспертные системы: структура и вывод', H: 'Лекция 8. Экспертные системы: знания и инструменты', Z: 'Итоговый зачёт'
};
const ROOM_ALPH = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

// Все запросы — POST с JSON в теле (простой запрос без предварительной проверки CORS).
function doPost(e) {
  let d;
  try { d = JSON.parse(e.postData.contents); } catch (err) { return out_({ ok: false, error: 'bad-json' }); }
  try {
    if (d.action === 'start') return out_(start_(d));
    if (d.action === 'finish') return out_(finish_(d));
    if (d.action === 'list') return out_(list_(d));
    if (d.action === 'bank') return out_(bankForTeacher_(d));
    return out_({ ok: false, error: 'action' });
  } catch (err) {
    console.error(err);
    return out_({ ok: false, error: 'server', message: String(err && err.message || err) });
  }
}

function doGet(e) {
  const p = (e && e.parameter) || {};
  if (p.action === 'ping') return out_({ ok: true, app: 'iit-trainers', v: 2, keySet: TEACHER_KEY !== DEFAULT_KEY, bank: typeof BANK !== 'undefined' });
  return out_({ ok: false, error: 'action' });
}

// ---------- зачётный проход ----------
// Начало: проверяем комнату и число попыток, выдаём задания БЕЗ ответов и подписанный билет попытки.
function start_(d) {
  if (typeof BANK === 'undefined') return { ok: false, error: 'no-bank' };
  const room = String(d.room || '').toUpperCase();
  const fio = normName_(d.fio), group = normName_(d.group).toUpperCase();
  if (!roomOk_(room)) return { ok: false, error: 'room' };
  if (fio.split(' ').length < 2 || group.length < 2 || !d.consent) return { ok: false, error: 'fields' };
  const trainer = room[0];
  if (MAX_ATTEMPTS > 0) {
    const used = attemptsOf_(room, fio, group);
    if (used >= MAX_ATTEMPTS) return { ok: false, error: 'attempts', max: MAX_ATTEMPTS };
  }
  let items;
  if (trainer === 'Z') {
    items = [];
    for (let n = 1; n <= 8; n++) items = items.concat(shuffle_(BANK[n].final).slice(0, FINAL_PER_LECTURE));
  } else {
    items = BANK[LECTURE_OF[trainer]].exam.slice();
  }
  items = shuffle_(items);
  const ids = items.map(it => it.id);
  const t0 = Date.now();
  const sid = Utilities.getUuid().replace(/-/g, '').slice(0, 16);
  const ticket = [sid, trainer, room, fio, group, ids.join(','), t0].join('|');
  return {
    ok: true, sid: sid, t0: t0, ids: ids, sig: sign_(ticket), title: TITLES[trainer], timeLimitMin: TIME_LIMIT_MIN,
    items: items.map(it => ({
      id: it.id, lec: lecOf_(it.id), type: it.type, q: it.q, unit: it.unit || '',
      o: it.type === 'num' ? null : shuffle_(it.o)          // варианты перемешаны, правильный не первый
    }))
  };
}

// Конец: проверяем подпись билета, сами считаем баллы, записываем строку. Ответы студенту не возвращаем.
function finish_(d) {
  if (typeof BANK === 'undefined') return { ok: false, error: 'no-bank' };
  const room = String(d.room || '').toUpperCase();
  const fio = normName_(d.fio), group = normName_(d.group).toUpperCase();
  const ids = (d.ids || []).map(String);
  const t0 = Number(d.t0);
  const ticket = [String(d.sid), room[0], room, fio, group, ids.join(','), t0].join('|');
  if (!d.sig || sign_(ticket) !== d.sig) return { ok: false, error: 'ticket' };
  const now = Date.now();
  if (TIME_LIMIT_MIN > 0 && now - t0 > (TIME_LIMIT_MIN + 5) * 60000) return { ok: false, error: 'late' };

  const answers = d.answers || {};
  let score = 0;
  const wrong = [];
  ids.forEach(id => {
    const it = itemById_(id);
    if (!it) return;
    if (isRight_(it, answers[id])) score++;
    else wrong.push({ id: id, q: plain_(it.q), ref: it.ref || '' });
  });
  const total = ids.length;
  const pct = total ? Math.round(score / total * 100) : 0;
  const res = { ok: true, score: score, total: total, pct: pct, wrong: wrong };

  const lock = LockService.getScriptLock();
  try { lock.waitLock(30000); } catch (err) { return { ok: false, error: 'busy' }; }
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const all = sheet_(ss, SHEET_ALL);
    // повторная отправка той же попытки (кнопка «Отправить ещё раз») не создаёт дубль
    const last = all.getLastRow();
    if (last > 1) {
      const from = Math.max(2, last - 1000);
      const sids = all.getRange(from, KEYS.indexOf('uid') + 1, last - from + 1, 1).getValues().map(r => String(r[0]));
      if (sids.indexOf(String(d.sid)) !== -1) { res.duplicate = true; return res; }
    }
    const row = {
      received: new Date(), group: group, fio: fio, room: room, title: TITLES[room[0]], trainer: room[0],
      score: score, total: total, pct: pct, mistakes: wrong.length ? wrong.map(w => w.id).join(', ') : 'нет',
      seconds: Math.round((now - t0) / 1000), started: new Date(t0).toISOString(),
      check: 'сервер', consent: String(d.consent || '').slice(0, 60), uid: String(d.sid)
    };
    const values = KEYS.map(k => cell_(k, row[k]));
    append_(all, values);
    append_(sheet_(ss, groupSheetName_(group)), values);
    rebuildSoon_(ss);
  } finally {
    lock.releaseLock();
  }
  return res;
}

function list_(d) {
  const k = keyError_(d);
  if (k) return k;
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  // пока открыт кабинет, сводки в таблице догоняют новые результаты
  const lock = LockService.getScriptLock();
  if (lock.tryLock(3000)) { try { rebuildSoon_(ss); } finally { lock.releaseLock(); } }
  const sh = ss.getSheetByName(SHEET_ALL);
  if (!sh || sh.getLastRow() < 2) return { ok: true, rows: [] };
  const values = sh.getRange(2, 1, sh.getLastRow() - 1, KEYS.length).getValues();
  return {
    ok: true, maxAttempts: MAX_ATTEMPTS, rows: values.map(v => {
      const o = {};
      KEYS.forEach((key, i) => { o[key] = v[i] instanceof Date ? v[i].toISOString() : v[i]; });
      return o;
    })
  };
}

// тексты зачётных заданий с ответами — только для кабинета преподавателя («Трудные задания»)
function bankForTeacher_(d) {
  const k = keyError_(d);
  if (k) return k;
  if (typeof BANK === 'undefined') return { ok: false, error: 'no-bank' };
  const items = [];
  for (let n = 1; n <= 8; n++) BANK[n].exam.concat(BANK[n].final).forEach(it => items.push({
    id: it.id, q: plain_(it.q), ref: it.ref || '',
    answer: it.type === 'num' ? String(it.ans).replace('.', ',') + (it.unit ? ' ' + it.unit : '')
      : it.type === 'order' ? it.o.map((s, i) => (i + 1) + ') ' + plain_(s)).join('  ') : plain_(it.o[0])
  }));
  return { ok: true, items: items };
}

function keyError_(d) {
  if (TEACHER_KEY === DEFAULT_KEY) return { ok: false, error: 'default-key' };
  if (String(d.key || '') !== TEACHER_KEY) { Utilities.sleep(800); return { ok: false, error: 'key' }; }   // пауза мешает подбору пароля
  return null;
}

function isRight_(it, v) {
  if (v === undefined || v === null) return false;
  if (it.type === 'num') { const x = Number(String(v).replace(',', '.')); return !isNaN(x) && Math.abs(x - it.ans) <= (it.tol || 0) + 1e-9; }
  if (it.type === 'order') return Array.isArray(v) && v.length === it.o.length && v.every((s, i) => String(s) === it.o[i]);
  return String(v) === it.o[0];
}

function itemById_(id) {
  const n = lecOf_(id);
  if (!BANK[n]) return null;
  return BANK[n].exam.concat(BANK[n].final).find(it => it.id === id) || null;
}
function lecOf_(id) { return Number(String(id).split('.')[0]); }
function plain_(s) { return String(s).replace(/<div class="kb">[\s\S]*?<\/div>/, '').replace(/<[^>]+>/g, '').trim(); }
function normName_(s) { return String(s || '').replace(/\s+/g, ' ').trim().slice(0, 80); }

function roomOk_(c) {
  if (!/^[A-Z0-9]{5}$/.test(c) || LECTURE_OF[c[0]] === undefined) return false;
  let s = 0;
  for (let i = 0; i < 4; i++) { const k = ROOM_ALPH.indexOf(c[i]); if (k < 0) return false; s += k * (i + 3); }
  return ROOM_ALPH[s % ROOM_ALPH.length] === c[4];
}

function attemptsOf_(room, fio, group) {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_ALL);
  if (!sh || sh.getLastRow() < 2) return 0;
  const v = sh.getRange(2, 1, sh.getLastRow() - 1, KEYS.length).getValues();
  const ir = KEYS.indexOf('room'), ifio = KEYS.indexOf('fio'), ig = KEYS.indexOf('group');
  const f = fio.toLowerCase(), g = group.toLowerCase();
  return v.filter(r => String(r[ir]) === room && String(r[ifio]).toLowerCase() === f && String(r[ig]).toLowerCase() === g).length;
}

function shuffle_(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; }
  return a;
}

// подпись билета попытки: секрет создаётся один раз и хранится в свойствах скрипта, браузер его не видит
function sign_(s) {
  const props = PropertiesService.getScriptProperties();
  let secret = props.getProperty('ticketSecret');
  if (!secret) { secret = Utilities.getUuid() + Utilities.getUuid(); props.setProperty('ticketSecret', secret); }
  return Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(s, secret)).replace(/=+$/, '');
}

// меню в таблице: пересобрать сводки вручную (например, после ручного удаления строк)
function onOpen() {
  SpreadsheetApp.getUi().createMenu('Тренажёры ИИТ')
    .addItem('Обновить сводку и комнаты', 'rebuildMenu')
    .addItem('Пересобрать листы групп', 'rebuildGroupsMenu')
    .addToUi();
}
function rebuildMenu() { rebuild_(SpreadsheetApp.getActiveSpreadsheet()); }
function rebuildGroupsMenu() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  ss.getSheets().filter(s => s.getName().indexOf(GROUP_PREFIX) === 0).forEach(s => ss.deleteSheet(s));
  const all = ss.getSheetByName(SHEET_ALL);
  if (all && all.getLastRow() > 1) {
    const values = all.getRange(2, 1, all.getLastRow() - 1, KEYS.length).getValues();
    const gi = KEYS.indexOf('group');
    const by = {};
    values.forEach(v => { (by[v[gi]] = by[v[gi]] || []).push(v); });
    Object.keys(by).forEach(g => {
      const sh = sheet_(ss, groupSheetName_(g));
      sh.getRange(2, 1, by[g].length, KEYS.length).setNumberFormats(by[g].map(formatsRow_)).setValues(by[g]);
    });
  }
  rebuild_(ss);
}

// ---------- служебное ----------
// сводки пересчитываются не чаще раза в минуту: когда весь класс сдаёт одновременно, приём результатов не тормозит
function rebuildSoon_(ss) {
  const cache = CacheService.getScriptCache();
  if (cache.get('rebuilt')) { cache.put('dirty', '1', 600); return; }
  try { rebuild_(ss); } catch (err) { console.error(err); }   // сводки вторичны — сбой в них не теряет результат
  cache.put('rebuilt', '1', 60);
  cache.remove('dirty');
}

function out_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function cell_(k, v) {
  if (k === 'received') return v;
  if (NUMERIC[k]) { const n = Number(v); return isNaN(n) ? '' : n; }
  let s = String(v == null ? '' : v).slice(0, 500);
  if (/^[=+\-@]/.test(s)) s = "'" + s;                  // защита от формул в ячейках
  return s;
}
function formatsRow_() {
  return KEYS.map(k => (k === 'received' ? 'dd.MM.yyyy HH:mm:ss' : NUMERIC[k] ? '0' : '@'));
}
// текстовые столбцы — в формате «обычный текст», иначе «1.03» в ошибках превратится в число
function append_(sh, row) {
  const r = sh.getLastRow() + 1;
  sh.getRange(r, 1, 1, row.length).setNumberFormats([formatsRow_()]).setValues([row]);
}

function sheet_(ss, name) {
  let sh = ss.getSheetByName(name);
  if (sh) return sh;
  sh = ss.insertSheet(name);
  sh.getRange(1, 1, 1, COLS.length).setValues([COLS.map(c => c[1])]).setFontWeight('bold').setBackground('#eef2f6');
  sh.setFrozenRows(1);
  sh.setColumnWidth(KEYS.indexOf('fio') + 1, 200);
  sh.setColumnWidth(KEYS.indexOf('title') + 1, 260);
  sh.setColumnWidth(KEYS.indexOf('mistakes') + 1, 220);
  return sh;
}

function groupSheetName_(g) {
  return (GROUP_PREFIX + String(g || 'без группы').replace(/[\[\]\*\?\/\\:']/g, '-')).slice(0, 90);
}

// «Сводка по группам» и «Комнаты» пересчитываются целиком по листу «Все результаты»
function rebuild_(ss) {
  const all = ss.getSheetByName(SHEET_ALL);
  if (!all || all.getLastRow() < 2) return;
  const values = all.getRange(2, 1, all.getLastRow() - 1, KEYS.length).getValues();
  const ix = {};
  KEYS.forEach((k, i) => { ix[k] = i; });

  // журнал: группа + ФИО → лучший процент по каждому тренажёру
  const people = {};
  values.forEach(v => {
    const key = v[ix.group] + '\u0001' + v[ix.fio];
    const p = people[key] || (people[key] = { group: v[ix.group], fio: v[ix.fio], best: {}, tries: 0 });
    p.tries++;
    const t = v[ix.trainer], pct = Number(v[ix.pct]) || 0;
    if (p.best[t] === undefined || pct > p.best[t]) p.best[t] = pct;
  });
  const list = Object.keys(people).map(k => people[k])
    .sort((a, b) => String(a.group).localeCompare(String(b.group), 'ru') || String(a.fio).localeCompare(String(b.fio), 'ru'));
  const head = ['Группа', 'ФИО'].concat(TRAINERS.map(t => t[1])).concat(['Средний по лекциям', 'Попыток']);
  const rows = list.map(p => {
    const lec = TRAINERS.slice(0, 8).map(t => p.best[t[0]]).filter(x => x !== undefined);
    const avg = lec.length ? Math.round(lec.reduce((s, x) => s + x, 0) / lec.length) : '';
    return [p.group, p.fio].concat(TRAINERS.map(t => (p.best[t[0]] === undefined ? '' : p.best[t[0]]))).concat([avg, p.tries]);
  });
  const colors = rows.map(r => r.map((x, i) => {
    if (i < 2 || i > TRAINERS.length + 2 || x === '') return null;
    return x >= 90 ? '#d5f0e3' : x >= 61 ? '#fdf0d0' : '#fadada';
  }));

  // комнаты: одно занятие — одна комната
  const rooms = {};
  values.forEach(v => {
    const r = rooms[v[ix.room]] || (rooms[v[ix.room]] = { room: v[ix.room], title: v[ix.title], first: v[ix.received], groups: {}, people: {}, sum: 0, n: 0, passed: {} });
    if (v[ix.received] < r.first) r.first = v[ix.received];
    r.groups[v[ix.group]] = 1;
    const who = v[ix.group] + '\u0001' + v[ix.fio];
    const pct = Number(v[ix.pct]) || 0;
    if (r.people[who] === undefined || pct > r.people[who]) r.people[who] = pct;
    r.n++;
  });
  const rhead = ['Комната', 'Тренажёр', 'Первый результат', 'Группы', 'Студентов', 'Попыток', 'Средний % (лучшие попытки)', 'Зачтено (≥ 61 %)'];
  const rrows = Object.keys(rooms).map(k => rooms[k]).sort((a, b) => b.first - a.first).map(r => {
    const best = Object.keys(r.people).map(k => r.people[k]);
    const avg = best.length ? Math.round(best.reduce((s, x) => s + x, 0) / best.length) : '';
    return [r.room, r.title, r.first, Object.keys(r.groups).join(', '), best.length, r.n, avg, best.filter(x => x >= 61).length];
  });
  writeTable_(ss, SHEET_ROOMS, rhead, rrows, null, 'Каждая комната — одно занятие. Новые комнаты сверху.');
  writeTable_(ss, SHEET_SUMMARY, head, rows, colors,
    'Лучший процент каждого студента по каждому тренажёру. Зелёный — от 90 %, жёлтый — от 61 %, красный — ниже 61 % (не зачтено).');
}

function writeTable_(ss, name, head, rows, colors, note) {
  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name, 0);
  sh.clear();
  sh.getRange(1, 1).setValue(note).setFontStyle('italic').setFontColor('#4e6276');
  sh.getRange(2, 1, 1, head.length).setValues([head]).setFontWeight('bold').setBackground('#eef2f6');
  sh.setFrozenRows(2);
  if (rows.length) {
    const rng = sh.getRange(3, 1, rows.length, head.length);
    rng.setValues(rows);
    if (colors) rng.setBackgrounds(colors);
  }
  sh.setColumnWidth(2, 220);
}
