// Rotas do painel do barbeiro. Todas (menos o login) exigem estar logado.
const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const repo = require('../repo');
const marca = require('../marca');
const notify = require('../notify');
const wa = require('../whatsapp');
const lembretes = require('../lembretes');
const espera = require('../espera');
const { setAdminCookie, clearAdminCookie, requireAdmin } = require('../auth');
const { createAppointment, findOrCreateClient } = require('../booking');
const { Agenda, ah, fail, today, nowMin, cleanName, cleanPhone, cleanId } = require('../util');

const r = express.Router();

// ----- Login -----
const tries = new Map(); // freio simples contra quem tenta adivinhar a senha
r.post('/login', ah(async (req, res) => {
  const key = req.ip;
  const t = tries.get(key) || { n: 0, until: 0 };
  if (t.until > Date.now()) fail(429, 'Muitas tentativas. Espere um minuto e tente de novo.');
  const user = String(req.body.user || '').trim().toLowerCase();
  const pass = String(req.body.pass || '');
  const { rows } = await db.query('SELECT * FROM barbers WHERE lower(username) = $1', [user]);
  const ok = rows[0] && (await bcrypt.compare(pass, rows[0].password_hash));
  if (!ok) {
    t.n += 1;
    if (t.n >= 5) { t.n = 0; t.until = Date.now() + 60_000; }
    tries.set(key, t);
    fail(401, 'Usuário ou senha incorretos.');
  }
  tries.delete(key);
  setAdminCookie(res, rows[0].id);
  res.json({ ok: true });
}));

r.post('/logout', (req, res) => { clearAdminCookie(res); res.json({ ok: true }); });

r.use(requireAdmin);

// ----- Tudo que o painel precisa, numa chamada só -----
r.get('/dados', ah(async (req, res) => {
  const [settings, services, blocked, clients, appts, expenses, barber, notifs, fila] = await Promise.all([
    repo.getSettings(),
    repo.getServices(),
    repo.getBlocked(),
    db.query('SELECT * FROM clients ORDER BY name'),
    db.query("SELECT * FROM appointments WHERE status <> 'cancelado' OR date >= CURRENT_DATE - 1 ORDER BY date, time"),
    db.query('SELECT * FROM expenses ORDER BY date DESC, id DESC'),
    db.query('SELECT id, name, email, username FROM barbers WHERE id = $1', [req.barberId]),
    notificationsList(),
    db.query("SELECT * FROM waitlist WHERE status = 'aguardando' AND date >= $1 ORDER BY date, created_at, id", [today()]),
  ]);
  if (!barber.rows[0]) { clearAdminCookie(res); fail(401, 'Faça login de novo.'); }
  const b = barber.rows[0];
  res.json({
    settings, services, blocked,
    clients: clients.rows.map(repo.mapClient),
    appts: appts.rows.map(repo.mapAppt),
    expenses: expenses.rows.map(repo.mapExpense),
    barber: { name: b.name, email: b.email, user: b.username },
    notifications: notifs,
    espera: fila.rows.map(repo.mapEspera),
    whats: wa.info(),
    today: today(), nowMin: nowMin(),
  });
}));

// ----- Avisos (sino) -----
async function notificationsList() {
  const { rows } = await db.query(`
    SELECT n.id, n.type, n.read, n.created_at, n.info, a.id AS appointment_id, a.date, a.time, a.service_name, c.name AS client_name
      FROM notifications n
      JOIN appointments a ON a.id = n.appointment_id
      JOIN clients c ON c.id = a.client_id
     ORDER BY n.created_at DESC LIMIT 30`);
  return rows.map((x) => ({
    id: String(x.id), type: x.type, read: x.read, at: x.created_at,
    appointmentId: String(x.appointment_id), date: x.date, time: x.time, service: x.service_name, clientName: x.client_name,
    ...(x.info ? { info: x.info } : {}),
  }));
}
r.get('/avisos/stream', (req, res) => notify.subscribe(req, res));
r.post('/avisos/lidos', ah(async (req, res) => {
  await db.query('UPDATE notifications SET read = true WHERE NOT read');
  res.json({ ok: true });
}));
// Lixeira do sino: apaga um aviso ou todos. Só some o aviso; o agendamento continua.
r.delete('/avisos', ah(async (req, res) => {
  await db.query('DELETE FROM notifications');
  res.json({ ok: true });
}));
r.delete('/avisos/:id', ah(async (req, res) => {
  await db.query('DELETE FROM notifications WHERE id = $1', [cleanId(req.params.id)]);
  res.json({ ok: true });
}));

