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
  const PRESETS = {
    latao: ['Latão', '#8c6a2b', '#d2b06b'], verde: ['Verde garrafa', '#1f5f4a', '#6cc8a1'], bordo: ['Bordô', '#7a2433', '#e3909b'],
    petroleo: ['Petróleo', '#1d4e68', '#7cbde0'], cobre: ['Cobre', '#9a4a24', '#e59a6c'], branco: ['Branco', '#4a4a48', '#f5f3ef'],
    preto: ['Preto', '#111111', '#cfcfcf'], azul: ['Azul royal', '#1f3fa8', '#8ea8ff'], roxo: ['Roxo', '#5b2a86', '#c3a0f0'], vermelho: ['Vermelho', '#b3261e', '#ff8a80'],
    laranja: ['Laranja', '#b45309', '#f6ad55'], rosa: ['Rosa', '#a3245f', '#f19ac2'], ciano: ['Ciano', '#0e6377', '#6fd3e6'],
  };
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
    list: I('<path d="M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01"/>', 2.4),
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
    let l, d;
    if (st.color === 'custom') { l = d = st.custom; } else { [, l, d] = PRESETS[st.color] || PRESETS.latao; }
    const lum = (h) => { const n = parseInt(h.slice(1), 16); return (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255; };
    const R = document.documentElement.style;
    R.setProperty('--acc-l', l); R.setProperty('--acc-d', d);
    R.setProperty('--on-acc-l', lum(l) > 0.6 ? '#1c1915' : '#ffffff');
    R.setProperty('--on-acc-d', lum(d) > 0.5 ? '#17130d' : '#ffffff');
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
    const ini = initials(st.shopName.replace(/barbearia/i, '').trim() || st.shopName) || 'B';
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
    if (!res.ok) throw Object.assign(new Error(data.error || 'Algo deu errado. Tente de novo.'), { status: res.status });
    return data;
  }

  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* sem armazenamento */ } },
  };

  window.U = { alerta, fecharAlerta, marcar, ic, esc, money, money0, digits, maskPhone, MESES, DOW, DOWL, longDate, shortDate, cap, initials, STATUS, PRESETS, avColor, IC, svcIcon, applyTheme, toast, logo, avatar, api, store };
})();
