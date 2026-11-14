// Rotas usadas pelo site do cliente (celular). Não exigem senha.
const express = require('express');
const db = require('../db');
const repo = require('../repo');
const { signClient, readClient, requireClient } = require('../auth');
const { createAppointment, findOrCreateClient, contaDe } = require('../booking');
const espera = require('../espera');
const avisos = require('../avisos');
const notify = require('../notify');
const wa = require('../whatsapp');
const guard = require('../guard');
const { Agenda, ah, fail, today, nowMin, cleanName, cleanPhone, lookupPhone, cleanId } = require('../util');

const r = express.Router();

// Dados da barbearia: nome, cores, serviços, horários e dias bloqueados
r.get('/info', ah(async (req, res) => {
  const t = today();
  const [settings, services, blocked] = await Promise.all([repo.getSettings(), repo.getServices(), repo.getBlocked(db, t)]);
  // Lembrete: o site avisa o cliente e mostra o número que vai mandar (para ele salvar)
  const w = wa.info();
  const remind = { on: settings.remindOn && w.state === 'on', min: settings.remindMin, phone: w.state === 'on' ? w.number : '' };
  delete settings.remindMsg;
  // Lista de espera: só aparece no site com o WhatsApp dos lembretes conectado (é por ele que o cliente fica sabendo)
  res.json({ settings, services, blocked, remind, espera: { on: espera.ativa(settings) }, today: t, nowMin: nowMin() });
}));

// Horários ocupados (sem nenhum dado dos clientes) entre duas datas
r.get('/ocupados', ah(async (req, res) => {
  const { from, to } = req.query;
  if (!Agenda.isDate(from) || !Agenda.isDate(to) || from > to) fail(400, 'Período inválido.');
  if ((Agenda.parse(to) - Agenda.parse(from)) / 864e5 > 190) fail(400, 'Período muito grande.');
  const { rows } = await db.query(
    "SELECT date, time, duration FROM appointments WHERE date BETWEEN $1 AND $2 AND status <> 'cancelado'", [from, to]);
  res.json(rows.map((x) => ({ date: x.date, time: x.time, dur: x.duration, status: 'agendado' })));
}));

// "Já sou cliente": procura pelo WhatsApp
r.post('/identificar', ah(async (req, res) => {
  const phone = lookupPhone(req.body.phone);
  const { rows } = await db.query('SELECT * FROM clients WHERE phone = $1', [phone]);
  if (!rows[0]) return res.status(404).json({ error: 'Não achamos esse número.' });
  const client = repo.mapClient(rows[0]);
  res.json({ client, token: signClient(client.id) });
}));

// Confirmar agendamento
r.post('/agendar', ah(async (req, res) => {
  const { date, time, serviceId, serviceIds } = req.body;
  const tokenClientId = readClient(req);
  const device = guard.deviceOf(req);
  const ipHash = guard.ipHashOf(req);
  const result = await db.tx(async (c) => {
    const settings = await repo.getSettings(c);
    let client;
    if (tokenClientId) {
      const { rows } = await c.query('SELECT * FROM clients WHERE id = $1', [tokenClientId]);
      if (!rows[0]) fail(401, 'Seu cadastro não foi encontrado. Entre de novo com seu WhatsApp.');
      client = repo.mapClient(rows[0]);
    } else {
      client = await findOrCreateClient(c, cleanName(req.body.name), cleanPhone(req.body.phone));
    }
    await guard.checkDevice(c, settings, device, ipHash, client);
    if (Agenda.isDate(date)) await guard.checkClient(c, settings, client, date);
    // "Para quem é esse horário?": só para quem o barbeiro liberou para a família
    const forName = client.perDay > 1 ? String(req.body.forName || '').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 40) || null : null;
    const appt = await createAppointment(c, { clientId: Number(client.id), date, time, serviceId, serviceIds, origin: 'site', enforceWindow: true, device, ipHash, forName });
    await espera.saiSeLotou(c, settings, client, date);
    // Trocando o dia de um pedido da lista de espera: marcou com vaga, sai da fila antiga
    if (req.body.trocaEspera) await c.query("UPDATE waitlist SET status = 'saiu' WHERE id = $1 AND client_id = $2 AND status = 'aguardando'", [cleanId(req.body.trocaEspera), client.id]);
    const { rows: n } = await c.query("INSERT INTO notifications (type, appointment_id) VALUES ('novo', $1) RETURNING id, created_at", [appt.id]);
    return { client, appt, notif: n[0] };
  });
  notify.broadcast('agendamento', {
    id: result.notif.id, type: 'novo', at: result.notif.created_at,
    appointment: result.appt, clientName: result.client.name,
  });
  res.status(201).json({ appointment: result.appt, client: result.client, token: signClient(result.client.id) });
}));

