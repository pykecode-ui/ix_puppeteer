/**
 * src/socket/handlers.js
 * Handlers dos eventos Socket.io — lado servidor do dashboard.
 * Gerencia a comunicação em tempo real com:
 *  - Clientes do dashboard (browser)
 *  - Bots remotos (via socket.io-client)
 */

const models = require('../db/models');

/**
 * Emite uma mensagem de log formatada para um socket específico.
 * @param {import('socket.io').Socket} socket
 * @param {'info'|'success'|'error'|'warn'} level
 * @param {string} message
 */
function emitLog(socket, level, message) {
  socket.emit('log', {
    level,
    message,
    timestamp: new Date().toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo' }),
  });
}

/**
 * Registra todos os handlers para um socket conectado.
 * Aceita tanto clientes do dashboard quanto bots remotos.
 * @param {import('socket.io').Socket} socket
 * @param {import('socket.io').Server} io
 */
function registerHandlers(socket, io) {
  console.log(`[Socket] Cliente conectado: ${socket.id}`);

  // ─── Ao conectar: envia o estado atual para o cliente ──────────────────────
  const bots = models.getAllBots();
  socket.emit('bots:list', { bots });

  // ══════════════════════════════════════════════════════════════════════════
  // EVENTOS DO BOT REMOTO
  // ══════════════════════════════════════════════════════════════════════════

  // Bot anuncia conexão via socket — entra em uma sala (room) dedicada
  socket.on('bot:join', ({ botId, name, ip }) => {
    if (!botId) return;

    // Entra na room privada deste bot — dashboard pode enviar comandos diretos
    socket.join(`bot:${botId}`);
    socket.botId = botId;     // Salva referência no socket
    socket.botName = name;    // Salva nome para uso no disconnect

    // Atualiza status, socket_id e registra no histórico
    models.updateBotStatus(botId, 'online', socket.id);
    models.recordBotStatusChange(botId, 'online');

    const timestamp = new Date().toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    console.log(`[Bot] ✅ ${name || botId} ONLINE via socket (${socket.id})`);

    // Notifica todas as abas do dashboard em tempo real
    io.emit('bots:updated', { bots: models.getAllBots() });
    io.emit('bot:online', {
      botId,
      name,
      socketId: socket.id,
      timestamp,
    });
  });

  // Bot envia atualização de status em tempo real
  socket.on('bot:status', (data) => {
    const { botId, profileId, status, wsEndpoint, currentUrl } = data;
    if (!botId) return;

    // Persiste no banco conforme o status do perfil
    if (profileId) {
      if (status === 'open') {
        models.recordBotProfileOpen(botId, profileId, wsEndpoint, currentUrl);
      } else if (status === 'closed') {
        models.recordBotProfileClose(botId, profileId);
      }
    }

    // Broadcast para o dashboard
    io.emit('bot:status', data);
  });

  // Bot envia log em tempo real via socket (alternativa ao HTTP POST)
  socket.on('bot:log', ({ botId, level, message }) => {
    if (!botId || !message) return;

    models.addBotLog(botId, level || 'info', message);

    // Broadcast para todos os clientes do dashboard
    io.emit('bot:log', {
      botId,
      level: level || 'info',
      message,
      timestamp: new Date().toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo' }),
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // EVENTOS DO DASHBOARD (enviados pelo frontend ao servidor)
  // ══════════════════════════════════════════════════════════════════════════

  // Dashboard solicita lista atualizada de bots
  socket.on('dashboard:getBots', () => {
    socket.emit('bots:list', { bots: models.getAllBots() });
  });

  // Dashboard solicita detalhes de um bot específico
  socket.on('dashboard:getBotDetail', ({ botId }) => {
    const bot = models.getBotById(botId);
    const profiles = models.getBotProfiles(botId);
    const logs = models.getBotLogs(botId, 100);
    socket.emit('bot:detail', { bot, profiles, logs });
  });

  // Dashboard envia comando para um bot específico
  // Ex: { botId, command: 'open_profile', payload: { profileId: 376 } }
  socket.on('dashboard:sendCommand', ({ botId, command, payload }) => {
    if (!botId || !command) return;

    const room = `bot:${botId}`;
    const bot = models.getBotById(botId);

    if (!bot || bot.status === 'offline') {
      emitLog(socket, 'error', `Bot ${botId} está offline. Comando não enviado.`);
      return;
    }

    console.log(`[Dashboard] Enviando comando "${command}" para bot ${botId}`);

    // Emite o comando para a room privada do bot
    io.to(room).emit('bot:command', { command, payload: payload || {} });

    // Log de confirmação para o dashboard
    emitLog(socket, 'info', `Comando "${command}" enviado para bot ${bot.name || botId}.`);
  });

  // ─── Desconexão ───────────────────────────────────────────────────────────
  socket.on('disconnect', (reason) => {
    console.log(`[Socket] Cliente desconectado: ${socket.id} (${reason})`);

    // Se era um bot, atualiza status para offline e registra no histórico
    if (socket.botId) {
      models.updateBotStatus(socket.botId, 'offline', null);
      models.recordBotStatusChange(socket.botId, 'offline');

      const timestamp = new Date().toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo' });
      console.log(`[Bot] 🔴 ${socket.botName || socket.botId} OFFLINE (${reason})`);

      // Notifica dashboard em tempo real
      io.emit('bots:updated', { bots: models.getAllBots() });
      io.emit('bot:offline', {
        botId: socket.botId,
        name: socket.botName,
        socketId: socket.id,
        reason,
        timestamp,
      });
    }
  });
}

module.exports = { registerHandlers };
