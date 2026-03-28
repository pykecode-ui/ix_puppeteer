/**
 * bot/src/bot/puppeteer.js
 * Módulo de automação via Puppeteer — versão multi-perfil.
 * Gerencia múltiplas conexões simultâneas — uma por profileId.
 * Conecta no browser já aberto pelo ixBrowser via WebSocket (CDP).
 */

const puppeteer = require('puppeteer-core');

// Map de perfis ativos: profileId → { browser, page }
const activeProfiles = new Map();

/**
 * Conecta o Puppeteer a um perfil já aberto pelo ixBrowser.
 * Se já houver conexão para este profileId, retorna a existente.
 * @param {number|string} profileId  - ID do perfil (usado como chave no map)
 * @param {string} wsEndpoint        - URL WebSocket retornada pela API do ixBrowser
 * @returns {Promise<{browser: Browser, page: Page}>}
 */
async function connectToProfile(profileId, wsEndpoint) {
  // Se já está conectado, retorna a instância existente
  if (activeProfiles.has(profileId)) {
    const existing = activeProfiles.get(profileId);
    if (existing.browser.isConnected()) {
      return existing;
    }
    // Browser não está mais conectado — remove e reconecta
    activeProfiles.delete(profileId);
  }

  const browser = await puppeteer.connect({
    browserWSEndpoint: wsEndpoint,
    defaultViewport: null, // Preserva fingerprint de resolução do ixBrowser
  });

  const pages = await browser.pages();
  const page = pages[0] || (await browser.newPage());

  // Listener: detecta se o browser foi fechado manualmente
  browser.on('disconnected', () => {
    activeProfiles.delete(profileId);
    console.log(`[Puppeteer] Browser do perfil #${profileId} desconectado.`);
  });

  const session = { browser, page };
  activeProfiles.set(profileId, session);

  console.log(`[Puppeteer] Conectado ao perfil #${profileId}. Aba: ${page.url() || 'about:blank'}`);

  return session;
}

/**
 * Desconecta o Puppeteer de um perfil específico sem fechá-lo no ixBrowser.
 * @param {number|string} profileId
 */
async function disconnectProfile(profileId) {
  if (!activeProfiles.has(profileId)) return;

  const { browser } = activeProfiles.get(profileId);
  try {
    browser.disconnect(); // .disconnect() não mata o processo — só sai do controle
  } catch (_) {
    // Ignora erros se o browser já estava fechado
  } finally {
    activeProfiles.delete(profileId);
    console.log(`[Puppeteer] Desconectado do perfil #${profileId}.`);
  }
}

/**
 * Desconecta de todos os perfis ativos.
 */
async function disconnectAll() {
  const ids = [...activeProfiles.keys()];
  await Promise.all(ids.map((id) => disconnectProfile(id)));
  console.log('[Puppeteer] Todos os perfis desconectados.');
}

/**
 * Retorna a sessão ativa de um perfil.
 * @param {number|string} profileId
 * @returns {{browser: Browser, page: Page}|undefined}
 */
function getProfileSession(profileId) {
  return activeProfiles.get(profileId);
}

/**
 * Retorna todos os perfis ativamente conectados.
 * @returns {Array<{profileId, url: string}>}
 */
function getActiveProfiles() {
  const result = [];
  for (const [profileId, session] of activeProfiles.entries()) {
    result.push({
      profileId,
      url: session.page?.url() || 'about:blank',
      connected: session.browser?.isConnected() || false,
    });
  }
  return result;
}

module.exports = {
  connectToProfile,
  disconnectProfile,
  disconnectAll,
  getProfileSession,
  getActiveProfiles,
};
