/**
 * bot/src/bot/google-search.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Funções de pesquisa no Google adaptadas de adspower.py → Puppeteer (Node.js).
 *
 * Inclui:
 *  - Navegação robusta com retentativas (page_goto_robust)
 *  - Esperas inteligentes baseadas em estado do DOM/URL
 *  - Aceitar cookies do Google (multilíngue)
 *  - Pesquisa direta via URL (/search?q=...) e via homepage
 *  - Preenchimento anti-React do campo de busca
 *  - Detecção e colheita de anúncios na SERP
 * ─────────────────────────────────────────────────────────────────────────────
 */

// ── Constantes de tempo (otimizados para velocidade) ───────────────────────

const GOOGLE_GOTO_MS        = 30_000;   // Timeout navegação (30s)
const GOOGLE_UI_MS          = 15_000;   // Timeout UI geral (15s)
const EC_UI_MS              = 5_000;    // Espera SERP/elementos (5s)
const EC_MICRO_MS           = 2_000;

const SEARCH_BOX_SEL        = 'textarea[name="q"], input[name="q"]';
const SERP_MARKERS_SEL      = '#search, #rso, #result-stats, #botstuff';
const SERP_URL_REGEX         = /https?:\/\/([^/]*\.)?google\.[^/]+\/search/;

// Tempos de micro-pausa (simular humano)
const SERP_POST_LOAD_MIN    = 0.03;
const SERP_POST_LOAD_MAX    = 0.08;

// ══════════════════════════════════════════════════════════════════════════════
// UTILITÁRIOS
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Sleep aleatório entre min e max segundos (simula humano).
 */
function humanSleep(min = 0.8, max = 2.0) {
  const ms = (Math.random() * (max - min) + min) * 1000;
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Verifica se URL é página de erro do Chrome.
 */
function urlIsChromeError(url) {
  const u = (url || '').trim().toLowerCase();
  return u.startsWith('chrome-error:') || u.includes('chromewebdata');
}

/**
 * Classifica erro como recuperável para retentativa.
 */
function isRecoverableError(err) {
  const t = String(err.message || err).toLowerCase();
  return (
    t.includes('interrupted') ||
    t.includes('chrome-error') ||
    t.includes('chromewebdata') ||
    t.includes('net::err') ||
    t.includes('err_') ||
    t.includes('target closed') ||
    t.includes('session closed') ||
    t.includes('timeout')
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// NAVEGAÇÃO ROBUSTA (equivalente page_goto_robust do Python)
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Navega para URL com retentativas automáticas.
 * Resolve timeouts, chrome-error://, e erros de proxy.
 *
 * @param {import('puppeteer-core').Page} page
 * @param {string} url
 * @param {object} opts
 * @param {number} opts.timeoutMs - Timeout de navegação (padrão: 120s)
 * @param {string} opts.waitUntil - Condição de espera (padrão: 'domcontentloaded')
 * @param {number} opts.attempts - Número de tentativas (padrão: 6)
 * @param {function} opts.log - Função de log
 */
async function pageGotoRobust(page, url, opts = {}) {
  const {
    timeoutMs = GOOGLE_GOTO_MS,
    waitUntil = 'domcontentloaded',
    attempts = 3,
    log = console.log,
  } = opts;

  let lastError = null;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      // Verifica se aba está em chrome-error antes de navegar
      const currentUrl = page.url() || '';
      if (urlIsChromeError(currentUrl)) {
        log(`[goto] Aba em chrome-error; tentativa ${attempt}/${attempts}`);
        await humanSleep(0.5, 1.5);
      }

      // A partir da 4ª tentativa, reduz a espera para apenas "commit"
      const wu = attempt >= 4 ? 'commit' : waitUntil;

      await page.goto(url, { waitUntil: wu, timeout: timeoutMs });

      // Se usou "commit", breve espera para DOM
      if (wu === 'commit') {
        try {
          await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 5_000 });
        } catch (_) { /* OK — já carregou parcialmente */ }
      }

      // Verifica se não caiu em chrome-error após o goto
      const afterUrl = page.url() || '';
      if (urlIsChromeError(afterUrl)) {
        log(`[goto] Após goto ainda em chrome-error; tentativa ${attempt}/${attempts}`);
        lastError = new Error(`Página de erro: ${afterUrl.slice(0, 100)}`);
        await humanSleep(1.0, 2.0);
        continue;
      }

      return; // ✅ Sucesso!
    } catch (err) {
      lastError = err;

      if (err.name === 'TimeoutError' || err.message?.includes('timeout')) {
        log(`[goto] Timeout ao ir para ${url.slice(0, 60)}… (tentativa ${attempt}/${attempts})`);
        if (attempt >= attempts) break;
        await humanSleep(0.5, 1.5);
      } else if (isRecoverableError(err) && attempt < attempts) {
        log(`[goto] ${err.message} (tentativa ${attempt}/${attempts})`);
        await humanSleep(0.5, 1.5);
      } else {
        throw err;
      }
    }
  }

  throw new Error(
    `Navegação para "${url.slice(0, 80)}" falhou após ${attempts} tentativas. ` +
    `Verifique proxy/rede do perfil. Último erro: ${lastError?.message || 'desconhecido'}`
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// ESPERAS INTELIGENTES (Expected Conditions — equivalentes do Python)
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Espera caixa de pesquisa do Google ficar visível.
 */
async function waitSearchBoxVisible(page, timeoutMs = EC_UI_MS) {
  await page.waitForSelector(SEARCH_BOX_SEL, { visible: true, timeout: timeoutMs });
  return await page.$(SEARCH_BOX_SEL);
}

/**
 * Espera marcadores da SERP existirem no DOM.
 */
async function waitSerpMarkersAttached(page, timeoutMs = EC_UI_MS) {
  const selectors = SERP_MARKERS_SEL.split(',').map((s) => s.trim());
  try {
    await Promise.race(
      selectors.map((sel) => page.waitForSelector(sel, { timeout: timeoutMs }).catch(() => null))
    );
  } catch (_) {
    try {
      await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: Math.min(timeoutMs, 8_000) });
    } catch (_2) { /* Ignora — melhor esforço */ }
  }
}

