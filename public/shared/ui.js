// Funções de tela usadas pelo site do cliente e pelo painel.
(function () {
  const A = window.Agenda;
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const money0 = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
  const digits = (s) => String(s || '').replace(/\D/g, '');
  const maskPhone = (v) => {
    const d = digits(v).slice(0, 11);
    if (d.length <= 2) return d ? `(${d}` : '';
    if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
    if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
    return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  };
  const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  const DOW = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
  const DOWL = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
  const longDate = (ds) => { const d = A.parse(ds); return `${DOWL[d.getDay()]}, ${d.getDate()} de ${MESES[d.getMonth()]}`; };
  const shortDate = (ds) => { const d = A.parse(ds); return `${A.pad(d.getDate())}/${A.pad(d.getMonth() + 1)}`; };
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  const initials = (n) => String(n || '').split(' ').filter(Boolean).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
  const STATUS = { agendado: 'Agendado', realizado: 'Realizado', faltou: 'Não compareceu', cancelado: 'Cancelado' };
  // [nome, cor no fundo claro, cor no fundo escuro]
  const PRESETS = A.PRESETS;
  const AVC = ['#c9a86a', '#7fb8a0', '#d68f8f', '#8fb0d6', '#c7a0d0', '#d6b37f', '#9fc78a'];
  const avColor = (id) => AVC[[...String(id)].reduce((s, c) => s + c.charCodeAt(0), 0) % AVC.length];

  const I = (p, w = 2) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
  const IC = {
    home: I('<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/>'),
    cal: I('<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18M8 3v4M16 3v4"/>'),
    clock: I('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
    user: I('<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-7 8-7s8 3 8 7"/>'),
    users: I('<circle cx="9" cy="8" r="4"/><path d="M2 21c0-4 3-6 7-6s7 2 7 6M17 11a3 3 0 100-6M22 21c0-3-2-5-4-5.5"/>'),
    chart: I('<path d="M3 3v18h18"/><path d="M7 15l4-4 3 3 5-6"/>'),
    cog: I('<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/>'),
    scissors: I('<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M20 4L8.1 15.9M14.5 14.5L20 20M8.1 8.1L12 12"/>'),
    razor: I('<path d="M4 20l7-7"/><rect x="10" y="3" width="11" height="8" rx="2" transform="rotate(45 15.5 7)"/>'),
    check: I('<path d="M5 12l5 5L20 7"/>', 2.5),
    x: I('<path d="M6 6l12 12M18 6L6 18"/>', 2.5),
    plus: I('<path d="M12 5v14M5 12h14"/>', 2.5),
    money: I('<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="3"/><path d="M6 12h.01M18 12h.01"/>'),
    receipt: I('<path d="M5 3v18l3-2 2 2 2-2 2 2 2-2 3 2V3l-3 2-2-2-2 2-2-2-2 2z"/><path d="M9 9h6M9 13h6"/>'),
    search: I('<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>'),
    out: I('<path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9"/>'),
    phone: I('<rect x="6" y="2" width="12" height="20" rx="3"/><path d="M11 18h2"/>'),
    copy: I('<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 012-2h10"/>'),
    spark: I('<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M6 18l2.5-2.5M15.5 8.5L18 6"/>'),
    drop: I('<path d="M12 3s6 6.5 6 11a6 6 0 01-12 0c0-4.5 6-11 6-11z"/>'),
    eye: I('<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>'),
    bell: I('<path d="M6 8a6 6 0 0112 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 003.4 0"/>'),
    sound: I('<path d="M11 5L6 9H2v6h4l5 4V5z"/><path d="M15.5 8.5a5 5 0 010 7M19 5a10 10 0 010 14"/>'),
    mute: I('<path d="M11 5L6 9H2v6h4l5 4V5z"/><path d="M22 9l-6 6M16 9l6 6"/>'),
    lock: I('<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 018 0v4"/>'),
    menu: I('<path d="M4 7h16M4 12h16M4 17h16"/>'),
    ban: I('<circle cx="12" cy="12" r="9"/><path d="M5.6 5.6l12.8 12.8"/>'),
    shield: I('<path d="M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6z"/><path d="M9 12l2 2 4-4"/>'),
    trash: I('<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13a1 1 0 001 1h8a1 1 0 001-1l1-13M9 7V4h6v3"/>'),
    more: I('<circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/>', 2.4),
    left: I('<path d="M15 18l-6-6 6-6"/>', 2.4),
    right: I('<path d="M9 18l6-6-6-6"/>', 2.4),
    pin: I('<path d="M12 21s7-6.1 7-12a7 7 0 10-14 0c0 5.9 7 12 7 12z"/><circle cx="12" cy="9" r="2.5"/>'),
    alert: I('<path d="M10.3 3.9L2.4 18a2 2 0 001.7 3h15.8a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z"/><path d="M12 9v4M12 17h.01"/>', 2.2),
    info: I('<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>', 2.2),
    coffee: I('<path d="M4 9h13v5a5 5 0 01-5 5H9a5 5 0 01-5-5z"/><path d="M17 10h1.5a2.5 2.5 0 010 5H17M8 3v3M12 3v3"/>'),
    arrow: I('<path d="M5 12h14M13 6l6 6-6 6"/>', 2.2),
    userplus: I('<circle cx="9" cy="8" r="4"/><path d="M2 21c0-4 3-7 7-7s7 3 7 7M19 8v6M16 11h6"/>'),
    userok: I('<circle cx="9" cy="8" r="4"/><path d="M2 21c0-4 3-7 7-7 1.4 0 2.7.4 3.8 1M16 18l2 2 4-4"/>'),
    whats: I('<path d="M21 11.5a8.4 8.4 0 01-12.3 7.5L3 21l2-5.6A8.5 8.5 0 1121 11.5z"/>'),
    eyeoff: I('<path d="M3 3l18 18"/><path d="M10.6 5.1A10 10 0 0112 5c6 0 10 7 10 7a17 17 0 01-3.2 3.9M6.6 6.6C3.8 8.3 2 12 2 12s4 7 10 7a9.6 9.6 0 004.4-1"/><path d="M9.9 9.9a3 3 0 004.2 4.2"/>'),
    undo: I('<path d="M9 14L4 9l5-5"/><path d="M4 9h11a5 5 0 010 10h-3"/>'),
    trend: I('<path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/>'),
    zap: I('<path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z"/>'),
    grid: I('<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>'),
    wallet: I('<path d="M19 7V5a2 2 0 0 0-2-2H5a2 2 0 0 0 0 4h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5"/><path d="M16 14h.01"/>'),
    star: I('<path d="m12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z"/>'),
    down: I('<path d="m22 17-8.5-8.5-5 5L2 7"/><path d="M16 17h6v-6"/>'),
    palette: I('<circle cx="13.5" cy="6.5" r="1"/><circle cx="17.5" cy="10.5" r="1"/><circle cx="8.5" cy="7.5" r="1"/><circle cx="6.5" cy="12.5" r="1"/><path d="M12 2a10 10 0 0 0 0 20c1 0 1.6-.8 1.6-1.7 0-.4-.2-.8-.4-1.1-.3-.3-.4-.7-.4-1.1 0-.9.8-1.7 1.7-1.7H16a6 6 0 0 0 6-6c0-4.4-4.5-8.4-10-8.4z"/>'),
    upload: I('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12"/>'),
    userx: I('<circle cx="9" cy="8" r="4"/><path d="M2 21a7 7 0 0 1 14 0M17 8l5 5M22 8l-5 5"/>'),
    door: I('<path d="M4 21h16"/><path d="M6 21V4a1 1 0 011-1h10a1 1 0 011 1v17"/><path d="M14 12h.01"/>'),
    list: I('<path d="M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01"/>', 2.4),
    sol: I('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>'),
    crown: I('<path d="M3 8l4.5 4L12 5l4.5 7L21 8l-2 11H5z"/><path d="M5 19h14"/>'),
    medal: I('<circle cx="12" cy="15" r="6"/><path d="M8.5 10.2L6 3h4l2 5M15.5 10.2L18 3h-4l-2 5"/><path d="M12 12.5v5"/>'),
    repeat: I('<path d="M17 2l4 4-4 4"/><path d="M3 11V9a3 3 0 013-3h15M7 22l-4-4 4-4"/><path d="M21 13v2a3 3 0 01-3 3H3"/>'),
    tag: I('<path d="M20.6 13.4l-7.2 7.2a2 2 0 01-2.8 0L3 13V3h10l7.6 7.6a2 2 0 010 2.8z"/><circle cx="8" cy="8" r="1.5"/>'),
    sort: I('<path d="M7 4v16M3 16l4 4 4-4M17 20V4M13 8l4-4 4 4"/>'),
    lua: I('<path d="M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z"/>'),
  };
  /** Ícone com tamanho fixo: ic('cal', 18). */
  const ic = (n, size = 18) => (IC[n] || '').replace('<svg', `<svg width="${size}" height="${size}"`);
  const svcIcon = (n) => {
    n = String(n).toLowerCase();
    if (n.includes('barba')) return IC.razor;
    if (n.includes('sobrancelha')) return IC.eye;
    if (n.includes('platin') || n.includes('luzes') || n.includes('pigment') || n.includes('tint')) return IC.drop;
    if (n.includes('pezinho') || n.includes('acab')) return IC.spark;
    return IC.scissors;
  };

  function applyTheme(st) {
    const c = A.accent(st);
    const R = document.documentElement.style;
    R.setProperty('--acc-l', c.l); R.setProperty('--acc-d', c.d);
    R.setProperty('--on-acc-l', c.onL);
    R.setProperty('--on-acc-d', c.onD);
  }

  // ----- Avisos que chamam atenção -----
  // Caem do topo, tremem, piscam a borda da tela e podem trazer botões de sugestão.
  // tipo: 'erro' (vermelho), 'aviso' (laranja), 'ok' (verde) ou 'info' (azul).
  const AL_IC = { erro: 'ban', aviso: 'alert', ok: 'check', info: 'info' };
  let alTimer = null;
  function alerta(tipo, titulo, texto, acoes = [], ms) {
    ms = ms || (tipo === 'ok' ? 4500 : acoes.length ? 12000 : 8000);
    let box = document.getElementById('alertas');
    if (!box) { box = document.createElement('div'); box.id = 'alertas'; document.body.appendChild(box); }
    const forte = tipo === 'erro' || tipo === 'aviso';
    box.innerHTML = `<div class="alerta" data-t="${tipo}" role="${forte ? 'alert' : 'status'}">
      <span class="al-ico">${ic(AL_IC[tipo] || 'info', 24)}</span>
      <div class="al-txt"><strong>${esc(titulo)}</strong>${texto ? `<p>${esc(texto)}</p>` : ''}${acoes.length ? `<div class="al-acoes">${acoes.map((a, i) => `<button type="button" data-al="${i}" class="${i === 0 ? 'pri' : ''}">${esc(a.r)}</button>`).join('')}</div>` : ''}</div>
      <button type="button" class="al-x" data-al="x" aria-label="Fechar aviso">${ic('x', 18)}</button>
      <span class="al-tempo" style="animation-duration:${ms}ms"></span></div>`;
    box.onclick = (e) => {
      const b = e.target.closest('[data-al]'); if (!b) return;
      fecharAlerta();
      const a = acoes[Number(b.dataset.al)];
      if (b.dataset.al !== 'x' && a) a.fn();
    };
    box.querySelector('.al-tempo').addEventListener('animationend', fecharAlerta);
    if (forte) {
      let f = document.getElementById('flash-borda');
      if (!f) { f = document.createElement('div'); f.id = 'flash-borda'; f.setAttribute('aria-hidden', 'true'); document.body.appendChild(f); }
      f.className = ''; void f.offsetWidth; f.className = 'flash-' + tipo;
    }
    clearTimeout(alTimer);
  }
  function fecharAlerta() {
    const a = document.querySelector('#alertas .alerta'); if (!a) return;
    a.classList.add('sai'); setTimeout(() => a.remove(), 300);
  }
  /** Faz o item culpado tremer com um anel vermelho (ou laranja) e rola até ele. */
  function marcar(alvo, tipo) {
    requestAnimationFrame(() => {
      const el = typeof alvo === 'string' ? document.querySelector(alvo) : alvo; if (!el) return;
      el.classList.remove('tremer', 'tremer-aviso'); void el.offsetWidth;
      el.classList.add('tremer'); if (tipo === 'aviso') el.classList.add('tremer-aviso');
      const r = el.getBoundingClientRect();
      if (r.top < 90 || r.bottom > innerHeight - 140) window.scrollTo({ top: window.scrollY + r.top - innerHeight / 3, behavior: 'smooth' });
      setTimeout(() => el.classList.remove('tremer', 'tremer-aviso'), 2600);
    });
  }

  let toastT;
  function toast(m) {
    let t = document.getElementById('toast');
    if (!t) { t = document.createElement('div'); t.id = 'toast'; t.className = 'toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
    t.textContent = m; t.hidden = false;
    clearTimeout(toastT); toastT = setTimeout(() => (t.hidden = true), 3200);
  }

  function logo(st, size) {
    const ini = A.shopInitials(st.shopName);
    return `<span class="av logo" style="width:${size}px;height:${size}px;font-size:${Math.round(size * 0.42)}px">${st.logo ? `<img src="${esc(st.logo)}" alt="Logo">` : esc(ini)}</span>`;
  }
  function avatar(c, size = 40) {
    return `<span class="av" style="width:${size}px;height:${size}px;font-size:${Math.round(size * 0.36)}px;background:${avColor(c.id)};color:#1a1510">${esc(initials(c.name))}</span>`;
  }

  /** Chamada à API. Lança um erro com a mensagem do servidor quando algo dá errado. */
  async function api(method, path, body, headers = {}) {
    let res;
    try {
      res = await fetch(path, {
        method, credentials: 'same-origin',
        headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw Object.assign(new Error('Sem conexão com a internet. Tente de novo.'), { status: 0 });
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.error || 'Algo deu errado. Tente de novo.'), { status: res.status, code: data.code });
    return data;
  }

  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* sem armazenamento */ } },
  };

  // ----- Tema claro ou escuro: cada pessoa escolhe e fica salvo no aparelho -----
  const TEMA_KEY = 'barbearia_tema';
  const escuroSistema = () => !!(window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches);
  const tema = {
    /** 'escuro' ou 'claro', como está na tela agora. */
    atual() { const t = document.documentElement.dataset.theme; return t ? (t === 'dark' ? 'escuro' : 'claro') : (escuroSistema() ? 'escuro' : 'claro'); },
    trocar() {
      const novo = tema.atual() === 'escuro' ? 'claro' : 'escuro';
      document.documentElement.dataset.theme = novo === 'escuro' ? 'dark' : 'light';
      store.set(TEMA_KEY, novo);
      return novo;
    },
    /** Botão de sol/lua: mostra o ícone do tema para onde vai trocar. */
    botao(cls) {
      const e = tema.atual() === 'escuro';
      return `<button type="button" class="${cls}" data-a="tema" aria-label="${e ? 'Usar tema claro' : 'Usar tema escuro'}" title="${e ? 'Tema claro' : 'Tema escuro'}">${ic(e ? 'sol' : 'lua', 18)}</button>`;
    },
  };


  // ----- Movimento na troca de telas -----
  // A tela atual sai para um lado e a nova entra pelo outro (direção = ordem do menu).
  // Quem pediu menos movimento no aparelho vê a troca na hora, sem animação.
  const calmo = () => !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  let saindo = null;
  /** Faz a tela "sel" sair na direção "dir" (1 avança, -1 volta, 0 só some) e depois chama "fn". */
  function trocaTela(sel, dir, fn) {
    if (saindo) { clearTimeout(saindo.t); saindo = null; }
    const el = document.querySelector(sel);
    if (!el || calmo()) { fn(); return; }
    el.dataset.dir = dir > 0 ? 'vai' : dir < 0 ? 'volta' : 'fica';
    el.classList.remove('vista'); el.classList.add('saindo');
    saindo = { t: setTimeout(() => { saindo = null; fn(); }, 150) };
  }
  /** Marcador do menu que desliza do item antigo até o novo.
   *  marcaAntes: guarda onde o marcador está (chamar antes de redesenhar o menu);
   *  deslizaMarca: leva o marcador até o item ".on" (chamar depois de desenhar). */
  const marcas = {};
  function marcaAntes(sel) {
    document.querySelectorAll(sel).forEach((nav, i) => {
      const m = nav.querySelector(':scope > .marca-nav'); if (!m || !m.offsetWidth) return;
      const a = nav.getBoundingClientRect(), b = m.getBoundingClientRect();
      marcas[sel + i] = { x: b.left - a.left - nav.clientLeft + nav.scrollLeft, y: b.top - a.top - nav.clientTop + nav.scrollTop, w: b.width, h: b.height };
    });
  }
  function deslizaMarca(sel) {
    document.querySelectorAll(sel).forEach((nav, i) => {
      const on = nav.querySelector(':scope > .on'); if (!on || !on.offsetWidth) return;
      let m = nav.querySelector(':scope > .marca-nav');
      if (!m) { m = document.createElement('span'); m.className = 'marca-nav'; m.setAttribute('aria-hidden', 'true'); nav.prepend(m); }
      nav.classList.add('com-marca');
      const r = { x: on.offsetLeft, y: on.offsetTop, w: on.offsetWidth, h: on.offsetHeight };
      const pos = (q) => { m.style.transform = `translate(${q.x}px,${q.y}px)`; m.style.width = q.w + 'px'; m.style.height = q.h + 'px'; };
      const k = sel + i; const p = marcas[k];
      const mudou = p && (Math.abs(p.x - r.x) > 1 || Math.abs(p.y - r.y) > 1 || Math.abs(p.w - r.w) > 1);
      m.style.transition = 'none'; pos(mudou && !calmo() ? p : r); void m.offsetWidth; m.style.transition = '';
      if (mudou) pos(r);
      marcas[k] = r;
    });
  }
  /** Trocou de página numa lista: os cards entram do lado certo e a lista volta para a vista. */
  function animaLista(el, dir, rola = true) {
    if (!el) return;
    if (!calmo()) { el.classList.remove('pg-vai', 'pg-volta'); void el.offsetWidth; el.classList.add(dir < 0 ? 'pg-volta' : 'pg-vai'); }
    if (!rola) return;
    const r = el.getBoundingClientRect(); const topo = document.querySelector('.c-topo, .p-topo');
    const h = topo ? topo.getBoundingClientRect().height : 0;
    if (r.top < h + 8) window.scrollBy({ top: r.top - h - 70, behavior: calmo() ? 'auto' : 'smooth' });
  }
  const mov = { trocaTela, marcaAntes, deslizaMarca, animaLista, calmo };

  window.U = { mov, alerta, fecharAlerta, marcar, ic, esc, money, money0, digits, maskPhone, MESES, DOW, DOWL, longDate, shortDate, cap, initials, STATUS, PRESETS, avColor, IC, svcIcon, applyTheme, toast, logo, avatar, api, store, tema };
})();
