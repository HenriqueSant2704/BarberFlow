// Leitura do banco e conversão para o formato usado pelas telas.
const db = require('./db');
const { REMIND_MSG } = require('../public/shared/agenda');

const mapSettings = (r) => ({
  shopName: r.shop_name, tagline: r.tagline, address: r.address, logo: r.logo,
  color: r.color, custom: r.custom_color,
  open: r.open_time, close: r.close_time, lunchStart: r.lunch_start, lunchEnd: r.lunch_end,
  closed: (r.closed_days || []).map(Number), bookFrom: r.book_from, bookTo: r.book_to,
  phone: r.phone || '', hours: r.day_hours || {},
  maxActive: r.max_active, maxPerDay: r.max_per_day, maxDevice: r.max_device, autoBlock: r.auto_block,
  remindOn: !!r.remind_on, remindMin: r.remind_min || 60, remindMsg: r.remind_msg || REMIND_MSG,
  step: Number(r.slot_step) === 60 ? 60 : 30,
  waitOn: r.wait_on !== false, waitMin: Number(r.wait_min) || 60,
});
const mapService = (r) => ({ id: String(r.id), name: r.name, price: r.price, dur: r.duration });
const mapClient = (r) => ({
  id: String(r.id), name: r.name, phone: r.phone, since: r.created_at,
  blocked: !!r.blocked, blockedReason: r.blocked_reason || '',
  perDay: r.per_day > 1 ? Number(r.per_day) : null,
});
const mapAppt = (r) => ({
  id: String(r.id), date: r.date, time: r.time, clientId: String(r.client_id),
  serviceId: r.service_id == null ? null : String(r.service_id), service: r.service_name,
  price: r.price, dur: r.duration, status: r.status, origin: r.origin,
  remind: r.remind_status ? { status: r.remind_status, at: r.remind_at } : null,
  items: Array.isArray(r.items) && r.items.length ? r.items : null, discount: Number(r.discount) || 0,
  forName: r.for_name || null, movedFrom: r.moved_from || null,
});
/** Pedido na lista de espera. */
const mapEspera = (r) => ({
  id: String(r.id), clientId: String(r.client_id), date: r.date, period: r.period,
  items: Array.isArray(r.items) ? r.items : [], dur: r.duration, at: r.created_at,
  ...(r.pos != null ? { pos: Number(r.pos) } : {}),
});
const mapExpense = (r) => ({ id: String(r.id), desc: r.description, val: r.amount, date: r.date, cat: r.category || 'Outros' });
const mapBlocked = (r) => ({ date: r.date, why: r.reason });

async function getSettings(c = db) {
  const { rows } = await c.query('SELECT * FROM settings WHERE id = 1');
  if (!rows[0]) throw new Error('Tabela de configurações vazia. Rode "npm run db:setup".');
  return mapSettings(rows[0]);
}
async function getServices(c = db) {
  const { rows } = await c.query('SELECT * FROM services WHERE active ORDER BY position, id');
  return rows.map(mapService);
}
async function getBlocked(c = db, fromDate) {
  const { rows } = fromDate
    ? await c.query('SELECT * FROM blocked_days WHERE date >= $1 ORDER BY date', [fromDate])
    : await c.query('SELECT * FROM blocked_days ORDER BY date');
  return rows.map(mapBlocked);
}
async function getApptsOn(c, date) {
  const { rows } = await c.query("SELECT * FROM appointments WHERE date = $1 AND status <> 'cancelado'", [date]);
  return rows.map(mapAppt);
}

module.exports = { mapSettings, mapService, mapClient, mapAppt, mapEspera, mapExpense, mapBlocked, getSettings, getServices, getBlocked, getApptsOn };
