// Sininho do site do cliente: avisos só para um cliente (valor do atendimento mudou, bloqueio...)
// e avisos para todos (serviço novo, preço, nome da barbearia, horário...). O cliente marca como lido.
const db = require('./db');
const { Agenda } = require('./util');

const DIAS = 60;   // avisos para todos ficam no sininho por 60 dias
const MAX = 60;    // no máximo 60 avisos por vez

/** Cria um aviso. clientId vazio = para todos. c = conexão (pode ser a da transação). */
async function criar(c, { clientId = null, tipo, titulo, texto, apId = null, acao = null }) {
  await (c || db).query(
    'INSERT INTO client_notices (client_id, type, title, body, appointment_id, action) VALUES ($1, $2, $3, $4, $5, $6)',
    [clientId, tipo, String(titulo).slice(0, 140), String(texto).slice(0, 600), apId, acao]);
}
const geral = (c, n) => criar(c, { ...n, clientId: null });

const mapAviso = (r) => ({
  id: String(r.id), para: r.client_id ? 'voce' : 'todos', tipo: r.type, titulo: r.title, texto: r.body,
  at: r.created_at, apId: r.appointment_id ? String(r.appointment_id) : null, acao: r.action || null, lido: !!r.lido,
});
/** Avisos que o cliente vê (sem login, só os para todos). */
async function lista(clientId) {
  if (!clientId) {
    const { rows } = await db.query(
      `SELECT *, false AS lido FROM client_notices WHERE client_id IS NULL AND created_at > now() - interval '${DIAS} days' ORDER BY created_at DESC LIMIT ${MAX}`);
    return rows.map(mapAviso);
  }
  const { rows } = await db.query(
    `SELECT n.*, (r.notice_id IS NOT NULL) AS lido FROM client_notices n
       LEFT JOIN client_notice_reads r ON r.notice_id = n.id AND r.client_id = $1
      WHERE n.client_id = $1 OR (n.client_id IS NULL AND n.created_at > now() - interval '${DIAS} days')
      ORDER BY n.created_at DESC LIMIT ${MAX}`, [clientId]);
  return rows.map(mapAviso);
}
/** Marca como lidos. Se for o aviso de um valor editado, o painel passa a mostrar "Cliente viu". */
async function lidos(clientId, ids) {
  const l = (Array.isArray(ids) ? ids : []).map(Number).filter((n) => Number.isInteger(n) && n > 0).slice(0, 200);
  if (!l.length) return;
  const { rows } = await db.query(
    `INSERT INTO client_notice_reads (notice_id, client_id)
     SELECT id, $1 FROM client_notices WHERE id = ANY($2) AND (client_id IS NULL OR client_id = $1)
     ON CONFLICT DO NOTHING RETURNING notice_id`, [clientId, l]);
  if (!rows.length) return;
  await db.query(
    `UPDATE appointments a SET conta = jsonb_set(a.conta, ARRAY['edicoes', (jsonb_array_length(a.conta->'edicoes') - 1)::text, 'visto'], 'true')
       FROM client_notices n
      WHERE n.id = ANY($2) AND n.type = 'conta' AND n.client_id = $1 AND a.id = n.appointment_id AND a.client_id = $1
        AND jsonb_typeof(a.conta->'edicoes') = 'array' AND jsonb_array_length(a.conta->'edicoes') > 0`,
    [clientId, rows.map((x) => x.notice_id)]);
}