// ----- Área "Meus horários" e "Perfil" -----
r.get('/me', requireClient, ah(async (req, res) => {
  const { rows } = await db.query('SELECT * FROM clients WHERE id = $1', [req.clientId]);
  if (!rows[0]) fail(401, 'Cadastro não encontrado. Entre de novo com seu WhatsApp.');
  const { rows: ap } = await db.query(
    "SELECT * FROM appointments WHERE client_id = $1 AND status <> 'cancelado' ORDER BY date DESC, time DESC LIMIT 200", [req.clientId]);
  const { rows: esp } = await db.query(
    `SELECT w.*, ${espera.POS_SQL} FROM waitlist w WHERE w.client_id = $1 AND w.status = 'aguardando' AND w.date >= $2 ORDER BY w.date`, [req.clientId, today()]);
  res.json({ client: repo.mapClient(rows[0]), appointments: ap.map(repo.mapAppt), espera: esp.map(repo.mapEspera) });
}));

// Sininho: avisos da barbearia. Sem login, só os avisos para todos.
r.get('/avisos', ah(async (req, res) => {
  res.json(await avisos.lista(readClient(req)));
}));
r.post('/avisos/lidos', requireClient, ah(async (req, res) => {
  await avisos.lidos(req.clientId, req.body.ids);
  res.json({ ok: true });
}));

r.put('/me', requireClient, ah(async (req, res) => {
  const name = cleanName(req.body.name);
  const phone = cleanPhone(req.body.phone);
  const dup = await db.query('SELECT id FROM clients WHERE phone = $1 AND id <> $2', [phone, req.clientId]);
  if (dup.rows[0]) fail(409, 'Esse WhatsApp já está em outro cadastro.');
  const { rows } = await db.query('UPDATE clients SET name = $1, phone = $2 WHERE id = $3 RETURNING *', [name, phone, req.clientId]);
  res.json({ client: repo.mapClient(rows[0]) });
}));

r.post('/me/agendamentos/:id/cancelar', requireClient, ah(async (req, res) => {
  const id = cleanId(req.params.id);
  const result = await db.tx(async (c) => {
    const { rows } = await c.query('SELECT a.*, c.name AS client_name FROM appointments a JOIN clients c ON c.id = a.client_id WHERE a.id = $1 AND a.client_id = $2 FOR UPDATE', [id, req.clientId]);
    const a = rows[0];
    if (!a) fail(404, 'Agendamento não encontrado.');
    if (a.status !== 'agendado') fail(400, 'Esse agendamento não pode mais ser cancelado.');
    if (a.date < today()) fail(400, 'Esse dia já passou.');
    const up = await c.query("UPDATE appointments SET status = 'cancelado', updated_at = now() WHERE id = $1 RETURNING *", [id]);
    const { rows: n } = await c.query("INSERT INTO notifications (type, appointment_id) VALUES ('cancelado', $1) RETURNING id, created_at", [id]);
    return { appt: repo.mapAppt(up.rows[0]), name: a.client_name, notif: n[0] };
  });
  notify.broadcast('agendamento', { id: result.notif.id, type: 'cancelado', at: result.notif.created_at, appointment: result.appt, clientName: result.name });
  res.json({ ok: true });
  espera.vagou(result.appt.date);
}));

const ddmm = (date) => { const [, m, d] = date.split('-'); return `${d}/${m}`; };

