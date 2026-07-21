/**
 * bot/src/bot/captcha-solver.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Detecção e resolução de reCAPTCHA v2 / Enterprise via:
 *   - Capsolver    (chave começa com 'CAP-')
 *   - CapMonster   (chave formato UUID: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx)
 *   - 2Captcha     (chave hex de 32 chars ou outra)
 *
 * Uso:
 *   const solver = new CaptchaSolver('SUA_API_KEY');
 *   const resolveu = await solver.trySolveIfPresent(page, log);
 * ─────────────────────────────────────────────────────────────────────────────
 */

const axios = require('axios');

// URLs da API 2Captcha
const TWOCAPTCHA_IN_URL  = 'https://2captcha.com/in.php';
const TWOCAPTCHA_RES_URL = 'https://2captcha.com/res.php';

// URLs da API CapMonster (formato idêntico ao Capsolver)
const CAPMONSTER_URL = 'https://api.capmonster.cloud';
const CAPSOLVER_URL  = 'https://api.capsolver.com';

// Erros fatais (não adianta tentar novamente)
const FATAL_ERRORS = new Set([
  'ERROR_WRONG_USER_KEY',
  'ERROR_KEY_DOES_NOT_EXIST',
  'ERROR_ZERO_BALANCE',
  'IP_BANNED',
  'ERROR_GOOGLEKEY',
  'ERROR_CAPTCHA_UNSOLVABLE',
  'ERROR_WRONG_GOOGLEKEY',
]);

/** Detecta se uma string é um UUID v4 (formato CapMonster) */
function isUUID(str) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);
}

class CaptchaSolver {
  /**
   * @param {string} apiKey - Chave API (Capsolver, CapMonster ou 2Captcha)
   */
  constructor(apiKey) {
    this.apiKey = (apiKey || '').trim();
    this.enabled = this.apiKey.length > 0;

    // Detecção automática do provedor pela chave
    if (this.apiKey.startsWith('CAP-')) {
      this.provider = 'capsolver';
      this.providerName = 'Capsolver';
      this.taskApiUrl = CAPSOLVER_URL;
    } else if (isUUID(this.apiKey)) {
      this.provider = 'capmonster';
      this.providerName = 'CapMonster';
      this.taskApiUrl = CAPMONSTER_URL;
    } else {
      this.provider = '2captcha';
      this.providerName = '2Captcha';
      this.taskApiUrl = null; // usa endpoints próprios
    }

    // compat retrocompatibilidade
    this.isCapsolver = this.provider === 'capsolver' || this.provider === 'capmonster';
  }

  // ════════════════════════════════════════════════════════════════════════════
  // DETECÇÃO DE CAPTCHA
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * Verifica se a página tem reCAPTCHA visível.
   * @param {import('puppeteer-core').Page} page
   * @returns {Promise<boolean>}
   */
  async pageHasRecaptcha(page) {
    try {
      return await page.evaluate(() => {
        // Verifica URL do Google /sorry/
        if (window.location.href.includes('/sorry/')) return true;

        // Verifica data-sitekey
        const el = document.querySelector('[data-sitekey]');
        if (el && (el.getAttribute('data-sitekey') || '').trim().length >= 10) return true;

        // Verifica iframes de reCAPTCHA
        const iframes = document.querySelectorAll(
          "iframe[src*='recaptcha'], iframe[src*='gstatic.com/recaptcha'], iframe[title*='reCAPTCHA']"
        );
        return iframes.length > 0;
      });
    } catch (_) {
      return false;
    }
  }

