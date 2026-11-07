// Som de campainha ("plim-plom") feito na hora pelo navegador, sem arquivo de áudio.
// Os navegadores só deixam tocar som depois que a pessoa clica na página uma vez.
(function () {
  let ctx = null;
  const KEY = 'painel_som';

  function enabled() { try { return localStorage.getItem(KEY) !== 'off'; } catch { return true; } }
  function setEnabled(on) { try { localStorage.setItem(KEY, on ? 'on' : 'off'); } catch { /* ignora */ } }

  /** Chamar dentro de um clique: libera o áudio. */
  function unlock() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    if (!ctx) ctx = new AC();
    if (ctx.state === 'suspended') ctx.resume();
    return true;
  }
  function ready() { return !!ctx && ctx.state === 'running'; }

  function note(freq, start, dur, vol) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sine'; o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(vol, start + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    o.connect(g).connect(ctx.destination);
    o.start(start); o.stop(start + dur + 0.05);
    // harmônico suave para parecer uma campainha de balcão
    const o2 = ctx.createOscillator(), g2 = ctx.createGain();
    o2.type = 'sine'; o2.frequency.value = freq * 2.01;
    g2.gain.setValueAtTime(0.0001, start);
    g2.gain.exponentialRampToValueAtTime(vol * 0.25, start + 0.02);
    g2.gain.exponentialRampToValueAtTime(0.0001, start + dur * 0.6);
    o2.connect(g2).connect(ctx.destination);
    o2.start(start); o2.stop(start + dur);
  }

  /** type: 'novo' toca plim-plom subindo; 'cancelado' toca um tom só, mais grave. */
  function play(type) {
    if (!enabled() || !ready()) return false;
    const t = ctx.currentTime + 0.02;
    if (type === 'cancelado') { note(523.25, t, 0.6, 0.25); }
    else { note(783.99, t, 0.7, 0.3); note(1046.5, t + 0.22, 1.1, 0.3); }
    return true;
  }

  window.Som = { unlock, ready, play, enabled, setEnabled };
})();
