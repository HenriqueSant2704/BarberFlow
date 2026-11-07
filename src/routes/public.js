// Rotas usadas pelo site do cliente (celular). Não exigem senha.
const express = require('express');
const db = require('../db');
const repo = require('../repo');
const { signClient, readClient, requireClient } = require('../auth');
const { createAppointment, findOrCreateClient } = require('../booking');
const notify = require('../notify');
const guard = require('../guard');
const { Agenda, ah, fail, today, nowMin, cleanName, cleanPhone, lookupPhone, cleanId } = require('../util');

const r = express.Router();

// Dados da barbearia: nome, cores, serviços, horários e dias bloqueados
r.get('/info', ah(async (req, res) => {
  const t = today();
  const [settings, services, blocked] = await Promise.all([repo.getSettings(), repo.getServices(), repo.getBlocked(db, t)]);
  res.json({ settings, services, blocked, today: t, nowMin: nowMin() });
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
  const { date, time, serviceId } = req.body;
  guard.honeypot(req);
  const tokenClientId = readClient(req);
  const device = guard.deviceOf(req);
  const ipHash = guard.ipHashOf(req);
  const result = await db.tx(async (c) => {
    const settings = await repo.getSettings(c);
    await guard.checkDevice(c, settings, device, ipHash);
    let client;
    if (tokenClientId) {
      const { rows } = await c.query('SELECT * FROM clients WHERE id = $1', [tokenClientId]);
      if (!rows[0]) fail(401, 'Seu cadastro não foi encontrado. Entre de novo com seu WhatsApp.');
      client = repo.mapClient(rows[0]);
    } else {
      client = await findOrCreateClient(c, cleanName(req.body.name), cleanPhone(req.body.phone));
    }
    if (Agenda.isDate(date)) await guard.checkClient(c, settings, client, date);
    const appt = await createAppointment(c, { clientId: Number(client.id), date, time, serviceId, origin: 'site', enforceWindow: true, device, ipHash });
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
    "SELECT * FROM appointments WHERE client_id = $1 AND status <> 'cancelado' ORDER BY date DESC, time DESC LIMIT 60", [req.clientId]);
  res.json({ client: repo.mapClient(rows[0]), appointments: ap.map(repo.mapAppt) });
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
}));

module.exports = r;
