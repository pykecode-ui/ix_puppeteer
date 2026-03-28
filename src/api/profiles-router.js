/**
 * src/api/profiles-router.js
 * Rotas REST para gerenciamento de perfis globais do IxBrowser.
 * Permite cadastrar perfis individualmente ou em massa via ID,
 * e atribuir perfis a bots específicos.
 */

const { Router } = require('express');
const models = require('../db/models');

function createProfilesRouter(io) {
  const router = Router();

  // ─── GET /api/profiles ────────────────────────────────────────────────────
  // Retorna todos os perfis cadastrados no dashboard.
  router.get('/profiles', (req, res) => {
    try {
      const profiles = models.getAllIxProfiles();
      return res.json({ ok: true, profiles });
    } catch (err) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  // ─── GET /api/profiles/:profileId ────────────────────────────────────────
  router.get('/profiles/:profileId', (req, res) => {
    try {
      const pid = parseInt(req.params.profileId);
      const profile = models.getIxProfile(pid);
      if (!profile) return res.status(404).json({ ok: false, error: 'Perfil não encontrado.' });
      return res.json({ ok: true, profile });
    } catch (err) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  // ─── POST /api/profiles ───────────────────────────────────────────────────
  // Cria um ou mais perfis.
  // Body: { profileIds: [376, 377, 378], name?: string, notes?: string }
  // OU:   { profileId: 376, name?: string, notes?: string }
  router.post('/profiles', (req, res) => {
    try {
      let { profileIds, profileId, name, notes } = req.body;

      // Normaliza: aceita tanto profileId (singular) quanto profileIds (array)
      if (!profileIds && profileId) profileIds = [profileId];
      if (!profileIds && !profileId) {
        return res.status(400).json({ ok: false, error: 'profileId ou profileIds é obrigatório.' });
      }

      // Converte para array se necessário
      if (!Array.isArray(profileIds)) profileIds = [profileIds];

      // Valida e converte para inteiros
      const ids = profileIds.map((id) => parseInt(id)).filter((id) => !isNaN(id) && id > 0);
      if (ids.length === 0) {
        return res.status(400).json({ ok: false, error: 'Nenhum ID de perfil válido fornecido.' });
      }

      const result = models.createIxProfiles(ids, name || null, notes || null);

      // Notifica o dashboard via Socket.io
      io.emit('profiles:updated', { profiles: models.getAllIxProfiles() });

      return res.json({
        ok: true,
        created: result.created,
        skipped: result.skipped,
        message: `${result.created} perfil(is) criado(s), ${result.skipped} já existia(m).`,
      });
    } catch (err) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  // ─── PUT /api/profiles/:profileId ────────────────────────────────────────
  // Atualiza nome e notas de um perfil.
  router.put('/profiles/:profileId', (req, res) => {
    try {
      const pid = parseInt(req.params.profileId);
      const { name, notes } = req.body;

      const existing = models.getIxProfile(pid);
      if (!existing) return res.status(404).json({ ok: false, error: 'Perfil não encontrado.' });

      models.updateIxProfile(pid, name !== undefined ? name : existing.name, notes !== undefined ? notes : existing.notes);

      io.emit('profiles:updated', { profiles: models.getAllIxProfiles() });
      return res.json({ ok: true, message: 'Perfil atualizado.' });
    } catch (err) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  // ─── DELETE /api/profiles/:profileId ─────────────────────────────────────
  router.delete('/profiles/:profileId', (req, res) => {
    try {
      const pid = parseInt(req.params.profileId);
      const existing = models.getIxProfile(pid);
      if (!existing) return res.status(404).json({ ok: false, error: 'Perfil não encontrado.' });

      models.deleteIxProfile(pid);

      io.emit('profiles:updated', { profiles: models.getAllIxProfiles() });
      return res.json({ ok: true, message: `Perfil #${pid} removido.` });
    } catch (err) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  // ─── GET /api/bots/:botId/assignments ────────────────────────────────────
  // Retorna os perfis atribuídos a um bot específico.
  router.get('/bots/:botId/assignments', (req, res) => {
    try {
      const { botId } = req.params;
      const bot = models.getBotById(botId);
      if (!bot) return res.status(404).json({ ok: false, error: 'Bot não encontrado.' });

      const assignments = models.getBotProfileAssignments(botId);
      return res.json({ ok: true, assignments });
    } catch (err) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  // ─── PUT /api/bots/:botId/assignments ────────────────────────────────────
  // Define (substitui) os perfis atribuídos a um bot.
  // Body: { profileIds: [376, 377] }
  router.put('/bots/:botId/assignments', (req, res) => {
    try {
      const { botId } = req.params;
      const { profileIds = [] } = req.body;

      const bot = models.getBotById(botId);
      if (!bot) return res.status(404).json({ ok: false, error: 'Bot não encontrado.' });

      const ids = profileIds.map((id) => parseInt(id)).filter((id) => !isNaN(id) && id > 0);
      models.setBotProfileAssignments(botId, ids);

      // Notifica o dashboard
      io.emit('bot:assignments_updated', {
        botId,
        assignments: models.getBotProfileAssignments(botId),
      });

      return res.json({ ok: true, message: `${ids.length} perfil(is) atribuído(s) ao bot.`, assignments: models.getBotProfileAssignments(botId) });
    } catch (err) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  return router;
}

module.exports = { createProfilesRouter };
