// Lista de espera: quando vaga um horário (cancelamento ou remarcação), o sistema marca sozinho
// para o primeiro da fila daquele dia em que os serviços cabem e avisa pelo WhatsApp dos lembretes.
const db = require('./db');
const repo = require('./repo');
const wa = require('./whatsapp');
const notify = require('./notify');
const guard = require('./guard');
const { Agenda, today, nowMin } = require('./util');

const PERIODOS = ['qualquer', 'manha', 'tarde', 'noite'];
/** Mesma divisão do site: manhã até 12h, tarde até 18h, noite depois disso. */
function noPeriodo(t, p) {
  const m = Agenda.toMin(t);
  return p === 'manha' ? m < 720 : p === 'tarde' ? m >= 720 && m < 1080 : p === 'noite' ? m >= 1080 : true;
}

/** Lista de espera funcionando: ligada nas configurações e com o WhatsApp dos lembretes conectado. */
const ativa = (settings) => !!settings.waitOn && wa.state() === 'on';

/** Posição na fila de cada pedido (1 = primeiro). */
const POS_SQL = `(SELECT count(*) FROM waitlist w2 WHERE w2.date = w.date AND w2.status = 'aguardando'
                   AND (w2.created_at, w2.id) <= (w.created_at, w.id))::int AS pos`;

/** O cliente marcou horário no dia: sai da fila desse dia quando já não pode marcar mais nenhum. */
async function saiSeLotou(c, settings, client, date) {
  const lim = guard.limitsOf(settings, client).perDay;
  const { rows } = await c.query("SELECT count(*)::int AS n FROM appointments WHERE client_id = $1 AND date = $2 AND status = 'agendado'", [client.id, date]);
  if (!lim || rows[0].n >= lim) {
    await c.query("UPDATE waitlist SET status = 'saiu' WHERE client_id = $1 AND date = $2 AND status = 'aguardando'", [client.id, date]);
  }
}

// ----- Mensagem -----
const DIAS = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const diaLongo = (ds) => { const d = Agenda.parse(ds); return `${DIAS[d.getDay()]}, ${d.getDate()} de ${MESES[d.getMonth()]}`; };
const dinheiro = (v) => 'R$ ' + Number(v || 0).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.');

/** Marca o primeiro da fila que cabe num horário livre do dia. Devolve o que marcou, ou null. */
async function marcarUm(date) {
  return db.tx(async (c) => {
    const settings = await repo.getSettings(c);
    if (!ativa(settings)) return null;
    await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['agenda:' + date]);
    const blocked = await repo.getBlocked(c, date);
    const slots = Agenda.startSlots(settings, blocked, date);
    if (!slots.length) return null;
    const appts = await repo.getApptsOn(c, date);
    // Em cima da hora não passa a vaga: o cliente não daria tempo de chegar
    const limite = date === today() ? nowMin() + settings.waitMin : -1;
    const { rows: fila } = await c.query(
      `SELECT w.*, cl.name, cl.phone, cl.blocked, cl.per_day FROM waitlist w JOIN clients cl ON cl.id = w.client_id
        WHERE w.date = $1 AND w.status = 'aguardando' ORDER BY w.created_at, w.id FOR UPDATE OF w`, [date]);
    for (const e of fila) {
      const client = repo.mapClient({ ...e, id: e.client_id });
      if (client.blocked) { await c.query("UPDATE waitlist SET status = 'saiu' WHERE id = $1", [e.id]); continue; }
      const lim = guard.limitsOf(settings, client).perDay;
      const ja = appts.filter((a) => String(a.clientId) === String(e.client_id) && a.status === 'agendado').length;
      if (lim && ja >= lim) { await c.query("UPDATE waitlist SET status = 'saiu' WHERE id = $1", [e.id]); continue; }
      const t = slots.find((s) => Agenda.toMin(s) > limite && noPeriodo(s, e.period) && Agenda.fits(settings, blocked, appts, date, s, e.duration));
      if (!t) continue;
      const items = Array.isArray(e.items) ? e.items : [];
      const price = Math.round(items.reduce((s, x) => s + Number(x.price || 0), 0) * 100) / 100;
      const nome = items.map((x) => x.name).join(' + ').slice(0, 200) || 'Atendimento';
      const lista = items.length > 1 ? items.map((x) => ({ serviceId: x.serviceId, name: x.name, price: Number(x.price) })) : null;
      const { rows } = await c.query(
        `INSERT INTO appointments (client_id, service_id, service_name, price, duration, date, time, origin, items)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'espera', $8) RETURNING *`,
        [e.client_id, items[0] && items[0].serviceId ? Number(items[0].serviceId) : null, nome, price, e.duration, date, t, lista && JSON.stringify(lista)]);
      const appt = repo.mapAppt(rows[0]);
      await c.query("UPDATE waitlist SET status = 'marcado', appointment_id = $2 WHERE id = $1", [e.id, appt.id]);
      const { rows: n } = await c.query("INSERT INTO notifications (type, appointment_id) VALUES ('espera', $1) RETURNING id, created_at", [appt.id]);
      return { appt, name: e.name, phone: e.phone, settings, notif: n[0] };
    }
    return null;
  });
}

/**
 * Vagou horário num dia: preenche com a fila enquanto couber alguém (uma vaga de 1 hora pode servir para dois de 30 minutos).
 * Roda depois da resposta ao cliente; erro aqui só vai para o terminal.
 */
async function preencher(date) {
  if (!Agenda.isDate(date) || date < today()) return;
  for (let i = 0; i < 6; i++) {
    const r = await marcarUm(date);
    if (!r) return;
    const { appt, settings } = r;
    notify.broadcast('agendamento', { id: r.notif.id, type: 'espera', at: r.notif.created_at, appointment: appt, clientName: r.name });
    const texto = Agenda.esperaText({
      nome: r.name, dia: diaLongo(appt.date), hora: `${appt.time} às ${Agenda.fromMin(Agenda.toMin(appt.time) + appt.dur)}`,
      servico: appt.service, valor: dinheiro(appt.price), barbearia: settings.shopName,
    });
    try { await wa.send(r.phone, texto); } catch (err) { console.error(`Lista de espera: a mensagem do agendamento ${appt.id} não foi:`, err.message); }
    require('./lembretes').schedule();
  }
}
/** Chama preencher sem segurar quem pediu. */
function vagou(...datas) {
  for (const d of [...new Set(datas)]) preencher(d).catch((err) => console.error('Lista de espera:', err.message));
}

module.exports = { PERIODOS, noPeriodo, ativa, POS_SQL, saiSeLotou, vagou, preencher };
