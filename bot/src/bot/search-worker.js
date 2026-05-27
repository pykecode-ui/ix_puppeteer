/**
 * bot/src/bot/search-worker.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Worker de pesquisa: coordena a busca de palavras no Google para um perfil.
 *
 * Fluxo:
 *  1. Recebe profileId + moduleId do dashboard
 *  2. Busca as palavras do módulo via API do dashboard
 *  3. Abre o Google para cada palavra usando google-search.js
 *  4. Detecta/resolve CAPTCHA via captcha-solver.js
 *  5. Colhe anúncios da SERP
 *  6. Registra resultados no ads.db via API do dashboard
 *
 * Uso:
 *   const worker = new SearchWorker(profileId, moduleId, botId, opts);
 *   await worker.run();
 * ─────────────────────────────────────────────────────────────────────────────
 */

const axios = require('axios');
const config = require('../../config');
const {
  doGoogleSearch,
  harvestSerpAds,
  humanSleep,
  acceptGoogleCookies,
} = require('./google-search');
const { CaptchaSolver } = require('./captcha-solver');
const puppeteerBot = require('./puppeteer');

/**
 * Cria cliente HTTP para o dashboard.
 */
function createDashboardHttp() {
  return axios.create({
    baseURL: config.DASHBOARD_API_URL,
    timeout: config.API_TIMEOUT_MS,
    headers: { 'Content-Type': 'application/json' },
  });
}

class SearchWorker {
  /**
   * @param {number|string} profileId - ID do perfil no ixBrowser
   * @param {number} moduleId - ID do módulo de pesquisa (palavras)
   * @param {string} botId - ID deste bot
   * @param {object} opts
   * @param {function} opts.log - Função de log (padrão: console.log)
   * @param {string} opts.twoCaptchaKey - Chave API do 2Captcha (opcional)
   * @param {number} opts.rounds - Número de rodadas (padrão: 1)
   * @param {string} opts.searchMethod - 'direct_url' | 'homepage' (padrão: 'direct_url')
   * @param {number} opts.pauseBetweenKeywords - Pausa entre palavras em segundos (padrão: 2-5)
   * @param {number} opts.pauseBetweenRounds - Pausa entre rodadas em segundos (padrão: 16)
   */
  constructor(profileId, moduleId, botId, opts = {}) {
    this.profileId = profileId;
    this.moduleId = moduleId;
    this.botId = botId;
    this.log = opts.log || console.log;
    this.rounds = opts.rounds || 1;
    this.searchMethod = opts.searchMethod || 'direct_url';
    this.pauseBetweenKeywordsMin = opts.pauseBetweenKeywordsMin || 1;
    this.pauseBetweenKeywordsMax = opts.pauseBetweenKeywordsMax || 2;
    this.pauseBetweenRounds = opts.pauseBetweenRounds || 8;
    this.http = createDashboardHttp();

    // Captcha solver
    this.captchaSolver = new CaptchaSolver(opts.twoCaptchaKey || '');

    // Geolocalização do perfil (extraída ao abrir)
    this.geo = opts.geo || null;

    // Estado
    this._running = false;
    this._cancelled = false;
    this._sessionId = null;
  }

  /**
   * Cancela a execução do worker.
   */
  cancel() {
    this._cancelled = true;
    this.log('[SearchWorker] 🛑 Cancelamento solicitado.');
  }

  /**
   * Verifica se foi cancelado.
   */
  get isCancelled() {
    return this._cancelled;
  }

  /**
   * Busca as palavras do módulo via API do dashboard.
   * @returns {Promise<string[]>} Lista de palavras
   */
  async fetchModuleWords() {
    try {
      const res = await this.http.get(`/api/search-modules/${this.moduleId}`);
      if (!res.data?.ok) throw new Error(res.data?.error || 'Resposta inválida');

      const mod = res.data.module;
      if (!mod) throw new Error('Módulo não encontrado');
      if (!mod.words || mod.words.length === 0) {
        throw new Error(`Módulo "${mod.label}" não tem palavras cadastradas`);
      }

      // Extrai todas as palavras do módulo
      const words = mod.words.map((w) => w.word).filter(Boolean);

      if (words.length === 0) {
        throw new Error(`Módulo "${mod.label}" não tem palavras cadastradas`);
      }

      this.log(`[SearchWorker] 📋 Módulo "${mod.label}": ${words.length} palavra(s)`);
      return words;
    } catch (err) {
      throw new Error(`Falha ao buscar palavras do módulo #${this.moduleId}: ${err.message}`);
    }
  }

