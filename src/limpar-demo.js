// Apaga SÓ os dados de exemplo criados pelo "npm run db:demo":
// os 16 clientes de exemplo (com os agendamentos deles) e as despesas de exemplo.
// Clientes, agendamentos e despesas de verdade não são tocados.
// Uso: npm run db:limpar-demo
require('dotenv').config();
const { pool, tx } = require('./db');

// Mesma sequência do setup-db.js (semente 42), para achar exatamente os mesmos clientes.
function demoClients() {
  let seed = 42;
  const r = () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const names = ['Lucas Almeida', 'Pedro Henrique', 'João Victor', 'Matheus Souza', 'Gabriel Lima', 'Rafael Costa', 'Thiago Ferreira', 'Bruno Oliveira', 'Felipe Rocha', 'Gustavo Martins', 'Diego Barbosa', 'André Ribeiro', 'Vinícius Carvalho', 'Caio Mendes', 'Leonardo Dias', 'Eduardo Pires'];
  return names.map((name, i) => ({ name, phone: i === 0 ? '11987654321' : '119' + String(80000000 + Math.floor(r() * 19999999)).slice(0, 8) }));
}
const DEMO_EXPENSES = [['Aluguel do salão', 900, 5], ['Conta de energia', 186.4, 10], ['Produtos (pomadas, lâminas)', 248, 12]];

async function main() {
  const list = demoClients();
  const res = await tx(async (c) => {
    // nome E telefone precisam bater, para não apagar um cliente real por engano
    const { rows } = await c.query('SELECT id FROM clients WHERE (name, phone) IN (SELECT * FROM unnest($1::text[], $2::text[]))', [list.map((x) => x.name), list.map((x) => x.phone)]);
    const ids = rows.map((x) => x.id);
    const ap = ids.length ? await c.query('DELETE FROM appointments WHERE client_id = ANY($1::int[])', [ids]) : { rowCount: 0 };
    const cl = ids.length ? await c.query('DELETE FROM clients WHERE id = ANY($1::int[])', [ids]) : { rowCount: 0 };
    let ex = 0;
    for (const [desc, val, day] of DEMO_EXPENSES) {
      const r = await c.query('DELETE FROM expenses WHERE description = $1 AND amount = $2 AND extract(day FROM date) = $3', [desc, val, day]);
      ex += r.rowCount;
    }
    return { cl: cl.rowCount, ap: ap.rowCount, ex };
  });
  console.log(`✓ Dados de exemplo apagados: ${res.cl} clientes, ${res.ap} agendamentos e ${res.ex} despesas.`);
  console.log('  Seus clientes, agendamentos e despesas de verdade continuam lá.');
}

main().catch((e) => { console.error('\nErro:', e.message, '\n'); process.exitCode = 1; }).finally(() => pool.end());
