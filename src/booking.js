// Criação de agendamento com todas as conferências, usada pelo site e pelo painel.
const repo = require('./repo');
const { Agenda, fail, today, nowMin, cleanId } = require('./util');

const MAX_SVCS = 4; // serviços no mesmo horário

/**
 * Confere os serviços escolhidos (um ou vários no mesmo horário) e soma tempo e preço.
 * items só é gravado quando há mais de um serviço (mesmo formato do "fechar atendimento").
 */
async function contaDe(c, serviceIds) {
  const ids = [...new Set((Array.isArray(serviceIds) ? serviceIds : [serviceIds]).filter((v) => v != null && v !== '').map(cleanId))];
  if (!ids.length) fail(400, 'Escolha pelo menos um serviço.');
  if (ids.length > MAX_SVCS) fail(400, `Escolha até ${MAX_SVCS} serviços no mesmo horário.`);
  const { rows } = await c.query('SELECT * FROM services WHERE id = ANY($1::int[]) AND active', [ids]);
  const l = ids.map((id) => rows.find((x) => x.id === id));
  if (l.some((x) => !x)) fail(400, 'Esse serviço não está mais disponível.');
  const price = Math.round(l.reduce((s, x) => s + Number(x.price), 0) * 100) / 100;
  return {
    l, price,
    dur: l.reduce((s, x) => s + x.duration, 0),
    name: l.map((x) => x.name).join(' + ').slice(0, 200),
    items: l.length > 1 ? l.map((x) => ({ serviceId: String(x.id), name: x.name, price: Number(x.price) })) : null,
  };
}

/**
 * @param c        conexão dentro de uma transação
 * @param opts     { clientId, date, time, serviceId | serviceIds, origin, enforceWindow, device?, ipHash?, forName? }
 */
async function createAppointment(c, { clientId, date, time, serviceId, serviceIds, origin, enforceWindow, device = null, ipHash = null, forName = null }) {
  if (!Agenda.isDate(date)) fail(400, 'Escolha um dia válido.');
  if (!Agenda.isTime(time)) fail(400, 'Escolha um horário válido.');

  const t = today();
  if (date < t) fail(400, 'Esse dia já passou.');
  if (date === t && Agenda.toMin(time) <= nowMin()) fail(400, 'Esse horário já passou. Escolha outro.');

  const settings = await repo.getSettings(c);
  if (enforceWindow && (date < settings.bookFrom || date > settings.bookTo)) {
    fail(400, 'Essa data ainda não está aberta para agendamento.');
  }

  const conta = await contaDe(c, Array.isArray(serviceIds) && serviceIds.length ? serviceIds : [serviceId]);

  // Trava o dia: se dois clientes tentarem o mesmo horário ao mesmo tempo, um espera o outro.
  await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['agenda:' + date]);

  const blocked = await repo.getBlocked(c, date);
  const appts = await repo.getApptsOn(c, date);
  if (!Agenda.daySlots(settings, blocked, date).length) fail(400, 'A barbearia não atende nesse dia.');
  // Pelo site o cliente só começa nos horários da lista (de 30 em 30 ou de 1 em 1 hora). O barbeiro, pelo painel, pode encaixar em qualquer meia hora.
  if (origin === 'site' && !Agenda.startSlots(settings, blocked, date).includes(time)) fail(400, 'Esse horário não está na lista. Escolha outro.');
  if (!Agenda.fits(settings, blocked, appts, date, time, conta.dur)) {
    fail(409, conta.l.length > 1 ? 'Esses serviços juntos não cabem nesse horário. Escolha outro horário ou menos serviços.' : 'Esse horário acabou de ser ocupado. Escolha outro.');
  }

  const { rows } = await c.query(
    `INSERT INTO appointments (client_id, service_id, service_name, price, duration, date, time, origin, device, ip_hash, for_name, items)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
    [clientId, conta.l[0].id, conta.name, conta.price, conta.dur, date, time, origin, device, ipHash, forName, conta.items && JSON.stringify(conta.items)]
  );
  return repo.mapAppt(rows[0]);
}

/** Acha o cliente pelo WhatsApp ou cria um novo. */
async function findOrCreateClient(c, name, phone) {
  const found = await c.query('SELECT * FROM clients WHERE phone = $1', [phone]);
  if (found.rows[0]) return repo.mapClient(found.rows[0]);
  const { rows } = await c.query(
    "INSERT INTO clients (name, phone, created_at) VALUES ($1, $2, $3) ON CONFLICT (phone) DO UPDATE SET phone = EXCLUDED.phone RETURNING *",
    [name, phone, today()]
  );
  return repo.mapClient(rows[0]);
}

module.exports = { MAX_SVCS, contaDe, createAppointment, findOrCreateClient };
