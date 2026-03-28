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

/**
 * Faz uma chamada POST para a API do ixBrowser com retry automático.
 * @param {string} endpoint
 * @param {object} body
 * @param {number} attempt
 */
async function callAPI(endpoint, body = {}, attempt = 1) {
  try {
    const response = await axios.post(`${config.IX_API_BASE}${endpoint}`, body, {
      headers: HEADERS,
      timeout: 10000,
    });
    const { data } = response;

    if (data.error && data.error.code !== 0) {
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
      console.warn(`[ixBrowser] Erro de rede (${err.code}) — tentativa ${attempt}/${RETRY_ATTEMPTS}...`);
      await sleep(RETRY_DELAY_MS);
      return callAPI(endpoint, body, attempt + 1);
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
 * Abre um perfil pelo ID.
 * @param {number|string} profileId
 * @returns {Promise<{ws: string, debugging_address: string, profile_id: number}>}
 */
async function openProfile(profileId) {
  const result = await callAPI('/api/v2/profile-open', {
    profile_id: Number(profileId),
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
  return await callAPI('/api/v2/profile-opened-list', {});
}

module.exports = { openProfile, closeProfile, listOpenedProfiles };
