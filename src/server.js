require('dotenv').config();
const path = require('path');
const express = require('express');
const cookieParser = require('cookie-parser');

const app = express();
const PUBLIC = path.join(__dirname, '..', 'public');

app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(express.json({ limit: '2.5mb' }));
app.use(cookieParser());

// Toda mudança no banco (agendar, cancelar, configurações) atualiza a lista de lembretes do dia
const lembretes = require('./lembretes');
app.use('/api', (req, res, next) => {
  if (req.method !== 'GET') res.on('finish', () => { if (res.statusCode < 400) lembretes.schedule(); });
  next();
});
app.use('/api/public', require('./routes/public'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api', (req, res) => res.status(404).json({ error: 'Rota não encontrada.' }));

app.use(express.static(PUBLIC, { extensions: ['html'] }));
app.get('/painel', (req, res) => res.sendFile(path.join(PUBLIC, 'painel', 'index.html')));
app.get('/', (req, res) => res.sendFile(path.join(PUBLIC, 'index.html')));

// Erros: mensagens claras para quem usa, detalhes técnicos só no terminal
app.use((err, req, res, next) => {
  if (err.status && err.status < 500) return res.status(err.status).json({ error: err.message, ...(err.code ? { code: err.code } : {}) });
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Arquivo muito grande.' });
  console.error(err);
  res.status(500).json({ error: 'Algo deu errado no servidor. Tente de novo.' });
});

const PORT = Number(process.env.PORT) || 3000;

// Ao ligar, garante que o banco tem todas as tabelas e colunas novas (é seguro rodar sempre).
// Assim uma atualização no Render já ajusta o Neon sozinha, sem precisar rodar db:setup.
async function migrate() {
  const fs = require('fs');
  const db = require('./db');
  try {
    await db.query(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
    await db.query('INSERT INTO settings (id) VALUES (1) ON CONFLICT DO NOTHING');
  } catch (err) {
    console.error('Não consegui atualizar as tabelas do banco:', err.message);
  }
}

migrate().then(() => app.listen(PORT, () => {
  require('./whatsapp').init();
  lembretes.start();
  console.log(`\n  Barbearia rodando:`);
  console.log(`  Site do cliente:   http://localhost:${PORT}`);
  console.log(`  Painel do barbeiro: http://localhost:${PORT}/painel\n`);
}));
