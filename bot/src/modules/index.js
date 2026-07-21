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

// ── Loops de perfis ativos ──────────────────────────────────────────────────
if (!global._profileLoops) {
  global._profileLoops = new Map();
}

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

/**
 * Lógica assíncrona que gerencia o ciclo de repetição de um perfil.
 * @param {number} profileId
 * @param {import('axios').AxiosInstance} http
 */
async function runProfileLoop(profileId, http) {
  let cancelled = false;
  let activeTimeout = null;
  let sleepResolve = null;

  const sleep = (ms) => new Promise(resolve => {
    sleepResolve = resolve;
    activeTimeout = setTimeout(() => {
      activeTimeout = null;
      sleepResolve = null;
      resolve();
    }, ms);
  });

  const loopState = {
    cancel: () => {
      cancelled = true;
      log('warn', `🛑 Cancelando loop de repetição do perfil #${profileId}.`);
      if (activeTimeout) {
        clearTimeout(activeTimeout);
        activeTimeout = null;
      }
      if (sleepResolve) {
        sleepResolve();
        sleepResolve = null;
      }
      if (global._searchWorkers && global._searchWorkers.has(profileId)) {
        const worker = global._searchWorkers.get(profileId);
        if (worker && typeof worker.cancel === 'function') {
          worker.cancel();
        }
      }
    }
  };

  if (!global._profileLoops) {
    global._profileLoops = new Map();
  }
  global._profileLoops.set(profileId, loopState);

  try {
    const profRes = await http.get(`/api/profiles/${profileId}`);
    if (!profRes.data?.ok || !profRes.data.profile) {
      throw new Error(`Perfil #${profileId} não encontrado no banco.`);
    }
    const profile = profRes.data.profile;
    const loopCount = profile.loop_count !== undefined ? profile.loop_count : 1;
    const isInfinite = !!profile.infinite_loop;

    log('info', `🔁 Perfil #${profileId}: Configurado com loop_count=${loopCount}, infinite=${isInfinite}`);

    let iteration = 0;
    let consecutiveOpenFailures = 0;

    while (!cancelled) {
      iteration++;

      if (!isInfinite && iteration > loopCount) {
        log('info', `🏁 Perfil #${profileId}: Atingiu o limite de ${loopCount} repetição(ões).`);
        break;
      }

      log('info', `🔄 [Ciclo ${iteration}] Perfil #${profileId}: Iniciando ciclo...`);

      // A. Abre o perfil
      if (cancelled) break;
      let openRes;
      try {
        openRes = await COMMANDS.open_profile({ profileId });
        consecutiveOpenFailures = 0; // Reseta falhas em caso de sucesso
      } catch (err) {
        consecutiveOpenFailures++;
        log('error', `❌ [Ciclo ${iteration}] Perfil #${profileId}: Falha ao abrir perfil: ${err.message}`);

        // Verifica se é erro fatal de cota do ixBrowser (ex: código 1018 - 100 aberturas/dia atingido)
        const isQuotaError = err.message && (
          err.message.includes('1018') ||
          err.message.includes('100 profile opening times') ||
          err.message.includes('opening times per day') ||
          err.message.includes('upgrade the plan')
        );

        if (isQuotaError) {
          log('error', `🛑 [Perfil #${profileId}] Limite diário de aberturas de perfil do ixBrowser atingido (Erro 1018). Interrompendo loop.`);
          break;
        }

        if (consecutiveOpenFailures >= 3) {
          log('error', `🛑 [Perfil #${profileId}] Interrompendo loop após ${consecutiveOpenFailures} falhas consecutivas de abertura.`);
          break;
        }

        // Tenta resetar o estado de abertura no ixBrowser preventivamente para destravar
        try {
          log('info', `🔄 [Ciclo ${iteration}] Perfil #${profileId}: Solicitando reset do estado do perfil no ixBrowser...`);
          await ixbrowser.resetProfileState(profileId);
        } catch (resetErr) {
          log('warn', `⚠️ [Ciclo ${iteration}] Perfil #${profileId}: Não foi possível resetar o estado no ixBrowser: ${resetErr.message}`);
        }

        if (cancelled) break;
        await sleep(10000);
        continue;
      }

      if (cancelled) {
        try {
          await puppeteerBot.disconnectProfile(profileId);
          await ixbrowser.closeProfile(profileId);
          client.sendStatus(BOT_ID, { profileId, status: 'closed' });
        } catch (_) {}
        break;
      }

      // B. Busca módulo vinculado e faz pesquisa
      if (cancelled) break;
      try {
        const linksRes = await http.get('/api/profile-module-links');
        if (cancelled) break;
        const links = linksRes.data?.links || [];
        const link = links.find(l => l.profile_id === profileId);

        if (link && link.module_id) {
          log('info', `📋 [Ciclo ${iteration}] Perfil #${profileId}: Pesquisando módulo "${link.label}" (ID: ${link.module_id}).`);

          const config = require('../../config');
          const { SearchWorker } = require('../bot/search-worker');

          const worker = new SearchWorker(profileId, link.module_id, BOT_ID, {
            log: (msg) => log('info', msg),
            rounds: 1,
            searchMethod: 'direct_url',
            twoCaptchaKey: config.TWOCAPTCHA_API_KEY || '',
            geo: profileGeoCache[profileId] || null,
          });

          if (!global._searchWorkers) global._searchWorkers = new Map();
          global._searchWorkers.set(profileId, worker);

          client.sendStatus(BOT_ID, {
            profileId,
            status: 'open',
            moduleId: link.module_id,
          });

          const summary = await worker.run();

          global._searchWorkers.delete(profileId);

          if (cancelled) break;

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

          log('success', `✅ [Ciclo ${iteration}] Perfil #${profileId}: Pesquisa concluída (${summary.keywordsDone} palavras, ${summary.totalAdsFound} anúncios).`);
        } else {
          log('info', `ℹ️ [Ciclo ${iteration}] Perfil #${profileId} não tem módulo de pesquisa vinculado. Pulando pesquisa.`);
          if (cancelled) break;
          await sleep(5000);
        }
      } catch (err) {
        log('error', `❌ [Ciclo ${iteration}] Perfil #${profileId}: Erro na pesquisa: ${err.message}`);
      }

      if (cancelled) {
        try {
          await puppeteerBot.disconnectProfile(profileId);
          await ixbrowser.closeProfile(profileId);
          client.sendStatus(BOT_ID, { profileId, status: 'closed' });
        } catch (_) {}
        break;
      }

      // C. Fecha o perfil (fecha diretamente para não cancelar o próprio loop)
      try {
        log('info', `⏳ [Ciclo ${iteration}] Perfil #${profileId}: Aguardando 5 segundos antes de fechar o perfil...`);
        await sleep(5000);

        if (cancelled) {
          try {
            await puppeteerBot.disconnectProfile(profileId);
            await ixbrowser.closeProfile(profileId);
            client.sendStatus(BOT_ID, { profileId, status: 'closed' });
          } catch (_) {}
          break;
        }

        log('info', `🔒 [Ciclo ${iteration}] Perfil #${profileId}: Finalizando ciclo. Fechando perfil...`);
        await puppeteerBot.disconnectProfile(profileId);
        await ixbrowser.closeProfile(profileId);
        client.sendStatus(BOT_ID, { profileId, status: 'closed' });
        log('success', `✅ [Ciclo ${iteration}] Perfil #${profileId}: Fechado com sucesso.`);
      } catch (err) {
        log('error', `❌ [Ciclo ${iteration}] Perfil #${profileId}: Erro ao fechar perfil: ${err.message}`);
      }

      if (cancelled) break;

      log('info', `⏳ Perfil #${profileId}: Aguardando 5 segundos para iniciar o próximo ciclo...`);
      await sleep(5000);
    }
  } catch (err) {
    log('error', `❌ Erro no loop de repetição do perfil #${profileId}: ${err.message}`);
  } finally {
    // Garante que se o loop finalizar por cancelamento ou erro, o perfil seja fechado e o Puppeteer desconectado
    try {
      const session = puppeteerBot.getProfileSession(profileId);
      if (session) {
        log('info', `🔒 Perfil #${profileId}: Loop finalizado. Garantindo fechamento físico do perfil...`);
        await puppeteerBot.disconnectProfile(profileId);
        await ixbrowser.closeProfile(profileId);
        client.sendStatus(BOT_ID, { profileId, status: 'closed' });
      }
    } catch (cleanErr) {
      log('warn', `⚠️ Erro ao garantir fechamento do perfil #${profileId} no encerramento do loop: ${cleanErr.message}`);
    }

    // Só deleta do Map se o loop que está no Map for este loopState atual!
    if (global._profileLoops && global._profileLoops.get(profileId) === loopState) {
      global._profileLoops.delete(profileId);
    }
    log('info', `⏹ Perfil #${profileId}: Loop finalizado.`);
  }
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

    // 1. Busca configurações extras do perfil no dashboard (clean_cache e random_fp)
    let cleanCache = false;
    let randomFp = false;
    try {
      const profile = await client.getProfile(profileId);
      if (profile) {
        cleanCache = !!profile.clean_cache;
        randomFp = !!profile.random_fp;
        if (cleanCache || randomFp) {
          log('info', `⚙️ Perfil #${profileId} possui configurações extras ativas: [Cache Limpo: ${cleanCache ? 'SIM' : 'NÃO'}, Fingerprint Novo: ${randomFp ? 'SIM' : 'NÃO'}]`);
        }
      }
    } catch (err) {
      log('warn', `⚠️ Não foi possível obter as configurações extras do perfil #${profileId} no dashboard. Usando padrões desativados. Erro: ${err.message}`);
    }

    log('info', `🔓 Abrindo perfil #${profileId} no ixBrowser...`);

    // Notifica dashboard: abrindo
    client.sendStatus(BOT_ID, { profileId, status: 'opening' });

    // 2. Chama API do ixBrowser para abrir o perfil
    const profileData = await ixbrowser.openProfile(profileId, cleanCache, randomFp);
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

    // Cancela o loop de repetição se houver
    if (global._profileLoops && global._profileLoops.has(profileId)) {
      log('info', `[Loop] Cancelando loop ativo do perfil #${profileId} via fechamento manual...`);
      const loop = global._profileLoops.get(profileId);
      if (loop && typeof loop.cancel === 'function') {
        loop.cancel();
      }
      global._profileLoops.delete(profileId);
    }

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
   * Fecha todos os perfis abertos pelo bot.
   * payload: {}
   */
  async close_all_profiles() {
    log('warn', '⚠️ Buscando perfis controlados pelo bot para fechar...');
    
    // Obtém perfis ativos rastreados pelo Puppeteer localmente
    const localOpened = puppeteerBot.getActiveProfiles();

    // Cria um Set único de IDs de perfis
    const uniqueProfileIds = new Set();
    
    // Adiciona IDs dos loops de repetição ativos do bot
    if (global._profileLoops) {
      for (const profileId of global._profileLoops.keys()) {
        uniqueProfileIds.add(Number(profileId));
      }
    }
    
    // Adiciona IDs das conexões Puppeteer ativas do bot
    localOpened.forEach(p => {
      if (p && p.profileId) {
        uniqueProfileIds.add(Number(p.profileId));
      }
    });

    log('info', `Encontrados ${uniqueProfileIds.size} perfil(is) ativo(s) controlados pelo bot. Fechando...`);

    let closedCount = 0;
    for (const profileId of uniqueProfileIds) {
      try {
        await COMMANDS.close_profile({ profileId });
        closedCount++;
      } catch (err) {
        log('error', `Erro ao fechar perfil #${profileId}: ${err.message}`);
      }
    }

    // Garante que todas as sessões locais do Puppeteer também sejam encerradas
    try {
      await puppeteerBot.disconnectAll();
    } catch (_) {}

    log('success', `✅ ${closedCount} perfil(is) fechado(s).`);
    return { ok: true, count: closedCount };
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
   * Inicia o bot: abre todos os perfis e inicia o loop de pesquisa automática.
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

    for (let i = 0; i < profileIds.length; i++) {
      const profileId = profileIds[i];
      try {
        // Se já houver um loop rodando para esse perfil, cancela
        if (global._profileLoops && global._profileLoops.has(profileId)) {
          log('info', `Re-iniciando loop para o perfil #${profileId}...`);
          const loop = global._profileLoops.get(profileId);
          if (loop && typeof loop.cancel === 'function') {
            loop.cancel();
          }
          global._profileLoops.delete(profileId);
        }

        if (i > 0) {
          log('info', `Aguardando 2 segundos antes de iniciar o próximo perfil...`);
          await new Promise(r => setTimeout(r, 2000));
        }

        // Inicia o loop em background (sem await)
        runProfileLoop(profileId, http).catch(err => {
          log('error', `❌ Erro fatal no loop do perfil #${profileId}: ${err.message}`);
        });

      } catch (err) {
        log('error', `❌ Falha ao iniciar perfil #${profileId}: ${err.message}`);
      }
    }

    log('success', `✅ start_bot: Todos os loops de repetição iniciados em background.`);
    return { ok: true };
  },


  /**
   * Pausa o bot: cancela todos os loops e fecha todos os perfis abertos.
   * payload: {}
   */
  async pause_bot() {
    log('warn', '⏸ Pausando bot — cancelando todos os loops e iniciando fechamento...');
    if (global._profileLoops) {
      for (const [profileId, loop] of global._profileLoops.entries()) {
        log('info', `Cancelando loop do perfil #${profileId}...`);
        if (loop && typeof loop.cancel === 'function') {
          loop.cancel();
        }
      }
      global._profileLoops.clear();
    }

    // Executa o fechamento físico dos perfis em background (fire-and-forget)
    // para evitar que instabilidades na Local API do ixBrowser travem a interface em "Pausando..."
    COMMANDS.close_all_profiles().catch(err => {
      log('error', `Erro ao fechar perfis após pausar: ${err.message}`);
    });

    log('success', '⏹ Bot pausado com sucesso. Interface liberada.');
    client.sendRunState(BOT_ID, 'idle');
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
