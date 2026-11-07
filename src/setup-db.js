// Prepara o banco: cria as tabelas, as configurações iniciais, o login do barbeiro e os serviços.
// Uso: npm run db:setup        (pode rodar de novo sem perder nada)
//      npm run db:demo         (igual, e ainda coloca clientes e agendamentos de exemplo)
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const { pool } = require('./db');
const { Agenda, today } = require('./util');

const DEMO = process.argv.includes('--demo');

async function main() {
  console.log('Conectando no banco...');
  await pool.query(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
  console.log('✓ Tabelas prontas');

  await pool.query('INSERT INTO settings (id) VALUES (1) ON CONFLICT DO NOTHING');
  console.log('✓ Configurações');

  const { rows: b } = await pool.query('SELECT count(*)::int AS n FROM barbers');
  if (!b[0].n) {
    const user = (process.env.ADMIN_USER || 'barbeiro').toLowerCase();
    if (!/^[a-z0-9._-]{3,30}$/.test(user)) throw new Error('ADMIN_USER precisa ser um login curto, sem espaços nem acentos (ex.: luan). O nome completo vai em ADMIN_NAME.');
    const pass = process.env.ADMIN_PASSWORD;
    if (!pass || pass.length < 6) throw new Error('Defina ADMIN_PASSWORD no .env com pelo menos 6 caracteres antes de rodar o setup.');
    await pool.query('INSERT INTO barbers (name, username, password_hash) VALUES ($1, $2, $3)',
      [process.env.ADMIN_NAME || 'Barbeiro', user, await bcrypt.hash(pass, 10)]);
    console.log(`✓ Login do barbeiro criado (usuário: ${user})`);
  } else console.log('✓ Login do barbeiro já existia (não mexi)');

  const { rows: s } = await pool.query('SELECT count(*)::int AS n FROM services');
  if (!s[0].n) {
    const list = [['Corte masculino', 40, 30], ['Barba completa', 30, 30], ['Corte + barba', 65, 60], ['Pezinho e acabamento', 15, 30], ['Sobrancelha', 15, 30], ['Platinado', 120, 90]];
    for (const [i, [name, price, dur]] of list.entries()) {
      await pool.query('INSERT INTO services (name, price, duration, position) VALUES ($1, $2, $3, $4)', [name, price, dur, i]);
    }
    console.log('✓ Serviços de exemplo criados (o barbeiro edita no painel)');
  }

  if (DEMO) await demo();
  console.log('\nPronto! Agora rode: npm run dev\n');
}

// Clientes e agendamentos fictícios para testar o painel
async function demo() {
  const { rows: c } = await pool.query('SELECT count(*)::int AS n FROM clients');
  if (c[0].n) { console.log('• Já existem clientes no banco, então não coloquei dados de exemplo.'); return; }
  let seed = 42;
  const r = () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const names = ['Lucas Almeida', 'Pedro Henrique', 'João Victor', 'Matheus Souza', 'Gabriel Lima', 'Rafael Costa', 'Thiago Ferreira', 'Bruno Oliveira', 'Felipe Rocha', 'Gustavo Martins', 'Diego Barbosa', 'André Ribeiro', 'Vinícius Carvalho', 'Caio Mendes', 'Leonardo Dias', 'Eduardo Pires'];
  const t0 = Agenda.parse(today());
  const clients = [];
  for (const [i, n] of names.entries()) {
    const phone = i === 0 ? '11987654321' : '119' + String(80000000 + Math.floor(r() * 19999999)).slice(0, 8);
    const { rows } = await pool.query('INSERT INTO clients (name, phone, created_at) VALUES ($1, $2, $3) ON CONFLICT (phone) DO NOTHING RETURNING id', [n, phone, Agenda.iso(Agenda.addDays(t0, -200 + i * 8))]);
    if (rows[0]) clients.push({ id: rows[0].id, w: i < 5 ? 6 : i < 11 ? 3 : 1 });
  }
  const wsum = clients.reduce((a, x) => a + x.w, 0);
  const pick = () => { let x = r() * wsum; for (const cl of clients) { x -= cl.w; if (x <= 0) return cl; } return clients[0]; };
  const { rows: services } = await pool.query('SELECT * FROM services WHERE active ORDER BY position');
  const settingsRow = (await pool.query('SELECT * FROM settings WHERE id = 1')).rows[0];
  const settings = { open: settingsRow.open_time, close: settingsRow.close_time, lunchStart: settingsRow.lunch_start, lunchEnd: settingsRow.lunch_end, closed: settingsRow.closed_days.map(Number) };
  const nowM = Agenda.nowMinIn();
  let total = 0;
  for (let off = -60; off <= 10; off++) {
    const ds = Agenda.iso(Agenda.addDays(t0, off));
    const slots = Agenda.daySlots(settings, [], ds);
    if (!slots.length) continue;
    const appts = [];
    const target = off < 0 ? 4 + Math.floor(r() * 6) : Math.max(1, Math.floor((7 - off * 0.6) * r()) + 1);
    for (let k = 0; k < target * 4 && appts.length < target; k++) {
      const svc = services[Math.floor(r() * Math.min(services.length, 4))];
      const time = slots[Math.floor(r() * slots.length)];
      if (!Agenda.fits(settings, [], appts, ds, time, svc.duration)) continue;
      let status = 'agendado';
      if (off < 0 || (off === 0 && Agenda.toMin(time) + svc.duration <= nowM)) status = r() < 0.08 ? 'faltou' : 'realizado';
      appts.push({ date: ds, time, dur: svc.duration, status });
      await pool.query('INSERT INTO appointments (client_id, service_id, service_name, price, duration, date, time, status, origin) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
        [pick().id, svc.id, svc.name, svc.price, svc.duration, ds, time, status, r() < 0.7 ? 'site' : 'painel']);
      total++;
    }
  }
  const monthStart = new Date(t0.getFullYear(), t0.getMonth(), 1);
  for (const [desc, val, day] of [['Aluguel do salão', 900, 5], ['Conta de energia', 186.4, 10], ['Produtos (pomadas, lâminas)', 248, 12]]) {
    for (let m = -1; m <= 0; m++) {
      const d = new Date(monthStart); d.setMonth(d.getMonth() + m); d.setDate(day);
      if (Agenda.iso(d) <= today()) await pool.query('INSERT INTO expenses (description, amount, date) VALUES ($1, $2, $3)', [desc, val, Agenda.iso(d)]);
    }
  }
  console.log(`✓ Dados de exemplo: ${clients.length} clientes e ${total} agendamentos`);
}

main().catch((e) => { console.error('\nErro:', e.message, '\n'); process.exitCode = 1; }).finally(() => pool.end());
