/**
 * bot/src/api/ixbrowser.js
 * Módulo de comunicação com a Local API do ixBrowser.
 * Versão autossuficiente para o bot portável — usa IX_API_BASE do config.js.
 */

const axios = require('axios');
const config = require('../../config');

const HEADERS = { 'Content-Type': 'application/json' };
const RETRY_ATTEMPTS = 3;
const RETRY_DELAY_MS = 1500;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let isApiBusy = false;
const apiQueue = [];

function processQueue() {
  if (isApiBusy || apiQueue.length === 0) return;
  isApiBusy = true;
  
  const { endpoint, body, attempt, options, resolve, reject } = apiQueue.shift();
  
  _doCallAPI(endpoint, body, attempt, options)
    .then(resolve)
    .catch(reject)
    .finally(() => {
      isApiBusy = false;
      processQueue();
    });
}

/**
 * Enfileira a chamada da API para evitar requests simultâneos
 * que causam ECONNRESET no ixBrowser local API.
 */
function callAPI(endpoint, body = {}, options = {}) {
  return new Promise((resolve, reject) => {
    apiQueue.push({ endpoint, body, attempt: 1, options, resolve, reject });
    processQueue();
  });
}

/**
 * Função interna que realmente faz o request
 */
async function _doCallAPI(endpoint, body, attempt, options) {
  try {
    const response = await axios.post(`${config.IX_API_BASE}${endpoint}`, body, {
      headers: HEADERS,
      timeout: 60000,
    });
    const { data } = response;

    if (data.error && data.error.code !== 0) {
      // Se a API retornar um erro interno que parece erro de rede, podemos retentar
      const isRetryableError = 
        data.error.code === 'ECONNRESET' || 
        data.error.code === 1004 || 
        data.error.code === '1004' ||
        (data.error.message && data.error.message.includes('ECONNRESET'));

      if (isRetryableError && attempt < RETRY_ATTEMPTS) {
        if (!options.silent) console.warn(`[ixBrowser] Erro interno da API (código ${data.error.code}) — tentativa ${attempt}/${RETRY_ATTEMPTS}...`);
        await sleep(RETRY_DELAY_MS);
        return _doCallAPI(endpoint, body, attempt + 1, options);
      }
      throw new Error(`ixBrowser API Error [${data.error.code}]: ${data.error.message}`);
    }

    return data.data || data;
  } catch (err) {
    if (err.code === 'ECONNREFUSED') {
      throw new Error(
        `ixBrowser não está em execução em ${config.IX_API_BASE}. ` +
        'Verifique se o aplicativo está aberto.'
      );
    }

    const isNetworkError = ['ENOTFOUND', 'ETIMEDOUT', 'ECONNRESET', 'EAI_AGAIN'].includes(err.code);
    if (isNetworkError && attempt < RETRY_ATTEMPTS) {
      if (!options.silent) console.warn(`[ixBrowser] Erro de rede (${err.code}) — tentativa ${attempt}/${RETRY_ATTEMPTS}...`);
      await sleep(RETRY_DELAY_MS);
      return _doCallAPI(endpoint, body, attempt + 1, options);
    }

    if (isNetworkError) {
      throw new Error(
        `Falha de rede ao contatar ixBrowser após ${RETRY_ATTEMPTS} tentativas (${err.code}).`
      );
    }

    throw err;
  }
}

/**
 * Abre um perfil pelo ID, com suporte opcional a limpeza de cache e cookies
 * e uso de fingerprint aleatório.
 * @param {number|string} profileId
 * @param {boolean} cleanCache
 * @param {boolean} randomFp
 * @returns {Promise<{ws: string, debugging_address: string, profile_id: number}>}
 */
async function openProfile(profileId, cleanCache = false, randomFp = false) {
  if (cleanCache) {
    try {
      await callAPI('/api/v2/profile-clear-cache-and-cookies', {
        profile_id: [Number(profileId)]
      });
      console.log(`[ixBrowser] Cache e cookies limpos com sucesso para o perfil #${profileId}.`);
    } catch (err) {
      console.warn(`[ixBrowser] Falha ao limpar cache/cookies para o perfil #${profileId}:`, err.message);
    }
  }

  const endpoint = randomFp ? '/api/v2/profile-open-with-random-fingerprint' : '/api/v2/profile-open';

  const result = await callAPI(endpoint, {
    profile_id: Number(profileId),
    load_profile_info_page: true,
    load_extensions: true
  });

  if (!result.ws) {
    throw new Error(
      'A API não retornou a URL WebSocket. O perfil pode já estar aberto ou ocorreu um erro interno.'
    );
  }

  return result;
}

/**
 * Fecha um perfil pelo ID.
 * @param {number|string} profileId
 */
async function closeProfile(profileId) {
  return await callAPI('/api/v2/profile-close', {
    profile_id: Number(profileId),
  });
}

/**
 * Retorna a lista de perfis atualmente abertos.
 * @returns {Promise<Array>}
 */
async function listOpenedProfiles() {
  return await callAPI('/api/v2/profile-opened-list', {}, { silent: true });
}

module.exports = { openProfile, closeProfile, listOpenedProfiles };
