/**
 * bot/src/api/dashboard-client.js
 * Cliente de comunicação entre o bot e o dashboard.
 * Gerencia:
 *  - Registro via HTTP REST
 *  - Heartbeat periódico via HTTP REST
 *  - Envio de logs via Socket.io (em tempo real) ou HTTP (fallback)
 *  - Recebimento de comandos via Socket.io
 */

const axios = require('axios');
const { io: socketConnect } = require('socket.io-client');
const config = require('../../config');

// ── Estado interno ──────────────────────────────────────────────────────────
let socket = null;
let heartbeatTimer = null;
let commandHandler = null; // Callback para processar comandos recebidos

/**
 * Cria a instância axios com baseURL e timeout padrão.
 */
function createHttpClient() {
  return axios.create({
    baseURL: config.DASHBOARD_API_URL,
    timeout: config.API_TIMEOUT_MS,
    headers: { 'Content-Type': 'application/json' },
  });
}

const http = createHttpClient();

// ══════════════════════════════════════════════════════════════════════════════
// REGISTRO
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Registra o bot no dashboard via HTTP POST.
 * @param {string} botId
 * @param {string} name
 * @returns {Promise<boolean>} true se registrado com sucesso
 */
async function register(botId, name) {
  try {
    const res = await http.post('/api/bots/register', { botId, name });
    return res.data.ok === true;
  } catch (err) {
    const msg = err.response?.data?.error || err.message;
    throw new Error(`[DashboardClient] Falha no registro: ${msg}`);
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// SOCKET.IO
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Conecta ao dashboard via Socket.io e configura todos os eventos.
 * @param {string} botId
 * @param {string} name
 * @param {function} onCommand - Callback chamado com { command, payload } ao receber um comando
 * @returns {Promise<import('socket.io-client').Socket>}
 */
function connectSocket(botId, name, onCommand) {
  return new Promise((resolve, reject) => {
    commandHandler = onCommand;

    console.log(`[Socket] Conectando ao dashboard: ${config.DASHBOARD_API_URL}`);

    socket = socketConnect(config.DASHBOARD_API_URL, {
      reconnection: true,
      reconnectionAttempts: config.RECONNECT_ATTEMPTS,
      reconnectionDelay: config.RECONNECT_DELAY_MS,
      timeout: config.API_TIMEOUT_MS,
    });

    // ── Eventos de conexão ──────────────────────────────────────────────────
    socket.on('connect', () => {
      console.log(`[Socket] Conectado ao dashboard! socket.id = ${socket.id}`);

      // Anuncia presença ao dashboard — entra na room do bot
      socket.emit('bot:join', { botId, name });

      resolve(socket);
    });

    socket.on('connect_error', (err) => {
      console.error(`[Socket] Erro de conexão: ${err.message}`);
      reject(err);
    });

    socket.on('disconnect', (reason) => {
      console.warn(`[Socket] Desconectado do dashboard: ${reason}`);
    });

    socket.on('reconnect', (attempt) => {
      console.log(`[Socket] Reconectado após ${attempt} tentativa(s).`);
      // Re-anuncia presença após reconexão
      socket.emit('bot:join', { botId, name });
    });

    // ── Recebe comandos do dashboard ────────────────────────────────────────
    socket.on('bot:command', (data) => {
      const { command, payload } = data;
      console.log(`[Socket] Comando recebido: "${command}"`, payload);
      if (commandHandler) {
        commandHandler(command, payload).catch((err) => {
          console.error(`[Socket] Erro ao executar comando "${command}":`, err.message);
          sendLog(botId, 'error', `Erro ao executar comando "${command}": ${err.message}`);
        });
      }
    });
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// LOGS
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Envia um log para o dashboard (Socket.io preferencialmente, HTTP como fallback).
 * @param {string} botId
 * @param {'info'|'success'|'error'|'warn'} level
 * @param {string} message
 */
function sendLog(botId, level, message) {
  // Sempre printa no console local também
  const prefix = level === 'error' ? '❌' : level === 'success' ? '✅' : level === 'warn' ? '⚠️' : 'ℹ️';
  console.log(`${prefix} [${level.toUpperCase()}] ${message}`);

  if (socket && socket.connected) {
    // Via socket (preferencial — aparece em tempo real no dashboard)
    socket.emit('bot:log', { botId, level, message });
  } else {
    // Fallback: HTTP POST (fire-and-forget)
    http.post(`/api/bots/${botId}/log`, { level, message }).catch(() => {
      // Silencia erros de log para não criar loop
    });
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// STATUS
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Envia atualização de status de um perfil via socket.
 * @param {string} botId
 * @param {object} statusData - { profileId, status, wsEndpoint, currentUrl }
 */
function sendStatus(botId, statusData) {
  if (socket && socket.connected) {
    socket.emit('bot:status', { botId, ...statusData });
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// HEARTBEAT
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Inicia o heartbeat periódico ao dashboard.
 * @param {string} botId
 */
function startHeartbeat(botId) {
  if (heartbeatTimer) clearInterval(heartbeatTimer);

  heartbeatTimer = setInterval(async () => {
    try {
      await http.post(`/api/bots/${botId}/heartbeat`, { status: 'online' });
    } catch (_) {
      // Silencia — o socket já sinaliza reconexão
    }
  }, config.HEARTBEAT_INTERVAL_MS);

  console.log(`[Heartbeat] Iniciado a cada ${config.HEARTBEAT_INTERVAL_MS}ms para bot ${botId}`);
}

/**
 * Para o heartbeat periódico.
 */
function stopHeartbeat() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

/**
 * Sinaliza ao dashboard que o bot está indo offline (graceful shutdown).
 * Emite bot:offline via socket e aguarda 300ms para garantir entrega.
 * @param {string} botId
 * @param {string} name
 */
async function sendOffline(botId, name) {
  if (socket && socket.connected) {
    socket.emit('bot:offline', {
      botId,
      name,
      reason: 'shutdown',
      timestamp: new Date().toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo' }),
    });
    // Aguarda o evento chegar ao dashboard antes de fechar a conexão
    await new Promise((r) => setTimeout(r, 350));
  }
}

/**
 * Desconecta o socket do dashboard.
 */
function disconnect() {
  stopHeartbeat();
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}

module.exports = {
  register,
  connectSocket,
  sendLog,
  sendStatus,
  sendOffline,
  startHeartbeat,
  stopHeartbeat,
  disconnect,
};
