// Painel do barbeiro (computador).
(function () {
  const A = window.Agenda;
  const { esc, money, money0, digits, maskPhone, MESES, DOW, longDate, shortDate, cap, initials, STATUS, PRESETS, IC, svcIcon, applyTheme, toast, api } = window.U;
  const $ = (s) => document.querySelector(s);

  let S = null; // tudo que veio de /api/admin/dados
  let TODAY = A.todayIn(), TOMORROW, NOW = A.parse(TODAY);
  const nowMin = () => A.nowMinIn();

  const V = {
    logged: false, sec: 'inicio', agView: 'lista', agTab: 'hoje', weekStart: null, calMonth: null, calDay: TODAY, drawer: null,
    fin: 'mes', from: null, to: null, cliFilter: 'todos', cliSearch: '', expErr: '', pwMsg: '', loginErr: '', dConfirm: null,
    nv: null, bellOpen: false, live: false, saving: false, more: false, pg: {},
  };

  // ----- regras da agenda -----
  const daySlots = (ds) => A.daySlots(S.settings, S.blocked, ds);
  const busy = (ds, ignore) => A.busySet(S.appts, ds, ignore);
  const isPast = (ds, t) => A.isPast(ds, t, TODAY, nowMin());
  const freeCount = (ds) => { const b = busy(ds); return daySlots(ds).filter((t) => !b.has(t) && !isPast(ds, t)).length; };
  const fits = (ds, t, dur) => A.fits(S.settings, S.blocked, S.appts, ds, t, dur);
  const blockedOf = (ds) => S.blocked.find((b) => b.date === ds);
  const cById = (id) => S.clients.find((c) => c.id === id) || { id: '0', name: 'Cliente removido', phone: '' };
  const sortAp = (l) => l.sort((p, q) => (p.date + p.time).localeCompare(q.date + q.time));
  const live = () => S.appts.filter((x) => x.status !== 'cancelado');
  const logo = (size) => window.U.logo(S.settings, size);
  const avatar = (c, size) => window.U.avatar(c, size);

  // ----- paginação (16 por página) -----
  const PER = 16;
  function pageOf(list, key) {
    const pages = Math.max(1, Math.ceil(list.length / PER));
    const p = Math.min(Math.max(1, V.pg[key] || 1), pages); V.pg[key] = p;
    return { items: list.slice((p - 1) * PER, p * PER), p, pages, total: list.length, from: (p - 1) * PER + 1, to: Math.min(p * PER, list.length) };
  }
  function pager(pg, key) {
    if (pg.pages <= 1) return '';
    const nums = [];
    for (let i = 1; i <= pg.pages; i++) {
      if (i === 1 || i === pg.pages || Math.abs(i - pg.p) <= 1) nums.push(i);
      else if (nums[nums.length - 1] !== '…') nums.push('…');
    }
    return `<div class="pgwrap"><nav class="pager" aria-label="Páginas"><button class="btn sm" data-a="pg" data-k="${key}" data-p="${pg.p - 1}" ${pg.p <= 1 ? 'disabled' : ''} aria-label="Página anterior">${IC.left}<span class="pg-t">Anterior</span></button>
     <span class="pg-n">${nums.map((n) => (n === '…' ? '<span class="muted">…</span>' : `<button class="pgb ${n === pg.p ? 'on' : ''}" data-a="pg" data-k="${key}" data-p="${n}" ${n === pg.p ? 'aria-current="page"' : ''}>${n}</button>`)).join('')}</span>
     <span class="pg-c muted">Página ${pg.p} de ${pg.pages}</span>
     <button class="btn sm" data-a="pg" data-k="${key}" data-p="${pg.p + 1}" ${pg.p >= pg.pages ? 'disabled' : ''} aria-label="Próxima página"><span class="pg-t">Próxima</span>${IC.right}</button></nav>
     <div class="pg-info muted">Mostrando ${pg.from} a ${pg.to} de ${pg.total}</div></div>`;
  }

  // ----- dados -----
  async function reload() {
    S = await api('GET', '/api/admin/dados');
    TODAY = S.today; NOW = A.parse(TODAY); TOMORROW = A.iso(A.addDays(NOW, 1));
    if (!V.from) { V.from = A.iso(A.addDays(NOW, -14)); V.to = TODAY; V.calDay = TODAY; }
    applyTheme(S.settings);
    updateTitle();
  }
  /** Faz a chamada, recarrega os dados e redesenha. Mostra o erro numa mensagem. */
  async function act(fn, okMsg) {
    if (V.saving) return;
    V.saving = true;
    try {
      await fn();
      await reload();
      if (okMsg) toast(okMsg);
    } catch (e) {
      if (e.status === 401) { V.logged = false; S = null; }
      toast(e.message);
    } finally {
      V.saving = false;
      render();
    }
  }
  const unread = () => (S ? S.notifications.filter((n) => !n.read).length : 0);
  function updateTitle() {
    const n = unread();
    document.title = `${n ? `(${n}) ` : ''}Painel · ${S ? S.settings.shopName : 'Barbearia'}`;
  }

  // ----- avisos em tempo real -----
  let es = null, hadOpen = false;
  function connectLive() {
    if (es) es.close();
    es = new EventSource('/api/admin/avisos/stream');
    es.onopen = () => {
      V.live = true; paintLive();
      if (hadOpen) reload().then(render).catch(() => {}); // voltou a conexão: busca o que perdeu
      hadOpen = true;
    };
    es.onerror = () => { V.live = false; paintLive(); };
    es.addEventListener('agendamento', async (ev) => {
      const n = JSON.parse(ev.data);
      Som.play(n.type);
      const a = n.appointment;
      toast(n.type === 'novo'
        ? `Novo agendamento: ${n.clientName.split(' ')[0]}, ${DOW[A.parse(a.date).getDay()].toLowerCase()} ${shortDate(a.date)} às ${a.time}`
        : `${n.clientName.split(' ')[0]} cancelou o horário de ${shortDate(a.date)} às ${a.time}`);
      try { await reload(); } catch { /* ignora */ }
      render();
      const b = $('.bellbtn'); if (b) { b.classList.remove('ring'); void b.offsetWidth; b.classList.add('ring'); }
    });
  }
  function paintLive() { const el = $('#live'); if (el) { el.classList.toggle('on', V.live); el.lastChild.textContent = V.live ? 'Ao vivo' : 'Reconectando…'; } }

  // ----- tela -----
  function render() {
    const root = $('#root');
    if (!V.logged || !S) { root.innerHTML = vLogin(); $('#overlay').innerHTML = ''; return; }
    root.innerHTML = adminApp();
    $('#overlay').innerHTML = V.drawer ? drawer() : V.more ? moreSheet() : '';
    updateTitle();
  }

  function vLogin() {
    return `<div class="login"><div class="art"><div style="display:flex;gap:12px;align-items:center;position:relative;z-index:1"><span class="av logo" style="width:44px;height:44px;font-size:18px">✂</span><b class="serif" style="font-size:20px">Painel do barbeiro</b></div><h2>Sua barbearia <em>inteira</em> numa tela só.</h2><span style="color:var(--rail-muted);font-size:13px;position:relative;z-index:1">Agenda, clientes e dinheiro, tudo no mesmo lugar.</span></div>
    <form id="loginForm" autocomplete="on"><div><span class="eyebrow">Painel do barbeiro</span><h1 class="serif" style="font-size:34px">Entrar</h1></div>
    <div class="field"><label for="l-user">Usuário</label><input class="input" id="l-user" autocomplete="username" autocapitalize="none" required value="${esc(V.loginUser || '')}"></div>
    <div class="field"><label for="l-pass">Senha</label><input class="input" id="l-pass" type="password" autocomplete="current-password" required></div>
    ${V.loginErr ? `<div class="err" role="alert">${esc(V.loginErr)}</div>` : ''}
    <button class="btn pri" type="submit" style="padding:14px">Entrar no painel</button>
    <a class="btn ghost" href="/" style="text-decoration:none">← Voltar para o site</a></form></div>`;
  }

  function bell() {
    const n = unread();
    const list = S.notifications;
    return `<div class="bellwrap"><button class="bellbtn" data-a="bell" aria-label="Avisos${n ? `, ${n} novos` : ''}" aria-expanded="${V.bellOpen}">${IC.bell}${n ? `<span class="cnt">${n > 9 ? '9+' : n}</span>` : ''}</button>
     ${V.bellOpen ? `<div class="bellpanel" role="dialog" aria-label="Avisos"><div class="bh"><b>Avisos</b><button class="btn sm ghost" data-a="sound-toggle">${Som.enabled() ? IC.sound.replace('<svg', '<svg width="16" height="16"') + ' Som ligado' : IC.mute.replace('<svg', '<svg width="16" height="16"') + ' Som desligado'}</button></div>
      <div class="bl">${list.length ? list.map((x) => `<button class="nitem ${x.read ? '' : 'unread'}" data-a="dr-ap" data-id="${x.appointmentId}"><span class="dot"></span><span class="ic ${x.type}">${x.type === 'novo' ? IC.cal : IC.x}</span><span class="t"><b>${esc(x.clientName)}</b> ${x.type === 'novo' ? 'agendou' : 'cancelou'} ${esc(x.service.toLowerCase())}<small>${cap(longDate(x.date))} às ${x.time} · ${timeAgo(x.at)}</small></span></button>`).join('') : '<div class="empty" style="border:0">Quando um cliente marcar ou cancelar pelo site, o aviso aparece aqui.</div>'}</div></div>` : ''}</div>`;
  }
  function timeAgo(at) {
    const m = Math.round((Date.now() - new Date(at).getTime()) / 60000);
    if (m < 1) return 'agora'; if (m < 60) return `há ${m} min`;
    const h = Math.round(m / 60); if (h < 24) return `há ${h} h`;
    const d = Math.round(h / 24); return `há ${d} dia${d > 1 ? 's' : ''}`;
  }

  function adminApp() {
    const todayN = S.appts.filter((x) => x.date === TODAY && x.status === 'agendado').length;
    const secs = [['inicio', 'Início', IC.home], ['agenda', 'Agenda', IC.cal], ['fin', 'Financeiro', IC.chart], ['cli', 'Clientes', IC.users], ['cfg', 'Configurações', IC.cog], ['perfil', 'Meu perfil', IC.user]];
    const view = { inicio: vInicio, agenda: vAgenda, fin: vFin, cli: vCli, cfg: vCfg, perfil: vAPerfil }[V.sec]();
    const needSound = Som.enabled() && !Som.ready();
    return `<div class="app"><aside class="rail"><div class="brand">${logo(42)}<div><b>${esc(S.settings.shopName)}</b><small>Painel do barbeiro</small></div></div>
    ${secs.map(([k, l, i]) => `<button class="nv ${V.sec === k ? 'on' : ''}" data-a="sec" data-s="${k}" ${V.sec === k ? 'aria-current="page"' : ''}>${i}${l}${k === 'agenda' && todayN ? `<span class="badge">${todayN}</span>` : ''}</button>`).join('')}
    <div class="foot"><a class="sitebtn" href="/" target="_blank" rel="noopener" style="text-decoration:none">${IC.phone.replace('<svg', '<svg width="17" height="17"')} Ver site do cliente</a>
    <div class="who"><span class="av" style="width:34px;height:34px;font-size:13px;background:var(--acc-d);color:var(--on-acc-d)">${esc(initials(S.barber.name))}</span><div style="flex:1;min-width:0"><b style="font-size:13.5px">${esc(S.barber.name)}</b><small>${esc(S.barber.user)}</small></div><button class="nv" style="padding:6px" data-a="logout" aria-label="Sair">${IC.out}</button></div></div></aside>
    <section class="main"><div class="topline"><div class="tbrand">${logo(34)}<b>${esc(S.settings.shopName)}</b></div><span class="live ${V.live ? 'on' : ''}" id="live"><i></i>${V.live ? 'Ao vivo' : 'Conectando…'}</span>${bell()}</div>
    ${needSound ? `<div class="soundbar"><span>${IC.sound.replace('<svg', '<svg width="18" height="18" style="vertical-align:-4px;margin-right:6px"')}Clique em "Ativar som" para ouvir a campainha quando chegar agendamento novo.</span><button class="btn sm" data-a="sound-on">Ativar som</button></div>` : ''}
    ${view}</section></div>
    ${['inicio', 'agenda'].includes(V.sec) ? `<button class="fab" data-a="dr-novo" aria-label="Novo agendamento">${IC.plus}</button>` : ''}
    <nav class="mnav" aria-label="Menu">${[['inicio', 'Início', IC.home], ['agenda', 'Agenda', IC.cal], ['fin', 'Financeiro', IC.chart], ['cli', 'Clientes', IC.users]].map(([k, l, i]) => `<button class="${V.sec === k ? 'on' : ''}" data-a="sec" data-s="${k}" ${V.sec === k ? 'aria-current="page"' : ''}>${i}${l}${k === 'agenda' && todayN ? `<span class="dotn">${todayN}</span>` : ''}</button>`).join('')}
     <button class="${['cfg', 'perfil'].includes(V.sec) ? 'on' : ''}" data-a="more">${IC.menu}Mais</button></nav>`;
  }
  function moreSheet() {
    const it = (a, s, ic, l, sub) => `<button class="mitem" data-a="${a}" ${s ? `data-s="${s}"` : ''}><span class="ic">${ic}</span><span class="t"><b>${l}</b><small>${sub}</small></span></button>`;
    return `<div class="dr-bg" data-a="more-close"></div><div class="msheet" role="dialog" aria-modal="true" aria-label="Mais opções"><span class="grab"></span>
     <div class="mwho"><span class="av" style="width:40px;height:40px;font-size:14px;background:var(--acc);color:var(--on-acc)">${esc(initials(S.barber.name))}</span><div><b>${esc(S.barber.name)}</b><small class="muted" style="display:block">${esc(S.barber.user)}</small></div></div>
     ${it('sec', 'cfg', IC.cog, 'Configurações', 'Nome, cores, horários, serviços e preços')}
     ${it('sec', 'perfil', IC.user, 'Meu perfil', 'Seus dados e senha')}
     <a class="mitem" href="/" target="_blank" rel="noopener"><span class="ic">${IC.phone}</span><span class="t"><b>Ver site do cliente</b><small>Abre o site como o cliente vê</small></span></a>
     ${it('logout', '', IC.out, 'Sair do painel', 'Pede usuário e senha de novo')}</div>`;
  }

  function greet() { const h = Math.floor(nowMin() / 60); return h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite'; }
  function apc(x) {
    const c = cById(x.clientId);
    return `<div class="apc" role="button" tabindex="0" data-a="dr-ap" data-id="${x.id}"><span class="apc-av">${avatar(c, 38)}</span><div class="t"><b>${esc(c.name)}</b><small>${esc(x.service)}</small></div>${x.status === 'agendado' ? `<div class="q"><button class="y" data-a="st" data-id="${x.id}" data-s="realizado" aria-label="Marcar como atendido" title="Atendido">${IC.check}</button><button class="n" data-a="st" data-id="${x.id}" data-s="faltou" aria-label="Marcar que não veio" title="Não veio">${IC.x}</button></div>` : `<span class="st st-${x.status}">${STATUS[x.status]}</span>`}</div>`;
  }

  // ===== Início (sem valores em dinheiro: a tela pode ficar à vista dos clientes) =====
  function vInicio() {
    const today = sortAp(live().filter((x) => x.date === TODAY)); const done = today.filter((x) => x.status === 'realizado'); const pend = today.filter((x) => x.status === 'agendado');
    const ms = TODAY.slice(0, 8) + '01'; const novos = S.clients.filter((c) => c.since >= ms).length;
    const free = freeCount(TODAY); const nx = pend.find((x) => A.toMin(x.time) + x.dur > nowMin()) || pend[0];
    const dw = (NOW.getDay() + 6) % 7; const ws = A.addDays(NOW, -dw); const wk = [];
    for (let i = 0; i < 7; i++) { const ds = A.iso(A.addDays(ws, i)); wk.push([ds, live().filter((x) => x.date === ds && x.status !== 'faltou').length]); }
    const wmax = Math.max(...wk.map((w) => w[1]), 1);
    const cs = clientStats();
    const gone = cs.filter((x) => x.last && !x.next).map((x) => ({ ...x, days: Math.round((NOW - A.parse(x.last)) / 864e5) })).filter((x) => x.days >= 25).sort((p, q) => q.days - p.days).slice(0, 4);
    const tom = sortAp(S.appts.filter((x) => x.date === TOMORROW && x.status === 'agendado'));
    const st = S.settings; const daysLeft = Math.round((A.parse(st.bookTo) - NOW) / 864e5);
    let nowMarked = false;
    return `<div class="ph"><div><span class="eyebrow">${cap(longDate(TODAY))}</span><h1>${greet()}, ${esc(S.barber.name.split(' ')[0])}.</h1><p>${pend.length ? `Você ainda tem ${pend.length} cliente${pend.length > 1 ? 's' : ''} para atender hoje.` : 'Nenhum cliente pendente hoje.'}</p></div><button class="btn pri" data-a="dr-novo">${IC.plus} Novo agendamento</button></div>
    ${daysLeft <= 10 ? `<div class="card" style="display:flex;gap:14px;align-items:center;flex-wrap:wrap;border-color:var(--warn);background:var(--warn-bg);color:var(--warn)"><b style="flex:1;min-width:200px">${daysLeft < 0 ? 'A agenda online está fechada. Nenhum cliente consegue marcar horário.' : `A agenda online fecha em ${shortDate(st.bookTo)}. Depois disso ninguém consegue marcar.`}</b><button class="btn sm" data-a="sec" data-s="cfg">Abrir mais datas</button></div>` : ''}
    <div class="stats">
     <div class="stat dark"><span class="ic">${IC.cal}</span><span class="eyebrow">Na agenda hoje</span><span class="v">${today.length}</span><span class="s">${pend.length} ainda vão chegar</span></div>
     <div class="stat"><span class="ic">${IC.check}</span><span class="eyebrow">Atendidos hoje</span><span class="v">${done.length}<span class="muted" style="font-size:16px"> / ${today.length}</span></span><span class="s">${today.filter((x) => x.status === 'faltou').length} não vieram</span></div>
     <div class="stat"><span class="ic">${IC.clock}</span><span class="eyebrow">Horários livres hoje</span><span class="v">${free}</span><span class="s">blocos de 30 min</span></div>
     <div class="stat"><span class="ic">${IC.users}</span><span class="eyebrow">Clientes novos no mês</span><span class="v">${novos}</span><span class="s">primeira vez na barbearia</span></div>
    </div>
    <div class="home-grid"><div style="display:flex;flex-direction:column;gap:18px;min-width:0">
     ${nx ? (() => { const c = cById(nx.clientId); return `<div class="spot"><div class="sptm">${nx.time}</div><div><span class="eyebrow">Próximo cliente</span><h3>${esc(c.name)}</h3><div style="opacity:.85">${esc(nx.service)} · ${nx.dur} min · ${maskPhone(c.phone)}</div></div><div class="acts"><button class="btn solid" data-a="st" data-id="${nx.id}" data-s="realizado">${IC.check} Atendido</button><button class="btn" data-a="st" data-id="${nx.id}" data-s="faltou">Não veio</button></div></div>`; })() : '<div class="card"><b>Tudo em dia.</b><div class="muted">Sem clientes pendentes. Bom momento para um café.</div></div>'}
     <div class="card"><div class="card-h"><h3>Agenda de hoje</h3><button class="btn sm ghost" data-a="go-agenda">Ver agenda completa →</button></div>
      ${today.length ? `<div class="timeline">${today.map((x) => { let cls = x.status; if (!nowMarked && x === nx) { cls += ' now'; nowMarked = true; } return `<div class="tl ${cls}"><div class="h">${x.time}<small>${x.dur} min</small></div><div class="rail-l"><i></i></div>${apc(x)}</div>`; }).join('')}</div>` : '<div class="empty">Nenhum agendamento hoje.</div>'}</div>
    </div><div class="side-stack">
     <div class="card"><div class="card-h"><h3>Movimento da semana</h3><span class="muted num" style="font-weight:700">${wk.reduce((s, w) => s + w[1], 0)} clientes</span></div><div class="mini-bars">${wk.map(([ds, v]) => `<div class="${ds === TODAY ? 'today' : ''}" title="${shortDate(ds)}: ${v} clientes"><i style="height:${Math.max(3, (v / wmax) * 100)}%"></i><small>${DOW[A.parse(ds).getDay()][0]}</small></div>`).join('')}</div></div>
     <div class="card"><div class="card-h"><h3>Amanhã</h3><span class="muted" style="font-weight:700">${tom.length} agend.</span></div>${tom.length ? `<div class="plist">${tom.slice(0, 4).map((x) => { const c = cById(x.clientId); return `<button class="pitem" data-a="dr-ap" data-id="${x.id}"><b class="num" style="width:44px">${x.time}</b><span class="t"><b>${esc(c.name)}</b><small>${esc(x.service)}</small></span></button>`; }).join('')}</div>${tom.length > 4 ? `<div class="muted" style="font-size:12.5px;padding:6px 9px">e mais ${tom.length - 4}</div>` : ''}` : `<div class="muted">${!daySlots(TOMORROW).length ? 'Amanhã a barbearia está fechada.' : 'Nenhum agendamento ainda.'}</div>`}</div>
     <div class="card"><div class="card-h"><h3>Sumidos</h3><button class="btn sm ghost" data-a="go-sumidos">Ver todos →</button></div><div class="muted" style="font-size:12.5px;margin:-8px 0 8px">Clientes sem voltar há mais de 25 dias. Bom para mandar um oi no WhatsApp.</div>
      <div class="plist">${gone.map((x) => `<button class="pitem" data-a="dr-cli" data-id="${x.c.id}">${avatar(x.c, 34)}<span class="t"><b>${esc(x.c.name)}</b><small>${x.visits} visitas · última em ${shortDate(x.last)}</small></span><span class="tag red">${x.days} dias</span></button>`).join('') || '<div class="muted">Ninguém sumido. Ótimo sinal.</div>'}</div></div>
    </div></div>`;
  }

  // ===== Agenda =====
  function acard(x) {
    const c = cById(x.clientId);
    return `<div class="acard ${x.status}" role="button" tabindex="0" data-a="dr-ap" data-id="${x.id}"><div class="top1"><div class="hh">${x.time}<small>até ${A.fromMin(A.toMin(x.time) + x.dur)}</small></div><span class="st st-${x.status}">${STATUS[x.status]}</span></div><div class="cl">${avatar(c, 36)}<div style="min-width:0"><b>${esc(c.name)}</b><small>${maskPhone(c.phone)}</small></div></div><div class="ft"><span>${esc(x.service)}</span><b class="num">${money(x.price)}</b></div>${x.status === 'agendado' ? `<div class="acts2"><button class="btn sm okb" data-a="st" data-id="${x.id}" data-s="realizado">${IC.check} Atendido</button><button class="btn sm badb" data-a="st" data-id="${x.id}" data-s="faltou">${IC.x} Não veio</button></div>` : ''}</div>`;
  }
  function vAgenda() {
    const lists = {
      hoje: ['Hoje', () => sortAp(S.appts.filter((x) => x.date === TODAY && x.status === 'agendado'))],
      amanha: ['Amanhã', () => sortAp(S.appts.filter((x) => x.date === TOMORROW && x.status === 'agendado'))],
      proximos: ['Próximos dias', () => sortAp(S.appts.filter((x) => x.date > TOMORROW && x.status === 'agendado'))],
      realizados: ['Realizados', () => sortAp(S.appts.filter((x) => x.status === 'realizado')).reverse()],
      faltou: ['Não compareceu', () => sortAp(S.appts.filter((x) => x.status === 'faltou')).reverse()],
    };
    let body = '';
    if (V.agView === 'lista') {
      const l = lists[V.agTab][1](); const pg = pageOf(l, 'ag'); const groups = {};
      pg.items.forEach((x) => { (groups[x.date] = groups[x.date] || []).push(x); });
      body = `<div class="chips">${Object.entries(lists).map(([k, [n, f]]) => `<button class="chipb ${V.agTab === k ? 'on' : ''}" data-a="ag-tab" data-t="${k}">${n}<span class="n">${f().length}</span></button>`).join('')}</div>
      ${l.length ? Object.entries(groups).map(([ds, xs]) => `<div class="daygroup"><h4>${ds === TODAY ? 'Hoje · ' : ds === TOMORROW ? 'Amanhã · ' : ''}${cap(longDate(ds))}</h4><div class="agrid">${xs.map(acard).join('')}</div></div>`).join('') : `<div class="empty">${V.agTab === 'amanha' && !daySlots(TOMORROW).length ? 'Amanhã a barbearia está fechada.' : V.agTab === 'hoje' ? 'Ninguém esperando atendimento hoje.' : 'Nenhum agendamento aqui.'}</div>`}${pager(pg, 'ag')}`;
    } else if (V.agView === 'semana') {
      if (!V.weekStart) V.weekStart = A.iso(A.addDays(NOW, -NOW.getDay()));
      const ws = A.parse(V.weekStart);
      body = `<div style="display:flex;gap:10px;align-items:center"><button class="btn sm" data-a="wk" data-n="-7" aria-label="Semana anterior">‹</button><b>${shortDate(V.weekStart)} a ${shortDate(A.iso(A.addDays(ws, 6)))}</b><button class="btn sm" data-a="wk" data-n="7" aria-label="Próxima semana">›</button><button class="btn sm ghost" data-a="wk" data-n="0">Esta semana</button></div>
      <div class="weekv">${[0, 1, 2, 3, 4, 5, 6].map((i) => {
        const ds = A.iso(A.addDays(ws, i)); const d = A.parse(ds); const l = sortAp(live().filter((x) => x.date === ds)); const closed = !daySlots(ds).length;
        return `<div class="wcol ${ds === TODAY ? 'today' : ''} ${closed ? 'closed' : ''}"><div class="wh"><small>${DOW[d.getDay()]}</small><b>${d.getDate()}</b></div>${l.map((x) => { const c = cById(x.clientId); return `<button class="wap ${x.status}" data-a="dr-ap" data-id="${x.id}"><b>${x.time} · ${esc(c.name.split(' ')[0])}</b><span>${esc(x.service)}</span></button>`; }).join('') || `<div class="muted" style="font-size:12.5px;padding:0 4px">${closed ? (blockedOf(ds) ? esc(blockedOf(ds).why || 'Bloqueado') : 'Fechado') : 'Livre'}</div>`}</div>`;
      }).join('')}</div>`;
    } else {
      if (!V.calMonth) V.calMonth = A.iso(new Date(NOW.getFullYear(), NOW.getMonth(), 1));
      const m = A.parse(V.calMonth); const first = new Date(m.getFullYear(), m.getMonth(), 1); const start = A.addDays(first, -first.getDay());
      let cells = DOW.map((d) => `<div class="dow">${d}</div>`).join('');
      for (let i = 0; i < 42; i++) {
        const d = A.addDays(start, i); if (i >= 35 && d.getMonth() !== m.getMonth()) break;
        const ds = A.iso(d); const l = live().filter((x) => x.date === ds); const tot = daySlots(ds).length; const used = busy(ds).size;
        cells += `<button class="mc ${d.getMonth() !== m.getMonth() ? 'out' : ''} ${ds === TODAY ? 'today' : ''} ${ds === V.calDay ? 'sel' : ''}" data-a="cal-day" data-d="${ds}"><span class="d">${d.getDate()}</span><span class="cnt">${tot ? (l.length ? `${l.length} agend.` : 'livre') : blockedOf(ds) ? 'bloqueado' : 'fechado'}</span>${tot ? `<span class="load"><i style="width:${Math.min(100, (used / tot) * 100)}%"></i></span>` : ''}</button>`;
      }
      const dl = sortAp(live().filter((x) => x.date === V.calDay));
      body = `<div class="card"><div class="card-h"><button class="btn sm" data-a="cal-m" data-n="-1" aria-label="Mês anterior">‹</button><h3 style="text-transform:capitalize" class="serif">${MESES[m.getMonth()]} ${m.getFullYear()}</h3><button class="btn sm" data-a="cal-m" data-n="1" aria-label="Próximo mês">›</button></div><div class="monthv">${cells}</div><div class="muted" style="font-size:12px;margin-top:10px">A barrinha mostra quanto do dia já está ocupado.</div></div>
      <div class="daygroup"><h4>${cap(longDate(V.calDay))}</h4>${dl.length ? `<div class="agrid">${dl.map(acard).join('')}</div>` : '<div class="empty">Nenhum agendamento neste dia.</div>'}</div>`;
    }
    return `<div class="ph"><div><span class="eyebrow">${cap(longDate(TODAY))}</span><h1>Agenda</h1></div><div style="display:flex;gap:10px;flex-wrap:wrap"><div class="segm">${[['lista', 'Lista'], ['semana', 'Semana'], ['mes', 'Mês']].map(([k, l]) => `<button class="${V.agView === k ? 'on' : ''}" data-a="ag-view" data-v="${k}">${l}</button>`).join('')}</div><button class="btn pri" data-a="dr-novo">${IC.plus} Novo agendamento</button></div></div>${body}`;
  }

  // ===== Financeiro =====
  function finRange() {
    if (V.fin === 'hoje') return [TODAY, TODAY];
    if (V.fin === 'semana') { const dw = (NOW.getDay() + 6) % 7; const s = A.addDays(NOW, -dw); return [A.iso(s), A.iso(A.addDays(s, 6))]; }
    if (V.fin === 'mes') return [A.iso(new Date(NOW.getFullYear(), NOW.getMonth(), 1)), A.iso(new Date(NOW.getFullYear(), NOW.getMonth() + 1, 0))];
    return V.from <= V.to ? [V.from, V.to] : [V.to, V.from];
  }
  function stats(from, to) {
    const done = S.appts.filter((x) => x.status === 'realizado' && x.date >= from && x.date <= to);
    const rev = done.reduce((s, x) => s + x.price, 0);
    const exp = S.expenses.filter((e) => e.date >= from && e.date <= to).reduce((s, e) => s + e.val, 0);
    return { done, rev, exp, faltas: S.appts.filter((x) => x.status === 'faltou' && x.date >= from && x.date <= to).length, profit: rev - exp, ticket: done.length ? rev / done.length : 0 };
  }
  function vFin() {
    const [from, to] = finRange(); const st = stats(from, to);
    const len = Math.round((A.parse(to) - A.parse(from)) / 864e5) + 1;
    const effTo = to > TODAY ? TODAY : to; const effLen = Math.max(1, Math.round((A.parse(effTo) - A.parse(from)) / 864e5) + 1);
    const cur = stats(from, effTo); const prev = stats(A.iso(A.addDays(A.parse(from), -len)), A.iso(A.addDays(A.parse(from), -len + effLen - 1)));
    const delta = prev.rev ? ((cur.rev - prev.rev) / prev.rev) * 100 : null;
    const periodTxt = from === to ? cap(longDate(from)) : `${shortDate(from)} a ${shortDate(to)}`;
    let chart = '';
    if (len > 1 && len <= 62) {
      const days = [];
      for (let i = 0; i < len; i++) { const ds = A.iso(A.addDays(A.parse(from), i)); days.push([ds, st.done.filter((x) => x.date === ds).reduce((s, x) => s + x.price, 0)]); }
      const max = Math.max(...days.map((d) => d[1]), 1); const step = max > 800 ? 200 : max > 400 ? 100 : 50; const top = Math.ceil(max / step) * step; const W = 1000, H = 200;
      const lastIdx = days.reduce((li, [ds], i) => (ds <= TODAY ? i : li), -1);
      const pts = days.slice(0, lastIdx + 1).map(([, v], i) => [((i + 0.5) / len) * W, H - (v / top) * H]);
      const line = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
      const area = pts.length ? `${line} L${pts[pts.length - 1][0].toFixed(1)} ${H} L${pts[0][0].toFixed(1)} ${H} Z` : '';
      const lines = []; for (let v = step; v <= top; v += step) lines.push(v);
      const every = len > 16 ? Math.ceil(len / 10) : 1;
      chart = `<div class="chartbox">${lines.map((v) => `<div class="gl" style="bottom:${(v / top) * 100}%"><span class="num">${money0(v)}</span></div>`).join('')}
       <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true"><defs><linearGradient id="ga" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="var(--acc-d)" stop-opacity=".45"/><stop offset="1" stop-color="var(--acc-d)" stop-opacity="0"/></linearGradient></defs>${pts.length ? `<path d="${area}" fill="url(#ga)"/><path d="${line}" fill="none" stroke="var(--acc-d)" stroke-width="2.5" vector-effect="non-scaling-stroke" stroke-linejoin="round"/>` : ''}</svg>
       <div class="cols">${days.map(([ds, v]) => `<div><span class="tip">${shortDate(ds)} · ${money(v)}</span></div>`).join('')}</div></div>
       <div class="xl">${days.map(([ds], i) => `<span>${i % every === 0 ? A.parse(ds).getDate() : ''}</span>`).join('')}</div>`;
    } else if (len === 1) chart = `<div style="color:var(--rail-muted);font-size:13px">${st.done.length} atendimento${st.done.length === 1 ? '' : 's'} realizado${st.done.length === 1 ? '' : 's'} neste dia.</div>`;
    else chart = '<div style="color:var(--rail-muted);font-size:13px">Para períodos acima de 2 meses mostramos só os totais.</div>';
    const bySvc = {}; st.done.forEach((x) => { bySvc[x.service] = bySvc[x.service] || { q: 0, v: 0 }; bySvc[x.service].q++; bySvc[x.service].v += x.price; });
    const svcs = Object.entries(bySvc).sort((x, y) => y[1].v - x[1].v); const smax = svcs.length ? svcs[0][1].v : 1;
    const exps = S.expenses.filter((e) => e.date >= from && e.date <= to).sort((x, y) => y.date.localeCompare(x.date));
    const epg = pageOf(exps, 'exp');
    return `<div class="ph"><div><span class="eyebrow">${periodTxt}</span><h1>Financeiro</h1></div><div style="display:flex;flex-direction:column;gap:8px;align-items:flex-end"><div class="segm">${[['hoje', 'Hoje'], ['semana', 'Semana'], ['mes', 'Mês'], ['custom', 'Personalizado']].map(([k, l]) => `<button class="${V.fin === k ? 'on' : ''}" data-a="f-range" data-r="${k}">${l}</button>`).join('')}</div>
     ${V.fin === 'custom' ? `<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><label class="muted" for="f-from" style="font-size:13px">De</label><input type="date" class="input" style="width:auto" id="f-from" value="${V.from}" data-ch="f-from"><label class="muted" for="f-to" style="font-size:13px">até</label><input type="date" class="input" style="width:auto" id="f-to" value="${V.to}" data-ch="f-to"></div>` : ''}</div></div>
    <div class="fin-grid"><div class="hero-fin"><div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;align-items:flex-start"><div style="display:flex;flex-direction:column;gap:8px"><span class="eyebrow">Faturamento</span><span class="big">${money(st.rev)}</span></div><span class="delta ${delta == null ? 'na' : delta >= 0 ? 'up' : 'down'}">${delta == null ? 'Sem comparação' : `${delta >= 0 ? '▲' : '▼'} ${Math.abs(delta).toFixed(0)}% vs. mesmo período anterior`}</span></div>${chart}</div>
     <div class="kgrid">
      <div class="stat"><span class="ic">${IC.check}</span><span class="eyebrow">Atendimentos</span><span class="v">${st.done.length}</span><span class="s">${st.faltas} não compareceram</span></div>
      <div class="stat"><span class="ic">${IC.receipt}</span><span class="eyebrow">Despesas</span><span class="v">${money0(st.exp)}</span><span class="s">${exps.length} lançamento${exps.length === 1 ? '' : 's'}</span></div>
      <div class="stat"><span class="ic">${IC.money}</span><span class="eyebrow">Lucro</span><span class="v" style="${st.profit < 0 ? 'color:var(--bad)' : ''}">${money0(st.profit)}</span><span class="s">faturamento menos despesas</span></div>
      <div class="stat"><span class="ic">${IC.user}</span><span class="eyebrow">Ticket médio</span><span class="v">${money(st.ticket)}</span><span class="s">por atendimento</span></div>
     </div></div>
    <div class="fin-grid"><div class="card"><div class="card-h"><h3>Despesas</h3><span class="muted num" style="font-weight:700">${money(st.exp)}</span></div>
      <form class="expform" id="expForm"><input class="input" id="e-desc" placeholder="O que foi pago? Ex.: lâminas" maxlength="120"><input class="input" id="e-val" inputmode="decimal" placeholder="R$ 0,00"><input class="input" id="e-date" type="date" value="${TODAY}" aria-label="Data"><button class="btn acc" type="submit">${IC.plus} Lançar</button></form>
      ${V.expErr ? `<div class="err" style="margin:-6px 0 10px">${esc(V.expErr)}</div>` : ''}
      <div style="display:flex;flex-direction:column;gap:8px">${exps.length ? epg.items.map((e) => `<div class="exp"><span class="ic">${IC.receipt}</span><span class="t"><b>${esc(e.desc)}</b><small>${cap(longDate(e.date))}</small></span><b class="num">${money(e.val)}</b>${V.dConfirm === 'e' + e.id ? `<button class="btn sm badb" data-a="e-del" data-id="${e.id}">Excluir</button><button class="btn sm ghost" data-a="confirm-no">Não</button>` : `<button class="btn sm ghost" data-a="e-ask" data-id="${e.id}" aria-label="Excluir despesa">${IC.x.replace('<svg', '<svg width="15" height="15"')}</button>`}</div>`).join('') : '<div class="empty">Nenhuma despesa neste período.</div>'}</div>${pager(epg, 'exp')}</div>
     <div class="card"><div class="card-h"><h3>Serviços que mais renderam</h3></div><div class="rank">${svcs.length ? svcs.map(([n, o], i) => `<div class="r"><span class="pos">${i + 1}</span><span>${esc(n)} <span class="muted" style="font-size:12.5px">· ${o.q}x</span></span><b class="num">${money0(o.v)}</b><span class="bar"><i style="width:${(o.v / smax) * 100}%"></i></span></div>`).join('') : '<div class="empty">Nenhum atendimento realizado neste período.</div>'}</div></div></div>`;
  }

  // ===== Clientes =====
  function clientStats() {
    const ms = TODAY.slice(0, 8) + '01';
    const by = {}; for (const x of S.appts) (by[x.clientId] = by[x.clientId] || []).push(x);
    return S.clients.map((c) => {
      const ap = by[c.id] || []; const done = ap.filter((x) => x.status === 'realizado');
      return { c, visits: done.length, spent: done.reduce((s, x) => s + x.price, 0), last: done.map((x) => x.date).sort().pop() || null, next: ap.filter((x) => x.status === 'agendado' && x.date >= TODAY).map((x) => x.date).sort()[0] || null, faltas: ap.filter((x) => x.status === 'faltou').length, thisMonth: done.some((x) => x.date >= ms) };
    });
  }
  function tagsFor(x, all) {
    const t = []; const topSpend = all.filter((y) => y.spent > 0).sort((p, q) => q.spent - p.spent).slice(0, 3).map((y) => y.c.id);
    if (topSpend.includes(x.c.id)) t.push('<span class="tag gold">Top gasto</span>');
    if (x.visits >= 10) t.push('<span class="tag grn">Fiel</span>');
    if (x.c.since >= A.iso(A.addDays(NOW, -30))) t.push('<span class="tag">Novo</span>');
    if (x.last) { const d = Math.round((NOW - A.parse(x.last)) / 864e5); if (d >= 25 && !x.next) t.push(`<span class="tag red">Sumido há ${d} dias</span>`); }
    if (x.next) t.push(`<span class="tag">Volta ${shortDate(x.next)}</span>`);
    if (x.faltas >= 2) t.push(`<span class="tag red">${x.faltas} faltas</span>`);
    return t.join('');
  }
  function cliCards() {
    const all = clientStats(); let l = all.slice(); const q = V.cliSearch.trim().toLowerCase();
    if (q) l = l.filter((x) => x.c.name.toLowerCase().includes(q) || (digits(q) && x.c.phone.includes(digits(q))));
    if (V.cliFilter === 'frequentes') l.sort((p, q2) => q2.visits - p.visits);
    else if (V.cliFilter === 'gastam') l.sort((p, q2) => q2.spent - p.spent);
    else if (V.cliFilter === 'sumidos') l = l.filter((x) => !x.thisMonth).sort((p, q2) => (p.last || '').localeCompare(q2.last || ''));
    else l.sort((p, q2) => p.c.name.localeCompare(q2.c.name));
    if (!l.length) return `<div class="empty">${S.clients.length ? 'Nenhum cliente encontrado.' : 'Os clientes aparecem aqui assim que fizerem o primeiro agendamento.'}</div>`;
    const pg = pageOf(l, 'cli');
    return `<div class="cgrid">${pg.items.map((x) => `<button class="ccard" data-a="dr-cli" data-id="${x.c.id}"><div class="hd">${avatar(x.c, 46)}<div style="min-width:0"><b>${esc(x.c.name)}</b><small>${maskPhone(x.c.phone)}</small></div></div><div class="tags">${tagsFor(x, all)}</div><div class="nums"><div><b>${x.visits}</b><small>visitas</small></div><div><b>${money0(x.spent)}</b><small>gastou</small></div><div><b>${x.last ? shortDate(x.last) : '—'}</b><small>última</small></div></div></button>`).join('')}</div>${pager(pg, 'cli')}`;
  }
  function vCli() {
    const all = clientStats();
    const f = [['todos', 'Todos', all.length], ['frequentes', 'Mais frequentes', null], ['gastam', 'Quem mais gasta', null], ['sumidos', 'Não vieram este mês', all.filter((x) => !x.thisMonth).length]];
    return `<div class="ph"><div><span class="eyebrow">${all.length} clientes cadastrados</span><h1>Clientes</h1></div><label class="search">${IC.search}<input class="input" id="cli-search" placeholder="Buscar por nome ou WhatsApp" value="${esc(V.cliSearch)}" data-in="cli-search" aria-label="Buscar cliente"></label></div>
    <div class="chips">${f.map(([k, l, n]) => `<button class="chipb ${V.cliFilter === k ? 'on' : ''}" data-a="cli-f" data-f="${k}">${l}${n != null ? `<span class="n">${n}</span>` : ''}</button>`).join('')}</div><div id="cli-list">${cliCards()}</div>`;
  }

  // ===== Configurações =====
  function previewPhone() {
    const st = S.settings;
    return `<div class="pscroll"><div style="display:flex;justify-content:space-between;align-items:center">${logo(40)}<span class="eyebrow">Bem-vindo</span></div>
    <div class="cover"><span class="pole"></span><span class="eyebrow">Agendamento online</span><h1>${esc(st.shopName)}</h1><p>${esc(st.tagline)}</p><span class="pbtn gold">${IC.cal.replace('<svg', '<svg width="18" height="18"')} Agendar horário</span></div>
    <div style="display:flex;flex-direction:column;gap:10px"><div class="sec-h"><h3>Serviços</h3></div><div class="hscroll">${S.services.map((s) => `<div class="scard"><span class="ic">${svcIcon(s.name)}</span><b>${esc(s.name)}</b><span class="muted" style="font-size:12px">${s.dur} min</span><span class="pr">${money0(s.price)}</span></div>`).join('')}</div></div>
    <div class="pcard" style="display:flex;flex-direction:column;gap:12px"><div class="sec-h"><h3>Funcionamento</h3><span class="muted" style="font-size:12.5px">${st.open} às ${st.close}</span></div><div class="week">${[1, 2, 3, 4, 5, 6, 0].map((d) => `<span class="${st.closed.includes(d) ? 'off' : ''}">${DOW[d]}</span>`).join('')}</div></div></div>
    <nav class="tabbar">${[['Início', IC.home], ['Agendar', IC.cal], ['Meus horários', IC.clock], ['Perfil', IC.user]].map(([l, i], k) => `<span class="${k === 0 ? 'on' : ''}" style="display:flex;flex-direction:column;align-items:center;gap:3px;padding:7px 0;border-radius:16px;font-size:11px;font-weight:700;${k === 0 ? 'color:var(--acc-d);background:var(--p-surface-2)' : 'color:var(--p-muted)'}">${i.replace('<svg', '<svg width="21" height="21"')}${l}</span>`).join('')}</nav>`;
  }
  function vCfg() {
    const st = S.settings;
    const blocked = S.blocked.filter((b) => b.date >= TODAY);
    return `<div class="ph"><div><span class="eyebrow">Tudo é salvo na hora</span><h1>Configurações</h1></div></div>
    <div class="cfg"><div class="cfg-stack">
     <div class="card" style="display:flex;flex-direction:column;gap:16px"><div class="card-h" style="margin:0"><h3>Identidade</h3></div>
      <div class="logo-up">${logo(72)}<div style="display:flex;flex-direction:column;gap:6px;align-items:flex-start"><label class="btn sm" for="cfg-logo" style="cursor:pointer">Enviar logo</label><input type="file" id="cfg-logo" accept="image/png,image/jpeg,image/webp,image/svg+xml" hidden data-ch="cfg-logo">${st.logo ? '<button class="btn sm ghost" data-a="cfg-logo-rm">Remover logo</button>' : '<span class="muted" style="font-size:12.5px">Sem logo, usamos as iniciais.</span>'}</div></div>
      <div class="field"><label for="cfg-name">Nome da barbearia</label><input class="input" id="cfg-name" value="${esc(st.shopName)}" data-ch="cfg" data-k="shopName" maxlength="60"></div>
      <div class="field"><label for="cfg-tag">Frase de boas-vindas</label><input class="input" id="cfg-tag" value="${esc(st.tagline)}" data-ch="cfg" data-k="tagline" maxlength="140"></div>
      <div class="field"><label for="cfg-addr">Endereço</label><input class="input" id="cfg-addr" value="${esc(st.address)}" data-ch="cfg" data-k="address" maxlength="140"></div></div>
     <div class="card" style="display:flex;flex-direction:column;gap:14px"><div class="card-h" style="margin:0"><h3>Cor da marca</h3></div>
      <div class="swatches">${Object.entries(PRESETS).map(([k, [n, l, d]]) => `<button class="sw ${st.color === k ? 'on' : ''}" data-a="cfg-color" data-c="${k}"><i style="background:linear-gradient(135deg,${l} 50%,${d} 50%)"></i>${n}</button>`).join('')}
       <label class="sw ${st.color === 'custom' ? 'on' : ''}" style="cursor:pointer"><i style="background:${st.color === 'custom' ? st.custom : 'conic-gradient(#c33,#cc3,#3c6,#3cc,#36c,#c3c,#c33)'}"><input type="color" value="${st.custom}" data-ch="cfg-custom" style="position:absolute;inset:0;opacity:0;width:100%;height:100%;cursor:pointer" aria-label="Escolher outra cor"></i>Outra</label></div>
      <div class="muted" style="font-size:12.5px">Cada amostra mostra a cor no fundo claro (painel) e no escuro (site do cliente). Veja o resultado ao lado.</div></div>
     <div class="card" style="display:flex;flex-direction:column;gap:14px"><div class="card-h" style="margin:0"><h3>Horário de funcionamento</h3></div>
      <div class="row2"><div class="field"><label for="cfg-open">Abre às</label><input type="time" step="1800" class="input" id="cfg-open" value="${st.open}" data-ch="cfg" data-k="open"></div><div class="field"><label for="cfg-close">Fecha às</label><input type="time" step="1800" class="input" id="cfg-close" value="${st.close}" data-ch="cfg" data-k="close"></div></div>
      <div class="row2"><div class="field"><label for="cfg-ls">Almoço das</label><input type="time" step="1800" class="input" id="cfg-ls" value="${st.lunchStart}" data-ch="cfg" data-k="lunchStart"></div><div class="field"><label for="cfg-le">até</label><input type="time" step="1800" class="input" id="cfg-le" value="${st.lunchEnd}" data-ch="cfg" data-k="lunchEnd"></div></div>
      <div class="muted" style="font-size:12.5px;margin-top:-6px">Sem pausa para almoço? Coloque o mesmo horário nos dois campos.</div>
      <div class="field"><span class="lab">Dias em que fecha (toque para marcar)</span><div class="dchk">${[1, 2, 3, 4, 5, 6, 0].map((i) => `<label><input type="checkbox" ${st.closed.includes(i) ? 'checked' : ''} data-ch="cfg-closed" data-i="${i}">${DOW[i]}</label>`).join('')}</div></div></div>
     <div class="card" style="display:flex;flex-direction:column;gap:14px"><div class="card-h" style="margin:0"><h3>Período de agendamento</h3></div>
      <div class="muted" style="font-size:13px;margin-top:-6px">Os clientes só conseguem marcar dentro deste período. Ex.: abra só até o fim de janeiro para ninguém marcar o Carnaval antes da hora.</div>
      <div class="row2"><div class="field"><label for="cfg-bf">Clientes podem marcar de</label><input type="date" class="input" id="cfg-bf" value="${st.bookFrom}" data-ch="cfg" data-k="bookFrom"></div><div class="field"><label for="cfg-bt">até</label><input type="date" class="input" id="cfg-bt" value="${st.bookTo}" data-ch="cfg" data-k="bookTo"></div></div>
      <div class="chips">${[['Até o fim deste mês', 0], ['Até o fim do próximo mês', 1], ['Até o fim de 3 meses', 2]].map(([l, n]) => `<button class="chipb" data-a="bk-quick" data-n="${n}">${l}</button>`).join('')}</div>
      <div style="display:flex;flex-direction:column;gap:8px;border-top:1px dashed var(--line);padding-top:14px"><span class="lab" style="font-size:12.5px;font-weight:700;color:var(--muted)">Dias bloqueados (folgas, feriados, cursos)</span>
       <form class="expform" id="blkForm" style="grid-template-columns:minmax(0,1fr) minmax(0,1.4fr) auto;margin:0"><input type="date" class="input" id="blk-date" min="${TODAY}" aria-label="Dia"><input class="input" id="blk-why" placeholder="Motivo. Ex.: feriado" maxlength="80"><button class="btn acc" type="submit">Bloquear</button></form>
       ${blocked.map((b) => `<div class="exp"><span class="ic">${IC.cal}</span><span class="t"><b>${cap(longDate(b.date))}</b><small>${esc(b.why || 'Bloqueado')}</small></span><button class="btn sm ghost" data-a="blk-del" data-d="${b.date}">Liberar</button></div>`).join('') || '<div class="muted" style="font-size:12.5px">Nenhum dia bloqueado.</div>'}</div></div>
     <div class="card" style="display:flex;flex-direction:column;gap:10px"><div class="card-h" style="margin:0 0 4px"><h3>Serviços e preços</h3><button class="btn sm acc" data-a="svc-add">${IC.plus} Novo serviço</button></div>
      ${S.services.map((s) => `<div class="svrow" data-svc="${s.id}"><span class="ic">${svcIcon(s.name)}</span><input class="input" value="${esc(s.name)}" data-ch="svc" data-k="name" aria-label="Nome do serviço" maxlength="60"><input class="input" inputmode="decimal" value="${String(s.price).replace('.', ',')}" data-ch="svc" data-k="price" aria-label="Preço em reais"><select class="input" data-ch="svc" data-k="dur" aria-label="Duração">${[30, 60, 90, 120].map((m) => `<option value="${m}" ${s.dur === m ? 'selected' : ''}>${m} min</option>`).join('')}</select>${V.dConfirm === 's' + s.id ? `<span style="display:flex;gap:4px"><button class="btn sm badb" data-a="svc-del" data-id="${s.id}">Remover</button><button class="btn sm ghost" data-a="confirm-no">Não</button></span>` : `<button class="btn sm ghost badb" data-a="svc-ask" data-id="${s.id}" aria-label="Remover serviço">${IC.x.replace('<svg', '<svg width="15" height="15"')}</button>`}</div>`).join('')}
      <div class="muted" style="font-size:12.5px">Mudar o preço não altera atendimentos antigos. O financeiro guarda o valor cobrado no dia.</div></div>
    </div><div class="preview"><span class="eyebrow">Prévia ao vivo</span><div class="pmini"><div class="scr">${previewPhone()}</div></div></div></div>`;
  }

  // ===== Perfil =====
  function vAPerfil() {
    const b = S.barber;
    return `<div class="ph"><div><span class="eyebrow">Acesso ao painel</span><h1>Meu perfil</h1></div><button class="btn" data-a="logout">${IC.out} Sair do painel</button></div>
    <div class="cgrid" style="grid-template-columns:repeat(auto-fit,minmax(min(100%,320px),1fr));align-items:start">
    <form class="card" id="profForm" style="display:flex;flex-direction:column;gap:14px"><div style="display:flex;gap:14px;align-items:center"><span class="av" style="width:56px;height:56px;font-size:20px;background:var(--acc);color:var(--on-acc)">${esc(initials(b.name))}</span><div><b style="font-size:17px">${esc(b.name)}</b><div class="muted" style="font-size:13px">${esc(b.email || 'Sem e-mail')}</div></div></div>
     <div class="field"><label for="b-name">Nome</label><input class="input" id="b-name" value="${esc(b.name)}" autocomplete="name"></div>
     <div class="field"><label for="b-email">E-mail</label><input class="input" id="b-email" type="email" value="${esc(b.email)}" autocomplete="email"></div>
     <div class="field"><label for="b-user">Usuário de acesso</label><input class="input" id="b-user" value="${esc(b.user)}" autocomplete="username" autocapitalize="none"></div>
     <button class="btn pri" type="submit">Salvar dados</button></form>
    <form class="card" id="pwForm" style="display:flex;flex-direction:column;gap:14px"><h3>Trocar senha</h3>
     <div class="field"><label for="pw-cur">Senha atual</label><input class="input" type="password" id="pw-cur" autocomplete="current-password"></div>
     <div class="field"><label for="pw-new">Nova senha</label><input class="input" type="password" id="pw-new" autocomplete="new-password"></div>
     <div class="field"><label for="pw-new2">Repita a nova senha</label><input class="input" type="password" id="pw-new2" autocomplete="new-password"></div>
     ${V.pwMsg ? `<div class="${V.pwMsg.startsWith('Senha alterada') ? 'muted' : 'err'}" role="alert">${esc(V.pwMsg)}</div>` : ''}<button class="btn pri" type="submit">Salvar nova senha</button></form></div>`;
  }

  // ===== Gaveta lateral =====
  function drawer() {
    const d = V.drawer; let h = '', b = '';
    if (d.type === 'ap') {
      const x = S.appts.find((y) => y.id === d.id);
      if (!x) { V.drawer = null; return ''; }
      const c = cById(x.clientId);
      h = `<div><span class="eyebrow">${cap(longDate(x.date))}</span><h2 class="serif numd" style="font-size:30px">${x.time} às ${A.fromMin(A.toMin(x.time) + x.dur)}</h2></div>`;
      b = `<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><span class="st st-${x.status}">${STATUS[x.status]}</span><span class="muted" style="font-size:12.5px">${x.origin === 'site' ? 'Marcado pelo site' : 'Marcado no painel'}</span></div>
      <button class="pitem" style="border:1px solid var(--line);padding:12px" data-a="dr-cli" data-id="${c.id}">${avatar(c, 44)}<span class="t"><b>${esc(c.name)}</b><small>${maskPhone(c.phone)} · ver ficha →</small></span></button>
      <div class="kv"><div><span>Serviço</span><b>${esc(x.service)}</b></div><div><span>Duração</span><b>${x.dur} min</b></div><div><span>Valor</span><b class="num">${money(x.price)}</b></div></div>
      ${x.status === 'agendado' ? `<div class="actgrid"><button class="btn okb" data-a="st" data-id="${x.id}" data-s="realizado">${IC.check} Atendido</button><button class="btn badb" data-a="st" data-id="${x.id}" data-s="faltou">${IC.x} Não veio</button></div>
       ${V.dConfirm === 'a' + x.id ? `<div class="confirm-inline"><span>Cancelar e liberar o horário?</span><button class="btn sm badb" data-a="st" data-id="${x.id}" data-s="cancelado">Sim, cancelar</button><button class="btn sm" data-a="confirm-no">Não</button></div>` : `<button class="btn ghost" data-a="ap-cancel-ask" data-id="${x.id}">Cancelar agendamento</button>`}`
        : `<button class="btn" data-a="st" data-id="${x.id}" data-s="agendado">Voltar para agendado</button>`}
      <button class="btn" data-a="copy" data-v="${maskPhone(c.phone)}">${IC.copy} Copiar WhatsApp</button>`;
    } else if (d.type === 'cli') {
      const all = clientStats(); const x = all.find((y) => y.c.id === d.id);
      if (!x) { V.drawer = null; return ''; }
      const hist = sortAp(live().filter((y) => y.clientId === x.c.id)).reverse().slice(0, 12);
      h = `<div style="display:flex;gap:14px;align-items:center">${avatar(x.c, 52)}<div><h2 class="serif" style="font-size:26px">${esc(x.c.name)}</h2><span class="muted" style="font-size:13px">Cliente desde ${shortDate(x.c.since)}/${A.parse(x.c.since).getFullYear()}</span></div></div>`;
      b = `<div class="tags" style="display:flex;gap:6px;flex-wrap:wrap">${tagsFor(x, all)}</div>
      <div class="kgrid" style="grid-template-columns:repeat(3,1fr);gap:8px">${[['Visitas', x.visits], ['Gastou', money0(x.spent)], ['Faltas', x.faltas]].map(([l, v]) => `<div class="stat" style="padding:12px;gap:2px"><span class="eyebrow" style="font-size:10px">${l}</span><span class="v" style="font-size:20px">${v}</span></div>`).join('')}</div>
      <form id="cliForm" data-id="${x.c.id}" style="display:flex;flex-direction:column;gap:12px"><div class="field"><label for="cd-name">Nome</label><input class="input" id="cd-name" value="${esc(x.c.name)}"></div>
      <div class="field"><label for="cd-phone">WhatsApp</label><div style="display:flex;gap:6px"><input class="input" id="cd-phone" value="${esc(maskPhone(x.c.phone))}" data-in="mask" inputmode="tel"><button class="btn" type="button" data-a="copy" data-v="${maskPhone(x.c.phone)}" aria-label="Copiar WhatsApp">${IC.copy}</button></div></div>
      <button class="btn pri" type="submit">Salvar dados</button></form>
      <div><span class="eyebrow">Histórico</span><div class="plist" style="margin-top:8px">${hist.map((y) => `<button class="pitem" data-a="dr-ap" data-id="${y.id}"><b class="num" style="width:46px;font-size:13px">${shortDate(y.date)}</b><span class="t"><b style="font-size:13.5px">${esc(y.service)}</b><small>${y.time} · ${money0(y.price)}</small></span><span class="st st-${y.status}">${STATUS[y.status]}</span></button>`).join('') || '<div class="muted">Sem histórico.</div>'}</div></div>`;
    } else {
      const nv = V.nv; const svc = S.services.find((s) => s.id === nv.svc) || S.services[0];
      const free = daySlots(nv.date).filter((t) => !isPast(nv.date, t) && fits(nv.date, t, svc.dur));
      if (!free.includes(nv.time)) nv.time = free[0] || '';
      h = '<div><span class="eyebrow">Encaixe ou agendamento por telefone</span><h2 class="serif" style="font-size:30px">Novo agendamento</h2></div>';
      b = `<form id="nvForm" style="display:flex;flex-direction:column;gap:16px">${nvClientField(nv)}
      <div class="field"><label for="nv-svc">Serviço</label><select class="input" id="nv-svc" data-ch="nv" data-k="svc">${S.services.map((s) => `<option value="${s.id}" ${nv.svc === s.id ? 'selected' : ''}>${esc(s.name)} · ${money0(s.price)} · ${s.dur} min</option>`).join('')}</select></div>
      <div class="row2"><div class="field"><label for="nv-date">Dia</label><input type="date" class="input" id="nv-date" min="${TODAY}" value="${nv.date}" data-ch="nv" data-k="date"></div><div class="field"><label for="nv-time">Horário livre</label><select class="input" id="nv-time" data-ch="nv" data-k="time" ${free.length ? '' : 'disabled'}>${free.map((t) => `<option ${nv.time === t ? 'selected' : ''}>${t}</option>`).join('') || '<option>Sem horários</option>'}</select></div></div>
      ${free.length ? '' : `<div class="muted" style="font-size:13px">${daySlots(nv.date).length ? 'Não há horário livre para esse serviço nesse dia.' : 'A barbearia está fechada nesse dia.'}</div>`}
      ${nv.err ? `<div class="err" role="alert">${esc(nv.err)}</div>` : ''}<button class="btn pri" style="padding:14px" type="submit" ${free.length ? '' : 'disabled'}>Agendar</button></form>`;
    }
    return `<div class="dr-bg" data-a="dr-close"></div><aside class="drawer" role="dialog" aria-modal="true"><div class="dh">${h}<button class="xbtn" data-a="dr-close" aria-label="Fechar">${IC.x.replace('<svg', '<svg width="16" height="16"')}</button></div><div class="db">${b}</div></aside>`;
  }

  // ----- Novo agendamento: busca de cliente enquanto digita -----
  const norm = (t) => String(t).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  function nvClientField(nv) {
    if (nv.cid) {
      const c = cById(nv.cid);
      return `<div class="field"><span class="lab">Cliente</span><div class="pick">${avatar(c, 38)}<span class="t"><b>${esc(c.name)}</b><small>${maskPhone(c.phone)}</small></span><button type="button" class="btn sm ghost" data-a="nv-clear">Trocar</button></div></div>`;
    }
    if (nv.isNew) {
      return `<div class="field"><div style="display:flex;justify-content:space-between;align-items:center"><span class="lab">Cliente novo</span><button type="button" class="btn sm ghost" data-a="nv-clear">Buscar cliente cadastrado</button></div>
       <div class="row2"><div class="field"><label for="nv-name">Nome</label><input class="input" id="nv-name" value="${esc(nv.name)}" data-in="nv-name" autocomplete="off"></div><div class="field"><label for="nv-phone">WhatsApp</label><input class="input" id="nv-phone" value="${esc(maskPhone(nv.phone))}" data-in="nv-phone" inputmode="tel" autocomplete="off"></div></div></div>`;
    }
    return `<div class="field"><label for="nv-q">Cliente</label><div class="ac"><span class="ac-ic">${IC.search}</span><input class="input" id="nv-q" placeholder="Digite o nome ou o WhatsApp" value="${esc(nv.q)}" data-in="nv-q" autocomplete="off" role="combobox" aria-controls="nv-sug" aria-autocomplete="list"></div><div id="nv-sug" class="sug" role="listbox">${nvSug(nv.q)}</div></div>`;
  }
  function nvSug(q) {
    q = String(q || '').trim();
    if (q.length < 2) return '';
    const d = digits(q); const nq = norm(q);
    const l = S.clients.filter((c) => norm(c.name).includes(nq) || (d.length >= 3 && c.phone.includes(d)))
      .sort((p, r) => (norm(p.name).startsWith(nq) ? 0 : 1) - (norm(r.name).startsWith(nq) ? 0 : 1) || p.name.localeCompare(r.name)).slice(0, 6);
    return l.map((c) => `<button type="button" class="sgi" role="option" data-a="nv-pick" data-id="${c.id}">${avatar(c, 32)}<span class="t"><b>${esc(c.name)}</b><small>${maskPhone(c.phone)}</small></span></button>`).join('')
      + `<button type="button" class="sgi new" data-a="nv-new"><span class="nic">${IC.plus}</span><span class="t"><b>Cadastrar cliente novo</b><small>${l.length ? 'Não é nenhum desses?' : 'Nenhum cliente encontrado com esse nome'}</small></span></button>`;
  }

  // ===== Eventos =====
  const put = (path, body) => api('PUT', path, body);
  const saveSettings = (patch, msg = 'Salvo.') => act(() => put('/api/admin/configuracoes', patch), msg);

  document.addEventListener('submit', (e) => {
    const f = e.target; e.preventDefault();
    if (f.id === 'loginForm') {
      Som.unlock();
      const user = $('#l-user').value.trim(), pass = $('#l-pass').value; V.loginUser = user;
      api('POST', '/api/admin/login', { user, pass })
        .then(async () => { V.logged = true; V.loginErr = ''; await reload(); connectLive(); render(); })
        .catch((err) => { V.loginErr = err.message; render(); });
    }
    if (f.id === 'expForm') {
      const desc = $('#e-desc').value.trim(); const val = parseFloat($('#e-val').value.replace(/[^\d,.-]/g, '').replace(/\.(?=\d{3})/g, '').replace(',', '.')); const date = $('#e-date').value;
      if (!desc) { V.expErr = 'Escreva o que foi pago.'; render(); return; }
      if (!(val > 0)) { V.expErr = 'Digite um valor maior que zero.'; render(); return; }
      V.expErr = '';
      act(() => api('POST', '/api/admin/despesas', { desc, val, date }), 'Despesa lançada.');
    }
    if (f.id === 'blkForm') {
      const date = $('#blk-date').value, why = $('#blk-why').value.trim();
      if (!date) { toast('Escolha o dia que quer bloquear.'); return; }
      act(async () => {
        const r = await api('POST', '/api/admin/bloqueios', { date, why });
        if (r.existing) setTimeout(() => toast(`Dia bloqueado. Atenção: ${r.existing} cliente${r.existing > 1 ? 's já tinham' : ' já tinha'} horário nesse dia.`), 50);
      }, 'Dia bloqueado. Ninguém consegue marcar nele.');
    }
    if (f.id === 'cliForm') {
      const name = $('#cd-name').value.trim(), phone = digits($('#cd-phone').value);
      act(() => put('/api/admin/clientes/' + f.dataset.id, { name, phone }), 'Cliente atualizado.');
    }
    if (f.id === 'nvForm') {
      const nv = V.nv;
      const body = { date: nv.date, time: nv.time, serviceId: nv.svc };
      if (nv.cid) body.clientId = nv.cid;
      else if (nv.isNew) { body.name = nv.name; body.phone = digits(nv.phone); }
      else { nv.err = 'Escolha o cliente: digite o nome e toque nele na lista, ou cadastre um cliente novo.'; render(); return; }
      api('POST', '/api/admin/agendamentos', body)
        .then(async () => { V.drawer = null; await reload(); toast(`Agendado para ${shortDate(nv.date)} às ${nv.time}.`); render(); })
        .catch((err) => { nv.err = err.message; render(); });
    }
    if (f.id === 'profForm') {
      act(() => put('/api/admin/perfil', { name: $('#b-name').value, email: $('#b-email').value, user: $('#b-user').value }), 'Dados salvos.');
    }
    if (f.id === 'pwForm') {
      const cur = $('#pw-cur').value, n1 = $('#pw-new').value, n2 = $('#pw-new2').value;
      if (n1.length < 6) { V.pwMsg = 'A nova senha precisa ter pelo menos 6 caracteres.'; render(); return; }
      if (n1 !== n2) { V.pwMsg = 'As duas senhas novas não são iguais.'; render(); return; }
      api('PUT', '/api/admin/senha', { cur, next: n1 })
        .then(() => { V.pwMsg = 'Senha alterada. Use a nova senha no próximo acesso.'; render(); })
        .catch((err) => { V.pwMsg = err.message; render(); });
    }
  });

  document.addEventListener('click', (e) => {
    if (Som.enabled()) Som.unlock();
    if (V.bellOpen && !e.target.closest('.bellwrap')) { V.bellOpen = false; render(); }
    const el = e.target.closest('[data-a]'); if (!el) return;
    const a = el.dataset.a;
    switch (a) {
      case 'logout': api('POST', '/api/admin/logout').finally(() => { if (es) es.close(); V.logged = false; S = null; V.drawer = null; V.more = false; render(); }); break;
      case 'sec': V.sec = el.dataset.s; V.pwMsg = ''; V.drawer = null; V.dConfirm = null; V.more = false; render(); window.scrollTo({ top: 0 }); break;
      case 'more': V.more = true; V.bellOpen = false; render(); break;
      case 'more-close': V.more = false; render(); break;
      case 'pg': {
        V.pg[el.dataset.k] = Number(el.dataset.p); render();
        const t = document.querySelector('.chips') || document.querySelector('.main'); if (t) window.scrollTo({ top: Math.max(0, t.getBoundingClientRect().top + window.scrollY - 90) });
        break;
      }
      case 'go-agenda': V.sec = 'agenda'; V.agView = 'lista'; V.agTab = 'hoje'; V.pg.ag = 1; render(); break;
      case 'go-sumidos': V.sec = 'cli'; V.cliFilter = 'sumidos'; V.pg.cli = 1; render(); break;
      case 'bell':
        V.bellOpen = !V.bellOpen; render();
        if (V.bellOpen && unread()) {
          api('POST', '/api/admin/avisos/lidos').then(() => { setTimeout(() => { S.notifications.forEach((n) => (n.read = true)); render(); }, 2500); }).catch(() => {});
        }
        break;
      case 'sound-toggle': Som.setEnabled(!Som.enabled()); if (Som.enabled()) { Som.unlock(); setTimeout(() => Som.play('novo'), 100); } render(); break;
      case 'sound-on': Som.setEnabled(true); Som.unlock(); setTimeout(() => { Som.play('novo'); render(); }, 150); toast('Som ativado. É assim que vai tocar quando chegar agendamento.'); break;
      case 'ag-view': V.agView = el.dataset.v; render(); break;
      case 'ag-tab': V.agTab = el.dataset.t; V.pg.ag = 1; render(); break;
      case 'wk': { const n = Number(el.dataset.n); V.weekStart = n === 0 ? A.iso(A.addDays(NOW, -NOW.getDay())) : A.iso(A.addDays(A.parse(V.weekStart), n)); render(); break; }
      case 'cal-m': { const m = A.parse(V.calMonth); V.calMonth = A.iso(new Date(m.getFullYear(), m.getMonth() + Number(el.dataset.n), 1)); render(); break; }
      case 'cal-day': V.calDay = el.dataset.d; render(); break;
      case 'f-range': V.fin = el.dataset.r; V.pg.exp = 1; render(); break;
      case 'e-ask': V.dConfirm = 'e' + el.dataset.id; render(); break;
      case 'svc-ask': V.dConfirm = 's' + el.dataset.id; render(); break;
      case 'ap-cancel-ask': V.dConfirm = 'a' + el.dataset.id; render(); break;
      case 'confirm-no': V.dConfirm = null; render(); break;
      case 'e-del': V.dConfirm = null; act(() => api('DELETE', '/api/admin/despesas/' + el.dataset.id), 'Despesa excluída.'); break;
      case 'st': {
        e.stopPropagation(); const s = el.dataset.s; V.dConfirm = null;
        act(() => api('PATCH', '/api/admin/agendamentos/' + el.dataset.id, { status: s }),
          { realizado: 'Atendimento concluído. Já entrou no financeiro.', faltou: 'Marcado como não compareceu.', cancelado: 'Agendamento cancelado. O horário ficou livre.', agendado: 'Voltou para agendado.' }[s]);
        break;
      }
      case 'dr-ap': V.drawer = { type: 'ap', id: el.dataset.id }; V.dConfirm = null; V.bellOpen = false; render(); break;
      case 'dr-cli': V.drawer = { type: 'cli', id: el.dataset.id }; render(); break;
      case 'dr-novo':
        V.more = false;
        V.nv = { cid: '', q: '', isNew: false, name: '', phone: '', date: TODAY, svc: S.services[0].id, time: '', err: '' };
        for (let i = 0; i < 60 && !freeCount(V.nv.date); i++) V.nv.date = A.iso(A.addDays(NOW, i + 1)); // primeiro dia com horário livre
        V.drawer = { type: 'novo' }; render(); break;
      case 'dr-close': V.drawer = null; V.dConfirm = null; render(); break;
      case 'nv-pick': V.nv.cid = el.dataset.id; V.nv.isNew = false; V.nv.err = ''; render(); break;
      case 'nv-new': {
        const q = V.nv.q.trim(); V.nv.isNew = true; V.nv.cid = ''; V.nv.err = '';
        if (digits(q).length >= 8 && !/[a-zà-ú]/i.test(q)) V.nv.phone = q; else V.nv.name = q;
        render(); const f = $(V.nv.name ? '#nv-phone' : '#nv-name'); if (f) f.focus();
        break;
      }
      case 'nv-clear': V.nv.cid = ''; V.nv.isNew = false; V.nv.q = ''; V.nv.err = ''; render(); { const f = $('#nv-q'); if (f) f.focus(); } break;
      case 'copy': { const v = el.dataset.v; (navigator.clipboard ? navigator.clipboard.writeText(v) : Promise.reject()).then(() => toast('WhatsApp copiado.'), () => toast(`WhatsApp: ${v}`)); break; }
      case 'cli-f': V.cliFilter = el.dataset.f; V.pg.cli = 1; render(); break;
      case 'cfg-color': saveSettings({ color: el.dataset.c }, 'Cor atualizada.'); break;
      case 'cfg-logo-rm': saveSettings({ logo: null }, 'Logo removida.'); break;
      case 'bk-quick': {
        const n = Number(el.dataset.n); const bookTo = A.iso(new Date(NOW.getFullYear(), NOW.getMonth() + n + 1, 0));
        const patch = { bookTo }; if (S.settings.bookFrom > bookTo) patch.bookFrom = TODAY;
        saveSettings(patch, `Agenda aberta até ${shortDate(bookTo)}.`); break;
      }
      case 'blk-del': act(() => api('DELETE', '/api/admin/bloqueios/' + el.dataset.d), 'Dia liberado para agendamento.'); break;
      case 'svc-add': act(() => api('POST', '/api/admin/servicos', { name: 'Novo serviço', price: 30, dur: 30 }), 'Serviço criado. Edite o nome e o preço.'); break;
      case 'svc-del': V.dConfirm = null; act(() => api('DELETE', '/api/admin/servicos/' + el.dataset.id), 'Serviço removido.'); break;
    }
  });

  document.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[role=button]')) { e.preventDefault(); e.target.click(); }
    if (e.target.id === 'nv-q' && (e.key === 'Enter' || e.key === 'ArrowDown')) { e.preventDefault(); const f = $('#nv-sug .sgi'); if (f) { if (e.key === 'Enter') f.click(); else f.focus(); } }
    if (e.target.matches('.sgi') && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) { e.preventDefault(); const n = e.key === 'ArrowDown' ? e.target.nextElementSibling : e.target.previousElementSibling || $('#nv-q'); if (n) n.focus(); }
    if (e.key === 'Escape') { if (V.drawer) { V.drawer = null; render(); } else if (V.more) { V.more = false; render(); } else if (V.bellOpen) { V.bellOpen = false; render(); } }
  });

  document.addEventListener('input', (e) => {
    const el = e.target; const k = el.dataset.in; if (!k) return;
    if (['mask', 'nv-phone'].includes(k)) el.value = maskPhone(el.value);
    if (k === 'nv-name') V.nv.name = el.value;
    if (k === 'nv-q') { V.nv.q = el.value; V.nv.err = ''; $('#nv-sug').innerHTML = nvSug(el.value); }
    if (k === 'nv-phone') V.nv.phone = el.value;
    if (k === 'cli-search') { V.cliSearch = el.value; V.pg.cli = 1; $('#cli-list').innerHTML = cliCards(); }
  });

  document.addEventListener('change', (e) => {
    const el = e.target; const k = el.dataset.ch; if (!k) return;
    if (k === 'f-from') { V.from = el.value; V.pg.exp = 1; render(); }
    if (k === 'f-to') { V.to = el.value; V.pg.exp = 1; render(); }
    if (k === 'nv') { V.nv[el.dataset.k] = el.value; V.nv.err = ''; render(); }
    if (k === 'cfg') {
      const v = el.value.trim(); const key = el.dataset.k;
      if (!v && key !== 'address') { toast('Esse campo não pode ficar vazio.'); render(); return; }
      saveSettings({ [key]: v });
    }
    if (k === 'cfg-custom') saveSettings({ custom: el.value, color: 'custom' }, 'Cor atualizada.');
    if (k === 'cfg-closed') {
      const i = Number(el.dataset.i);
      const closed = el.checked ? [...S.settings.closed, i] : S.settings.closed.filter((x) => x !== i);
      saveSettings({ closed });
    }
    if (k === 'cfg-logo') {
      const f = el.files[0]; if (!f) return;
      if (f.size > 1.5e6) { toast('Imagem muito grande. Use uma de até 1,5 MB.'); return; }
      const fr = new FileReader(); fr.onload = () => saveSettings({ logo: fr.result }, 'Logo atualizada.'); fr.readAsDataURL(f);
    }
    if (k === 'svc') {
      const row = el.closest('[data-svc]'); const id = row.dataset.svc; const s = S.services.find((x) => x.id === id);
      const body = { name: s.name, price: s.price, dur: s.dur };
      const key = el.dataset.k;
      if (key === 'price') { const v = parseFloat(el.value.replace(',', '.')); if (!(v >= 0)) { toast('Preço inválido.'); render(); return; } body.price = v; }
      else if (key === 'dur') body.dur = Number(el.value);
      else { if (!el.value.trim()) { toast('O nome não pode ficar vazio.'); render(); return; } body.name = el.value.trim(); }
      act(() => put('/api/admin/servicos/' + id, body), 'Serviço salvo.');
    }
  });

  // Atualiza a tela a cada minuto (horários que passaram, "próximo cliente")
  setInterval(() => {
    if (!V.logged || !S || V.drawer || document.activeElement?.matches('input,select')) return;
    if (A.todayIn() !== TODAY) reload().then(render).catch(() => {}); else render();
  }, 60000);

  // ----- iniciar: se já estiver logado (cookie), entra direto -----
  (async function start() {
    try {
      await reload(); V.logged = true; connectLive();
    } catch (e) {
      V.logged = false; S = null;
      if (e.status !== 401) V.loginErr = e.message;
    }
    render();
  })();
})();
