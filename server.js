/**
 * server.js
 * Entry point do projeto ix-puppeteer-dashboard.
 * Inicializa o banco de dados, o servidor Express, serve os arquivos estáticos
 * do dashboard e configura o Socket.io para comunicação em tempo real.
 * Suporta múltiplos bots remotos via API REST + Socket.io.
 */

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

// ─── Inicializa os bancos ANTES de qualquer outro módulo que dependa deles ────
const { initDatabase } = require('./src/db/database');
const { initAdsDB } = require('./src/db/ads-database');
const models = require('./src/db/models');

initDatabase();
initAdsDB();

// Reseta todos os bots para "offline" ao iniciar o servidor.
// Evita bots "fantasma" que ficaram com status online de sessões anteriores
// (crashes, testes diretos via API, reinicializações sem graceful shutdown).
models.markAllBotsOffline();
console.log('[DB] ♻️  Status de todos os bots resetado para offline.');

const { registerHandlers } = require('./src/socket/handlers');
const { createBotRouter } = require('./src/api/bot-router');
const { createProfilesRouter } = require('./src/api/profiles-router');
const { createPalavrasRouter } = require('./src/api/palavras-router');
const { createAdsRouter } = require('./src/api/ads-router');


const app = express();
const server = http.createServer(app);

// Inicializa o Socket.io no mesmo servidor HTTP
const io = new Server(server, {
  cors: { origin: '*' },
});

// Middlewares
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve os arquivos estáticos do dashboard (HTML, CSS, JS)
app.use(express.static(path.join(__dirname, 'public')));

// ─── API REST para os bots ────────────────────────────────────────────────────
// Bots remotos usam estas rotas para registro, heartbeat e logs
app.use('/api', createBotRouter(io));

// ─── API REST para perfis globais ────────────────────────────────────────────
app.use('/api', createProfilesRouter(io));

// ─── API REST para módulos de pesquisa (palavras-chave) ──────────────────────
app.use('/api', createPalavrasRouter(io));

// ─── API REST para módulo de Ads (anúncios, whitelist, blacklist) ────────────
app.use('/api', createAdsRouter(io));


// Rota principal — retorna o dashboard
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Registra os handlers de Socket.io para cada cliente conectado (dashboard + bots)
io.on('connection', (socket) => {
  registerHandlers(socket, io);
});

// Inicia o servidor na porta 3000
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n🚀 Dashboard ixBrowser rodando em: http://localhost:${PORT}`);
  console.log(`📡 API REST para bots em: http://localhost:${PORT}/api`);
  console.log('   Pressione CTRL+C para encerrar.\n');
});
