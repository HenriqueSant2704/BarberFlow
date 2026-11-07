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

app.use('/api/public', require('./routes/public'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api', (req, res) => res.status(404).json({ error: 'Rota não encontrada.' }));

app.use(express.static(PUBLIC, { extensions: ['html'] }));
app.get('/painel', (req, res) => res.sendFile(path.join(PUBLIC, 'painel', 'index.html')));
app.get('/', (req, res) => res.sendFile(path.join(PUBLIC, 'index.html')));

// Erros: mensagens claras para quem usa, detalhes técnicos só no terminal
app.use((err, req, res, next) => {
  if (err.status && err.status < 500) return res.status(err.status).json({ error: err.message });
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Arquivo muito grande.' });
  console.error(err);
  res.status(500).json({ error: 'Algo deu errado no servidor. Tente de novo.' });
});

const PORT = Number(process.env.PORT) || 3000;
app.listen(PORT, () => {
  console.log(`\n  Barbearia rodando:`);
  console.log(`  Site do cliente:   http://localhost:${PORT}`);
  console.log(`  Painel do barbeiro: http://localhost:${PORT}/painel\n`);
});
