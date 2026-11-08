// Travas contra agendamento de trote, usadas só no site do cliente.
// O barbeiro, pelo painel, não passa por nenhuma delas.
const crypto = require('crypto');
const { fail, today } = require('./util');

const FALE = 'Para marcar mais, fale direto com a barbearia.';

/** Identificador do aparelho que o site manda (gerado no navegador, guardado no próprio celular). */
function deviceOf(req) {
  const d = String(req.get('X-Device') || '');
  return /^[A-Za-z0-9-]{8,64}$/.test(d) ? d : null;
}

/** IP embaralhado: dá para contar repetições sem guardar o IP de ninguém. */
function ipHashOf(req) {
  const ip = String(req.ip || '');
  if (!ip) return null;
  return crypto.createHash('sha256').update(ip + '|' + (process.env.JWT_SECRET || '')).digest('hex').slice(0, 24);
}

/** Muitos agendamentos saindo do mesmo aparelho (ou da mesma rede) nas últimas 24 horas. */
async function checkDevice(c, settings, device, ipHash) {
  const max = settings.maxDevice;
  if (!max) return;
  if (device) {
    const { rows } = await c.query(
      "SELECT count(*)::int AS n FROM appointments WHERE origin = 'site' AND device = $1 AND created_at > now() - interval '24 hours'", [device]);
    if (rows[0].n >= max) fail(429, 'Muitos agendamentos feitos deste aparelho hoje. ' + FALE);
  }
  if (ipHash) {
    // Na mesma rede (Wi-Fi de casa, 4G da operadora) pode haver várias pessoas: limite bem mais folgado.
    const { rows } = await c.query(
      "SELECT count(*)::int AS n FROM appointments WHERE origin = 'site' AND ip_hash = $1 AND created_at > now() - interval '24 hours'", [ipHash]);
    if (rows[0].n >= max * 3) fail(429, 'Muitos agendamentos feitos desta conexão hoje. ' + FALE);
  }
}

/** Cliente bloqueado e limites de horários por pessoa. */
async function checkClient(c, settings, client, date) {
  if (client.blocked) fail(403, 'Não foi possível agendar pelo site. Fale direto com a barbearia.');
  // Trava a pessoa: dois pedidos ao mesmo tempo não furam o limite
  await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['cli:' + client.id]);
  const { rows } = await c.query(
    `SELECT count(*) FILTER (WHERE date >= $2)::int AS ativos,
            count(*) FILTER (WHERE date = $3)::int  AS no_dia
       FROM appointments WHERE client_id = $1 AND status = 'agendado'`,
    [client.id, today(), date]);
  const { ativos, no_dia: noDia } = rows[0];
  if (settings.maxPerDay && noDia >= settings.maxPerDay) {
    const [, m, d] = date.split('-');
    fail(403, noDia === 1
      ? `Você já tem um horário marcado em ${d}/${m}. Veja em "Meus horários".`
      : `Você já tem ${noDia} horários marcados em ${d}/${m}. ${FALE}`);
  }
  if (settings.maxActive && ativos >= settings.maxActive) {
    fail(403, (ativos === 1
      ? 'Você já tem um horário marcado. Quando ele passar, você pode marcar de novo. '
      : `Você já tem ${ativos} horários marcados. Quando um deles passar, você pode marcar de novo. `) + FALE);
  }
}

module.exports = { deviceOf, ipHashOf, checkDevice, checkClient };