/**
 * Espera URL de pesquisa OU marcadores SERP (o que vier primeiro).
 */
async function waitSerpUrlOrMarkers(page, timeoutMs = EC_UI_MS) {
  try {
    await page.waitForFunction(
      () => /\/search[?]/.test(window.location.href) || document.querySelector('#search, #rso'),
      { timeout: timeoutMs }
    );
    return;
  } catch (_) { /* Fallback para marcadores */ }
  await waitSerpMarkersAttached(page, Math.min(timeoutMs, 3_000));
}

// ══════════════════════════════════════════════════════════════════════════════
// ACEITAR COOKIES DO GOOGLE (equivalente accept_google_cookies do Python)
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Aceita o banner de cookies do Google (multilíngue).
 * Tenta vários seletores/textos em todas as frames da página.
 */
async function acceptGoogleCookies(page, log = console.log) {
  // Seletores de botões de aceitar cookies (PT/EN/ES)
  const buttonTexts = [
    'Aceitar tudo',
    'Aceitar todos',
    'Accept all',
    'I agree',
    'Reject all',
    'Recusar tudo',
    'Aceptar todo',
  ];

  const ariaLabels = [
    'Aceitar tudo',
    'Accept all',
    'Aceptar todo',
  ];

  try {
    // Tenta na página principal
    for (const text of buttonTexts) {
      try {
        const btn = await page.$(`button`);
        // Busca por XPath com texto
        const buttons = await page.$$('button');
        for (const b of buttons) {
          const innerText = await b.evaluate((el) => el.textContent?.trim() || '');
          if (innerText.toLowerCase().includes(text.toLowerCase())) {
            await b.click({ timeout: 4000 });
            log('[Google] ✅ Cookies aceitos');
            await humanSleep(0.5, 1.0);
            return true;
          }
        }
      } catch (_) { continue; }
    }

    // Tenta por aria-label
    for (const label of ariaLabels) {
      try {
        const el = await page.$(`[aria-label="${label}"]`);
        if (el) {
          await el.click({ timeout: 4000 });
          log('[Google] ✅ Cookies aceitos (aria-label)');
          await humanSleep(0.5, 1.0);
          return true;
        }
      } catch (_) { continue; }
    }

    // Tenta nas frames (o banner de cookies é frequentemente um iframe)
    const frames = page.frames();
    for (const frame of frames) {
      for (const text of buttonTexts) {
        try {
          const buttons = await frame.$$('button');
          for (const b of buttons) {
            const innerText = await b.evaluate((el) => el.textContent?.trim() || '');
            if (innerText.toLowerCase().includes(text.toLowerCase())) {
              await b.click({ timeout: 4000 });
              log('[Google] ✅ Cookies aceitos (iframe)');
              await humanSleep(0.5, 1.0);
              return true;
            }
          }
        } catch (_) { continue; }
      }
    }
  } catch (_) { /* Sem banner — OK */ }

  return false;
}

