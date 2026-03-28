/**
 * bot/bot.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Entry point do bot portável ix-bot.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Fluxo de inicialização:
 *  1. Lê ou gera um BOT_ID único (UUID persistido em .bot-id)
 *  2. Registra-se no dashboard via HTTP POST /api/bots/register
 *  3. Conecta ao dashboard via Socket.io
 *  4. Inicia heartbeat periódico
 *  5. Fica aguardando comandos do dashboard em tempo real
 *
 * Para usar:
 *  1. Edite bot/config.js com a URL do seu dashboard
 *  2. npm install (apenas uma vez)
 *  3. node bot.js
 */

const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const config = require('./config');
const dashboardClient = require('./src/api/dashboard-client');
const dispatcher = require('./src/modules/index');

// ── Arquivo de persistência do BOT_ID ──────────────────────────────────────
const BOT_ID_FILE = path.join(__dirname, '.bot-id');

/**
 * Lê o BOT_ID do arquivo local ou gera um novo UUID e o salva.
 * @returns {string} UUID único do bot
 */
function getBotId() {
  if (fs.existsSync(BOT_ID_FILE)) {
    const id = fs.readFileSync(BOT_ID_FILE, 'utf-8').trim();
    if (id && id.length > 0) return id;
  }

  // Gera novo UUID e persiste
  const newId = uuidv4();
  fs.writeFileSync(BOT_ID_FILE, newId, 'utf-8');
  console.log(`[Bot] Novo BOT_ID gerado e salvo: ${newId}`);
  return newId;
}

/**
 * Tenta se conectar ao dashboard com retries.
 * @param {string} botId
 * @param {string} botName
 * @param {number} attempt
 */
async function connectWithRetry(botId, botName, attempt = 1) {
  try {
    console.log(`[Bot] Tentando registrar no dashboard (tentativa ${attempt})...`);
    await dashboardClient.register(botId, botName);
    console.log(`[Bot] ✅ Registrado no dashboard com sucesso!`);
  } catch (err) {
    console.error(`[Bot] ❌ Falha no registro: ${err.message}`);
    if (attempt < config.RECONNECT_ATTEMPTS) {
      console.log(`[Bot] Aguardando ${config.RECONNECT_DELAY_MS}ms antes de tentar novamente...`);
      await new Promise((r) => setTimeout(r, config.RECONNECT_DELAY_MS));
      return connectWithRetry(botId, botName, attempt + 1);
    }
    throw new Error(`[Bot] Não foi possível registrar no dashboard após ${config.RECONNECT_ATTEMPTS} tentativas.`);
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// INICIALIZAÇÃO PRINCIPAL
// ══════════════════════════════════════════════════════════════════════════════

async function main() {
  console.log('\n═══════════════════════════════════════════════════');
  console.log('  🤖 ix-bot — Bot de Automação ixBrowser');
  console.log('═══════════════════════════════════════════════════');
  console.log(`  Dashboard : ${config.DASHBOARD_API_URL}`);
  console.log(`  ixBrowser : ${config.IX_API_BASE}`);
  console.log(`  Nome      : ${config.BOT_NAME}`);
  console.log('───────────────────────────────────────────────────\n');

  // 1. Lê ou gera o BOT_ID único desta instalação
  const BOT_ID = getBotId();
  console.log(`[Bot] BOT_ID: ${BOT_ID}`);

  // 2. Inicializa o dispatcher com o ID do bot
  dispatcher.init(BOT_ID);

  // 3. Registra no dashboard via HTTP (com retry)
  await connectWithRetry(BOT_ID, config.BOT_NAME);

  // 4. Conecta via Socket.io e define o handler de comandos
  await dashboardClient.connectSocket(BOT_ID, config.BOT_NAME, async (command, payload) => {
    console.log(`\n[Bot] ▶ Executando comando: "${command}"`, payload);
    await dispatcher.execute(command, payload);
  });

  // 5. Inicia heartbeat periódico
  dashboardClient.startHeartbeat(BOT_ID);

  // ── Log de boas-vindas ────────────────────────────────────────────────────
  dashboardClient.sendLog(BOT_ID, 'success', `Bot "${config.BOT_NAME}" (${BOT_ID}) online e aguardando comandos.`);

  console.log('\n[Bot] ✅ Bot iniciado com sucesso! Aguardando comandos do dashboard...');
  console.log('[Bot] Pressione CTRL+C para encerrar.\n');

  // ── Graceful shutdown ─────────────────────────────────────────────────────
  process.on('SIGINT', async () => {
    console.log('\n[Bot] 🛑 Encerrando bot...');
    dashboardClient.sendLog(BOT_ID, 'warn', `Bot "${config.BOT_NAME}" está sendo encerrado.`);

    // Avisa o dashboard que o bot vai ficar offline ANTES de desconectar o socket
    await dashboardClient.sendOffline(BOT_ID, config.BOT_NAME);

    // Fecha todos os perfis abertos
    try {
      const puppeteerBot = require('./src/bot/puppeteer');
      await puppeteerBot.disconnectAll();
    } catch (_) {}

    dashboardClient.disconnect();
    process.exit(0);
  });
}

// Executa o bot
main().catch((err) => {
  console.error('\n[Bot] ❌ ERRO FATAL:', err.message);
  console.error('[Bot] Verifique se o dashboard está online e o config.js está correto.\n');
  process.exit(1);
});
