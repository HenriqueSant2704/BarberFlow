/*
 * Regras da agenda, usadas igualzinho no navegador e no servidor.
 * O servidor sempre confere de novo antes de gravar, então o navegador
 * só usa isto para mostrar os horários livres.
 *
 * settings: { open, close, lunchStart, lunchEnd, closed:[0..6], step: 30|60 }
 * blocked:  [{ date:'AAAA-MM-DD' }]
 * appts:    [{ id, date, time:'HH:MM', dur, status }]
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Agenda = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const STEP = 30; // minutos de cada bloco
  const TZ = 'America/Sao_Paulo';

  const pad = (n) => String(n).padStart(2, '0');
  const toMin = (t) => { const [h, m] = String(t).split(':').map(Number); return h * 60 + m; };
  const fromMin = (m) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
  const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parse = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && iso(parse(s)) === s;
  const isTime = (s) => typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);

  /** Data de hoje no fuso da barbearia, no formato AAAA-MM-DD. */
  function todayIn(tz = TZ) {
    return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  }
  /** Minutos passados desde a meia-noite, no fuso da barbearia. */
  function nowMinIn(tz = TZ) {
    const p = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date());
    const get = (t) => Number(p.find((x) => x.type === t).value);
    return get('hour') * 60 + get('minute');
  }

  function isBlocked(blocked, ds) { return (blocked || []).some((b) => b.date === ds); }

  /** Horário de abrir e fechar de um dia da semana (0 = domingo). Cada dia pode ter o seu. */
  function dayHours(settings, dow) {
    const h = (settings.hours || {})[dow];
    return h && isTime(h.open) && isTime(h.close) ? { open: h.open, close: h.close } : { open: settings.open, close: settings.close };
  }

  /** Todos os horários de início possíveis num dia (sem olhar se estão ocupados). */
  function daySlots(settings, blocked, ds) {
    const d = parse(ds);
    if ((settings.closed || []).includes(d.getDay()) || isBlocked(blocked, ds)) return [];
    const hh = dayHours(settings, d.getDay());
    const o = toMin(hh.open), c = toMin(hh.close);
    const ls = toMin(settings.lunchStart), le = toMin(settings.lunchEnd);
    const out = [];
    for (let m = o; m + STEP <= c; m += STEP) {
      if (m >= ls && m < le) continue;
      out.push(fromMin(m));
    }
    return out;
  }

  /** De quanto em quanto tempo o cliente pode começar (30 ou 60 minutos, escolhido em Configurações). */
  const stepOf = (settings) => (Number(settings && settings.step) === 60 ? 60 : STEP);

  /**
   * Horários de início que o cliente vê no site. Com "de 1 em 1 hora" fica 9:00, 10:00, 11:00...
   * contando a partir da hora de abrir, e recomeça certinho na volta do almoço.
   */
  function startSlots(settings, blocked, ds) {
    const all = daySlots(settings, blocked, ds);
    const step = stepOf(settings);
    if (step === STEP || !all.length) return all;
    const ok = new Set(all); const out = [];
    let m = toMin(all[0]); const fim = toMin(all[all.length - 1]);
    while (m <= fim) {
      if (ok.has(fromMin(m))) { out.push(fromMin(m)); m += step; }
      else m += STEP; // almoço: anda de meia em meia hora até voltar a abrir
    }
    return out;
  }

  /** Inícios tomados: o horário conta como ocupado se qualquer pedaço dele já tem cliente. */
  function startBusy(settings, appts, ds, ignoreId) {
    const b = busySet(appts, ds, ignoreId); const step = stepOf(settings);
    if (step === STEP) return b;
    const out = new Set(b);
    for (const t of b) { const m = toMin(t); for (let k = m - step + STEP; k < m; k += STEP) out.add(fromMin(k)); }
    return out;
  }

  /** Blocos ocupados num dia. Cancelados não ocupam. */
  function busySet(appts, ds, ignoreId) {
    const set = new Set();
    for (const a of appts || []) {
      if (a.date !== ds || a.status === 'cancelado' || (ignoreId != null && String(a.id) === String(ignoreId))) continue;
      const n = Math.ceil(a.dur / STEP);
      for (let i = 0; i < n; i++) set.add(fromMin(toMin(a.time) + STEP * i));
    }
    return set;
  }

  /** O serviço de "dur" minutos cabe começando em "t"? */
  function fits(settings, blocked, appts, ds, t, dur, ignoreId) {
    const b = busySet(appts, ds, ignoreId);
    const slots = new Set(daySlots(settings, blocked, ds));
    const n = Math.ceil(dur / STEP);
    for (let i = 0; i < n; i++) {
      const s = fromMin(toMin(t) + STEP * i);
      if (!slots.has(s) || b.has(s)) return false;
    }
    return true;
  }

  function isPast(ds, t, today, nowMin) {
    if (ds < today) return true;
    if (ds > today) return false;
    return toMin(t) <= nowMin;
  }

  // ----- Conferência de nome e WhatsApp (mesma regra no site, no painel e no servidor) -----
  const DDDS = new Set('11 12 13 14 15 16 17 18 19 21 22 24 27 28 31 32 33 34 35 37 38 41 42 43 44 45 46 47 48 49 51 53 54 55 61 62 63 64 65 66 67 68 69 71 73 74 75 77 79 81 82 83 84 85 86 87 88 89 91 92 93 94 95 96 97 98 99'.split(' '));
  const LIGA = new Set(['da', 'das', 'de', 'do', 'dos', 'e', 'di', 'du', 'van', 'von']);

  /** Arruma espaços e deixa "joão DA silva" como "João da Silva". */
  function tidyName(v) {
    return String(v || '').trim().replace(/\s+/g, ' ').split(' ').map((w, i) => {
      const l = w.toLowerCase();
      if (i > 0 && LIGA.has(l)) return l;
      return l.replace(/(^|-)(\S)/g, (m, sep, ch) => sep + ch.toUpperCase());
    }).join(' ');
  }
  /** Devolve '' se o nome estiver bom, ou a mensagem do que falta. */
  function nameError(v) {
    const s = String(v || '').trim().replace(/\s+/g, ' ');
    if (!s) return 'Digite seu nome e sobrenome.';
    if (s.length > 80) return 'O nome está muito grande.';
    if (!/^[A-Za-zÀ-ÖØ-öø-ÿ' .-]+$/.test(s)) return 'O nome só pode ter letras.';
    const words = s.split(' ').filter((w) => !LIGA.has(w.toLowerCase()));
    if (words.length < 2) return 'Digite o nome e o sobrenome. Ex.: João Silva.';
    if (words.some((w) => w.replace(/[^A-Za-zÀ-ÖØ-öø-ÿ]/g, '').length < 2)) return 'Escreva o nome e o sobrenome por inteiro, sem abreviar.';
    if (words.some((w) => /^(.)\1+$/i.test(w))) return 'Esse nome não parece de verdade. Digite o nome e o sobrenome.';
    return '';
  }
  /** Só os números do WhatsApp, sem o +55 do começo. */
  function phoneDigits(v) {
    let d = String(v || '').replace(/\D/g, '');
    if (d.length === 13 && d.startsWith('55')) d = d.slice(2);
    if (d.length === 12 && d.startsWith('0')) d = d.slice(1);
    return d;
  }
  /** Devolve '' se for um celular brasileiro válido, ou a mensagem do problema. */
  function phoneError(v) {
    const d = phoneDigits(v);
    const ex = ' Ex.: (11) 97425-8136.';
    if (d.length !== 11) return 'Digite o WhatsApp com DDD, 11 números.' + ex;
    if (!DDDS.has(d.slice(0, 2))) return 'Esse DDD não existe. Confira os dois primeiros números.' + ex;
    if (d[2] !== '9') return 'Celular começa com 9 depois do DDD.' + ex;
    const n = d.slice(3);
    if (/^(\d)\1+$/.test(n) || '0123456789'.includes(n) || '9876543210'.includes(n)) return 'Esse número não parece de verdade. Digite o seu WhatsApp.';
    return '';
  }

  // ----- Lembrete no WhatsApp -----
  const REMIND_MSG = 'Olá, {nome}! Passando para lembrar do seu horário hoje às {hora} ({servico}) na {barbearia}. Se não puder vir, cancele pelo site para liberar a vaga. Até já!';
  /** Troca {nome}, {hora}, {servico} e {barbearia} pelos dados do agendamento. */
  function remindText(tpl, d) {
    const first = String(d.nome || '').trim().split(/\s+/)[0] || '';
    const map = { nome: first, hora: d.hora || '', servico: d.servico || '', barbearia: d.barbearia || '' };
    return String(tpl || REMIND_MSG).replace(/\{(nome|hora|servico|serviço|barbearia)\}/gi, (m, k) => map[k.toLowerCase().replace('ç', 'c')]);
  }

  // ----- Lista de espera: mensagem de quando vaga um horário e ele já é marcado para o primeiro da fila -----
  const ESPERA_MSG = 'Boa notícia, {nome}! 🎉\n\nAbriu uma vaga na {barbearia} e, como você estava na lista de espera, o horário já é seu:\n\n📅 {dia}\n⏰ {hora}\n✂️ {servico} · {valor}\n\nNão precisa responder. Se não puder vir, entre no site de agendamento, em "Meus horários", e cancele ou mude o horário para liberar a vaga para o próximo da fila. Te esperamos!';
  /** Troca {nome}, {dia}, {hora}, {servico}, {valor} e {barbearia} na mensagem da lista de espera. */
  function esperaText(d) {
    const first = String(d.nome || '').trim().split(/\s+/)[0] || '';
    const map = { nome: first, dia: d.dia || '', hora: d.hora || '', servico: d.servico || '', valor: d.valor || '', barbearia: d.barbearia || '' };
    return ESPERA_MSG.replace(/\{(nome|dia|hora|servico|valor|barbearia)\}/g, (m, k) => map[k]);
  }

  // ----- Marca: cor e iniciais (usadas no site, no painel e no servidor, que monta a tela de carregamento e o ícone da aba) -----
  const PRESETS = {
    latao: ['Dourado', '#8c6a2b', '#d2b06b'], verde: ['Verde garrafa', '#1f5f4a', '#6cc8a1'], bordo: ['Bordô', '#7a2433', '#e3909b'],
    petroleo: ['Petróleo', '#1d4e68', '#7cbde0'], cobre: ['Cobre', '#9a4a24', '#e59a6c'], branco: ['Branco', '#4a4a48', '#f5f3ef'],
    preto: ['Preto', '#111111', '#cfcfcf'], azul: ['Azul royal', '#1f3fa8', '#8ea8ff'], roxo: ['Roxo', '#5b2a86', '#c3a0f0'], vermelho: ['Vermelho', '#b3261e', '#ff8a80'],
    laranja: ['Laranja', '#b45309', '#f6ad55'], rosa: ['Rosa', '#a3245f', '#f19ac2'], ciano: ['Ciano', '#0e6377', '#6fd3e6'], prata: ['Prata', '#52525b', '#c4c4cc'],
  };
  /** Cores da marca para tema claro (l) e escuro (d), com a cor do texto por cima de cada uma. */
  function accent(st) {
    let l, d;
    if (st.color === 'custom' && /^#[0-9a-fA-F]{6}$/.test(st.custom || '')) { l = d = st.custom; } else { [, l, d] = PRESETS[st.color] || PRESETS.latao; }
    const lum = (h) => { const n = parseInt(h.slice(1), 16); return (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255; };
    return { l, d, onL: lum(l) > 0.6 ? '#1c1915' : '#ffffff', onD: lum(d) > 0.5 ? '#17130d' : '#ffffff' };
  }
  // ----- Letra do sistema: par de fontes (títulos + textos) escolhido em Configurações. Vale no site e no painel. -----
  // g = família no Google Fonts (com os pesos usados), css = como entra no CSS (com reservas caso a fonte não carregue)
  const SERIF = 'Georgia,"Times New Roman",serif'; const SANS = 'ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif';
  const FAMILIAS = {
    Fraunces: 'Fraunces:ital,opsz,wght@0,9..144,500;0,9..144,600;0,9..144,700;1,9..144,500',
    Manrope: 'Manrope:wght@400;500;600;700;800',
    'DM Serif Display': 'DM+Serif+Display:ital@0;1',
    'DM Sans': 'DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,600;9..40,700;9..40,800',
    Cinzel: 'Cinzel:wght@500;600;700',
    Jost: 'Jost:wght@400;500;600;700;800',
    'Bebas Neue': 'Bebas+Neue',
    Barlow: 'Barlow:wght@400;500;600;700;800',
    Outfit: 'Outfit:wght@400;500;600;700;800',
    'Space Grotesk': 'Space+Grotesk:wght@400;500;600;700',
  };
  const FONTES = {
    classica: { nome: 'Clássica', desc: 'A de sempre. Títulos com serifa suave.', tit: 'Fraunces', titR: SERIF, txt: 'Manrope' },
    editorial: { nome: 'Editorial', desc: 'Títulos de revista, fortes e elegantes.', tit: 'DM Serif Display', titR: SERIF, txt: 'DM Sans' },
    luxo: { nome: 'Luxo', desc: 'Letras de placa gravada, tudo em maiúsculas.', tit: 'Cinzel', titR: SERIF, txt: 'Jost' },
    letreiro: { nome: 'Letreiro', desc: 'Estreita e alta, como fachada de barbearia.', tit: 'Bebas Neue', titR: 'Impact,"Arial Narrow",sans-serif', txt: 'Barlow' },
    moderna: { nome: 'Moderna', desc: 'Sem serifa, limpa e arredondada.', tit: 'Outfit', titR: SANS, txt: 'Outfit' },
    urbana: { nome: 'Urbana', desc: 'Traço reto e atual, com personalidade.', tit: 'Space Grotesk', titR: SANS, txt: 'Space Grotesk' },
  };
  /** Fontes escolhidas (cai na Clássica se a escolha não existir), já no formato do CSS. */
  function fonte(st) {
    const k = st && FONTES[st.font] ? st.font : 'classica'; const f = FONTES[k];
    return { k, nome: f.nome, tit: `"${f.tit}",${f.titR}`, txt: `"${f.txt}",${SANS}` };
  }
  /** Endereço do Google Fonts com as fontes de uma ou mais escolhas (ex.: ['classica'] ou todas para a vitrine). */
  function fonteUrl(keys) {
    const fams = []; (keys || ['classica']).forEach((k) => { const f = FONTES[k] || FONTES.classica; [f.tit, f.txt].forEach((x) => { if (!fams.includes(x)) fams.push(x); }); });
    return 'https://fonts.googleapis.com/css2?' + fams.map((x) => 'family=' + FAMILIAS[x]).join('&') + '&display=swap';
  }
  /** Iniciais da barbearia (sem a palavra "Barbearia"): "Barbearia Navalha de Ouro" vira "ND". */
  function shopInitials(name) {
    const n = String(name || '').trim();
    const base = n.replace(/barbearia/i, '').trim() || n;
    return base.split(' ').filter(Boolean).map((w) => w[0]).slice(0, 2).join('').toUpperCase() || 'B';
  }

  return { PRESETS, accent, FONTES, fonte, fonteUrl, shopInitials, STEP, TZ, stepOf, startSlots, startBusy, pad, toMin, fromMin, iso, parse, addDays, isDate, isTime, todayIn, nowMinIn, isBlocked, dayHours, daySlots, busySet, fits, isPast, tidyName, nameError, phoneDigits, phoneError, REMIND_MSG, remindText, ESPERA_MSG, esperaText };
});