  /**
   * Extrai sitekey, data-s e tipo (v2/Enterprise) da página.
   * PRIORIDADE: iframe k= (mais confiável) → data-sitekey → scripts inline
   *
   * @param {import('puppeteer-core').Page} page
   * @returns {Promise<{sitekey: string|null, dataS: string|null, enterprise: boolean}>}
   */
  async findSitekeyAndDataS(page) {
    try {
      const info = await page.evaluate(() => {
        let enterprise = false;
        const MIN_SITEKEY_LEN = 20;

        // ─── 1. Busca TODOS os iframes de reCAPTCHA ───────────────────────
        const iframes = Array.from(document.querySelectorAll(
          "iframe[src*='recaptcha'], iframe[src*='gstatic.com/recaptcha'], iframe[src*='google.com/recaptcha']"
        ));

        // Detecta modo enterprise pelos iframes
        for (const f of iframes) {
          if (/enterprise/i.test(f.getAttribute('src') || '')) enterprise = true;
        }

        // ─── 2. Tenta extrair k= do src do iframe (mais confiável para Google Search) ───
        for (const f of iframes) {
          const src = f.getAttribute('src') || '';
          try {
            const u = new URL(src, location.href);
            const k = (u.searchParams.get('k') || '').trim();
            if (k.length >= MIN_SITEKEY_LEN) {
              const s = u.searchParams.get('s') || '';
              return { sitekey: k, dataS: s || null, enterprise };
            }
          } catch (_) {}
        }

        // ─── 3. Busca data-sitekey em elementos do DOM ────────────────────
        for (const el of document.querySelectorAll('[data-sitekey]')) {
          const k = (el.getAttribute('data-sitekey') || '').trim();
          if (k.length >= MIN_SITEKEY_LEN) {
            const ds = (el.getAttribute('data-s') || '').trim();
            return { sitekey: k, dataS: ds || null, enterprise };
          }
        }

        // ─── 4. Varre scripts inline (página /sorry/ do Google) ───────────
        const scripts = Array.from(document.querySelectorAll('script'));
        for (const s of scripts) {
          const text = s.textContent || '';
          // Padrão: "sitekey":"6LxxxX..."
          const m1 = text.match(/["']sitekey["']\s*:\s*["']([A-Za-z0-9_-]{20,}?)["']/i);
          if (m1 && m1[1].length >= MIN_SITEKEY_LEN) {
            return { sitekey: m1[1], dataS: null, enterprise };
          }
          // Padrão: k=6LxxxX... em strings de URL dentro de scripts
          const m2 = text.match(/[?&]k=([6L][A-Za-z0-9_-]{20,}?)["'&\s]/);
          if (m2 && m2[1].length >= MIN_SITEKEY_LEN) {
            return { sitekey: m2[1], dataS: null, enterprise };
          }
        }

        // ─── 5. Tenta extrair da URL direta da página (/sorry/?g=xxx&k=xxx) ──
        try {
          const u = new URL(location.href);
          const k = (u.searchParams.get('k') || '').trim();
          if (k.length >= MIN_SITEKEY_LEN) {
            return { sitekey: k, dataS: null, enterprise };
          }
        } catch (_) {}

        return { sitekey: null, dataS: null, enterprise: false };
      });

      return info;
    } catch (_) {
      return { sitekey: null, dataS: null, enterprise: false };
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  // RESOLUÇÃO DE CAPTCHA
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * Envia o CAPTCHA para o serviço configurado e aguarda resolução.
   * @param {string} sitekey
   * @param {string} pageUrl
   * @param {object} opts
   * @returns {Promise<string|null>} Token ou null
   */
  async solveRecaptcha(sitekey, pageUrl, opts = {}) {
    const { dataS, cookies, enterprise = false } = opts;
    const log = opts.log || console.log;

    if (!this.enabled) return null;

    if (this.isCapsolver) {
      return await this._solveCapsolver(sitekey, pageUrl, { dataS, enterprise, log });
    }

    // Submete ao 2Captcha
    const params = {
      key: this.apiKey,
      method: 'userrecaptcha',
      googlekey: sitekey,
      pageurl: pageUrl,
      json: '1',
    };
    if (enterprise) params.enterprise = '1';
    if (dataS) params['data-s'] = dataS;
    if (cookies) params.cookies = cookies;

    const reqId = await this._submit(params);
    if (!reqId) return null;

    const mode = enterprise ? 'Enterprise' : 'v2';
    log(`[2captcha] Enviado (${mode}, ID: ${reqId}). Aguardando resolução…`);

    // Aguarda 12 segundos antes de iniciar polling
    await new Promise((r) => setTimeout(r, 12_000));

    return await this._poll(reqId, log);
  }

  /**
   * Resolve via Capsolver ou CapMonster (ambos usam a mesma API REST).
   * ProxyLess: usa a internet da máquina local diretamente.
   * @private
   */
  async _solveCapsolver(sitekey, pageUrl, opts = {}) {
    const { dataS, enterprise = false, log = console.log } = opts;
    const apiBase = this.taskApiUrl;
    const providerName = this.providerName;

    // Sitekey oficial do Google Search /sorry/ — testada e confirmada como aceita
    const GOOGLE_SORRY_SITEKEY = '6Le-wvkSAAAAAPBMRTvw0Q4Muexq9bi0DJwx_mJ-';

    // CapMonster usa nomes ligeiramente diferentes dos tipos de task
    const getTaskType = (isEnterprise) => {
      if (this.provider === 'capmonster') {
        return isEnterprise
          ? 'RecaptchaV2EnterpriseTaskProxyless'  // CapMonster: ProxyLess com "less" minúsculo
          : 'NoCaptchaTaskProxyless';
      }
      // Capsolver
      return isEnterprise
        ? 'ReCaptchaV2EnterpriseTaskProxyLess'
        : 'ReCaptchaV2TaskProxyLess';
    };

    const runTask = async (currentSitekey, isEnterprise) => {
      try {
        const taskType = getTaskType(isEnterprise);
        const taskPayload = {
          type: taskType,
          websiteURL: pageUrl,
          websiteKey: currentSitekey,
        };

        if (dataS) taskPayload.enterprisePayload = { s: dataS };

        log(`🔄 [CAPTCHA] [${providerName}] Enviando tarefa (tipo: ${taskType})...`);
        log(`🔄 [CAPTCHA] Sitekey: ${currentSitekey}`);

        const res = await axios.post(`${apiBase}/createTask`, {
          clientKey: this.apiKey,
          task: taskPayload
        }, { timeout: 30000 });

        return { res, taskType };
      } catch (err) {
        return { error: err };
      }
    };

    let result = await runTask(sitekey, enterprise);

    // Se falhar por 'Unsupported siteKey', tenta com a sitekey oficial do Google /sorry/
    const errDesc = result.res?.data?.errorDescription || '';
    const errCode = result.res?.data?.errorCode || '';
    if (
      errCode === 'ERROR_INVALID_SITEKEY' ||
      errDesc.includes('Unsupported siteKey') ||
      errDesc.includes('unsupported') ||
      result.res?.data?.errorId !== 0
    ) {
      if (sitekey !== GOOGLE_SORRY_SITEKEY) {
        log(`⚠️ [CAPTCHA] Sitekey original recusada (${errDesc || errCode}). Tentando com sitekey oficial do Google...`);
        result = await runTask(GOOGLE_SORRY_SITEKEY, false);
        // Tenta também Enterprise se v2 falhar
        if (result.res?.data?.errorId !== 0) {
          result = await runTask(GOOGLE_SORRY_SITEKEY, true);
        }
      }
    }

    if (result.error || result.res?.data?.errorId !== 0) {
      log(`❌ [CAPTCHA] [${providerName}] Tarefa recusada: ${result.res?.data?.errorDescription || result.error?.message}`);
      return null;
    }

    const taskId = result.res.data.taskId;
    log(`🚨 [CAPTCHA] ⏳ reCAPTCHA enviado ao ${providerName}! Task ID: ${taskId}`);

    // Polling a cada 3s — máx 120s (40 iterações)
    for (let i = 1; i <= 40; i++) {
      await new Promise((r) => setTimeout(r, 3000));
      const statusRes = await axios.post(`${apiBase}/getTaskResult`, {
        clientKey: this.apiKey,
        taskId: taskId
      }, { timeout: 15000 });

      const status = statusRes.data?.status || 'desconhecido';
      if (status === 'ready') {
        log(`✅ [CAPTCHA] 🎉 Resolvido pelo ${providerName} em ${i * 3}s!`);
        return statusRes.data.solution?.gRecaptchaResponse || null;
      }
      if (status === 'failed') {
        log(`❌ [CAPTCHA] ${providerName} falhou ao resolver.`);
        return null;
      }
      log(`⏳ [CAPTCHA] Resolvendo... ${i * 3}s (status: ${status})`);
    }
    log(`❌ [CAPTCHA] Timeout: 120s sem resolução pelo ${providerName}.`);
    return null;
  }

  /**
   * Consulta saldo da conta (Capsolver, CapMonster ou 2Captcha).
   * @returns {Promise<number|null>}
   */
  async getBalance() {
    if (!this.enabled) return null;

    if (this.provider === 'capsolver' || this.provider === 'capmonster') {
      try {
        const res = await axios.post(`${this.taskApiUrl}/getBalance`, {
          clientKey: this.apiKey
        }, { timeout: 10_000 });
        if (res.data?.errorId === 0) {
          return parseFloat(res.data.balance);
        }
      } catch (_) {}
      return null;
    }

    // 2Captcha
    try {
      const res = await axios.get(TWOCAPTCHA_RES_URL, {
        params: { key: this.apiKey, action: 'getbalance', json: 1 },
        timeout: 10_000,
      });
      if (res.data?.status === 1) return parseFloat(res.data.request);
    } catch (_) {}
    return null;
  }

  /**
   * Submete o CAPTCHA ao 2Captcha.
   * @private
   */
  async _submit(params) {
    for (let attempt = 0; attempt < 12; attempt++) {
      try {
        const res = await axios.post(TWOCAPTCHA_IN_URL, new URLSearchParams(params).toString(), {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          timeout: 45_000,
        });

        const data = res.data;
        if (typeof data === 'object' && 'status' in data) {
          if (Number(data.status) === 1) {
            const rid = String(data.request || '').trim();
            if (rid) return rid;
          }
          const msg = String(data.request || data).trim();
          console.log(`[2captcha] Envio recusado: ${msg}`);
          if ([...FATAL_ERRORS].some((e) => msg.includes(e))) return null;
          if (msg.toUpperCase().includes('NO_SLOT')) {
            await new Promise((r) => setTimeout(r, 6_000));
            continue;
          }
          return null;
        }

        const text = typeof data === 'string' ? data.trim() : '';
        if ([...FATAL_ERRORS].some((e) => text.includes(e))) return null;
        if (text.startsWith('OK|')) return text.split('|')[1];
      } catch (err) {
        console.log(`[2captcha] Falha no envio (tentativa ${attempt + 1}): ${err.message}`);
        await new Promise((r) => setTimeout(r, 4_000));
      }
    }
    return null;
  }

  /**
   * Polling do resultado no 2Captcha.
   * @private
   */
  async _poll(reqId, log = console.log) {
    for (let i = 0; i < 55; i++) {
      try {
        const res = await axios.get(TWOCAPTCHA_RES_URL, {
          params: { key: this.apiKey, action: 'get', id: reqId, json: '1' },
          timeout: 45_000,
        });

        const data = res.data;
        if (typeof data === 'object' && Number(data.status) === 1) {
          const token = String(data.request || '').trim();
          if (token && token.length > 20) {
            log('[2captcha] ✅ Resolvido!');
            return token;
          }
        }

        if (typeof data === 'object') {
          const msg = String(data.request || '').trim().toUpperCase();
          if (msg.includes('NOT_READY') || msg.includes('CAPCHA_NOT_READY')) {
            await new Promise((r) => setTimeout(r, i < 8 ? 5_000 : 6_000));
            continue;
          }
          if ([...FATAL_ERRORS].some((e) => msg.includes(e))) return null;
          if (msg.startsWith('ERROR_')) return null;
        }

        const text = typeof data === 'string' ? data.trim() : '';
        if (text.includes('CAPCHA_NOT_READY') || text.includes('NOT_READY')) {
          await new Promise((r) => setTimeout(r, i < 8 ? 5_000 : 6_000));
          continue;
        }
        if (text.startsWith('OK|')) {
          log('[2captcha] ✅ Resolvido!');
          return text.split('|')[1];
        }
      } catch (err) {
        log(`[2captcha] Falha no poll: ${err.message}`);
        await new Promise((r) => setTimeout(r, 4_000));
      }
    }

    log('[2captcha] ⏳ Timeout: demasiadas tentativas sem token.');
    return null;
  }

  /**
   * Tenta extrair o profile_id do ixBrowser a partir das abas abertas no Puppeteer.
   * @private
   */
  async _getProfileIdFromBrowser(page) {
    try {
      const browser = page.browser();
      const pages = await browser.pages();
      for (const p of pages) {
        try {
          const u = new URL(p.url());
          const id = u.searchParams.get('id');
          if (id && !isNaN(id)) return Number(id);
        } catch (_) {}
      }
    } catch (_) {}
    return null;
  }

  // ════════════════════════════════════════════════════════════════════════════
  // INTEGRAÇÃO COMPLETA (detecta + resolve + aplica)
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * Se a página tiver reCAPTCHA, tenta resolver e aplicar o token.
   * Retorna true se não há CAPTCHA ou se foi resolvido com sucesso.
   *
   * @param {import('puppeteer-core').Page} page
   * @param {function} log
   * @param {number|null} profileId
   * @returns {Promise<boolean>}
   */
  async trySolveIfPresent(page, log = console.log, profileId = null) {
    // Detecção rápida — sem espera bloqueante
    const hasRecaptcha = await this.pageHasRecaptcha(page);
    if (!hasRecaptcha) return true; // ✅ Sem CAPTCHA

    log('[CAPTCHA] ⚠️ reCAPTCHA detectado na página!');
    log(`[CAPTCHA] URL atual: ${page.url()}`);

    if (!this.enabled) {
      log(`[CAPTCHA] ❌ Sem chave API configurada. Configure TWOCAPTCHA_API_KEY no config.js.`);
      return false;
    }

    // Aguarda o iframe do reCAPTCHA carregar completamente
    log('[CAPTCHA] Aguardando carregamento do iframe do reCAPTCHA...');
    try {
      await page.waitForSelector(
        "iframe[src*='recaptcha'], [data-sitekey]",
        { timeout: 8000 }
      );
    } catch (_) {
      log('[CAPTCHA] ⚠️ Iframe do reCAPTCHA não encontrado no DOM, tentando extrair mesmo assim...');
    }

    const { sitekey, dataS, enterprise } = await this.findSitekeyAndDataS(page);

    if (!sitekey) {
      log('[CAPTCHA] ❌ Sitekey não encontrada no DOM. Dump da URL e iframes:');
      // Debug: loga o que está disponível na página
      try {
        const debugInfo = await page.evaluate(() => {
          const iframes = Array.from(document.querySelectorAll('iframe')).map(f => f.getAttribute('src') || '').filter(s => s.includes('recaptcha'));
          const sitekeys = Array.from(document.querySelectorAll('[data-sitekey]')).map(el => el.getAttribute('data-sitekey'));
          return { iframes, sitekeys, url: location.href };
        });
        log(`[CAPTCHA] Debug: URL=${debugInfo.url}`);
        log(`[CAPTCHA] Debug: iframes=${JSON.stringify(debugInfo.iframes)}`);
        log(`[CAPTCHA] Debug: data-sitekeys=${JSON.stringify(debugInfo.sitekeys)}`);
      } catch (_) {}
      return false;
    }

    log(`[CAPTCHA] 🔑 Sitekey encontrada: ${sitekey} (${sitekey.length} chars, ${enterprise ? 'Enterprise' : 'v2'})`);

    // A websiteURL para o Capsolver DEVE ser a URL da página onde o CAPTCHA está exibido
    // (a /sorry/index), NÃO a URL de destino (continue=).
    // O Capsolver valida a sitekey contra essa URL.
    const captchaPageUrl = page.url();
    log(`[CAPTCHA] URL da página do CAPTCHA: ${captchaPageUrl}`);

    // Extrai a URL de destino (continue=) — usada apenas para navegar após resolver
    let continueUrl = captchaPageUrl;
    try {
      const u = new URL(captchaPageUrl);
      const raw = u.searchParams.get('continue');
      if (raw) continueUrl = decodeURIComponent(raw);
    } catch (_) {}

    // Extrai cookies para Capsolver
    let cookiesHeader = null;
    try {
      const cookies = await page.cookies();
      cookiesHeader = cookies.map((c) => `${c.name}=${c.value}`).join('; ');
    } catch (_) {}

    // ─── Tentativa 1: tipo detectado (enterprise ou v2) ─────────────────────
    log(`[CAPTCHA] 🔄 Tentativa 1: enviando como ${enterprise ? 'Enterprise' : 'v2'} ProxyLess...`);
    let token = await this.solveRecaptcha(sitekey, captchaPageUrl, {
      dataS, cookies: cookiesHeader, enterprise, log
    });

    // ─── Tentativa 2: tipo oposto ────────────────────────────────────────────
    if (!token) {
      log(`[CAPTCHA] 🔄 Tentativa 2: retentando como ${enterprise ? 'v2 clássico' : 'Enterprise'}...`);
      token = await this.solveRecaptcha(sitekey, captchaPageUrl, {
        dataS, cookies: cookiesHeader, enterprise: !enterprise, log
      });
    }

    // ─── Tentativa 3: sitekey oficial conhecida do Google Search /sorry/ ─────
    // O Google pode exibir sitekeys variantes dependendo do IP/browser,
    // mas o Capsolver só suporta a sitekey oficial registrada.
    const GOOGLE_SORRY_SITEKEY = '6Le-wvkSAAAAAPBMRTvw0Q4Muexq9bi0DJwx_mJ-';
    if (!token && sitekey !== GOOGLE_SORRY_SITEKEY) {
      log(`[CAPTCHA] 🔄 Tentativa 3: sitekey extraída (${sitekey}) não suportada pelo Capsolver.`);
      log(`[CAPTCHA] 🔄 Usando sitekey oficial do Google Search: ${GOOGLE_SORRY_SITEKEY}`);
      token = await this.solveRecaptcha(GOOGLE_SORRY_SITEKEY, captchaPageUrl, {
        dataS, cookies: cookiesHeader, enterprise: false, log
      });
      if (!token) {
        // Tenta também como Enterprise com a sitekey oficial
        token = await this.solveRecaptcha(GOOGLE_SORRY_SITEKEY, captchaPageUrl, {
          dataS, cookies: cookiesHeader, enterprise: true, log
        });
      }
    }

    if (!token) {
      log(`[CAPTCHA] ❌ Não foi possível resolver o CAPTCHA. Verifique saldo e chave do ${this.providerName}.`);
      return false;
    }

    // ─── Aplica o token na página ─────────────────────────────────────────
    try {
      log('[CAPTCHA] Aplicando token de resposta na página...');

      const submitted = await page.evaluate((t) => {
        // 1. Preenche o textarea oculto do Google
        const textarea = document.getElementById('g-recaptcha-response')
          || document.querySelector('[name="g-recaptcha-response"]');
        if (textarea) {
          textarea.value = t;
          textarea.innerHTML = t;
        }

        // 2. Tenta rodar o callback do reCAPTCHA se o site configurou
        if (typeof submitCallback === 'function') {
          submitCallback(t);
          return 'callback';
        }

        // 3. Fallback: envia o formulário diretamente
        const form = document.getElementById('captcha-form') || document.querySelector('form');
        if (form) {
          form.submit();
          return 'form_submit';
        }

        return false;
      }, token);

      if (submitted) {
        log(`[CAPTCHA] Formulário/callback enviado (${submitted}). Aguardando navegação...`);
        await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {
          log('[CAPTCHA] Sem navegação automática detectada, prosseguindo...');
        });
      } else {
        // Fallback: navegar direto para a URL de destino (continue=)
        log(`[CAPTCHA] Nenhum formulário localizado. Navegando para URL de destino: ${continueUrl}`);
        const { pageGotoRobust } = require('./google-search');
        await pageGotoRobust(page, continueUrl, { log });
      }

      // ── VERIFICAÇÃO CRÍTICA: o token foi aceito pelo Google? ─────────────
      // Se ainda estiver na /sorry/, o token foi rejeitado (sitekey errada).
      // Nesse caso, tentamos navegar direto para a URL de destino.
      const urlAfter = page.url();
      if (urlAfter.includes('/sorry/')) {
        log(`[CAPTCHA] ⚠️ Token rejeitado pelo Google (ainda na /sorry/). Tentando navegar manualmente para: ${continueUrl}`);
        const { pageGotoRobust, waitSerpUrlOrMarkers } = require('./google-search');
        try {
          await pageGotoRobust(page, continueUrl, { log });
          await new Promise(r => setTimeout(r, 2000));

          const urlAfter2 = page.url();
          if (urlAfter2.includes('/sorry/')) {
            log('[CAPTCHA] ❌ Google continua bloqueando o acesso. IP possivelmente banido temporariamente.');
            return false;
          }
          log('[CAPTCHA] ✅ Navegação manual bem-sucedida após rejeição do token!');
        } catch (navErr) {
          log(`[CAPTCHA] ❌ Erro na navegação manual: ${navErr.message}`);
          return false;
        }
      }

      log(`[CAPTCHA] ✅ CAPTCHA resolvido e página de destino carregada: ${page.url().substring(0, 80)}`);
      return true;
    } catch (err) {
      log(`[CAPTCHA] ❌ Erro ao aplicar token: ${err.message}`);
      return false;
    }
  }
}

module.exports = { CaptchaSolver };
