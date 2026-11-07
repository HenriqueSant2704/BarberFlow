// Redefine o login do barbeiro usando o que está no .env (ADMIN_USER, ADMIN_PASSWORD, ADMIN_NAME).
// Uso: npm run db:login   (serve para quando esquecer a senha ou mudar o usuário)
require('dotenv').config();
const bcrypt = require('bcryptjs');
const { pool } = require('./db');

async function main() {
  const user = String(process.env.ADMIN_USER || '').trim().toLowerCase();
  const pass = process.env.ADMIN_PASSWORD || '';
  const name = String(process.env.ADMIN_NAME || 'Barbeiro').trim();
  if (!/^[a-z0-9._-]{3,30}$/.test(user)) throw new Error('ADMIN_USER precisa ser um login curto, sem espaços nem acentos (ex.: luan). O nome completo vai em ADMIN_NAME.');
  if (pass.length < 6) throw new Error('ADMIN_PASSWORD precisa ter pelo menos 6 caracteres.');
  const hash = await bcrypt.hash(pass, 10);
  const { rows } = await pool.query('SELECT id FROM barbers ORDER BY id LIMIT 1');
  if (rows[0]) await pool.query('UPDATE barbers SET name = $1, username = $2, password_hash = $3 WHERE id = $4', [name, user, hash, rows[0].id]);
  else await pool.query('INSERT INTO barbers (name, username, password_hash) VALUES ($1, $2, $3)', [name, user, hash]);
  console.log(`✓ Login do barbeiro redefinido. Usuário: ${user}  |  Senha: a que está em ADMIN_PASSWORD`);
}

main().catch((e) => { console.error('\nErro:', e.message, '\n'); process.exitCode = 1; }).finally(() => pool.end());
