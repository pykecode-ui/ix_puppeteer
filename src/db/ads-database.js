/**
 * src/db/ads-database.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Banco de dados separado para o módulo de Ads (anúncios Google SERP).
 * Arquivo: ads.db — isolado do config.db para manter separação de contextos.
 *
 * Tabelas:
 *  - search_sessions     → Sessões de pesquisa (rodadas do bot)
 *  - search_executions   → Cada pesquisa individual (1 keyword = 1 execução)
 *  - serp_ads            → Anúncios encontrados na SERP
 *  - ad_clicks           → Registro de cliques em anúncios
 *  - ad_screenshots      → Screenshots capturados (path do arquivo)
 *  - whitelist_rules     → Regras para IGNORAR anúncios (como no Python)
 *  - blacklist_rules     → Regras para MARCAR/ALERTAR anúncios (novo!)
 * ─────────────────────────────────────────────────────────────────────────────
 */

const Database = require('better-sqlite3');
const path = require('path');

// Caminho do arquivo do banco de ads na raiz do projeto
const ADS_DB_PATH = path.join(__dirname, '../../ads.db');

// Instância única (singleton)
let adsDb = null;

/**
 * Retorna o timestamp atual no fuso horário de Brasília (UTC-3).
 * @returns {string} "DD/MM/AAAA HH:MM:SS"
 */
