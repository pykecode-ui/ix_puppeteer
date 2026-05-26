/**
 * src/api/ads-router.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Rotas REST para o módulo de Ads.
 * Gerencia whitelist, blacklist, sessões, anúncios e estatísticas.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const { Router } = require('express');
const adsModels = require('../db/ads-models');

function createAdsRouter(io) {
  const router = Router();

  // ═══════════════════════════════════════════════════════════════════════════
  // STATS — Estatísticas gerais
  // ═══════════════════════════════════════════════════════════════════════════

  router.get('/ads/stats', (req, res) => {
    try {
      const stats = adsModels.getAdsStats();
      const whitelistCount = adsModels.getAllWhitelistRules().length;
      const blacklistCount = adsModels.getAllBlacklistRules().length;
      res.json({ ok: true, stats: { ...stats, whitelistCount, blacklistCount } });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // TOP ADVERTISERS
  // ═══════════════════════════════════════════════════════════════════════════

  router.get('/ads/top-advertisers', (req, res) => {
    try {
      const limit = parseInt(req.query.limit) || 20;
      const advertisers = adsModels.getTopAdvertisers(limit);
      res.json({ ok: true, advertisers });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // SESSIONS — Sessões de pesquisa
  // ═══════════════════════════════════════════════════════════════════════════

  router.get('/ads/sessions', (req, res) => {
    try {
      const limit = parseInt(req.query.limit) || 50;
      const sessions = adsModels.getAllSearchSessions(limit);
      res.json({ ok: true, sessions });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  router.get('/ads/sessions/:id', (req, res) => {
    try {
      const session = adsModels.getSearchSessionById(Number(req.params.id));
      if (!session) return res.status(404).json({ ok: false, error: 'Sessão não encontrada.' });

      const executions = adsModels.getSessionExecutions(session.id);
      res.json({ ok: true, session, executions });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // Criar sessão (chamado pelo bot)
  router.post('/ads/sessions', (req, res) => {
    try {
      const session = adsModels.createSearchSession(req.body);
      res.json({ ok: true, session });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // Atualizar sessão
  router.put('/ads/sessions/:id', (req, res) => {
    try {
      adsModels.updateSearchSession(Number(req.params.id), req.body);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // Finalizar sessão
  router.post('/ads/sessions/:id/finish', (req, res) => {
    try {
      adsModels.finishSearchSession(Number(req.params.id), req.body.status || 'completed');
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // EXECUTIONS — Registro de pesquisas individuais (bot → dashboard)
  // ═══════════════════════════════════════════════════════════════════════════

  // Criar execução
  router.post('/ads/executions', (req, res) => {
    try {
      const execution = adsModels.createSearchExecution(req.body);
      res.json({ ok: true, execution });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // Finalizar execução
  router.post('/ads/executions/:id/finish', (req, res) => {
    try {
      const { status, adsFound, errorMessage } = req.body;
      adsModels.finishSearchExecution(Number(req.params.id), status, adsFound || 0, errorMessage || null);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // RECORD AD — Registrar anúncio encontrado pelo bot
  // ═══════════════════════════════════════════════════════════════════════════

  router.post('/ads/record-ad', (req, res) => {
    try {
      const ad = adsModels.createSerpAd({
        execution_id: req.body.execution_id || 0,
        session_id: req.body.session_id || 0,
        keyword: req.body.keyword,
        position: req.body.position,
        slot_label: req.body.slotLabel || req.body.slot_label,
        slot_index: req.body.slotIndex || req.body.slot_index,
        href_raw: req.body.hrefRaw || req.body.href_raw,
        href_decoded: req.body.hrefDecoded || req.body.href_decoded,
        display_url: req.body.displayUrl || req.body.display_url,
        ad_title: req.body.adTitle || req.body.ad_title,
        ad_description: req.body.adDescription || req.body.ad_description,
        data_pcu: req.body.dataPcu || req.body.data_pcu,
        data_rw: req.body.dataRw || req.body.data_rw,
        data_ta_slot: req.body.dataTaSlot || req.body.data_ta_slot,
        data_ta_slot_pos: req.body.dataTaSlotPos || req.body.data_ta_slot_pos,
        geo_country: req.body.geo_country,
        geo_region: req.body.geo_region,
        geo_city: req.body.geo_city,
        is_whitelisted: req.body.isWhitelisted || req.body.is_whitelisted || false,
        is_blacklisted: req.body.isBlacklisted || req.body.is_blacklisted || false,
        whitelist_rule_id: req.body.whitelistRuleId || req.body.whitelist_rule_id,
        blacklist_rule_id: req.body.blacklistRuleId || req.body.blacklist_rule_id,
      });
      if (io) io.emit('ads:new-ad', ad);
      res.json({ ok: true, ad });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // ALL ADS — Listagem geral para o dashboard (#anuncios)
  // ═══════════════════════════════════════════════════════════════════════════

  // Listar todos com paginação e filtros
  router.get('/ads/all', (req, res) => {
    try {
      const limit = parseInt(req.query.limit) || 50;
      const offset = parseInt(req.query.offset) || 0;
      const keyword = req.query.keyword || undefined;
      const domain = req.query.domain || undefined;
      const is_blacklisted = req.query.is_blacklisted !== undefined
        ? req.query.is_blacklisted === 'true' || req.query.is_blacklisted === '1'
        : undefined;
      const is_whitelisted = req.query.is_whitelisted !== undefined
        ? req.query.is_whitelisted === 'true' || req.query.is_whitelisted === '1'
        : undefined;
      const is_suspicious = req.query.is_suspicious !== undefined
        ? req.query.is_suspicious === 'true' || req.query.is_suspicious === '1'
        : undefined;
      const orderBy = req.query.orderBy || 'recent';

      const result = adsModels.getAllAds({ limit, offset, keyword, domain, is_blacklisted, is_whitelisted, is_suspicious, orderBy });
      res.json({ ok: true, ...result });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // Limpar todos os anúncios (DEVE vir antes de /ads/:id)
  router.delete('/ads/clear-all', (req, res) => {
    try {
      adsModels.deleteAllAds();
      if (io) io.emit('ads:updated');
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // Excluir um anúncio
  router.delete('/ads/:id', (req, res) => {
    try {
      adsModels.deleteAd(Number(req.params.id));
      if (io) io.emit('ads:updated');
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });


  // ═══════════════════════════════════════════════════════════════════════════
  // ADS — Anúncios encontrados
  // ═══════════════════════════════════════════════════════════════════════════

  router.get('/ads/by-execution/:executionId', (req, res) => {
    try {
      const ads = adsModels.getAdsByExecution(Number(req.params.executionId));
      res.json({ ok: true, ads });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  router.get('/ads/by-keyword/:keyword', (req, res) => {
    try {
      const limit = parseInt(req.query.limit) || 100;
      const ads = adsModels.getAdsByKeyword(req.params.keyword, limit);
      res.json({ ok: true, ads });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  router.get('/ads/by-domain/:domain', (req, res) => {
    try {
      const limit = parseInt(req.query.limit) || 100;
      const ads = adsModels.getAdsByDomain(req.params.domain, limit);
      res.json({ ok: true, ads });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // WHITELIST — Regras para ignorar anúncios
  // ═══════════════════════════════════════════════════════════════════════════

  // Listar todas
  router.get('/ads/whitelist', (req, res) => {
    try {
      const rules = adsModels.getAllWhitelistRules();
      res.json({ ok: true, rules });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // Criar
  router.post('/ads/whitelist', (req, res) => {
    try {
      const { pattern, match_type, description } = req.body;
      if (!pattern || !pattern.trim()) {
        return res.status(400).json({ ok: false, error: 'O campo "pattern" é obrigatório.' });
      }
      const trimmed = pattern.trim();
      const db = adsModels.getAdsDB();

      // 1. Verifica se já existe uma regra para este padrão
      const existing = db.prepare('SELECT id FROM whitelist_rules WHERE LOWER(pattern) = LOWER(?)').get(trimmed);
      if (existing) {
        return res.json({ ok: true, alreadyExists: true, message: 'Este domínio já está na Safelist.' });
      }

      // 2. Cria a nova regra
      const rule = adsModels.createWhitelistRule({ pattern: trimmed, match_type, description });

      // 3. Aplica a nova regra imediatamente a todos os anúncios correspondentes
      const like = `%${trimmed}%`;
      db.prepare(`
        UPDATE serp_ads
        SET is_whitelisted = 1, whitelist_rule_id = ?
        WHERE (LOWER(display_url) LIKE LOWER(?) OR LOWER(data_pcu) LIKE LOWER(?) OR LOWER(href_decoded) LIKE LOWER(?))
          AND is_whitelisted = 0
      `).run(rule.id, like, like, like);

      if (io) {
        io.emit('ads:whitelist:updated');
        io.emit('ads:updated');
      }
      res.json({ ok: true, rule });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // Atualizar
  router.put('/ads/whitelist/:id', (req, res) => {
    try {
      adsModels.updateWhitelistRule(Number(req.params.id), req.body);
      if (io) io.emit('ads:whitelist:updated');
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // Excluir
  router.delete('/ads/whitelist/:id', (req, res) => {
    try {
      adsModels.deleteWhitelistRule(Number(req.params.id));
      if (io) io.emit('ads:whitelist:updated');
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // BLACKLIST — Regras para marcar/alertar anúncios
  // ═══════════════════════════════════════════════════════════════════════════

  // Listar todas
  router.get('/ads/blacklist', (req, res) => {
    try {
      const rules = adsModels.getAllBlacklistRules();
      res.json({ ok: true, rules });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // Criar
  router.post('/ads/blacklist', (req, res) => {
    try {
      const { pattern, match_type, description, priority, action } = req.body;
      if (!pattern || !pattern.trim()) {
        return res.status(400).json({ ok: false, error: 'O campo "pattern" é obrigatório.' });
      }
      const trimmed = pattern.trim();
      const db = adsModels.getAdsDB();

      // 1. Verifica se já existe uma regra para este padrão
      const existing = db.prepare('SELECT id FROM blacklist_rules WHERE LOWER(pattern) = LOWER(?)').get(trimmed);
      if (existing) {
        return res.json({ ok: true, alreadyExists: true, message: 'Este domínio já está na Blacklist.' });
      }

      // 2. Cria a nova regra
      const rule = adsModels.createBlacklistRule({
        pattern: trimmed, match_type, description, priority, action,
      });

      // 3. Aplica a nova regra imediatamente a todos os anúncios correspondentes
      const like = `%${trimmed}%`;
      db.prepare(`
        UPDATE serp_ads
        SET is_blacklisted = 1, blacklist_rule_id = ?
        WHERE (LOWER(display_url) LIKE LOWER(?) OR LOWER(data_pcu) LIKE LOWER(?) OR LOWER(href_decoded) LIKE LOWER(?))
          AND is_blacklisted = 0
      `).run(rule.id, like, like, like);

      if (io) {
        io.emit('ads:blacklist:updated');
        io.emit('ads:updated');
      }
      res.json({ ok: true, rule });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // Atualizar
  router.put('/ads/blacklist/:id', (req, res) => {
    try {
      adsModels.updateBlacklistRule(Number(req.params.id), req.body);
      if (io) io.emit('ads:blacklist:updated');
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // Excluir
  router.delete('/ads/blacklist/:id', (req, res) => {
    try {
      adsModels.deleteBlacklistRule(Number(req.params.id));
      if (io) io.emit('ads:blacklist:updated');
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // BLACKLIST — Sincronização em lote (textarea do modal)
  // ═══════════════════════════════════════════════════════════════════════════

  router.post('/ads/blacklist/bulk-sync', (req, res) => {
    try {
      const { patterns } = req.body; // array de strings
      if (!Array.isArray(patterns)) {
        return res.status(400).json({ ok: false, error: 'patterns deve ser um array.' });
      }

      const db = adsModels.getAdsDB();

      // 1. Remove todas as regras atuais
      db.prepare('DELETE FROM blacklist_rules').run();

      // 2. Insere as novas
      const now = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
      const insert = db.prepare(`
        INSERT INTO blacklist_rules (pattern, match_type, description, priority, action, created_at, updated_at)
        VALUES (?, 'substring', 'Blacklist (modal)', 0, 'flag', ?, ?)
      `);
      const insertMany = db.transaction((items) => {
        for (const p of items) insert.run(p, now, now);
      });
      const cleanPatterns = patterns.map(p => p.trim()).filter(Boolean);
      insertMany(cleanPatterns);

      // 3. Re-aplica blacklist em todos os anúncios existentes
      //    Primeiro limpa todas as flags de blacklist
      db.prepare('UPDATE serp_ads SET is_blacklisted = 0, blacklist_rule_id = NULL').run();

      //    Depois marca os que contêm algum pattern no display_url ou data_pcu
      const rules = db.prepare('SELECT id, pattern FROM blacklist_rules WHERE is_active = 1').all();
      for (const rule of rules) {
        const like = `%${rule.pattern}%`;
        db.prepare(`
          UPDATE serp_ads
          SET is_blacklisted = 1, blacklist_rule_id = ?
          WHERE (LOWER(display_url) LIKE LOWER(?) OR LOWER(data_pcu) LIKE LOWER(?) OR LOWER(href_decoded) LIKE LOWER(?))
            AND is_blacklisted = 0
        `).run(rule.id, like, like, like);
      }

      if (io) io.emit('ads:blacklist:updated');
      res.json({ ok: true, count: cleanPatterns.length });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // WHITELIST / SAFELIST — Sincronização em lote (textarea do modal)
  // ═══════════════════════════════════════════════════════════════════════════

  router.post('/ads/whitelist/bulk-sync', (req, res) => {
    try {
      const { patterns } = req.body; // array de strings
      if (!Array.isArray(patterns)) {
        return res.status(400).json({ ok: false, error: 'patterns deve ser um array.' });
      }

      const db = adsModels.getAdsDB();

      // 1. Remove todas as regras de whitelist atuais
      db.prepare('DELETE FROM whitelist_rules').run();

      // 2. Insere as novas regras
      const now = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
      const insert = db.prepare(`
        INSERT INTO whitelist_rules (pattern, match_type, description, created_at, updated_at)
        VALUES (?, 'substring', 'Whitelist (modal)', ?, ?)
      `);
      const insertMany = db.transaction((items) => {
        for (const p of items) insert.run(p, now, now);
      });
      const cleanPatterns = patterns.map(p => p.trim()).filter(Boolean);
      insertMany(cleanPatterns);

      // 3. Re-aplica whitelist em todos os anúncios existentes
      //    Primeiro limpa todas as flags de whitelist
      db.prepare('UPDATE serp_ads SET is_whitelisted = 0, whitelist_rule_id = NULL').run();

      //    Depois marca os que contêm algum pattern no display_url, data_pcu ou href_decoded
      const rules = db.prepare('SELECT id, pattern FROM whitelist_rules WHERE is_active = 1').all();
      for (const rule of rules) {
        const like = `%${rule.pattern}%`;
        db.prepare(`
          UPDATE serp_ads
          SET is_whitelisted = 1, whitelist_rule_id = ?
          WHERE (LOWER(display_url) LIKE LOWER(?) OR LOWER(data_pcu) LIKE LOWER(?) OR LOWER(href_decoded) LIKE LOWER(?))
            AND is_whitelisted = 0
        `).run(rule.id, like, like, like);
      }

      if (io) io.emit('ads:whitelist:updated');
      res.json({ ok: true, count: cleanPatterns.length });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  return router;
}

module.exports = { createAdsRouter };