/** Mudar dia, horário ou serviços de um horário marcado (Meus horários > Mudar dia ou horário). */
r.post('/me/agendamentos/:id/remarcar', requireClient, ah(async (req, res) => {
  const id = cleanId(req.params.id);
  const { date, time, serviceIds } = req.body;
  if (!Agenda.isDate(date)) fail(400, 'Escolha um dia válido.');
  if (!Agenda.isTime(time)) fail(400, 'Escolha um horário válido.');
  const t = today();
  if (date < t || (date === t && Agenda.toMin(time) <= nowMin())) fail(400, 'Esse horário já passou. Escolha outro.');
  const result = await db.tx(async (c) => {
    const { rows } = await c.query('SELECT * FROM appointments WHERE id = $1 AND client_id = $2', [id, req.clientId]);
    const a = rows[0];
    if (!a) fail(404, 'Agendamento não encontrado.');
    const { rows: cl } = await c.query('SELECT * FROM clients WHERE id = $1', [req.clientId]);
    const client = repo.mapClient(cl[0]);
    if (client.blocked) fail(403, 'Não foi possível mudar pelo site. Fale direto com a barbearia.');
    const settings = await repo.getSettings(c);
    if (date < settings.bookFrom || date > settings.bookTo) fail(400, 'Essa data ainda não está aberta para agendamento.');
    const conta = await contaDe(c, serviceIds);
    // Trava os dois dias (sempre na mesma ordem) e a pessoa
    for (const d of [...new Set([a.date, date])].sort()) await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['agenda:' + d]);
    await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['cli:' + client.id]);
    const { rows: cur } = await c.query('SELECT * FROM appointments WHERE id = $1 FOR UPDATE', [id]);
    const old = cur[0];
    if (old.status !== 'agendado') fail(400, 'Esse horário não pode mais ser mudado.');
    if (old.date < t || (old.date === t && Agenda.toMin(old.time) <= nowMin())) fail(400, 'Esse horário já passou.');
    const mesmosSvcs = !old.items && conta.l.length === 1 && Number(old.service_id) === conta.l[0].id;
    if (old.date === date && old.time === time && mesmosSvcs) fail(400, 'Esse já é o seu horário. Escolha outro dia ou horário.');
    if (old.date !== date) {
      const lim = guard.limitsOf(settings, client).perDay;
      const { rows: n } = await c.query("SELECT count(*)::int AS n FROM appointments WHERE client_id = $1 AND date = $2 AND status = 'agendado' AND id <> $3", [client.id, date, id]);
      if (lim && n[0].n >= lim) fail(403, `Você já tem um horário marcado em ${ddmm(date)}. Veja em "Meus horários".`, 'limite_dia');
    }
    const blocked = await repo.getBlocked(c, date);
    if (!Agenda.startSlots(settings, blocked, date).includes(time)) fail(400, 'Esse horário não está na lista. Escolha outro.');
    const appts = await repo.getApptsOn(c, date);
    if (!Agenda.fits(settings, blocked, appts, date, time, conta.dur, id)) {
      fail(409, conta.l.length > 1 ? 'Esses serviços juntos não cabem nesse horário. Escolha outro horário ou menos serviços.' : 'Esse horário acabou de ser ocupado. Escolha outro.');
    }
    // O lembrete volta a valer para o horário novo
    const up = await c.query(
      `UPDATE appointments SET date = $2, time = $3, service_id = $4, service_name = $5, price = $6, duration = $7, items = $8, discount = 0,
              moved_from = $9, remind_status = NULL, remind_at = NULL, updated_at = now() WHERE id = $1 RETURNING *`,
      [id, date, time, conta.l[0].id, conta.name, conta.price, conta.dur, conta.items && JSON.stringify(conta.items), `${old.date} ${old.time}`]);
    await espera.saiSeLotou(c, settings, client, date);
    const from = { date: old.date, time: old.time };
    const { rows: n } = await c.query("INSERT INTO notifications (type, appointment_id, info) VALUES ('remarcado', $1, $2) RETURNING id, created_at", [id, JSON.stringify({ from })]);
    return { appt: repo.mapAppt(up.rows[0]), name: client.name, notif: n[0], from };
  });
  notify.broadcast('agendamento', { id: result.notif.id, type: 'remarcado', at: result.notif.created_at, appointment: result.appt, clientName: result.name, info: { from: result.from } });
  res.json({ appointment: result.appt });
  espera.vagou(result.from.date); // o horário antigo ficou livre
}));

// ----- Lista de espera -----
const MAX_FILAS = 3; // dias diferentes na fila ao mesmo tempo

