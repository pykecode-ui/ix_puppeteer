/**
 * bot/src/modules/index.js
 * Dispatcher de comandos do dashboard.
 * Recebe o nome do comando e o payload e executa a ação correspondente.
 * Para adicionar novos comandos: registre-os no objeto `COMMANDS`.
 */

const ixbrowser = require('../api/ixbrowser');
const puppeteerBot = require('../bot/puppeteer');
const client = require('../api/dashboard-client');

// ── Referência ao botId (injetado ao inicializar) ───────────────────────────
let BOT_ID = null;

/**
 * Inicializa o dispatcher com o ID deste bot.
 * @param {string} botId
 */
function init(botId) {
  BOT_ID = botId;
}

/**
 * Helper: envia log ao dashboard.
 * @param {'info'|'success'|'error'|'warn'} level
 * @param {string} message
 */
function log(level, message) {
  client.sendLog(BOT_ID, level, message);
}

// ══════════════════════════════════════════════════════════════════════════════
// COMANDOS DISPONÍVEIS
// Cada comando recebe `payload` (objeto) e deve retornar uma Promise.
// ══════════════════════════════════════════════════════════════════════════════

const COMMANDS = {

  /**
   * Abre um perfil no ixBrowser e conecta o Puppeteer.
   * payload: { profileId: number }
   */
  async open_profile({ profileId }) {
    if (!profileId) throw new Error('profileId é obrigatório para open_profile.');

    log('info', `🔓 Abrindo perfil #${profileId} no ixBrowser...`);

    // Notifica dashboard: abrindo
    client.sendStatus(BOT_ID, { profileId, status: 'opening' });

    // 1. Chama API do ixBrowser para abrir o perfil
    const profileData = await ixbrowser.openProfile(profileId);
    log('success', `✅ Perfil #${profileId} aberto. WebSocket: ${profileData.ws}`);

    // 2. Conecta Puppeteer ao browser
    const { page } = await puppeteerBot.connectToProfile(profileId, profileData.ws);
    const currentUrl = page.url() || 'about:blank';
    log('info', `🤖 Puppeteer conectado ao perfil #${profileId}. URL: ${currentUrl}`);

    // 3. Notifica dashboard: aberto
    client.sendStatus(BOT_ID, {
      profileId,
      status: 'open',
      wsEndpoint: profileData.ws,
      currentUrl,
    });

    return { ok: true, profileId, ws: profileData.ws, currentUrl };
  },

  /**
   * Fecha um perfil: desconecta Puppeteer e fecha via ixBrowser.
   * payload: { profileId: number }
   */
  async close_profile({ profileId }) {
    if (!profileId) throw new Error('profileId é obrigatório para close_profile.');

    log('info', `🔒 Fechando perfil #${profileId}...`);

    // Notifica dashboard: fechando
    client.sendStatus(BOT_ID, { profileId, status: 'closing' });

    // 1. Desconecta Puppeteer
    await puppeteerBot.disconnectProfile(profileId);
    log('info', `Puppeteer desconectado do perfil #${profileId}.`);

    // 2. Fecha via API do ixBrowser
    await ixbrowser.closeProfile(profileId);
    log('success', `✅ Perfil #${profileId} fechado com sucesso.`);

    // 3. Notifica dashboard: fechado
    client.sendStatus(BOT_ID, { profileId, status: 'closed' });

    return { ok: true, profileId };
  },

  /**
   * Retorna a lista de perfis ativos no bot.
   * payload: {} (sem parâmetros)
   */
  async list_profiles() {
    const profiles = puppeteerBot.getActiveProfiles();
    log('info', `Perfis ativos: ${profiles.length}`);
    profiles.forEach((p) => {
      log('info', `  → Perfil #${p.profileId} | URL: ${p.url} | Conectado: ${p.connected}`);
    });
    return { ok: true, profiles };
  },

  /**
   * Fecha todos os perfis abertos pelo bot.
   * payload: {}
   */
  async close_all_profiles() {
    log('warn', '⚠️ Fechando todos os perfis ativos...');
    const profiles = puppeteerBot.getActiveProfiles();

    for (const { profileId } of profiles) {
      try {
        await COMMANDS.close_profile({ profileId });
      } catch (err) {
        log('error', `Erro ao fechar perfil #${profileId}: ${err.message}`);
      }
    }

    log('success', `✅ ${profiles.length} perfil(is) fechado(s).`);
    return { ok: true, count: profiles.length };
  },

  /**
   * Navega em uma URL em um perfil já aberto.
   * payload: { profileId: number, url: string }
   */
  async navigate({ profileId, url }) {
    if (!profileId || !url) throw new Error('profileId e url são obrigatórios para navigate.');

    const session = puppeteerBot.getProfileSession(profileId);
    if (!session) throw new Error(`Perfil #${profileId} não está conectado. Abra-o primeiro.`);

    log('info', `🌐 Navegando perfil #${profileId} → ${url}`);
    await session.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    const currentUrl = session.page.url();
    log('success', `✅ Perfil #${profileId} em: ${currentUrl}`);

    client.sendStatus(BOT_ID, { profileId, currentUrl, status: 'open' });
    return { ok: true, profileId, currentUrl };
  },

};

/**
 * Executa um comando recebido do dashboard.
 * @param {string} command - Nome do comando (ex: 'open_profile')
 * @param {object} payload - Parâmetros do comando
 * @returns {Promise<object>}
 */
async function execute(command, payload = {}) {
  const fn = COMMANDS[command];
  if (!fn) {
    log('warn', `⚠️ Comando desconhecido: "${command}". Ignorado.`);
    throw new Error(`Comando "${command}" não existe no dispatcher.`);
  }

  try {
    const result = await fn(payload);
    return result;
  } catch (err) {
    log('error', `❌ Falha ao executar "${command}": ${err.message}`);
    throw err;
  }
}

module.exports = { init, execute };
