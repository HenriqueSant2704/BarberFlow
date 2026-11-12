// Site do cliente: início, agendar, ver e cancelar horários, editar o perfil.
// Celular: abas embaixo e barra "Confirmar" fixa. Computador: menu no topo e resumo ao lado.
// Quando algo impede o agendamento (horário ocupado, serviço que não cabe, dia lotado),
// aparece um aviso colorido no topo, a borda da tela pisca e o item culpado treme.
(function () {
  const A = window.Agenda;
  const { esc, money, digits, maskPhone, MESES, DOW, DOWL, longDate, shortDate, cap, initials, ic, svcIcon, applyTheme, api, store, alerta, marcar } = window.U;
  const $ = (s) => document.querySelector(s);
  const TOKEN_KEY = 'barbearia_cliente';

  // Dados vindos do servidor
  let S = { settings: null, services: [], blocked: [], busy: [] };
  let TODAY = A.todayIn();
  let ME = null, MYAP = [];
  const nowMin = () => A.nowMinIn();
  const MOBILE = window.matchMedia('(max-width: 760px)');

  // svcs: serviços escolhidos (pode somar mais de um no mesmo horário)
  // remarca: id do horário que o cliente está mudando de dia/hora; esp: pedido da lista de espera
  const V = {
    tab: 'inicio', date: null, time: null, svcs: [], sheet: null, phone: '', newName: '', newPhone: '',
    errs: {}, notFound: false, cancelAsk: null, lastBooking: null, done: false, busyAction: false, calMonth: null, step: 1, stepDir: 0, abre: {},
    remarca: null, antes: null, detalhe: null, esp: null, acao: 'agendar', espSai: null,
  };
  const MAX_SVCS = 4;
  let MYESP = []; // pedidos na lista de espera

  const token = () => store.get(TOKEN_KEY);
  const authH = () => (token() ? { Authorization: 'Bearer ' + token() } : {});
  // Número aleatório deste aparelho (não identifica a pessoa): ajuda a barbearia a frear trotes
  function deviceId() {
    try {
      let d = localStorage.getItem('barbearia_dev');
      if (!d) { d = (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2)).replace(/[^A-Za-z0-9-]/g, ''); localStorage.setItem('barbearia_dev', d); }
      return d;
    } catch { return ''; }
  }

  // ----- regras da agenda com os dados carregados -----
  // daySlots/busy = horários de início que o cliente vê (de 30 em 30 ou de 1 em 1 hora, como o barbeiro escolheu)
  // Mudando um horário: o horário atual do cliente conta como livre (ele pode trocar só o serviço ou passar meia hora)
  const remAp = () => (V.remarca ? MYAP.find((a) => String(a.id) === String(V.remarca)) || null : null);
  function ocup() {
    const r = remAp(); if (!r) return S.busy;
    let tirou = false;
    return S.busy.filter((b) => { if (!tirou && b.date === r.date && b.time === r.time && Number(b.dur) === Number(r.dur)) { tirou = true; return false; } return true; });
  }
  const daySlots = (ds) => A.startSlots(S.settings, S.blocked, ds);
  const busy = (ds) => A.startBusy(S.settings, ocup(), ds);
  const isPast = (ds, t) => A.isPast(ds, t, TODAY, nowMin());
  const fits = (ds, t, dur) => A.fits(S.settings, S.blocked, ocup(), ds, t, dur);
  const blockedOf = (ds) => S.blocked.find((b) => b.date === ds);
  const sortAp = (l) => l.sort((p, q) => (p.date + p.time).localeCompare(q.date + q.time));
  const svcById = (id) => S.services.find((x) => String(x.id) === String(id));
  // Serviços escolhidos: tempo e preço somados
  const escolhidos = (ids = V.svcs) => ids.map(svcById).filter(Boolean);
  const durDe = (l) => l.reduce((s, x) => s + Number(x.dur || 0), 0);
  const precoDe = (l) => l.reduce((s, x) => s + Number(x.price || 0), 0);
  const nomesDe = (l) => l.map((x) => x.name).join(' + ');
  /** Itens de um horário já marcado (vários serviços ou um só). */
  const itensAp = (a) => (a.items && a.items.length ? a.items : [{ serviceId: a.serviceId, name: a.service, price: a.price }]);
  const PERIODOS = [['qualquer', 'Qualquer horário'], ['manha', 'Manhã'], ['tarde', 'Tarde'], ['noite', 'Noite']];
  const noPeriodo = (t, p) => { const m = A.toMin(t); return p === 'manha' ? m < 720 : p === 'tarde' ? m >= 720 && m < 1080 : p === 'noite' ? m >= 1080 : true; };
  const perTxt = (p) => (PERIODOS.find((x) => x[0] === p) || PERIODOS[0])[1];
  const esperaOn = () => !!(S.espera && S.espera.on);
  const ord = (n) => `${n}º`;
  const endOf = (t, dur) => A.fromMin(A.toMin(t) + dur);
  const tempo = (m) => (m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? A.pad(m % 60) : ''}` : `${m} min`);
  const first = (n) => String(n || '').split(' ')[0];
  const plural = (d) => `${d === 0 || d === 6 ? 'aos' : 'às'} ${DOWL[d]}s`;
  const hasLunch = () => S.settings.lunchStart !== S.settings.lunchEnd;
  const winStart = () => (S.settings.bookFrom > TODAY ? S.settings.bookFrom : TODAY);
  const inWindow = (ds) => ds >= winStart() && ds <= S.settings.bookTo;
  const daysTo = (ds) => Math.round((A.parse(ds) - A.parse(TODAY)) / 864e5);

  /** Situação do dia para o cliente: livre, poucas vagas, lotado, fechado ou folga. */
  function dayStatus(ds) {
    const d = A.parse(ds);
    if (!inWindow(ds)) return { st: 'fora', r: '' };
    if (S.settings.closed.includes(d.getDay())) return { st: 'fechado', r: 'Fechado' };
    const b = blockedOf(ds); if (b) return { st: 'folga', r: 'Fechado', why: b.why };
    const bz = busy(ds); const free = daySlots(ds).filter((t) => !bz.has(t) && !isPast(ds, t)).length;
    if (!free) return { st: 'lotado', r: 'Lotado' };
    return { st: free <= 4 ? 'poucas' : 'livre', r: `${free} vaga${free > 1 ? 's' : ''}`, n: free };
  }
  /** Por que um serviço de "dur" minutos não cabe começando em "t". */
  function whyNot(ds, t, dur) {
    const st = S.settings; const slots = new Set(A.daySlots(st, S.blocked, ds)); const bz = A.busySet(ocup(), ds);
    const n = Math.ceil(dur / A.STEP);
    for (let i = 0; i < n; i++) {
      const m = A.toMin(t) + A.STEP * i; const s = A.fromMin(m);
      if (!slots.has(s)) {
        if (hasLunch() && m >= A.toMin(st.lunchStart) && m < A.toMin(st.lunchEnd)) return { m: 'almoco' };
        return { m: 'fecha' };
      }
      if (i > 0 && bz.has(s)) return { m: 'ocupado', t: s };
    }
    return null;
  }
  /** Até 4 horários livres do dia, perto de "perto", em que um serviço de "dur" cabe. */
  function suggest(ds, dur, perto) {
    const bz = busy(ds); const p = A.toMin(perto || '12:00');
    return daySlots(ds).filter((t) => !bz.has(t) && !isPast(ds, t) && fits(ds, t, dur))
      .sort((a, b) => Math.abs(A.toMin(a) - p) - Math.abs(A.toMin(b) - p)).slice(0, 4).sort();
  }
  /** "Aberto agora", "No almoço" ou "Fechado", para o topo do site. */
  function shopNow() {
    const st = S.settings; const d = A.parse(TODAY); const m = nowMin(); const hh = A.dayHours(st, d.getDay());
    if (st.closed.includes(d.getDay()) || blockedOf(TODAY)) return { st: 'fechado', r: 'Fechado hoje' };
    if (m < A.toMin(hh.open)) return { st: 'fechado', r: `Abre hoje às ${hh.open}` };
    if (m >= A.toMin(hh.close)) return { st: 'fechado', r: 'Fechado agora' };
    if (hasLunch() && m >= A.toMin(st.lunchStart) && m < A.toMin(st.lunchEnd)) return { st: 'almoco', r: `No almoço · volta às ${st.lunchEnd}` };
    return { st: 'aberto', r: `Aberto agora · até ${hh.close}` };
  }

  function waLink(txt) { return `https://wa.me/55${S.settings.phone}${txt ? `?text=${encodeURIComponent(txt)}` : ''}`; }

  // ----- carregar -----
  async function loadInfo() {
    const d = await api('GET', '/api/public/info');
    S.settings = d.settings; S.services = d.services; S.blocked = d.blocked; S.remind = d.remind || { on: false }; S.espera = d.espera || { on: false }; TODAY = d.today;
    applyTheme(S.settings);
    document.title = `${S.settings.shopName} · Agendar horário`;
  }
  async function loadBusy() {
    const st = S.settings;
    const from = winStart();
    let to = st.bookTo;
    const max = A.iso(A.addDays(A.parse(from), 180));
    if (to > max) to = max;
    if (from > to) { S.busy = []; return; }
    S.busy = await api('GET', `/api/public/ocupados?from=${from}&to=${to}`);
  }
  async function loadMe() {
    if (!token()) { ME = null; MYAP = []; MYESP = []; return; }
    try {
      const d = await api('GET', '/api/public/me', null, authH());
      ME = d.client; MYAP = d.appointments; MYESP = d.espera || [];
    } catch (e) {
      if (e.status === 401) { store.set(TOKEN_KEY, null); ME = null; MYAP = []; MYESP = []; } else throw e;
    }
  }

  // ----- tela -----
  const TABS = [['inicio', 'Início', 'home'], ['agendar', 'Agendar', 'cal'], ['horarios', 'Meus horários', 'clock'], ['perfil', 'Perfil', 'user']];
  let lastTab = null, lastSheet = null;
  function render(keep) {
    const top = window.scrollY;
    // anima só quando troca de aba ou abre a janela, não a cada toque
    const animTab = V.tab !== lastTab, animSheet = V.sheet !== lastSheet;
    lastTab = V.tab; lastSheet = V.sheet;
    const view = { inicio: vHome, agendar: vAgendar, horarios: vHorarios, perfil: vPerfil, ok: vOk }[V.tab]();
    const cur = V.tab === 'ok' ? 'agendar' : V.tab;
    const now = shopNow();
    const tabBtn = (size) => ([k, l, i]) => `<button type="button" class="${cur === k ? 'on' : ''}" data-a="tab" data-t="${k}" ${cur === k ? 'aria-current="page"' : ''}>${ic(i, size)}${l}</button>`;
    const barra = V.tab === 'agendar' && V.step === 3 && MOBILE.matches;
    $('#app').innerHTML = `<div class="c-app ${barra ? 'tem-barra' : ''}">
      <header class="c-topo"><div class="c-topo-in">
        <button type="button" class="c-logo" data-a="tab" data-t="inicio">${window.U.logo(S.settings, 44)}<div><b>${esc(S.settings.shopName)}</b><small data-st="${now.st}">${now.r}</small></div></button>
        <nav class="c-nav" aria-label="Menu">${TABS.map(tabBtn(18)).join('')}</nav>
        ${window.U.tema.botao('c-tema')}<a class="c-portal" href="/painel/" rel="nofollow" title="Área do barbeiro">${ic('lock', 13)}<span>Portal</span></a>
      </div></header>
      <main class="c-main ${animTab ? 'vista' : ''}">${view}</main>
      ${barra ? bookbar() : ''}
      <nav class="c-tabbar" aria-label="Menu">${TABS.map(tabBtn(21)).join('')}</nav>
    </div>${V.sheet ? sheet(animSheet) : ''}`;
    if (keep) window.scrollTo(0, top); else window.scrollTo(0, 0);
    wireCarousel();
  }
  function myNext() {
    return sortAp(MYAP.filter((a) => a.status === 'agendado' && !isPast(a.date, a.time)))[0] || null;
  }

  // ===== Início: o essencial em cima (agendar e seu horário); o resto fica guardado em "Informações" =====
  /** Seções que abrem e fecham no Início. No computador começam abertas; no celular, fechadas. */
  const abre = (k) => V.abre[k] ?? !MOBILE.matches;
  function vHome() {
    const st = S.settings; const nx = myNext(); const now = shopNow();
    let prox = '';
    if (nx) {
      const d = A.parse(nx.date); const dd = daysTo(nx.date);
      prox = `<section class="cartao ini-prox"><div class="ini-prox-corpo"><div class="cal-g"><small>${DOW[d.getDay()]}</small><b>${d.getDate()}</b><small>${MESES[d.getMonth()].slice(0, 3)}</small></div>
          <div style="min-width:0"><small class="ini-rot">Seu próximo horário</small><h4>${esc(nx.service)}</h4><p>${cap(longDate(nx.date))} · <b>${nx.time}</b> às ${endOf(nx.time, nx.dur)}</p></div>
          <span class="pilula viva" data-k="verde">${dd === 0 ? 'É hoje!' : dd === 1 ? 'É amanhã' : `Em ${dd} dias`}</span></div>
        <div class="ini-acoes"><button type="button" class="btn p" data-a="tab" data-t="horarios">${ic('clock', 16)}Meus horários</button><button type="button" class="btn p" data-a="tab" data-t="agendar">${ic('plus', 16)}Agendar outro</button></div></section>`;
    } else if (!ME) {
      prox = `<button type="button" class="ini-entrar" data-a="tab" data-t="horarios"><span class="ico-k">${ic('phone', 17)}</span><span><b>Já agendou antes?</b><small>Entre com seu WhatsApp para ver seu horário</small></span>${ic('right', 18)}</button>`;
    }
    const svcs = S.services;
    const carousel = svcs.length ? `<section class="cartao"><div class="cartao-topo"><h3><span class="ico-k">${ic('scissors', 17)}</span>Serviços e valores</h3>${svcs.length > 2 ? `<div class="car-setas"><button type="button" class="btn-icone" data-a="carro" data-n="-1" aria-label="Serviços anteriores">${ic('left', 18)}</button><button type="button" class="btn-icone" data-a="carro" data-n="1" aria-label="Próximos serviços">${ic('right', 18)}</button></div>` : ''}</div>
      <div class="carrossel" id="carrossel">${svcs.map((x) => `<button type="button" class="car-svc" data-a="ini-svc" data-id="${x.id}"><span class="ico-k">${svcIcon(x.name).replace('<svg', '<svg width="20" height="20"')}</span><b>${esc(x.name)}</b><span class="car-rod"><span class="tag">${ic('clock', 13)}${tempo(x.dur)}</span><b class="preco">${money(x.price)}</b></span></button>`).join('')}</div>
      ${svcs.length > 1 ? `<div class="car-pontos" id="carPontos" aria-hidden="true">${svcs.map((_, i) => `<i class="${i === 0 ? 'on' : ''}"></i>`).join('')}</div>` : ''}</section>` : '';
    const addr = (st.address || '').trim(); const q = encodeURIComponent(addr);
    const today = A.parse(TODAY).getDay();
    const linha = (k, i, rot, val, extra, corpo) => `<div class="info-l ${corpo && abre(k) ? 'aberta' : ''}">
      ${corpo ? `<button type="button" class="info-cab" data-a="abre" data-k="${k}" aria-expanded="${abre(k)}">` : '<div class="info-cab">'}<span class="ico-k">${ic(i, 17)}</span><span class="info-txt"><small>${rot}</small><b>${val}</b></span>${extra || ''}${corpo ? `<span class="info-seta">${ic('right', 16)}</span></button>` : '</div>'}
      ${corpo && abre(k) ? `<div class="info-corpo ${V.abreAnim === k ? 'anima' : ''}">${corpo}</div>` : ''}</div>`;
    const semana = `<div class="ini-horas">${[1, 2, 3, 4, 5, 6, 0].map((i) => { const off = st.closed.includes(i); return `<div class="${i === today ? 'hoje' : ''} ${off ? 'fech' : ''}"><span>${cap(DOWL[i])}${i === today ? ' <small>hoje</small>' : ''}</span><b class="num">${off ? 'Fechado' : `${A.dayHours(st, i).open} às ${A.dayHours(st, i).close}`}</b></div>`; }).join('')}
      ${hasLunch() ? `<div class="almoco"><span>${ic('coffee', 15)}Almoço</span><b class="num">${st.lunchStart} às ${st.lunchEnd}</b></div>` : ''}</div>
      ${st.bookTo >= TODAY ? `<div class="ini-limite">Agendamentos abertos até ${A.parse(st.bookTo).getDate()} de ${MESES[A.parse(st.bookTo).getMonth()]}.</div>` : ''}`;
    const mapa = addr ? `<div class="mapa"><iframe title="Mapa: ${esc(addr)}" loading="lazy" referrerpolicy="no-referrer-when-downgrade" src="https://www.google.com/maps?q=${q}&output=embed"></iframe></div>
      <a class="btn p" style="margin-top:10px" href="https://www.google.com/maps/search/?api=1&query=${q}" target="_blank" rel="noopener">${ic('pin', 16)}Abrir no mapa</a>` : '';
    const infos = `<section class="cartao info-c"><div class="cartao-topo"><h3><span class="ico-k">${ic('info', 17)}</span>Informações</h3></div>
      ${linha('semana', 'clock', 'Horário de hoje', `<span class="info-st" data-st="${now.st}">${now.r}</span>`, '', semana)}
      ${addr ? linha('mapa', 'pin', 'Endereço', esc(addr), '', mapa) : ''}
      ${st.phone ? `<a class="info-l info-cab" href="${waLink('Olá! Vim pelo site de agendamento.')}" target="_blank" rel="noopener"><span class="ico-k verde">${ic('whats', 17)}</span><span class="info-txt"><small>WhatsApp</small><b class="num">${maskPhone(st.phone)}</b></span><span class="info-ir">Chamar ${ic('arrow', 14)}</span></a>` : ''}
    </section>`;
    return `<div class="ini">
      <section class="c-hero bv"><div class="poste" aria-hidden="true"><span class="tampa"></span><span class="vidro"><i></i></span><span class="tampa b"></span></div><div><small class="sobre bv-ola">${ME ? `Olá, ${esc(first(ME.name))}` : 'Agendamento online'}</small><h1>${esc(st.tagline || st.shopName)}</h1><p>Atendimento com hora marcada, sem fila. Escolha seu horário pelo celular e pague na barbearia.</p>
        <div class="ini-acoes" style="margin-top:16px"><button type="button" class="btn-claro" data-a="tab" data-t="agendar">${ic('cal', 18)}Agendar meu horário</button></div>
        <div class="bv-selos"><span>${ic('clock', 14)}Sem fila</span><span>${ic('check', 14)}Pague na barbearia</span></div></div>
        <div class="ini-selo" aria-hidden="true">${st.logo ? `<img src="${esc(st.logo)}" alt="">` : `<span>${esc(initials(st.shopName.replace(/barbearia/i, '').trim() || st.shopName) || 'B')}</span><small>Barbearia</small>`}</div></section>
      ${prox}
      <div class="ini-grid"><div class="col">${carousel}</div><div class="col">${infos}</div></div>
    </div>`;
  }
  // Bolinhas do carrossel acompanham o deslize
  function wireCarousel() {
    const c = $('#carrossel'); const dots = document.querySelectorAll('#carPontos i');
    if (!c || !dots.length) return;
    c.addEventListener('scroll', () => {
      const card = c.querySelector('.car-svc'); const w = card ? card.offsetWidth + 12 : 200;
      let i = Math.round(c.scrollLeft / w);
      if (c.scrollLeft + c.clientWidth >= c.scrollWidth - 4) i = dots.length - 1;
      dots.forEach((d, k) => d.classList.toggle('on', k === Math.min(i, dots.length - 1)));
    }, { passive: true });
  }

  // ===== Agendar: um passo de cada vez (1 dia, 2 horário, 3 serviço) =====
  const PASSOS = [['Dia', 'cal'], ['Horário', 'clock'], ['Serviço', 'scissors']];
  /** Volta para um passo já feito (só deixa ir até onde o cliente já chegou). */
  function irPasso(n) {
    const max = !V.date ? 1 : !V.time ? 2 : 3;
    V.step = Math.min(Math.max(1, n), max); render(true);
  }
  function vAgendar() {
    const st = S.settings; const start = winStart();
    if (start > st.bookTo) {
      return `<div class="cartao"><div class="vazio"><span class="ico-k">${ic('cal', 26)}</span><h4>Agenda fechada no momento</h4><p>A barbearia ainda não abriu novas datas para agendamento. Volte em breve.</p></div></div>`;
    }
    const l = escolhidos(); const s = l.length > 0;
    const rem = remAp();
    const valor = [V.date ? shortDate(V.date) : '', V.time || '', l.length > 1 ? `${l.length} serviços` : s ? l[0].name : ''];
    const tit = (rem ? ['Para qual dia quer mudar?', 'E qual horário?', 'Confere os serviços'] : ['Qual dia fica bom pra você?', 'Que horas você prefere?', 'O que vamos fazer?'])[V.step - 1];
    const sub = [
      `Datas abertas até ${shortDate(st.bookTo)}. Toque em um dia com vaga.`,
      V.date ? cap(longDate(V.date)) : '',
      V.time ? `${cap(longDate(V.date))} às ${V.time} · ${rem ? 'pode trocar ou somar outro serviço' : 'escolha um ou mais serviços'}` : '',
    ][V.step - 1];
    // Faixa do "mudando seu horário": mostra o horário atual e dá para desistir
    const faixaRem = rem ? `<div class="rem-faixa"><span class="ico-k">${ic('repeat', 18)}</span><div><small>Mudando seu horário</small><b>Atual: ${cap(DOW[A.parse(rem.date).getDay()].toLowerCase())}, ${shortDate(rem.date)} às ${rem.time} · ${esc(rem.service)}</b></div><button type="button" class="link" data-a="rem-x">${ic('x', 15)}Desistir</button></div>` : '';
    const stepper = `<ol class="wiz-passos" aria-label="Passos do agendamento">${PASSOS.map(([t, i], k) => {
      const n = k + 1; const feito = n < V.step || (n === 3 && s); const atual = n === V.step;
      const pode = n < V.step;
      return `<li class="wp ${feito ? 'feito' : ''} ${atual ? 'atual' : ''}">${pode ? `<button type="button" data-a="passo" data-n="${n}" aria-label="Voltar para ${t}">` : '<div>'}
        <span class="n">${feito && !atual ? ic('check', 14) : n}</span><span class="wp-t"><b>${t}</b><small>${esc(valor[k] || (atual ? 'Agora' : ''))}</small></span>${pode ? '</button>' : '</div>'}</li>`;
    }).join('')}</ol>`;
    const corpo = V.step === 1 ? blocoDia() : V.step === 2 ? blocoHora() : blocoSvc();
    const dir = V.stepDir; V.stepDir = 0; // anima só quando troca de passo
    return `<div class="c-grid"><div class="col wiz">${faixaRem}
      <div class="wiz-topo">${stepper}<div class="wiz-barra" aria-hidden="true"><i style="width:${((V.step - 1 + (V.step === 3 && s ? 1 : 0)) / 3) * 100}%"></i></div></div>
      <div class="wiz-tit ${dir ? (dir > 0 ? 'vai' : 'volta') : ''}"><small>Passo ${V.step} de 3</small><h1>${tit}</h1>${sub ? `<p>${sub}</p>` : ''}</div>
      <div class="${dir ? (dir > 0 ? 'vai' : 'volta') : ''}">${corpo}</div>
      ${V.step > 1 ? `<button type="button" class="link wiz-volta" data-a="passo" data-n="${V.step - 1}">${ic('left', 16)}Voltar para ${PASSOS[V.step - 2][0].toLowerCase()}</button>` : ''}
    </div><aside class="c-lado">${resumo()}
      <div class="info-casa">${ic('info', 16)}<span>Chegue 5 minutos antes. Se não puder vir, mude ou cancele em <b>Meus horários</b> para liberar a vaga.</span></div></aside></div>`;
  }
  function blocoDia() {
    return `<section class="bloco" id="b-dia">${monthCal()}
      <div class="legenda"><span data-k="verde"><i></i>Com vagas</span><span data-k="laranja"><i></i>Poucas vagas</span><span data-k="vermelho"><i></i>Lotado</span><span data-k="cinza"><i></i>Fechado</span>${remAp() ? '<span class="meu"><i></i>Seu horário atual</span>' : ''}</div>
      ${esperaOn() && !remAp() ? `<div class="wiz-nota">${ic('bell', 15)}Dia lotado? Toque nele e entre na lista de espera.</div>` : ''}
    </section>`;
  }
  function monthCal() {
    const start = winStart(); const limit = S.settings.bookTo;
    const sm = start.slice(0, 8) + '01';
    if (!V.calMonth || V.calMonth < sm) V.calMonth = sm;
    const m = A.parse(V.calMonth); const f = new Date(m.getFullYear(), m.getMonth(), 1); const last = new Date(m.getFullYear(), m.getMonth() + 1, 0);
    let cells = DOW.map((d) => `<span class="dw">${d}</span>`).join('');
    for (let i = 0; i < f.getDay(); i++) cells += '<span></span>';
    const rem = remAp();
    for (let d = 1; d <= last.getDate(); d++) {
      const ds = A.iso(new Date(m.getFullYear(), m.getMonth(), d)); const x = dayStatus(ds); const meu = rem && rem.date === ds;
      cells += `<button type="button" class="${V.date === ds ? 'sel' : ''} ${ds === TODAY ? 'hoje' : ''} ${meu ? 'meu' : ''}" data-st="${x.st}" ${x.st === 'fora' ? 'disabled' : `data-a="day" data-d="${ds}"`} aria-label="${longDate(ds)}${x.r ? ', ' + x.r : ''}${meu ? ', seu horário atual' : ''}">${d}${ds === TODAY ? '<small>hoje</small>' : meu ? '<small>atual</small>' : ''}</button>`;
    }
    const next = A.iso(new Date(m.getFullYear(), m.getMonth() + 1, 1));
    return `<div><div class="mes-cab"><button type="button" class="btn-icone" data-a="cm" data-n="-1" ${V.calMonth <= sm ? 'disabled' : ''} aria-label="Mês anterior">${ic('left', 18)}</button><b>${cap(MESES[m.getMonth()])} de ${m.getFullYear()}</b><button type="button" class="btn-icone" data-a="cm" data-n="1" ${next > limit ? 'disabled' : ''} aria-label="Próximo mês">${ic('right', 18)}</button></div><div class="mes">${cells}</div></div>`;
  }
  function blocoHora() {
    const bz = busy(V.date); const sl = daySlots(V.date).filter((x) => !isPast(V.date, x)); const l = escolhidos(); // horários que já passaram nem aparecem
    const livres = sl.filter((x) => !bz.has(x) && !isPast(V.date, x)).length;
    const rem = remAp(); const atual = rem && rem.date === V.date ? rem.time : null;
    const grp = (t, lista) => (lista.length ? `<div><div class="periodo-t">${t}</div><div class="horas">${lista.map((x) => { const oc = bz.has(x), pa = isPast(V.date, x); return `<button type="button" class="hora ${oc ? 'ocup' : ''} ${pa && !oc ? 'passou' : ''} ${V.time === x ? 'sel' : ''} ${atual === x ? 'atual' : ''}" data-a="time" data-t="${x}" aria-label="${x}${oc ? ', ocupado' : pa ? ', já passou' : atual === x ? ', seu horário atual' : ''}">${x}${atual === x ? '<small>atual</small>' : ''}</button>`; }).join('')}</div></div>` : '');
    return `<section class="bloco" id="b-hora">
      <div class="wiz-info"><span class="pilula" data-k="${livres <= 4 ? 'laranja' : 'verde'}">${livres} horário${livres === 1 ? '' : 's'} livre${livres === 1 ? '' : 's'}</span>${l.length ? `<span class="tag">${ic('scissors', 13)}${esc(nomesDe(l))} · ${tempo(durDe(l))}</span>` : ''}
        <div class="legenda"><span data-k="verde"><i></i>Livre</span><span data-k="vermelho"><i></i>Ocupado</span></div></div>
      ${grp('Manhã', sl.filter((x) => A.toMin(x) < 720))}${grp('Tarde', sl.filter((x) => A.toMin(x) >= 720 && A.toMin(x) < 1080))}${grp('Noite', sl.filter((x) => A.toMin(x) >= 1080))}
      ${hasLunch() ? `<div class="wiz-nota">${ic('coffee', 15)}Almoço das ${S.settings.lunchStart} às ${S.settings.lunchEnd}</div>` : ''}
      ${esperaOn() && !rem ? `<button type="button" class="espera-link" data-a="espera" data-d="${V.date}"><span class="ico-k">${ic('bell', 17)}</span><span><b>Nenhum horário serve?</b><small>Entre na lista de espera deste dia. Se vagar, a gente marca e te avisa no WhatsApp.</small></span>${ic('right', 18)}</button>` : ''}</section>`;
  }
  function blocoSvc() {
    const l = escolhidos(); const base = durDe(l);
    // Já escolhido fica marcado; os outros mostram se ainda cabem somados ao que já foi escolhido
    const noFit = S.services.filter((s) => !V.svcs.includes(s.id) && !fits(V.date, V.time, base + s.dur));
    const soma = l.length ? `<div class="svc-soma"><div><small>${l.length === 1 ? '1 serviço escolhido' : `${l.length} serviços escolhidos`}</small><b>${esc(nomesDe(l))}</b><span>${ic('clock', 13)}${tempo(base)} · ${V.time} às ${endOf(V.time, base)}</span></div><b class="preco">${money(precoDe(l))}</b></div>` : '';
    return `<section class="bloco" id="b-svc">${soma}
      ${noFit.length ? `<div class="faixa p" data-t="aviso"><span class="f-ico">${ic('alert', 15)}</span><p><b>${noFit.length === 1 ? '1 serviço não cabe' : `${noFit.length} serviços não cabem`} ${l.length ? 'junto' : `às ${V.time}`}.</b> Eles estão em vermelho.</p></div>` : ''}
      ${S.services.length ? `<div class="servicos multi">${S.services.map((s) => { const on = V.svcs.includes(s.id); const nc = noFit.includes(s); return `<button type="button" class="svc ${on ? 'sel' : ''} ${nc ? 'nao-cabe' : ''}" data-a="svc" data-id="${s.id}" id="s-${s.id}" aria-pressed="${on}">
        <span class="ico-k">${svcIcon(s.name).replace('<svg', '<svg width="20" height="20"')}</span><span class="svc-t"><b>${esc(s.name)}</b><small>${nc ? `${ic('ban', 13)}${l.length ? 'Não cabe junto' : `Não cabe às ${V.time}`}` : on ? `${ic('check', 13)}Escolhido · ${tempo(s.dur)}` : l.length ? `${ic('plus', 13)}Somar · +${tempo(s.dur)}` : `${tempo(s.dur)} · até ${endOf(V.time, s.dur)}`}</small></span>
        <span class="preco">${l.length && !on ? '+ ' : ''}${money(s.price)}</span></button>`; }).join('')}</div>
        <div class="wiz-nota">${ic('plus', 15)}Quer fazer mais de uma coisa? Toque em outro serviço para somar. Toque de novo para tirar.</div>` : '<div class="faixa" data-t="aviso"><span class="f-ico">' + ic('alert', 18) + '</span><div><strong>Nenhum serviço cadastrado</strong><p>A barbearia ainda está montando a lista de serviços.</p></div></div>'}
    </section>`;
  }
  function resumo() {
    const l = escolhidos(); const s = l.length > 0; const dur = durDe(l); const rem = remAp();
    const ln = (i, rot, v, falta) => `<div class="r-linha ${falta ? 'falta' : ''}"><span class="ico-k">${ic(i, 17)}</span><div><small>${rot}</small><b>${v}</b></div></div>`;
    const ok = V.date && V.time && s;
    return `<div class="resumo"><h3><span class="ico-k">${ic(rem ? 'repeat' : 'receipt', 17)}</span>${rem ? 'Seu novo horário' : 'Seu agendamento'}</h3>
      <div class="r-linhas">${ln('cal', 'Dia', V.date ? cap(longDate(V.date)) : 'Falta escolher', !V.date)}${ln('clock', 'Horário', V.time ? (s ? `${V.time} às ${endOf(V.time, dur)} · ${tempo(dur)}` : V.time) : 'Falta escolher', !V.time)}${ln('scissors', l.length > 1 ? 'Serviços' : 'Serviço', s ? esc(l.length > 1 ? `${l.length} serviços` : l[0].name) : 'Falta escolher', !s)}</div>
      ${l.length > 1 ? `<div class="r-itens">${l.map((x) => `<div><span>${esc(x.name)}</span><b class="num">${money(x.price)}</b></div>`).join('')}</div>` : ''}
      <div class="r-total"><span>Total</span><b class="preco">${money(precoDe(l))}</b></div>
      <button type="button" class="btn pri bloco-btn ${ok ? '' : 'apagado'}" data-a="continue">${ic('check', 18)}${rem ? 'Confirmar mudança' : 'Confirmar agendamento'}</button>
      <div class="r-obs">${ic('money', 15)}Pagamento na barbearia, no dia</div></div>`;
  }
  function bookbar() {
    const l = escolhidos(); const ok = V.date && V.time && l.length;
    const txt = ok ? `${shortDate(V.date)} · ${V.time} · ${l.length > 1 ? `${l.length} serviços · ${tempo(durDe(l))}` : l[0].name}` : 'Toque em um ou mais serviços';
    return `<div class="barra-fixa"><div class="txt"><small>${esc(txt)}</small><b class="preco">${money(precoDe(l))}</b></div><button type="button" class="btn pri ${ok ? '' : 'apagado'}" data-a="continue">${ic('check', 17)}${remAp() ? 'Mudar' : 'Confirmar'}</button></div>`;
  }

  // ----- janela "Quem é você?" -----
  function field(id, label, icon, value, err, extra = '') {
    return `<div class="campo"><label for="${id}">${label}</label><div class="entrada ${err ? 'erro' : ''}" id="e-${id}">${ic(icon, 18)}<input id="${id}" ${extra} value="${esc(value)}"></div>${err ? `<div class="erro-campo" role="alert">${ic('alert', 16)}${esc(err)}</div>` : ''}</div>`;
  }
  // Cliente liberado pelo barbeiro para marcar para a família: pergunta para quem é o horário
  const podeFamilia = () => ME && ME.perDay > 1;
  const noDia = (ds) => MYAP.filter((a) => a.date === ds && a.status === 'agendado').length;
  function paraQuem() {
    if (!podeFamilia()) return '';
    const n = noDia(V.date);
    return `<div class="para-q"><span class="lab">Para quem é esse horário?</span>
      <div class="para-op"><button type="button" class="${V.para === 'eu' ? 'on' : ''}" data-a="para" data-v="eu" aria-pressed="${V.para === 'eu'}">${ic('user', 16)}Para mim</button><button type="button" class="${V.para === 'outro' ? 'on' : ''}" data-a="para" data-v="outro" aria-pressed="${V.para === 'outro'}">${ic('users', 16)}Outra pessoa</button></div>
      ${V.para === 'outro' ? field('para-n', 'Nome de quem vai cortar', 'user', V.paraNome || '', V.errs.para, 'placeholder="Ex.: Enzo" maxlength="40" autocomplete="off" data-in="para-n"') : ''}
      <small>${ic('users', 13)}Você pode marcar até <b>${ME.perDay} horários</b> no mesmo dia${n ? ` · já tem ${n} em ${shortDate(V.date)}` : ''}.</small></div>`;
  }
  function sheet(anim) {
    const l = escolhidos(); const espera = V.acao === 'espera' && V.esp;
    const mini = espera ? `<div class="mini-resumo">${ic('bell', 16)}Lista de espera · ${shortDate(V.esp.date)} · ${perTxt(V.esp.per)} · ${esc(nomesDe(escolhidos(V.esp.svcs)))}</div>`
      : l.length && V.date && V.time ? `<div class="mini-resumo">${ic('cal', 16)}${shortDate(V.date)} · ${V.time} às ${endOf(V.time, durDe(l))} · ${esc(nomesDe(l))} · ${money(precoDe(l))}</div>` : '';
    const wait = V.busyAction;
    let t, sub, body;
    if (V.sheet === 'detalhe') return folha(anim, ...sheetDetalhe());
    if (V.sheet === 'espera') return folha(anim, ...sheetEspera());
    if (V.sheet === 'remarca') return folha(anim, ...sheetRemarca());
    if (V.sheet === 'quem') {
      t = 'Quase lá! Quem é você?'; sub = 'Escolha uma opção para finalizar.';
      body = `<div class="opcoes"><button type="button" class="opcao" data-a="who" data-w="cliente"><span class="ico-k">${ic('userok', 24)}</span><div><b>Já sou cliente</b><br><small>Digito meu WhatsApp e pronto</small></div></button>
        <button type="button" class="opcao" data-a="who" data-w="novo"><span class="ico-k">${ic('userplus', 24)}</span><div><b>Primeira vez aqui</b><br><small>Faço um cadastro rapidinho</small></div></button></div>`;
    } else if (V.sheet === 'cliente') {
      t = 'Digite seu WhatsApp'; sub = 'Seu nome aparece sozinho.';
      body = `<form class="form-g" data-f="cliente" novalidate>${field('c-phone', 'Seu WhatsApp', 'phone', maskPhone(V.phone), V.errs.phone, 'inputmode="tel" autocomplete="tel" placeholder="(11) 97425-8136" data-in="c-phone"')}
        ${V.notFound ? `<div class="faixa pisca" data-t="aviso" id="nao-achou"><span class="f-ico">${ic('alert', 18)}</span><div><strong>Não encontramos esse número</strong><p>Confira se digitou certo ou faça seu cadastro em poucos segundos.</p><button type="button" class="btn p" style="margin-top:10px" data-a="to-new">${ic('userplus', 16)}Fazer meu cadastro</button></div></div>` : ''}
        <button type="submit" class="btn pri bloco-btn" ${wait ? 'disabled' : ''}>${wait ? 'Procurando…' : `${ic('arrow', 18)}Continuar`}</button></form>`;
    } else if (V.sheet === 'novo') {
      t = 'Primeira vez aqui? Bem-vindo!'; sub = 'Só precisamos do seu nome e WhatsApp.';
      body = `<form class="form-g" data-f="novo" novalidate>${field('n-name', 'Nome e sobrenome', 'user', V.newName, V.errs.name, 'autocomplete="name" placeholder="Ex.: João Silva" data-in="n-name"')}
        ${field('n-phone', 'WhatsApp com DDD', 'phone', maskPhone(V.newPhone), V.errs.phone, 'inputmode="tel" autocomplete="tel" placeholder="(11) 97425-8136" data-in="n-phone"')}
        <div class="muted" style="font-size:12.5px">Usamos seu WhatsApp só para falar sobre seus horários${espera ? ' e avisar quando vagar' : S.remind && S.remind.on ? ' e mandar o lembrete no dia' : ''}.</div>
        <button type="submit" class="btn verde bloco-btn" ${wait ? 'disabled' : ''}>${wait ? (espera ? 'Entrando na lista…' : 'Agendando…') : `${ic('check', 18)}${espera ? 'Cadastrar e entrar na lista' : 'Cadastrar e confirmar'}`}</button></form>`;
    } else {
      t = 'Tudo certo?'; sub = 'Confira e confirme o seu horário.';
      body = `<div class="achou"><span class="av">${esc(initials(ME.name))}</span><div><small>${V.justId ? 'Encontramos você!' : 'Agendando como'}</small><b>${esc(ME.name)}</b></div></div>
        ${paraQuem()}
        <button type="button" class="btn pri bloco-btn" data-a="confirm" ${wait ? 'disabled' : ''}>${wait ? 'Agendando…' : `${ic('check', 18)}Confirmar agendamento`}</button>
        <div class="muted" style="font-size:12.5px;text-align:center">Pagamento na barbearia, no dia do atendimento.</div>
        <button type="button" class="link" style="align-self:center" data-a="notme">Não é ${esc(first(ME.name))}? Trocar</button>`;
    }
    const back = ['cliente', 'novo'].includes(V.sheet) ? `<button type="button" class="link" style="align-self:flex-start" data-a="who" data-w="">${ic('left', 16)}Voltar</button>`
      : V.sheet === 'quem' && espera ? `<button type="button" class="link" style="align-self:flex-start" data-a="espera-volta">${ic('left', 16)}Voltar</button>` : '';
    return folha(anim, t, sub, mini + body + back);
  }
  function folha(anim, t, sub, body, cls = '') {
    return `<div class="overlay ${anim ? 'nova' : ''}" data-a="sheet-close"></div><div class="folha ${cls} ${anim ? 'nova' : ''}" role="dialog" aria-modal="true" aria-label="${esc(t)}"><span class="alca"></span>
      <div class="folha-topo"><div><h3>${t}</h3>${sub ? `<p class="sub">${sub}</p>` : ''}</div><button type="button" class="btn-icone" data-a="sheet-close" aria-label="Fechar">${ic('x', 18)}</button></div>
      ${body}</div>`;
  }

  // ===== Detalhes de um horário (Meus horários): ver tudo, mudar dia/hora ou cancelar =====
  function sheetDetalhe() {
    const a = MYAP.find((x) => String(x.id) === String(V.detalhe));
    if (!a) { V.sheet = null; return ['', '', '']; }
    const fut = a.status === 'agendado' && !isPast(a.date, a.time);
    const d = A.parse(a.date); const dd = daysTo(a.date); const it = itensAp(a);
    const pil = fut ? `<span class="pilula viva" data-k="verde">${dd === 0 ? 'É hoje' : dd === 1 ? 'É amanhã' : 'Confirmado'}</span>`
      : a.status === 'faltou' ? '<span class="pilula" data-k="vermelho">Não compareceu</span>' : a.status === 'realizado' ? '<span class="pilula" data-k="verde">Atendido</span>' : '<span class="pilula" data-k="cinza">Já passou</span>';
    const addr = (S.settings.address || '').trim();
    const lemb = fut && S.remind && S.remind.on ? (a.remind && a.remind.status === 'enviado' ? 'Lembrete já enviado no seu WhatsApp.' : `Você recebe um lembrete no WhatsApp ${antes(S.remind.min)}.`) : '';
    const body = `<div class="det-quando"><div class="cal-g"><small>${DOW[d.getDay()]}</small><b>${d.getDate()}</b><small>${MESES[d.getMonth()].slice(0, 3)}</small></div>
        <div style="min-width:0"><b>${cap(longDate(a.date))}</b><span>${ic('clock', 14)}${a.time} às ${endOf(a.time, a.dur)} · ${tempo(a.dur)}</span></div>${pil}</div>
      ${a.forName ? `<div class="det-l">${ic('users', 16)}<span>Para <b>${esc(a.forName)}</b></span></div>` : ''}
      ${a.origin === 'espera' ? `<div class="faixa fina" data-t="ok"><span class="f-ico">${ic('bell', 15)}</span><p>Esse horário veio da <b>lista de espera</b>: vagou e a gente marcou para você.</p></div>` : ''}
      <div class="det-conta"><small>${it.length > 1 ? 'Serviços' : 'Serviço'}</small>${it.map((x) => `<div><span>${esc(x.name)}</span><b class="num">${money(x.price)}</b></div>`).join('')}
        ${a.discount ? `<div class="desc"><span>Desconto</span><b class="num">− ${money(a.discount)}</b></div>` : ''}<div class="tot"><span>${fut ? 'Total, pago na barbearia' : 'Total'}</span><b class="preco">${money(a.price)}</b></div></div>
      ${lemb ? `<div class="det-l">${ic('whats', 16)}<span>${lemb}</span></div>` : ''}
      ${fut && addr ? `<a class="det-l link-l" href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(addr)}" target="_blank" rel="noopener">${ic('pin', 16)}<span>${esc(addr)}</span>${ic('right', 16)}</a>` : ''}
      ${fut ? (String(V.cancelAsk) === String(a.id) ? `<div class="faixa pisca" data-t="erro"><span class="f-ico">${ic('alert', 18)}</span><div><strong>Cancelar esse horário?</strong><p>A vaga fica livre para outra pessoa. Se quiser só trocar o dia ou a hora, use <b>Mudar dia ou horário</b>.</p><div class="acoes" style="margin-top:10px"><button type="button" class="btn p" style="background:var(--vermelho);border-color:var(--vermelho);color:#fff" data-a="cancel-yes" data-id="${a.id}" ${V.busyAction ? 'disabled' : ''}>Sim, cancelar</button><button type="button" class="btn p" data-a="cancel-no">Manter horário</button></div></div></div>`
        : `<div class="det-acoes"><button type="button" class="btn pri bloco-btn" data-a="rem" data-id="${a.id}">${ic('repeat', 18)}Mudar dia ou horário</button>
          <div class="duas-b">${S.settings.phone ? `<a class="btn" href="${waLink(`Olá! Tenho horário ${diaCurto(a.date)} às ${a.time} (${a.service}).`)}" target="_blank" rel="noopener">${ic('whats', 16)}Falar com a barbearia</a>` : ''}<button type="button" class="btn verm" data-a="cancel" data-id="${a.id}">${ic('x', 16)}Cancelar horário</button></div></div>`) : ''}`;
    return [fut ? 'Seu horário' : 'Horário passado', fut ? 'Tudo sobre o seu agendamento.' : '', body];
  }
  const diaCurto = (ds) => `${DOW[A.parse(ds).getDay()].toLowerCase()}, ${shortDate(ds)}`;

  // ===== Confirmar a mudança de horário: antes e depois =====
  function sheetRemarca() {
    const r = remAp(); const l = escolhidos(); const dur = durDe(l);
    if (!r || !l.length) { V.sheet = null; return ['', '', '']; }
    const wait = V.busyAction;
    const body = `<div class="rem-troca"><div class="rem-de"><small>Antes</small><b>${cap(diaCurto(r.date))} · ${r.time}</b><span>${esc(r.service)}</span></div>
        <span class="rem-seta">${ic('arrow', 18)}</span>
        <div class="rem-para"><small>Agora</small><b>${cap(diaCurto(V.date))} · ${V.time} às ${endOf(V.time, dur)}</b><span>${esc(nomesDe(l))} · ${money(precoDe(l))}</span></div></div>
      <div class="muted" style="font-size:12.5px">O horário antigo fica livre para outra pessoa. A barbearia é avisada da mudança${S.remind && S.remind.on ? ' e o lembrete no WhatsApp vai no horário novo' : ''}.</div>
      <button type="button" class="btn pri bloco-btn" data-a="rem-ok" ${wait ? 'disabled' : ''}>${wait ? 'Mudando…' : `${ic('check', 18)}Sim, mudar meu horário`}</button>
      <button type="button" class="link" style="align-self:center" data-a="sheet-close">Voltar e escolher outro</button>`;
    return ['Mudar seu horário?', 'Confira antes de confirmar.', body];
  }

  // ===== Lista de espera: dia lotado ou nenhum horário serve =====
  function sheetEspera() {
    const e = V.esp; const ds = e.date; const wait = V.busyAction;
    const sl = daySlots(ds);
    const pers = PERIODOS.filter(([k]) => k === 'qualquer' || sl.some((t) => noPeriodo(t, k) && !isPast(ds, t)));
    const l = escolhidos(e.svcs); const lotado = dayStatus(ds).st === 'lotado';
    const ja = MYESP.find((x) => x.date === ds);
    const body = `<div class="faixa" data-t="ok"><span class="f-ico">${ic('bell', 18)}</span><div><strong>Se alguém desistir, o horário é seu</strong><p>A gente marca sozinho para o primeiro da fila e avisa no seu WhatsApp. Você não precisa ficar olhando o site.</p></div></div>
      <div class="campo"><span class="lab">Que horas você pode?</span><div class="esp-chips">${pers.map(([k, r]) => `<button type="button" class="chip ${e.per === k ? 'on' : ''}" data-a="esp-per" data-v="${k}" aria-pressed="${e.per === k}">${r}</button>`).join('')}</div></div>
      <div class="campo" id="e-esp-svc"><span class="lab">O que vai fazer? <span class="muted" style="font-weight:500">· pode somar</span></span><div class="esp-svcs">${S.services.map((s) => { const on = e.svcs.includes(s.id); return `<button type="button" class="esp-svc ${on ? 'on' : ''}" data-a="esp-svc" data-id="${s.id}" aria-pressed="${on}"><span class="ck">${on ? ic('check', 13) : ''}</span><span>${esc(s.name)}<small>${tempo(s.dur)}</small></span><b class="num">${money(s.price)}</b></button>`; }).join('')}</div>
        ${l.length ? `<div class="esp-tot"><span>${l.length > 1 ? `${l.length} serviços · ` : ''}${tempo(durDe(l))}</span><b class="preco">${money(precoDe(l))}</b></div>` : ''}</div>
      ${ja ? `<div class="faixa fina" data-t="aviso"><span class="f-ico">${ic('alert', 15)}</span><p>Você já está na fila desse dia (${ord(ja.pos)} lugar). Entrar de novo troca o pedido antigo.</p></div>` : ''}
      ${ME ? `<div class="achou"><span class="av">${esc(initials(ME.name))}</span><div><small>Entrando como</small><b>${esc(ME.name)}</b></div></div>
        <button type="button" class="btn pri bloco-btn" data-a="esp-ok" ${wait ? 'disabled' : ''}>${wait ? 'Entrando na lista…' : `${ic('bell', 18)}Entrar na lista de espera`}</button>`
        : `<button type="button" class="btn pri bloco-btn" data-a="esp-ok">${ic('arrow', 18)}Continuar</button>`}`;
    return ['Lista de espera', `${cap(longDate(ds))}${lotado ? ' está lotado' : ''}.`, body];
  }

  /** Texto do lembrete: "1 hora antes", "30 minutos antes"… */
  const antes = (m) => (m < 60 ? `${m} minutos antes` : m === 60 ? '1 hora antes' : m % 60 ? `${Math.floor(m / 60)}h${m % 60} antes` : `${m / 60} horas antes`);
  function avisoLembrete() {
    if (!S.remind || !S.remind.on) return '';
    return `<div class="faixa lembrete" data-t="ok"><span class="f-ico">${ic('whats', 18)}</span><div><strong>Você vai receber um lembrete no WhatsApp</strong><p>No dia do horário, ${antes(S.remind.min)}.${S.remind.phone ? ` Salve nosso número <b>${maskPhone(S.remind.phone)}</b> para a mensagem chegar certinho.` : ''}</p></div></div>`;
  }

  // ===== Agendado! =====
  function vOk() {
    const a = MYAP.find((x) => String(x.id) === String(V.lastBooking)); if (!a) return vHome();
    const ln = (i, rot, v) => `<div class="r-linha"><span class="ico-k">${ic(i, 17)}</span><div><small>${rot}</small><b>${v}</b></div></div>`;
    const it = itensAp(a); const ant = V.antes;
    return `<div class="sucesso"><div class="check-grande">${ic(ant ? 'repeat' : 'check', 52)}</div>
      <div><h1>${ant ? 'Horário alterado!' : 'Horário confirmado!'}</h1><p>${ant ? `Pronto, ${esc(first(ME.name))}. Seu horário de <s>${diaCurto(ant.date)} às ${ant.time}</s> agora é o de baixo.` : `Te esperamos, ${esc(first(ME.name))}. Se não puder vir, mude ou cancele em <b>Meus horários</b> para liberar a vaga.`}</p></div>
      <div class="ticket">${ln('cal', 'Dia', cap(longDate(a.date)))}${ln('clock', 'Horário', `${a.time} às ${endOf(a.time, a.dur)}`)}${a.forName ? ln('users', 'Para quem', esc(a.forName)) : ''}${it.length > 1 ? `<div class="r-linha largo"><span class="ico-k">${ic('scissors', 17)}</span><div><small>Serviços</small><b>${esc(it.map((x) => x.name).join(', '))}</b></div></div>` : ln('scissors', 'Serviço', esc(a.service))}${ln('money', 'Valor (pago na barbearia)', money(a.price))}</div>
      ${avisoLembrete()}
      <div class="acoes"><button type="button" class="btn pri" data-a="tab" data-t="horarios">${ic('clock', 17)}Ver meus horários</button><button type="button" class="btn" data-a="again">${ic('plus', 17)}Agendar outro</button></div></div>`;
  }

  // ===== Entrar com o WhatsApp =====
  function entry(title, sub) {
    return `<div class="pagina-t"><h1>${title}</h1><p>${sub}</p></div>
      <form class="cartao entrar" data-f="entry" novalidate><div class="vazio" style="padding:10px 0 18px"><span class="ico-k">${ic('phone', 26)}</span><h4>Entre com seu WhatsApp</h4><p>Use o número que você usou para agendar. Não precisa de senha.</p></div>
        <div class="form-g">${field('e-phone', 'WhatsApp', 'phone', maskPhone(V.phone), V.errs.entry, 'inputmode="tel" autocomplete="tel" placeholder="(11) 97425-8136" data-in="c-phone"')}
        <button type="submit" class="btn pri bloco-btn" ${V.busyAction ? 'disabled' : ''}>${V.busyAction ? 'Procurando…' : `${ic('arrow', 18)}Entrar`}</button></div></form>`;
  }

  // ===== Meus horários =====
  function vHorarios() {
    if (!ME) return entry('Meus horários', 'Veja e cancele seus agendamentos.');
    const next = sortAp(MYAP.filter((a) => a.status === 'agendado' && !isPast(a.date, a.time)));
    const past = sortAp(MYAP.filter((a) => !next.includes(a))).reverse().slice(0, 8);
    const card = (a, fut) => {
      const d = A.parse(a.date); const dd = daysTo(a.date);
      const pil = fut ? '<span class="pilula viva" data-k="verde">Confirmado</span>'
        : a.status === 'faltou' ? '<span class="pilula" data-k="vermelho">Não compareceu</span>'
        : a.status === 'realizado' ? '<span class="pilula" data-k="verde">Atendido</span>' : '<span class="pilula" data-k="cinza">Já passou</span>';
      let extra = '';
      if (fut) {
        const lemb = S.remind && S.remind.on ? (a.remind && a.remind.status === 'enviado' ? ' · lembrete enviado no WhatsApp' : ` · lembrete no WhatsApp ${antes(S.remind.min)}`) : '';
        extra = `<div class="faixa p"><span class="f-ico">${ic('clock', 15)}</span><p>${dd === 0 ? '<b>É hoje!</b>' : dd === 1 ? '<b>É amanhã!</b>' : `Faltam <b>${dd} dias</b>`} · ${money(a.price)} na barbearia${lemb}</p></div>
          <div class="acoes ag-c-acoes"><button type="button" class="btn p" data-a="rem" data-id="${a.id}">${ic('repeat', 16)}Mudar horário</button><button type="button" class="btn p" data-a="det" data-id="${a.id}">${ic('list', 16)}Ver detalhes</button></div>`;
      }
      const tags = `${a.forName ? ` <span class="para-quem">para ${esc(a.forName)}</span>` : ''}${a.origin === 'espera' && fut ? ` <span class="para-quem esp">${ic('bell', 11)}da lista de espera</span>` : ''}`;
      return `<div class="ag-c ${fut ? '' : 'velho'}"><button type="button" class="topo ag-c-abre" data-a="det" data-id="${a.id}" aria-label="Ver detalhes do horário de ${longDate(a.date)} às ${a.time}"><div class="quando"><div class="cal ${fut ? '' : 'velho'}"><small>${MESES[d.getMonth()].slice(0, 3)}</small><b>${d.getDate()}</b></div><div style="min-width:0"><h4>${esc(a.service)}${tags}</h4><p>${cap(DOWL[d.getDay()])} · ${a.time} às ${endOf(a.time, a.dur)}</p></div></div>${pil}</button>${extra}</div>`;
    };
    // Pedidos na lista de espera: posição na fila e botão para sair
    const espCard = (e) => {
      const d = A.parse(e.date); const l = (e.items || []);
      return `<div class="ag-c esp-c"><div class="topo"><div class="quando"><div class="cal esp"><small>${MESES[d.getMonth()].slice(0, 3)}</small><b>${d.getDate()}</b></div><div style="min-width:0"><h4>${esc(l.map((x) => x.name).join(' + ') || 'Lista de espera')}</h4><p>${cap(DOWL[d.getDay()])} · ${perTxt(e.period).toLowerCase()}</p></div></div><span class="pilula" data-k="laranja">${ord(e.pos)} da fila</span></div>
        <div class="faixa p"><span class="f-ico">${ic('bell', 15)}</span><p>Se vagar um horário ${e.period === 'qualquer' ? 'nesse dia' : `de ${perTxt(e.period).toLowerCase()}`}, a gente marca e te avisa no WhatsApp.</p></div>
        ${String(V.espSai) === String(e.id) ? `<div class="confirma-l"><span>Sair da lista de espera?</span><div class="acoes"><button type="button" class="btn p verm" data-a="esp-sai-ok" data-id="${e.id}" ${V.busyAction ? 'disabled' : ''}>Sim, sair</button><button type="button" class="btn p" data-a="esp-sai-no">Ficar na fila</button></div></div>`
          : `<div class="acoes"><button type="button" class="btn p" data-a="esp-sai" data-id="${e.id}">${ic('x', 16)}Sair da lista</button></div>`}</div>`;
    };
    return `<div class="pagina-t"><h1>Meus horários</h1><p>Olá, ${esc(first(ME.name))}! Toque em um horário para ver os detalhes, mudar ou cancelar.</p></div>
      <div class="secao-t">${ic('cal', 20)}Próximos <small>${next.length}</small></div>
      ${next.length ? `<div class="lista-cards">${next.map((a) => card(a, true)).join('')}</div>` : `<div class="cartao"><div class="vazio"><span class="ico-k">${ic('cal', 26)}</span><h4>Nenhum horário marcado</h4><p>Que tal agendar o próximo corte?</p><button type="button" class="btn pri" data-a="tab" data-t="agendar">${ic('plus', 17)}Agendar agora</button></div></div>`}
      ${MYESP.length ? `<div class="secao-t" style="margin-top:26px">${ic('bell', 20)}Lista de espera <small>${MYESP.length}</small></div><div class="lista-cards">${MYESP.map(espCard).join('')}</div>` : ''}
      ${past.length ? `<div class="secao-t" style="margin-top:26px">${ic('list', 20)}Últimas visitas <small>${past.length}</small></div><div class="lista-cards">${past.map((a) => card(a, false)).join('')}</div>` : ''}`;
  }

  // ===== Perfil =====
  function vPerfil() {
    if (!ME) return entry('Meu perfil', 'Seus dados de contato.');
    const done = MYAP.filter((a) => a.status === 'realizado').length;
    const since = A.parse(ME.since);
    return `<div class="perfil-c"><div class="perfil-topo"><span class="av">${esc(initials(ME.name))}</span><div><b>${esc(ME.name)}</b><small>Cliente desde ${MESES[since.getMonth()]} de ${since.getFullYear()} · ${done} visita${done === 1 ? '' : 's'}</small></div></div>
      <form class="cartao form-g" data-f="perfil" novalidate><div class="cartao-topo" style="margin:0"><h3><span class="ico-k">${ic('user', 17)}</span>Meus dados</h3></div>
        ${field('p-name', 'Nome e sobrenome', 'user', V.pName ?? ME.name, V.errs.name, 'autocomplete="name" data-in="p-name"')}
        ${field('p-wa', 'WhatsApp', 'phone', maskPhone(V.pPhone ?? ME.phone), V.errs.phone, 'inputmode="tel" autocomplete="tel" data-in="p-wa"')}
        <div class="acoes"><button type="submit" class="btn pri" ${V.busyAction ? 'disabled' : ''}>${ic('check', 17)}Salvar alterações</button><button type="button" class="btn" data-a="logout">${ic('out', 17)}${MOBILE.matches ? 'Sair deste celular' : 'Sair deste computador'}</button></div></form></div>`;
  }

  // ----- ações -----
  async function run(fn) {
    if (V.busyAction) return;
    V.busyAction = true; render(true);
    try { await fn(); } catch (e) { alerta('erro', 'Não deu certo', e.message); }
    V.busyAction = false; render(true);
  }
  function pickDay(ds, el) {
    const x = dayStatus(ds); const d = A.parse(ds);
    if (x.st === 'fechado') { alerta('aviso', `A barbearia não abre ${plural(d.getDay())}`, 'Escolha outro dia na faixa.'); marcar(el, 'aviso'); return; }
    if (x.st === 'folga') { alerta('aviso', 'Barbearia fechada nesse dia', `${x.why ? x.why + '. ' : ''}Escolha outro dia.`); marcar(el, 'aviso'); return; }
    if (x.st === 'lotado') {
      // Com a lista de espera ligada, o dia lotado abre a fila; senão, sugere outros dias
      if (esperaOn() && !remAp()) { abrirEspera(ds); return; }
      const alt = [];
      for (let i = 1; i < 30 && alt.length < 2; i++) { const s = A.iso(A.addDays(d, i)); if (!inWindow(s)) break; if (['livre', 'poucas'].includes(dayStatus(s).st)) alt.push(s); }
      alerta('erro', 'Esse dia está lotado', `Todos os horários de ${shortDate(ds)} já foram reservados.${alt.length ? ' Dias com vaga:' : ''}`, alt.map((s) => ({ r: `Ver ${DOW[A.parse(s).getDay()].toLowerCase()} ${shortDate(s)}`, fn: () => pickDay(s) })));
      marcar(el); return;
    }
    V.date = ds; V.time = null; V.calMonth = ds.slice(0, 8) + '01';
    V.step = 2; V.stepDir = 1; render();
  }
  function pickTime(t, el) {
    if (isPast(V.date, t)) { alerta('aviso', 'Esse horário já passou', `Agora são ${A.fromMin(nowMin())}. Escolha um horário mais tarde.`); marcar(el, 'aviso'); return; }
    if (busy(V.date).has(t)) {
      const sug = suggest(V.date, A.STEP, t);
      alerta('erro', `O horário das ${t} já está ocupado`, sug.length ? 'Esses horários perto dele estão livres:' : 'Não sobrou horário livre nesse dia. Tente outro dia.', sug.map((x) => ({ r: x, fn: () => pickTime(x) })));
      marcar(el); return;
    }
    V.time = t;
    const l = escolhidos();
    if (l.length && !fits(V.date, t, durDe(l))) {
      V.svcs = []; V.step = 3; V.stepDir = 1; render();
      alerta('aviso', `${l.length > 1 ? 'Os serviços escolhidos não cabem' : `${l[0].name} não cabe`} às ${t}`, `Tiramos ${l.length > 1 ? 'eles' : 'esse serviço'} da sua escolha. Escolha de novo ou volte e pegue outro horário.`);
      marcar('#b-svc', 'aviso'); return;
    }
    V.step = 3; V.stepDir = 1; render();
  }
  /** Toca num serviço: soma ao que já foi escolhido, ou tira se já estava. */
  function pickSvc(id) {
    const s = svcById(id); if (!s) return;
    if (V.svcs.includes(s.id)) { V.svcs = V.svcs.filter((x) => x !== s.id); render(true); return; }
    if (V.svcs.length >= MAX_SVCS) { alerta('aviso', `Até ${MAX_SVCS} serviços por horário`, 'Para mais coisas, fale com a barbearia pelo WhatsApp.'); marcar('#s-' + s.id, 'aviso'); return; }
    if (!V.date || !V.time) {
      V.svcs = [s.id]; V.step = !V.date ? 1 : 2; render(true);
      alerta('info', `${s.name} escolhido`, `Agora escolha ${!V.date ? 'o dia e o horário' : 'o horário'}. A gente confere se ele cabe.`, [], 5000);
      marcar(!V.date ? '#b-dia' : '#b-hora', 'aviso'); return;
    }
    const l = escolhidos(); const junto = l.length > 0; const dur = durDe(l) + s.dur; const nome = junto ? `${nomesDe(l)} + ${s.name}` : `O ${s.name}`;
    if (!fits(V.date, V.time, dur)) {
      const r = whyNot(V.date, V.time, dur) || { m: 'ocupado' }; const sug = suggest(V.date, dur, V.time);
      const leva = `${junto ? `Juntos, ${nomesDe([...l, s]).toLowerCase()} levam` : `${nome} leva`} ${tempo(dur)}`;
      const motivo = r.m === 'fecha' ? `${leva} e terminaria${junto ? 'm' : ''} às ${endOf(V.time, dur)}, depois que a barbearia fecha (${A.dayHours(S.settings, A.parse(V.date).getDay()).close}).`
        : r.m === 'almoco' ? `${leva} e entraria${junto ? 'm' : ''} no horário de almoço (${S.settings.lunchStart} às ${S.settings.lunchEnd}).`
        : `${leva}, mas${r.t ? ` às ${r.t}` : ' logo depois'} já tem outro cliente.`;
      alerta('erro', junto ? `Não cabe somar ${s.name} às ${V.time}` : `Esse serviço não cabe às ${V.time}`, motivo + (sug.length ? ` Horários em que ${junto ? 'tudo cabe' : 'ele cabe'}:` : ' Nesse dia não sobrou espaço. Tente outro dia.'),
        sug.map((x) => ({ r: x, fn: () => { V.time = x; V.svcs = [...V.svcs, s.id]; render(true); alerta('ok', `Pronto! Às ${x}`, `${nomesDe(escolhidos())}. Agora é só confirmar.`); } })));
      marcar('#s-' + s.id); return;
    }
    V.svcs = [...V.svcs, s.id]; render(true);
    if (junto) alerta('ok', `${s.name} somado`, `Agora são ${V.svcs.length} serviços: ${tempo(dur)}, até ${endOf(V.time, dur)}.`, [], 3500);
  }
  function goConfirm() {
    if (!V.date) { V.step = 1; render(true); alerta('aviso', 'Falta escolher o dia', 'Toque em um dia com vaga.'); marcar('#b-dia', 'aviso'); return; }
    if (!V.time) { V.step = 2; render(true); alerta('aviso', 'Falta escolher o horário', 'Toque em um horário livre.'); marcar('#b-hora', 'aviso'); return; }
    if (!escolhidos().length) { V.step = 3; render(true); alerta('aviso', 'Falta escolher o serviço', 'Toque em um ou mais serviços da lista.'); marcar('#b-svc', 'aviso'); return; }
    V.errs = {}; V.notFound = false; V.justId = false; V.acao = 'agendar';
    const r = remAp();
    if (r) {
      const mesmo = r.date === V.date && r.time === V.time && itensAp(r).map((x) => String(x.serviceId)).sort().join() === [...V.svcs].map(String).sort().join();
      if (mesmo) { alerta('aviso', 'Esse já é o seu horário', 'Escolha outro dia, outra hora ou mude os serviços.'); return; }
      V.sheet = 'remarca'; render(true); return;
    }
    V.para = ME && noDia(V.date) ? 'outro' : 'eu';
    V.sheet = ME ? 'confirma' : 'quem'; render(true);
  }
  /** Começa a mudar um horário: volta para o passo 1 com os mesmos serviços já escolhidos. */
  function comecaRemarca(id) {
    const a = MYAP.find((x) => String(x.id) === String(id)); if (!a) return;
    const ids = itensAp(a).map((x) => String(x.serviceId)).filter((x) => svcById(x));
    Object.assign(V, { remarca: a.id, svcs: ids, date: null, time: null, step: 1, stepDir: 1, sheet: null, cancelAsk: null, tab: 'agendar', done: false, calMonth: a.date.slice(0, 8) + '01' });
    loadBusy().then(() => { if (V.tab === 'agendar') render(true); }).catch(() => {});
    render();
    alerta('info', 'Escolha o novo dia', `Seu horário de ${diaCurto(a.date)} às ${a.time} continua guardado até você confirmar.`, [], 5000);
  }
  function largaRemarca() { Object.assign(V, { remarca: null, date: null, time: null, svcs: [], step: 1 }); }
  function abrirEspera(ds) {
    const svcs = V.svcs.length ? [...V.svcs] : [];
    V.esp = { date: ds, per: 'qualquer', svcs }; V.acao = 'espera'; V.errs = {}; V.sheet = 'espera'; render(true);
  }
  function focusSheet() { setTimeout(() => { const i = document.querySelector('.folha input'); if (i && !MOBILE.matches) i.focus(); }, 60); }

  async function book() {
    const body = { date: V.date, time: V.time, serviceIds: [...V.svcs], serviceId: V.svcs[0] };
    if (!ME) { body.name = A.tidyName(V.newName); body.phone = digits(V.newPhone); }
    if (podeFamilia() && V.para === 'outro') {
      const nome = String(V.paraNome || '').trim().replace(/\s+/g, ' ');
      if (nome.length < 2) { V.errs = { para: 'Digite o nome de quem vai cortar.' }; render(true); alerta('aviso', 'Para quem é o horário?', 'Digite o nome de quem vai cortar, ou escolha "Para mim".'); marcar('#e-para-n', 'aviso'); return; }
      body.forName = nome;
    }
    const dev = deviceId();
    try {
      const d = await api('POST', '/api/public/agendar', body, { ...authH(), ...(dev ? { 'X-Device': dev } : {}) });
      store.set(TOKEN_KEY, d.token);
      await Promise.all([loadMe(), loadBusy()]);
      Object.assign(V, { lastBooking: d.appointment.id, sheet: null, tab: 'ok', newName: '', newPhone: '', paraNome: '', done: true, errs: {}, antes: null });
      setTimeout(() => alerta('ok', 'Agendado com sucesso!', `${cap(longDate(d.appointment.date))} às ${d.appointment.time}. Te esperamos!`), 50);
    } catch (err) {
      if (err.status === 409) {
        await loadBusy().catch(() => {});
        const l = escolhidos(); const t = V.time; V.sheet = null; V.time = null; V.step = 2;
        const sug = l.length ? suggest(V.date, durDe(l), t) : [];
        setTimeout(() => {
          alerta('erro', 'Esse horário acabou de ser reservado', `${err.message}${sug.length ? ' Horários livres perto dele:' : ''}`, sug.map((x) => ({ r: x, fn: () => { V.time = x; V.step = 3; render(true); alerta('ok', `Pronto! Agora é ${x}`, 'Confira e toque em Confirmar.'); } })));
          marcar('#b-hora');
        }, 50);
        return;
      }
      if (err.status === 401) { store.set(TOKEN_KEY, null); ME = null; MYAP = []; V.sheet = 'quem'; setTimeout(() => alerta('aviso', 'Entre de novo', err.message), 50); return; }
      if (err.code === 'limite_dia' && S.settings.phone) {
        // Quer marcar para os filhos também? O barbeiro libera na ficha dele.
        const msg = `Olá! Sou ${ME ? ME.name : 'cliente'} e quero marcar mais de um horário no mesmo dia (para mim e para minha família). Pode liberar para mim?`;
        V.sheet = null;
        setTimeout(() => alerta('aviso', 'Você já tem horário nesse dia', `${err.message} Vai marcar para outra pessoa da família? Peça para a barbearia liberar.`, [{ r: 'Pedir pelo WhatsApp', fn: () => window.open(waLink(msg), '_blank', 'noopener') }], 9000), 50);
        return;
      }
      setTimeout(() => alerta('erro', 'Não foi possível agendar', err.message), 50);
    }
  }

  /** Muda o dia/hora (e os serviços) de um horário já marcado. */
  async function remarcar() {
    const r = remAp(); if (!r) return;
    try {
      const d = await api('POST', `/api/public/me/agendamentos/${r.id}/remarcar`, { date: V.date, time: V.time, serviceIds: [...V.svcs] }, authH());
      const antes = { date: r.date, time: r.time };
      await Promise.all([loadMe(), loadBusy()]);
      Object.assign(V, { lastBooking: d.appointment.id, sheet: null, tab: 'ok', done: true, errs: {}, remarca: null, antes });
      setTimeout(() => alerta('ok', 'Horário alterado!', `Agora é ${diaCurto(d.appointment.date)} às ${d.appointment.time}. A barbearia já sabe.`), 50);
    } catch (err) {
      if (err.status === 409) {
        await loadBusy().catch(() => {});
        const l = escolhidos(); const t = V.time; V.sheet = null; V.time = null; V.step = 2;
        const sug = l.length ? suggest(V.date, durDe(l), t) : [];
        setTimeout(() => { alerta('erro', 'Esse horário acabou de ser reservado', `${err.message}${sug.length ? ' Horários livres perto dele:' : ''}`, sug.map((x) => ({ r: x, fn: () => { V.time = x; V.step = 3; render(true); } }))); marcar('#b-hora'); }, 50);
        return;
      }
      V.sheet = null;
      setTimeout(() => alerta('erro', 'Não deu para mudar o horário', err.message), 50);
    }
  }
  /** Entra na lista de espera de um dia (com o cadastro, se for a primeira vez). */
  async function entrarEspera() {
    const e = V.esp; if (!e) return;
    const body = { date: e.date, period: e.per, serviceIds: [...e.svcs] };
    if (!ME) { body.name = A.tidyName(V.newName); body.phone = digits(V.newPhone); }
    const dev = deviceId();
    try {
      const d = await api('POST', '/api/public/espera', body, { ...authH(), ...(dev ? { 'X-Device': dev } : {}) });
      store.set(TOKEN_KEY, d.token);
      await loadMe();
      Object.assign(V, { sheet: null, esp: null, acao: 'agendar', tab: 'horarios', newName: '', newPhone: '', errs: {} });
      setTimeout(() => alerta('ok', 'Você está na lista de espera', `Você é o ${ord(d.espera.pos)} da fila de ${diaCurto(d.espera.date)}. Se vagar, a gente marca e te avisa no WhatsApp.`, [], 7000), 50);
    } catch (err) {
      if (err.status === 401) { store.set(TOKEN_KEY, null); ME = null; MYAP = []; MYESP = []; V.sheet = 'quem'; setTimeout(() => alerta('aviso', 'Entre de novo', err.message), 50); return; }
      setTimeout(() => alerta('erro', 'Não deu para entrar na lista', err.message), 50);
    }
  }
  function confirmaEspera() {
    const e = V.esp; if (!e) return;
    if (!e.svcs.length) { alerta('aviso', 'O que você vai fazer?', 'Escolha pelo menos um serviço. Assim a gente sabe quanto tempo precisa vagar.'); marcar('#e-esp-svc', 'aviso'); return; }
    if (ME) { run(entrarEspera); return; }
    V.acao = 'espera'; V.sheet = 'quem'; render(true);
  }

  function submitForm(f) {
    if (f === 'cliente') {
      const pe = A.phoneError(V.phone);
      if (pe) { V.errs = { phone: pe }; V.notFound = false; render(true); alerta('erro', 'Confira seu WhatsApp', pe); marcar('#e-c-phone'); return; }
      V.errs = {}; V.notFound = false;
      run(async () => {
        try {
          const d = await api('POST', '/api/public/identificar', { phone: V.phone });
          store.set(TOKEN_KEY, d.token); ME = d.client; await loadMe();
          V.justId = true; V.sheet = V.acao === 'espera' ? 'espera' : 'confirma';
        } catch (err) {
          if (err.status !== 404) throw err;
          V.notFound = true;
          setTimeout(() => { alerta('aviso', 'Não encontramos esse número', 'Confira se digitou certo ou faça seu cadastro.', [{ r: 'Fazer meu cadastro', fn: toNew }]); marcar('#nao-achou', 'aviso'); }, 30);
        }
      });
      return;
    }
    if (f === 'novo') {
      const ne = A.nameError(V.newName), pe = A.phoneError(V.newPhone);
      if (ne || pe) { V.errs = { name: ne, phone: pe }; render(true); alerta('erro', 'Confira seus dados', ne || pe); marcar(ne ? '#e-n-name' : '#e-n-phone'); return; }
      V.errs = {}; V.newName = A.tidyName(V.newName);
      run(V.acao === 'espera' ? entrarEspera : book);
      return;
    }
    if (f === 'entry') {
      const pe = A.phoneError(V.phone);
      if (pe) { V.errs = { entry: pe }; render(true); alerta('erro', 'Confira seu WhatsApp', pe); marcar('#e-e-phone'); return; }
      V.errs = {};
      run(async () => {
        try {
          const d = await api('POST', '/api/public/identificar', { phone: V.phone });
          store.set(TOKEN_KEY, d.token); await loadMe();
          setTimeout(() => alerta('ok', `Olá, ${first(ME.name)}!`, 'Você entrou. Seus horários estão aqui.'), 30);
        } catch (err) {
          if (err.status !== 404) throw err;
          setTimeout(() => { alerta('aviso', 'Não achamos esse número', 'Confira se digitou certo. Se é sua primeira vez, o cadastro é feito no primeiro agendamento.', [{ r: 'Agendar agora', fn: () => goTab('agendar') }]); marcar('#e-e-phone', 'aviso'); }, 30);
        }
      });
      return;
    }
    if (f === 'perfil') {
      const name = A.tidyName(V.pName ?? ME.name), phone = digits(V.pPhone ?? ME.phone);
      const ne = A.nameError(name), pe = A.phoneError(phone);
      if (ne || pe) { V.errs = { name: ne, phone: pe }; render(true); alerta('erro', 'Não foi possível salvar', ne || pe); marcar(ne ? '#e-p-name' : '#e-p-wa'); return; }
      V.errs = {};
      run(async () => {
        const d = await api('PUT', '/api/public/me', { name, phone }, authH());
        ME = d.client; V.pName = null; V.pPhone = null;
        setTimeout(() => alerta('ok', 'Dados atualizados', 'Seu nome e WhatsApp foram salvos.'), 30);
      });
    }
  }
  function toNew() { V.sheet = 'novo'; V.newPhone = V.phone; V.errs = {}; V.notFound = false; render(true); focusSheet(); }
  function goTab(t) {
    if (t !== 'agendar' && V.remarca) largaRemarca();
    V.tab = t; V.errs = {}; V.sheet = null; V.cancelAsk = null; V.pName = null; V.pPhone = null; V.espSai = null;
    if (t === 'agendar') {
      if (V.done) Object.assign(V, { date: null, time: null, svcs: [], done: false, antes: null });
      V.step = !V.date ? 1 : !V.time ? 2 : 3;
      loadBusy().then(() => { if (V.tab === 'agendar') render(true); }).catch(() => {});
    }
    render();
  }

  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-a]'); if (!el) return;
    switch (el.dataset.a) {
      case 'tab': goTab(el.dataset.t); break;
      case 'tema': window.U.tema.trocar(); render(true); break;
      case 'again': Object.assign(V, { date: null, time: null, svcs: [], done: false, antes: null }); goTab('agendar'); break;
      case 'ini-svc': if (V.remarca) largaRemarca(); goTab('agendar'); V.svcs = []; pickSvc(el.dataset.id); break;
      case 'carro': { const c = $('#carrossel'); const card = c && c.querySelector('.car-svc'); if (c) c.scrollBy({ left: Number(el.dataset.n) * ((card ? card.offsetWidth : 200) + 12), behavior: 'smooth' }); break; }
      case 'day': pickDay(el.dataset.d, el); break;
      case 'passo': V.stepDir = -1; irPasso(Number(el.dataset.n)); window.scrollTo(0, 0); break;
      case 'abre': V.abre[el.dataset.k] = !abre(el.dataset.k); V.abreAnim = el.dataset.k; render(true); V.abreAnim = null; break;
      case 'cm': { const m = A.parse(V.calMonth); V.calMonth = A.iso(new Date(m.getFullYear(), m.getMonth() + Number(el.dataset.n), 1)); render(true); break; }
      case 'time': pickTime(el.dataset.t, el); break;
      case 'svc': pickSvc(el.dataset.id); break;
      case 'continue': goConfirm(); break;
      case 'sheet-close': if (!V.busyAction) { V.sheet = null; V.errs = {}; V.cancelAsk = null; if (V.acao === 'espera') { V.acao = 'agendar'; V.esp = null; } render(true); } break;
      case 'notme': store.set(TOKEN_KEY, null); ME = null; MYAP = []; MYESP = []; V.sheet = 'quem'; render(true); break;
      case 'det': V.detalhe = el.dataset.id; V.cancelAsk = null; V.sheet = 'detalhe'; render(true); break;
      case 'rem': comecaRemarca(el.dataset.id); break;
      case 'rem-x': largaRemarca(); goTab('horarios'); alerta('info', 'Nada mudou', 'Seu horário continua o mesmo.'); break;
      case 'rem-ok': run(remarcar); break;
      case 'espera': abrirEspera(el.dataset.d); break;
      case 'espera-volta': V.sheet = 'espera'; render(true); break;
      case 'esp-per': V.esp.per = el.dataset.v; render(true); break;
      case 'esp-svc': { const id = el.dataset.id; const l = V.esp.svcs; V.esp.svcs = l.includes(id) ? l.filter((x) => x !== id) : l.length >= MAX_SVCS ? l : [...l, id]; render(true); break; }
      case 'esp-ok': confirmaEspera(); break;
      case 'esp-sai': V.espSai = el.dataset.id; render(true); break;
      case 'esp-sai-no': V.espSai = null; render(true); break;
      case 'esp-sai-ok': { const id = el.dataset.id; run(async () => { await api('DELETE', `/api/public/me/espera/${id}`, null, authH()); V.espSai = null; await loadMe(); setTimeout(() => alerta('info', 'Você saiu da lista de espera', 'Quando quiser, é só entrar de novo.'), 30); }); break; }
      case 'who': V.sheet = el.dataset.w || 'quem'; V.errs = {}; V.notFound = false; render(true); focusSheet(); break;
      case 'to-new': toNew(); break;
      case 'confirm': run(book); break;
      case 'para': V.para = el.dataset.v; V.errs = {}; render(true); if (V.para === 'outro') setTimeout(() => { const i = $('#para-n'); if (i) i.focus(); }, 30); break;
      case 'logout': store.set(TOKEN_KEY, null); ME = null; MYAP = []; MYESP = []; V.phone = ''; V.tab = 'inicio'; render(); alerta('info', 'Você saiu', 'Para ver seus horários, entre de novo com seu WhatsApp.'); break;
      case 'cancel': V.cancelAsk = el.dataset.id; render(true); break;
      case 'cancel-no': V.cancelAsk = null; render(true); break;
      case 'cancel-yes': {
        const id = el.dataset.id;
        run(async () => {
          await api('POST', `/api/public/me/agendamentos/${id}/cancelar`, {}, authH());
          V.cancelAsk = null; V.sheet = null; await Promise.all([loadMe(), loadBusy()]);
          setTimeout(() => alerta('ok', 'Horário cancelado', 'A vaga ficou livre. Quando quiser, é só agendar de novo.'), 30);
        });
        break;
      }
    }
  });
  document.addEventListener('submit', (e) => {
    const f = e.target.closest('form[data-f]'); if (!f) return;
    e.preventDefault(); submitForm(f.dataset.f);
  });
  document.addEventListener('input', (e) => {
    const el = e.target; const k = el.dataset.in; if (!k) return;
    if (['c-phone', 'n-phone', 'p-wa'].includes(k)) el.value = maskPhone(el.value);
    if (k === 'c-phone') { V.phone = el.value; V.notFound = false; }
    if (k === 'n-name') V.newName = el.value;
    if (k === 'para-n') V.paraNome = el.value;
    if (k === 'n-phone') V.newPhone = el.value;
    if (k === 'p-name') V.pName = el.value;
    if (k === 'p-wa') V.pPhone = el.value;
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && V.sheet && !V.busyAction) { V.sheet = null; render(true); }
  });

  // Mudou de celular para computador (ou girou a tela): redesenha
  const onSize = () => { if (S.settings) render(true); };
  if (MOBILE.addEventListener) MOBILE.addEventListener('change', onSize); else MOBILE.addListener(onSize);

  // ----- iniciar -----
  (async function start() {
    try {
      await loadInfo();
      await Promise.all([loadBusy(), loadMe()]);
      render();
      if (window.Carregando) window.Carregando.pronto();
    } catch (e) {
      const semNet = !e.status;
      const titulo = semNet ? 'Não conseguimos abrir o site' : 'Não foi possível carregar a agenda';
      const texto = semNet ? `Confira se a internet do seu ${MOBILE.matches ? 'celular' : 'computador'} está ligada e tente de novo.` : e.message;
      if (window.Carregando) window.Carregando.erro(titulo, texto);
      else $('#app').innerHTML = `<div class="loading"><div style="text-align:center;display:flex;flex-direction:column;gap:12px;padding:20px;align-items:center"><b>${esc(titulo)}</b><span>${esc(texto)}</span><button class="btn" onclick="location.reload()">Tentar de novo</button></div></div>`;
    }
  })();
})();
