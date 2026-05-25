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

// ── Cache de geolocalização por perfil ──────────────────────────────────────
const profileGeoCache = {};

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

    // 2. Registra abertura no dashboard (incrementa open_count)
    client.notifyProfileOpen(profileId);

    // 3. Conecta Puppeteer ao browser
    const { page } = await puppeteerBot.connectToProfile(profileId, profileData.ws);
    const currentUrl = page.url() || 'about:blank';
    log('info', `🤖 Puppeteer conectado ao perfil #${profileId}. URL: ${currentUrl}`);

    // 4. Notifica dashboard: aberto
    client.sendStatus(BOT_ID, {
      profileId,
      status: 'open',
      wsEndpoint: profileData.ws,
      currentUrl,
    });

    // 5. Extrai geolocalização da página padrão do ixBrowser (IP-API)
    try {
      // Aguarda o elemento #country ficar preenchido (a página faz XHR para ip-api)
      await page.waitForFunction(
        () => {
          const el = document.getElementById('country');
          return el && el.textContent && el.textContent.trim().length > 0 && el.textContent.trim() !== '----';
        },
        { timeout: 12000 }
      );

      const geo = await page.evaluate(() => {
        const country = (document.getElementById('country')?.textContent || '').trim();
        const region = (document.getElementById('region')?.textContent || '').trim();
        const city = (document.getElementById('city')?.textContent || '').trim();
        return { country, region, city };
      });

      if (geo.country) {
        log('info', `🌍 Geo: ${geo.country} / ${geo.region} / ${geo.city}`);
        profileGeoCache[profileId] = geo;
        client.sendStatus(BOT_ID, {
          profileId,
          status: 'geo_update',
          geo,
        });
      }
    } catch (geoErr) {
      log('warn', `⚠️ Não foi possível extrair geolocalização: ${geoErr.message}`);
    }

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

  /**
   * Inicia o bot: abre todos os perfis e inicia pesquisa automática.
   * Para cada perfil, busca o módulo de pesquisa vinculado e inicia o SearchWorker.
   * payload: { profileIds: number[] }
   */
  async start_bot({ profileIds = [] }) {
    if (profileIds.length === 0) {
      log('warn', '⚠️ start_bot: nenhum perfil recebido.');
      return { ok: false, reason: 'no_profiles' };
    }

    log('info', `▶ Iniciando bot com ${profileIds.length} perfil(is): ${profileIds.join(', ')}`);

    const axios = require('axios');
    const config = require('../../config');
    const http = axios.create({
      baseURL: config.DASHBOARD_API_URL,
      timeout: config.API_TIMEOUT_MS,
    });

    const results = [];
    for (let i = 0; i < profileIds.length; i++) {
      const profileId = profileIds[i];
      try {
        if (i > 0) {
          log('info', `Aguardando 2 segundos antes de abrir o próximo perfil...`);
          await new Promise(r => setTimeout(r, 2000));
        }
        const r = await COMMANDS.open_profile({ profileId });
        results.push({ profileId, ok: true, ...r });

        // ── Busca módulo vinculado e inicia pesquisa automática ──────────
        try {
          const linksRes = await http.get('/api/profile-module-links');
          const links = linksRes.data?.links || [];
          const link = links.find(l => l.profile_id === profileId);

          if (link && link.module_id) {
            log('info', `📋 Perfil #${profileId} tem módulo "${link.label}" (ID: ${link.module_id}) vinculado.`);
            log('info', `🔍 Iniciando pesquisa automática…`);

            // Inicia pesquisa (em background — não bloqueia outros perfis)
            await COMMANDS.start_search({
              profileId,
              moduleId: link.module_id,
              rounds: 1,
              searchMethod: 'direct_url',
              twoCaptchaKey: config.TWOCAPTCHA_API_KEY || '',
            });
          } else {
            log('info', `ℹ️ Perfil #${profileId} não tem módulo de pesquisa vinculado. Pulando pesquisa.`);
          }
        } catch (searchErr) {
          log('error', `❌ Erro ao iniciar pesquisa para perfil #${profileId}: ${searchErr.message}`);
        }

      } catch (err) {
        log('error', `❌ Falha ao abrir perfil #${profileId}: ${err.message}`);
        results.push({ profileId, ok: false, error: err.message });
      }
    }

    const ok = results.filter((r) => r.ok).length;
    log('success', `✅ start_bot concluído: ${ok}/${profileIds.length} perfis abertos.`);
    return { ok: true, results };
  },


  /**
   * Pausa o bot: fecha todos os perfis abertos.
   * payload: {}
   */
  async pause_bot() {
    log('warn', '⏸ Pausando bot — fechando todos os perfis abertos...');
    await COMMANDS.close_all_profiles();
    log('success', '⏹ Bot pausado com sucesso.');
    return { ok: true };
  },

  /**
   * Inicia pesquisa de palavras-chave no Google para um perfil.
   * payload: {
   *   profileId: number,      — ID do perfil (deve estar aberto)
   *   moduleId: number,       — ID do módulo de pesquisa (palavras)
   *   rounds: number,         — Número de rodadas (padrão: 1)
   *   searchMethod: string,   — 'direct_url' | 'homepage' (padrão: 'direct_url')
   *   twoCaptchaKey: string,  — Chave API do 2Captcha (opcional)
   * }
   */
  async start_search({ profileId, moduleId, rounds, searchMethod, twoCaptchaKey }) {
    if (!profileId) throw new Error('profileId é obrigatório para start_search.');
    if (!moduleId) throw new Error('moduleId é obrigatório para start_search.');

    const session = puppeteerBot.getProfileSession(profileId);
    if (!session) {
      throw new Error(`Perfil #${profileId} não está conectado. Abra-o primeiro com open_profile.`);
    }

    log('info', `🔍 Iniciando pesquisa — perfil #${profileId}, módulo #${moduleId}…`);

    const { SearchWorker } = require('../bot/search-worker');

    // Cria o worker com callback de log para o dashboard
    const worker = new SearchWorker(profileId, moduleId, BOT_ID, {
      log: (msg) => log('info', msg),
      rounds: rounds || 1,
      searchMethod: searchMethod || 'direct_url',
      twoCaptchaKey: twoCaptchaKey || '',
      geo: profileGeoCache[profileId] || null,
    });

    // Armazena referência para poder cancelar
    if (!global._searchWorkers) global._searchWorkers = new Map();
    global._searchWorkers.set(profileId, worker);

    // Notifica dashboard que pesquisa começou (mantém status 'open' para o handler reconhecer)
    client.sendStatus(BOT_ID, {
      profileId,
      status: 'open',
      moduleId,
    });

    // Executa em background (não bloqueia o dispatcher)
    const runPromise = worker.run().then((summary) => {
      global._searchWorkers.delete(profileId);
      client.sendStatus(BOT_ID, {
        profileId,
        status: 'open',
        searchSummary: {
          keywordsDone: summary.keywordsDone,
          totalAdsFound: summary.totalAdsFound,
          errors: summary.errors,
          status: summary.status,
        },
      });
      log('success', `✅ Pesquisa finalizada para perfil #${profileId}: ${summary.keywordsDone} palavras, ${summary.totalAdsFound} anúncios`);
      return summary;
    }).catch((err) => {
      global._searchWorkers.delete(profileId);
      log('error', `❌ Pesquisa falhou para perfil #${profileId}: ${err.message}`);
      client.sendStatus(BOT_ID, { profileId, status: 'open' });
    });

    return { ok: true, message: `Pesquisa iniciada em background para perfil #${profileId}` };
  },

  /**
   * Cancela pesquisa em andamento para um perfil.
   * payload: { profileId: number }
   */
  async cancel_search({ profileId }) {
    if (!profileId) throw new Error('profileId é obrigatório para cancel_search.');

    if (!global._searchWorkers || !global._searchWorkers.has(profileId)) {
      log('warn', `⚠️ Nenhuma pesquisa em andamento para perfil #${profileId}.`);
      return { ok: false, reason: 'no_active_search' };
    }

    const worker = global._searchWorkers.get(profileId);
    worker.cancel();
    log('warn', `🛑 Pesquisa cancelada para perfil #${profileId}.`);
    return { ok: true };
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