function nowBrasilia() {
  return new Date().toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

/**
 * Inicializa o banco ads.db com todas as tabelas.
 * @returns {Database} Instância do better-sqlite3
 */
function initAdsDB() {
  if (adsDb) return adsDb;

  adsDb = new Database(ADS_DB_PATH);
  adsDb.pragma('journal_mode = WAL');
  adsDb.pragma('foreign_keys = ON');

  // ═══════════════════════════════════════════════════════════════════════════
  // TABELA: search_sessions
  // Uma sessão = uma execução completa do bot (pode ter N rodadas × M keywords)
  // ═══════════════════════════════════════════════════════════════════════════
  adsDb.exec(`
    CREATE TABLE IF NOT EXISTS search_sessions (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      bot_id          TEXT    NOT NULL,
      profile_id      INTEGER NOT NULL,
      module_id       INTEGER,
      module_label    TEXT,
      round_number    INTEGER NOT NULL DEFAULT 1,
      total_rounds    INTEGER NOT NULL DEFAULT 1,
      total_keywords  INTEGER NOT NULL DEFAULT 0,
      keywords_done   INTEGER NOT NULL DEFAULT 0,
      ads_found_total INTEGER NOT NULL DEFAULT 0,
      status          TEXT    NOT NULL DEFAULT 'running',
      started_at      TEXT    NOT NULL,
      finished_at     TEXT
    )
  `);
  // status: 'running' | 'completed' | 'error' | 'cancelled'

  // ═══════════════════════════════════════════════════════════════════════════
  // TABELA: search_executions
  // Cada pesquisa individual: 1 keyword na SERP
  // ═══════════════════════════════════════════════════════════════════════════
  adsDb.exec(`
    CREATE TABLE IF NOT EXISTS search_executions (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id      INTEGER NOT NULL,
      keyword         TEXT    NOT NULL,
      serp_url        TEXT,
      search_method   TEXT    NOT NULL DEFAULT 'direct_url',
      had_captcha     INTEGER NOT NULL DEFAULT 0,
      captcha_solved  INTEGER NOT NULL DEFAULT 0,
      cookies_accepted INTEGER NOT NULL DEFAULT 0,
      ads_found       INTEGER NOT NULL DEFAULT 0,
      ads_clicked     INTEGER NOT NULL DEFAULT 0,
      status          TEXT    NOT NULL DEFAULT 'pending',
      error_message   TEXT,
      duration_ms     INTEGER,
      searched_at     TEXT    NOT NULL,
      completed_at    TEXT,
      FOREIGN KEY (session_id) REFERENCES search_sessions(id) ON DELETE CASCADE
    )
  `);
  // search_method: 'direct_url' | 'homepage_form'
  // status: 'pending' | 'searching' | 'completed' | 'error' | 'captcha_blocked'

  // ═══════════════════════════════════════════════════════════════════════════
  // TABELA: serp_ads
  // Cada anúncio encontrado na SERP do Google
  // ═══════════════════════════════════════════════════════════════════════════
  adsDb.exec(`
    CREATE TABLE IF NOT EXISTS serp_ads (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      execution_id      INTEGER,
      session_id        INTEGER,
      keyword           TEXT    NOT NULL,
      position          TEXT    NOT NULL DEFAULT 'unknown',
      slot_label        TEXT,
      slot_index        INTEGER,
      href_raw          TEXT,
      href_decoded      TEXT,
      display_url       TEXT,
      ad_title          TEXT,
      ad_description    TEXT,
      data_pcu          TEXT,
      data_rw           TEXT,
      data_ta_slot      TEXT,
      data_ta_slot_pos  TEXT,
      geo_country       TEXT,
      geo_region        TEXT,
      geo_city          TEXT,
      is_whitelisted    INTEGER NOT NULL DEFAULT 0,
      is_blacklisted    INTEGER NOT NULL DEFAULT 0,
      whitelist_rule_id INTEGER,
      blacklist_rule_id INTEGER,
      was_clicked       INTEGER NOT NULL DEFAULT 0,
      click_count       INTEGER NOT NULL DEFAULT 0,
      found_at          TEXT    NOT NULL,
      FOREIGN KEY (whitelist_rule_id) REFERENCES whitelist_rules(id) ON DELETE SET NULL,
      FOREIGN KEY (blacklist_rule_id) REFERENCES blacklist_rules(id) ON DELETE SET NULL
    )
  `);

  // Migration: adiciona data_rw se não existir (para DBs criados antes)
  try {
    adsDb.exec(`ALTER TABLE serp_ads ADD COLUMN data_rw TEXT`);
  } catch (_) { /* coluna já existe */ }

  // Migration: geolocalização do IP nos anúncios
  try { adsDb.exec(`ALTER TABLE serp_ads ADD COLUMN geo_country TEXT`); } catch (_) {}
  try { adsDb.exec(`ALTER TABLE serp_ads ADD COLUMN geo_region TEXT`); } catch (_) {}
  try { adsDb.exec(`ALTER TABLE serp_ads ADD COLUMN geo_city TEXT`); } catch (_) {}

  // position: 'top' | 'bottom' | 'middle' | 'shopping' | 'unknown'

  // ═══════════════════════════════════════════════════════════════════════════
  // TABELA: ad_clicks
  // Registro de cada clique em um anúncio
  // ═══════════════════════════════════════════════════════════════════════════
  adsDb.exec(`
    CREATE TABLE IF NOT EXISTS ad_clicks (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      ad_id           INTEGER NOT NULL,
      execution_id    INTEGER,
      click_type      TEXT    NOT NULL DEFAULT 'ctrl_click',
      strategy_used   TEXT,
      tab_opened      INTEGER NOT NULL DEFAULT 0,
      landing_url     TEXT,
      success         INTEGER NOT NULL DEFAULT 0,
      error_message   TEXT,
      duration_ms     INTEGER,
      clicked_at      TEXT    NOT NULL,
      FOREIGN KEY (ad_id) REFERENCES serp_ads(id) ON DELETE CASCADE
    )
  `);
  // click_type: 'ctrl_click' | 'middle_click' | 'direct_click' | 'programmatic'
  // strategy_used: 'dispatch_event' | 'keyboard_modifier' | 'playwright_modifier' |
  //               'target_blank' | 'new_page_goto'

  // ═══════════════════════════════════════════════════════════════════════════
  // TABELA: ad_screenshots
  // Screenshots capturados dos blocos de anúncio
  // ═══════════════════════════════════════════════════════════════════════════
  adsDb.exec(`
    CREATE TABLE IF NOT EXISTS ad_screenshots (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      execution_id    INTEGER,
      ad_id           INTEGER,
      area_label      TEXT    NOT NULL,
      file_path       TEXT    NOT NULL,
      file_size_bytes INTEGER NOT NULL DEFAULT 0,
      width           INTEGER,
      height          INTEGER,
      captured_at     TEXT    NOT NULL,
      FOREIGN KEY (execution_id) REFERENCES search_executions(id) ON DELETE CASCADE,
      FOREIGN KEY (ad_id) REFERENCES serp_ads(id) ON DELETE SET NULL
    )
  `);
  // area_label: 'tads_top' | 'tadsb_bottom' | 'shopping_pla' | 'ad_slot' | 'viewport_fallback'

  // ═══════════════════════════════════════════════════════════════════════════
  // TABELA: whitelist_rules
  // Regras para IGNORAR anúncios (mesma lógica do Python)
  // Se substring match no URL/título/display_url → anúncio é pulado
  // ═══════════════════════════════════════════════════════════════════════════
  adsDb.exec(`
    CREATE TABLE IF NOT EXISTS whitelist_rules (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      pattern     TEXT    NOT NULL,
      match_type  TEXT    NOT NULL DEFAULT 'substring',
      description TEXT,
      is_active   INTEGER NOT NULL DEFAULT 1,
      hits        INTEGER NOT NULL DEFAULT 0,
      created_at  TEXT    NOT NULL,
      updated_at  TEXT    NOT NULL
    )
  `);
  // match_type: 'substring' | 'exact' | 'regex' | 'domain'

  // ═══════════════════════════════════════════════════════════════════════════
  // TABELA: blacklist_rules
  // Regras para MARCAR/ALERTAR anúncios de interesse (NOVO!)
  // Se substring match → anúncio é flagado como "blacklisted"
  // Pode ser usado para: alertas, prioridade de clique, relatórios
  // ═══════════════════════════════════════════════════════════════════════════
  adsDb.exec(`
    CREATE TABLE IF NOT EXISTS blacklist_rules (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      pattern     TEXT    NOT NULL,
      match_type  TEXT    NOT NULL DEFAULT 'substring',
      description TEXT,
      is_active   INTEGER NOT NULL DEFAULT 1,
      priority    INTEGER NOT NULL DEFAULT 0,
      action      TEXT    NOT NULL DEFAULT 'flag',
      hits        INTEGER NOT NULL DEFAULT 0,
      created_at  TEXT    NOT NULL,
      updated_at  TEXT    NOT NULL
    )
  `);
  // action: 'flag' | 'click' | 'screenshot' | 'alert'
  // priority: 0 (normal) → 10 (máxima). Maior prioridade = processado primeiro.

  // ═══════════════════════════════════════════════════════════════════════════
  // ÍNDICES para consultas frequentes
  // ═══════════════════════════════════════════════════════════════════════════
  adsDb.exec(`
    CREATE INDEX IF NOT EXISTS idx_sessions_bot_id     ON search_sessions(bot_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_profile    ON search_sessions(profile_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_status     ON search_sessions(status);
    CREATE INDEX IF NOT EXISTS idx_executions_session  ON search_executions(session_id);
    CREATE INDEX IF NOT EXISTS idx_executions_keyword  ON search_executions(keyword);
    CREATE INDEX IF NOT EXISTS idx_ads_execution       ON serp_ads(execution_id);
    CREATE INDEX IF NOT EXISTS idx_ads_keyword         ON serp_ads(keyword);
    CREATE INDEX IF NOT EXISTS idx_ads_href_decoded    ON serp_ads(href_decoded);
    CREATE INDEX IF NOT EXISTS idx_ads_display_url     ON serp_ads(display_url);
    CREATE INDEX IF NOT EXISTS idx_ads_blacklisted     ON serp_ads(is_blacklisted);
    CREATE INDEX IF NOT EXISTS idx_clicks_ad           ON ad_clicks(ad_id);
    CREATE INDEX IF NOT EXISTS idx_whitelist_active    ON whitelist_rules(is_active);
    CREATE INDEX IF NOT EXISTS idx_blacklist_active    ON blacklist_rules(is_active);
  `);

  console.log(`[AdsDB] Banco de dados de anúncios inicializado: ${ADS_DB_PATH}`);
  return adsDb;
}

/**
 * Retorna a instância ativa do banco ads.db.
 * @returns {Database}
 */
function getAdsDB() {
  if (!adsDb) initAdsDB();
  return adsDb;
}

module.exports = {
  initAdsDB,
  getAdsDB,
  nowBrasilia,
  ADS_DB_PATH,
};