// ══════════════════════════════════════════════════════════════════════════════
// PESQUISA NO GOOGLE (equivalentes do Python)
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Preenche o campo de pesquisa usando técnica anti-React.
 * O Google usa React que bloqueia .type() e value= em certos cenários.
 */
async function fillSearchAndSubmit(page, keyword, log = console.log) {
  // Fecha suggestions dropdown
  try {
    await page.keyboard.press('Escape');
    await humanSleep(0.05, 0.14);
  } catch (_) {}

  const searchBox = await page.$(SEARCH_BOX_SEL);
  if (!searchBox) throw new Error('Caixa de pesquisa do Google não encontrada.');

  // Limpa e preenche
  await searchBox.click({ clickCount: 3 });
  await humanSleep(0.05, 0.1);

  // Tenta via evaluate (setter nativo — contorna React)
  await searchBox.evaluate((el, text) => {
    const proto = el instanceof HTMLTextAreaElement
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype;
    const desc = Object.getOwnPropertyDescriptor(proto, 'value');
    if (desc && desc.set) {
      desc.set.call(el, text);
    } else {
      el.value = text;
    }
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.focus();
  }, keyword);

  // Verifica se preencheu corretamente
  const currentVal = await searchBox.evaluate((el) => el.value);
  if (currentVal !== keyword) {
    // Fallback: type caractere por caractere
    await searchBox.click({ clickCount: 3 });
    await searchBox.type(keyword, { delay: 30 });
  }

  // Envia pesquisa
  await page.keyboard.press('Enter');
  log(`[Google] 🔎 Pesquisando: "${keyword}"`);

  // Espera SERP carregar
  await waitSerpUrlOrMarkers(page, EC_UI_MS);
}

/**
 * Pesquisa direta via URL — mais rápido que homepage.
 * Equivalente do SEARCH_DIRECT_URL_TO_SERP=True do Python.
 */
async function searchDirectUrl(page, keyword, opts = {}) {
  const { captchaSolver, log = console.log } = opts;

  const q = encodeURIComponent(keyword.trim());
  const searchUrl = `https://www.google.com/search?q=${q}&pws=0`;

  await pageGotoRobust(page, searchUrl, { log });

  // Breve espera pela SERP (máximo 5s)
  await waitSerpUrlOrMarkers(page, EC_UI_MS);

  // Aceita cookies (rápido — só clica se banner visível)
  await acceptGoogleCookies(page, log);

  // Detecta CAPTCHA (não bloqueia se não tiver solver)
  if (captchaSolver) {
    await captchaSolver.trySolveIfPresent(page, log, opts.profileId);
  }
}

/**
 * Pesquisa via homepage — google.com → digitar → Enter.
 * Fallback quando a URL direta falha.
 */
async function searchViaHomepage(page, keyword, opts = {}) {
  const { captchaSolver, log = console.log } = opts;

  await pageGotoRobust(page, 'https://www.google.com/', { log });

  // Espera caixa de pesquisa
  await waitSearchBoxVisible(page, EC_UI_MS);

  // Resolve CAPTCHA se aparecer
  if (captchaSolver) {
    await captchaSolver.trySolveIfPresent(page, log, opts.profileId);
  }

  // Aceita cookies
  await acceptGoogleCookies(page, log);

  // Espera caixa de pesquisa novamente (cookies podem recarregar)
  await waitSearchBoxVisible(page, EC_UI_MS);

  // Resolve CAPTCHA novamente
  if (captchaSolver) {
    await captchaSolver.trySolveIfPresent(page, log, opts.profileId);
  }

  // Preenche e submete
  await fillSearchAndSubmit(page, keyword, log);
}

