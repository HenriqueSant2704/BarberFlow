// Conexão com o WhatsApp do chip dos lembretes.
// Funciona como o WhatsApp Web: o barbeiro lê um QR Code uma vez e o servidor fica conectado.
// A "chave" da conexão fica guardada no banco (tabela wa_auth), então quando o Render reinicia
// o WhatsApp volta sozinho, sem ler o QR Code de novo.
// Não é a API oficial da Meta: use um chip separado, nunca o WhatsApp principal da barbearia.
const QRCode = require('qrcode');
const db = require('./db');
const notify = require('./notify');

let B = null; // biblioteca Baileys (só existe como módulo ESM, por isso o import dinâmico)
const lib = async () => (B ||= await import('@whiskeysockets/baileys'));

// A biblioteca escreve muita coisa técnica no log; aqui fica tudo em silêncio.
const SILENT = { level: 'silent', child: () => SILENT, trace() {}, debug() {}, info() {}, warn() {}, error() {}, fatal() {} };

const st = { state: 'off', qr: null, number: '', name: '', since: null, error: '' };
let sock = null;
let wantOn = false;
let retry = 0;
let retryTimer = null;

function info() {
  return { state: st.state, qr: st.state === 'qr' ? st.qr : null, number: st.number, name: st.name, since: st.since, error: st.error };
}
function set(state, error = '') {
  st.state = state; st.error = error;
  notify.broadcast('whatsapp', info());
}

/** Guarda a sessão do WhatsApp no Neon em vez de em arquivos (o disco do Render some a cada reinício). */
async function dbAuthState() {
  const { initAuthCreds, BufferJSON, proto } = await lib();
  const enc = (v) => JSON.stringify(v, BufferJSON.replacer);
  const dec = (v) => JSON.parse(v, BufferJSON.reviver);
  const write = (k, v) => db.query('INSERT INTO wa_auth (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value', [k, enc(v)]);
  const { rows } = await db.query("SELECT value FROM wa_auth WHERE key = 'creds'");
  const creds = rows[0] ? dec(rows[0].value) : initAuthCreds();
  return {
    creds,
    state: {
      creds,
      keys: {
        get: async (type, ids) => {
          const out = {};
          if (!ids.length) return out;
          const { rows: r } = await db.query('SELECT key, value FROM wa_auth WHERE key = ANY($1)', [ids.map((id) => `${type}:${id}`)]);
          const m = new Map(r.map((x) => [x.key, x.value]));
          for (const id of ids) {
            let v = m.has(`${type}:${id}`) ? dec(m.get(`${type}:${id}`)) : null;
            if (v && type === 'app-state-sync-key') v = proto.Message.AppStateSyncKeyData.fromObject(v);
            out[id] = v;
          }
          return out;
        },
        set: async (data) => {
          const tasks = [];
          for (const cat in data) {
            for (const id in data[cat]) {
              const v = data[cat][id];
              tasks.push(v ? write(`${cat}:${id}`, v) : db.query('DELETE FROM wa_auth WHERE key = $1', [`${cat}:${id}`]));
            }
          }
          await Promise.all(tasks);
        },
      },
    },
    saveCreds: () => write('creds', creds),
  };
}

async function clearSession() { await db.query('DELETE FROM wa_auth').catch(() => {}); }

