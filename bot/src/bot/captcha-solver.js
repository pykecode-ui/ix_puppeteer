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
   * @param {string} apiKey - Chave API do 2Captcha (opcional — se vazia, só detecta)
   */
  constructor(apiKey) {
    this.apiKey = (apiKey || '').trim();
    this.enabled = this.apiKey.length > 0;
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
    const { dataS, cookies, enterprise = false } = opts;

    if (!this.enabled) return null;

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
   * Consulta saldo da conta 2Captcha.
   * @returns {Promise<number|null>}
   */
  async getBalance() {
    if (!this.enabled) return null;
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
  async trySolveIfPresent(page, log = console.log) {
    // Detecção rápida — sem espera bloqueante
    const hasRecaptcha = await this.pageHasRecaptcha(page);
    if (!hasRecaptcha) return true; // ✅ Sem CAPTCHA

    log('[Captcha] ⚠️ reCAPTCHA detectado na página!');

    if (!this.enabled) {
      log('[Captcha] ❌ Sem chave API do 2Captcha. Configure TWOCAPTCHA_API_KEY no config.js.');
      return false;
    }


    const { sitekey, dataS, enterprise } = await this.findSitekeyAndDataS(page);
    if (!sitekey) {
      log('[Captcha] ❌ reCAPTCHA visível mas sitekey não encontrado no DOM.');
      return false;
    }

    log(`[Captcha] 🔑 Resolvendo (sitekey: …${sitekey.slice(-8)}, ${enterprise ? 'Enterprise' : 'v2'})…`);

    // Extrai cookies para 2Captcha
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
    });

    // Se falhou, tenta com o tipo oposto (v2 ↔ Enterprise)
    if (!token) {
      log(`[Captcha] Retentativa como ${enterprise ? 'v2 clássico' : 'Enterprise'}…`);
      token = await this.solveRecaptcha(sitekey, page.url(), {
        dataS,
        cookies: cookiesHeader,
        enterprise: !enterprise,
      });
    }

    if (!token) {
      log('[Captcha] ❌ Não foi possível obter token. Verifique saldo e chave do 2Captcha.');
      return false;
    }

    // Aplica o token: navega com g-recaptcha-response na URL
    try {
      const url = new URL(page.url());
      url.searchParams.set('g-recaptcha-response', token);

      const { pageGotoRobust, waitSerpUrlOrMarkers } = require('./google-search');
      await pageGotoRobust(page, url.toString(), { log });
      await waitSerpUrlOrMarkers(page, 14_000);
      log('[Captcha] ✅ Token aplicado com sucesso!');
      return true;
    } catch (err) {
      log(`[Captcha] ❌ Erro ao aplicar token: ${err.message}`);
      return false;
    }
  }
}

module.exports = { CaptchaSolver };
