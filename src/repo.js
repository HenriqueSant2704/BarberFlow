// Leitura do banco e conversão para o formato usado pelas telas.
const db = require('./db');

const mapSettings = (r) => ({
  shopName: r.shop_name, tagline: r.tagline, address: r.address, logo: r.logo,
  color: r.color, custom: r.custom_color,
  open: r.open_time, close: r.close_time, lunchStart: r.lunch_start, lunchEnd: r.lunch_end,
  closed: (r.closed_days || []).map(Number), bookFrom: r.book_from, bookTo: r.book_to,
});
const mapService = (r) => ({ id: String(r.id), name: r.name, price: r.price, dur: r.duration });
const mapClient = (r) => ({ id: String(r.id), name: r.name, phone: r.phone, since: r.created_at });
const mapAppt = (r) => ({
  id: String(r.id), date: r.date, time: r.time, clientId: String(r.client_id),
  serviceId: r.service_id == null ? null : String(r.service_id), service: r.service_name,
  price: r.price, dur: r.duration, status: r.status, origin: r.origin,
});
const mapExpense = (r) => ({ id: String(r.id), desc: r.description, val: r.amount, date: r.date });
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

module.exports = { mapSettings, mapService, mapClient, mapAppt, mapExpense, mapBlocked, getSettings, getServices, getBlocked, getApptsOn };