// ----- Agendamentos -----
/** Confere a lista de serviços e o desconto enviados ao fechar um atendimento. */
function cleanConta(items, discount) {
  if (!Array.isArray(items) || !items.length || items.length > 20) fail(400, 'Coloque pelo menos um serviço no atendimento.');
  const lista = items.map((it) => {
    const name = String((it && it.name) || '').trim();
    if (!name || name.length > 60) fail(400, 'Cada item precisa de um nome com até 60 letras.');
    const price = Math.round(Number(it.price) * 100) / 100;
    if (!(price >= 0) || price > 100000) fail(400, `Valor inválido em "${name}".`);
    const sid = it.serviceId == null || it.serviceId === '' ? null : cleanId(it.serviceId);
    return { serviceId: sid == null ? null : String(sid), name, price };
  });
  const sub = Math.round(lista.reduce((s, x) => s + x.price, 0) * 100) / 100;
  const disc = Math.round((Number(discount) || 0) * 100) / 100;
  if (disc < 0 || disc > sub) fail(400, 'O desconto não pode ser maior que o valor dos serviços.');
  return { items: lista, discount: disc, total: Math.round((sub - disc) * 100) / 100 };
}

r.patch('/agendamentos/:id', ah(async (req, res) => {
  const id = cleanId(req.params.id);
  const status = req.body.status;
  if (!['agendado', 'realizado', 'faltou', 'cancelado'].includes(status)) fail(400, 'Situação inválida.');
  const appt = await db.tx(async (c) => {
    const { rows } = await c.query('SELECT * FROM appointments WHERE id = $1 FOR UPDATE', [id]);
    const a = rows[0];
    if (!a) fail(404, 'Agendamento não encontrado.');
    if (a.status === 'cancelado' && status !== 'cancelado') {
      // Reativar: só se o horário ainda estiver livre
      await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['agenda:' + a.date]);
      const settings = await repo.getSettings(c);
      const blocked = await repo.getBlocked(c, a.date);
      const appts = await repo.getApptsOn(c, a.date);
      if (!Agenda.fits(settings, blocked, appts, a.date, a.time, a.duration, a.id)) fail(409, 'Esse horário já foi ocupado por outro cliente.');
    }
    let up;
    if (req.body.items !== undefined) {
      // Fechar atendimento: o que foi feito de verdade, com desconto. O financeiro usa o total.
      const conta = cleanConta(req.body.items, req.body.discount);
      const unico = conta.items.length === 1 && !conta.discount;
      up = await c.query(
        `UPDATE appointments SET status = $1, items = $2, discount = $3, price = $4, service_name = $5,
           service_id = COALESCE($6, service_id), updated_at = now() WHERE id = $7 RETURNING *`,
        [status, unico ? null : JSON.stringify(conta.items), conta.discount, conta.total, conta.items.map((x) => x.name).join(' + ').slice(0, 200), unico ? conta.items[0].serviceId : null, id]);
    } else up = await c.query('UPDATE appointments SET status = $1, updated_at = now() WHERE id = $2 RETURNING *', [status, id]);
    // Bloqueio automático: o cliente faltou X vezes e não pode mais marcar pelo site
    let blockedClient = null;
    if (status === 'faltou' && a.status !== 'faltou') {
      const settings = await repo.getSettings(c);
      if (settings.autoBlock > 0) {
        const { rows: f } = await c.query("SELECT count(*)::int AS n FROM appointments WHERE client_id = $1 AND status = 'faltou'", [a.client_id]);
        if (f[0].n >= settings.autoBlock) {
          const { rows: cl } = await c.query(
            'UPDATE clients SET blocked = true, blocked_reason = $2 WHERE id = $1 AND NOT blocked RETURNING *',
            [a.client_id, `Faltou ${f[0].n} vezes sem avisar`]);
          if (cl[0]) blockedClient = repo.mapClient(cl[0]);
        }
      }
    }
    return { appt: repo.mapAppt(up.rows[0]), blockedClient, antes: a.status };
  });
  res.json({ appointment: appt.appt, blockedClient: appt.blockedClient });
  // Cancelou um horário marcado: a vaga vai para o primeiro da lista de espera
  if (status === 'cancelado' && appt.antes === 'agendado') espera.vagou(appt.appt.date);
}));