  /**
   * Busca regras ativas de whitelist e blacklist.
   */
  async fetchRules() {
    const whitelist = [];
    const blacklist = [];
    try {
      const [wlRes, blRes] = await Promise.all([
        this.http.get('/api/ads/whitelist').catch(() => ({ data: { rules: [] } })),
        this.http.get('/api/ads/blacklist').catch(() => ({ data: { rules: [] } })),
      ]);
      if (wlRes.data?.rules) whitelist.push(...wlRes.data.rules.filter((r) => r.is_active));
      if (blRes.data?.rules) blacklist.push(...blRes.data.rules.filter((r) => r.is_active));
    } catch (_) {}
    return { whitelist, blacklist };
  }

  /**
   * Cria uma sessão de pesquisa no ads.db via API.
   */
  async createSession(totalKeywords, roundNumber = 1) {
    try {
      const res = await this.http.post('/api/ads/sessions', {
        bot_id: this.botId,
        profile_id: this.profileId,
        module_id: this.moduleId,
        total_rounds: this.rounds,
        total_keywords: totalKeywords,
        round_number: roundNumber,
      });
      // A API de sessions não existe como POST ainda — registramos localmente
      // Para agora, usamos o endpoint que já existe
    } catch (_) {}
  }

  /**
   * Registra um anúncio encontrado via API.
   */
  async recordAd(adData) {
    try {
      await this.http.post('/api/ads/record', adData);
    } catch (_) {
      // Fire-and-forget — não bloqueia o fluxo
    }
  }

  /**
   * Testa um anúncio contra as regras de whitelist/blacklist.
   * @param {object} ad - Dados do anúncio
   * @param {Array} whitelist - Regras de whitelist ativas
   * @param {Array} blacklist - Regras de blacklist ativas
   * @returns {{isWhitelisted: boolean, isBlacklisted: boolean, whitelistRule: object|null, blacklistRule: object|null}}
   */
  matchAdAgainstRules(ad, whitelist, blacklist) {
    const haystack = [
      ad.hrefRaw, ad.hrefDecoded, ad.displayUrl, ad.adTitle, ad.adDescription, ad.dataPcu,
    ].filter(Boolean).join(' ').toLowerCase();

    let isWhitelisted = false;
    let whitelistRule = null;
    let isBlacklisted = false;
    let blacklistRule = null;

    for (const rule of whitelist) {
      const pattern = (rule.pattern || '').toLowerCase();
      if (!pattern) continue;
      if (haystack.includes(pattern)) {
        isWhitelisted = true;
        whitelistRule = rule;
        break;
      }
    }

    for (const rule of blacklist) {
      const pattern = (rule.pattern || '').toLowerCase();
      if (!pattern) continue;
      if (haystack.includes(pattern)) {
        isBlacklisted = true;
        blacklistRule = rule;
        break;
      }
    }

    return { isWhitelisted, isBlacklisted, whitelistRule, blacklistRule };
  }

