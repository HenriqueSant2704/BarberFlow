// Criação de agendamento com todas as conferências, usada pelo site e pelo painel.
const repo = require('./repo');
const { Agenda, fail, today, nowMin, cleanId } = require('./util');

/**
 * @param c        conexão dentro de uma transação
 * @param opts     { clientId, date, time, serviceId, origin, enforceWindow, device?, ipHash? }
 */
async function createAppointment(c, { clientId, date, time, serviceId, origin, enforceWindow, device = null, ipHash = null }) {
  if (!Agenda.isDate(date)) fail(400, 'Escolha um dia válido.');
  if (!Agenda.isTime(time)) fail(400, 'Escolha um horário válido.');
  const sid = cleanId(serviceId);

  const t = today();
  if (date < t) fail(400, 'Esse dia já passou.');
  if (date === t && Agenda.toMin(time) <= nowMin()) fail(400, 'Esse horário já passou. Escolha outro.');

  const settings = await repo.getSettings(c);
  if (enforceWindow && (date < settings.bookFrom || date > settings.bookTo)) {
    fail(400, 'Essa data ainda não está aberta para agendamento.');
  }

  const { rows: svcRows } = await c.query('SELECT * FROM services WHERE id = $1 AND active', [sid]);
  const svc = svcRows[0];
  if (!svc) fail(400, 'Esse serviço não está mais disponível.');

  // Trava o dia: se dois clientes tentarem o mesmo horário ao mesmo tempo, um espera o outro.
  await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['agenda:' + date]);

  const blocked = await repo.getBlocked(c, date);
  const appts = await repo.getApptsOn(c, date);
  if (!Agenda.daySlots(settings, blocked, date).length) fail(400, 'A barbearia não atende nesse dia.');
  // Pelo site o cliente só começa nos horários da lista (de 30 em 30 ou de 1 em 1 hora). O barbeiro, pelo painel, pode encaixar em qualquer meia hora.
  if (origin === 'site' && !Agenda.startSlots(settings, blocked, date).includes(time)) fail(400, 'Esse horário não está na lista. Escolha outro.');
  if (!Agenda.fits(settings, blocked, appts, date, time, svc.duration)) {
    fail(409, 'Esse horário acabou de ser ocupado. Escolha outro.');
  }

  const { rows } = await c.query(
    `INSERT INTO appointments (client_id, service_id, service_name, price, duration, date, time, origin, device, ip_hash)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [clientId, svc.id, svc.name, svc.price, svc.duration, date, time, origin, device, ipHash]
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

module.exports = { createAppointment, findOrCreateClient };
