/**
 * bot/src/bot/captcha-solver.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Detecção e resolução de reCAPTCHA v2 / Enterprise via 2Captcha API.
 * Adaptado do CaptchaSolver do adspower.py → Node.js.
 *
 * Uso:
 *   const solver = new CaptchaSolver('SUA_API_KEY_2CAPTCHA');
 *   const resolveu = await solver.trySolveIfPresent(page, log);
 *
 * Se não tiver chave API, a classe apenas detecta CAPTCHA sem resolver.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const axios = require('axios');

// URLs da API 2Captcha
const TWOCAPTCHA_IN_URL  = 'https://2captcha.com/in.php';
const TWOCAPTCHA_RES_URL = 'https://2captcha.com/res.php';

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

class CaptchaSolver {
  /**
   * @param {string} apiKey - Chave API do 2Captcha ou Capsolver (opcional — se vazia, só detecta)
   */
  constructor(apiKey) {
    this.apiKey = (apiKey || '').trim();
    this.enabled = this.apiKey.length > 0;
    this.isCapsolver = this.apiKey.startsWith('CAP-');
    this.providerName = this.isCapsolver ? 'Capsolver' : '2Captcha';
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
      // Verifica data-sitekey
      const hasSitekey = await page.evaluate(() => {
        const el = document.querySelector('[data-sitekey]');
        if (el) {
          const sk = (el.getAttribute('data-sitekey') || '').trim();
          if (sk) return true;
        }
        return false;
      });
      if (hasSitekey) return true;

      // Verifica iframes de reCAPTCHA
      const hasIframe = await page.evaluate(() => {
        const iframes = document.querySelectorAll(
          "iframe[src*='recaptcha'], iframe[src*='gstatic.com/recaptcha'], iframe[title*='reCAPTCHA']"
        );
        return iframes.length > 0;
      });
      return hasIframe;
    } catch (_) {
      return false;
    }
  }

  /**
   * Extrai sitekey, data-s e tipo (v2/Enterprise) da página.
   * @param {import('puppeteer-core').Page} page
   * @returns {Promise<{sitekey: string|null, dataS: string|null, enterprise: boolean}>}
   */
  async findSitekeyAndDataS(page) {
    try {
      const info = await page.evaluate(() => {
        let enterprise = false;

        // Verifica iframes enterprise
        const iframes = document.querySelectorAll(
          "iframe[src*='recaptcha'], iframe[src*='gstatic.com/recaptcha'], iframe[src*='google.com/recaptcha']"
        );
        for (const f of iframes) {
          const src = f.getAttribute('src') || '';
          if (/enterprise/i.test(src)) enterprise = true;
        }

        // Verifica data-sitekey em elementos
        for (const el of document.querySelectorAll('[data-sitekey]')) {
          const k = (el.getAttribute('data-sitekey') || '').trim();
          if (k) {
            const ds = (el.getAttribute('data-s') || '').trim();
            return { sitekey: k, dataS: ds || null, enterprise };
          }
        }

        // Extrai sitekey do src do iframe (parâmetro k=)
        for (const f of iframes) {
          const src = f.getAttribute('src') || '';
          if (/enterprise/i.test(src)) enterprise = true;
          try {
            const u = new URL(src, location.href);
            const k = u.searchParams.get('k');
            if (k) {
              const s = u.searchParams.get('s');
              return { sitekey: k.trim(), dataS: s ? s.trim() : null, enterprise };
            }
          } catch (_) {}
        }

        return { sitekey: null, dataS: null, enterprise: false };
      });

      return info;
    } catch (_) {
      return { sitekey: null, dataS: null, enterprise: false };
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  // RESOLUÇÃO DE CAPTCHA (2Captcha API)
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * Envia o CAPTCHA para o 2Captcha e aguarda resolução.
   * @param {string} sitekey
   * @param {string} pageUrl
   * @param {object} opts
   * @returns {Promise<string|null>} Token ou null
   */
  async solveRecaptcha(sitekey, pageUrl, opts = {}) {
    const { dataS, cookies, enterprise = false, proxy = null } = opts;

    if (!this.enabled) return null;

    if (this.isCapsolver) {
      return await this._solveCapsolver(sitekey, pageUrl, { dataS, enterprise, proxy });
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
    console.log(`[2captcha] Enviado (${mode}, ID: ${reqId}). Aguardando resolução…`);

    // Aguarda 12 segundos antes de iniciar polling
    await new Promise((r) => setTimeout(r, 12_000));

    return await this._poll(reqId);
  }

  /**
   * Resolve o CAPTCHA usando a API do Capsolver (createTask + getTaskResult).
   * @private
   */
  async _solveCapsolver(sitekey, pageUrl, opts = {}) {
    const { dataS, enterprise = false, proxy = null } = opts;
    try {
      let taskType;
      const taskPayload = {
        websiteURL: pageUrl,
        websiteKey: sitekey,
      };

      // Se houver proxy configurado no perfil, usamos as tarefas com proxy próprio para evitar Unsupported siteKey no Google Search
      if (proxy && proxy.proxyAddress && proxy.proxyPort) {
        taskType = enterprise ? 'ReCaptchaV2EnterpriseTask' : 'ReCaptchaV2Task';
        taskPayload.type = taskType;
        taskPayload.proxyType = proxy.proxyType || 'socks5';
        taskPayload.proxyAddress = proxy.proxyAddress;
        taskPayload.proxyPort = Number(proxy.proxyPort);
        if (proxy.proxyUser) taskPayload.proxyLogin = proxy.proxyUser;
        if (proxy.proxyPassword) taskPayload.proxyPassword = proxy.proxyPassword;
      } else {
        taskType = enterprise ? 'ReCaptchaV2EnterpriseTaskProxyLess' : 'ReCaptchaV2TaskProxyLess';
        taskPayload.type = taskType;
      }

      if (dataS) {
        taskPayload.enterprisePayload = { s: dataS };
      }

      const res = await axios.post('https://api.capsolver.com/createTask', {
        clientKey: this.apiKey,
        task: taskPayload
      }, { timeout: 30000 });

      if (res.data?.errorId !== 0) {
        console.log(`[Capsolver] Erro ao criar task (${taskType}): ${res.data?.errorDescription || 'Erro desconhecido'}`);
        return null;
      }

      const taskId = res.data.taskId;
      const mode = (enterprise ? 'Enterprise' : 'v2') + (proxy ? ' (Proxy)' : ' (ProxyLess)');
      console.log(`[Capsolver] Enviado (${mode}, ID: ${taskId}). Aguardando resolução…`);

      // Polling a cada 3 segundos, até 40 vezes (120s max)
      for (let i = 0; i < 40; i++) {
        await new Promise((r) => setTimeout(r, 3000));
        const statusRes = await axios.post('https://api.capsolver.com/getTaskResult', {
          clientKey: this.apiKey,
          taskId: taskId
        }, { timeout: 15000 });

        if (statusRes.data?.errorId !== 0) {
          console.log(`[Capsolver] Erro no polling: ${statusRes.data?.errorDescription}`);
          return null;
        }

        if (statusRes.data?.status === 'ready') {
          console.log('[Capsolver] ✅ Resolvido!');
          return statusRes.data.solution?.gRecaptchaResponse || null;
        }

        if (statusRes.data?.status === 'failed') {
          console.log('[Capsolver] ❌ Resolução falhou no Capsolver.');
          return null;
        }
      }
      console.log('[Capsolver] ⏳ Timeout na resolução.');
      return null;
    } catch (err) {
      if (err.response?.data) {
        console.log(`[Capsolver] Erro de API (${err.response.status}):`, JSON.stringify(err.response.data));
      } else {
        console.log(`[Capsolver] Erro de rede/API: ${err.message}`);
      }
      return null;
    }
  }

  /**
   * Consulta saldo da conta (2Captcha ou Capsolver).
   * @returns {Promise<number|null>}
   */
  async getBalance() {
    if (!this.enabled) return null;
    if (this.isCapsolver) {
      try {
        const res = await axios.post('https://api.capsolver.com/getBalance', {
          clientKey: this.apiKey
        }, { timeout: 10_000 });
        if (res.data?.errorId === 0) {
          return parseFloat(res.data.balance);
        }
      } catch (_) {}
      return null;
    }

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
  async _poll(reqId) {
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
            console.log('[2captcha] ✅ Resolvido!');
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
          console.log('[2captcha] ✅ Resolvido!');
          return text.split('|')[1];
        }
      } catch (err) {
        console.log(`[2captcha] Falha no poll: ${err.message}`);
        await new Promise((r) => setTimeout(r, 4_000));
      }
    }

    console.log('[2captcha] ⏳ Timeout: demasiadas tentativas sem token.');
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

  /**
   * Consulta os dados de proxy do perfil no ixBrowser local.
   * @private
   */
  async _getProfileProxy(profileId) {
    try {
      const config = require('../../config');
      const res = await axios.post(`${config.IX_API_BASE}/api/v2/profile-list`, {
        profile_id: Number(profileId)
      }, { timeout: 5000 });

      const profiles = res.data?.data?.data || [];
      const profile = profiles.find(p => Number(p.profile_id) === Number(profileId));
      if (profile && profile.proxy_ip && profile.proxy_port && profile.proxy_type !== 'direct') {
        return {
          proxyType: profile.proxy_type,
          proxyAddress: profile.proxy_ip,
          proxyPort: Number(profile.proxy_port),
          proxyUser: profile.proxy_user || config.PROXY_USER || '',
          proxyPassword: profile.proxy_password || config.PROXY_PASSWORD || ''
        };
      }
    } catch (err) {
      console.log(`[CaptchaSolver] Erro ao obter proxy para o perfil #${profileId}:`, err.message);
    }
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
   * @returns {Promise<boolean>}
   */
  async trySolveIfPresent(page, log = console.log, profileId = null) {
    // Detecção rápida — sem espera bloqueante
    const hasRecaptcha = await this.pageHasRecaptcha(page);
    if (!hasRecaptcha) return true; // ✅ Sem CAPTCHA

    log('[Captcha] ⚠️ reCAPTCHA detectado na página!');

    if (!this.enabled) {
      log(`[Captcha] ❌ Sem chave API do ${this.providerName}. Configure TWOCAPTCHA_API_KEY no config.js.`);
      return false;
    }

    const { sitekey, dataS, enterprise } = await this.findSitekeyAndDataS(page);
    if (!sitekey) {
      log('[Captcha] ❌ reCAPTCHA visível mas sitekey não encontrado no DOM.');
      return false;
    }

    log(`[Captcha] 🔑 Resolvendo (sitekey: …${sitekey.slice(-8)}, ${enterprise ? 'Enterprise' : 'v2'})…`);

    // Busca o proxy do perfil se for Capsolver para evitar erro Unsupported siteKey no Google Search
    let proxy = null;
    if (this.isCapsolver) {
      const resolvedId = profileId || await this._getProfileIdFromBrowser(page);
      if (resolvedId) {
        log(`[Captcha] Detectado perfil #${resolvedId} do ixBrowser. Buscando informações de proxy...`);
        proxy = await this._getProfileProxy(resolvedId);
        if (proxy) {
          log(`[Captcha] Proxy do perfil obtido com sucesso: ${proxy.proxyType}://${proxy.proxyAddress}:${proxy.proxyPort}`);
        } else {
          log('[Captcha] Perfil configurado em modo Direto (sem proxy) ou erro ao obter. Usando modo ProxyLess.');
        }
      }
    }

    // Extrai cookies para 2Captcha / Capsolver
    let cookiesHeader = null;
    try {
      const cookies = await page.cookies();
      cookiesHeader = cookies.map((c) => `${c.name}=${c.value}`).join('; ');
    } catch (_) {}

    // Tenta resolver
    let token = await this.solveRecaptcha(sitekey, page.url(), {
      dataS,
      cookies: cookiesHeader,
      enterprise,
      proxy
    });

    // Se falhou, tenta com o tipo oposto (v2 ↔ Enterprise)
    if (!token) {
      log(`[Captcha] Retentativa como ${enterprise ? 'v2 clássico' : 'Enterprise'}…`);
      token = await this.solveRecaptcha(sitekey, page.url(), {
        dataS,
        cookies: cookiesHeader,
        enterprise: !enterprise,
        proxy
      });
    }

    if (!token) {
      log(`[Captcha] ❌ Não foi possível obter token. Verifique saldo e chave do ${this.providerName}.`);
      return false;
    }

    // Aplica o token via formulário POST e callbacks do Google Search
    try {
      log('[Captcha] Aplicando token de resposta na página...');

      const submitted = await page.evaluate((t) => {
        // 1. Preenche o textarea oculto do Google
        const textarea = document.getElementById('g-recaptcha-response') || document.querySelector('[name="g-recaptcha-response"]');
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
        log(`[Captcha] Formulário/callback do Captcha enviado (${submitted}). Aguardando navegação de resposta...`);
        // Espera navegar após o post do form
        await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {
          log('[Captcha] Sem evento de navegação detectado após o envio, prosseguindo...');
        });
      } else {
        // Fallback histórico: aplicar na URL e navegar via GET
        log('[Captcha] Nenhum formulário/callback localizado. Recarregando via GET com token na URL...');
        const url = new URL(page.url());
        url.searchParams.set('g-recaptcha-response', token);
        const { pageGotoRobust, waitSerpUrlOrMarkers } = require('./google-search');
        await pageGotoRobust(page, url.toString(), { log });
        await waitSerpUrlOrMarkers(page, 14_000);
      }

      log('[Captcha] ✅ Token aplicado e página atualizada com sucesso!');
      return true;
    } catch (err) {
      log(`[Captcha] ❌ Erro ao aplicar token: ${err.message}`);
      return false;
    }
  }
}

module.exports = { CaptchaSolver };