  /**
   * Executa a pesquisa de uma keyword na SERP.
   * @param {import('puppeteer-core').Page} page
   * @param {string} keyword
   * @param {object} rules - { whitelist, blacklist }
   * @returns {Promise<object>} Resultado da execução
   */
  async searchKeyword(page, keyword, rules, clickEnabled = 0, clickCountMax = 3) {
    const startTime = Date.now();
    const result = {
      keyword,
      status: 'pending',
      adsFound: 0,
      ads: [],
      hadCaptcha: false,
      captchaSolved: false,
      cookiesAccepted: false,
      searchMethod: this.searchMethod,
      errorMessage: null,
      durationMs: 0,
    };

    try {
      // Pesquisa no Google
      await doGoogleSearch(page, keyword, {
        captchaSolver: this.captchaSolver,
        log: this.log,
        method: this.searchMethod,
      });

      // Captura URL da SERP
      result.serpUrl = page.url();

      // Colhe anúncios
      const ads = await harvestSerpAds(page, this.log);
      result.adsFound = ads.length;

      // Processa cada anúncio contra as regras
      for (const ad of ads) {
        const { isWhitelisted, isBlacklisted, whitelistRule, blacklistRule } =
          this.matchAdAgainstRules(ad, rules.whitelist, rules.blacklist);

        const processedAd = {
          ...ad,
          isWhitelisted,
          isBlacklisted,
          whitelistRuleId: whitelistRule?.id || null,
          blacklistRuleId: blacklistRule?.id || null,
        };

        result.ads.push(processedAd);

        // Log de status
        let statusIcon = '📄';
        if (isBlacklisted) statusIcon = '🚨';
        if (isWhitelisted) statusIcon = '⏭️';

        this.log(
          `  ${statusIcon} [${ad.position}] ${ad.adTitle?.slice(0, 50) || 'Sem título'}`
          + (ad.adDescription ? ` | Desc: ${ad.adDescription.slice(0, 60)}...` : '')
          + ` → ${ad.displayUrl || ad.hrefDecoded?.slice(0, 60) || '?'}`
          + (isWhitelisted ? ' (whitelist — ignorado)' : '')
          + (isBlacklisted ? ` (blacklist — ${blacklistRule?.action || 'flag'})` : '')
        );
      }

      result.status = 'completed';

      // Realiza cliques em anúncios da Blacklist se habilitado
      if (clickEnabled === 1) {
        const blacklistAds = result.ads.filter(ad => ad.isBlacklisted);
        if (blacklistAds.length > 0) {
          let clicksDone = 0;
          let consecutiveFailures = 0;
          this.log(`[SearchWorker] 🖱️ Detectados ${blacklistAds.length} anúncio(s) na Blacklist. Iniciando rotina de cliques (limite: ${clickCountMax})...`);
          
          while (clicksDone < clickCountMax && consecutiveFailures < 3) {
            const targetIndex = clicksDone % blacklistAds.length;
            const targetAd = blacklistAds[targetIndex];
            
            this.log(`[SearchWorker] 🖱️ Efetuando clique (${clicksDone + 1}/${clickCountMax}) no anúncio da Blacklist: "${targetAd.adTitle}"`);
            const clicked = await this.clickAdOnPage(page, targetAd);
            if (clicked) {
              clicksDone++;
              consecutiveFailures = 0; // reseta falhas em caso de sucesso
              
              // Salva de forma acumulativa os cliques realizados no anúncio
              targetAd.click_count = (targetAd.click_count || 0) + 1;
              targetAd.was_clicked = 1;

              if (clicksDone < clickCountMax) {
                await humanSleep(2, 4); // pausa entre cliques
              }
            } else {
              consecutiveFailures++;
              this.log(`[SearchWorker] ⚠️ Falha ao efetuar clique (${consecutiveFailures}/3 falhas consecutivas).`);
              if (consecutiveFailures < 3) {
                await humanSleep(1, 2);
              }
            }
          }

          if (consecutiveFailures >= 3) {
            this.log(`[SearchWorker] 🛑 Interrompendo rotina de cliques após 3 falhas consecutivas.`);
          }

          // Fecha todas as abas extras residuais após a rotina de cliques desta keyword terminar
          try {
            const browser = page.browser();
            const pages = await browser.pages();
            for (const p of pages) {
              if (p !== page) {
                this.log(`[SearchWorker] 🔒 Fechando aba extra residual: ${p.url().slice(0, 50)}...`);
                await p.close().catch(() => {});
              }
            }
          } catch (closeErr) {
            this.log(`[SearchWorker] ⚠️ Erro ao fechar abas residuais: ${closeErr.message}`);
          }
        }
      }
    } catch (err) {
      result.status = 'error';
      result.errorMessage = err.message;
      this.log(`[SearchWorker] ❌ Erro na pesquisa "${keyword}": ${err.message}`);
    }

    result.durationMs = Date.now() - startTime;
    return result;
  }

