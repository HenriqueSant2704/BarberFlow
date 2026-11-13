// Marca da barbearia (nome, logo e cor) guardada na memória do servidor.
// Assim a página já sai com a tela de carregamento e o ícone da aba prontos,
// sem esperar o banco de dados (o Neon gratuito dorme e demora para acordar).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const repo = require('./repo');
const { accent, fonte, fonteUrl, shopInitials } = require('../public/shared/agenda');

const PUBLIC = path.join(__dirname, '..', 'public');
const ler = (p) => fs.readFileSync(path.join(PUBLIC, p), 'utf8');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let atual = { shopName: 'Barbearia', logo: null, color: 'latao', custom: '#8c6a2b', font: 'classica' };
let icone = null; // { tipo, dados, versao }

function guardar(st) {
  atual = { shopName: st.shopName || 'Barbearia', logo: st.logo || null, color: st.color, custom: st.custom, font: st.font };
  icone = null;
}

/** Lê do banco (ao ligar e depois de salvar Configurações). Se o banco falhar, segue com o que já tem. */
async function carregar() {
  try { guardar(await repo.getSettings()); } catch (err) { console.error('Não consegui ler a marca da barbearia:', err.message); }
}

/** Ícone da aba: a logo enviada em Configurações ou, sem logo, as iniciais na cor da marca. */
function getIcone() {
  if (icone) return icone;
  const m = atual.logo && /^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i.exec(atual.logo);
  if (m) {
    icone = { tipo: m[1], dados: Buffer.from(m[2], 'base64') };
  } else {
    const c = accent(atual);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><circle cx="32" cy="32" r="32" fill="#141210"/><circle cx="32" cy="32" r="29.5" fill="none" stroke="${c.d}" stroke-width="2.5"/><text x="32" y="41.5" text-anchor="middle" font-family="Georgia,'Times New Roman',serif" font-weight="bold" font-size="25" fill="${c.d}">${esc(shopInitials(atual.shopName))}</text></svg>`;
    icone = { tipo: 'image/svg+xml', dados: Buffer.from(svg) };
  }
  icone.versao = crypto.createHash('sha1').update(icone.dados).digest('hex').slice(0, 10);
  return icone;
}

const FRASES = {
  site: ['Abrindo a agenda', 'Buscando os horários livres', 'Quase pronto'],
  painel: ['Abrindo seu painel', 'Carregando a agenda de hoje', 'Quase pronto'],
};

// Os arquivos são lidos uma vez só (no Render eles não mudam enquanto o servidor está ligado)
let modelos = null;
function getModelos() {
  if (!modelos || process.env.NODE_ENV !== 'production') {
    modelos = {
      site: ler('index.html'), painel: ler(path.join('painel', 'index.html')),
      css: ler(path.join('shared', 'carregando.css')), js: ler(path.join('shared', 'carregando.js')),
    };
  }
  return modelos;
}

/** Monta o HTML do site ('site') ou do painel ('painel') com a marca da barbearia. */
function pagina(qual) {
  const t = getModelos();
  const ic = getIcone();
  const c = accent(atual);
  const f = fonte(atual);
  const nome = esc(atual.shopName);
  const urlIcone = `/marca/icone?v=${ic.versao}`;
  const titulo = qual === 'painel' ? `Painel · ${nome}` : `${nome} · Agendar horário`;
  const disco = atual.logo ? `<img src="${urlIcone}" alt="">` : esc(shopInitials(atual.shopName));
  const tela = `<div class="carregando" id="carregando" role="status" aria-live="polite"><div class="cg-miolo">
<div class="cg-selo"><span class="cg-anel" aria-hidden="true"></span><div class="cg-disco">${disco}</div></div>
<div class="cg-nome">${nome}${qual === 'painel' ? '<small>Painel do barbeiro</small>' : ''}</div>
<div class="cg-msg"><b>Carregando<span class="cg-pt" aria-hidden="true"><i>.</i><i>.</i><i>.</i></span></b><span id="cg-sub" data-frases="${esc(JSON.stringify(FRASES[qual]))}">${FRASES[qual][0]}</span></div>
</div></div>
<script>${t.js}</script>`;
  const cabeca = `<link rel="icon" href="${urlIcone}" type="${ic.tipo}">`
    + (ic.tipo === 'image/svg+xml' ? '' : `\n<link rel="apple-touch-icon" href="${urlIcone}">`)
    + `\n<link rel="stylesheet" id="fonte-marca" data-k="${f.k}" href="${esc(fonteUrl([f.k]))}">`
    + `\n<style>:root{--acc-l:${c.l};--acc-d:${c.d};--on-acc-l:${c.onL};--on-acc-d:${c.onD};--f-display:${f.tit};--f-body:${f.txt}}\n${t.css}</style>`;
  return t[qual]
    .replace(/<title>[^<]*<\/title>/, () => `<title>${titulo}</title>`)
    .replace('<html lang="pt-BR">', () => `<html lang="pt-BR" data-fonte="${f.k}">`)
    .replace('<!--MARCA-CABECA-->', () => cabeca)
    .replace('<!--MARCA-CARREGANDO-->', () => tela);
}

module.exports = { carregar, guardar, getIcone, pagina };