r.post('/agendamentos', ah(async (req, res) => {
  const { clientId, name, phone, date, time, serviceId } = req.body;
  const appt = await db.tx(async (c) => {
    let cid;
    if (clientId) {
      cid = cleanId(clientId);
      const { rows } = await c.query('SELECT id FROM clients WHERE id = $1', [cid]);
      if (!rows[0]) fail(400, 'Cliente não encontrado.');
    } else {
      cid = Number((await findOrCreateClient(c, cleanName(name), cleanPhone(phone))).id);
    }
    // O barbeiro pode encaixar fora do período aberto aos clientes
    return createAppointment(c, { clientId: cid, date, time, serviceId, origin: 'painel', enforceWindow: false });
  });
  res.status(201).json({ appointment: appt });
}));

// ----- Lista de espera -----
r.delete('/espera/:id', ah(async (req, res) => {
  await db.query("UPDATE waitlist SET status = 'saiu' WHERE id = $1 AND status = 'aguardando'", [cleanId(req.params.id)]);
  res.json({ ok: true });
}));

// ----- Despesas -----
const EXP_CATS = ['Produtos', 'Contas', 'Aluguel', 'Manutenção', 'Outros'];
r.post('/despesas', ah(async (req, res) => {
  const desc = String(req.body.desc || '').trim();
  const val = Number(req.body.val);
  const date = req.body.date;
  const cat = EXP_CATS.includes(req.body.cat) ? req.body.cat : 'Outros';
  if (!desc) fail(400, 'Escreva o que foi pago.');
  if (desc.length > 120) fail(400, 'A descrição está muito grande.');
  if (!(val > 0) || val > 1e7) fail(400, 'Digite um valor maior que zero.');
  if (!Agenda.isDate(date)) fail(400, 'Escolha a data.');
  const { rows } = await db.query('INSERT INTO expenses (description, amount, date, category) VALUES ($1, $2, $3, $4) RETURNING *', [desc, Math.round(val * 100) / 100, date, cat]);
  res.status(201).json({ expense: repo.mapExpense(rows[0]) });
}));
r.delete('/despesas/:id', ah(async (req, res) => {
  await db.query('DELETE FROM expenses WHERE id = $1', [cleanId(req.params.id)]);
  res.json({ ok: true });
}));

// ----- Clientes -----
r.put('/clientes/:id', ah(async (req, res) => {
  const id = cleanId(req.params.id);
  const name = cleanName(req.body.name);
  const phone = cleanPhone(req.body.phone);
  const dup = await db.query('SELECT id FROM clients WHERE phone = $1 AND id <> $2', [phone, id]);
  if (dup.rows[0]) fail(409, 'Esse WhatsApp já está em outro cadastro.');
  const { rows } = await db.query('UPDATE clients SET name = $1, phone = $2 WHERE id = $3 RETURNING *', [name, phone, id]);
  if (!rows[0]) fail(404, 'Cliente não encontrado.');
  res.json({ client: repo.mapClient(rows[0]) });
}));

// Agendar para a família: quantos horários no mesmo dia este cliente pode marcar pelo site (vazio = regra geral)
r.put('/clientes/:id/limite', ah(async (req, res) => {
  const id = cleanId(req.params.id);
  const v = req.body.perDay == null || req.body.perDay === '' ? null : Number(req.body.perDay);
  if (v !== null && v !== 0 && (!Number.isInteger(v) || v < 2 || v > 10)) fail(400, 'Escolha de 2 a 10 horários por dia.');
  const { rows } = await db.query('UPDATE clients SET per_day = $2 WHERE id = $1 RETURNING *', [id, v || null]);
  if (!rows[0]) fail(404, 'Cliente não encontrado.');
  res.json({ client: repo.mapClient(rows[0]) });
}));

