// Tela de carregamento. O servidor coloca este script logo depois da tela, no próprio HTML.
// O site e o painel chamam Carregando.pronto() quando terminam de montar a tela,
// ou Carregando.erro(titulo, texto) quando não dá para abrir.
(function () {
  var el = document.getElementById('carregando');
  if (!el) return;
  var timers = [];
  var depois = function (ms, fn) { timers.push(setTimeout(fn, ms)); };
  var parar = function () { timers.forEach(clearTimeout); timers = []; };
  var sub = document.getElementById('cg-sub');
  var frases = [];
  try { frases = JSON.parse(sub.getAttribute('data-frases')) || []; } catch (e) { /* sem frases */ }

  // Troca a frase de baixo a cada 1,6 s, até a última
  var i = 0;
  function roda() {
    if (i >= frases.length - 1) return;
    i++;
    sub.style.opacity = 0;
    depois(250, function () { sub.textContent = frases[i]; sub.style.opacity = 1; });
    depois(1600, roda);
  }
  depois(1200, roda);

  // Passou de 6 s: avisa que está demorando
  depois(6000, function () {
    var d = document.createElement('div');
    d.className = 'cg-demora';
    d.textContent = 'Está levando um pouquinho mais que o normal. Só mais um instante.';
    el.querySelector('.cg-miolo').appendChild(d);
  });

  var api = {
    pronto: function () {
      parar();
      if (el.classList.contains('cg-sai')) return;
      el.classList.add('cg-sai');
      setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 500);
    },
    erro: function (titulo, texto) {
      parar();
      el.classList.add('cg-erro');
      el.setAttribute('role', 'alert');
      var demora = el.querySelector('.cg-demora');
      if (demora) demora.parentNode.removeChild(demora);
      var msg = el.querySelector('.cg-msg');
      msg.innerHTML = '';
      var b = document.createElement('b'); b.textContent = titulo || 'Não conseguimos abrir o site';
      var s = document.createElement('span'); s.textContent = texto || 'Confira se a internet está ligada e tente de novo.';
      msg.appendChild(b); msg.appendChild(s);
      if (!el.querySelector('.cg-tentar')) {
        var bt = document.createElement('button');
        bt.type = 'button'; bt.className = 'cg-tentar';
        bt.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg>Tentar de novo';
        bt.onclick = function () { location.reload(); };
        el.querySelector('.cg-miolo').appendChild(bt);
      }
    },
  };
  window.Carregando = api;

  // Se em 25 s nada respondeu (internet caiu no meio), mostra o Tentar de novo
  depois(25000, function () { api.erro('O site está demorando para abrir', 'Confira se a internet está ligada e tente de novo.'); });
})();
