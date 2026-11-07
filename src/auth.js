const jwt = require('jsonwebtoken');
const { fail } = require('./util');

const SECRET = process.env.JWT_SECRET;
if (!SECRET || SECRET.length < 16) {
  console.error('\n  Defina JWT_SECRET no .env com pelo menos 16 caracteres (veja o README).\n');
  process.exit(1);
}
const ADMIN_COOKIE = 'painel_sessao';

// ----- Cliente: identificado pelo WhatsApp, recebe um "token" guardado no celular -----
const signClient = (clientId) => jwt.sign({ cid: Number(clientId), t: 'c' }, SECRET, { expiresIn: '365d' });

function readClient(req) {
  const h = req.get('authorization') || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) return null;
  try {
    const p = jwt.verify(token, SECRET);
    return p.t === 'c' ? p.cid : null;
  } catch { return null; }
}
function requireClient(req, res, next) {
  const cid = readClient(req);
  if (!cid) return next(Object.assign(new Error('Entre com seu WhatsApp para continuar.'), { status: 401 }));
  req.clientId = cid;
  next();
}

// ----- Barbeiro: login com usuário e senha, sessão num cookie protegido -----
function setAdminCookie(res, barberId) {
  const token = jwt.sign({ bid: barberId, t: 'a' }, SECRET, { expiresIn: '30d' });
  res.cookie(ADMIN_COOKIE, token, {
    httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production',
    maxAge: 30 * 24 * 3600 * 1000, path: '/',
  });
}
function clearAdminCookie(res) { res.clearCookie(ADMIN_COOKIE, { path: '/' }); }

function requireAdmin(req, res, next) {
  const token = req.cookies && req.cookies[ADMIN_COOKIE];
  try {
    const p = token && jwt.verify(token, SECRET);
    if (!p || p.t !== 'a') fail(401, 'Faça login para continuar.');
    req.barberId = p.bid;
    next();
  } catch (e) {
    next(Object.assign(new Error('Sua sessão expirou. Faça login de novo.'), { status: 401 }));
  }
}

module.exports = { signClient, readClient, requireClient, setAdminCookie, clearAdminCookie, requireAdmin };
