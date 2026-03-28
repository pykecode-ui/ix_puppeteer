/**
 * src/api/bot-router.js
 * Rotas REST consumidas pelos bots remotos.
 * Os bots usam estas rotas para: registro, heartbeat e envio de logs.
 * O dashboard usa o Socket.io para enviar comandos de volta.
 */

const { Router } = require('express');
const models = require('../db/models');

/**
 * Cria o router de bots com acesso ao io (Socket.io server).
 * @param {import('socket.io').Server} io
 * @returns {Router}
 */
function createBotRouter(io) {
  const router = Router();

  // ─── POST /api/bots/register ─────────────────────────────────────────────
  // Bot chama ao iniciar — registra-se no DB e recebe confirmação.
  router.post('/bots/register', (req, res) => {
    try {
      const { botId, name } = req.body;
      const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';

      if (!botId || !name) {
        return res.status(400).json({ ok: false, error: 'botId e name são obrigatórios.' });
      }

      models.registerBot(botId, name, ip);

      // Notifica o dashboard que um novo bot registrou
      io.emit('bots:updated', { bots: models.getAllBots() });
      io.emit('bot:registered', { botId, name, ip });

      console.log(`[API] Bot registrado: ${name} (${botId}) — IP: ${ip}`);

      return res.json({ ok: true, botId, message: 'Bot registrado com sucesso.' });
    } catch (err) {
      console.error('[API] Erro no registro do bot:', err.message);
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  // ─── POST /api/bots/:botId/heartbeat ────────────────────────────────────
  // Bot chama periodicamente para sinalizar que está vivo.
  router.post('/bots/:botId/heartbeat', (req, res) => {
    try {
      const { botId } = req.params;
      const { status = 'online' } = req.body;

      const bot = models.getBotById(botId);
      if (!bot) {
        return res.status(404).json({ ok: false, error: 'Bot não encontrado.' });
      }

      models.botHeartbeat(botId);

      // Notifica painel silenciosamente (sem rebuild full da lista)
      io.emit('bot:heartbeat', { botId, status, timestamp: new Date().toISOString() });

      return res.json({ ok: true });
    } catch (err) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  // ─── POST /api/bots/:botId/log ───────────────────────────────────────────
  // Bot envia um log para ser persistido e exibido no dashboard.
  router.post('/bots/:botId/log', (req, res) => {
    try {
      const { botId } = req.params;
      const { level = 'info', message } = req.body;

      if (!message) {
        return res.status(400).json({ ok: false, error: 'message é obrigatório.' });
      }

      models.addBotLog(botId, level, message);

      // Broadcast do log para o dashboard em tempo real
      io.emit('bot:log', {
        botId,
        level,
        message,
        timestamp: new Date().toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo' }),
      });

      return res.json({ ok: true });
    } catch (err) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  // ─── GET /api/bots ───────────────────────────────────────────────────────
  // Retorna a lista de todos os bots (usado internamente pelo dashboard).
  router.get('/bots', (req, res) => {
    try {
      const bots = models.getAllBots();
      return res.json({ ok: true, bots });
    } catch (err) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  // ─── GET /api/bots/:botId ────────────────────────────────────────────────
  router.get('/bots/:botId', (req, res) => {
    try {
      const bot = models.getBotById(req.params.botId);
      if (!bot) return res.status(404).json({ ok: false, error: 'Bot não encontrado.' });
      const profiles = models.getBotProfiles(req.params.botId);
      const logs = models.getBotLogs(req.params.botId, 50);
      return res.json({ ok: true, bot, profiles, logs });
    } catch (err) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  // ─── GET /api/bots/:botId/logs ───────────────────────────────────────────
  router.get('/bots/:botId/logs', (req, res) => {
    try {
      const limit = parseInt(req.query.limit) || 100;
      const logs = models.getBotLogs(req.params.botId, limit);
      return res.json({ ok: true, logs });
    } catch (err) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  // ─── GET /api/bots/:botId/status-history ─────────────────────────────────
  router.get('/bots/:botId/status-history', (req, res) => {
    try {
      const limit = parseInt(req.query.limit) || 20;
      const history = models.getBotStatusHistory(req.params.botId, limit);
      return res.json({ ok: true, history });
    } catch (err) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  // ─── DELETE /api/bots/:botId ─────────────────────────────────────────────
  // Remove um bot (e seus dados) do banco de dados.
  // Útil para remover bots fantasma, testes ou bots descontinuados.
  router.delete('/bots/:botId', (req, res) => {
    try {
      const { botId } = req.params;
      const bot = models.getBotById(botId);
      if (!bot) return res.status(404).json({ ok: false, error: 'Bot não encontrado.' });

      models.deleteBot(botId);

      // Notifica o dashboard em tempo real
      io.emit('bots:updated', { bots: models.getAllBots() });
      io.emit('bot:offline', {
        botId,
        name: bot.name,
        reason: 'deleted',
        timestamp: new Date().toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo' }),
      });

      console.log(`[API] Bot deletado: ${bot.name} (${botId})`);
      return res.json({ ok: true, message: `Bot "${bot.name}" removido.` });
    } catch (err) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  return router;
}

module.exports = { createBotRouter };
