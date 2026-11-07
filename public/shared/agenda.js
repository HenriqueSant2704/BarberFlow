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

  return { STEP, TZ, pad, toMin, fromMin, iso, parse, addDays, isDate, isTime, todayIn, nowMinIn, isBlocked, daySlots, busySet, fits, isPast };
});