// Bloquear: o cliente não consegue mais marcar pelo site, e os horários futuros dele são liberados.
r.post('/clientes/:id/bloquear', ah(async (req, res) => {
  const id = cleanId(req.params.id);
  const reason = String(req.body.reason || '').trim().slice(0, 120) || 'Bloqueado pelo barbeiro';
  const out = await db.tx(async (c) => {
    const { rows } = await c.query('UPDATE clients SET blocked = true, blocked_reason = $2 WHERE id = $1 RETURNING *', [id, reason]);
    if (!rows[0]) fail(404, 'Cliente não encontrado.');
    const { rows: cancel } = await c.query(
      "UPDATE appointments SET status = 'cancelado', updated_at = now() WHERE client_id = $1 AND status = 'agendado' AND date >= $2 RETURNING *",
      [id, today()]);
    await c.query("UPDATE waitlist SET status = 'saiu' WHERE client_id = $1 AND status = 'aguardando'", [id]);
    return { client: repo.mapClient(rows[0]), cancelled: cancel.map(repo.mapAppt) };
  });
  res.json(out);
  espera.vagou(...out.cancelled.map((x) => x.date));
}));
r.post('/clientes/:id/desbloquear', ah(async (req, res) => {
  const { rows } = await db.query("UPDATE clients SET blocked = false, blocked_reason = '' WHERE id = $1 RETURNING *", [cleanId(req.params.id)]);
  if (!rows[0]) fail(404, 'Cliente não encontrado.');
  res.json({ client: repo.mapClient(rows[0]) });
}));

