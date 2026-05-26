/**
 * src/db/ads-models.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Funções CRUD para o banco ads.db.
 * Gerencia sessões de pesquisa, anúncios detectados, cliques,
 * screenshots, whitelist e blacklist.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const { getAdsDB, nowBrasilia } = require('./ads-database');
const { getDB } = require('./database');

// ══════════════════════════════════════════════════════════════════════════════
// SEARCH SESSIONS
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Cria uma nova sessão de pesquisa.
 * @param {object} params
 * @returns {object} sessão criada com id
 */
function createSearchSession({ bot_id, profile_id, module_id, module_label, total_rounds, total_keywords }) {
  const now = nowBrasilia();
  const info = getAdsDB().prepare(`
    INSERT INTO search_sessions (bot_id, profile_id, module_id, module_label, total_rounds, total_keywords, started_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(bot_id, profile_id, module_id || null, module_label || null, total_rounds || 1, total_keywords || 0, now);
  return { id: info.lastInsertRowid, bot_id, profile_id, started_at: now };
}

/**
 * Atualiza progresso/status de uma sessão.
 */
function updateSearchSession(sessionId, updates) {
  const fields = [];
  const values = [];
  for (const [key, val] of Object.entries(updates)) {
    fields.push(`${key} = ?`);
    values.push(val);
  }
  if (fields.length === 0) return;
  values.push(sessionId);
  getAdsDB().prepare(`UPDATE search_sessions SET ${fields.join(', ')} WHERE id = ?`).run(...values);
}

/**
 * Finaliza uma sessão.
 */
function finishSearchSession(sessionId, status = 'completed') {
  const now = nowBrasilia();
  getAdsDB().prepare(`
    UPDATE search_sessions SET status = ?, finished_at = ? WHERE id = ?
  `).run(status, now, sessionId);
}

/**
 * Retorna todas as sessões, mais recentes primeiro.
 */
function getAllSearchSessions(limit = 50) {
  return getAdsDB().prepare(`
    SELECT * FROM search_sessions ORDER BY id DESC LIMIT ?
  `).all(limit);
}

/**
 * Retorna uma sessão por ID.
 */
function getSearchSessionById(sessionId) {
  return getAdsDB().prepare('SELECT * FROM search_sessions WHERE id = ?').get(sessionId);
}

// ══════════════════════════════════════════════════════════════════════════════
// SEARCH EXECUTIONS (cada keyword pesquisada)
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Registra uma pesquisa individual (1 keyword).
 */
function createSearchExecution({ session_id, keyword, search_method }) {
  const now = nowBrasilia();
  const info = getAdsDB().prepare(`
    INSERT INTO search_executions (session_id, keyword, search_method, searched_at)
    VALUES (?, ?, ?, ?)
  `).run(session_id, keyword, search_method || 'direct_url', now);
  return { id: info.lastInsertRowid, keyword, searched_at: now };
}

/**
 * Atualiza uma execução (status, ads_found, captcha, etc).
 */
function updateSearchExecution(executionId, updates) {
  const fields = [];
  const values = [];
  for (const [key, val] of Object.entries(updates)) {
    fields.push(`${key} = ?`);
    values.push(val);
  }
  if (fields.length === 0) return;
  values.push(executionId);
  getAdsDB().prepare(`UPDATE search_executions SET ${fields.join(', ')} WHERE id = ?`).run(...values);
}

/**
 * Finaliza uma execução.
 */
function finishSearchExecution(executionId, status, adsFound = 0, errorMessage = null) {
  const now = nowBrasilia();
  getAdsDB().prepare(`
    UPDATE search_executions
    SET status = ?, ads_found = ?, error_message = ?, completed_at = ?
    WHERE id = ?
  `).run(status, adsFound, errorMessage, now, executionId);
}

/**
 * Lista execuções de uma sessão.
 */
function getSessionExecutions(sessionId) {
  return getAdsDB().prepare(`
    SELECT * FROM search_executions WHERE session_id = ? ORDER BY id ASC
  `).all(sessionId);
}

// ══════════════════════════════════════════════════════════════════════════════
// SERP ADS (anúncios encontrados)
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Registra um anúncio encontrado na SERP.
 */
function createSerpAd({
  execution_id, session_id, keyword, position, slot_label, slot_index,
  href_raw, href_decoded, display_url, ad_title, ad_description,
  data_pcu, data_rw, data_ta_slot, data_ta_slot_pos,
  geo_country, geo_region, geo_city,
  is_whitelisted, is_blacklisted, whitelist_rule_id, blacklist_rule_id,
}) {
  const now = nowBrasilia();
  const is_suspicious = (ad_title && keyword && ad_title.toLowerCase().includes(keyword.toLowerCase())) ? 1 : 0;

  // Busca o registro mais antigo com o mesmo display_url para preencher a primeira vez que foi visto
  let first_found = now;
  if (display_url) {
    const prev = getAdsDB().prepare('SELECT MIN(found_at) AS first_seen FROM serp_ads WHERE display_url = ?').get(display_url);
    if (prev && prev.first_seen) {
      first_found = prev.first_seen;
    }
  }

  // Descobre o device_type e browser_language baseado no profile_id associado à sessão de pesquisa
  let device_type = 'desktop';
  let browser_language = 'PT';
  if (session_id) {
    try {
      const sess = getAdsDB().prepare('SELECT profile_id FROM search_sessions WHERE id = ?').get(session_id);
      if (sess && sess.profile_id) {
        const prof = getDB().prepare('SELECT device_type, browser_language FROM ix_profiles WHERE profile_id = ?').get(sess.profile_id);
        if (prof) {
          if (prof.device_type) device_type = prof.device_type;
          if (prof.browser_language) browser_language = prof.browser_language;
        }
      }
    } catch (err) {
      console.error('[createSerpAd] Erro ao buscar dados do perfil da sessão:', err.message);
    }
  }

  const info = getAdsDB().prepare(`
    INSERT INTO serp_ads (
      execution_id, session_id, keyword, position, slot_label, slot_index,
      href_raw, href_decoded, display_url, ad_title, ad_description,
      data_pcu, data_rw, data_ta_slot, data_ta_slot_pos,
      geo_country, geo_region, geo_city,
      is_whitelisted, is_blacklisted, whitelist_rule_id, blacklist_rule_id,
      is_suspicious,
      found_at, first_found_at, device_type, browser_language, all_titles
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    execution_id, session_id, keyword,
    position || 'unknown', slot_label || null, slot_index || null,
    href_raw || null, href_decoded || null, display_url || null,
    ad_title || null, ad_description || null,
    data_pcu || null, data_rw || null, data_ta_slot || null, data_ta_slot_pos || null,
    geo_country || null, geo_region || null, geo_city || null,
    is_whitelisted ? 1 : 0, is_blacklisted ? 1 : 0,
    whitelist_rule_id || null, blacklist_rule_id || null,
    is_suspicious,
    now,
    first_found,
    device_type,
    browser_language,
    ad_title || null
  );
  return { id: info.lastInsertRowid, keyword, position, found_at: now, is_suspicious };
}

/**
 * Busca anúncios por execução.
 */
function getAdsByExecution(executionId) {
  return getAdsDB().prepare(`
    SELECT * FROM serp_ads WHERE execution_id = ? ORDER BY slot_index ASC, id ASC
  `).all(executionId);
}

/**
 * Busca anúncios por keyword (histórico).
 */
function getAdsByKeyword(keyword, limit = 100) {
  return getAdsDB().prepare(`
    SELECT sa.*, se.searched_at AS search_date
    FROM serp_ads sa
    JOIN search_executions se ON se.id = sa.execution_id
    WHERE sa.keyword = ?
    ORDER BY sa.id DESC LIMIT ?
  `).all(keyword, limit);
}

/**
 * Busca anúncios por domínio no display_url.
 */
function getAdsByDomain(domain, limit = 100) {
  return getAdsDB().prepare(`
    SELECT * FROM serp_ads
    WHERE display_url LIKE ? OR href_decoded LIKE ?
    ORDER BY id DESC LIMIT ?
  `).all(`%${domain}%`, `%${domain}%`, limit);
}

/**
 * Retorna estatísticas gerais de anúncios.
 */
function getAdsStats() {
  const db = getAdsDB();

  // Contagens baseadas em anúncios únicos (agrupados por display_url)
  const totalAds = db.prepare(`
    SELECT COUNT(*) AS count FROM (
      SELECT 1 FROM serp_ads GROUP BY COALESCE(display_url, '')
    )
  `).get().count;

  const totalClicked = db.prepare(`
    SELECT COUNT(*) AS count FROM (
      SELECT 1 FROM serp_ads WHERE was_clicked = 1 GROUP BY COALESCE(display_url, '')
    )
  `).get().count;

  const totalWhitelisted = db.prepare(`
    SELECT COUNT(*) AS count FROM (
      SELECT 1 FROM serp_ads WHERE is_whitelisted = 1 GROUP BY COALESCE(display_url, '')
    )
  `).get().count;

  const totalBlacklisted = db.prepare(`
    SELECT COUNT(*) AS count FROM (
      SELECT 1 FROM serp_ads WHERE is_blacklisted = 1 GROUP BY COALESCE(display_url, '')
    )
  `).get().count;

  const totalSuspicious = db.prepare(`
    SELECT COUNT(*) AS count FROM (
      SELECT 1 FROM serp_ads WHERE is_suspicious = 1 AND is_blacklisted = 0 AND is_whitelisted = 0 GROUP BY COALESCE(display_url, '')
    )
  `).get().count;

  const totalSessions = db.prepare('SELECT COUNT(*) AS count FROM search_sessions').get().count;
  const totalSearches = db.prepare('SELECT COUNT(*) AS count FROM search_executions').get().count;
  const uniqueKeywords = db.prepare('SELECT COUNT(DISTINCT keyword) AS count FROM search_executions').get().count;
  const uniqueDomains = db.prepare('SELECT COUNT(DISTINCT display_url) AS count FROM serp_ads WHERE display_url IS NOT NULL').get().count;

  return {
    totalAds,
    totalClicked,
    totalWhitelisted,
    totalBlacklisted,
    totalSuspicious,
    totalSessions,
    totalSearches,
    uniqueKeywords,
    uniqueDomains,
  };
}

/**
 * Top anunciantes (domínios mais frequentes).
 */
function getTopAdvertisers(limit = 20) {
  return getAdsDB().prepare(`
    SELECT display_url, COUNT(*) AS appearances,
           SUM(was_clicked) AS times_clicked,
           SUM(is_blacklisted) AS times_blacklisted
    FROM serp_ads
    WHERE display_url IS NOT NULL AND display_url != ''
    GROUP BY display_url
    ORDER BY appearances DESC
    LIMIT ?
  `).all(limit);
}

// ══════════════════════════════════════════════════════════════════════════════
// AD CLICKS
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Registra um clique em anúncio.
 */
function createAdClick({ ad_id, execution_id, click_type, strategy_used, tab_opened, landing_url, success, error_message, duration_ms }) {
  const now = nowBrasilia();
  const info = getAdsDB().prepare(`
    INSERT INTO ad_clicks (ad_id, execution_id, click_type, strategy_used, tab_opened, landing_url, success, error_message, duration_ms, clicked_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(ad_id, execution_id, click_type || 'ctrl_click', strategy_used || null, tab_opened ? 1 : 0, landing_url || null, success ? 1 : 0, error_message || null, duration_ms || null, now);

  // Atualiza contagem no anúncio
  if (success) {
    getAdsDB().prepare('UPDATE serp_ads SET was_clicked = 1, click_count = click_count + 1 WHERE id = ?').run(ad_id);
  }

  return { id: info.lastInsertRowid, clicked_at: now };
}

/**
 * Lista cliques de um anúncio.
 */
function getClicksByAd(adId) {
  return getAdsDB().prepare('SELECT * FROM ad_clicks WHERE ad_id = ? ORDER BY id ASC').all(adId);
}

// ══════════════════════════════════════════════════════════════════════════════
// AD SCREENSHOTS
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Registra um screenshot capturado.
 */
function createAdScreenshot({ execution_id, ad_id, area_label, file_path, file_size_bytes, width, height }) {
  const now = nowBrasilia();
  const info = getAdsDB().prepare(`
    INSERT INTO ad_screenshots (execution_id, ad_id, area_label, file_path, file_size_bytes, width, height, captured_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(execution_id || null, ad_id || null, area_label, file_path, file_size_bytes || 0, width || null, height || null, now);
  return { id: info.lastInsertRowid, captured_at: now };
}

// ══════════════════════════════════════════════════════════════════════════════
// WHITELIST RULES (ignorar anúncios)
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Cria uma regra de whitelist.
 */
function createWhitelistRule({ pattern, match_type, description }) {
  const now = nowBrasilia();
  const info = getAdsDB().prepare(`
    INSERT INTO whitelist_rules (pattern, match_type, description, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(pattern, match_type || 'substring', description || null, now, now);
  return { id: info.lastInsertRowid, pattern, created_at: now };
}

/**
 * Atualiza uma regra de whitelist.
 */
function updateWhitelistRule(ruleId, { pattern, match_type, description, is_active }) {
  const now = nowBrasilia();
  const fields = ['updated_at = ?'];
  const values = [now];

  if (pattern !== undefined) { fields.push('pattern = ?'); values.push(pattern); }
  if (match_type !== undefined) { fields.push('match_type = ?'); values.push(match_type); }
  if (description !== undefined) { fields.push('description = ?'); values.push(description); }
  if (is_active !== undefined) { fields.push('is_active = ?'); values.push(is_active ? 1 : 0); }

  values.push(ruleId);
  getAdsDB().prepare(`UPDATE whitelist_rules SET ${fields.join(', ')} WHERE id = ?`).run(...values);
}

/**
 * Exclui uma regra de whitelist.
 */
function deleteWhitelistRule(ruleId) {
  getAdsDB().prepare('DELETE FROM whitelist_rules WHERE id = ?').run(ruleId);
}

/**
 * Lista todas as regras de whitelist.
 */
function getAllWhitelistRules() {
  return getAdsDB().prepare('SELECT * FROM whitelist_rules ORDER BY id ASC').all();
}

/**
 * Retorna regras ativas de whitelist (para uso no bot).
 */
function getActiveWhitelistRules() {
  return getAdsDB().prepare('SELECT * FROM whitelist_rules WHERE is_active = 1 ORDER BY id ASC').all();
}

/**
 * Incrementa contador de hits de uma regra.
 */
function incrementWhitelistHits(ruleId) {
  getAdsDB().prepare('UPDATE whitelist_rules SET hits = hits + 1 WHERE id = ?').run(ruleId);
}

// ══════════════════════════════════════════════════════════════════════════════
// BLACKLIST RULES (marcar/alertar anúncios — NOVO!)
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Cria uma regra de blacklist.
 */
function createBlacklistRule({ pattern, match_type, description, priority, action }) {
  const now = nowBrasilia();
  const info = getAdsDB().prepare(`
    INSERT INTO blacklist_rules (pattern, match_type, description, priority, action, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(pattern, match_type || 'substring', description || null, priority || 0, action || 'flag', now, now);
  return { id: info.lastInsertRowid, pattern, created_at: now };
}

/**
 * Atualiza uma regra de blacklist.
 */
function updateBlacklistRule(ruleId, { pattern, match_type, description, is_active, priority, action }) {
  const now = nowBrasilia();
  const fields = ['updated_at = ?'];
  const values = [now];

  if (pattern !== undefined) { fields.push('pattern = ?'); values.push(pattern); }
  if (match_type !== undefined) { fields.push('match_type = ?'); values.push(match_type); }
  if (description !== undefined) { fields.push('description = ?'); values.push(description); }
  if (is_active !== undefined) { fields.push('is_active = ?'); values.push(is_active ? 1 : 0); }
  if (priority !== undefined) { fields.push('priority = ?'); values.push(priority); }
  if (action !== undefined) { fields.push('action = ?'); values.push(action); }

  values.push(ruleId);
  getAdsDB().prepare(`UPDATE blacklist_rules SET ${fields.join(', ')} WHERE id = ?`).run(...values);
}

/**
 * Exclui uma regra de blacklist.
 */
function deleteBlacklistRule(ruleId) {
  getAdsDB().prepare('DELETE FROM blacklist_rules WHERE id = ?').run(ruleId);
}

/**
 * Lista todas as regras de blacklist.
 */
function getAllBlacklistRules() {
  return getAdsDB().prepare('SELECT * FROM blacklist_rules ORDER BY priority DESC, id ASC').all();
}

/**
 * Retorna regras ativas de blacklist (para uso no bot).
 */
function getActiveBlacklistRules() {
  return getAdsDB().prepare('SELECT * FROM blacklist_rules WHERE is_active = 1 ORDER BY priority DESC, id ASC').all();
}

/**
 * Incrementa contador de hits de uma regra.
 */
function incrementBlacklistHits(ruleId) {
  getAdsDB().prepare('UPDATE blacklist_rules SET hits = hits + 1 WHERE id = ?').run(ruleId);
}

// ══════════════════════════════════════════════════════════════════════════════
// MATCHING — testa texto contra regras ativas
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Testa se um texto (haystack) bate com alguma regra.
 * Retorna a primeira regra que deu match ou null.
 * @param {string} haystack - texto a testar (URL, título, etc)
 * @param {Array} rules - regras ativas
 * @returns {object|null} regra que bateu ou null
 */
function matchAgainstRules(haystack, rules) {
  if (!haystack || !rules || rules.length === 0) return null;
  const lower = haystack.toLowerCase();

  for (const rule of rules) {
    const pattern = (rule.pattern || '').toLowerCase();
    if (!pattern) continue;

    let matched = false;
    switch (rule.match_type) {
      case 'exact':
        matched = lower === pattern;
        break;
      case 'domain':
        matched = lower.includes(pattern) && (
          lower.includes(`://${pattern}`) ||
          lower.includes(`.${pattern}`) ||
          lower.startsWith(pattern)
        );
        break;
      case 'regex':
        try {
          matched = new RegExp(rule.pattern, 'i').test(haystack);
        } catch (_) {
          matched = false;
        }
        break;
      case 'substring':
      default:
        matched = lower.includes(pattern);
        break;
    }

    if (matched) return rule;
  }
  return null;
}

/**
 * Monta o "haystack" de um anúncio para testar contra regras.
 * Agrega: href_raw, href_decoded, display_url, ad_title, data_pcu
 */
function buildAdHaystack({ href_raw, href_decoded, display_url, ad_title, ad_description, data_pcu }) {
  return [href_raw, href_decoded, display_url, ad_title, ad_description, data_pcu]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

// ══════════════════════════════════════════════════════════════════════════════
// ALL ADS — Listagem geral para o dashboard
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Lista todos os anúncios com paginação.
 * @param {number} limit
 * @param {number} offset
 * @param {string} keyword - filtro opcional por keyword
 * @param {string} domain - filtro opcional por domínio
 * @returns {{ads: Array, total: number}}
 */
function getAllAds({ limit = 50, offset = 0, keyword, domain, is_blacklisted, is_whitelisted, is_suspicious, orderBy = 'recent' } = {}) {
  const db = getAdsDB();
  let where = [];
  let params = [];

  if (keyword) {
    where.push('keyword LIKE ?');
    params.push(`%${keyword}%`);
  }
  if (domain) {
    where.push('(display_url LIKE ? OR href_decoded LIKE ?)');
    params.push(`%${domain}%`, `%${domain}%`);
  }
  if (is_blacklisted !== undefined) {
    where.push('is_blacklisted = ?');
    params.push(is_blacklisted ? 1 : 0);
  }
  if (is_whitelisted !== undefined) {
    where.push('is_whitelisted = ?');
    params.push(is_whitelisted ? 1 : 0);
  }
  if (is_suspicious !== undefined) {
    where.push('is_suspicious = ?');
    params.push(is_suspicious ? 1 : 0);
  }

  const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

  // Agrupa por display_url para eliminar duplicatas
  const total = db.prepare(`
    SELECT COUNT(*) AS count FROM (
      SELECT 1 FROM serp_ads ${whereClause}
      GROUP BY COALESCE(display_url, '')
    )
  `).get(...params).count;

  const orderClause = orderBy === 'repetitions' ? 'repetitions DESC, MAX(id) DESC' : 'MAX(id) DESC';

  const ads = db.prepare(`
    SELECT
      MAX(id) AS id,
      COUNT(*) AS repetitions,
      GROUP_CONCAT(DISTINCT keyword) AS keywords,
      keyword,
      position,
      slot_label,
      href_raw,
      href_decoded,
      display_url,
      ad_title,
      ad_description,
      data_pcu,
      data_rw,
      geo_country,
      geo_region,
      geo_city,
      MAX(is_whitelisted) AS is_whitelisted,
      MAX(is_blacklisted) AS is_blacklisted,
      MAX(is_suspicious) AS is_suspicious,
      MAX(was_clicked) AS was_clicked,
      SUM(click_count) AS click_count,
      MIN(COALESCE(first_found_at, found_at)) AS first_found_at,
      MAX(found_at) AS found_at,
      MAX(device_type) AS device_type,
      MAX(browser_language) AS browser_language,
      GROUP_CONCAT(id) AS all_ids,
      GROUP_CONCAT(CASE WHEN ad_description IS NOT NULL AND ad_description != '' THEN ad_title || ' ::: ' || ad_description ELSE ad_title END, ' ||| ') AS all_titles
    FROM serp_ads ${whereClause}
    GROUP BY COALESCE(display_url, '')
    ORDER BY ${orderClause}
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset);

  return { ads, total };
}

/**
 * Exclui um anúncio pelo ID.
 */
function deleteAd(adId) {
  getAdsDB().prepare('DELETE FROM serp_ads WHERE id = ?').run(adId);
}

/**
 * Exclui todos os anúncios.
 */
function deleteAllAds() {
  getAdsDB().prepare('DELETE FROM serp_ads').run();
}

// ══════════════════════════════════════════════════════════════════════════════
// EXPORTS
// ══════════════════════════════════════════════════════════════════════════════

module.exports = {
  // Search sessions
  createSearchSession,
  updateSearchSession,
  finishSearchSession,
  getAllSearchSessions,
  getSearchSessionById,
  // Search executions
  createSearchExecution,
  updateSearchExecution,
  finishSearchExecution,
  getSessionExecutions,
  // Serp ads
  createSerpAd,
  getAdsByExecution,
  getAdsByKeyword,
  getAdsByDomain,
  getAdsStats,
  getTopAdvertisers,
  // Ad clicks
  createAdClick,
  getClicksByAd,
  // Ad screenshots
  createAdScreenshot,
  // Whitelist
  createWhitelistRule,
  updateWhitelistRule,
  deleteWhitelistRule,
  getAllWhitelistRules,
  getActiveWhitelistRules,
  incrementWhitelistHits,
  // Blacklist
  createBlacklistRule,
  updateBlacklistRule,
  deleteBlacklistRule,
  getAllBlacklistRules,
  getActiveBlacklistRules,
  incrementBlacklistHits,
  // Matching
  matchAgainstRules,
  buildAdHaystack,
  // All ads
  getAllAds,
  deleteAd,
  deleteAllAds,
  // DB access (for bulk operations)
  getAdsDB,
};
