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

  const V = {
    tab: 'inicio', date: null, time: null, svc: null, sheet: null, phone: '', newName: '', newPhone: '',
    errs: {}, notFound: false, cancelAsk: null, lastBooking: null, done: false, busyAction: false, calOpen: false, calMonth: null,
  };

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
  const daySlots = (ds) => A.daySlots(S.settings, S.blocked, ds);
  const busy = (ds) => A.busySet(S.busy, ds);
  const isPast = (ds, t) => A.isPast(ds, t, TODAY, nowMin());
  const fits = (ds, t, dur) => A.fits(S.settings, S.blocked, S.busy, ds, t, dur);
  const blockedOf = (ds) => S.blocked.find((b) => b.date === ds);
  const sortAp = (l) => l.sort((p, q) => (p.date + p.time).localeCompare(q.date + q.time));
  const svcById = (id) => S.services.find((x) => String(x.id) === String(id));
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
    const st = S.settings; const slots = new Set(daySlots(ds)); const bz = busy(ds);
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

  /** Resumo do horário da semana: "09:00 às 19:00" ou "Hoje: 09:00 às 19:00" quando muda por dia. */
  function hoursLabel() {
    const st = S.settings; const open = [0, 1, 2, 3, 4, 5, 6].filter((i) => !st.closed.includes(i)).map((i) => A.dayHours(st, i));
    const same = open.every((h) => h.open === open[0].open && h.close === open[0].close);
    if (same && open.length) return `${open[0].open} às ${open[0].close}`;
    const now = shopNow(); return now.r;
  }
  function waLink(txt) { return `https://wa.me/55${S.settings.phone}${txt ? `?text=${encodeURIComponent(txt)}` : ''}`; }

  // ----- carregar -----
  async function loadInfo() {
    const d = await api('GET', '/api/public/info');
    S.settings = d.settings; S.services = d.services; S.blocked = d.blocked; TODAY = d.today;
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
    if (!token()) { ME = null; MYAP = []; return; }
    try {
      const d = await api('GET', '/api/public/me', null, authH());
      ME = d.client; MYAP = d.appointments;
    } catch (e) {
      if (e.status === 401) { store.set(TOKEN_KEY, null); ME = null; MYAP = []; } else throw e;
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
    const barra = V.tab === 'agendar' && MOBILE.matches;
    $('#app').innerHTML = `<div class="c-app ${barra ? 'tem-barra' : ''}">
      <header class="c-topo"><div class="c-topo-in">
        <button type="button" class="c-logo" data-a="tab" data-t="inicio">${window.U.logo(S.settings, 44)}<div><b>${esc(S.settings.shopName)}</b><small data-st="${now.st}">${now.r}</small></div></button>
        <nav class="c-nav" aria-label="Menu">${TABS.map(tabBtn(18)).join('')}</nav>
        <a class="c-portal" href="/painel/" rel="nofollow" title="Área do barbeiro">${ic('lock', 13)}<span>Portal</span></a>
      </div></header>
      <main class="c-main ${animTab ? 'vista' : ''}">${view}</main>
      ${barra ? bookbar() : ''}
      <nav class="c-tabbar" aria-label="Menu">${TABS.map(tabBtn(21)).join('')}</nav>
    </div>${V.sheet ? sheet(animSheet) : ''}`;
    if (keep) window.scrollTo(0, top); else window.scrollTo(0, 0);
    wireCarousel();
  }
  /** Rola a tela até a seção, se ela estiver fora de vista. */
  function rolar(sel) {
    requestAnimationFrame(() => {
      const el = $(sel); if (!el) return;
      const r = el.getBoundingClientRect();
      if (r.top < 80 || r.top > innerHeight * 0.6) window.scrollTo({ top: window.scrollY + r.top - 84, behavior: 'smooth' });
    });
  }

  function myNext() {
    return sortAp(MYAP.filter((a) => a.status === 'agendado' && !isPast(a.date, a.time)))[0] || null;
  }

  // ===== Início =====
  function vHome() {
    const st = S.settings; const nx = myNext();
    let prox;
    if (nx) {
      const d = A.parse(nx.date); const dd = daysTo(nx.date);
      prox = `<section class="cartao ini-prox"><div class="cartao-topo"><h3><span class="ico-k">${ic('cal', 17)}</span>Seu próximo horário</h3><span class="pilula viva" data-k="verde">Confirmado</span></div>
        <div class="ini-prox-corpo"><div class="cal-g"><small>${DOW[d.getDay()]}</small><b>${d.getDate()}</b><small>${MESES[d.getMonth()].slice(0, 3)}</small></div>
          <div style="min-width:0"><h4>${esc(nx.service)}</h4><p>${cap(longDate(nx.date))}<br>das <b>${nx.time}</b> às ${endOf(nx.time, nx.dur)}</p></div>
          <div class="ini-valor"><small>Valor</small><b class="preco">${money(nx.price)}</b><small>pago na barbearia</small></div></div>
        <div class="faixa p" data-t="ok"><span class="f-ico">${ic('clock', 15)}</span><p>${dd === 0 ? '<b>É hoje!</b>' : dd === 1 ? '<b>É amanhã!</b>' : `Faltam <b>${dd} dias</b>.`} Chegue 5 minutos antes.</p></div>
        <div class="ini-acoes"><button type="button" class="btn pri" data-a="tab" data-t="horarios">${ic('clock', 17)}Ver meus horários</button><button type="button" class="btn" data-a="tab" data-t="agendar">${ic('plus', 17)}Agendar outro</button></div></section>`;
    } else {
      prox = `<section class="cartao ini-prox"><div class="cartao-topo" style="margin:0"><h3><span class="ico-k">${ic('cal', 17)}</span>Seu próximo horário</h3></div>
        <div class="vazio" style="padding:14px 10px 4px"><h4>${ME ? 'Você não tem horário marcado' : 'Nenhum horário por aqui ainda'}</h4><p>${ME ? 'Que tal já deixar o próximo corte reservado?' : 'Agende em menos de 1 minuto. Se já agendou antes, entre com seu WhatsApp para ver seu horário.'}</p>
        <div class="ini-acoes" style="justify-content:center;margin-top:6px"><button type="button" class="btn pri" data-a="tab" data-t="agendar">${ic('cal', 17)}Agendar horário</button>${ME ? '' : `<button type="button" class="btn" data-a="tab" data-t="horarios">${ic('phone', 17)}Já sou cliente</button>`}</div></div></section>`;
    }
    const svcs = S.services;
    const carousel = svcs.length ? `<section class="cartao"><div class="cartao-topo"><h3><span class="ico-k">${ic('scissors', 17)}</span>Serviços e valores</h3>${svcs.length > 2 ? `<div class="car-setas"><button type="button" class="btn-icone" data-a="carro" data-n="-1" aria-label="Serviços anteriores">${ic('left', 18)}</button><button type="button" class="btn-icone" data-a="carro" data-n="1" aria-label="Próximos serviços">${ic('right', 18)}</button></div>` : ''}</div>
      <div class="carrossel" id="carrossel">${svcs.map((x) => `<button type="button" class="car-svc" data-a="ini-svc" data-id="${x.id}"><span class="ico-k">${svcIcon(x.name).replace('<svg', '<svg width="22" height="22"')}</span><b>${esc(x.name)}</b><span class="car-rod"><span class="tag">${ic('clock', 13)}${tempo(x.dur)}</span><b class="preco">${money(x.price)}</b></span><span class="car-cta">Agendar ${ic('arrow', 14)}</span></button>`).join('')}</div>
      ${svcs.length > 1 ? `<div class="car-pontos" id="carPontos" aria-hidden="true">${svcs.map((_, i) => `<i class="${i === 0 ? 'on' : ''}"></i>`).join('')}</div>` : ''}</section>` : '';
    const addr = (st.address || '').trim();
    const q = encodeURIComponent(addr);
    const onde = `<section class="cartao"><div class="cartao-topo"><h3><span class="ico-k">${ic('pin', 17)}</span>Onde estamos</h3></div>
      ${addr ? `<div class="mapa"><iframe title="Mapa: ${esc(addr)}" loading="lazy" referrerpolicy="no-referrer-when-downgrade" src="https://www.google.com/maps?q=${q}&output=embed"></iframe></div>
        <div class="ini-end"><b>${esc(addr)}</b></div>
        <div class="ini-acoes"><a class="btn" href="https://www.google.com/maps/search/?api=1&query=${q}" target="_blank" rel="noopener">${ic('pin', 17)}Abrir no mapa</a></div>`
      : '<div class="mapa sem">O endereço aparece aqui assim que a barbearia cadastrar.</div>'}
      ${st.phone ? `<a class="ini-contato" href="${waLink('Olá! Vim pelo site de agendamento.')}" target="_blank" rel="noopener">${ic('whats', 17)}<span>WhatsApp <b class="num">${maskPhone(st.phone)}</b></span><span class="ini-contato-ir">Chamar ${ic('arrow', 14)}</span></a>` : ''}</section>`;
    const today = A.parse(TODAY).getDay(); const now = shopNow();
    const horas = `<section class="cartao"><div class="cartao-topo"><h3><span class="ico-k">${ic('clock', 17)}</span>Horário de funcionamento</h3><span class="pilula ${now.st === 'aberto' ? 'viva' : ''}" data-k="${now.st === 'aberto' ? 'verde' : now.st === 'almoco' ? 'laranja' : 'cinza'}">${now.st === 'aberto' ? 'Aberto agora' : now.st === 'almoco' ? 'No almoço' : 'Fechado agora'}</span></div>
      <div class="ini-horas">${[1, 2, 3, 4, 5, 6, 0].map((i) => { const off = st.closed.includes(i); return `<div class="${i === today ? 'hoje' : ''} ${off ? 'fech' : ''}"><span>${cap(DOWL[i])}${i === today ? ' <small>hoje</small>' : ''}</span><b class="num">${off ? 'Fechado' : `${A.dayHours(st, i).open} às ${A.dayHours(st, i).close}`}</b></div>`; }).join('')}
      ${hasLunch() ? `<div class="almoco"><span>${ic('coffee', 15)}Almoço</span><b class="num">${st.lunchStart} às ${st.lunchEnd}</b></div>` : ''}</div>
      ${st.bookTo >= TODAY ? `<div class="ini-limite">Agendamentos abertos até ${A.parse(st.bookTo).getDate()} de ${MESES[A.parse(st.bookTo).getMonth()]}.</div>` : ''}</section>`;
    return `<div class="ini">
      <section class="c-hero bv"><div class="poste" aria-hidden="true"><span class="tampa"></span><span class="vidro"><i></i></span><span class="tampa b"></span></div><div><small class="sobre bv-ola">${ME ? `Olá, ${esc(first(ME.name))}` : 'Agendamento online'}</small><h1>${esc(st.tagline || st.shopName)}</h1><p>Atendimento com hora marcada, sem fila. Escolha seu horário pelo celular e pague na barbearia.</p>
        <div class="ini-acoes" style="margin-top:18px"><button type="button" class="btn-claro" data-a="tab" data-t="agendar">${ic('cal', 18)}Agendar meu horário</button></div>
        <div class="bv-selos"><span>${ic('clock', 14)}Sem fila</span><span>${ic('whats', 14)}Confirmação no WhatsApp</span><span>${ic('check', 14)}Pague na barbearia</span></div></div>
        <div class="ini-selo" aria-hidden="true">${st.logo ? `<img src="${esc(st.logo)}" alt="">` : `<span>${esc(initials(st.shopName.replace(/barbearia/i, '').trim() || st.shopName) || 'B')}</span><small>Barbearia</small>`}</div></section>
      <div class="ini-grid"><div class="col">${prox}${carousel}</div><div class="col">${onde}${horas}</div></div>
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

  // ===== Agendar =====
  function vAgendar() {
    const st = S.settings; const start = winStart();
    if (start > st.bookTo) {
      return `<div class="cartao"><div class="vazio"><span class="ico-k">${ic('cal', 26)}</span><h4>Agenda fechada no momento</h4><p>A barbearia ainda não abriu novas datas para agendamento. Volte em breve.</p></div></div>`;
    }
    const s = svcById(V.svc);
    const steps = [
      ['Dia', V.date ? shortDate(V.date) : 'Escolha', !!V.date], ['Horário', V.time || 'Escolha', !!V.time],
      ['Serviço', s ? s.name : 'Escolha', !!s], ['Confirmar', 'Seu WhatsApp', false],
    ];
    const cur = steps.findIndex((p) => !p[2]);
    return `<div class="c-grid"><div class="col">
      <section class="c-hero ag"><div><small class="sobre">Agendamento online</small><h1>Reserve sua cadeira.</h1><p>Escolha o dia, o horário e o serviço. O pagamento é feito na barbearia.</p></div>
        <div class="infos">${st.address ? `<span>${ic('pin', 16)}${esc(st.address)}</span>` : ''}<span>${ic('clock', 16)}${hoursLabel()}</span>${st.phone ? `<span>${ic('whats', 16)}${maskPhone(st.phone)}</span>` : ''}</div></section>
      <div class="passos">${steps.map(([t, v, f], i) => `<div class="passo ${f ? 'feito' : ''} ${i === cur ? 'atual' : ''}"><span class="n">${f ? ic('check', 15) : i + 1}</span><div><span>${t}</span><small>${esc(v)}</small></div></div>`).join('')}</div>
      ${blocoDia()}${blocoHora()}${blocoSvc()}
    </div><aside class="c-lado">${resumo()}
      <div class="info-casa">${ic('info', 16)}<span>Chegue 5 minutos antes. Se não puder vir, cancele em <b>Meus horários</b> para liberar a vaga.</span></div></aside></div>`;
  }
  function blocoDia() {
    const start = winStart(); const days = [];
    for (let i = 0; i < 21; i++) { const ds = A.iso(A.addDays(A.parse(start), i)); if (ds > S.settings.bookTo) break; days.push(ds); }
    const m = A.parse(V.date || start);
    const strip = days.map((ds) => { const x = dayStatus(ds); const d = A.parse(ds); return `<button type="button" class="dia ${V.date === ds ? 'sel' : ''} ${ds === TODAY ? 'hoje' : ''}" data-st="${x.st}" data-a="day" data-d="${ds}" aria-label="${longDate(ds)}, ${x.r}"><span class="dw">${DOW[d.getDay()]}</span><span class="dn">${d.getDate()}</span><span class="dm">${ds === TODAY ? 'hoje' : MESES[d.getMonth()].slice(0, 3)}</span><span class="ds">${x.r}</span></button>`; }).join('');
    return `<section class="bloco" id="b-dia">
      <div class="bloco-topo"><span class="ico-k">${ic('cal', 20)}</span><div><h2>1. Escolha o dia</h2><p>${cap(MESES[m.getMonth()])} de ${m.getFullYear()} · datas abertas até ${shortDate(S.settings.bookTo)}</p></div>
        <div class="legenda dir"><span data-k="verde"><i></i>Com vagas</span><span data-k="laranja"><i></i>Poucas vagas</span><span data-k="vermelho"><i></i>Lotado</span><span data-k="cinza"><i></i>Fechado</span></div></div>
      <div class="dias">${strip}</div>
      <div><button type="button" class="link" data-a="calopen">${ic('cal', 15)}${V.calOpen ? 'Fechar calendário' : 'Ver o mês inteiro'}</button></div>
      ${V.calOpen ? monthCal() : ''}
    </section>`;
  }
  function monthCal() {
    const start = winStart(); const limit = S.settings.bookTo;
    const sm = start.slice(0, 8) + '01';
    if (!V.calMonth || V.calMonth < sm) V.calMonth = sm;
    const m = A.parse(V.calMonth); const f = new Date(m.getFullYear(), m.getMonth(), 1); const last = new Date(m.getFullYear(), m.getMonth() + 1, 0);
    let cells = DOW.map((d) => `<span class="dw">${d[0]}</span>`).join('');
    for (let i = 0; i < f.getDay(); i++) cells += '<span></span>';
    for (let d = 1; d <= last.getDate(); d++) {
      const ds = A.iso(new Date(m.getFullYear(), m.getMonth(), d)); const x = dayStatus(ds);
      cells += `<button type="button" class="${V.date === ds ? 'sel' : ''}" data-st="${x.st}" ${x.st === 'fora' ? 'disabled' : `data-a="day" data-d="${ds}"`} aria-label="${longDate(ds)}${x.r ? ', ' + x.r : ''}">${d}</button>`;
    }
    const next = A.iso(new Date(m.getFullYear(), m.getMonth() + 1, 1));
    return `<div><div class="mes-cab"><button type="button" class="btn-icone" data-a="cm" data-n="-1" ${V.calMonth <= sm ? 'disabled' : ''} aria-label="Mês anterior">${ic('left', 18)}</button><b>${MESES[m.getMonth()]} de ${m.getFullYear()}</b><button type="button" class="btn-icone" data-a="cm" data-n="1" ${next > limit ? 'disabled' : ''} aria-label="Próximo mês">${ic('right', 18)}</button></div><div class="mes">${cells}</div></div>`;
  }
  function blocoHora() {
    let body;
    if (!V.date) body = `<div class="faixa"><span class="f-ico">${ic('info', 18)}</span><div><strong>Primeiro, escolha um dia</strong><p>Os horários livres aparecem aqui assim que você tocar em um dia.</p></div></div>`;
    else {
      const bz = busy(V.date); const sl = daySlots(V.date);
      const grp = (t, l) => (l.length ? `<div><div class="periodo-t">${t}</div><div class="horas">${l.map((x) => { const oc = bz.has(x), pa = isPast(V.date, x); return `<button type="button" class="hora ${oc ? 'ocup' : ''} ${pa && !oc ? 'passou' : ''} ${V.time === x ? 'sel' : ''}" data-a="time" data-t="${x}" aria-label="${x}${oc ? ', ocupado' : pa ? ', já passou' : ''}">${x}</button>`; }).join('')}</div></div>` : '');
      body = `${grp('Manhã', sl.filter((x) => A.toMin(x) < 720))}${grp('Tarde', sl.filter((x) => A.toMin(x) >= 720 && A.toMin(x) < 1080))}${grp('Noite', sl.filter((x) => A.toMin(x) >= 1080))}
        ${hasLunch() ? `<div class="faixa p" data-t="neutro"><span class="f-ico">${ic('coffee', 15)}</span><p>Pausa para o almoço das <b>${S.settings.lunchStart} às ${S.settings.lunchEnd}</b>.</p></div>` : ''}`;
    }
    return `<section class="bloco" id="b-hora">
      <div class="bloco-topo"><span class="ico-k">${ic('clock', 20)}</span><div><h2>2. Escolha o horário</h2><p>${V.date ? cap(longDate(V.date)) : 'Cada horário dura 30 minutos'}</p></div>
        <div class="legenda dir"><span data-k="verde"><i></i>Livre</span><span data-k="vermelho"><i></i>Ocupado</span><span data-k="sel"><i></i>Escolhido</span></div></div>
      ${body}</section>`;
  }
  function blocoSvc() {
    const noFit = V.date && V.time ? S.services.filter((s) => !fits(V.date, V.time, s.dur)) : [];
    return `<section class="bloco" id="b-svc">
      <div class="bloco-topo"><span class="ico-k">${ic('scissors', 20)}</span><div><h2>3. Escolha o serviço</h2><p>Preço e tempo de cada um</p></div></div>
      ${noFit.length ? `<div class="faixa" data-t="aviso"><span class="f-ico">${ic('alert', 18)}</span><div><strong>${noFit.length === 1 ? '1 serviço não cabe' : `${noFit.length} serviços não cabem`} às ${V.time}</strong><p>Eles precisam de mais tempo do que está livre nesse horário. Estão marcados em vermelho.</p></div></div>` : ''}
      ${S.services.length ? `<div class="servicos">${S.services.map((s) => { const nc = noFit.includes(s); return `<button type="button" class="svc ${String(V.svc) === String(s.id) ? 'sel' : ''} ${nc ? 'nao-cabe' : ''}" data-a="svc" data-id="${s.id}" id="s-${s.id}">
        <span class="ico-k">${svcIcon(s.name).replace('<svg', '<svg width="22" height="22"')}</span><b>${esc(s.name)}</b><small>${V.time && !nc ? `das ${V.time} às ${endOf(V.time, s.dur)}` : tempo(s.dur)}</small>
        <span class="rodape"><span class="tag ${nc ? 'verm' : ''}">${ic('clock', 13)}${tempo(s.dur)}</span><span class="preco">${money(s.price)}</span></span>
        ${nc ? `<span class="nc">${ic('ban', 15)}Não cabe às ${V.time}</span>` : ''}</button>`; }).join('')}</div>` : '<div class="faixa" data-t="aviso"><span class="f-ico">' + ic('alert', 18) + '</span><div><strong>Nenhum serviço cadastrado</strong><p>A barbearia ainda está montando a lista de serviços.</p></div></div>'}
    </section>`;
  }
  function resumo() {
    const s = svcById(V.svc);
    const ln = (i, rot, v, falta) => `<div class="r-linha ${falta ? 'falta' : ''}"><span class="ico-k">${ic(i, 17)}</span><div><small>${rot}</small><b>${v}</b></div></div>`;
    const ok = V.date && V.time && s;
    return `<div class="resumo"><h3><span class="ico-k">${ic('receipt', 17)}</span>Seu agendamento</h3>
      <div class="r-linhas">${ln('cal', 'Dia', V.date ? cap(longDate(V.date)) : 'Falta escolher', !V.date)}${ln('clock', 'Horário', V.time ? (s ? `${V.time} às ${endOf(V.time, s.dur)}` : V.time) : 'Falta escolher', !V.time)}${ln('scissors', 'Serviço', s ? `${esc(s.name)} · ${tempo(s.dur)}` : 'Falta escolher', !s)}</div>
      <div class="r-total"><span>Total</span><b class="preco">${s ? money(s.price) : 'R$ 0,00'}</b></div>
      <button type="button" class="btn pri bloco-btn ${ok ? '' : 'apagado'}" data-a="continue">${ic('check', 18)}Confirmar agendamento</button>
      <div class="r-obs">${ic('money', 15)}Pagamento na barbearia, no dia</div></div>`;
  }
  function bookbar() {
    const s = svcById(V.svc); const ok = V.date && V.time && s;
    const txt = [V.date ? shortDate(V.date) : null, V.time, s ? s.name : null].filter(Boolean).join(' · ') || 'Escolha dia, horário e serviço';
    return `<div class="barra-fixa"><div class="txt"><small>${esc(txt)}</small><b class="preco">${s ? money(s.price) : 'R$ 0,00'}</b></div><button type="button" class="btn pri ${ok ? '' : 'apagado'}" data-a="continue">${ic('check', 17)}Confirmar</button></div>`;
  }

  // ----- janela "Quem é você?" -----
  function field(id, label, icon, value, err, extra = '') {
    return `<div class="campo"><label for="${id}">${label}</label><div class="entrada ${err ? 'erro' : ''}" id="e-${id}">${ic(icon, 18)}<input id="${id}" ${extra} value="${esc(value)}"></div>${err ? `<div class="erro-campo" role="alert">${ic('alert', 16)}${esc(err)}</div>` : ''}</div>`;
  }
  function sheet(anim) {
    const s = svcById(V.svc);
    const mini = s && V.date && V.time ? `<div class="mini-resumo">${ic('cal', 16)}${shortDate(V.date)} · ${V.time} às ${endOf(V.time, s.dur)} · ${esc(s.name)} · ${money(s.price)}</div>` : '';
    const wait = V.busyAction;
    let t, sub, body;
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
        <div class="muted" style="font-size:12.5px">Usamos seu WhatsApp só para falar sobre seus horários.</div>
        <button type="submit" class="btn verde bloco-btn" ${wait ? 'disabled' : ''}>${wait ? 'Agendando…' : `${ic('check', 18)}Cadastrar e confirmar`}</button></form>`;
    } else {
      t = 'Tudo certo?'; sub = 'Confira e confirme o seu horário.';
      body = `<div class="achou"><span class="av">${esc(initials(ME.name))}</span><div><small>${V.justId ? 'Encontramos você!' : 'Agendando como'}</small><b>${esc(ME.name)}</b></div></div>
        <button type="button" class="btn pri bloco-btn" data-a="confirm" ${wait ? 'disabled' : ''}>${wait ? 'Agendando…' : `${ic('check', 18)}Confirmar agendamento`}</button>
        <div class="muted" style="font-size:12.5px;text-align:center">Pagamento na barbearia, no dia do atendimento.</div>
        <button type="button" class="link" style="align-self:center" data-a="notme">Não é ${esc(first(ME.name))}? Trocar</button>`;
    }
    const back = ['cliente', 'novo'].includes(V.sheet) ? `<button type="button" class="link" style="align-self:flex-start" data-a="who" data-w="">${ic('left', 16)}Voltar</button>` : '';
    return `<div class="overlay ${anim ? 'nova' : ''}" data-a="sheet-close"></div><div class="folha ${anim ? 'nova' : ''}" role="dialog" aria-modal="true" aria-label="${esc(t)}"><span class="alca"></span>
      <div class="folha-topo"><div><h3>${t}</h3><p class="sub">${sub}</p></div><button type="button" class="btn-icone" data-a="sheet-close" aria-label="Fechar">${ic('x', 18)}</button></div>
      ${mini}${body}${back}</div>`;
  }

  // ===== Agendado! =====
  function vOk() {
    const a = MYAP.find((x) => String(x.id) === String(V.lastBooking)); if (!a) return vHome();
    const ln = (i, rot, v) => `<div class="r-linha"><span class="ico-k">${ic(i, 17)}</span><div><small>${rot}</small><b>${v}</b></div></div>`;
    return `<div class="sucesso"><div class="check-grande">${ic('check', 52)}</div>
      <div><h1>Horário confirmado!</h1><p>Te esperamos, ${esc(first(ME.name))}. Se não puder vir, cancele em <b>Meus horários</b> para liberar a vaga.</p></div>
      <div class="ticket">${ln('cal', 'Dia', cap(longDate(a.date)))}${ln('clock', 'Horário', `${a.time} às ${endOf(a.time, a.dur)}`)}${ln('scissors', 'Serviço', esc(a.service))}${ln('money', 'Valor (pago na barbearia)', money(a.price))}</div>
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
        extra = `<div class="faixa p"><span class="f-ico">${ic('clock', 15)}</span><p>${dd === 0 ? '<b>É hoje!</b>' : dd === 1 ? '<b>É amanhã!</b>' : `Faltam <b>${dd} dias</b>`} · ${money(a.price)} na barbearia</p></div>
          ${String(V.cancelAsk) === String(a.id) ? `<div class="faixa pisca" data-t="erro"><span class="f-ico">${ic('alert', 18)}</span><div><strong>Cancelar esse horário?</strong><p>A vaga fica livre para outra pessoa.</p><div class="acoes" style="margin-top:10px"><button type="button" class="btn p" style="background:var(--vermelho);border-color:var(--vermelho);color:#fff" data-a="cancel-yes" data-id="${a.id}" ${V.busyAction ? 'disabled' : ''}>Sim, cancelar</button><button type="button" class="btn p" data-a="cancel-no">Manter horário</button></div></div></div>`
            : `<div class="acoes"><button type="button" class="btn verm p" data-a="cancel" data-id="${a.id}">${ic('x', 16)}Cancelar horário</button></div>`}`;
      }
      return `<div class="ag-c"><div class="topo"><div class="quando"><div class="cal ${fut ? '' : 'velho'}"><small>${MESES[d.getMonth()].slice(0, 3)}</small><b>${d.getDate()}</b></div><div style="min-width:0"><h4>${esc(a.service)}</h4><p>${cap(DOWL[d.getDay()])} · ${a.time} às ${endOf(a.time, a.dur)}</p></div></div>${pil}</div>${extra}</div>`;
    };
    return `<div class="pagina-t"><h1>Meus horários</h1><p>Olá, ${esc(first(ME.name))}! Aqui ficam seus agendamentos.</p></div>
      <div class="secao-t">${ic('cal', 20)}Próximos <small>${next.length}</small></div>
      ${next.length ? `<div class="lista-cards">${next.map((a) => card(a, true)).join('')}</div>` : `<div class="cartao"><div class="vazio"><span class="ico-k">${ic('cal', 26)}</span><h4>Nenhum horário marcado</h4><p>Que tal agendar o próximo corte?</p><button type="button" class="btn pri" data-a="tab" data-t="agendar">${ic('plus', 17)}Agendar agora</button></div></div>`}
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
      const alt = [];
      for (let i = 1; i < 30 && alt.length < 2; i++) { const s = A.iso(A.addDays(d, i)); if (!inWindow(s)) break; if (['livre', 'poucas'].includes(dayStatus(s).st)) alt.push(s); }
      alerta('erro', 'Esse dia está lotado', `Todos os horários de ${shortDate(ds)} já foram reservados.${alt.length ? ' Dias com vaga:' : ''}`, alt.map((s) => ({ r: `Ver ${DOW[A.parse(s).getDay()].toLowerCase()} ${shortDate(s)}`, fn: () => pickDay(s) })));
      marcar(el); return;
    }
    V.date = ds; V.time = null; V.calMonth = ds.slice(0, 8) + '01';
    render(true); rolar('#b-hora');
  }
  function pickTime(t, el) {
    if (isPast(V.date, t)) { alerta('aviso', 'Esse horário já passou', `Agora são ${A.fromMin(nowMin())}. Escolha um horário mais tarde.`); marcar(el, 'aviso'); return; }
    if (busy(V.date).has(t)) {
      const sug = suggest(V.date, A.STEP, t);
      alerta('erro', `O horário das ${t} já está ocupado`, sug.length ? 'Esses horários perto dele estão livres:' : 'Não sobrou horário livre nesse dia. Tente outro dia.', sug.map((x) => ({ r: x, fn: () => pickTime(x) })));
      marcar(el); return;
    }
    V.time = t;
    const s = svcById(V.svc);
    if (s && !fits(V.date, t, s.dur)) {
      V.svc = null; render(true);
      alerta('aviso', `${s.name} não cabe às ${t}`, 'Tiramos esse serviço da sua escolha. Escolha outro serviço ou outro horário.');
      marcar('#b-svc', 'aviso'); return;
    }
    render(true); rolar(s ? '#b-svc .svc.sel' : '#b-svc');
  }
  function pickSvc(id) {
    const s = svcById(id); if (!s) return;
    if (!V.date || !V.time) {
      V.svc = s.id; render(true);
      alerta('info', `${s.name} escolhido`, `Agora escolha ${!V.date ? 'o dia e o horário' : 'o horário'}. A gente confere se ele cabe.`, [], 5000);
      marcar(!V.date ? '#b-dia' : '#b-hora', 'aviso'); return;
    }
    if (!fits(V.date, V.time, s.dur)) {
      const r = whyNot(V.date, V.time, s.dur) || { m: 'ocupado' }; const sug = suggest(V.date, s.dur, V.time);
      const motivo = r.m === 'fecha' ? `O ${s.name} leva ${tempo(s.dur)} e terminaria às ${endOf(V.time, s.dur)}, depois que a barbearia fecha (${A.dayHours(S.settings, A.parse(V.date).getDay()).close}).`
        : r.m === 'almoco' ? `O ${s.name} leva ${tempo(s.dur)} e entraria no horário de almoço (${S.settings.lunchStart} às ${S.settings.lunchEnd}).`
        : `O ${s.name} leva ${tempo(s.dur)}, mas${r.t ? ` às ${r.t}` : ' logo depois'} já tem outro cliente.`;
      alerta('erro', `Esse serviço não cabe às ${V.time}`, motivo + (sug.length ? ' Horários em que ele cabe:' : ' Nesse dia não sobrou espaço para ele. Tente outro dia.'),
        sug.map((x) => ({ r: x, fn: () => { V.time = x; V.svc = s.id; render(true); alerta('ok', `Pronto! ${s.name} às ${x}`, 'Agora é só confirmar.'); } })));
      marcar('#s-' + s.id); return;
    }
    V.svc = s.id; render(true);
  }
  function goConfirm() {
    if (!V.date) { alerta('aviso', 'Falta escolher o dia', 'Toque em um dia no passo 1.'); marcar('#b-dia', 'aviso'); return; }
    if (!V.time) { alerta('aviso', 'Falta escolher o horário', 'Toque em um horário livre no passo 2.'); marcar('#b-hora', 'aviso'); return; }
    if (!svcById(V.svc)) { alerta('aviso', 'Falta escolher o serviço', 'Toque em um serviço no passo 3.'); marcar('#b-svc', 'aviso'); return; }
    V.errs = {}; V.notFound = false; V.justId = false;
    V.sheet = ME ? 'confirma' : 'quem'; render(true);
  }
  function focusSheet() { setTimeout(() => { const i = document.querySelector('.folha input'); if (i && !MOBILE.matches) i.focus(); }, 60); }

  async function book() {
    const body = { date: V.date, time: V.time, serviceId: V.svc };
    if (!ME) { body.name = A.tidyName(V.newName); body.phone = digits(V.newPhone); }
    const dev = deviceId();
    try {
      const d = await api('POST', '/api/public/agendar', body, { ...authH(), ...(dev ? { 'X-Device': dev } : {}) });
      store.set(TOKEN_KEY, d.token);
      await Promise.all([loadMe(), loadBusy()]);
      Object.assign(V, { lastBooking: d.appointment.id, sheet: null, tab: 'ok', newName: '', newPhone: '', done: true, errs: {} });
      setTimeout(() => alerta('ok', 'Agendado com sucesso!', `${cap(longDate(d.appointment.date))} às ${d.appointment.time}. Te esperamos!`), 50);
    } catch (err) {
      if (err.status === 409) {
        await loadBusy().catch(() => {});
        const s = svcById(V.svc); const t = V.time; V.sheet = null; V.time = null;
        const sug = s ? suggest(V.date, s.dur, t) : [];
        setTimeout(() => {
          alerta('erro', 'Esse horário acabou de ser reservado', `${err.message}${sug.length ? ' Horários livres perto dele:' : ''}`, sug.map((x) => ({ r: x, fn: () => { V.time = x; render(true); alerta('ok', `Pronto! Agora é ${x}`, 'Confira e toque em Confirmar.'); } })));
          marcar('#b-hora');
        }, 50);
        return;
      }
      if (err.status === 401) { store.set(TOKEN_KEY, null); ME = null; MYAP = []; V.sheet = 'quem'; setTimeout(() => alerta('aviso', 'Entre de novo', err.message), 50); return; }
      setTimeout(() => alerta('erro', 'Não foi possível agendar', err.message), 50);
    }
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
          V.justId = true; V.sheet = 'confirma';
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
      run(book);
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
    V.tab = t; V.errs = {}; V.sheet = null; V.cancelAsk = null; V.pName = null; V.pPhone = null;
    if (t === 'agendar') {
      if (V.done) Object.assign(V, { date: null, time: null, svc: null, done: false });
      loadBusy().then(() => { if (V.tab === 'agendar') render(true); }).catch(() => {});
    }
    render();
  }

  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-a]'); if (!el) return;
    switch (el.dataset.a) {
      case 'tab': goTab(el.dataset.t); break;
      case 'again': Object.assign(V, { date: null, time: null, svc: null, done: false }); goTab('agendar'); break;
      case 'ini-svc': goTab('agendar'); pickSvc(el.dataset.id); break;
      case 'carro': { const c = $('#carrossel'); const card = c && c.querySelector('.car-svc'); if (c) c.scrollBy({ left: Number(el.dataset.n) * ((card ? card.offsetWidth : 200) + 12), behavior: 'smooth' }); break; }
      case 'day': pickDay(el.dataset.d, el); break;
      case 'calopen': V.calOpen = !V.calOpen; render(true); break;
      case 'cm': { const m = A.parse(V.calMonth); V.calMonth = A.iso(new Date(m.getFullYear(), m.getMonth() + Number(el.dataset.n), 1)); render(true); break; }
      case 'time': pickTime(el.dataset.t, el); break;
      case 'svc': pickSvc(el.dataset.id); break;
      case 'continue': goConfirm(); break;
      case 'sheet-close': if (!V.busyAction) { V.sheet = null; V.errs = {}; render(true); } break;
      case 'notme': store.set(TOKEN_KEY, null); ME = null; MYAP = []; V.sheet = 'quem'; render(true); break;
      case 'who': V.sheet = el.dataset.w || 'quem'; V.errs = {}; V.notFound = false; render(true); focusSheet(); break;
      case 'to-new': toNew(); break;
      case 'confirm': run(book); break;
      case 'logout': store.set(TOKEN_KEY, null); ME = null; MYAP = []; V.phone = ''; V.tab = 'inicio'; render(); alerta('info', 'Você saiu', 'Para ver seus horários, entre de novo com seu WhatsApp.'); break;
      case 'cancel': V.cancelAsk = el.dataset.id; render(true); break;
      case 'cancel-no': V.cancelAsk = null; render(true); break;
      case 'cancel-yes': {
        const id = el.dataset.id;
        run(async () => {
          await api('POST', `/api/public/me/agendamentos/${id}/cancelar`, {}, authH());
          V.cancelAsk = null; await Promise.all([loadMe(), loadBusy()]);
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
    } catch (e) {
      $('#app').innerHTML = `<div class="loading"><div style="text-align:center;display:flex;flex-direction:column;gap:12px;padding:20px;align-items:center"><b>Não foi possível carregar a agenda.</b><span>${esc(e.message)}</span><button class="btn" onclick="location.reload()">Tentar de novo</button></div></div>`;
    }
  })();
})();
