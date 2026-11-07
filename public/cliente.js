// Site do cliente: agendar, ver e cancelar horários, editar o perfil.
// Funciona no celular (abas embaixo) e no computador (menu no topo, agendamento em 3 colunas).
(function () {
  const A = window.Agenda;
  const { esc, money, money0, digits, maskPhone, MESES, DOW, longDate, shortDate, cap, IC, svcIcon, applyTheme, toast, api, store } = window.U;
  const $ = (s) => document.querySelector(s);
  const TOKEN_KEY = 'barbearia_cliente';

  // Dados vindos do servidor
  let S = { settings: null, services: [], blocked: [], busy: [] };
  let TODAY = A.todayIn(), TOMORROW;
  let ME = null, MYAP = [];
  const nowMin = () => A.nowMinIn();
  const DESK = window.matchMedia('(min-width: 960px)');
  const desk = () => DESK.matches;

  const V = { tab: 'inicio', date: null, time: null, svc: null, sheet: null, who: 'cliente', phone: '', newName: '', newPhone: '', err: '', cancelAsk: null, calOpen: false, calMonth: null, lastBooking: null, entryErr: '', done: false, busyAction: false };

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
  const freeCount = (ds) => { const b = busy(ds); return daySlots(ds).filter((t) => !b.has(t) && !isPast(ds, t)).length; };
  const fits = (ds, t, dur) => A.fits(S.settings, S.blocked, S.busy, ds, t, dur);
  const blockedOf = (ds) => S.blocked.find((b) => b.date === ds);
  const sortAp = (l) => l.sort((p, q) => (p.date + p.time).localeCompare(q.date + q.time));
  const logo = (size) => window.U.logo(S.settings, size);
  const avatar = (c, size) => window.U.avatar(c, size);

  // ----- carregar -----
  async function loadInfo() {
    const d = await api('GET', '/api/public/info');
    S.settings = d.settings; S.services = d.services; S.blocked = d.blocked; TODAY = d.today;
    TOMORROW = A.iso(A.addDays(A.parse(TODAY), 1));
    applyTheme(S.settings);
    document.title = `${S.settings.shopName} · Agendar horário`;
  }
  async function loadBusy() {
    const st = S.settings;
    const from = st.bookFrom > TODAY ? st.bookFrom : TODAY;
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

  // ----- telas -----
  function render(keep) {
    const top = window.scrollY;
    const view = { inicio: vHome, agendar: vAgendar, horarios: vHorarios, perfil: vPerfil, ok: vOk }[V.tab]();
    const tabs = [['inicio', 'Início', IC.home], ['agendar', 'Agendar', IC.cal], ['horarios', 'Meus horários', IC.clock], ['perfil', 'Perfil', IC.user]];
    const cur = V.tab === 'ok' ? 'agendar' : V.tab;
    $('#app').innerHTML = `<header class="dtop"><div class="dtop-in"><button class="dbrand" data-a="tab" data-t="inicio">${logo(38)}<b>${esc(S.settings.shopName)}</b></button>
      <nav class="dnav" aria-label="Menu">${tabs.map(([k, l]) => `<button class="${cur === k ? 'on' : ''}" data-a="tab" data-t="${k}" ${cur === k ? 'aria-current="page"' : ''}>${l}</button>`).join('')}</nav>
      ${portal('dportal')}</div></header>
      <main class="pscroll v-${V.tab}" id="pscroll">${view}</main>
      ${V.tab === 'agendar' && V.date && !desk() ? bookbar() : ''}
      <nav class="tabbar" aria-label="Menu">${tabs.map(([k, l, i]) => `<button class="${(V.tab === 'ok' ? 'agendar' : V.tab) === k ? 'on' : ''}" data-a="tab" data-t="${k}" ${(V.tab === 'ok' ? 'agendar' : V.tab) === k ? 'aria-current="page"' : ''}>${i}${k === 'horarios' ? '<span class="lf">Meus horários</span><span class="ls">Horários</span>' : l}</button>`).join('')}</nav>
      ${V.sheet ? sheet() : ''}`;
    if (keep) window.scrollTo(0, top); else window.scrollTo(0, 0);
  }

  // Entrada discreta para o barbeiro. O painel pede usuário e senha, então cliente não entra.
  function portal(cls) { return `<a class="${cls}" href="/painel/" rel="nofollow">${IC.lock.replace('<svg', '<svg width="14" height="14"')} Área do barbeiro</a>`; }

  function myNext() {
    return sortAp(MYAP.filter((a) => a.status === 'agendado' && (a.date > TODAY || (a.date === TODAY && !isPast(a.date, a.time)))))[0] || null;
  }

  function vHome() {
    const st = S.settings; const nx = myNext();
    return `<div class="mtop" style="display:flex;justify-content:space-between;align-items:center">${logo(40)}<span class="eyebrow">${ME ? `Olá, ${esc(ME.name.split(' ')[0])}` : 'Bem-vindo'}</span></div>
    <div class="hgrid"><div class="hcol">
    <div class="cover"><span class="pole"></span><span class="eyebrow">Agendamento online</span><h1>${esc(st.shopName)}</h1><p>${esc(st.tagline)}</p><button class="pbtn gold" data-a="tab" data-t="agendar">${IC.cal.replace('<svg', '<svg width="18" height="18"')} Agendar horário</button></div>
    ${nx ? `<div class="nextcard"><span class="eyebrow" style="color:inherit;opacity:.7">Seu próximo horário</span><span class="big">${cap(longDate(nx.date).split(',')[0])}, ${shortDate(nx.date)} · ${nx.time}</span><span style="font-weight:600">${esc(nx.service)} · ${money(nx.price)}</span></div>` : ''}
    </div><div class="hcol">
    <div style="display:flex;flex-direction:column;gap:10px"><div class="sec-h"><h3>Serviços</h3><span class="muted swipe" style="font-size:12px">arraste para o lado</span></div>
     <div class="hscroll">${S.services.map((s) => `<div class="scard"><span class="ic">${svcIcon(s.name)}</span><b>${esc(s.name)}</b><span class="muted" style="font-size:12px">${s.dur} min</span><span class="pr">${money0(s.price)}</span></div>`).join('')}</div></div>
    <div class="pcard" style="display:flex;flex-direction:column;gap:12px"><div class="sec-h"><h3>Funcionamento</h3><span class="muted" style="font-size:12.5px">${st.open} às ${st.close}</span></div>
     <div class="week">${[1, 2, 3, 4, 5, 6, 0].map((d) => `<span class="${st.closed.includes(d) ? 'off' : ''}">${DOW[d]}</span>`).join('')}</div>
     <div class="muted" style="font-size:12.5px">${st.lunchStart !== st.lunchEnd ? `Pausa para almoço das ${st.lunchStart} às ${st.lunchEnd}<br>` : ''}${esc(st.address)}</div>
     ${st.bookTo >= TODAY ? `<div style="font-size:12.5px;font-weight:700;color:var(--acc-d)">Agendamentos abertos até ${A.parse(st.bookTo).getDate()} de ${MESES[A.parse(st.bookTo).getMonth()]}</div>` : ''}</div>
    </div></div>
    <div class="mportal">${portal('plink-portal')}</div>`;
  }

  function vAgendar() {
    const st = S.settings; const limit = st.bookTo; const start = st.bookFrom > TODAY ? st.bookFrom : TODAY;
    if (start > limit) return `<div><span class="eyebrow">Novo agendamento</span><h2 class="ptitle">Agenda <br>fechada</h2></div><div class="hint">A barbearia ainda não abriu novas datas para agendamento. Volte em breve.</div>`;
    const strip = [];
    for (let i = 0; i < 21; i++) {
      const ds = A.iso(A.addDays(A.parse(start), i)); if (ds > limit) break;
      const d = A.parse(ds); const closed = st.closed.includes(d.getDay()); const blk = blockedOf(ds); const f = freeCount(ds);
      const why = closed ? 'fechado' : blk ? 'folga' : 'lotado';
      strip.push(`<button class="dp ${f > 0 && f <= 4 ? 'few' : ''} ${V.date === ds ? 'sel' : ''}" ${f === 0 ? 'disabled' : ''} data-a="day" data-d="${ds}" aria-label="${longDate(ds)}${f === 0 ? ', ' + why : ''}"><small>${ds === TODAY ? 'Hoje' : ds === TOMORROW ? 'Amanhã' : DOW[d.getDay()]}</small><b>${d.getDate()}</b>${f === 0 ? `<small style="font-size:9px">${why}</small>` : '<i></i>'}</button>`);
    }
    let cal = '';
    if (V.calOpen || desk()) {
      const sm = A.iso(new Date(A.parse(start).getFullYear(), A.parse(start).getMonth(), 1));
      if (!V.calMonth || V.calMonth < sm) V.calMonth = sm;
      const m = A.parse(V.calMonth); const first = new Date(m.getFullYear(), m.getMonth(), 1); const last = new Date(m.getFullYear(), m.getMonth() + 1, 0);
      let cells = DOW.map((d) => `<span class="dow">${d[0]}</span>`).join('');
      for (let i = 0; i < first.getDay(); i++) cells += '<span></span>';
      for (let d = 1; d <= last.getDate(); d++) {
        const ds = A.iso(new Date(m.getFullYear(), m.getMonth(), d)); const f = ds < start || ds > limit ? 0 : freeCount(ds);
        cells += `<button class="${f > 0 && f <= 4 ? 'few' : ''} ${V.date === ds ? 'sel' : ''}" ${f === 0 ? 'disabled' : ''} data-a="day" data-d="${ds}" aria-label="${longDate(ds)}">${d}</button>`;
      }
      cal = `<div class="pcard"><div class="calhead"><button data-a="cm" data-n="-1" ${V.calMonth <= sm ? 'disabled' : ''} aria-label="Mês anterior">‹</button><b>${MESES[m.getMonth()]} ${m.getFullYear()}</b><button data-a="cm" data-n="1" ${A.iso(new Date(m.getFullYear(), m.getMonth() + 1, 1)) > limit ? 'disabled' : ''} aria-label="Próximo mês">›</button></div><div class="mcal">${cells}</div></div>`;
    }
    let times = '<div class="hint">Escolha um dia para ver os horários.</div>';
    if (V.date) {
      const b = busy(V.date); const sl = daySlots(V.date);
      const grp = (t, l) => (l.length ? `<div class="tlabel">${t}</div><div class="times">${l.map((x) => { const isB = b.has(x), isP = isPast(V.date, x); return `<button class="tm ${isB ? 'busy' : ''} ${isP && !isB ? 'past' : ''} ${V.time === x ? 'sel' : ''}" ${isB || isP ? 'disabled' : ''} data-a="time" data-t="${x}" aria-label="${x}${isB ? ' ocupado' : ''}">${x}</button>`; }).join('')}</div>` : '');
      times = `${grp('Manhã', sl.filter((x) => A.toMin(x) < 720))}${grp('Tarde', sl.filter((x) => A.toMin(x) >= 720 && A.toMin(x) < 1080))}${grp('Noite', sl.filter((x) => A.toMin(x) >= 1080))}<div class="muted" style="font-size:12px">Horários riscados já estão ocupados.</div>`;
    }
    let svcs = '<div class="hint">Escolha um horário para ver os serviços.</div>';
    if (V.time) {
      svcs = `<div class="svcs">${S.services.map((s) => { const ok = fits(V.date, V.time, s.dur); return `<button class="sv ${V.svc === s.id ? 'sel' : ''}" ${ok ? '' : 'disabled'} data-a="svc" data-id="${s.id}"><span class="ic">${svcIcon(s.name)}</span><span class="t"><b>${esc(s.name)}</b><small>${ok ? `${s.dur} min · até ${A.fromMin(A.toMin(V.time) + s.dur)}` : 'Não cabe neste horário'}</small></span><span class="pr">${money0(s.price)}</span></button>`; }).join('')}</div>`;
    }
    const n = (k, done) => `<span class="n ${done ? 'done' : ''}">${done ? '✓' : k}</span>`;
    return `<div><span class="eyebrow">Novo agendamento</span><h2 class="ptitle">Quando fica <br>bom pra você?</h2><div class="muted" style="font-size:12.5px;margin-top:6px">Datas abertas até ${A.parse(limit).getDate()} de ${MESES[A.parse(limit).getMonth()]}.</div></div>
    <div class="bgrid">
    <section style="display:flex;flex-direction:column;gap:12px"><div class="sec-h"><h3>${n(1, V.date)}Dia</h3><button class="plink calbtn" data-a="calopen">${V.calOpen ? 'Fechar calendário' : 'Ver calendário do mês'}</button></div>${desk() ? '' : `<div class="daystrip">${strip.join('')}</div>`}${cal}</section>
    <section id="sec-time" style="display:flex;flex-direction:column;gap:10px"><div class="sec-h"><h3>${n(2, V.time)}Horário</h3>${V.date ? `<span class="muted" style="font-size:12.5px">${cap(longDate(V.date))}</span>` : ''}</div>${times}</section>
    <section id="sec-svc" style="display:flex;flex-direction:column;gap:10px"><div class="sec-h"><h3>${n(3, V.svc)}Serviço</h3></div>${svcs}${desk() ? summary() : ''}</section>
    </div>
    <div class="spacer" style="height:70px;flex:none"></div>`;
  }

  function bookbar() {
    const s = S.services.find((x) => x.id === V.svc); const d = A.parse(V.date);
    return `<div class="bookbar"><div class="s"><b>${s ? esc(s.name) : V.time ? 'Escolha o serviço' : 'Escolha o horário'}</b>${DOW[d.getDay()]} ${shortDate(V.date)}${V.time ? ` · ${V.time}` : ''}${s ? ` · ${money0(s.price)}` : ''}</div><button data-a="continue" ${s ? '' : 'disabled'}>Continuar</button></div>`;
  }

  // Resumo ao lado dos serviços (só no computador; no celular é a barra "Continuar")
  function summary() {
    if (!V.date) return '';
    const s = S.services.find((x) => x.id === V.svc);
    return `<div class="bsum"><span class="eyebrow">Seu horário</span>
     <div class="recibo"><div><span>Dia</span><b>${cap(longDate(V.date))}</b></div><div><span>Horário</span><b class="num">${V.time ? (s ? `${V.time} às ${A.fromMin(A.toMin(V.time) + s.dur)}` : V.time) : '—'}</b></div><div><span>Serviço</span><b>${s ? esc(s.name) : '—'}</b></div><div><span>Total</span><span class="tot">${s ? money(s.price) : '—'}</span></div></div>
     <button class="pbtn gold" data-a="continue" ${s ? '' : 'disabled'}>${s ? 'Continuar' : V.time ? 'Escolha o serviço' : 'Escolha o horário'}</button></div>`;
  }

  function sheet() {
    let body = '';
    if (V.sheet === 'id') {
      body = `<div><span class="eyebrow">Quase lá</span><h2 class="ptitle" style="font-size:28px">Quem é você?</h2></div>
      <div class="ptabs"><button class="${V.who === 'cliente' ? 'on' : ''}" data-a="who" data-w="cliente">Já sou cliente</button><button class="${V.who === 'novo' ? 'on' : ''}" data-a="who" data-w="novo">Primeira vez</button></div>
      ${V.who === 'cliente'
        ? `<div class="pfield"><label for="c-phone">Seu WhatsApp</label><input class="pin" id="c-phone" inputmode="tel" placeholder="(11) 97425-8136" value="${esc(maskPhone(V.phone))}" data-in="c-phone" autocomplete="tel"></div>`
        : `<div class="pfield"><label for="n-name">Seu nome</label><input class="pin" id="n-name" placeholder="Nome e sobrenome" value="${esc(V.newName)}" data-in="n-name" autocomplete="name"></div><div class="pfield"><label for="n-phone">WhatsApp</label><input class="pin" id="n-phone" inputmode="tel" placeholder="(11) 97425-8136" value="${esc(maskPhone(V.newPhone))}" data-in="n-phone" autocomplete="tel"></div><div class="muted" style="font-size:12.5px">Usamos seu WhatsApp só para falar sobre seus horários.</div>`}
      ${V.err ? `<div class="perr" role="alert">${esc(V.err)}</div>` : ''}
      ${V.notFound ? `<div class="pcard" style="display:flex;flex-direction:column;gap:8px"><b>Não achamos esse número.</b><span class="muted" style="font-size:13px">Deve ser sua primeira vez aqui. O cadastro leva 10 segundos.</span><button class="pbtn ghost" data-a="to-new">Fazer cadastro</button></div>` : ''}
      <button class="pbtn gold ${V.busyAction ? 'busy' : ''}" data-a="id-next" ${V.busyAction ? 'disabled' : ''}>${V.busyAction ? 'Procurando…' : 'Continuar'}</button>`;
    } else {
      const s = S.services.find((x) => x.id === V.svc);
      const who = ME || { name: V.newName.trim(), phone: digits(V.newPhone) };
      body = `<div><span class="eyebrow">Confira os dados</span><h2 class="ptitle" style="font-size:28px">Tudo certo?</h2></div>
      <div class="recibo"><div><span>Dia</span><b>${cap(longDate(V.date))}</b></div><div><span>Horário</span><b class="num">${V.time} às ${A.fromMin(A.toMin(V.time) + s.dur)}</b></div><div><span>Serviço</span><b>${esc(s.name)}</b></div><div><span>Nome</span><b>${esc(who.name)}</b></div><div><span>WhatsApp</span><b class="num">${maskPhone(who.phone)}</b></div><div><span>Total</span><span class="tot">${money(s.price)}</span></div></div>
      <div class="muted" style="font-size:12.5px;text-align:center">Pagamento na barbearia, no dia do atendimento.</div>
      ${V.err ? `<div class="perr" role="alert">${esc(V.err)}</div>` : ''}
      <button class="pbtn gold ${V.busyAction ? 'busy' : ''}" data-a="confirm" ${V.busyAction ? 'disabled' : ''}>${V.busyAction ? 'Agendando…' : 'Confirmar agendamento'}</button>
      ${ME && !V.justId ? `<button class="plink" style="align-self:center" data-a="notme">Não é ${esc(ME.name.split(' ')[0])}? Trocar</button>` : ''}`;
    }
    return `<div class="sheet-bg" data-a="sheet-close"></div><div class="sheet" role="dialog" aria-modal="true"><span class="grab"></span>${body}</div>`;
  }

  function vOk() {
    const a = MYAP.find((x) => x.id === V.lastBooking); if (!a) return vHome();
    const d = A.parse(a.date);
    return `<div class="ok-wrap"><div class="ok-ic">${IC.check.replace('<svg', '<svg width="40" height="40"')}</div><span class="eyebrow">Agendado</span><h2 class="ptitle">Te esperamos, <br>${esc(ME.name.split(' ')[0])}!</h2></div>
    <div class="myap"><div class="when"><div class="dbox"><small>${DOW[d.getDay()]}</small><b>${d.getDate()}</b></div><div><b style="font-size:18px">${a.time} às ${A.fromMin(A.toMin(a.time) + a.dur)}</b><div class="muted" style="font-size:13px">${esc(a.service)} · ${money(a.price)}</div></div></div></div>
    <div class="muted" style="font-size:13px;text-align:center">Se não puder vir, cancele em <b>Meus horários</b> para liberar a vaga.</div>
    <div style="display:flex;flex-direction:column;gap:8px"><button class="pbtn gold" data-a="tab" data-t="horarios">Ver meus horários</button><button class="pbtn ghost" data-a="tab" data-t="inicio">Voltar ao início</button></div>`;
  }

  function entry(title) {
    return `<div><span class="eyebrow">${title}</span><h2 class="ptitle">Entre com seu <br>WhatsApp</h2></div>
    <div class="pcard" style="display:flex;flex-direction:column;gap:12px"><div class="pfield"><label for="e-phone">WhatsApp</label><input class="pin" id="e-phone" inputmode="tel" placeholder="(11) 97425-8136" data-in="mask" autocomplete="tel"></div>${V.entryErr ? `<div class="perr" role="alert">${esc(V.entryErr)}</div>` : ''}<button class="pbtn gold" data-a="entry" ${V.busyAction ? 'disabled' : ''}>Entrar</button><div class="muted" style="font-size:12.5px">Não precisa de senha. Se ainda não tem cadastro, ele é criado no seu primeiro agendamento.</div></div>`;
  }

  function vHorarios() {
    if (!ME) return entry('Meus horários');
    const next = sortAp(MYAP.filter((a) => a.status === 'agendado' && a.date >= TODAY));
    const past = sortAp(MYAP.filter((a) => a.status === 'realizado')).reverse().slice(0, 6);
    return `<div><span class="eyebrow">Meus horários</span><h2 class="ptitle">Próximos <br>atendimentos</h2></div>
    ${next.length ? '<div class="mygrid">' + next.map((a) => { const d = A.parse(a.date); return `<div class="myap"><div class="when"><div class="dbox"><small>${DOW[d.getDay()]}</small><b>${d.getDate()}</b></div><div style="flex:1"><b style="font-size:17px">${a.time}</b><div class="muted" style="font-size:13px">${esc(a.service)} · ${money(a.price)}</div></div></div>
     ${V.cancelAsk === a.id ? `<div style="display:flex;gap:8px"><button class="pbtn ghost" style="padding:11px;color:#f08f7e" data-a="cancel-yes" data-id="${a.id}" ${V.busyAction ? 'disabled' : ''}>Sim, cancelar</button><button class="pbtn ghost" style="padding:11px" data-a="cancel-no">Manter</button></div>` : `<button class="plink" style="align-self:flex-start;color:#f08f7e" data-a="cancel" data-id="${a.id}">Cancelar este horário</button>`}</div>`; }).join('') + '</div>' : '<div class="hint">Nenhum horário marcado.</div>'}
    <button class="pbtn ghost" data-a="tab" data-t="agendar">Agendar novo horário</button>
    ${past.length ? `<div class="pcard"><div class="sec-h" style="margin-bottom:4px"><h3>Últimas visitas</h3></div><div class="hist">${past.map((a) => `<div><span>${shortDate(a.date)} · ${esc(a.service)}</span><b class="num">${money0(a.price)}</b></div>`).join('')}</div></div>` : ''}`;
  }

  function vPerfil() {
    if (!ME) return entry('Meu perfil');
    const done = MYAP.filter((a) => a.status === 'realizado');
    const since = A.parse(ME.since);
    return `<div style="display:flex;flex-direction:column;align-items:center;gap:10px;text-align:center">${avatar(ME, 76)}<div><h2 class="ptitle" style="font-size:28px">${esc(ME.name)}</h2><span class="muted" style="font-size:13px">Cliente desde ${MESES[since.getMonth()]} de ${since.getFullYear()} · ${done.length} visita${done.length === 1 ? '' : 's'}</span></div></div>
    <div class="pcard" style="display:flex;flex-direction:column;gap:12px"><div class="pfield"><label for="p-name">Nome</label><input class="pin" id="p-name" value="${esc(ME.name)}" autocomplete="name"></div><div class="pfield"><label for="p-wa">WhatsApp</label><input class="pin" id="p-wa" inputmode="tel" value="${esc(maskPhone(ME.phone))}" data-in="mask" autocomplete="tel"></div>${V.err ? `<div class="perr" role="alert">${esc(V.err)}</div>` : ''}<button class="pbtn gold" data-a="psave" ${V.busyAction ? 'disabled' : ''}>Salvar alterações</button></div>
    <button class="pbtn ghost" data-a="logout">${IC.out.replace('<svg', '<svg width="18" height="18"')} ${desk() ? 'Sair deste computador' : 'Sair deste celular'}</button>`;
  }

  function scrollToSec(id) {
    if (desk()) return;
    requestAnimationFrame(() => { const el = document.getElementById(id); if (el) window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 20, behavior: 'smooth' }); });
  }

  // ----- ações -----
  async function run(fn) {
    if (V.busyAction) return;
    V.busyAction = true; render(true);
    try { await fn(); } catch (e) { V.err = e.message; V.entryErr = e.message; }
    V.busyAction = false; render(true);
  }

  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-a]'); if (!el) return;
    const a = el.dataset.a;
    switch (a) {
      case 'tab':
        V.tab = el.dataset.t; V.err = ''; V.entryErr = ''; V.sheet = null; V.cancelAsk = null;
        if (V.tab === 'agendar') {
          if (V.done) Object.assign(V, { date: null, time: null, svc: null, done: false });
          loadBusy().then(() => render(true)).catch(() => {});
        }
        render(); break;
      case 'day': V.date = el.dataset.d; V.time = null; V.svc = null; V.calOpen = false; render(true); scrollToSec('sec-time'); break;
      case 'calopen': V.calOpen = !V.calOpen; render(true); break;
      case 'cm': { const m = A.parse(V.calMonth); V.calMonth = A.iso(new Date(m.getFullYear(), m.getMonth() + Number(el.dataset.n), 1)); render(true); break; }
      case 'time': V.time = el.dataset.t; V.svc = null; render(true); scrollToSec('sec-svc'); break;
      case 'svc': V.svc = el.dataset.id; render(true); break;
      case 'continue': V.err = ''; V.notFound = false; V.justId = false; V.sheet = ME ? 'confirm' : 'id'; render(true); break;
      case 'sheet-close': V.sheet = null; V.err = ''; render(true); break;
      case 'notme': store.set(TOKEN_KEY, null); ME = null; MYAP = []; V.sheet = 'id'; render(true); break;
      case 'who': V.who = el.dataset.w; V.err = ''; V.notFound = false; render(true); break;
      case 'to-new': V.who = 'novo'; V.newPhone = V.phone; V.err = ''; V.notFound = false; render(true); break;
      case 'id-next':
        V.err = ''; V.notFound = false;
        if (V.who === 'cliente') {
          if (digits(V.phone).length < 10) { V.err = 'Digite seu WhatsApp com DDD.'; render(true); break; }
          run(async () => {
            try {
              const d = await api('POST', '/api/public/identificar', { phone: V.phone });
              store.set(TOKEN_KEY, d.token); ME = d.client; await loadMe();
              V.justId = true; V.sheet = 'confirm'; V.err = '';
            } catch (err) { if (err.status === 404) { V.notFound = true; V.err = ''; } else throw err; }
          });
        } else {
          const ne = A.nameError(V.newName), pe = A.phoneError(V.newPhone);
          if (ne || pe) { V.err = ne || pe; render(true); break; }
          V.newName = A.tidyName(V.newName);
          V.justId = true; V.sheet = 'confirm'; render(true);
        }
        break;
      case 'confirm':
        V.err = '';
        run(async () => {
          try {
            const body = { date: V.date, time: V.time, serviceId: V.svc };
            if (!ME) { body.name = V.newName.trim(); body.phone = digits(V.newPhone); }
            const dev = deviceId();
            const d = await api('POST', '/api/public/agendar', body, { ...authH(), ...(dev ? { 'X-Device': dev } : {}) });
            store.set(TOKEN_KEY, d.token);
            await Promise.all([loadMe(), loadBusy()]);
            Object.assign(V, { lastBooking: d.appointment.id, sheet: null, tab: 'ok', newName: '', newPhone: '', done: true });
            window.scrollTo(0, 0);
          } catch (err) {
            if (err.status === 409) { toast(err.message); V.sheet = null; V.time = null; V.svc = null; await loadBusy(); V.err = ''; return; }
            if (err.status === 401) { store.set(TOKEN_KEY, null); ME = null; V.sheet = 'id'; }
            throw err;
          }
        });
        break;
      case 'entry': {
        const phone = $('#e-phone').value;
        if (digits(phone).length < 10) { V.entryErr = 'Digite seu WhatsApp com DDD.'; render(true); break; }
        run(async () => {
          try {
            const d = await api('POST', '/api/public/identificar', { phone });
            store.set(TOKEN_KEY, d.token); await loadMe(); V.entryErr = '';
          } catch (err) {
            if (err.status === 404) { V.entryErr = 'Não achamos esse número. Faça seu primeiro agendamento para criar o cadastro.'; return; }
            throw err;
          }
        });
        break;
      }
      case 'logout': store.set(TOKEN_KEY, null); ME = null; MYAP = []; V.phone = ''; render(); break;
      case 'cancel': V.cancelAsk = el.dataset.id; render(true); break;
      case 'cancel-no': V.cancelAsk = null; render(true); break;
      case 'cancel-yes': {
        const id = el.dataset.id;
        run(async () => {
          await api('POST', `/api/public/me/agendamentos/${id}/cancelar`, {}, authH());
          V.cancelAsk = null; await Promise.all([loadMe(), loadBusy()]);
          toast('Horário cancelado. A vaga ficou livre.');
        });
        break;
      }
      case 'psave': {
        const name = $('#p-name').value.trim(), phone = digits($('#p-wa').value);
        const ne = A.nameError(name), pe = A.phoneError(phone);
        if (ne || pe) { V.err = ne || pe; render(true); break; }
        V.err = '';
        run(async () => { const d = await api('PUT', '/api/public/me', { name, phone }, authH()); ME = d.client; toast('Dados atualizados.'); V.err = ''; });
        break;
      }
    }
  });

  document.addEventListener('input', (e) => {
    const el = e.target; const k = el.dataset.in; if (!k) return;
    if (['c-phone', 'n-phone', 'mask'].includes(k)) el.value = maskPhone(el.value);
    if (k === 'c-phone') { V.phone = el.value; V.notFound = false; }
    if (k === 'n-name') V.newName = el.value;
    if (k === 'n-phone') V.newPhone = el.value;
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && V.sheet) { V.sheet = null; render(true); }
    if (e.key === 'Enter' && e.target.matches('.pin')) {
      const btn = e.target.closest('.sheet, .pcard')?.querySelector('.pbtn.gold');
      if (btn) btn.click();
    }
  });

  // Mudou de celular para computador (ou girou a tela): redesenha
  const onSize = () => { if (S.settings) render(true); };
  if (DESK.addEventListener) DESK.addEventListener('change', onSize); else DESK.addListener(onSize);

  // ----- iniciar -----
  (async function start() {
    try {
      await loadInfo();
      await Promise.all([loadBusy(), loadMe()]);
      render();
    } catch (e) {
      $('#app').innerHTML = `<div class="loading"><div style="text-align:center;display:flex;flex-direction:column;gap:12px;padding:20px"><b>Não foi possível carregar a agenda.</b><span>${esc(e.message)}</span><button class="pbtn ghost" onclick="location.reload()">Tentar de novo</button></div></div>`;
    }
  })();
})();