// ----- Configurações -----
const COLORS = ['latao', 'verde', 'bordo', 'petroleo', 'cobre', 'branco', 'preto', 'azul', 'roxo', 'vermelho', 'laranja', 'rosa', 'ciano', 'prata', 'custom'];
const FIELDS = {
  shopName: ['shop_name', (v) => { const s = String(v || '').trim(); if (!s || s.length > 60) fail(400, 'O nome da barbearia precisa ter entre 1 e 60 letras.'); return s; }],
  tagline: ['tagline', (v) => { const s = String(v || '').trim(); if (!s || s.length > 140) fail(400, 'A frase precisa ter entre 1 e 140 letras.'); return s; }],
  address: ['address', (v) => { const s = String(v || '').trim(); if (s.length > 140) fail(400, 'O endereço está muito grande.'); return s; }],
  logo: ['logo', (v) => {
    if (v == null || v === '') return null;
    if (typeof v !== 'string' || !/^data:image\/(png|jpe?g|webp|gif|svg\+xml);base64,/.test(v)) fail(400, 'Envie a logo em PNG, JPG, WEBP ou SVG.');
    if (v.length > 2_000_000) fail(400, 'Imagem muito grande. Use uma de até 1,5 MB.');
    return v;
  }],
  color: ['color', (v) => { if (!COLORS.includes(v)) fail(400, 'Cor inválida.'); return v; }],
  font: ['font', (v) => { if (!Object.prototype.hasOwnProperty.call(Agenda.FONTES, v)) fail(400, 'Letra inválida.'); return v; }],
  custom: ['custom_color', (v) => { if (!/^#[0-9a-fA-F]{6}$/.test(v)) fail(400, 'Cor inválida.'); return v; }],
  open: ['open_time', (v) => { if (!Agenda.isTime(v)) fail(400, 'Horário inválido.'); return v; }],
  close: ['close_time', (v) => { if (!Agenda.isTime(v)) fail(400, 'Horário inválido.'); return v; }],
  lunchStart: ['lunch_start', (v) => { if (!Agenda.isTime(v)) fail(400, 'Horário inválido.'); return v; }],
  lunchEnd: ['lunch_end', (v) => { if (!Agenda.isTime(v)) fail(400, 'Horário inválido.'); return v; }],
  closed: ['closed_days', (v) => { if (!Array.isArray(v) || v.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) fail(400, 'Dias inválidos.'); if (v.length >= 7) fail(400, 'A barbearia precisa abrir pelo menos um dia na semana.'); return [...new Set(v)]; }],
  phone: ['phone', (v) => { const d = Agenda.phoneDigits(v); if (!d) return ''; if (d.length < 10 || d.length > 11) fail(400, 'Digite o WhatsApp da barbearia com DDD.'); return d; }],
  step: ['slot_step', (v) => { const n = Number(v); if (![30, 60].includes(n)) fail(400, 'Escolha de 30 em 30 minutos ou de 1 em 1 hora.'); return n; }],
  remindOn: ['remind_on', (v) => !!v],
  remindMin: ['remind_min', (v) => { const n = Number(v); if (![30, 60, 90, 120, 180].includes(n)) fail(400, 'Escolha quanto tempo antes manda o lembrete.'); return n; }],
  waitOn: ['wait_on', (v) => !!v],
  waitMin: ['wait_min', (v) => { const n = Number(v); if (![30, 60, 120, 180].includes(n)) fail(400, 'Escolha com quanto tempo antes a vaga passa para a lista de espera.'); return n; }],
  remindMsg: ['remind_msg', (v) => {
    const s = String(v || '').trim();
    if (s.length > 500) fail(400, 'A mensagem do lembrete pode ter até 500 letras.');
    if (s && !/\{hora\}/i.test(s)) fail(400, 'Deixe o {hora} na mensagem para o cliente saber o horário.');
    return s;
  }],
  hours: ['day_hours', (v) => {
    if (!v || typeof v !== 'object' || Array.isArray(v)) fail(400, 'Horários inválidos.');
    const out = {};
    for (const [k, h] of Object.entries(v)) {
      const d = Number(k);
      if (!Number.isInteger(d) || d < 0 || d > 6 || !h || !Agenda.isTime(h.open) || !Agenda.isTime(h.close)) fail(400, 'Horário inválido.');
      if (Agenda.toMin(h.open) >= Agenda.toMin(h.close)) fail(400, 'O horário de abrir precisa ser antes do de fechar.');
      out[d] = { open: h.open, close: h.close };
    }
    return JSON.stringify(out);
  }],
  bookFrom: ['book_from', (v) => { if (!Agenda.isDate(v)) fail(400, 'Data inválida.'); return v; }],
  bookTo: ['book_to', (v) => { if (!Agenda.isDate(v)) fail(400, 'Data inválida.'); return v; }],
  // Proteção contra trote (0 = sem limite)
  maxActive: ['max_active', limit(0, 20, 'Horários marcados por cliente')],
  maxPerDay: ['max_per_day', limit(0, 10, 'Horários por dia')],
  maxDevice: ['max_device', limit(0, 50, 'Agendamentos por aparelho')],
  autoBlock: ['auto_block', limit(0, 20, 'Faltas para bloquear')],
};
function limit(min, max, label) {
  return (v) => {
    const n = Number(v);
    if (!Number.isInteger(n) || n < min || n > max) fail(400, `${label}: use um número de ${min} a ${max}.`);
    return n;
  };
}
r.put('/configuracoes', ah(async (req, res) => {
  const cur = await repo.getSettings();
  const next = { ...cur };
  const sets = [], vals = [];
  for (const [key, [col, check]] of Object.entries(FIELDS)) {
    if (!(key in req.body)) continue;
    next[key] = check(req.body[key]);
    vals.push(next[key]);
    sets.push(`${col} = $${vals.length}`);
  }
  if (!sets.length) return res.json({ settings: cur });
  if (Agenda.toMin(next.open) >= Agenda.toMin(next.close)) fail(400, 'O horário de abrir precisa ser antes do de fechar.');
  if (Agenda.toMin(next.lunchStart) > Agenda.toMin(next.lunchEnd)) fail(400, 'O fim do almoço precisa ser depois do começo.');
  if (next.bookFrom > next.bookTo) fail(400, 'A data final precisa ser depois da inicial.');
  await db.query(`UPDATE settings SET ${sets.join(', ')} WHERE id = 1`, vals);
  const settings = await repo.getSettings();
  marca.guardar(settings); // tela de carregamento e ícone da aba já saem com a logo, o nome e a cor novos
  res.json({ settings });
}));

// ----- WhatsApp dos lembretes -----
r.get('/whatsapp', (req, res) => res.json(wa.info()));
r.post('/whatsapp/conectar', ah(async (req, res) => res.json(await wa.connect())));
r.post('/whatsapp/desconectar', ah(async (req, res) => res.json(await wa.disconnect())));
r.post('/whatsapp/teste', ah(async (req, res) => {
  const phone = cleanPhone(req.body.phone);
  try { await lembretes.sendTest(phone); } catch (err) { fail(400, err.message); }
  res.json({ ok: true });
}));
r.post('/agendamentos/:id/lembrete', ah(async (req, res) => {
  try { await lembretes.sendNow(cleanId(req.params.id)); } catch (err) { fail(err.status || 400, err.message); }
  res.json({ ok: true });
}));

// ----- Serviços -----
function cleanService(b) {
  const name = String(b.name || '').trim();
  if (!name || name.length > 60) fail(400, 'O nome do serviço precisa ter entre 1 e 60 letras.');
  const price = Number(b.price);
  if (!(price >= 0) || price > 100000) fail(400, 'Preço inválido.');
  const dur = Number(b.dur);
  if (![30, 60, 90, 120].includes(dur)) fail(400, 'Duração inválida.');
  return { name, price: Math.round(price * 100) / 100, dur };
}
r.post('/servicos', ah(async (req, res) => {
  const s = cleanService(req.body);
  const { rows } = await db.query('INSERT INTO services (name, price, duration, position) VALUES ($1, $2, $3, (SELECT coalesce(max(position), 0) + 1 FROM services)) RETURNING *', [s.name, s.price, s.dur]);
  res.status(201).json({ service: repo.mapService(rows[0]) });
}));
r.put('/servicos/:id', ah(async (req, res) => {
  const s = cleanService(req.body);
  const { rows } = await db.query('UPDATE services SET name = $1, price = $2, duration = $3 WHERE id = $4 AND active RETURNING *', [s.name, s.price, s.dur, cleanId(req.params.id)]);
  if (!rows[0]) fail(404, 'Serviço não encontrado.');
  res.json({ service: repo.mapService(rows[0]) });
}));
r.delete('/servicos/:id', ah(async (req, res) => {
  const { rows } = await db.query('SELECT count(*)::int AS n FROM services WHERE active');
  if (rows[0].n <= 1) fail(400, 'Mantenha pelo menos um serviço.');
  // Não apaga de verdade: o histórico de atendimentos continua apontando para ele
  await db.query('UPDATE services SET active = false WHERE id = $1', [cleanId(req.params.id)]);
  res.json({ ok: true });
}));

// ----- Dias bloqueados -----
r.post('/bloqueios', ah(async (req, res) => {
  const date = req.body.date;
  const why = String(req.body.why || '').trim().slice(0, 80);
  if (!Agenda.isDate(date)) fail(400, 'Escolha o dia que quer bloquear.');
  if (date < today()) fail(400, 'Esse dia já passou.');
  const { rowCount } = await db.query('INSERT INTO blocked_days (date, reason) VALUES ($1, $2) ON CONFLICT DO NOTHING', [date, why]);
  if (!rowCount) fail(409, 'Esse dia já está bloqueado.');
  const { rows } = await db.query("SELECT count(*)::int AS n FROM appointments WHERE date = $1 AND status = 'agendado'", [date]);
  res.status(201).json({ ok: true, existing: rows[0].n });
}));
r.delete('/bloqueios/:date', ah(async (req, res) => {
  if (!Agenda.isDate(req.params.date)) fail(400, 'Data inválida.');
  await db.query('DELETE FROM blocked_days WHERE date = $1', [req.params.date]);
  res.json({ ok: true });
}));

// ----- Perfil do barbeiro -----
r.put('/perfil', ah(async (req, res) => {
  const name = String(req.body.name || '').trim();
  const email = String(req.body.email || '').trim();
  const user = String(req.body.user || '').trim().toLowerCase();
  if (!name) fail(400, 'Digite seu nome.');
  if (!/^[a-z0-9._-]{3,30}$/.test(user)) fail(400, 'O usuário precisa ter de 3 a 30 letras ou números, sem espaço.');
  if (email && !/^\S+@\S+\.\S+$/.test(email)) fail(400, 'E-mail inválido.');
  const dup = await db.query('SELECT id FROM barbers WHERE lower(username) = $1 AND id <> $2', [user, req.barberId]);
  if (dup.rows[0]) fail(409, 'Esse usuário já existe.');
  await db.query('UPDATE barbers SET name = $1, email = $2, username = $3 WHERE id = $4', [name, email, user, req.barberId]);
  res.json({ ok: true });
}));
r.put('/senha', ah(async (req, res) => {
  const { cur, next } = req.body;
  const { rows } = await db.query('SELECT password_hash FROM barbers WHERE id = $1', [req.barberId]);
  if (!rows[0] || !(await bcrypt.compare(String(cur || ''), rows[0].password_hash))) fail(400, 'A senha atual está errada.');
  if (String(next || '').length < 6) fail(400, 'A nova senha precisa ter pelo menos 6 caracteres.');
  await db.query('UPDATE barbers SET password_hash = $1 WHERE id = $2', [await bcrypt.hash(String(next), 10), req.barberId]);
  res.json({ ok: true });
}));

module.exports = r;
