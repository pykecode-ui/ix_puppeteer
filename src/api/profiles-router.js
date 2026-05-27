/**
 * src/api/profiles-router.js
 * Rotas REST para gerenciamento de perfis globais do IxBrowser.
 * Permite cadastrar perfis individualmente ou em massa via ID,
 * e atribuir perfis a bots específicos.
 */

const { Router } = require('express');
const models = require('../db/models');
const { getDB } = require('../db/database');

function createProfilesRouter(io) {
  const router = Router();

  // ─── GET /api/profiles/all-assignments ───────────────────────────────────
  // IMPORTANTE: Essa rota DEVE vir ANTES de /profiles/:profileId
  // para não ser capturada pelo parâmetro dinâmico.
  // Retorna mapa: { profileId: [{ botId, botName }] } para todos os perfis.
  router.get('/profiles/all-assignments', (req, res) => {
    try {
      const rows = getDB().prepare(`
        SELECT bpa.profile_id, bpa.bot_id, b.name AS bot_name
        FROM bot_profile_assignments bpa
        LEFT JOIN bots b ON b.bot_id = bpa.bot_id
        ORDER BY bpa.profile_id ASC
      `).all();

      // Agrupa por profile_id
      const map = {};
      for (const row of rows) {
        if (!map[row.profile_id]) map[row.profile_id] = [];
        map[row.profile_id].push({ botId: row.bot_id, botName: row.bot_name || row.bot_id.slice(0, 8) });
      }

      return res.json({ ok: true, assignments: map });
    } catch (err) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

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
      let { profileIds, profileId, name, notes, device_type, browser_language } = req.body;

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

      const result = models.createIxProfiles(ids, name || null, notes || null, device_type || 'desktop', browser_language || 'PT');

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

  // ─── POST /api/profiles/:profileId/open ──────────────────────────────────
  // Registra que o perfil foi aberto (incrementa open_count).
  // Chamado pelo bot ou manualmente via API.
  router.post('/profiles/:profileId/open', (req, res) => {
    try {
      const pid = parseInt(req.params.profileId);
      const existing = models.getIxProfile(pid);
      if (!existing) return res.status(404).json({ ok: false, error: 'Perfil não encontrado.' });

      models.incrementIxProfileOpenCount(pid);
      const updated = models.getIxProfile(pid);

      // Notifica o dashboard em tempo real
      io.emit('profiles:updated', { profiles: models.getAllIxProfiles() });

      return res.json({
        ok: true,
        message: `Abertura registrada para o perfil #${pid}.`,
        open_count: updated.open_count,
        last_opened_at: updated.last_opened_at,
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
      const { name, notes, device_type, browser_language } = req.body;

      const existing = models.getIxProfile(pid);
      if (!existing) return res.status(404).json({ ok: false, error: 'Perfil não encontrado.' });

      models.updateIxProfile(
        pid,
        name !== undefined ? name : existing.name,
        notes !== undefined ? notes : existing.notes,
        device_type !== undefined ? device_type : (existing.device_type || 'desktop'),
        browser_language !== undefined ? browser_language : (existing.browser_language || 'PT')
      );

      io.emit('profiles:updated', { profiles: models.getAllIxProfiles() });
      return res.json({ ok: true, message: 'Perfil atualizado.' });
    } catch (err) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  // ─── PUT /api/profiles/:profileId/loop-config ──────────────────────────────
  // Atualiza as configurações de repetição (loop) e gerais de um perfil.
  router.put('/profiles/:profileId/loop-config', (req, res) => {
    try {
      const pid = parseInt(req.params.profileId);
      const { loop_count, infinite_loop, clean_cache, random_fp } = req.body;

      const existing = models.getIxProfile(pid);
      if (!existing) return res.status(404).json({ ok: false, error: 'Perfil não encontrado.' });

      const lc = parseInt(loop_count);
      const inf = parseInt(infinite_loop);
      const cc = clean_cache !== undefined ? parseInt(clean_cache) : 0;
      const rf = random_fp !== undefined ? parseInt(random_fp) : 0;

      if (isNaN(lc) || lc < 1) {
        return res.status(400).json({ ok: false, error: 'loop_count deve ser um número inteiro maior ou igual a 1.' });
      }
      if (inf !== 0 && inf !== 1) {
        return res.status(400).json({ ok: false, error: 'infinite_loop deve ser 0 ou 1.' });
      }
      if (cc !== 0 && cc !== 1) {
        return res.status(400).json({ ok: false, error: 'clean_cache deve ser 0 ou 1.' });
      }
      if (rf !== 0 && rf !== 1) {
        return res.status(400).json({ ok: false, error: 'random_fp deve ser 0 ou 1.' });
      }

      models.updateIxProfileLoopConfig(pid, lc, inf, cc, rf);

      // Notifica o dashboard em tempo real
      io.emit('profiles:updated', { profiles: models.getAllIxProfiles() });
      return res.json({ ok: true, message: 'Configurações gerais do perfil atualizadas com sucesso.' });
    } catch (err) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  // ─── PUT /api/profiles/:profileId/click-config ─────────────────────────────
  // Atualiza as configurações de cliques de um perfil.
  router.put('/profiles/:profileId/click-config', (req, res) => {
    try {
      const pid = parseInt(req.params.profileId);
      const { click_enabled, click_count, click_min_delay, click_max_delay, human_click } = req.body;

      const existing = models.getIxProfile(pid);
      if (!existing) return res.status(404).json({ ok: false, error: 'Perfil não encontrado.' });

      const ce = parseInt(click_enabled);
      const cc = parseInt(click_count);
      const minDelay = click_min_delay !== undefined ? parseInt(click_min_delay) : 4;
      const maxDelay = click_max_delay !== undefined ? parseInt(click_max_delay) : 8;
      const hc = human_click !== undefined ? parseInt(human_click) : 0;

      if (ce !== 0 && ce !== 1) {
        return res.status(400).json({ ok: false, error: 'click_enabled deve ser 0 ou 1.' });
      }
      if (isNaN(cc) || cc < 0) {
        return res.status(400).json({ ok: false, error: 'click_count deve ser um número inteiro maior ou igual a 0.' });
      }
      if (isNaN(minDelay) || minDelay < 1) {
        return res.status(400).json({ ok: false, error: 'click_min_delay deve ser um número inteiro maior ou igual a 1.' });
      }
      if (isNaN(maxDelay) || maxDelay < 1 || maxDelay < minDelay) {
        return res.status(400).json({ ok: false, error: 'click_max_delay deve ser um número inteiro maior ou igual ao tempo mínimo.' });
      }
      if (hc !== 0 && hc !== 1) {
        return res.status(400).json({ ok: false, error: 'human_click deve ser 0 ou 1.' });
      }

      models.updateIxProfileClickConfig(pid, ce, cc, minDelay, maxDelay, hc);

      // Notifica o dashboard em tempo real
      io.emit('profiles:updated', { profiles: models.getAllIxProfiles() });
      return res.json({ ok: true, message: 'Configurações de cliques atualizadas com sucesso.' });
    } catch (err) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  // ─── PUT /api/profiles/:profileId/search-progress ──────────────────────────
  // Atualiza o índice da última palavra-chave processada.
  router.put('/profiles/:profileId/search-progress', (req, res) => {
    try {
      const pid = parseInt(req.params.profileId);
      const { lastKeywordIndex } = req.body;

      const existing = models.getIxProfile(pid);
      if (!existing) return res.status(404).json({ ok: false, error: 'Perfil não encontrado.' });

      const idx = parseInt(lastKeywordIndex);
      if (isNaN(idx) || idx < 0) {
        return res.status(400).json({ ok: false, error: 'lastKeywordIndex deve ser um número inteiro maior ou igual a 0.' });
      }

      models.updateIxProfileSearchProgress(pid, idx);

      // Notifica o dashboard em tempo real
      io.emit('profiles:updated', { profiles: models.getAllIxProfiles() });
      return res.json({ ok: true, message: 'Progresso de pesquisa atualizado com sucesso.' });
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

  // (Rota /api/profiles/all-assignments movida para o topo do router)

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

  // ─── GET /api/profile-module-links ─────────────────────────────────────────
  // Retorna todos os vínculos perfil→módulo
  router.get('/profile-module-links', (req, res) => {
    try {
      const links = models.getAllProfileModuleLinks();
      res.json({ ok: true, links });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // ─── PUT /api/profiles/:profileId/module ───────────────────────────────────
  // Define ou altera o módulo vinculado a um perfil
  router.put('/profiles/:profileId/module', (req, res) => {
    try {
      const profileId = Number(req.params.profileId);
      const { module_id } = req.body;

      if (!module_id) {
        // Remove o vínculo
        models.removeProfileModuleLink(profileId);
        return res.json({ ok: true, message: 'Vínculo de módulo removido.' });
      }

      models.setProfileModuleLink(profileId, Number(module_id));
      res.json({ ok: true, message: 'Módulo vinculado ao perfil.' });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // ─── DELETE /api/profiles/:profileId/module ────────────────────────────────
  // Remove o módulo vinculado a um perfil
  router.delete('/profiles/:profileId/module', (req, res) => {
    try {
      models.removeProfileModuleLink(Number(req.params.profileId));
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  return router;
}

module.exports = { createProfilesRouter };
