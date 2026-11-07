/*
 * Regras da agenda, usadas igualzinho no navegador e no servidor.
 * O servidor sempre confere de novo antes de gravar, então o navegador
 * só usa isto para mostrar os horários livres.
 *
 * settings: { open, close, lunchStart, lunchEnd, closed:[0..6] }
 * blocked:  [{ date:'AAAA-MM-DD' }]
 * appts:    [{ id, date, time:'HH:MM', dur, status }]
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Agenda = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const STEP = 30; // minutos de cada bloco
  const TZ = 'America/Sao_Paulo';

  const pad = (n) => String(n).padStart(2, '0');
  const toMin = (t) => { const [h, m] = String(t).split(':').map(Number); return h * 60 + m; };
  const fromMin = (m) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
  const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parse = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && iso(parse(s)) === s;
  const isTime = (s) => typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);

  /** Data de hoje no fuso da barbearia, no formato AAAA-MM-DD. */
  function todayIn(tz = TZ) {
    return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  }
  /** Minutos passados desde a meia-noite, no fuso da barbearia. */
  function nowMinIn(tz = TZ) {
    const p = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date());
    const get = (t) => Number(p.find((x) => x.type === t).value);
    return get('hour') * 60 + get('minute');
  }

  function isBlocked(blocked, ds) { return (blocked || []).some((b) => b.date === ds); }

  /** Todos os horários de início possíveis num dia (sem olhar se estão ocupados). */
  function daySlots(settings, blocked, ds) {
    const d = parse(ds);
    if ((settings.closed || []).includes(d.getDay()) || isBlocked(blocked, ds)) return [];
    const o = toMin(settings.open), c = toMin(settings.close);
    const ls = toMin(settings.lunchStart), le = toMin(settings.lunchEnd);
    const out = [];
    for (let m = o; m + STEP <= c; m += STEP) {
      if (m >= ls && m < le) continue;
      out.push(fromMin(m));
    }
    return out;
  }

  /** Blocos ocupados num dia. Cancelados não ocupam. */
  function busySet(appts, ds, ignoreId) {
    const set = new Set();
    for (const a of appts || []) {
      if (a.date !== ds || a.status === 'cancelado' || (ignoreId != null && String(a.id) === String(ignoreId))) continue;
      const n = Math.ceil(a.dur / STEP);
      for (let i = 0; i < n; i++) set.add(fromMin(toMin(a.time) + STEP * i));
    }
    return set;
  }

  /** O serviço de "dur" minutos cabe começando em "t"? */
  function fits(settings, blocked, appts, ds, t, dur, ignoreId) {
    const b = busySet(appts, ds, ignoreId);
    const slots = new Set(daySlots(settings, blocked, ds));
    const n = Math.ceil(dur / STEP);
    for (let i = 0; i < n; i++) {
      const s = fromMin(toMin(t) + STEP * i);
      if (!slots.has(s) || b.has(s)) return false;
    }
    return true;
  }

  function isPast(ds, t, today, nowMin) {
    if (ds < today) return true;
    if (ds > today) return false;
    return toMin(t) <= nowMin;
  }

  // ----- Conferência de nome e WhatsApp (mesma regra no site, no painel e no servidor) -----
  const DDDS = new Set('11 12 13 14 15 16 17 18 19 21 22 24 27 28 31 32 33 34 35 37 38 41 42 43 44 45 46 47 48 49 51 53 54 55 61 62 63 64 65 66 67 68 69 71 73 74 75 77 79 81 82 83 84 85 86 87 88 89 91 92 93 94 95 96 97 98 99'.split(' '));
  const LIGA = new Set(['da', 'das', 'de', 'do', 'dos', 'e', 'di', 'du', 'van', 'von']);

  /** Arruma espaços e deixa "joão DA silva" como "João da Silva". */
  function tidyName(v) {
    return String(v || '').trim().replace(/\s+/g, ' ').split(' ').map((w, i) => {
      const l = w.toLowerCase();
      if (i > 0 && LIGA.has(l)) return l;
      return l.replace(/(^|-)(\S)/g, (m, sep, ch) => sep + ch.toUpperCase());
    }).join(' ');
  }
  /** Devolve '' se o nome estiver bom, ou a mensagem do que falta. */
  function nameError(v) {
    const s = String(v || '').trim().replace(/\s+/g, ' ');
    if (!s) return 'Digite seu nome e sobrenome.';
    if (s.length > 80) return 'O nome está muito grande.';
    if (!/^[A-Za-zÀ-ÖØ-öø-ÿ' .-]+$/.test(s)) return 'O nome só pode ter letras.';
    const words = s.split(' ').filter((w) => !LIGA.has(w.toLowerCase()));
    if (words.length < 2) return 'Digite o nome e o sobrenome. Ex.: João Silva.';
    if (words.some((w) => w.replace(/[^A-Za-zÀ-ÖØ-öø-ÿ]/g, '').length < 2)) return 'Escreva o nome e o sobrenome por inteiro, sem abreviar.';
    if (words.some((w) => /^(.)\1+$/i.test(w))) return 'Esse nome não parece de verdade. Digite o nome e o sobrenome.';
    return '';
  }
  /** Só os números do WhatsApp, sem o +55 do começo. */
  function phoneDigits(v) {
    let d = String(v || '').replace(/\D/g, '');
    if (d.length === 13 && d.startsWith('55')) d = d.slice(2);
    if (d.length === 12 && d.startsWith('0')) d = d.slice(1);
    return d;
  }
  /** Devolve '' se for um celular brasileiro válido, ou a mensagem do problema. */
  function phoneError(v) {
    const d = phoneDigits(v);
    const ex = ' Ex.: (11) 97425-8136.';
    if (d.length !== 11) return 'Digite o WhatsApp com DDD, 11 números.' + ex;
    if (!DDDS.has(d.slice(0, 2))) return 'Esse DDD não existe. Confira os dois primeiros números.' + ex;
    if (d[2] !== '9') return 'Celular começa com 9 depois do DDD.' + ex;
    const n = d.slice(3);
    if (/^(\d)\1+$/.test(n) || '0123456789'.includes(n) || '9876543210'.includes(n)) return 'Esse número não parece de verdade. Digite o seu WhatsApp.';
    return '';
  }

  return { STEP, TZ, pad, toMin, fromMin, iso, parse, addDays, isDate, isTime, todayIn, nowMinIn, isBlocked, daySlots, busySet, fits, isPast, tidyName, nameError, phoneDigits, phoneError };
});
