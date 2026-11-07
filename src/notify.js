// Avisos em tempo real para o painel (Server-Sent Events).
// Fica tudo na memória do servidor: o banco não é consultado a cada poucos segundos,
// então o Neon gratuito pode "dormir" quando ninguém está usando.
const listeners = new Set();

function subscribe(req, res) {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.flushHeaders();
  res.write('retry: 5000\n\n');
  const ping = setInterval(() => res.write(': ping\n\n'), 25000);
  listeners.add(res);
  req.on('close', () => { clearInterval(ping); listeners.delete(res); });
}

function broadcast(event, data) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of listeners) res.write(msg);
}

module.exports = { subscribe, broadcast };