/**
 * Função principal de pesquisa no Google.
 * Tenta URL direta primeiro; faz fallback para homepage.
 *
 * @param {import('puppeteer-core').Page} page
 * @param {string} keyword - Palavra-chave para pesquisar
 * @param {object} opts
 * @param {object} opts.captchaSolver - Instância do CaptchaSolver (ou null)
 * @param {function} opts.log - Função de log
 * @param {string} opts.method - 'direct_url' | 'homepage' (padrão: 'direct_url')
 */
async function doGoogleSearch(page, keyword, opts = {}) {
  const { method = 'direct_url', log = console.log } = opts;

  page.setDefaultTimeout(GOOGLE_UI_MS);

  if (method === 'direct_url') {
    await searchDirectUrl(page, keyword, opts);
  } else {
    await searchViaHomepage(page, keyword, opts);
  }

  // Micro-pausa para estabilização do DOM (rápido)
  await humanSleep(SERP_POST_LOAD_MIN, SERP_POST_LOAD_MAX);
}

// ══════════════════════════════════════════════════════════════════════════════
// COLHEITA DE ANÚNCIOS NA SERP
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Decodifica href do Google (redirect /url?q=...) para URL real.
 */
function decodeGoogleHref(href) {
  if (!href) return '';
  const trimmed = href.trim();
  try {
    const url = new URL(trimmed, 'https://www.google.com');
    if ((url.pathname === '/url' || url.pathname === '/url/') &&
        (url.hostname.includes('google.') || !url.hostname)) {
      const q = url.searchParams.get('q') || url.searchParams.get('url');
      if (q) return decodeURIComponent(q).trim();
    }
  } catch (_) {}
  return trimmed;
}

/**
 * Verifica se um href é clicável como anúncio (rejeita #, javascript:, suporte).
 */
function isValidAdHref(href) {
  const h = (href || '').trim();
  if (!h || h.startsWith('#') || h.toLowerCase().startsWith('javascript:')) return false;
  if (h.startsWith('/url')) return true;
  if (h.startsWith('//')) return true;
  if (!h.startsWith('http')) return false;
  const lo = h.toLowerCase();
  if (lo.includes('support.google.com') || lo.includes('policies.google.com')) return false;
  return true;
}

/**
 * Colhe anúncios de texto na SERP do Google.
 * Detecta slots de anúncio por data-text-ad, #tads, #tadsb e XPaths.
 *
 * @param {import('puppeteer-core').Page} page
 * @param {function} log
 * @returns {Promise<Array<{position, slotLabel, hrefRaw, hrefDecoded, displayUrl, adTitle, dataPcu, dataTaSlot, dataTaSlotPos}>>}
 */
