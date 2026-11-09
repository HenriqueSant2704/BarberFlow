// Painel do barbeiro (computador e celular), no visual do protótipo aprovado.
(function () {
  const A = window.Agenda;
  const { alerta, marcar, ic, esc, money, money0, digits, maskPhone, MESES, DOW, DOWL, longDate, shortDate, cap, initials, PRESETS, svcIcon, applyTheme, toast, api } = window.U;
  const $ = (s) => document.querySelector(s);

  let S = null; // tudo que veio de /api/admin/dados
  let TODAY = A.todayIn(), TOMORROW, NOW = A.parse(TODAY);
  const nowMin = () => A.nowMinIn();

  const V = {
    logged: false, sec: 'inicio', menu: false, sino: false, nClearAsk: false, live: false, saving: false, pg: {},
    ab: 'hoje', agDia: null, vista: 'lista', calMonth: null, cancel: null,
    cliF: 'todos', cliQ: '',
    per: 'mes', de: null, ate: null, despForm: false, despAsk: null,
    nv: null, lado: null, ladoAsk: null, draft: null, loginUser: '',
  };
  const TITULOS = { inicio: 'Início', agenda: 'Agenda', cli: 'Clientes', fin: 'Financeiro', cfg: 'Configurações', perfil: 'Meu perfil' };

  // ----- regras da agenda -----
  const daySlots = (ds) => A.daySlots(S.settings, S.blocked, ds);
  const busy = (ds, ignore) => A.busySet(S.appts, ds, ignore);
  const isPast = (ds, t) => A.isPast(ds, t, TODAY, nowMin());
  const fits = (ds, t, dur) => A.fits(S.settings, S.blocked, S.appts, ds, t, dur);
  const freeCount = (ds) => { const b = busy(ds); return daySlots(ds).filter((t) => !b.has(t) && !isPast(ds, t)).length; };
  const blockedOf = (ds) => S.blocked.find((b) => b.date === ds);
  const cById = (id) => S.clients.find((c) => c.id === id) || { id: '0', name: 'Cliente removido', phone: '' };
  const sortAp = (l) => l.sort((p, q) => (p.date + p.time).localeCompare(q.date + q.time));
  const live = () => S.appts.filter((x) => x.status !== 'cancelado');
  const endOf = (t, dur) => A.fromMin(A.toMin(t) + dur);
  const first = (n) => String(n || '').split(' ')[0];
  const hasLunch = () => A.toMin(S.settings.lunchEnd) > A.toMin(S.settings.lunchStart);
  const tempo = (m) => (m < 60 ? `${m} min` : `${Math.floor(m / 60)}h${m % 60 ? String(m % 60).padStart(2, '0') : ''}`);
  const logo = (size, st) => window.U.logo(st || S.settings, size);
  const avk = (c, size) => `<span class="av-k"${size ? ` style="width:${size}px;height:${size}px;font-size:${Math.round(size * 0.34)}px"` : ''}>${esc(initials(c.name))}</span>`;
  const diaTxt = (ds) => (ds === TODAY ? 'hoje' : ds === TOMORROW ? 'amanhã' : `${DOW[A.parse(ds).getDay()].toLowerCase()}, ${shortDate(ds)}`);
  const waLink = (phone, txt) => `https://wa.me/55${digits(phone)}${txt ? `?text=${encodeURIComponent(txt)}` : ''}`;
  const waMsg = (x) => `Olá, ${first(cById(x.clientId).name)}! Aqui é da ${S.settings.shopName}. Passando para lembrar do seu horário ${diaTxt(x.date)} às ${x.time} (${x.service}).`;
  /** Por que um serviço de "dur" minutos não cabe começando em "t". */
  function whyNot(ds, t, dur) {
    const st = S.settings; const slots = new Set(daySlots(ds)); const bz = busy(ds);
    for (let i = 0; i < Math.ceil(dur / A.STEP); i++) {
      const m = A.toMin(t) + A.STEP * i; const s = A.fromMin(m);
      if (!slots.has(s)) return hasLunch() && m >= A.toMin(st.lunchStart) && m < A.toMin(st.lunchEnd) ? { m: 'almoco' } : { m: 'fecha' };
      if (i > 0 && bz.has(s)) return { m: 'ocupado', t: s };
    }
    return null;
  }

  // ----- paginação (16 por página) -----
  const PER = 16;
  function pagina(list, key, per = PER, rot = '') {
    const tot = Math.max(1, Math.ceil(list.length / per));
    const p = Math.min(Math.max(1, V.pg[key] || 1), tot); V.pg[key] = p;
    const ini = (p - 1) * per; const itens = list.slice(ini, ini + per);
    const nums = []; for (let i = 1; i <= tot; i++) if (i === 1 || i === tot || Math.abs(i - p) <= 1) nums.push(i); else if (nums[nums.length - 1] !== '…') nums.push('…');
    const html = list.length > per ? `<div class="pag"><small>Mostrando ${ini + 1} a ${ini + itens.length} de ${list.length}${rot}</small><div class="pag-bts">
      <button type="button" data-a="pag" data-k="${key}" data-p="${p - 1}" ${p === 1 ? 'disabled' : ''} aria-label="Página anterior">${ic('left', 16)}</button>
      ${nums.map((n) => (n === '…' ? '<button type="button" disabled>…</button>' : `<button type="button" class="${n === p ? 'on' : ''}" data-a="pag" data-k="${key}" data-p="${n}" ${n === p ? 'aria-current="page"' : ''}>${n}</button>`)).join('')}
      <button type="button" data-a="pag" data-k="${key}" data-p="${p + 1}" ${p === tot ? 'disabled' : ''} aria-label="Próxima página">${ic('right', 16)}</button></div></div>` : '';
    return { itens, html };
  }

  // ----- dados -----
  async function reload() {
    S = await api('GET', '/api/admin/dados');
    TODAY = S.today; NOW = A.parse(TODAY); TOMORROW = A.iso(A.addDays(NOW, 1));
    if (!V.de) { V.de = A.iso(A.addDays(NOW, -13)); V.ate = TODAY; }
    updateTitle();
  }
  /** Faz a chamada, recarrega os dados e redesenha. Mostra o erro num aviso que chama atenção. */
  async function act(fn, onOk) {
    if (V.saving) return;
    V.saving = true;
    try {
      const r = await fn();
      await reload();
      if (onOk) onOk(r);
    } catch (e) {
      if (e.status === 401) { V.logged = false; S = null; }
      alerta(e.status === 409 ? 'aviso' : 'erro', e.status === 409 ? 'Não deu para fazer isso' : 'Não deu certo', e.message);
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
      try { await reload(); } catch { /* ignora */ }
      render();
      if (n.type === 'novo') alerta('ok', 'Novo agendamento!', `${first(n.clientName)} marcou ${String(a.service || 'um horário').toLowerCase()} para ${diaTxt(a.date)} às ${a.time}.`, [{ r: 'Ver agendamento', fn: () => openLado('ap', a.id) }]);
      else alerta('aviso', 'Horário cancelado pelo cliente', `${first(n.clientName)} cancelou ${diaTxt(a.date)} às ${a.time}. A vaga ficou livre no site.`);
      const b = $('#sinoBtn'); if (b) { b.classList.remove('toca'); void b.offsetWidth; b.classList.add('toca'); }
    });
  }
  function paintLive() { const el = $('#aoVivo'); if (el) { el.classList.toggle('on', V.live); el.lastChild.textContent = V.live ? 'Ao vivo' : 'Reconectando…'; } }

  // ===== Tela =====
  let lastSec = null;
  function render() {
    const root = $('#root');
    if (!V.logged || !S) { root.innerHTML = vLogin(); $('#overlay').innerHTML = ''; lastSec = null; return; }
    applyTheme(V.sec === 'cfg' && V.draft ? V.draft : S.settings);
    root.innerHTML = adminApp(lastSec !== V.sec);
    lastSec = V.sec;
    let cam = '';
    if (V.menu) cam += vGaveta();
    if (V.sino) cam += vSino();
    if (V.lado) cam += vLado();
    if (V.nv) cam += vNovo();
    $('#overlay').innerHTML = cam;
    updateTitle();
    paintSave();
  }

  function vLogin() {
    return `<div class="login">
      <div class="login-arte"><div class="listra" aria-hidden="true"></div>
        <div class="p-logo"><span class="av logo" style="width:42px;height:42px;font-size:17px">${ic('scissors', 20)}</span><div><b>Painel do barbeiro</b><small>Área só do barbeiro</small></div></div>
        <div><h2>Sua barbearia organizada num só lugar.</h2><p>Agenda do dia, clientes, financeiro e configurações. Tudo no computador ou no celular.</p></div>
        <div class="login-cards"><span>${ic('cal', 17)}Agenda em tempo real</span><span>${ic('users', 17)}Clientes fiéis</span><span>${ic('wallet', 17)}Caixa do mês</span></div>
      </div>
      <div class="login-form"><form id="loginForm" novalidate autocomplete="on">
        <h3>Entrar no painel</h3><p class="sub">Use o usuário e a senha do barbeiro.</p>
        <div class="campo"><label for="l-user">Usuário</label><div class="entrada" id="e-luser">${ic('user', 18)}<input id="l-user" autocomplete="username" autocapitalize="none" value="${esc(V.loginUser)}"></div></div>
        <div class="campo"><label for="l-pass">Senha</label><div class="entrada" id="e-lpass">${ic('lock', 18)}<input id="l-pass" type="password" autocomplete="current-password"><button type="button" class="olho" data-a="olho" aria-label="Mostrar senha">${ic('eye', 18)}</button></div></div>
        <button type="submit" class="btn pri bloco">${ic('arrow', 18)}Entrar</button>
        <a class="link" href="/">${ic('left', 16)}Voltar para o site</a>
      </form></div></div>`;
  }

  function menuItens() {
    const aguard = S.appts.filter((x) => x.date === TODAY && x.status === 'agendado').length;
    const it = (k, i, r) => `<button type="button" class="p-item ${V.sec === k ? 'on' : ''}" data-a="sec" data-s="${k}" ${V.sec === k ? 'aria-current="page"' : ''}>${ic(i, 20)}<span>${r}</span>${k === 'agenda' && aguard ? `<span class="cont">${aguard}</span>` : ''}</button>`;
    return `<div class="listra" aria-hidden="true"></div><div class="p-logo">${logo(42)}<div><b>${esc(S.settings.shopName)}</b><small>Painel do barbeiro</small></div></div>
      <div class="p-sec">Principal</div>${it('inicio', 'grid', 'Início')}${it('agenda', 'cal', 'Agenda')}${it('cli', 'users', 'Clientes')}
      <div class="p-sec">Gestão</div>${it('fin', 'wallet', 'Financeiro')}${it('cfg', 'cog', 'Configurações')}
      <div class="p-sec">Conta</div>${it('perfil', 'user', 'Meu perfil')}
      <div class="rodape-menu"><a class="p-item" href="/" target="_blank" rel="noopener">${ic('phone', 20)}<span>Ver site do cliente</span></a><button type="button" class="p-item" data-a="logout">${ic('out', 20)}<span>Sair</span></button></div>`;
  }
  function adminApp(anim) {
    const view = { inicio: vInicio, agenda: vAgenda, cli: vCli, fin: vFin, cfg: vCfg, perfil: vPerfil }[V.sec]();
    const n = unread();
    const needSound = Som.enabled() && !Som.ready();
    return `<div class="p-app">
      <nav class="p-menu" aria-label="Menu do painel"><div class="p-menu-in">${menuItens()}</div></nav>
      <div class="p-cont">
        <header class="p-topo">
          <button type="button" class="btn-icone menu-btn" data-a="menu" aria-label="Abrir menu">${ic('menu', 20)}</button>
          <h1>${TITULOS[V.sec]}</h1>
          <div class="direita">
            <span class="ao-vivo ${V.live ? 'on' : ''}" id="aoVivo" title="Avisos em tempo real"><i></i>${V.live ? 'Ao vivo' : 'Conectando…'}</span>
            ${window.U.tema.botao('btn-icone')}
            <button type="button" class="btn-icone" id="sinoBtn" data-a="sino" aria-label="Avisos${n ? `, ${n} novos` : ''}" aria-expanded="${V.sino}">${ic('bell', 20)}${n ? `<span class="bolinha">${n > 9 ? '9+' : n}</span>` : ''}</button>
            <button type="button" class="p-user" data-a="sec" data-s="perfil"><div><b>${esc(S.barber.name)}</b><small>Barbeiro</small></div><span class="av" style="width:34px;height:34px;font-size:13px">${esc(initials(S.barber.name))}</span></button>
          </div>
        </header>
        <main class="p-main ${anim ? 'vista' : ''}">
          ${needSound ? `<div class="faixa fina" data-t="info"><span class="f-ico">${ic('sound', 16)}</span><div><strong>Som dos avisos desligado</strong><p>Ligue para ouvir a campainha quando um cliente marcar.</p></div><button type="button" class="btn p" data-a="som-on">Ativar som</button></div>` : ''}
          ${view}
        </main>
      </div></div>`;
  }
  function vGaveta() {
    return `<div class="overlay" data-a="menu"></div><nav class="gaveta" aria-label="Menu do painel"><div class="p-menu-in">${menuItens()}</div></nav>`;
  }
  function timeAgo(at) {
    const m = Math.round((Date.now() - new Date(at).getTime()) / 60000);
    if (m < 1) return 'agora'; if (m < 60) return `há ${m} min`;
    const h = Math.round(m / 60); if (h < 24) return `há ${h} h`;
    const d = Math.round(h / 24); return `há ${d} dia${d > 1 ? 's' : ''}`;
  }
  function rAviso(n, del) {
    const novo = n.type === 'novo';
    const item = `<button type="button" class="aviso-i ${n.read ? '' : 'novo'}" data-k="${novo ? 'verde' : 'vermelho'}" data-a="ap" data-id="${n.appointmentId}"><span class="ico-k p">${ic(novo ? 'cal' : 'x', 17)}</span><div style="min-width:0"><b>${novo ? 'Novo agendamento' : 'Horário cancelado'}</b><small>${esc(n.clientName)} · ${diaTxt(n.date)} às ${n.time}</small></div><time>${timeAgo(n.at)}</time></button>`;
    return del ? `<div class="aviso-l">${item}<button type="button" class="aviso-del" data-a="n-del" data-id="${n.id}" aria-label="Apagar este aviso" title="Apagar aviso">${ic('trash', 16)}</button></div>` : item;
  }
  function vSino() {
    const l = S.notifications;
    return `<div class="overlay limpo" data-a="sino"></div><div class="sino-p" role="dialog" aria-label="Avisos">
      <div class="cartao-topo"><h3>Avisos</h3><div class="bts"><button type="button" class="link" data-a="som-toggle">${ic(Som.enabled() ? 'sound' : 'mute', 16)}${Som.enabled() ? 'Som ligado' : 'Som desligado'}</button>${l.length ? `<button type="button" class="link" data-a="n-clear-ask">${ic('trash', 15)}Limpar</button>` : ''}</div></div>
      ${V.nClearAsk ? `<div class="faixa" data-t="erro"><span class="f-ico">${ic('trash', 16)}</span><div><strong>Apagar todos os avisos?</strong><p>Os agendamentos continuam na agenda.</p><div style="display:flex;gap:8px;margin-top:8px"><button type="button" class="btn p verm" data-a="n-clear">Apagar</button><button type="button" class="btn p" data-a="n-clear-no">Voltar</button></div></div></div>` : ''}
      <div class="avisos-l">${l.length ? l.map((x) => rAviso(x, true)).join('') : '<div class="vazio" style="padding:18px 8px"><p>Quando um cliente marcar ou cancelar pelo site, o aviso aparece aqui.</p></div>'}</div></div>`;
  }

  // ===== Início (sem valores em dinheiro: a tela pode ficar à vista dos clientes) =====
  function greet() { const h = Math.floor(nowMin() / 60); return h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite'; }
  function vInicio() {
    const st = S.settings; const nm = nowMin();
    const hoje = sortAp(live().filter((x) => x.date === TODAY));
    const aguard = hoje.filter((x) => x.status === 'agendado');
    const at = hoje.filter((x) => x.status === 'realizado').length;
    const prox = aguard.find((x) => A.toMin(x.time) + x.dur > nm);
    const depois = !prox && sortAp(S.appts.filter((x) => x.date > TODAY && x.status === 'agendado'))[0];
    const ms = TODAY.slice(0, 8) + '01';
    const faltasMes = S.appts.filter((x) => x.status === 'faltou' && x.date >= ms && x.date <= TODAY).length;
    const aberto = daySlots(TODAY).length > 0; const hh = A.dayHours(st, NOW.getDay());
    const daysLeft = Math.round((A.parse(st.bookTo) - NOW) / 864e5);
    const kpi = (k, i, n, t, sub, alvo) => `<button type="button" class="kpi" data-k="${k}" data-a="ir-ag" data-v="${alvo}"><div class="kpi-topo"><span class="ico-k">${ic(i, 22)}</span>${ic('right', 18)}</div><b>${n}</b><p>${t}</p><span class="sub">${sub}</span></button>`;
    let proxCard = '';
    if (prox) {
      const c = cById(prox.clientId); const em = A.toMin(prox.time) - nm;
      proxCard = `<button type="button" class="prox" data-a="ap" data-id="${prox.id}"><small>Próximo cliente</small><div class="linha"><span class="av">${esc(initials(c.name))}</span><div><b>${esc(c.name)}</b><span>${prox.time} · ${esc(prox.service)}</span></div></div><span class="em">${ic('clock', 14)}${em > 0 ? `Começa em ${em >= 60 ? `${Math.floor(em / 60)}h${em % 60 ? String(em % 60).padStart(2, '0') : ''}` : `${em} min`}` : 'Em atendimento'}</span></button>`;
    } else if (depois) {
      const c = cById(depois.clientId); const dd = Math.round((A.parse(depois.date) - NOW) / 864e5);
      proxCard = `<button type="button" class="prox livre" data-a="ap" data-id="${depois.id}"><small>Próximo cliente</small><div class="linha"><span class="av">${esc(initials(c.name))}</span><div><b>${esc(c.name)}</b><span>${cap(diaTxt(depois.date))} às ${depois.time}</span></div></div><span class="em">${ic('cal', 14)}${dd === 1 ? 'Amanhã' : `Daqui a ${dd} dias`}</span></button>`;
    }
    // Na lista de hoje ficam só os que faltam atender; atendidos e faltas ficam guardados numa linha
    const feitos = hoje.filter((x) => x.status !== 'agendado');
    const mostra = V.verFeitos ? hoje : aguard;
    let agoraFeito = false;
    const tl = mostra.map((x) => {
      const c = cById(x.clientId); const k = x.status === 'realizado' ? 'verde' : x.status === 'faltou' ? 'vermelho' : x === prox ? 'accent' : 'laranja';
      let pre = '';
      if (!agoraFeito && A.toMin(x.time) >= nm) { agoraFeito = true; pre = '<div class="agora-linha"><span>Agora</span><i></i><hr></div>'; }
      const pil = x.status === 'realizado' ? '<span class="pilula" data-k="verde">Atendido</span>' : x.status === 'faltou' ? '<span class="pilula" data-k="vermelho">Não veio</span>' : '';
      return `${pre}<div class="tl-item ${x === prox ? 'agora' : ''} ${x.status !== 'agendado' ? 'feito' : ''}" data-k="${k}"><div class="tl-h">${x.time}<small>${endOf(x.time, x.dur)}</small></div><div class="tl-linha"><i></i></div>
        <div class="tl-card" role="button" tabindex="0" data-a="ap" data-id="${x.id}"><div><b>${esc(c.name)}</b><small>${esc(x.service)}</small></div>${pil || `<div class="acoes"><button type="button" class="btn ok-soft p" data-a="st" data-id="${x.id}" data-s="realizado">${ic('check', 15)}Atendido</button><button type="button" class="btn verm p" data-a="st" data-id="${x.id}" data-s="faltou">${ic('x', 15)}Não veio</button></div>`}</div></div>`;
    }).join('') + (mostra.length && !agoraFeito && aberto && nm < A.toMin(hh.close) ? '<div class="agora-linha"><span>Agora</span><i></i><hr></div>' : '');
    const nAt = feitos.filter((x) => x.status === 'realizado').length; const nFal = feitos.length - nAt;
    const linhaFeitos = feitos.length ? `<button type="button" class="tl-feitos" data-a="ver-feitos" aria-expanded="${!!V.verFeitos}"><span class="ico-k p" data-k="verde">${ic('check', 15)}</span><span>${nAt ? `<b>${nAt}</b> atendido${nAt > 1 ? 's' : ''}` : ''}${nAt && nFal ? ' · ' : ''}${nFal ? `<b>${nFal}</b> não ${nFal > 1 ? 'vieram' : 'veio'}` : ''}</span><span class="link">${V.verFeitos ? 'Esconder' : 'Mostrar'}</span></button>` : '';
    const resumo = hoje.length ? `Hoje você tem <b>${hoje.length} atendimento${hoje.length > 1 ? 's' : ''}</b>. ${aguard.length ? `Ainda falta${aguard.length > 1 ? 'm' : ''} <b>${aguard.length}</b>.` : 'Todos já foram atendidos.'}`
      : aberto ? 'Ninguém marcado para hoje ainda. Os horários livres já aparecem no site.' : `Hoje a barbearia está fechada${blockedOf(TODAY) ? ` (${esc(blockedOf(TODAY).why || 'folga')})` : ''}. Bom descanso!`;
    return `${daysLeft <= 10 ? `<div class="faixa" data-t="aviso"><span class="f-ico">${ic('alert', 18)}</span><div><strong>${daysLeft < 0 ? 'A agenda online está fechada' : `A agenda online fecha em ${shortDate(st.bookTo)}`}</strong><p>${daysLeft < 0 ? 'Nenhum cliente consegue marcar pelo site agora.' : 'Depois dessa data ninguém consegue marcar pelo site.'}</p></div><button type="button" class="btn p" data-a="ir-cfg">Abrir mais datas</button></div>` : ''}
    <section class="hero"><div><small>${cap(longDate(TODAY))}</small><h2>${greet()}, ${esc(first(S.barber.name))}.</h2><p>${resumo}</p>
      <div class="acoes-hero"><button type="button" class="btn-claro" data-a="novo">${ic('plus', 18)}<span class="so-pc">Novo agendamento</span><span class="so-cel">Agendar</span></button><button type="button" class="btn-vidro" data-a="ir-ag" data-v="hoje">${ic('cal', 18)}Ver agenda</button></div></div>${proxCard}</section>
    <div class="kpis">
      ${kpi('neutro', 'cal', hoje.length, 'Hoje', aberto ? `Entre ${hh.open} e ${hh.close}` : 'Hoje está fechado', 'hoje')}
      ${kpi('neutro', 'clock', aguard.length, 'Aguardando', prox ? `Próximo às ${prox.time}` : 'Ninguém na fila', 'hoje')}
      ${kpi('neutro', 'userok', at, 'Atendidos', 'Hoje, até agora', 'realizados')}
      ${kpi('vermelho', 'userx', faltasMes, 'Faltas no mês', 'Clientes que não vieram', 'faltas')}
    </div>
    <div class="duas-col">
      <section class="cartao"><div class="cartao-topo"><h3><span class="ico-k p">${ic('list', 17)}</span>Agenda de hoje</h3><button type="button" class="link" data-a="ir-ag" data-v="hoje">Ver tudo${ic('right', 16)}</button></div>
        ${linhaFeitos}<div class="tl">${tl || (aguard.length === 0 && hoje.length ? `<div class="vazio" style="padding:18px 10px"><span class="ico-k" data-k="verde">${ic('check', 24)}</span><h4>Todos de hoje já foram atendidos</h4><p>${depois ? `O próximo é ${esc(first(cById(depois.clientId).name))}, ${diaTxt(depois.date)} às ${depois.time}.` : 'Bom trabalho!'}</p></div>` : '') || `<div class="vazio"><span class="ico-k" data-k="${aberto ? 'verde' : 'cinza'}">${ic(aberto ? 'cal' : 'coffee', 26)}</span><h4>${aberto ? 'Nenhum atendimento hoje' : 'Hoje é dia de folga'}</h4><p>${aberto ? 'Quando alguém marcar, aparece aqui na hora.' : depois ? `O próximo cliente é ${esc(first(cById(depois.clientId).name))}, ${diaTxt(depois.date)} às ${depois.time}.` : 'Nenhum cliente marcado nos próximos dias.'}</p></div>`}</div></section>
      <div class="col">
        <section class="cartao acoes-ini"><div class="cartao-topo"><h3><span class="ico-k p">${ic('spark', 17)}</span>Ações rápidas</h3></div>
          <div class="acoes-rapidas">
            <button type="button" class="acao-rapida" data-a="novo"><span class="ico-k">${ic('plus')}</span><span>Novo agendamento<small>Encaixe ou cliente de balcão</small></span></button>
            <button type="button" class="acao-rapida" data-a="ir-folga"><span class="ico-k">${ic('ban')}</span><span>Bloquear um dia<small>Folga ou feriado</small></span></button>
            <button type="button" class="acao-rapida" data-a="ir-desp"><span class="ico-k">${ic('receipt')}</span><span>Lançar despesa<small>Produtos, contas</small></span></button>
            <button type="button" class="acao-rapida" data-a="ir-sumidos"><span class="ico-k">${ic('users')}</span><span>Clientes sumidos<small>Chame de volta</small></span></button>
          </div></section>
        <section class="cartao avisos-ini"><div class="cartao-topo"><h3><span class="ico-k p">${ic('bell', 17)}</span>Avisos recentes</h3>${S.notifications.length > 3 ? '<button type="button" class="link" data-a="sino">Ver todos</button>' : ''}</div>
          <div class="avisos-l">${S.notifications.slice(0, 3).map((x) => rAviso(x)).join('') || '<div class="muted" style="font-size:13.5px">Quando um cliente marcar ou cancelar pelo site, o aviso aparece aqui.</div>'}</div></section>
      </div>
    </div>`;
  }

  // ===== Agenda =====
  function listaAgenda(ab) {
    if (ab === 'hoje') return sortAp(S.appts.filter((x) => x.date === TODAY && x.status === 'agendado'));
    if (ab === 'amanha') return sortAp(S.appts.filter((x) => x.date === TOMORROW && x.status === 'agendado'));
    if (ab === 'proximos') return sortAp(S.appts.filter((x) => x.date > TOMORROW && x.status === 'agendado'));
    if (ab === 'realizados') return sortAp(S.appts.filter((x) => x.status === 'realizado')).reverse();
    if (ab === 'faltas') return sortAp(S.appts.filter((x) => x.status === 'faltou')).reverse();
    return sortAp(live().filter((x) => x.date === V.agDia));
  }
  function vAgenda() {
    const abas = [['hoje', 'Hoje', 'azul'], ['amanha', 'Amanhã', 'roxo'], ['proximos', 'Próximos', 'ciano']];
    const filtros = [['realizados', 'Realizados', 'verde'], ['faltas', 'Não compareceu', 'vermelho']];
    const chip = ([k, r, c]) => `<button type="button" class="chip ${V.vista === 'lista' && V.ab === k ? 'on' : ''}" data-k="${c}" data-a="ag-ab" data-v="${k}">${r}<b>${listaAgenda(k).length}</b></button>`;
    let corpo;
    if (V.vista === 'mes') corpo = vMes();
    else {
      const lista = listaAgenda(V.ab); const porDia = !['hoje', 'amanha', 'dia'].includes(V.ab);
      const grupos = []; lista.forEach((x) => { const g = grupos[grupos.length - 1]; if (g && g.date === x.date) g.l.push(x); else grupos.push({ date: x.date, l: [x] }); });
      const pg = porDia ? pagina(grupos, 'ag', 7, ' dias') : pagina(lista, 'ag'); const html = pg.html;
      const itens = porDia ? pg.itens.flatMap((g) => g.l) : pg.itens;
      const titulo = V.ab === 'dia' ? `<div class="faixa" data-t="info"><span class="f-ico">${ic('cal', 18)}</span><div><strong>${cap(longDate(V.agDia))}</strong><p>${lista.length ? `${lista.length} atendimento${lista.length > 1 ? 's' : ''} neste dia.` : !daySlots(V.agDia).length ? 'A barbearia está fechada neste dia.' : 'Nenhum agendamento neste dia ainda.'}</p></div><button type="button" class="btn p" data-a="vista" data-v="mes">${ic('left', 15)}Voltar ao mês</button></div>` : '';
      const col = (g, unico) => { const d = A.parse(g.date); const n = g.l.length; return `<section class="ag-col ${unico ? 'unico' : ''}"><header class="ag-col-topo"><div class="ag-col-cal"><small>${DOW[d.getDay()]}</small><b>${d.getDate()}</b></div><div class="tx"><h4>${g.date === TODAY ? 'Hoje' : g.date === TOMORROW ? 'Amanhã' : cap(DOWL[d.getDay()])}</h4><p>${d.getDate()} de ${MESES[d.getMonth()]}${d.getFullYear() !== A.parse(TODAY).getFullYear() ? ' de ' + d.getFullYear() : ''}</p></div><span class="qtd">${n} ${n === 1 ? 'horário' : 'horários'}</span></header><div class="ag-col-corpo">${g.l.map(agCard).join('')}</div></section>`; };
      const dias = porDia ? pg.itens : itens.length ? [{ date: itens[0].date, l: itens }] : [];
      const cards = !porDia ? dias.map((g) => col(g, true)).join('')
        : `<div class="ag-cols-topo"><small>${dias.length} ${dias.length === 1 ? 'dia' : 'dias'} com horário marcado<span class="ag-cols-dica">· arraste para o lado ${ic('right', 14)}</span></small><div class="ag-cols-setas"><button type="button" data-a="ag-rola" data-v="-1" aria-label="Dias anteriores">${ic('left', 18)}</button><button type="button" data-a="ag-rola" data-v="1" aria-label="Próximos dias">${ic('right', 18)}</button></div></div><div class="ag-cols" id="agCols">${dias.map((g) => col(g, false)).join('')}</div>`;
      const vazioTxt = V.ab === 'hoje' ? (daySlots(TODAY).length ? (S.appts.some((x) => x.date === TODAY && x.status === 'realizado') ? 'Todos os clientes de hoje já foram atendidos.' : 'Ninguém marcado para hoje ainda.') : 'Hoje a barbearia está fechada.')
        : V.ab === 'amanha' && !daySlots(TOMORROW).length ? 'Amanhã a barbearia está fechada.' : 'Nenhum agendamento nesta lista.';
      corpo = titulo + (itens.length ? `${cards}${html}` : V.ab === 'dia' ? '' : `<div class="cartao"><div class="vazio"><span class="ico-k" data-k="verde">${ic('check', 26)}</span><h4>Nada por aqui</h4><p>${vazioTxt}</p></div></div>`);
    }
    return `<div class="barra-filtros">
        <div class="esq"><div class="chips">${abas.map(chip).join('')}<span class="divisor-v"></span>${filtros.map(chip).join('')}</div></div>
        <div class="dir"><div class="seg"><button type="button" class="${V.vista === 'lista' ? 'on' : ''}" data-a="vista" data-v="lista">${ic('list', 16)}Lista</button><button type="button" class="${V.vista === 'mes' ? 'on' : ''}" data-a="vista" data-v="mes">${ic('cal', 16)}Mês</button></div>
        <button type="button" class="btn pri" data-a="novo">${ic('plus', 18)}Novo</button></div>
      </div>${corpo}`;
  }
  function agCard(x) {
    const c = cById(x.clientId);
    const pil = x.status === 'realizado' ? '<span class="pilula" data-k="verde">Atendido</span>' : x.status === 'faltou' ? '<span class="pilula" data-k="vermelho">Não veio</span>'
      : x.status === 'cancelado' ? '<span class="pilula" data-k="cinza">Cancelado</span>' : x.date <= TODAY ? '<span class="pilula viva" data-k="laranja">Aguardando</span>' : '<span class="pilula" data-k="azul">Confirmado</span>';
    let acoes = '';
    if (x.status === 'agendado') {
      if (V.cancel === x.id) acoes = `<div class="confirma"><span>${ic('alert', 18)}Cancelar o horário de ${esc(first(c.name))}? A vaga fica livre no site.</span><div><button type="button" class="btn p sim" data-a="st" data-id="${x.id}" data-s="cancelado">Sim, cancelar</button><button type="button" class="btn p" data-a="cancel-no">Voltar</button></div></div>`;
      else if (x.date <= TODAY) acoes = `<div class="acoes"><button type="button" class="btn ok-soft p" data-a="st" data-id="${x.id}" data-s="realizado">${ic('check', 15)}Atendido</button><button type="button" class="btn verm p" data-a="st" data-id="${x.id}" data-s="faltou">${ic('x', 15)}Não veio</button></div>`;
      else acoes = `<div class="acoes">${c.phone ? `<a class="btn p" href="${waLink(c.phone, waMsg(x))}" target="_blank" rel="noopener">${ic('whats', 15)}WhatsApp</a>` : ''}<button type="button" class="btn verm p" data-a="cancel-ask" data-id="${x.id}">${ic('x', 15)}Cancelar</button></div>`;
    }
    return `<div class="ag"><div class="topo"><span class="hr">${ic('clock', 15)}${x.time} – ${endOf(x.time, x.dur)}</span>${pil}</div>
      <button type="button" class="quem" data-a="ap" data-id="${x.id}">${avk(c)}<div><b>${esc(c.name)}</b><small>${ic('whats', 13)}${maskPhone(c.phone) || 'sem telefone'}</small></div></button>
      <div class="det"><span class="tag">${svcIcon(x.service).replace('<svg', '<svg width="14" height="14"')}${esc(x.service)}</span><b class="num">${money(x.price)}</b></div>${acoes}</div>`;
  }
  function vMes() {
    if (!V.calMonth) V.calMonth = TODAY.slice(0, 8) + '01';
    const m = A.parse(V.calMonth); const prim = new Date(m.getFullYear(), m.getMonth(), 1); const nd = new Date(m.getFullYear(), m.getMonth() + 1, 0).getDate();
    let cells = ''; for (let i = 0; i < prim.getDay(); i++) cells += '<div class="d vazio" aria-hidden="true"></div>';
    for (let d = 1; d <= nd; d++) {
      const ds = A.iso(new Date(m.getFullYear(), m.getMonth(), d)); const tot = daySlots(ds).length; const n = live().filter((x) => x.date === ds).length;
      if (!tot) { const b = blockedOf(ds); cells += `<button type="button" class="d fech ${ds === TODAY ? 'hoje' : ''}" data-a="ver-dia" data-v="${ds}"><span class="n">${d}</span><span class="q">${b ? esc(b.why || 'Folga') : 'Fechado'}</span>${n ? `<span class="q" style="color:var(--laranja)">${n} marcado${n > 1 ? 's' : ''}</span>` : ''}</button>`; continue; }
      const oc = Math.min(1, busy(ds).size / tot); const k = oc >= 0.85 ? 'vermelho' : oc >= 0.5 ? 'laranja' : 'verde';
      cells += `<button type="button" class="d ${ds === TODAY ? 'hoje' : ''} ${ds < TODAY ? 'passou' : ''}" data-k="${k}" data-a="ver-dia" data-v="${ds}"><span class="n">${d}</span><span class="q">${n} ${n === 1 ? 'cliente' : 'clientes'}</span><span class="barra"><i style="width:${Math.round(oc * 100)}%"></i></span></button>`;
    }
    return `<section class="cartao"><div class="cartao-topo"><h3><span class="ico-k p">${ic('cal', 17)}</span>${cap(MESES[m.getMonth()])} de ${m.getFullYear()}</h3>
      <div class="legenda"><span data-k="verde"><i></i>Tranquilo</span><span data-k="laranja"><i></i>Movimentado</span><span data-k="vermelho"><i></i>Quase cheio</span></div>
      <div class="mes-nav"><button type="button" class="btn-icone" data-a="mes-n" data-n="-1" aria-label="Mês anterior">${ic('left', 16)}</button><button type="button" class="btn p" data-a="mes-n" data-n="0">Hoje</button><button type="button" class="btn-icone" data-a="mes-n" data-n="1" aria-label="Próximo mês">${ic('right', 16)}</button></div></div>
      <div class="mes">${DOW.map((d) => `<div class="dw">${d}</div>`).join('')}${cells}</div></section>`;
  }

  // ===== Clientes =====
  function clientStats() {
    const ms = TODAY.slice(0, 8) + '01';
    const by = {}; for (const x of S.appts) (by[x.clientId] = by[x.clientId] || []).push(x);
    const arr = S.clients.map((c) => {
      const ap = by[c.id] || []; const done = ap.filter((x) => x.status === 'realizado');
      return { c, visits: done.length, spent: done.reduce((s, x) => s + x.price, 0), last: done.map((x) => x.date).sort().pop() || null, next: ap.filter((x) => x.status === 'agendado' && x.date >= TODAY).map((x) => x.date).sort()[0] || null, faltas: ap.filter((x) => x.status === 'faltou').length, thisMonth: done.some((x) => x.date >= ms) };
    });
    const top = arr.filter((x) => x.spent > 0).sort((p, q) => q.spent - p.spent).slice(0, 5);
    arr.forEach((x) => {
      const t = [];
      if (x.c.blocked) t.push(['vermelho', 'Bloqueado']);
      if (top.includes(x)) t.push(['roxo', 'Top gasto']);
      if (x.visits >= 4) t.push(['verde', 'Fiel']);
      if (!x.thisMonth && x.visits && !x.next) t.push(['laranja', 'Sumido no mês']);
      if (x.visits <= 1 && !x.c.blocked) t.push(['azul', 'Novo']);
      if (x.faltas >= 2) t.push(['vermelho', `${x.faltas} faltas`]);
      if (x.next) t.push(['cinza', `Volta ${shortDate(x.next)}`]);
      x.tags = t;
    });
    return { arr, top };
  }
  const sumido = (x) => !x.thisMonth && x.visits > 0 && !x.next;
  function listaClientes() {
    const { arr, top } = clientStats(); let l = arr;
    if (V.cliF === 'top') l = top;
    else if (V.cliF === 'fieis') l = arr.filter((x) => x.visits >= 4);
    else if (V.cliF === 'sumidos') l = arr.filter(sumido).sort((p, q) => (p.last || '').localeCompare(q.last || ''));
    else if (V.cliF === 'bloq') l = arr.filter((x) => x.c.blocked);
    if (!['top', 'sumidos'].includes(V.cliF)) l = l.slice().sort((p, q) => p.c.name.localeCompare(q.c.name));
    const q = V.cliQ.trim().toLowerCase(); const qd = digits(q);
    if (q) l = l.filter((x) => x.c.name.toLowerCase().includes(q) || (qd && x.c.phone.includes(qd)));
    return { l, arr, top };
  }
  function vCli() {
    const { arr, top } = listaClientes();
    const fs = [['todos', 'Todos', 'azul', arr.length], ['top', 'Quem mais gasta', 'roxo', top.length], ['fieis', 'Fiéis', 'verde', arr.filter((x) => x.visits >= 4).length], ['sumidos', 'Sumidos no mês', 'laranja', arr.filter(sumido).length], ['bloq', 'Bloqueados', 'vermelho', arr.filter((x) => x.c.blocked).length]];
    return `<div class="barra-filtros"><div class="entrada busca">${ic('search', 18)}<input id="cli-q" data-in="cli-q" placeholder="Buscar por nome ou WhatsApp" value="${esc(V.cliQ)}" aria-label="Buscar cliente"></div>
      <div class="chips">${fs.map(([k, r, c, n]) => `<button type="button" class="chip ${V.cliF === k ? 'on' : ''}" data-k="${c}" data-a="cli-f" data-v="${k}">${r}<b>${n}</b></button>`).join('')}</div></div>
      <div id="cliLista">${cliLista()}</div>`;
  }
  function cliLista() {
    const { l } = listaClientes(); const { itens, html } = pagina(l, 'cli');
    if (!itens.length) {
      const msg = !S.clients.length ? ['Nenhum cliente ainda', 'Os clientes aparecem aqui assim que fizerem o primeiro agendamento.'] : V.cliQ ? ['Nenhum cliente encontrado', 'Confira o nome ou tente buscar pelo WhatsApp.'] : V.cliF === 'sumidos' ? ['Ninguém sumido', 'Todo mundo que costuma vir já voltou este mês ou tem horário marcado.'] : V.cliF === 'bloq' ? ['Ninguém bloqueado', 'Para bloquear alguém, abra a ficha do cliente.'] : ['Ninguém nesta lista', 'Assim que tiver atendimentos, a lista enche.'];
      return `<div class="cartao"><div class="vazio"><span class="ico-k" data-k="laranja">${ic('search', 26)}</span><h4>${msg[0]}</h4><p>${msg[1]}</p></div></div>`;
    }
    return `<div class="cli-grid">${itens.map((x) => `<div class="cli ${x.c.blocked ? 'bloq' : ''}" role="button" tabindex="0" data-a="cli" data-id="${x.c.id}"><div class="topo">${avk(x.c)}<div><b>${esc(x.c.name)}</b><small>${maskPhone(x.c.phone)}</small></div></div>
      <div class="tags">${x.tags.map(([k, t]) => `<span class="tag" data-k="${k}">${t}</span>`).join('')}</div>
      <div class="nums"><div><small>Visitas</small><b>${x.visits}</b></div><div><small>Última</small><b>${x.last ? shortDate(x.last) : '—'}</b></div><div><small>Gastou</small><b>${money0(x.spent)}</b></div></div>
      ${x.c.blocked ? `<button type="button" class="btn p ok-soft" data-a="desbloq" data-id="${x.c.id}">${ic('check', 15)}Desbloquear</button>` : ''}</div>`).join('')}</div>${html}`;
  }

  // ===== Financeiro =====
  const CAT = { Produtos: ['roxo', 'spark'], Contas: ['laranja', 'zap'], Aluguel: ['azul', 'door'], 'Manutenção': ['verde', 'cog'], Outros: ['cinza', 'receipt'] };
  function faixaPer() {
    if (V.per === 'hoje') return [TODAY, TODAY];
    if (V.per === '7') return [A.iso(A.addDays(NOW, -6)), TODAY];
    if (V.per === 'mes') return [TODAY.slice(0, 8) + '01', TODAY];
    if (V.per === '30') return [A.iso(A.addDays(NOW, -29)), TODAY];
    return V.de <= V.ate ? [V.de, V.ate] : [V.ate, V.de];
  }
  function vFin() {
    const [de, ate] = faixaPer(); const n = Math.round((A.parse(ate) - A.parse(de)) / 864e5) + 1;
    const done = S.appts.filter((x) => x.status === 'realizado' && x.date >= de && x.date <= ate);
    const fat = done.reduce((s, x) => s + x.price, 0); const atend = done.length;
    const desp = S.expenses.filter((e) => e.date >= de && e.date <= ate).sort((p, q) => q.date.localeCompare(p.date) || Number(q.id) - Number(p.id));
    const totD = desp.reduce((s, e) => s + e.val, 0); const lucro = fat - totD;
    // barras: por dia até 2 meses; acima disso, por mês
    const barras = [];
    if (n <= 62) for (let i = 0; i < n; i++) { const ds = A.iso(A.addDays(A.parse(de), i)); barras.push([ds, done.filter((x) => x.date === ds).reduce((s, x) => s + x.price, 0), shortDate(ds), String(A.parse(ds).getDate())]); }
    else {
      const a = A.parse(de); const z = A.parse(ate);
      for (let d = new Date(a.getFullYear(), a.getMonth(), 1); d <= z; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) {
        const k = A.iso(d).slice(0, 7);
        barras.push([k, done.filter((x) => x.date.startsWith(k)).reduce((s, x) => s + x.price, 0), `${cap(MESES[d.getMonth()])}/${String(d.getFullYear()).slice(2)}`, MESES[d.getMonth()].slice(0, 3)]);
      }
    }
    const maxV = Math.max(100, Math.ceil(Math.max(0, ...barras.map((b) => b[1])) / 100) * 100);
    const rotEvery = barras.length > 16 ? Math.ceil(barras.length / 8) : 1;
    const pers = [['hoje', 'Hoje'], ['7', '7 dias'], ['mes', 'Este mês'], ['30', '30 dias'], ['per', 'Personalizado']];
    const kpi = (k, i, v, t, sub) => `<div class="kpi" data-k="${k}"><div class="kpi-topo"><span class="ico-k">${ic(i, 22)}</span></div><b class="num">${v}</b><p>${t}</p><span class="sub">${sub}</span></div>`;
    const porSvc = {}; done.forEach((x) => { porSvc[x.service] = (porSvc[x.service] || 0) + 1; });
    const ranking = Object.entries(porSvc).sort((p, q) => q[1] - p[1]); const rmax = ranking.length ? ranking[0][1] : 1;
    const { itens, html } = pagina(desp, 'desp');
    const periodoTxt = de === ate ? cap(longDate(de)) : `${DOW[A.parse(de).getDay()]}, ${shortDate(de)} a ${DOW[A.parse(ate).getDay()]}, ${shortDate(ate)}`;
    const grafico = n === 1
      ? `<div class="vazio" style="padding:24px 10px"><span class="ico-k" data-k="verde">${ic('trend', 26)}</span><h4>${money(fat)} hoje</h4><p>${atend ? `${atend} atendimento${atend > 1 ? 's' : ''} até agora. Para ver o gráfico, escolha 7 dias ou o mês.` : 'Nenhum atendimento marcado como atendido hoje ainda.'}</p></div>`
      : `<div class="grafico"><div class="g-eixo"><span>${money0(maxV)}</span><span>${money0(maxV / 2)}</span><span>R$ 0</span></div>
        <div class="g-area">${barras.map(([k, v, tip], i) => `<div class="g-bar ${i === barras.length - 1 ? 'ultimo' : ''}" tabindex="0"><i style="height:${(v / maxV) * 100}%"></i><span class="tip">${tip} · ${money(v)}</span></div>`).join('')}</div></div>
        <div class="g-rot">${barras.map(([, , , r], i) => `<span>${i % rotEvery === 0 || i === barras.length - 1 ? r : ''}</span>`).join('')}</div>`;
    const cats = Object.keys(CAT);
    return `<div class="barra-filtros"><div class="chips">${pers.map(([k, r]) => `<button type="button" class="chip ${V.per === k ? 'on' : ''}" data-a="per" data-v="${k}">${r}</button>`).join('')}</div>
        ${V.per === 'per' ? `<div class="periodo-custom"><div class="entrada"><input type="date" id="per-de" data-ch="per-de" value="${V.de}" max="${TODAY}" aria-label="De"></div><span class="muted">até</span><div class="entrada"><input type="date" id="per-ate" data-ch="per-ate" value="${V.ate}" aria-label="Até"></div></div>` : ''}</div>
      <div class="kpis fin">
        ${kpi('verde', 'trend', money(fat), 'Faturamento', periodoTxt)}
        ${kpi('vermelho', 'down', money(totD), 'Despesas', `${desp.length} lançamento${desp.length === 1 ? '' : 's'}`)}
        ${kpi(lucro >= 0 ? 'neutro' : 'vermelho', 'wallet', money(lucro), lucro >= 0 ? 'Lucro' : 'Prejuízo', 'Faturamento menos despesas')}
        ${kpi('neutro', 'userok', atend, 'Atendimentos', `Ticket médio ${money(atend ? fat / atend : 0)}`)}
      </div>
      <div class="duas-col">
        <section class="cartao"><div class="cartao-topo"><h3><span class="ico-k p">${ic('trend', 17)}</span>Faturamento por ${n <= 62 ? 'dia' : 'mês'}</h3>${n > 1 ? '<small>Passe o mouse ou toque nas barras</small>' : ''}</div>${grafico}</section>
        <section class="cartao"><div class="cartao-topo"><h3><span class="ico-k p">${ic('star', 17)}</span>Serviços mais feitos</h3></div>
          <div class="rank">${ranking.length ? ranking.map(([nome, q]) => `<div class="rank-i"><span class="ico-k p">${svcIcon(nome).replace('<svg', '<svg width="16" height="16"')}</span><b>${esc(nome)}</b><span>${q}×</span><div class="barra"><i style="width:${(q / rmax) * 100}%"></i></div></div>`).join('') : '<div class="muted" style="font-size:13.5px">Nenhum atendimento no período.</div>'}</div></section>
      </div>
      <section class="cartao" id="cartaoDesp"><div class="cartao-topo"><h3><span class="ico-k p">${ic('receipt', 17)}</span>Despesas do período</h3><button type="button" class="btn ${V.despForm ? '' : 'pri'} p" data-a="desp-form">${ic(V.despForm ? 'x' : 'plus', 16)}${V.despForm ? 'Fechar' : 'Adicionar despesa'}</button></div>
        ${V.despForm ? `<form class="form-desp" id="despForm" novalidate>
          <div class="campo"><label for="d-t">Descrição</label><div class="entrada" id="e-dt"><input id="d-t" placeholder="Ex.: Cera modeladora" maxlength="120"></div></div>
          <div class="campo"><label for="d-v">Valor</label><div class="entrada" id="e-dv"><span class="muted">R$</span><input id="d-v" inputmode="decimal" placeholder="0,00"></div></div>
          <div class="campo"><label for="d-c">Categoria</label><div class="entrada"><select id="d-c">${cats.map((c) => `<option>${c}</option>`).join('')}</select></div></div>
          <div class="campo"><label for="d-d">Data</label><div class="entrada" id="e-dd"><input id="d-d" type="date" value="${TODAY}" max="${TODAY}"></div></div>
          <button type="submit" class="btn verde" style="height:50px">${ic('check', 17)}Salvar</button></form>` : ''}
        ${itens.length ? `<div class="desp-grid">${itens.map((e) => {
          const [k, i] = CAT[e.cat] || CAT.Outros;
          if (V.despAsk === e.id) return `<div class="desp conf"><span>Excluir "${esc(e.desc)}" (${money(e.val)})?</span><div><button type="button" class="btn p verm" data-a="desp-del" data-id="${e.id}">Sim, excluir</button><button type="button" class="btn p" data-a="desp-no">Voltar</button></div></div>`;
          return `<div class="desp" data-k="${k}"><span class="ico-k p">${ic(i, 17)}</span><div style="min-width:0"><b>${esc(e.desc)}</b><small>${esc(e.cat)} · ${shortDate(e.date)}</small></div><span class="v">− ${money(e.val)}<button type="button" data-a="desp-ask" data-id="${e.id}">Excluir</button></span></div>`;
        }).join('')}</div>${html}` : `<div class="vazio"><p>Nenhuma despesa neste período.${V.despForm ? '' : ' Toque em "Adicionar despesa" para lançar uma.'}</p></div>`}
      </section>`;
  }

  // ===== Configurações (as mudanças ficam num rascunho até tocar em "Salvar alterações") =====
  const CORES = ['latao', 'azul', 'roxo', 'verde', 'laranja', 'rosa', 'ciano', 'bordo', 'prata'];
  function mkDraft() {
    const st = S.settings;
    return {
      shopName: st.shopName, tagline: st.tagline, address: st.address, phone: maskPhone(st.phone), color: st.color, custom: st.custom, logo: st.logo,
      days: [0, 1, 2, 3, 4, 5, 6].map((i) => ({ on: !st.closed.includes(i), ...A.dayHours(st, i) })),
      lunchStart: st.lunchStart, lunchEnd: st.lunchEnd, bookFrom: st.bookFrom, bookTo: st.bookTo,
      maxActive: st.maxActive, maxPerDay: st.maxPerDay, maxDevice: st.maxDevice, autoBlock: st.autoBlock,
      svcs: S.services.map((s) => ({ id: s.id, name: s.name, price: String(s.price).replace('.', ','), dur: s.dur })),
    };
  }
  const dirty = () => !!V.draft && JSON.stringify(V.draft) !== JSON.stringify(mkDraft());
  function paintSave() {
    const b = $('#salvarBarra'); if (!b) return;
    const d = dirty(); b.classList.toggle('sujo', d);
    b.querySelector('span').innerHTML = d ? `${ic('alert', 16)} Você tem mudanças que ainda não foram salvas.` : `${ic('info', 16)} As mudanças aparecem no site do cliente assim que você salvar.`;
    b.querySelector('button').disabled = !d;
  }
  function previa(d) {
    const fake = { ...S.settings, shopName: d.shopName || 'Sua barbearia', logo: d.logo };
    return `<div class="previa-cel" aria-hidden="true"><div><div class="pc-topo">${logo(24, fake)}<b>${esc(fake.shopName)}</b></div>
      <div class="pc-corpo"><div class="ph"><small>Agendamento online</small><b>${esc(d.tagline || fake.shopName)}</b><span>Agendar meu horário</span></div>
      <div class="pc-svc">${d.svcs.slice(0, 2).map((s) => `<div><i></i>${esc(s.name)}<em>R$ ${esc(s.price)}</em></div>`).join('')}</div><div class="pb">Confirmar agendamento</div></div></div></div>`;
  }
  function vCfg() {
    if (!V.draft) V.draft = mkDraft();
    const d = V.draft; const st = S.settings;
    const corAtual = d.color === 'custom' ? 'Outra cor' : (PRESETS[d.color] || PRESETS.latao)[0];
    const sel = (key, id, label, opts, help) => `<div class="campo"><label for="${id}">${label}</label><div class="entrada"><select id="${id}" data-d="${key}" data-num="1">${opts.map(([v, l]) => `<option value="${v}" ${Number(d[key]) === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div><span class="ajuda">${help}</span></div>`;
    const nOpt = (a, one, many) => a.map((v) => [v, `${v} ${v === 1 ? one : many}`]);
    const folgas = S.blocked.filter((b) => b.date >= TODAY);
    const bl = S.clients.filter((c) => c.blocked);
    const extra = !CORES.includes(d.color) && d.color !== 'custom' ? [d.color] : [];
    return `<div class="cfg-grid">
      <div class="col">
        <section class="cartao"><div class="cartao-topo"><h3><span class="ico-k p">${ic('palette', 17)}</span>Aparência do site</h3><small>Veja na prévia antes de salvar</small></div>
          <div class="form-g">
            <div class="campo"><label for="cfg-nome">Nome da barbearia</label><div class="entrada" id="e-cnome">${ic('scissors', 18)}<input id="cfg-nome" data-d="shopName" value="${esc(d.shopName)}" maxlength="60"></div></div>
            <div class="campo"><label>Logo</label><div class="logo-up">${logo(60)}<div style="flex:1;min-width:150px"><b style="font-size:14px">Sua logo aparece no site e no painel</b><div class="muted" style="font-size:12.5px">PNG ou JPG, quadrada, até 1,5 MB. Troca na hora.</div></div><div class="bts"><label class="btn p" for="cfg-logo" style="cursor:pointer">${ic('upload', 16)}${st.logo ? 'Trocar logo' : 'Enviar logo'}</label>${st.logo ? `<button type="button" class="btn p" data-a="logo-rm">${ic('trash', 15)}Tirar</button>` : ''}</div><input type="file" id="cfg-logo" accept="image/png,image/jpeg,image/webp,image/svg+xml" hidden data-ch="logo"></div></div>
            <div class="campo"><span class="lab">Cor de destaque <span class="muted" style="font-weight:500">· ${esc(corAtual)}</span></span><div class="cores">${[...CORES, ...extra].map((k) => `<button type="button" class="cor ${d.color === k ? 'on' : ''}" style="--c:${PRESETS[k][1]}" data-a="cor" data-v="${k}" aria-label="${PRESETS[k][0]}" title="${PRESETS[k][0]}"></button>`).join('')}
              <label class="cor outra ${d.color === 'custom' ? 'on' : ''}" title="Escolher outra cor" ${d.color === 'custom' ? `style="--c:${d.custom};background:${d.custom}"` : ''}><input type="color" value="${d.custom}" data-ch="cor-custom" aria-label="Escolher outra cor"></label></div></div>
            ${previa(d)}
          </div></section>
        <section class="cartao"><div class="cartao-topo"><h3><span class="ico-k p">${ic('pin', 17)}</span>O que o cliente vê</h3></div>
          <div class="form-g">
            <div class="campo"><label for="cfg-tag">Frase de boas-vindas</label><div class="entrada" id="e-ctag"><input id="cfg-tag" data-d="tagline" value="${esc(d.tagline)}" maxlength="140"></div></div>
            <div class="campo"><label for="cfg-fone">WhatsApp da barbearia</label><div class="entrada" id="e-cfone">${ic('whats', 18)}<input id="cfg-fone" data-d="phone" data-mask="1" inputmode="tel" placeholder="(16) 99999-9999" value="${esc(d.phone)}"></div><span class="ajuda">Aparece no site para o cliente chamar no WhatsApp. Pode deixar em branco.</span></div>
            <div class="campo"><label for="cfg-end">Endereço</label><div class="entrada">${ic('pin', 18)}<input id="cfg-end" data-d="address" value="${esc(d.address)}" maxlength="140" placeholder="Rua, número - bairro, cidade"></div><span class="ajuda">Usado no mapa do site.</span></div>
          </div></section>
        <section class="cartao"><div class="cartao-topo"><h3><span class="ico-k p">${ic('clock', 17)}</span>Horário de funcionamento</h3></div>
          <div class="lista-v">${[1, 2, 3, 4, 5, 6, 0].map((i) => { const x = d.days[i]; return `<div class="dia-func ${x.on ? '' : 'off'}" id="e-dia${i}"><button type="button" class="chave ${x.on ? 'on' : ''}" data-a="dia-on" data-v="${i}" aria-label="${cap(DOWL[i])}: ${x.on ? 'aberto' : 'fechado'}" aria-pressed="${x.on}"></button><b>${cap(DOWL[i])}</b><div class="hs">${x.on ? `<div class="entrada"><input type="time" step="1800" value="${x.open}" data-dia="${i}" data-k="open" aria-label="Abre"></div>às<div class="entrada"><input type="time" step="1800" value="${x.close}" data-dia="${i}" data-k="close" aria-label="Fecha"></div>` : '<span class="tag" data-k="cinza">Fechado</span>'}</div></div>`; }).join('')}
            <div class="dia-func almoco" id="e-almoco"><span class="ico-k p" data-k="laranja">${ic('coffee', 16)}</span><b>Almoço</b><div class="hs"><div class="entrada"><input type="time" step="1800" value="${d.lunchStart}" data-d="lunchStart" aria-label="Início do almoço"></div>às<div class="entrada"><input type="time" step="1800" value="${d.lunchEnd}" data-d="lunchEnd" aria-label="Fim do almoço"></div></div></div>
            <span class="ajuda muted" style="font-size:12px">Sem pausa para almoço? Coloque o mesmo horário nos dois campos.</span></div></section>
      </div>
      <div class="col">
        <section class="cartao"><div class="cartao-topo"><h3><span class="ico-k p">${ic('scissors', 17)}</span>Serviços e preços</h3><button type="button" class="btn p" data-a="svc-add">${ic('plus', 16)}Adicionar</button></div>
          <div class="lista-v">${d.svcs.map((s, i) => `<div class="cfg-svc" id="e-svc${i}"><span class="ico-k p">${svcIcon(s.name).replace('<svg', '<svg width="16" height="16"')}</span><div class="entrada"><input value="${esc(s.name)}" data-svc="${i}" data-k="name" maxlength="60" aria-label="Nome do serviço"></div>
            <div class="linha2"><div class="entrada"><select data-svc="${i}" data-k="dur" aria-label="Duração">${[30, 60, 90, 120].map((m) => `<option value="${m}" ${s.dur === m ? 'selected' : ''}>${tempo(m)}</option>`).join('')}</select></div><div class="entrada"><span class="muted" style="font-size:13px">R$</span><input value="${esc(s.price)}" inputmode="decimal" data-svc="${i}" data-k="price" aria-label="Preço"></div></div>
            <button type="button" class="btn-icone" data-a="svc-del" data-id="${s.id}" aria-label="Remover ${esc(s.name)}">${ic('trash', 16)}</button></div>`).join('')}</div>
          <p class="muted" style="font-size:12.5px;margin:12px 0 0">Mudar o preço não muda atendimentos antigos. O financeiro guarda o valor cobrado no dia.</p></section>
        <section class="cartao"><div class="cartao-topo"><h3><span class="ico-k p">${ic('cal', 17)}</span>Agenda aberta e folgas</h3></div>
          <div class="form-g"><div class="duas"><div class="campo"><label for="cfg-de">Clientes podem agendar de</label><div class="entrada" id="e-cde"><input type="date" id="cfg-de" data-d="bookFrom" value="${d.bookFrom}"></div></div><div class="campo"><label for="cfg-ate">Até</label><div class="entrada" id="e-cate"><input type="date" id="cfg-ate" data-d="bookTo" value="${d.bookTo}"></div></div></div>
            <div class="chips">${[['Até o fim do mês', 0], ['Até o fim do próximo mês', 1], ['Por 3 meses', 2]].map(([l, n]) => `<button type="button" class="chip" data-a="bk-quick" data-n="${n}">${l}</button>`).join('')}</div>
            <div class="campo"><span class="lab">Dias bloqueados</span><div class="folgas">${folgas.map((f) => `<span class="folga">${ic('ban', 14)}${shortDate(f.date)} · ${esc(f.why || 'Folga')}<button type="button" data-a="folga-del" data-v="${f.date}" aria-label="Liberar ${shortDate(f.date)}">${ic('x', 13)}</button></span>`).join('') || '<span class="muted" style="font-size:13px">Nenhum dia bloqueado.</span>'}</div></div>
            <div class="folga-add"><div class="campo"><label for="cfg-folga">Bloquear outro dia</label><div class="entrada" id="e-folga"><input type="date" id="cfg-folga" min="${TODAY}"></div></div><div class="campo"><label for="cfg-folga-r">Motivo</label><div class="entrada"><input id="cfg-folga-r" placeholder="Folga, feriado…" maxlength="80"></div></div><button type="button" class="btn" style="height:50px" data-a="folga-add">${ic('plus', 16)}Bloquear</button></div></div></section>
        <section class="cartao"><div class="cartao-topo"><h3><span class="ico-k p">${ic('shield', 17)}</span>Proteção contra trote</h3></div>
          <p class="muted" style="font-size:13px;margin:-6px 0 14px">Freia quem marca vários horários pelo site só para atrapalhar. Pelo painel você continua marcando sem limite.</p>
          <div class="form-g"><div class="duas">${sel('maxActive', 'cfg-ma', 'Horários marcados por cliente', [[0, 'Sem limite'], ...nOpt([1, 2, 3, 4, 5], 'por vez', 'ao mesmo tempo')], 'Quando um passa, pode marcar outro.')}
            ${sel('maxPerDay', 'cfg-md', 'Máximo por cliente no dia', [[0, 'Sem limite'], ...nOpt([1, 2, 3], 'por dia', 'por dia')], 'Evita a mesma pessoa pegar a tarde inteira.')}</div>
            <div class="duas">${sel('maxDevice', 'cfg-mv', 'Agendamentos por celular em 24 h', [[0, 'Sem limite'], ...nOpt([2, 3, 4, 5, 8, 10], 'agendamento', 'agendamentos')], 'Pega quem inventa vários nomes no mesmo celular.')}
            ${sel('autoBlock', 'cfg-ab', 'Bloquear depois de', [[0, 'Nunca bloquear sozinho'], ...[1, 2, 3, 4, 5].map((v) => [v, `${v} falta${v > 1 ? 's' : ''}`])], 'Conta quando você toca em "Não veio".')}</div>
            <div class="campo"><span class="lab">Clientes bloqueados${bl.length ? ` (${bl.length})` : ''}</span><div class="bloq-l">${bl.map((c) => `<div class="bloq-i"><span class="ico-k p">${ic('ban', 16)}</span><div style="min-width:0"><b>${esc(c.name)}</b><small>${esc(c.blockedReason || 'Bloqueado pelo barbeiro')}</small></div><button type="button" class="btn p ok-soft" data-a="desbloq" data-id="${c.id}">Desbloquear</button></div>`).join('') || '<span class="muted" style="font-size:13px">Ninguém bloqueado. Para bloquear, abra a ficha do cliente.</span>'}</div></div></div></section>
      </div></div>
      <div class="salvar-barra" id="salvarBarra"><span></span><button type="button" class="btn pri" data-a="salvar">${ic('check', 17)}Salvar alterações</button></div>`;
  }
  /** Confere o rascunho e manda para o servidor. Volta true se salvou. */
  async function salvarCfg() {
    const d = V.draft; const st = S.settings;
    const erro = (t, x, alvo) => { alerta('erro', t, x); if (alvo) marcar(alvo); return false; };
    if (!d.shopName.trim()) return erro('Falta o nome da barbearia', 'Escreva o nome que aparece no site.', '#e-cnome');
    if (!d.tagline.trim()) return erro('Falta a frase de boas-vindas', 'Ela aparece em destaque no início do site.', '#e-ctag');
    const fone = digits(d.phone); if (fone && (fone.length < 10 || fone.length > 11)) return erro('WhatsApp incompleto', 'Digite o WhatsApp da barbearia com DDD, ou deixe em branco.', '#e-cfone');
    const abertos = [0, 1, 2, 3, 4, 5, 6].filter((i) => d.days[i].on);
    if (!abertos.length) return erro('A barbearia precisa abrir pelo menos um dia', 'Ligue a chave de algum dia da semana.');
    for (const i of abertos) { const x = d.days[i]; if (!A.isTime(x.open) || !A.isTime(x.close) || A.toMin(x.open) >= A.toMin(x.close)) return erro(`Confira o horário de ${DOWL[i]}`, 'O horário de abrir precisa ser antes do de fechar.', '#e-dia' + i); }
    if (A.toMin(d.lunchStart) > A.toMin(d.lunchEnd)) return erro('Confira o almoço', 'O fim do almoço precisa ser depois do começo.', '#e-almoco');
    if (!d.bookFrom || !d.bookTo || d.bookFrom > d.bookTo) return erro('Confira as datas da agenda', 'A data final precisa ser depois da inicial.', '#e-cate');
    for (let i = 0; i < d.svcs.length; i++) {
      const s = d.svcs[i]; const p = parseFloat(String(s.price).replace(/\s/g, '').replace(',', '.'));
      if (!s.name.trim()) return erro('Serviço sem nome', 'Escreva o nome de cada serviço.', '#e-svc' + i);
      if (!(p >= 0)) return erro(`Preço inválido em ${s.name}`, 'Digite só números. Ex.: 35 ou 35,50.', '#e-svc' + i);
    }
    const hours = {}; d.days.forEach((x, i) => { hours[i] = { open: x.open, close: x.close }; });
    const patch = {
      shopName: d.shopName.trim(), tagline: d.tagline.trim(), address: d.address.trim(), phone: fone, color: d.color, custom: d.custom, hours,
      closed: [0, 1, 2, 3, 4, 5, 6].filter((i) => !d.days[i].on),
      open: abertos.map((i) => d.days[i].open).sort()[0], close: abertos.map((i) => d.days[i].close).sort().pop(),
      lunchStart: d.lunchStart, lunchEnd: d.lunchEnd, bookFrom: d.bookFrom, bookTo: d.bookTo,
      maxActive: Number(d.maxActive), maxPerDay: Number(d.maxPerDay), maxDevice: Number(d.maxDevice), autoBlock: Number(d.autoBlock),
    };
    const mudouSvc = d.svcs.filter((s) => { const o = S.services.find((x) => x.id === s.id); return o && (o.name !== s.name.trim() || o.dur !== s.dur || o.price !== parseFloat(String(s.price).replace(',', '.'))); });
    V.saving = true;
    try {
      await api('PUT', '/api/admin/configuracoes', patch);
      for (const s of mudouSvc) await api('PUT', '/api/admin/servicos/' + s.id, { name: s.name.trim(), dur: s.dur, price: parseFloat(String(s.price).replace(',', '.')) });
      await reload(); V.draft = mkDraft();
      alerta('ok', 'Configurações salvas', 'O site do cliente já está com as mudanças.');
      return true;
    } catch (e) {
      alerta('erro', 'Não deu para salvar', e.message);
      try { await reload(); } catch { /* ignora */ }
      return false;
    } finally { V.saving = false; render(); }
  }

  // ===== Meu perfil =====
  function vPerfil() {
    const b = S.barber;
    return `<div class="perfil-c">
      <div class="perfil-topo"><span class="av">${esc(initials(b.name))}</span><div><b>${esc(b.name)}</b><small>Barbeiro · ${esc(S.settings.shopName)}</small></div><button type="button" class="btn-vidro" data-a="logout">${ic('out', 17)}Sair do painel</button></div>
      <form class="cartao form-g" id="profForm" novalidate><div class="cartao-topo" style="margin:0"><h3><span class="ico-k p">${ic('user', 17)}</span>Dados de acesso</h3></div>
        <div class="duas"><div class="campo"><label for="pp-n">Nome</label><div class="entrada" id="e-ppn"><input id="pp-n" value="${esc(b.name)}" autocomplete="name"></div></div><div class="campo"><label for="pp-u">Usuário</label><div class="entrada" id="e-ppu"><input id="pp-u" value="${esc(b.user)}" autocomplete="username" autocapitalize="none"></div></div></div>
        <div class="campo"><label for="pp-e">E-mail</label><div class="entrada" id="e-ppe"><input id="pp-e" type="email" value="${esc(b.email || '')}" autocomplete="email" placeholder="opcional"></div></div>
        <div><button type="submit" class="btn pri">${ic('check', 17)}Salvar dados</button></div></form>
      <form class="cartao form-g" id="pwForm" novalidate><div class="cartao-topo" style="margin:0"><h3><span class="ico-k p">${ic('lock', 17)}</span>Trocar senha</h3></div>
        <div class="campo"><label for="ps-a">Senha atual</label><div class="entrada" id="e-psa"><input id="ps-a" type="password" autocomplete="current-password"></div></div>
        <div class="duas"><div class="campo"><label for="ps-n">Nova senha</label><div class="entrada" id="e-psn"><input id="ps-n" type="password" placeholder="Mínimo 6 caracteres" autocomplete="new-password"></div></div><div class="campo"><label for="ps-c">Repita a nova senha</label><div class="entrada" id="e-psc"><input id="ps-c" type="password" autocomplete="new-password"></div></div></div>
        <div><button type="submit" class="btn pri">${ic('check', 17)}Trocar senha</button></div></form></div>`;
  }

  // ===== Ficha lateral: agendamento ou cliente =====
  function openLado(type, id) { V.lado = { type, id }; V.ladoAsk = null; V.sino = false; V.menu = false; render(); }
  function vLado() {
    const d = V.lado; let h = '', b = '';
    if (d.type === 'ap') {
      const x = S.appts.find((y) => y.id === d.id);
      if (!x) { V.lado = null; return ''; }
      const c = cById(x.clientId);
      const pil = { agendado: x.date <= TODAY ? ['laranja', 'Aguardando'] : ['azul', 'Confirmado'], realizado: ['verde', 'Atendido'], faltou: ['vermelho', 'Não veio'], cancelado: ['cinza', 'Cancelado'] }[x.status];
      h = `<div><small class="muted" style="font-weight:700;font-size:12px;letter-spacing:.08em;text-transform:uppercase">${cap(longDate(x.date))}</small><h3 style="font-size:28px;font-family:var(--f-body);font-weight:800;letter-spacing:-.02em">${x.time} às ${endOf(x.time, x.dur)}</h3></div>`;
      b = `<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><span class="pilula" data-k="${pil[0]}">${pil[1]}</span><span class="muted" style="font-size:12.5px">${x.origin === 'site' ? 'Marcado pelo site' : 'Marcado no painel'}</span></div>
        <button type="button" class="quem-l" data-a="cli" data-id="${c.id}">${avk(c, 44)}<div><b>${esc(c.name)}</b><small>${maskPhone(c.phone)} · ver ficha</small></div>${c.blocked ? '<span class="tag" data-k="vermelho">Bloqueado</span>' : ic('right', 18)}</button>
        <div class="kv"><div><small>Serviço</small><b>${esc(x.service)}</b></div><div><small>Duração</small><b>${tempo(x.dur)}</b></div><div><small>Valor</small><b class="num">${money(x.price)}</b></div></div>
        ${x.status === 'agendado' ? `<div class="acoes"><button type="button" class="btn ok-soft" data-a="st" data-id="${x.id}" data-s="realizado">${ic('check', 16)}Atendido</button><button type="button" class="btn verm" data-a="st" data-id="${x.id}" data-s="faltou">${ic('x', 16)}Não veio</button></div>
          ${V.ladoAsk === 'cancel' ? `<div class="confirma"><span>Cancelar o horário de ${esc(first(c.name))}? A vaga fica livre no site.</span><div><button type="button" class="btn p sim" data-a="st" data-id="${x.id}" data-s="cancelado">Sim, cancelar</button><button type="button" class="btn p" data-a="lado-no">Voltar</button></div></div>` : `<button type="button" class="btn" data-a="lado-ask" data-v="cancel">${ic('ban', 16)}Cancelar agendamento</button>`}`
          : `<button type="button" class="btn" data-a="st" data-id="${x.id}" data-s="agendado">${ic('undo', 16)}Voltar para aguardando</button>`}
        ${c.phone ? `<a class="btn" href="${waLink(c.phone, x.status === 'agendado' ? waMsg(x) : '')}" target="_blank" rel="noopener">${ic('whats', 16)}Chamar no WhatsApp</a>` : ''}`;
    } else {
      const { arr } = clientStats(); const x = arr.find((y) => y.c.id === d.id);
      if (!x) { V.lado = null; return ''; }
      const hist = sortAp(live().filter((y) => y.clientId === x.c.id)).reverse().slice(0, 12);
      const fut = live().filter((y) => y.clientId === x.c.id && y.status === 'agendado' && y.date >= TODAY).length;
      h = `<div style="display:flex;gap:14px;align-items:center;min-width:0">${avk(x.c, 52)}<div style="min-width:0"><h3 style="font-size:22px">${esc(x.c.name)}</h3><span class="muted" style="font-size:13px">Cliente desde ${shortDate(x.c.since)}/${A.parse(x.c.since).getFullYear()}</span></div></div>`;
      const pilHist = { agendado: ['azul', 'Marcado'], realizado: ['verde', 'Atendido'], faltou: ['vermelho', 'Não veio'] };
      b = `${x.c.blocked ? `<div class="faixa" data-t="erro"><span class="f-ico">${ic('ban', 17)}</span><div><strong>Bloqueado no site</strong><p>${esc(x.c.blockedReason || 'Bloqueado pelo barbeiro')}. Pelo painel você ainda consegue agendar.</p></div><button type="button" class="btn p ok-soft" data-a="desbloq" data-id="${x.c.id}">Desbloquear</button></div>` : ''}
        ${x.tags.length ? `<div style="display:flex;gap:6px;flex-wrap:wrap">${x.tags.map(([k, t]) => `<span class="tag" data-k="${k}">${t}</span>`).join('')}</div>` : ''}
        <div class="kv"><div><small>Visitas</small><b>${x.visits}</b></div><div><small>Gastou</small><b>${money0(x.spent)}</b></div><div><small>Faltas</small><b>${x.faltas}</b></div></div>
        <form id="cliForm" data-id="${x.c.id}" class="form-g" novalidate><div class="campo"><label for="cd-n">Nome</label><div class="entrada" id="e-cdn"><input id="cd-n" value="${esc(x.c.name)}"></div></div>
          <div class="campo"><label for="cd-p">WhatsApp</label><div class="entrada" id="e-cdp">${ic('whats', 18)}<input id="cd-p" value="${esc(maskPhone(x.c.phone))}" data-in="mask" inputmode="tel"></div></div>
          <div class="acoes"><button type="submit" class="btn pri">${ic('check', 16)}Salvar dados</button>${x.c.phone ? `<a class="btn" href="${waLink(x.c.phone)}" target="_blank" rel="noopener">${ic('whats', 16)}WhatsApp</a>` : ''}</div></form>
        <div><span class="lab" style="font-size:13px;font-weight:700;color:var(--ink-soft)">Histórico</span><div class="hist" style="margin-top:8px">${hist.map((y) => `<button type="button" data-a="ap" data-id="${y.id}"><b class="num">${shortDate(y.date)}</b><div style="min-width:0"><b>${esc(y.service)}</b><small>${y.time} · ${money0(y.price)}</small></div><span class="pilula" data-k="${pilHist[y.status][0]}">${pilHist[y.status][1]}</span></button>`).join('') || '<span class="muted" style="font-size:13px">Sem histórico ainda.</span>'}</div></div>
        ${x.c.blocked ? '' : V.ladoAsk === 'block' ? `<div class="confirma"><span>Bloquear ${esc(first(x.c.name))}? Não vai conseguir mais marcar pelo site${fut ? ` e ${fut === 1 ? 'o horário já marcado será cancelado' : `os ${fut} horários já marcados serão cancelados`}` : ''}.</span><div><button type="button" class="btn p sim" data-a="bloq" data-id="${x.c.id}">Sim, bloquear</button><button type="button" class="btn p" data-a="lado-no">Voltar</button></div></div>`
          : `<button type="button" class="btn verm" data-a="lado-ask" data-v="block">${ic('ban', 16)}Bloquear cliente</button>`}`;
    }
    return `<div class="overlay" data-a="lado-x"></div><aside class="lado" role="dialog" aria-modal="true"><div class="folha-topo">${h}<button type="button" class="btn-icone" data-a="lado-x" aria-label="Fechar">${ic('x', 18)}</button></div>${b}</aside>`;
  }

  // ===== Novo agendamento (encaixe ou cliente que ligou) =====
  const norm = (t) => String(t).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  function novoAg() {
    V.menu = false; V.sino = false; V.lado = null;
    V.nv = { cid: '', q: '', isNew: false, name: '', phone: '', date: TODAY, time: '', svc: S.services[0].id };
    for (let i = 0; i < 60 && !freeCount(V.nv.date); i++) V.nv.date = A.iso(A.addDays(NOW, i + 1)); // primeiro dia com horário livre
    render(); setTimeout(() => { const f = $('#nv-q'); if (f && matchMedia('(min-width:901px)').matches) f.focus(); }, 60);
  }
  function nvSug(q) {
    q = String(q || '').trim();
    if (q.length < 2) return '';
    const d = digits(q); const nq = norm(q);
    const l = S.clients.filter((c) => norm(c.name).includes(nq) || (d.length >= 3 && c.phone.includes(d)))
      .sort((p, r) => (norm(p.name).startsWith(nq) ? 0 : 1) - (norm(r.name).startsWith(nq) ? 0 : 1) || p.name.localeCompare(r.name)).slice(0, 5);
    return l.map((c) => `<button type="button" data-a="nv-pick" data-id="${c.id}">${avk(c, 30)}<span><b>${esc(c.name)}</b><small>${maskPhone(c.phone)}</small></span></button>`).join('')
      + `<button type="button" class="novo" data-a="nv-new"><span class="ico-k p" style="width:30px;height:30px">${ic('userplus', 16)}</span><span><b>Cadastrar cliente novo</b><small>${l.length ? 'Não é nenhum desses?' : 'Ninguém com esse nome ainda'}</small></span></button>`;
  }
  function nvAviso() {
    const nv = V.nv; const s = S.services.find((x) => x.id === nv.svc) || S.services[0];
    if (!nv.time) return '';
    if (fits(nv.date, nv.time, s.dur)) return `<div class="faixa" data-t="ok"><span class="f-ico">${ic('check', 18)}</span><div><strong>Cabe certinho</strong><p>${esc(s.name)} das ${nv.time} às ${endOf(nv.time, s.dur)}.</p></div></div>`;
    const r = whyNot(nv.date, nv.time, s.dur) || { m: 'ocupado' };
    const mot = r.m === 'fecha' ? `Terminaria às ${endOf(nv.time, s.dur)}, depois do fechamento.` : r.m === 'almoco' ? 'Entraria no horário de almoço.' : `Às ${r.t || 'esse horário'} já tem cliente.`;
    return `<div class="faixa pisca" data-t="erro"><span class="f-ico">${ic('ban', 18)}</span><div><strong>${esc(s.name)} não cabe às ${nv.time}</strong><p>${mot} Escolha outro horário ou serviço.</p></div></div>`;
  }
  function vNovo() {
    const nv = V.nv; const dias = [];
    for (let i = 0; i < 60 && dias.length < 30; i++) { const ds = A.iso(A.addDays(NOW, i)); if (daySlots(ds).length) dias.push(ds); }
    if (!dias.includes(nv.date)) dias.unshift(nv.date);
    const bz = busy(nv.date); const livres = daySlots(nv.date).filter((t) => !bz.has(t) && !isPast(nv.date, t));
    if (nv.time && !livres.includes(nv.time)) nv.time = '';
    let cli;
    if (nv.cid) { const c = cById(nv.cid); cli = `<div class="sel-cli">${ic('userok', 18)}<span>${esc(c.name)} <small>${maskPhone(c.phone)}</small></span><button type="button" class="link" data-a="nv-clear">Trocar</button></div>`; }
    else if (nv.isNew) cli = `<div class="duas"><div class="entrada" id="e-nvn">${ic('user', 18)}<input id="nv-name" data-in="nv-name" value="${esc(nv.name)}" placeholder="Nome e sobrenome" autocomplete="off" aria-label="Nome do cliente"></div><div class="entrada" id="e-nvp">${ic('whats', 18)}<input id="nv-phone" data-in="nv-phone" value="${esc(maskPhone(nv.phone))}" placeholder="WhatsApp com DDD" inputmode="tel" autocomplete="off" aria-label="WhatsApp do cliente"></div></div><button type="button" class="link" data-a="nv-clear" style="align-self:flex-start">${ic('search', 15)}Buscar cliente cadastrado</button>`;
    else cli = `<div class="entrada" id="e-nvq">${ic('search', 18)}<input id="nv-q" data-in="nv-q" placeholder="Digite o nome ou o WhatsApp" value="${esc(nv.q)}" autocomplete="off" aria-controls="nvSug"></div><div class="sugest" id="nvSug">${nvSug(nv.q)}</div>`;
    return `<div class="overlay" data-a="nv-x"></div><form class="janela" id="nvForm" novalidate role="dialog" aria-modal="true" aria-label="Novo agendamento">
      <div class="folha-topo"><div><h3>Novo agendamento</h3><p>Para encaixe ou cliente que ligou.</p></div><button type="button" class="btn-icone" data-a="nv-x" aria-label="Fechar">${ic('x', 18)}</button></div>
      <div class="campo"><label for="nv-q">${nv.isNew ? 'Cliente novo' : 'Cliente'}</label>${cli}</div>
      <div class="duas"><div class="campo"><label for="nv-d">Dia</label><div class="entrada">${ic('cal', 18)}<select id="nv-d" data-nv="date">${dias.map((ds) => `<option value="${ds}" ${ds === nv.date ? 'selected' : ''}>${DOW[A.parse(ds).getDay()]}, ${shortDate(ds)}${ds === TODAY ? ' (hoje)' : ds === TOMORROW ? ' (amanhã)' : ''}</option>`).join('')}</select></div></div>
        <div class="campo"><label for="nv-h">Horário livre</label><div class="entrada" id="e-nvh">${ic('clock', 18)}<select id="nv-h" data-nv="time" ${livres.length ? '' : 'disabled'}><option value="">${livres.length ? 'Escolha' : 'Sem horário livre'}</option>${livres.map((t) => `<option value="${t}" ${nv.time === t ? 'selected' : ''}>${t}</option>`).join('')}</select></div></div></div>
      <div class="campo"><label for="nv-s">Serviço</label><div class="entrada" id="e-nvs">${ic('scissors', 18)}<select id="nv-s" data-nv="svc">${S.services.map((s) => `<option value="${s.id}" ${nv.svc === s.id ? 'selected' : ''}>${esc(s.name)} · ${tempo(s.dur)} · ${money(s.price)}</option>`).join('')}</select></div></div>
      <div id="nvAviso">${livres.length ? nvAviso() : `<div class="faixa" data-t="aviso"><span class="f-ico">${ic('alert', 18)}</span><div><strong>${daySlots(nv.date).length ? 'Esse dia está cheio' : 'A barbearia está fechada nesse dia'}</strong><p>Escolha outro dia.</p></div></div>`}</div>
      <button type="submit" class="btn pri bloco">${ic('check', 18)}Agendar</button></form>`;
  }

  // ===== Ações =====
  const put = (path, body) => api('PUT', path, body);
  function setStatus(id, s, quiet) {
    const x = S.appts.find((y) => y.id === id); if (!x) return;
    const c = cById(x.clientId); const prev = x.status;
    V.cancel = null; V.ladoAsk = null;
    act(() => api('PATCH', '/api/admin/agendamentos/' + id, { status: s }), (r) => {
      if (quiet) { alerta('info', 'Pronto, desfeito', 'O horário voltou para aguardando.'); return; }
      if (s === 'realizado') alerta('ok', `${first(c.name)} atendido!`, `${x.service} · ${money(x.price)} entrou no ${x.date === TODAY ? 'caixa de hoje' : 'financeiro'}.`, [{ r: 'Desfazer', fn: () => setStatus(id, prev, true) }], 6000);
      else if (s === 'faltou') {
        const bl = r && r.blockedClient;
        alerta('aviso', `${c.name} não compareceu`, bl ? `${first(c.name)} já faltou ${S.settings.autoBlock} ${S.settings.autoBlock === 1 ? 'vez' : 'vezes'} e foi bloqueado no site. Para liberar, abra a ficha do cliente.` : 'A falta foi registrada no cadastro do cliente.', [{ r: 'Desfazer', fn: () => setStatus(id, prev, true) }]);
      } else if (s === 'cancelado') alerta('ok', 'Horário cancelado', `A vaga de ${diaTxt(x.date)} às ${x.time} ficou livre no site.`);
      else alerta('info', 'Voltou para aguardando', `${first(c.name)} · ${diaTxt(x.date)} às ${x.time}.`);
    });
  }
  function irPara(sec, extra) {
    if (V.sec === 'cfg' && sec !== 'cfg' && dirty()) {
      alerta('aviso', 'Você tem mudanças não salvas', 'Salve antes de sair das configurações para não perder o que mudou.', [
        { r: 'Salvar e sair', fn: async () => { if (await salvarCfg()) irPara(sec, extra); } },
        { r: 'Sair sem salvar', fn: () => { V.draft = null; irPara(sec, extra); } },
      ]);
      marcar('#salvarBarra', 'aviso');
      V.menu = false; render(); return;
    }
    if (sec !== 'cfg') V.draft = null;
    V.sec = sec; V.menu = false; V.sino = false; V.lado = null; V.cancel = null; V.despAsk = null;
    if (extra) extra();
    render(); window.scrollTo({ top: 0 });
  }

  document.addEventListener('submit', (e) => {
    const f = e.target; e.preventDefault();
    if (f.id === 'loginForm') {
      Som.unlock();
      const user = $('#l-user').value.trim(), pass = $('#l-pass').value; V.loginUser = user;
      if (!user || !pass) { alerta('erro', 'Preencha usuário e senha', !user ? 'O campo de usuário está vazio.' : 'O campo de senha está vazio.'); marcar(!user ? '#e-luser' : '#e-lpass'); return; }
      api('POST', '/api/admin/login', { user, pass })
        .then(async () => {
          V.logged = true; V.sec = 'inicio'; await reload(); connectLive(); render();
          const ag = S.appts.filter((x) => x.date === TODAY && x.status === 'agendado').length;
          alerta('ok', `Bem-vindo de volta, ${first(S.barber.name)}!`, ag ? `Você tem ${ag} cliente${ag > 1 ? 's' : ''} aguardando hoje.` : 'Nenhum cliente aguardando agora.');
        })
        .catch((err) => { alerta('erro', err.status === 429 ? 'Muitas tentativas' : 'Não deu para entrar', err.message); marcar('#e-lpass'); });
    }
    if (f.id === 'despForm') {
      const t = $('#d-t').value.trim(); const v = parseFloat($('#d-v').value.replace(/[^\d,.-]/g, '').replace(/\.(?=\d{3})/g, '').replace(',', '.'));
      const date = $('#d-d').value; const cat = $('#d-c').value;
      if (!t) { alerta('erro', 'Falta a descrição', 'Escreva o que foi comprado ou pago.'); marcar('#e-dt'); return; }
      if (!(v > 0)) { alerta('erro', 'Valor inválido', 'Digite um valor maior que zero. Ex.: 59,90'); marcar('#e-dv'); return; }
      if (!date) { alerta('erro', 'Falta a data', 'Escolha o dia em que foi pago.'); marcar('#e-dd'); return; }
      act(() => api('POST', '/api/admin/despesas', { desc: t, val: v, date, cat }), () => {
        V.despForm = false; const [de, ate] = faixaPer(); if (date < de || date > ate) V.per = 'mes';
        alerta('ok', 'Despesa lançada', `${t} · ${money(v)}`);
      });
    }
    if (f.id === 'cliForm') {
      const name = $('#cd-n').value.trim(), phone = digits($('#cd-p').value);
      const ne = A.nameError(name), pe = A.phoneError(phone);
      if (ne || pe) { alerta('erro', 'Confira os dados', ne || pe); marcar(ne ? '#e-cdn' : '#e-cdp'); return; }
      act(() => put('/api/admin/clientes/' + f.dataset.id, { name, phone }), () => alerta('ok', 'Cliente atualizado', `${name} · ${maskPhone(phone)}`));
    }
    if (f.id === 'nvForm') {
      const nv = V.nv; const s = S.services.find((x) => x.id === nv.svc);
      const body = { date: nv.date, time: nv.time, serviceId: nv.svc }; let nome;
      if (nv.cid) { body.clientId = nv.cid; nome = cById(nv.cid).name; }
      else if (nv.isNew) {
        const ne = A.nameError(nv.name), pe = A.phoneError(nv.phone);
        if (ne || pe) { alerta('erro', 'Confira o cliente', ne || pe); marcar(ne ? '#e-nvn' : '#e-nvp'); return; }
        body.name = A.tidyName(nv.name); body.phone = A.phoneDigits(nv.phone); nome = body.name;
      } else { alerta('erro', 'Escolha o cliente', 'Digite o nome e toque nele na lista, ou cadastre um cliente novo.'); marcar('#e-nvq'); return; }
      if (!nv.time) { alerta('erro', 'Escolha o horário', 'Só aparecem horários livres na lista.'); marcar('#e-nvh'); return; }
      if (!fits(nv.date, nv.time, s.dur)) { alerta('erro', `${s.name} não cabe às ${nv.time}`, 'Esse serviço precisa de mais tempo livre. Troque o horário ou o serviço.'); marcar('#e-nvs'); return; }
      api('POST', '/api/admin/agendamentos', body)
        .then(async () => { V.nv = null; await reload(); render(); alerta('ok', 'Agendamento criado', `${nome} · ${diaTxt(body.date)} às ${body.time}. O horário já aparece ocupado no site.`); })
        .catch((err) => alerta('erro', 'Não foi possível agendar', err.message));
    }
    if (f.id === 'profForm') {
      const name = $('#pp-n').value.trim(), user = $('#pp-u').value.trim(), email = $('#pp-e').value.trim();
      if (!name) { alerta('erro', 'Falta o seu nome', 'Escreva como quer aparecer no painel.'); marcar('#e-ppn'); return; }
      if (!/^[a-z0-9._-]{3,30}$/i.test(user)) { alerta('erro', 'Usuário inválido', 'Use de 3 a 30 letras ou números, sem espaço.'); marcar('#e-ppu'); return; }
      act(() => put('/api/admin/perfil', { name, email, user }), () => alerta('ok', 'Dados salvos', 'Use o novo usuário no próximo login, se você trocou.'));
    }
    if (f.id === 'pwForm') {
      const cur = $('#ps-a').value, n1 = $('#ps-n').value, n2 = $('#ps-c').value;
      if (!cur) { alerta('erro', 'Falta a senha atual', 'Digite a senha que você usa hoje.'); marcar('#e-psa'); return; }
      if (n1.length < 6) { alerta('erro', 'Senha muito curta', 'A nova senha precisa ter pelo menos 6 caracteres.'); marcar('#e-psn'); return; }
      if (n1 !== n2) { alerta('erro', 'As senhas não são iguais', 'Digite a mesma senha nos dois campos.'); marcar('#e-psc'); return; }
      api('PUT', '/api/admin/senha', { cur, next: n1 })
        .then(() => { alerta('ok', 'Senha trocada', 'Use a nova senha no próximo login.'); ['#ps-a', '#ps-n', '#ps-c'].forEach((s) => { $(s).value = ''; }); })
        .catch((err) => { alerta('erro', 'Não deu para trocar a senha', err.message); marcar('#e-psa'); });
    }
  });

  document.addEventListener('click', (e) => {
    if (Som.enabled()) Som.unlock();
    const el = e.target.closest('[data-a]'); if (!el) return;
    const a = el.dataset.a; const id = el.dataset.id; const v = el.dataset.v;
    switch (a) {
      case 'olho': { const i = $('#l-pass'); i.type = i.type === 'password' ? 'text' : 'password'; el.innerHTML = ic(i.type === 'password' ? 'eye' : 'eyeoff', 18); el.setAttribute('aria-label', i.type === 'password' ? 'Mostrar senha' : 'Esconder senha'); break; }
      case 'logout': api('POST', '/api/admin/logout').finally(() => { if (es) es.close(); V.logged = false; S = null; V.menu = false; V.lado = null; V.draft = null; render(); alerta('info', 'Você saiu do painel', 'Até logo!'); }); break;
      case 'sec': irPara(el.dataset.s); break;
      case 'menu': V.menu = !V.menu; render(); break;
      case 'sino':
        V.sino = !V.sino; V.nClearAsk = false; V.menu = false; render();
        if (V.sino && unread()) api('POST', '/api/admin/avisos/lidos').then(() => { setTimeout(() => { S.notifications.forEach((n) => (n.read = true)); render(); }, 2500); }).catch(() => {});
        break;
      case 'n-del': { S.notifications = S.notifications.filter((x) => x.id !== id); render(); api('DELETE', '/api/admin/avisos/' + id).catch((err) => { alerta('erro', 'Não deu certo', err.message); reload().then(render); }); break; }
      case 'n-clear-ask': V.nClearAsk = true; render(); break;
      case 'n-clear-no': V.nClearAsk = false; render(); break;
      case 'n-clear': V.nClearAsk = false; act(() => api('DELETE', '/api/admin/avisos'), () => alerta('ok', 'Avisos apagados', 'Os agendamentos continuam na agenda.')); break;
      case 'som-toggle': Som.setEnabled(!Som.enabled()); if (Som.enabled()) { Som.unlock(); setTimeout(() => Som.play('novo'), 100); } render(); break;
      case 'tema': window.U.tema.trocar(); render(); break;
      case 'ver-feitos': V.verFeitos = !V.verFeitos; render(); break;
      case 'som-on': Som.setEnabled(true); Som.unlock(); setTimeout(() => { Som.play('novo'); render(); }, 150); alerta('ok', 'Som ativado', 'É assim que vai tocar quando chegar agendamento novo.'); break;
      case 'ag-rola': { const el2 = $('#agCols'); if (el2) el2.scrollBy({ left: Number(v) * 628, behavior: 'smooth' }); break; }
      case 'pag': {
        V.pg[el.dataset.k] = Number(el.dataset.p); render();
        const t = $('.p-main'); if (t) window.scrollTo({ top: 0, behavior: 'smooth' });
        break;
      }
      case 'ir-ag': irPara('agenda', () => { V.vista = 'lista'; V.ab = v; V.pg.ag = 1; }); break;
      case 'ir-cfg': irPara('cfg'); break;
      case 'ir-folga': irPara('cfg'); setTimeout(() => { const i = $('#cfg-folga'); if (i) { i.closest('.cartao').scrollIntoView({ behavior: 'smooth', block: 'center' }); marcar('#e-folga', 'aviso'); } }, 80); break;
      case 'ir-desp': irPara('fin', () => { V.despForm = true; }); setTimeout(() => { const c = $('#cartaoDesp'); if (c) c.scrollIntoView({ behavior: 'smooth', block: 'start' }); const i = $('#d-t'); if (i) i.focus({ preventScroll: true }); }, 80); break;
      case 'ir-sumidos': irPara('cli', () => { V.cliF = 'sumidos'; V.cliQ = ''; V.pg.cli = 1; }); break;
      case 'ag-ab': V.ab = v; V.vista = 'lista'; V.pg.ag = 1; V.cancel = null; render(); break;
      case 'vista': V.vista = v; if (v === 'lista' && V.ab === 'dia') V.ab = 'hoje'; render(); break;
      case 'ver-dia': V.ab = 'dia'; V.agDia = v; V.vista = 'lista'; V.pg.ag = 1; render(); window.scrollTo({ top: 0 }); break;
      case 'mes-n': { const n = Number(el.dataset.n); const m = A.parse(V.calMonth); V.calMonth = n === 0 ? TODAY.slice(0, 8) + '01' : A.iso(new Date(m.getFullYear(), m.getMonth() + n, 1)); render(); break; }
      case 'cancel-ask': V.cancel = id; render(); break;
      case 'cancel-no': V.cancel = null; render(); break;
      case 'st': e.stopPropagation(); setStatus(id, el.dataset.s); break;
      case 'ap': openLado('ap', id); break;
      case 'cli': openLado('cli', id); break;
      case 'lado-x': V.lado = null; V.ladoAsk = null; render(); break;
      case 'lado-ask': V.ladoAsk = v; render(); break;
      case 'lado-no': V.ladoAsk = null; render(); break;
      case 'bloq': V.ladoAsk = null;
        act(() => api('POST', `/api/admin/clientes/${id}/bloquear`, {}), (r) => alerta('aviso', 'Cliente bloqueado no site', `${first(cById(id).name)} não consegue mais marcar pelo site.${r && r.cancelled && r.cancelled.length ? ` ${r.cancelled.length === 1 ? '1 horário futuro foi cancelado' : `${r.cancelled.length} horários futuros foram cancelados`} e ficou livre.` : ''}`, [{ r: 'Desfazer', fn: () => act(() => api('POST', `/api/admin/clientes/${id}/desbloquear`, {}), () => alerta('info', 'Bloqueio desfeito', 'O cliente já pode marcar pelo site de novo.')) }]));
        break;
      case 'desbloq': e.stopPropagation(); act(() => api('POST', `/api/admin/clientes/${id}/desbloquear`, {}), () => alerta('ok', `${first(cById(id).name)} desbloqueado`, 'Já pode agendar pelo site de novo.')); break;
      case 'cli-f': V.cliF = v; V.pg.cli = 1; render(); break;
      case 'per': V.per = v; V.pg.desp = 1; render(); break;
      case 'desp-form': V.despForm = !V.despForm; render(); if (V.despForm) setTimeout(() => { const i = $('#d-t'); if (i) i.focus(); }, 30); break;
      case 'desp-ask': V.despAsk = id; render(); break;
      case 'desp-no': V.despAsk = null; render(); break;
      case 'desp-del': { const d = S.expenses.find((x) => x.id === id); V.despAsk = null;
        act(() => api('DELETE', '/api/admin/despesas/' + id), () => alerta('ok', 'Despesa excluída', d ? `${d.desc} · ${money(d.val)}` : '', d ? [{ r: 'Desfazer', fn: () => act(() => api('POST', '/api/admin/despesas', { desc: d.desc, val: d.val, date: d.date, cat: d.cat }), () => alerta('info', 'Despesa de volta', `${d.desc} · ${money(d.val)}`)) }] : []));
        break; }
      case 'novo': novoAg(); break;
      case 'nv-x': V.nv = null; render(); break;
      case 'nv-pick': V.nv.cid = id; V.nv.isNew = false; render(); break;
      case 'nv-new': {
        const q = V.nv.q.trim(); V.nv.isNew = true; V.nv.cid = '';
        if (digits(q).length >= 8 && !/[a-zà-ú]/i.test(q)) V.nv.phone = q; else V.nv.name = q;
        render(); const f = $(V.nv.name ? '#nv-phone' : '#nv-name'); if (f) f.focus();
        break;
      }
      case 'nv-clear': V.nv.cid = ''; V.nv.isNew = false; V.nv.q = ''; render(); { const f = $('#nv-q'); if (f) f.focus(); } break;
      // configurações
      case 'cor': V.draft.color = v; render(); break;
      case 'dia-on': { const x = V.draft.days[Number(v)]; x.on = !x.on; render(); break; }
      case 'bk-quick': {
        const n = Number(el.dataset.n); V.draft.bookTo = A.iso(new Date(NOW.getFullYear(), NOW.getMonth() + n + 1, 0));
        if (V.draft.bookFrom > V.draft.bookTo || V.draft.bookFrom < TODAY) V.draft.bookFrom = TODAY;
        render(); alerta('info', `Agenda aberta até ${shortDate(V.draft.bookTo)}`, 'Toque em "Salvar alterações" para valer no site.', [], 4000); break;
      }
      case 'salvar': salvarCfg(); break;
      case 'logo-rm': act(() => put('/api/admin/configuracoes', { logo: null }), () => { V.draft.logo = S.settings.logo; alerta('ok', 'Logo removida', 'No lugar dela aparecem as iniciais da barbearia.'); }); break;
      case 'svc-add': act(() => api('POST', '/api/admin/servicos', { name: 'Novo serviço', price: 30, dur: 30 }), (r) => {
        if (V.draft && r && r.service) V.draft.svcs.push({ id: r.service.id, name: r.service.name, price: String(r.service.price).replace('.', ','), dur: r.service.dur });
        alerta('ok', 'Serviço criado', 'Troque o nome, a duração e o preço, e depois salve.');
        setTimeout(() => { const l = document.querySelectorAll('[data-svc][data-k="name"]'); const i = l[l.length - 1]; if (i) { i.focus(); i.select(); } }, 60);
      }); break;
      case 'svc-del': {
        if (S.services.length <= 1) { alerta('erro', 'Precisa ter pelo menos 1 serviço', 'Sem serviço, o cliente não consegue agendar.'); return; }
        const s = S.services.find((x) => x.id === id);
        act(() => api('DELETE', '/api/admin/servicos/' + id), () => {
          if (V.draft) V.draft.svcs = V.draft.svcs.filter((x) => x.id !== id);
          alerta('aviso', `${s.name} removido`, 'Ele saiu do site. Atendimentos antigos continuam no financeiro.', [{ r: 'Desfazer', fn: () => act(() => api('POST', '/api/admin/servicos', { name: s.name, price: s.price, dur: s.dur }), (r) => { if (V.draft && r && r.service) V.draft.svcs.push({ id: r.service.id, name: r.service.name, price: String(r.service.price).replace('.', ','), dur: r.service.dur }); alerta('info', `${s.name} voltou`, 'O serviço aparece no site de novo.'); }) }]);
        });
        break;
      }
      case 'folga-del': act(() => api('DELETE', '/api/admin/bloqueios/' + v), () => alerta('ok', 'Dia liberado', `${shortDate(v)} voltou a aceitar agendamentos.`)); break;
      case 'folga-add': {
        const d = $('#cfg-folga').value; const why = $('#cfg-folga-r').value.trim() || 'Folga';
        if (!d) { alerta('erro', 'Escolha a data primeiro', 'Toque no campo de data e escolha o dia da folga.'); marcar('#e-folga'); return; }
        if (blockedOf(d)) { alerta('aviso', 'Esse dia já está bloqueado', `${shortDate(d)} já aparece como fechado no site.`); marcar('#e-folga', 'aviso'); return; }
        act(() => api('POST', '/api/admin/bloqueios', { date: d, why }), (r) => {
          if (r && r.existing) alerta('aviso', `Dia bloqueado, mas tem ${r.existing} cliente${r.existing > 1 ? 's' : ''} marcado${r.existing > 1 ? 's' : ''}`, 'Avise esses clientes para remarcar. Eles estão na agenda desse dia.', [{ r: 'Ver agenda do dia', fn: () => irPara('agenda', () => { V.ab = 'dia'; V.agDia = d; V.vista = 'lista'; V.pg.ag = 1; }) }]);
          else alerta('ok', 'Dia bloqueado', `${shortDate(d)} não aparece mais para agendar.`);
        });
        break;
      }
    }
  });

  document.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[role=button]')) { e.preventDefault(); e.target.click(); }
    if (e.target.id === 'nv-q' && (e.key === 'Enter' || e.key === 'ArrowDown')) { e.preventDefault(); const f = $('#nvSug button'); if (f) { if (e.key === 'Enter') f.click(); else f.focus(); } }
    if (e.target.matches('#nvSug button') && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) { e.preventDefault(); const n = e.key === 'ArrowDown' ? e.target.nextElementSibling : e.target.previousElementSibling || $('#nv-q'); if (n) n.focus(); }
    if (e.key === 'Escape') {
      if (V.nv) V.nv = null; else if (V.lado) V.lado = null; else if (V.sino) V.sino = false; else if (V.menu) V.menu = false; else return;
      render();
    }
  });

  document.addEventListener('input', (e) => {
    const el = e.target;
    if (el.dataset.in) {
      const k = el.dataset.in;
      if (['mask', 'nv-phone'].includes(k)) el.value = maskPhone(el.value);
      if (k === 'nv-name') V.nv.name = el.value;
      if (k === 'nv-phone') V.nv.phone = el.value;
      if (k === 'nv-q') { V.nv.q = el.value; $('#nvSug').innerHTML = nvSug(el.value); }
      if (k === 'cli-q') { V.cliQ = el.value; V.pg.cli = 1; $('#cliLista').innerHTML = cliLista(); }
    }
    if (!V.draft) return;
    if (el.dataset.d) { if (el.dataset.mask) el.value = maskPhone(el.value); V.draft[el.dataset.d] = el.dataset.num ? Number(el.value) : el.value; paintSave(); }
    if (el.dataset.dia) { V.draft.days[Number(el.dataset.dia)][el.dataset.k] = el.value; paintSave(); }
    if (el.dataset.svc) { const s = V.draft.svcs[Number(el.dataset.svc)]; s[el.dataset.k] = el.dataset.k === 'dur' ? Number(el.value) : el.value; paintSave(); }
    if (el.dataset.ch === 'cor-custom') { V.draft.custom = el.value; V.draft.color = 'custom'; applyTheme(V.draft); paintSave(); }
  });

  document.addEventListener('change', (e) => {
    const el = e.target;
    if (el.dataset.nv) {
      V.nv[el.dataset.nv] = el.value;
      if (el.dataset.nv === 'date') { V.nv.time = ''; render(); return; }
      $('#nvAviso').innerHTML = nvAviso();
      return;
    }
    if (V.draft && (el.dataset.d === 'shopName' || el.dataset.d === 'tagline' || el.dataset.svc)) { const p = document.querySelector('.previa-cel'); if (p) p.outerHTML = previa(V.draft); }
    const k = el.dataset.ch; if (!k) return;
    if (k === 'per-de') { V.de = el.value || V.de; V.pg.desp = 1; render(); }
    if (k === 'per-ate') { V.ate = el.value || V.ate; V.pg.desp = 1; render(); }
    if (k === 'cor-custom') render();
    if (k === 'logo') {
      const f = el.files[0]; if (!f) return;
      if (f.size > 1.5e6) { alerta('erro', 'Imagem muito grande', 'Use uma imagem de até 1,5 MB.'); return; }
      const fr = new FileReader();
      fr.onload = () => act(() => put('/api/admin/configuracoes', { logo: fr.result }), () => { if (V.draft) V.draft.logo = S.settings.logo; alerta('ok', 'Logo atualizada', 'Ela já aparece no site e no painel.'); });
      fr.readAsDataURL(f);
    }
  });

  // Atualiza a tela a cada minuto (horários que passaram, "próximo cliente")
  setInterval(() => {
    if (!V.logged || !S || V.lado || V.nv || document.activeElement?.matches('input,select')) return;
    if (A.todayIn() !== TODAY) reload().then(render).catch(() => {}); else render();
  }, 60000);

  // Avisa antes de fechar a aba com configurações não salvas
  window.addEventListener('beforeunload', (e) => { if (V.sec === 'cfg' && dirty()) { e.preventDefault(); e.returnValue = ''; } });

  // ----- iniciar: se já estiver logado (cookie), entra direto -----
  (async function start() {
    try {
      await reload(); V.logged = true; connectLive();
    } catch (e) {
      V.logged = false; S = null;
      if (e.status && e.status !== 401) setTimeout(() => alerta('erro', 'Não deu para carregar o painel', e.message), 50);
    }
    render();
  })();
})();