  /**
   * Clica em um anúncio físico na página usando Puppeteer e abre em nova aba.
   * Fecha a aba após a simulação de permanência (4-8 segundos).
   */
  async clickAdOnPage(page, ad) {
    try {
      const browser = page.browser();
      const containers = await page.$$('div[data-text-ad="1"]');
      for (const container of containers) {
        // Extrai dados do contêiner atual no DOM
        const adInfo = await container.evaluate(el => {
          const a = el.querySelector('a[data-pcu]') || el.querySelector('a[href]');
          if (!a) return null;
          const hrefRaw = a.getAttribute('href');
          const dataPcu = a.getAttribute('data-pcu');
          
          const cite = el.querySelector('cite');
          const displayUrl = cite ? cite.innerText : '';
          
          const h3 = el.querySelector('h3') || el.querySelector('[role="heading"]');
          const adTitle = h3 ? h3.innerText : '';
          
          return { hrefRaw, displayUrl, adTitle, dataPcu };
        });

        if (!adInfo) continue;

        // Compara de forma tolerante se este contêiner no DOM é o mesmo anúncio 'ad' alvo:
        // 1. Pelo hrefRaw original
        // 2. Ou pelo displayUrl (domínio de exibição) se ambos possuírem
        // 3. Ou pelo título do anúncio (ignorando caixa alta/baixa e espaços extras)
        // 4. Ou pelo data-pcu original
        const isMatch = adInfo.hrefRaw === ad.hrefRaw ||
          (adInfo.displayUrl && ad.displayUrl && adInfo.displayUrl.toLowerCase().includes(ad.displayUrl.toLowerCase())) ||
          (adInfo.adTitle && ad.adTitle && adInfo.adTitle.toLowerCase().trim() === ad.adTitle.toLowerCase().trim()) ||
          (adInfo.dataPcu && ad.dataPcu && adInfo.dataPcu === ad.dataPcu);

        if (isMatch) {
          const linkEl = await container.$('a[data-pcu]') || await container.$('a[href]');
          if (linkEl) {
            // Prepara a promessa para capturar a nova aba
            const newPagePromise = new Promise(resolve => {
              const listener = async (target) => {
                if (target.type() === 'page') {
                  const p = await target.page();
                  browser.off('targetcreated', listener);
                  resolve(p);
                }
              };
              browser.on('targetcreated', listener);
              setTimeout(() => {
                browser.off('targetcreated', listener);
                resolve(null);
              }, 12000);
            });

            // Força abrir em nova aba alterando o target
            await linkEl.evaluate(a => a.setAttribute('target', '_blank'));
            
            // Clica
            await linkEl.click();

            // Espera a aba abrir
            const newPage = await newPagePromise;
            if (newPage) {
              this.log(`[SearchWorker] 🖱️ Clique efetuado. Aba aberta: ${newPage.url().slice(0, 80)}...`);
              
              // Simula permanência (espera 4-8 segundos)
              await humanSleep(4, 8);
              
              // Fecha a aba
              await newPage.close();
              this.log(`[SearchWorker] 🔒 Aba do anúncio fechada.`);
              return true;
            } else {
              this.log(`[SearchWorker] ⚠️ Clique efetuado, mas a nova aba não foi detectada.`);
            }
          }
        }
      }
    } catch (err) {
      this.log(`[SearchWorker] ❌ Erro ao clicar no anúncio: ${err.message}`);
    }
    return false;
  }