async function harvestSerpAds(page, log = console.log) {
  const ads = [];
  const seenHrefs = new Set();

  // Helper: extrai dados de um container de anúncio
  async function extractAdFromContainer(containerEl) {
    try {
      const data = await containerEl.evaluate((el) => {
        // Link principal: data-pcu > primeiro <a>
        const primaryLink = el.querySelector('a[data-pcu]') || el.querySelector('a[href]');
        if (!primaryLink) return null;

        const href = (primaryLink.getAttribute('href') || '').trim();
        if (!href) return null;

        // Título do anúncio
        const heading = el.querySelector('[role="heading"]');
        const adTitle = heading ? (heading.innerText || '').trim() : '';

        // URL de exibição (cite / data-dtld)
        let displayUrl = '';
        for (const sel of ['cite', 'span[data-dtld]', '[data-dtld]']) {
          const found = el.querySelector(sel);
          if (found) {
            displayUrl = (found.innerText || '').trim();
            if (displayUrl) break;
          }
        }

        // Descrição do anúncio
        let adDescription = '';
        const descEl = el.querySelector('.yDfsy, .pc3Sdb, .VwiC3b, [data-snf], .MUxGbd:not([role="heading"]):not(h3):not(a)');
        if (descEl) adDescription = (descEl.innerText || '').trim().slice(0, 300);

        // Heurística de fallback caso o seletor padrão falhe ou retorne texto muito curto
        if (!adDescription || adDescription.length < 10) {
          try {
            const textNodes = Array.from(el.querySelectorAll('div, span, p'))
              .filter(node => {
                // Não pode estar dentro de um link ou botão
                if (node.closest('a') || node.closest('button')) return false;

                const text = (node.innerText || '').trim();
                if (text.length < 20 || text.length > 350) return false;

                // Ignora URLs de exibição
                if (text.includes('›') || text.includes('www.') || text.includes('http')) return false;

                // Garante que é um elemento folha ou não tem divs/p internos
                const childDivs = node.querySelectorAll('div, p');
                if (childDivs.length > 0) return false;

                return true;
              });

            if (textNodes.length > 0) {
              // Ordena pelo tamanho do texto decrescente e pega o maior
              textNodes.sort((a, b) => b.innerText.length - a.innerText.length);
              adDescription = (textNodes[0].innerText || '').trim().slice(0, 300);
            }
          } catch (_) {}
        }

        // Dados do slot
        const dataPcu = (primaryLink.getAttribute('data-pcu') || '').trim();
        const dataRw = (primaryLink.getAttribute('data-rw') || '').trim();
        const dataTaSlot = (el.getAttribute('data-ta-slot') || '').trim();
        const dataTaSlotPos = (el.getAttribute('data-ta-slot-pos') || '').trim();

        // Posição baseada no slot
        let position = 'unknown';
        let slotLabel = '';
        if (dataTaSlot === '0') {
          position = 'top';
          slotLabel = dataTaSlotPos ? `Topo — pos ${dataTaSlotPos}` : 'Topo';
        } else if (dataTaSlot === '3') {
          position = 'bottom';
          slotLabel = dataTaSlotPos ? `Rodapé — pos ${dataTaSlotPos}` : 'Rodapé';
        } else {
          // Detecta pelo bloco pai
          let parent = el.parentElement;
          for (let i = 0; i < 10 && parent; i++) {
            if (parent.id === 'tads') { position = 'top'; slotLabel = 'Topo (#tads)'; break; }
            if (parent.id === 'tadsb') { position = 'bottom'; slotLabel = 'Rodapé (#tadsb)'; break; }
            parent = parent.parentElement;
          }
          if (position === 'unknown') slotLabel = 'Anúncio';
        }

        return { href, adTitle, displayUrl, adDescription, dataPcu, dataRw, dataTaSlot, dataTaSlotPos, position, slotLabel };
      });

      return data;
    } catch (_) {
      return null;
    }
  }

  // Scroll para topo
  try { await page.evaluate(() => window.scrollTo(0, 0)); } catch (_) {}
  await humanSleep(0.2, 0.35);

  // Busca todos os containers data-text-ad="1"
  const containers = await page.$$('div[data-text-ad="1"]');

  let slotIndex = 0;
  for (const container of containers) {
    const data = await extractAdFromContainer(container);
    if (!data || !data.href) continue;
    if (!isValidAdHref(data.href)) continue;
    if (seenHrefs.has(data.href)) continue;

    seenHrefs.add(data.href);
    ads.push({
      ...data,
      hrefRaw: data.href,
      hrefDecoded: decodeGoogleHref(data.href),
      slotIndex: slotIndex++,
    });
  }

  // Scroll para rodapé (pode revelar ads lazy-loaded)
  try {
    await page.evaluate(() => window.scrollTo(0, Math.max(0, document.body.scrollHeight - window.innerHeight)));
  } catch (_) {}
  await humanSleep(0.28, 0.42);

  // 2ª passagem — busca ads no rodapé
  const containers2 = await page.$$('div[data-text-ad="1"]');
  for (const container of containers2) {
    const data = await extractAdFromContainer(container);
    if (!data || !data.href) continue;
    if (!isValidAdHref(data.href)) continue;
    if (seenHrefs.has(data.href)) continue;

    seenHrefs.add(data.href);
    ads.push({
      ...data,
      hrefRaw: data.href,
      hrefDecoded: decodeGoogleHref(data.href),
      slotIndex: slotIndex++,
    });
  }

  log(`[Google] 📊 ${ads.length} anúncio(s) encontrado(s) na SERP`);
  return ads;
}

/**
 * Avança para a próxima página de resultados de busca (Desktop ou Mobile).
 * No Mobile, clica no botão "Mais resultados" e aguarda o carregamento dinâmico via Ajax.
 * No Desktop, clica no botão "Próxima" (#pnnext) e aguarda o carregamento da nova página.
 *
 * @param {import('puppeteer-core').Page} page
 * @param {function} log
 * @returns {Promise<boolean>} Retorna true se conseguiu clicar e paginar com sucesso.
 */