r.post('/espera', ah(async (req, res) => {
  const { date, serviceIds } = req.body;
  const period = espera.PERIODOS.includes(req.body.period) ? req.body.period : 'qualquer';
  const settings = await repo.getSettings();
  if (!espera.ativa(settings)) fail(400, 'A lista de espera não está disponível agora. Escolha outro dia com vaga.');
  if (!Agenda.isDate(date) || date < today()) fail(400, 'Escolha um dia válido.');
  if (date < settings.bookFrom || date > settings.bookTo) fail(400, 'Essa data ainda não está aberta para agendamento.');
  const tokenClientId = readClient(req);
  const result = await db.tx(async (c) => {
    const conta = await contaDe(c, serviceIds);
    const blocked = await repo.getBlocked(c, date);
    const slots = Agenda.startSlots(settings, blocked, date);
    if (!slots.length) fail(400, 'A barbearia não atende nesse dia.');
    let client;
    if (tokenClientId) {
      const { rows } = await c.query('SELECT * FROM clients WHERE id = $1', [tokenClientId]);
      if (!rows[0]) fail(401, 'Seu cadastro não foi encontrado. Entre de novo com seu WhatsApp.');
      client = repo.mapClient(rows[0]);
    } else {
      client = await findOrCreateClient(c, cleanName(req.body.name), cleanPhone(req.body.phone));
    }
    if (client.blocked) fail(403, 'Não foi possível entrar na lista pelo site. Fale direto com a barbearia.');
    await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['cli:' + client.id]);
    const lim = guard.limitsOf(settings, client).perDay;
    const { rows: n } = await c.query("SELECT count(*)::int AS n FROM appointments WHERE client_id = $1 AND date = $2 AND status = 'agendado'", [client.id, date]);
    if (lim && n[0].n >= lim) fail(403, `Você já tem um horário marcado em ${ddmm(date)}. Veja em "Meus horários".`);
    // Ainda cabe no dia? Então é só marcar, não precisa de fila
    const appts = await repo.getApptsOn(c, date);
    const livre = slots.find((s) => !Agenda.isPast(date, s, today(), nowMin()) && espera.noPeriodo(s, period) && Agenda.fits(settings, blocked, appts, date, s, conta.dur));
    if (livre) fail(409, `Ainda tem horário livre nesse dia para isso (${livre}). Escolha o horário na agenda.`);
    // Trocando o dia do pedido: sai da fila antiga junto (não conta no limite de dias)
    if (req.body.trocaEspera) await c.query("UPDATE waitlist SET status = 'saiu' WHERE id = $1 AND client_id = $2 AND status = 'aguardando'", [cleanId(req.body.trocaEspera), client.id]);
    const { rows: outras } = await c.query(
      "SELECT count(DISTINCT date)::int AS n FROM waitlist WHERE client_id = $1 AND status = 'aguardando' AND date >= $2 AND date <> $3", [client.id, today(), date]);
    if (outras[0].n >= MAX_FILAS) fail(403, `Você já está na lista de espera de ${MAX_FILAS} dias. Saia de uma em "Meus horários" para entrar em outra.`);
    // Entrar de novo no mesmo dia troca o pedido antigo
    await c.query("UPDATE waitlist SET status = 'saiu' WHERE client_id = $1 AND date = $2 AND status = 'aguardando'", [client.id, date]);
    const items = conta.l.map((x) => ({ serviceId: String(x.id), name: x.name, price: Number(x.price), dur: x.duration }));
    const { rows: ins } = await c.query('INSERT INTO waitlist (client_id, date, period, items, duration) VALUES ($1, $2, $3, $4, $5) RETURNING id', [client.id, date, period, JSON.stringify(items), conta.dur]);
    const { rows: w } = await c.query(`SELECT w.*, ${espera.POS_SQL} FROM waitlist w WHERE w.id = $1`, [ins[0].id]);
    return { client, espera: repo.mapEspera(w[0]) };
  });
  res.status(201).json({ espera: result.espera, client: result.client, token: signClient(result.client.id) });
}));

/** Mudar o pedido (período e serviços) sem perder o lugar na fila: a data de entrada não muda. */
r.patch('/me/espera/:id', requireClient, ah(async (req, res) => {
  const id = cleanId(req.params.id);
  const period = espera.PERIODOS.includes(req.body.period) ? req.body.period : 'qualquer';
  const settings = await repo.getSettings();
  const result = await db.tx(async (c) => {
    await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['cli:' + req.clientId]);
    const { rows } = await c.query("SELECT * FROM waitlist WHERE id = $1 AND client_id = $2 AND status = 'aguardando' AND date >= $3 FOR UPDATE", [id, req.clientId, today()]);
    const w = rows[0];
    if (!w) fail(404, 'Esse pedido não está mais na lista de espera. Veja em "Meus horários".');
    const conta = await contaDe(c, req.body.serviceIds);
    // Já tem vaga no período escolhido? Então é só marcar, não precisa esperar
    const blocked = await repo.getBlocked(c, w.date);
    const slots = Agenda.startSlots(settings, blocked, w.date);
    const appts = await repo.getApptsOn(c, w.date);
    const livre = slots.find((s) => !Agenda.isPast(w.date, s, today(), nowMin()) && espera.noPeriodo(s, period) && Agenda.fits(settings, blocked, appts, w.date, s, conta.dur));
    if (livre) fail(409, `Ainda tem horário livre nesse período (${livre}). Marque direto pela agenda.`);
    const items = conta.l.map((x) => ({ serviceId: String(x.id), name: x.name, price: Number(x.price), dur: x.duration }));
    await c.query('UPDATE waitlist SET period = $1, items = $2, duration = $3 WHERE id = $4', [period, JSON.stringify(items), conta.dur, id]);
    const { rows: up } = await c.query(`SELECT w.*, ${espera.POS_SQL} FROM waitlist w WHERE w.id = $1`, [id]);
    return repo.mapEspera(up[0]);
  });
  res.json({ espera: result });
}));

r.delete('/me/espera/:id', requireClient, ah(async (req, res) => {
  await db.query("UPDATE waitlist SET status = 'saiu' WHERE id = $1 AND client_id = $2 AND status = 'aguardando'", [cleanId(req.params.id), req.clientId]);
  res.json({ ok: true });
}));

module.exports = r;
