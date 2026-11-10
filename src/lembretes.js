// Lembrete automático: manda um WhatsApp para o cliente um tempo antes do horário (padrão: 1 hora).
// A lista de quem lembrar fica na memória do servidor. O banco só é consultado quando algo muda
// (novo agendamento, cancelamento, configurações) e na virada do dia, para o Neon gratuito poder dormir.
const db = require('./db');
const repo = require('./repo');
const wa = require('./whatsapp');
const notify = require('./notify');
const { Agenda, today, nowMin } = require('./util');

const MIN_ANTES = 10; // faltando menos que isso para o horário, não manda mais (o cliente já deve estar a caminho)

let fila = []; // agendamentos de hoje que ainda não receberam lembrete
let cfg = null;
let dia = null;
let enviando = false;
let pendente = null;

async function refresh() {
  const settings = await repo.getSettings();
  const t = today();
  let lista = [];
  if (settings.remindOn) {
    const { rows } = await db.query(`
      SELECT a.id, a.time, a.service_name, c.name, c.phone
        FROM appointments a JOIN clients c ON c.id = a.client_id
       WHERE a.date = $1 AND a.status = 'agendado' AND a.remind_status IS NULL
       ORDER BY a.time`, [t]);
    lista = rows.map((x) => ({ id: x.id, time: x.time, service: x.service_name, name: x.name, phone: x.phone }));
  }
  cfg = settings; dia = t; fila = lista;
}
/** Pede para recarregar a lista (junta vários pedidos seguidos num só). */
function schedule() {
  clearTimeout(pendente);
  pendente = setTimeout(() => refresh().catch((e) => console.error('Lembretes:', e.message)), 1500);
}

const texto = (x, settings) => Agenda.remindText(settings.remindMsg, { nome: x.name, hora: x.time, servico: x.service, barbearia: settings.shopName });

/** Marca o agendamento e avisa o painel na hora. */
async function marcar(id, status) {
  const { rows } = await db.query('UPDATE appointments SET remind_status = $2, remind_at = now() WHERE id = $1 RETURNING remind_at', [id, status]);
  notify.broadcast('lembrete', { id: String(id), status, at: rows[0] && rows[0].remind_at });
}

/** Envia o lembrete de um agendamento. Reserva antes no banco para nunca mandar duas vezes. */
async function enviar(id, settings, force) {
  const { rows } = await db.query(`
    UPDATE appointments a SET remind_status = 'enviando'
      FROM clients c
     WHERE a.id = $1 AND c.id = a.client_id AND a.status = 'agendado' ${force ? "AND coalesce(a.remind_status, '') <> 'enviando'" : 'AND a.remind_status IS NULL'}
     RETURNING a.time, a.service_name, c.name, c.phone`, [id]);
  if (!rows[0]) return false;
  const x = rows[0];
  try {
    await wa.send(x.phone, texto({ name: x.name, time: x.time, service: x.service_name }, settings));
    await marcar(id, 'enviado');
    return true;
  } catch (err) {
    await marcar(id, 'falhou');
    if (force) throw err;
    console.error(`Lembrete do agendamento ${id} não foi:`, err.message);
    return false;
  }
}

async function tick() {
  if (enviando) return;
  if (today() !== dia) { try { await refresh(); } catch { return; } }
  if (!cfg || !cfg.remindOn || wa.state() !== 'on' || !fila.length) return;
  enviando = true;
  try {
    let mandou = false;
    for (;;) {
      const nm = nowMin();
      const x = fila.find((y) => nm >= Agenda.toMin(y.time) - cfg.remindMin);
      if (!x) break;
      fila = fila.filter((y) => y !== x);
      if (nm > Agenda.toMin(x.time) - MIN_ANTES) continue; // tarde demais (marcou em cima da hora ou o servidor estava desligado)
      if (mandou) await new Promise((r) => setTimeout(r, 20000 + Math.random() * 25000)); // um de cada vez, com intervalo
      if (wa.state() !== 'on') { fila.unshift(x); break; }
      mandou = (await enviar(x.id, cfg)) || mandou;
    }
  } finally { enviando = false; }
}

/** Botão "Mandar agora" do painel: manda mesmo fora do horário do lembrete. */
async function sendNow(id) {
  const settings = await repo.getSettings();
  fila = fila.filter((y) => String(y.id) !== String(id));
  const ok = await enviar(id, settings, true);
  if (!ok) throw Object.assign(new Error('Esse agendamento não está mais aguardando.'), { status: 400 });
}

/** Mensagem de teste para o próprio barbeiro ver como chega. */
async function sendTest(phone) {
  const settings = await repo.getSettings();
  const h = Agenda.fromMin(Math.min(nowMin() + settings.remindMin, 23 * 60));
  await wa.send(phone, texto({ name: 'Cliente Teste', time: h, service: 'Corte' }, settings));
}

function start() {
  refresh().catch((e) => console.error('Lembretes:', e.message));
  setInterval(() => tick().catch((e) => console.error('Lembretes:', e.message)), 30000);
}

module.exports = { start, schedule, sendNow, sendTest };
