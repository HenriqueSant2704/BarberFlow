const Agenda = require('../public/shared/agenda');

function validTz(tz) {
  try { new Intl.DateTimeFormat('en', { timeZone: tz }); return true; } catch { return false; }
}
let TZ = (process.env.TZ_BARBEARIA || '').trim() || Agenda.TZ;
if (!validTz(TZ)) {
  console.warn(`\n  Aviso: o fuso "${TZ}" do TZ_BARBEARIA não existe. Usando ${Agenda.TZ}.`);
  console.warn('  Exemplos válidos: America/Sao_Paulo, America/Manaus, America/Recife.\n');
  TZ = Agenda.TZ;
}

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const fail = (status, message) => { throw new HttpError(status, message); };

/** Deixa usar async/await nas rotas do Express sem try/catch em todo lugar. */
const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const digits = (s) => String(s || '').replace(/\D/g, '');
const today = () => Agenda.todayIn(TZ);
const nowMin = () => Agenda.nowMinIn(TZ);

/** Nome e sobrenome de verdade (mesma regra do site, em public/shared/agenda.js). */
function cleanName(v) {
  const err = Agenda.nameError(v);
  if (err) fail(400, err);
  return Agenda.tidyName(v);
}
/** WhatsApp para cadastrar ou alterar: celular brasileiro válido. */
function cleanPhone(v) {
  const err = Agenda.phoneError(v);
  if (err) fail(400, err);
  return Agenda.phoneDigits(v);
}
/** WhatsApp só para procurar um cliente que já existe (aceita cadastros antigos). */
function lookupPhone(v) {
  const d = Agenda.phoneDigits(v);
  if (d.length < 10 || d.length > 11) fail(400, 'Digite seu WhatsApp com DDD.');
  return d;
}
function cleanId(v) {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) fail(400, 'Identificador inválido.');
  return n;
}

module.exports = { Agenda, TZ, HttpError, fail, ah, digits, today, nowMin, cleanName, cleanPhone, lookupPhone, cleanId };