async function start() {
  wantOn = true;
  clearTimeout(retryTimer);
  if (sock) return;
  const { default: makeWASocket, DisconnectReason, fetchLatestBaileysVersion, Browsers } = await lib();
  const auth = await dbAuthState();
  let version;
  try { ({ version } = await fetchLatestBaileysVersion()); } catch { /* usa a versão que vem na biblioteca */ }
  if (st.state !== 'qr') set('conectando');
  const s = makeWASocket({
    auth: auth.state, logger: SILENT, version, browser: Browsers.ubuntu('BarberFlow'),
    markOnlineOnConnect: false, syncFullHistory: false, shouldSyncHistoryMessage: () => false,
  });
  sock = s;
  let viuQr = false;
  s.ev.on('creds.update', auth.saveCreds);
  s.ev.on('connection.update', async (u) => {
    if (sock !== s) return;
    if (u.qr) {
      viuQr = true;
      st.qr = await QRCode.toDataURL(u.qr, { margin: 1, width: 300 });
      set('qr');
    }
    if (u.connection === 'open') {
      retry = 0; st.qr = null;
      st.number = String(s.user?.id || '').split(/[:@]/)[0].replace(/^55/, '');
      st.name = s.user?.name || s.user?.verifiedName || '';
      st.since = new Date().toISOString();
      set('on');
    }
    if (u.connection === 'close') {
      sock = null;
      const code = u.lastDisconnect?.error?.output?.statusCode;
      if (code === DisconnectReason.loggedOut || code === DisconnectReason.badSession) {
        wantOn = false; st.number = ''; st.name = '';
        await clearSession();
        set('off', 'O WhatsApp foi desconectado pelo celular. Toque em Conectar e leia o QR Code de novo.');
        return;
      }
      if (!wantOn) { set('off'); return; }
      if (code === DisconnectReason.restartRequired) { start().catch(falhou); return; } // acontece logo depois de ler o QR Code
      if (!auth.creds.me) {
        wantOn = false;
        set('off', viuQr ? 'O QR Code expirou. Toque em Conectar para gerar outro.' : 'Não deu para falar com o WhatsApp agora. Tente de novo em alguns minutos.');
        if (!viuQr) console.error('WhatsApp dos lembretes:', u.lastDisconnect?.error?.message);
        return;
      }
      retry += 1;
      set('conectando');
      retryTimer = setTimeout(() => start().catch(falhou), Math.min(120000, 3000 * 2 ** Math.min(retry, 6)));
    }
  });
}
function falhou(err) {
  sock = null;
  console.error('WhatsApp dos lembretes:', err.message);
  set('off', 'Não deu para conectar ao WhatsApp agora. Tente de novo em alguns minutos.');
}

/** Barbeiro tocou em "Conectar". */
async function connect() {
  if (st.state === 'on' || st.state === 'qr') return info();
  st.error = '';
  await start().catch(falhou);
  return info();
}
/** Barbeiro tocou em "Desconectar": sai do WhatsApp e apaga a sessão. */
async function disconnect() {
  wantOn = false;
  clearTimeout(retryTimer);
  const s = sock; sock = null;
  if (s) { try { await s.logout(); } catch { try { s.end(undefined); } catch { /* já fechou */ } } }
  await clearSession();
  st.number = ''; st.name = ''; st.since = null; st.qr = null;
  set('off');
  return info();
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** Manda uma mensagem de texto para um celular brasileiro (só os números, com DDD). */
async function send(phone, text) {
  if (st.state !== 'on' || !sock) throw new Error('O WhatsApp dos lembretes está desconectado.');
  const d = String(phone || '').replace(/\D/g, '');
  if (d.length < 10) throw new Error('Telefone do cliente incompleto.');
  // Pergunta ao WhatsApp qual é o número certo (alguns celulares antigos não têm o 9 na conta).
  const [r] = await sock.onWhatsApp('55' + d);
  if (!r || !r.exists) throw new Error('Esse número não tem WhatsApp.');
  const jid = r.jid;
  // Mostra "digitando…" por alguns segundos, como uma pessoa faria.
  await sock.sendPresenceUpdate('composing', jid).catch(() => {});
  await wait(1500 + Math.min(4000, text.length * 25));
  await sock.sendPresenceUpdate('paused', jid).catch(() => {});
  await sock.sendMessage(jid, { text });
}

/** Ao ligar o servidor: se já tinha um WhatsApp conectado, reconecta sozinho. */
async function init() {
  try {
    const { rows } = await db.query("SELECT 1 FROM wa_auth WHERE key = 'creds' AND value LIKE '%\"me\"%'");
    if (rows[0]) await start();
  } catch (err) { falhou(err); }
}

module.exports = { info, connect, disconnect, send, init, state: () => st.state };