// ----- Textos -----
const ddmm = (ds) => `${ds.slice(8, 10)}/${ds.slice(5, 7)}`;
const tempo = (m) => (m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? m % 60 : ''}` : `${m} min`);
const NOMES_DIA = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
/** Configurações que todo cliente precisa saber: compara antes e depois e cria os avisos. Devolve o resumo para o painel. */
async function configMudou(antes, depois) {
  const av = [];
  const add = async (n, curto) => { await geral(null, n); av.push(curto); };
  if (antes.shopName !== depois.shopName) await add({ tipo: 'nome', titulo: `Agora somos ${depois.shopName}`, texto: `Antes: ${antes.shopName}. Mesmo lugar, mesmo atendimento.` }, 'nome da barbearia');
  if ((antes.address || '') !== (depois.address || '') && depois.address) await add({ tipo: 'endereco', titulo: 'Mudamos de endereço', texto: `Agora é em ${depois.address}.` }, 'endereço novo');
  if ((antes.phone || '') !== (depois.phone || '') && depois.phone) await add({ tipo: 'contato', titulo: 'WhatsApp da barbearia mudou', texto: 'Salve o número novo para falar com a gente. Ele está em Informações, no Início.', acao: 'falar' }, 'WhatsApp novo');
  const dia = (st, d) => (st.closed.includes(d) ? 'fechado' : `${Agenda.dayHours(st, d).open} às ${Agenda.dayHours(st, d).close}`);
  const mud = [1, 2, 3, 4, 5, 6, 0].filter((d) => dia(antes, d) !== dia(depois, d));
  if (mud.length) await add({ tipo: 'horario', titulo: 'Horário de funcionamento mudou', texto: `${mud.map((d) => `${NOMES_DIA[d]}: ${dia(depois, d)}`).join('; ')}.` }, 'horário de funcionamento');
  return av;
}
/** Serviço criado, mudado ou tirado. Devolve o resumo para o painel. */
async function servicoMudou(antes, depois) {
  const PROVISORIO = 'Novo serviço'; // o painel cria com esse nome e o barbeiro troca depois
  if (!depois) {
    if (!antes || antes.name === PROVISORIO) return [];
    await geral(null, { tipo: 'servico_saiu', titulo: `${antes.name} saiu da lista de serviços`, texto: 'Quem já tinha marcado continua com o horário.' });
    return [`${antes.name} saiu`];
  }
  if (depois.name === PROVISORIO) return [];
  if (!antes || antes.name === PROVISORIO) {
    // "Desfazer" logo depois de tirar o serviço: apaga o aviso de que ele saiu em vez de anunciar como novo
    if (!antes) {
      const { rowCount } = await db.query("DELETE FROM client_notices WHERE client_id IS NULL AND type = 'servico_saiu' AND title = $1 AND created_at > now() - interval '15 minutes'", [`${depois.name} saiu da lista de serviços`]);
      if (rowCount) return [];
    }
    await geral(null, { tipo: 'servico', titulo: `Serviço novo: ${depois.name}`, texto: `${Agenda.reais(depois.price)} · ${tempo(depois.dur)}. Já dá para agendar pelo site.`, acao: 'agendar' });
    return [`serviço novo (${depois.name})`];
  }
  const av = [];
  if (antes.name !== depois.name) { await geral(null, { tipo: 'servico', titulo: `${antes.name} agora se chama ${depois.name}`, texto: 'É o mesmo serviço, só mudou o nome.' }); av.push(`nome de ${antes.name}`); }
  if (Number(antes.price) !== Number(depois.price)) {
    await geral(null, { tipo: 'preco', titulo: `Preço novo: ${depois.name}`, texto: `De ${Agenda.reais(antes.price)} para ${Agenda.reais(depois.price)}. Quem já marcou paga o valor que marcou.`, acao: 'agendar' });
    av.push(`preço de ${depois.name}`);
  }
  return av;
}
const bloqueado = (c, clientId, motivo) => criar(c, { clientId, tipo: 'bloqueio', titulo: 'Seu agendamento pelo site foi bloqueado', texto: `Motivo: ${String(motivo || 'bloqueado pelo barbeiro').replace(/\.$/, '')}. Para marcar, fale com a barbearia pelo WhatsApp.`, acao: 'falar' });
const desbloqueado = (c, clientId) => criar(c, { clientId, tipo: 'desbloqueio', titulo: 'Você já pode agendar pelo site de novo', texto: 'A barbearia liberou seu acesso. É só escolher o dia e o horário.', acao: 'agendar' });

module.exports = { criar, geral, lista, lidos, configMudou, servicoMudou, bloqueado, desbloqueado, ddmm };