async function goToNextPage(page, log = console.log) {
  try {
    const userAgent = await page.evaluate(() => navigator.userAgent).catch(() => '');
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(userAgent);

    if (isMobile) {
      log('[Navegação] Detectado dispositivo móvel. Buscando botão "Mais resultados"…');

      // Tenta localizar o botão "Mais resultados" via seletores do Google Mobile
      const mobileSelectors = [
        'a[data-extended-results]',
        'button[data-extended-results]',
        'a.q8s197', 
        'div.zS514b',
        'span.PNy8Zc'
      ];

      let buttonEl = null;

      for (const sel of mobileSelectors) {
        const el = await page.$(sel);
        if (el) {
          const visible = await el.evaluate(node => {
            const style = window.getComputedStyle(node);
            return style && style.display !== 'none' && style.visibility !== 'hidden' && node.offsetHeight > 0;
          }).catch(() => false);
          
          if (visible) {
            buttonEl = el;
            log(`[Navegação] Botão de paginação mobile localizado via seletor: "${sel}"`);
            break;
          }
        }
      }

      // Fallback: Busca textual em todos os botões/elementos clicáveis
      if (!buttonEl) {
        log('[Navegação] Seletores específicos não localizados. Buscando por texto ("Mais resultados" / "More results")…');
        const elements = await page.$$('span, a, button, div[role="button"]');
        for (const el of elements) {
          const text = await page.evaluate(node => node.innerText, el).catch(() => '');
          if (text) {
            const cleanText = text.trim().toLowerCase();
            if (cleanText === 'mais resultados' || cleanText === 'more results' || cleanText.includes('mais resultados')) {
              const visible = await el.evaluate(node => {
                const style = window.getComputedStyle(node);
                return style && style.display !== 'none' && style.visibility !== 'hidden' && node.offsetHeight > 0;
              }).catch(() => false);

              if (visible) {
                buttonEl = el;
                log(`[Navegação] Botão de paginação mobile localizado via texto: "${text.trim()}"`);
                break;
              }
            }
          }
        }
      }

      if (buttonEl) {
        log('[Navegação] Clicando no botão "Mais resultados"…');
        await buttonEl.evaluate(el => el.scrollIntoView({ behavior: 'smooth', block: 'center' })).catch(() => {});
        await new Promise(r => setTimeout(r, 1000));
        await buttonEl.click();
        
        // Aguarda estabilização do DOM/Ajax no Mobile (5 segundos)
        log('[Navegação] Aguardando o carregamento dos novos resultados (Ajax)…');
        await new Promise(r => setTimeout(r, 5000));
        return true;
      }

      log('[Navegação] ⚠️ Botão "Mais resultados" não foi localizado ou não está visível na tela.');
      return false;
    } else {
      log('[Navegação] Detectado desktop. Buscando botão "Próxima" (#pnnext)…');
      const nextBtn = await page.$('#pnnext');
      if (nextBtn) {
        log('[Navegação] Clicando no botão de próxima página (#pnnext)…');
        await nextBtn.evaluate(el => el.scrollIntoView({ behavior: 'smooth', block: 'center' })).catch(() => {});
        await new Promise(r => setTimeout(r, 1000));
        
        const navigationPromise = page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => null);
        await nextBtn.click();
        await navigationPromise;
        
        // Aguarda marcadores da nova SERP
        await waitSerpUrlOrMarkers(page, 10000);
        return true;
      }
      log('[Navegação] ⚠️ Link de próxima página (#pnnext) não foi localizado.');
      return false;
    }
  } catch (err) {
    log(`[Navegação] ❌ Erro ao tentar avançar de página: ${err.message}`);
    return false;
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// EXPORTS
// ══════════════════════════════════════════════════════════════════════════════

module.exports = {
  // Utils
  humanSleep,
  urlIsChromeError,
  isRecoverableError,
  // Navegação
  pageGotoRobust,
  goToNextPage,
  // Esperas
  waitSearchBoxVisible,
  waitSerpMarkersAttached,
  waitSerpUrlOrMarkers,
  // Cookies
  acceptGoogleCookies,
  // Pesquisa
  fillSearchAndSubmit,
  doGoogleSearch,
  // Anúncios
  decodeGoogleHref,
  isValidAdHref,
  harvestSerpAds,
  // Constantes
  SERP_URL_REGEX,
  GOOGLE_GOTO_MS,
  GOOGLE_UI_MS,
};
