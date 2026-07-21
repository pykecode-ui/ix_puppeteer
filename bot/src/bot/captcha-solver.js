/**
 * bot/src/bot/captcha-solver.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Detecção e resolução de reCAPTCHA v2 / Enterprise via 2Captcha.
 *
 * Uso:
 *   const solver = new CaptchaSolver('SUA_API_KEY_2CAPTCHA');
 *   const resolveu = await solver.trySolveIfPresent(page, log);
 *
 * Se não tiver chave API, a classe apenas detecta CAPTCHA sem resolver.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const axios = require('axios');

const TWOCAPTCHA_IN_URL  = 'https://2captcha.com/in.php';
const TWOCAPTCHA_RES_URL = 'https://2captcha.com/res.php';

// Erros fatais — não adianta tentar de novo
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
   * @param {string} apiKey - Chave API do 2Captcha (32 chars hex)
   */
  constructor(apiKey) {
    this.apiKey      = (apiKey || '').trim();
    this.enabled     = this.apiKey.length > 0;
    this.providerName = '2Captcha';
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // DETECÇÃO DE CAPTCHA
  // ══════════════════════════════════════════════════════════════════════════════

  /**
   * Verifica se a página tem reCAPTCHA visível.
   */
  async pageHasRecaptcha(page) {
    try {
      return await page.evaluate(() => {
        if (window.location.href.includes('/sorry/')) return true;
        const el = document.querySelector('[data-sitekey]');
        if (el && (el.getAttribute('data-sitekey') || '').trim().length >= 10) return true;
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
   * Prioridade: iframe k= → data-sitekey → scripts inline → URL
   */
  async findSitekeyAndDataS(page) {
    try {
      return await page.evaluate(() => {
        let enterprise = false;
        const MIN = 20;

        const iframes = Array.from(document.querySelectorAll(
          "iframe[src*='recaptcha'], iframe[src*='gstatic.com/recaptcha'], iframe[src*='google.com/recaptcha']"
        ));

        for (const f of iframes) {
          if (/enterprise/i.test(f.getAttribute('src') || '')) enterprise = true;
        }

        // 1. k= do src do iframe (mais confiável)
        for (const f of iframes) {
          try {
            const u = new URL(f.getAttribute('src') || '', location.href);
            const k = (u.searchParams.get('k') || '').trim();
            if (k.length >= MIN) {
              return { sitekey: k, dataS: u.searchParams.get('s') || null, enterprise };
            }
          } catch (_) {}
        }

        // 2. data-sitekey no DOM
        for (const el of document.querySelectorAll('[data-sitekey]')) {
          const k = (el.getAttribute('data-sitekey') || '').trim();
          if (k.length >= MIN) {
            return { sitekey: k, dataS: el.getAttribute('data-s') || null, enterprise };
          }
        }

        // 3. Scripts inline
        for (const s of document.querySelectorAll('script')) {
          const text = s.textContent || '';
          const m1 = text.match(/["']sitekey["']\s*:\s*["']([A-Za-z0-9_-]{20,}?)["']/i);
          if (m1) return { sitekey: m1[1], dataS: null, enterprise };
          const m2 = text.match(/[?&]k=([6L][A-Za-z0-9_-]{20,}?)["'&\s]/);
          if (m2) return { sitekey: m2[1], dataS: null, enterprise };
        }

        // 4. Parâmetro k= na URL da página
        try {
          const u = new URL(location.href);
          const k = (u.searchParams.get('k') || '').trim();
          if (k.length >= MIN) return { sitekey: k, dataS: null, enterprise };
        } catch (_) {}

        return { sitekey: null, dataS: null, enterprise: false };
      });
    } catch (_) {
      return { sitekey: null, dataS: null, enterprise: false };
    }
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // RESOLUÇÃO VIA 2CAPTCHA
  // ══════════════════════════════════════════════════════════════════════════════

  /**
   * Submete o reCAPTCHA ao 2Captcha e aguarda o token.
   * @returns {Promise<string|null>}
   */
  async solveRecaptcha(sitekey, pageUrl, opts = {}) {
    const { dataS, enterprise = false, log = console.log } = opts;

    if (!this.enabled) return null;

    const params = {
      key:       this.apiKey,
      method:    'userrecaptcha',
      googlekey: sitekey,
      pageurl:   pageUrl,
      json:      '1',
    };
    if (enterprise) params.enterprise = '1';
    if (dataS)      params['data-s']  = dataS;

    const mode = enterprise ? 'Enterprise' : 'v2';
    log(`🔄 [CAPTCHA] Enviando ao 2Captcha (${mode}, sitekey: ${sitekey})...`);

    const reqId = await this._submit(params, log);
    if (!reqId) return null;

    log(`🚨 [CAPTCHA] Task ID: ${reqId}. Aguardando resolução...`);

    // Aguarda 12s antes de iniciar polling (2Captcha recomenda)
    await new Promise((r) => setTimeout(r, 12_000));

    return await this._poll(reqId, log);
  }

  /**
   * Consulta o saldo da conta 2Captcha.
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
   * Submete a task ao 2Captcha.
   * @private
   */
  async _submit(params, log = console.log) {
    for (let attempt = 0; attempt < 12; attempt++) {
      try {
        const res = await axios.post(
          TWOCAPTCHA_IN_URL,
          new URLSearchParams(params).toString(),
          { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 45_000 }
        );

        const data = res.data;
        if (typeof data === 'object' && 'status' in data) {
          if (Number(data.status) === 1) {
            const rid = String(data.request || '').trim();
            if (rid) return rid;
          }
          const msg = String(data.request || data).trim();
          log(`[2captcha] Envio recusado: ${msg}`);
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
        log(`[2captcha] Falha no envio (tentativa ${attempt + 1}): ${err.message}`);
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
            log(`⏳ [CAPTCHA] Aguardando... (${(i + 1) * 5}s)`);
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

  // ══════════════════════════════════════════════════════════════════════════════
  // INTEGRAÇÃO COMPLETA (detecta + resolve + aplica token na página)
  // ══════════════════════════════════════════════════════════════════════════════

  /**
   * Se a página tiver reCAPTCHA, resolve e aplica o token.
   * Retorna true se não há CAPTCHA ou se foi resolvido com sucesso.
   *
   * @param {import('puppeteer-core').Page} page
   * @param {function} log
   * @returns {Promise<boolean>}
   */
  async trySolveIfPresent(page, log = console.log) {
    const hasRecaptcha = await this.pageHasRecaptcha(page);
    if (!hasRecaptcha) return true;

    log('[CAPTCHA] ⚠️ reCAPTCHA detectado na página!');
    log(`[CAPTCHA] URL atual: ${page.url()}`);

    if (!this.enabled) {
      log('[CAPTCHA] ❌ Sem chave API. Configure TWOCAPTCHA_API_KEY no config.js.');
      return false;
    }

    // Aguarda o iframe carregar
    log('[CAPTCHA] Aguardando carregamento do iframe do reCAPTCHA...');
    try {
      await page.waitForSelector("iframe[src*='recaptcha'], [data-sitekey]", { timeout: 8000 });
    } catch (_) {
      log('[CAPTCHA] ⚠️ Iframe não encontrado — tentando extrair mesmo assim...');
    }

    const { sitekey, dataS, enterprise } = await this.findSitekeyAndDataS(page);

    if (!sitekey) {
      log('[CAPTCHA] ❌ Sitekey não encontrada no DOM.');
      return false;
    }

    log(`[CAPTCHA] 🔑 Sitekey: ${sitekey} (${sitekey.length} chars, ${enterprise ? 'Enterprise' : 'v2'})`);

    // URL da página do CAPTCHA (usada no submit ao 2Captcha)
    const captchaPageUrl = page.url();
    log(`[CAPTCHA] URL da página: ${captchaPageUrl}`);

    // URL de destino após resolver (continue= do /sorry/)
    let continueUrl = captchaPageUrl;
    try {
      const u = new URL(captchaPageUrl);
      const raw = u.searchParams.get('continue');
      if (raw) continueUrl = decodeURIComponent(raw);
    } catch (_) {}

    // ─── Tentativa 1: modo detectado (enterprise ou v2) ──────────────────────
    log(`[CAPTCHA] 🔄 Tentativa 1: enviando como ${enterprise ? 'Enterprise' : 'v2'}...`);
    let token = await this.solveRecaptcha(sitekey, captchaPageUrl, { dataS, enterprise, log });

    // ─── Tentativa 2: modo oposto ────────────────────────────────────────────
    if (!token) {
      log(`[CAPTCHA] 🔄 Tentativa 2: retentando como ${enterprise ? 'v2' : 'Enterprise'}...`);
      token = await this.solveRecaptcha(sitekey, captchaPageUrl, { dataS, enterprise: !enterprise, log });
    }

    if (!token) {
      log(`[CAPTCHA] ❌ 2Captcha não conseguiu resolver. Verifique saldo e configuração.`);
      return false;
    }

    // ─── Aplica o token na página ────────────────────────────────────────────
    try {
      log('[CAPTCHA] Aplicando token na página...');

      const submitted = await page.evaluate((t) => {
        const textarea = document.getElementById('g-recaptcha-response')
          || document.querySelector('[name="g-recaptcha-response"]');
        if (textarea) {
          textarea.value = t;
          textarea.innerHTML = t;
        }

        if (typeof submitCallback === 'function') {
          submitCallback(t);
          return 'callback';
        }

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
          log('[CAPTCHA] Sem navegação automática, prosseguindo...');
        });
      } else {
        log(`[CAPTCHA] Nenhum formulário — navegando para: ${continueUrl}`);
        const { pageGotoRobust } = require('./google-search');
        await pageGotoRobust(page, continueUrl, { log });
      }

      // ── Verificação: o Google aceitou o token? ────────────────────────────
      const urlAfter = page.url();
      if (urlAfter.includes('/sorry/')) {
        log('[CAPTCHA] ⚠️ Token rejeitado pelo Google. Tentando navegar manualmente...');
        const { pageGotoRobust } = require('./google-search');
        try {
          await pageGotoRobust(page, continueUrl, { log });
          await new Promise((r) => setTimeout(r, 2000));
          if (page.url().includes('/sorry/')) {
            log('[CAPTCHA] ❌ Google continua bloqueando. IP possivelmente banido temporariamente.');
            return false;
          }
          log('[CAPTCHA] ✅ Navegação manual bem-sucedida!');
        } catch (navErr) {
          log(`[CAPTCHA] ❌ Erro na navegação: ${navErr.message}`);
          return false;
        }
      }

      log(`[CAPTCHA] ✅ CAPTCHA resolvido! Página: ${page.url().substring(0, 80)}`);
      return true;
    } catch (err) {
      log(`[CAPTCHA] ❌ Erro ao aplicar token: ${err.message}`);
      return false;
    }
  }
}

module.exports = { CaptchaSolver };