  /**
   * Executa o worker: pesquisa todas as palavras do módulo.
   * @returns {Promise<object>} Resumo da execução
   */
  async run() {
    if (this._running) throw new Error('Worker já está em execução.');
    this._running = true;
    this._cancelled = false;

    const summary = {
      profileId: this.profileId,
      moduleId: this.moduleId,
      botId: this.botId,
      rounds: this.rounds,
      totalKeywords: 0,
      keywordsDone: 0,
      totalAdsFound: 0,
      errors: 0,
      results: [],
      status: 'running',
    };

    try {
      // 1. Busca as palavras do módulo
      const keywords = await this.fetchModuleWords();
      summary.totalKeywords = keywords.length;

      // 2. Busca regras de whitelist/blacklist
      const rules = await this.fetchRules();
      this.log(`[SearchWorker] 📋 Regras: ${rules.whitelist.length} whitelist, ${rules.blacklist.length} blacklist`);

      // 3. Verifica se o perfil está conectado
      const session = puppeteerBot.getProfileSession(this.profileId);
      if (!session) {
        throw new Error(`Perfil #${this.profileId} não está conectado. Abra-o primeiro.`);
      }
      const { page } = session;

      // 4. Busca configurações do perfil (click_enabled, click_count)
      let clickEnabled = 0;
      let clickCountMax = 3;
      try {
        const profRes = await this.http.get(`/api/profiles/${this.profileId}`);
        if (profRes.data?.ok && profRes.data.profile) {
          clickEnabled = profRes.data.profile.click_enabled || 0;
          clickCountMax = profRes.data.profile.click_count !== undefined ? profRes.data.profile.click_count : 3;
        }
      } catch (err) {
        this.log(`[SearchWorker] ⚠️ Não foi possível obter configurações de cliques do perfil: ${err.message}`);
      }
      this.log(`[SearchWorker] 🖱️ Cliques em Blacklist: ${clickEnabled === 1 ? 'ATIVADO' : 'DESATIVADO'} (máximo ${clickCountMax} por palavra)`);

      // 5. Exibe saldo do 2Captcha (se configurado)
      if (this.captchaSolver.enabled) {
        const balance = await this.captchaSolver.getBalance();
        if (balance !== null) {
          this.log(`[Captcha] 💰 2Captcha ativo (saldo: $${balance.toFixed(2)})`);
        } else {
          this.log('[Captcha] 🔑 2Captcha ativo (chave configurada)');
        }
      } else {
        this.log('[Captcha] ℹ️ 2Captcha não configurado — CAPTCHAs serão detectados mas não resolvidos');
      }

      // 6. Loop de rodadas × keywords
      for (let round = 1; round <= this.rounds; round++) {
        if (this._cancelled) break;

        this.log(`\n${'═'.repeat(20)} RODADA ${round}/${this.rounds} ${'═'.repeat(20)}`);

        for (let i = 0; i < keywords.length; i++) {
          if (this._cancelled) break;

          const keyword = keywords[i];
          this.log(`\n[R${round}/${this.rounds} · ${i + 1}/${keywords.length}] 🔎 "${keyword}"`);

          // Pesquisa a keyword
          const result = await this.searchKeyword(page, keyword, rules, clickEnabled, clickCountMax);
          summary.results.push(result);
          summary.keywordsDone++;
          summary.totalAdsFound += result.adsFound;
          if (result.status === 'error') summary.errors++;

          // Registra os anúncios via API
          for (const ad of result.ads) {
            try {
              await this.http.post('/api/ads/record-ad', {
                bot_id: this.botId,
                profile_id: this.profileId,
                module_id: this.moduleId,
                keyword: keyword,
                geo_country: this.geo?.country || null,
                geo_region: this.geo?.region || null,
                geo_city: this.geo?.city || null,
                ...ad,
              });
            } catch (_) {
              // Fire-and-forget — registra localmente se API falhar
            }
          }

          // Pausa entre keywords (simula humano)
          if (i < keywords.length - 1 && !this._cancelled) {
            await humanSleep(this.pauseBetweenKeywordsMin, this.pauseBetweenKeywordsMax);
          }
        }

        const roundOk = summary.results.filter((r) => r.status === 'completed').length;
        this.log(`\nRodada ${round}/${this.rounds}: ${roundOk} consultas processadas, ${summary.totalAdsFound} anúncios encontrados`);

        // Pausa entre rodadas
        if (round < this.rounds && !this._cancelled) {
          this.log(`[SearchWorker] ⏳ Pausa de ${this.pauseBetweenRounds}s antes da próxima rodada…`);
          await humanSleep(this.pauseBetweenRounds * 0.9, this.pauseBetweenRounds * 1.1);
        }
      }

      summary.status = this._cancelled ? 'cancelled' : 'completed';
    } catch (err) {
      summary.status = 'error';
      summary.errorMessage = err.message;
      this.log(`[SearchWorker] ❌ Erro fatal: ${err.message}`);
    } finally {
      this._running = false;
    }

    // Resumo final
    this.log(`\n${'═'.repeat(50)}`);
    this.log(`📊 RESUMO: ${summary.keywordsDone}/${summary.totalKeywords} palavras pesquisadas`);
    this.log(`📊 Total: ${summary.totalAdsFound} anúncios encontrados | ${summary.errors} erros`);
    this.log(`📊 Status: ${summary.status}`);
    this.log('═'.repeat(50));

    return summary;
  }
}

module.exports = { SearchWorker };
