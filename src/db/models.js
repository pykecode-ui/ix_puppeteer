/**
 * src/db/models.js
 * Funções de acesso aos dados (queries) para todas as tabelas do config.db.
 * Suporta múltiplos bots, perfis por bot e logs em tempo real.
 */

const { getDB, nowBrasilia } = require('./database');

// ══════════════════════════════════════════════════════════════════════════════
// BOT STATE (legado — compatibilidade)
// ══════════════════════════════════════════════════════════════════════════════

function getBotState() {
  return getDB().prepare('SELECT * FROM bot_state WHERE id = 1').get();
}

function setBotStatus(status) {
  getDB()
    .prepare('UPDATE bot_state SET status = ?, updated_at = ? WHERE id = 1')
    .run(status, nowBrasilia());
}

// ══════════════════════════════════════════════════════════════════════════════
// PROFILES (legado — compatibilidade)
// ══════════════════════════════════════════════════════════════════════════════

function getProfile(profileId) {
  return getDB()
    .prepare('SELECT * FROM profiles WHERE profile_id = ?')
    .get(profileId);
}

function getAllProfiles() {
  return getDB()
    .prepare('SELECT * FROM profiles ORDER BY profile_id ASC')
    .all();
}

function ensureProfile(profileId) {
  const existing = getProfile(profileId);
  if (!existing) {
    const now = nowBrasilia();
    getDB()
      .prepare(`
        INSERT INTO profiles (profile_id, status, open_count, last_opened_at, last_closed_at, created_at, updated_at)
        VALUES (?, 'closed', 0, NULL, NULL, ?, ?)
      `)
      .run(profileId, now, now);
  }
}

function recordProfileOpen(profileId) {
  ensureProfile(profileId);
  const now = nowBrasilia();
  getDB()
    .prepare(`
      UPDATE profiles
      SET status = 'open',
          open_count = open_count + 1,
          last_opened_at = ?,
          updated_at = ?
      WHERE profile_id = ?
    `)
    .run(now, now, profileId);
}

function recordProfileClose(profileId) {
  const now = nowBrasilia();
  getDB()
    .prepare(`
      UPDATE profiles
      SET status = 'closed',
          last_closed_at = ?,
          updated_at = ?
      WHERE profile_id = ?
    `)
    .run(now, now, profileId);
}

// ══════════════════════════════════════════════════════════════════════════════
// BOTS (multi-bot)
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Registra um novo bot ou atualiza um existente (UPSERT).
 * @param {string} botId  - UUID único do bot
 * @param {string} name   - Nome amigável do bot
 * @param {string} ip     - IP de origem da requisição
 */
function registerBot(botId, name, ip) {
  const now = nowBrasilia();
  const existing = getDB().prepare('SELECT bot_id FROM bots WHERE bot_id = ?').get(botId);
  if (existing) {
    getDB()
      .prepare(`
        UPDATE bots
        SET name = ?, ip = ?, status = 'online', last_seen = ?, updated_at = ?
        WHERE bot_id = ?
      `)
      .run(name, ip, now, now, botId);
  } else {
    getDB()
      .prepare(`
        INSERT INTO bots (bot_id, name, status, ip, last_seen, created_at, updated_at)
        VALUES (?, ?, 'online', ?, ?, ?, ?)
      `)
      .run(botId, name, ip, now, now, now);
  }
}

/**
 * Atualiza o status de um bot e o socket_id associado.
 * @param {string} botId
 * @param {'online'|'offline'|'busy'} status
 * @param {string|null} socketId
 */
function updateBotStatus(botId, status, socketId = null) {
  const now = nowBrasilia();
  getDB()
    .prepare(`
      UPDATE bots
      SET status = ?, socket_id = ?, last_seen = ?, updated_at = ?
      WHERE bot_id = ?
    `)
    .run(status, socketId, now, now, botId);
}

/**
 * Retorna todos os bots registrados.
 * @returns {Array}
 */
function getAllBots() {
  return getDB()
    .prepare('SELECT * FROM bots ORDER BY created_at DESC')
    .all();
}

/**
 * Retorna um bot pelo ID.
 * @param {string} botId
 * @returns {object|undefined}
 */
function getBotById(botId) {
  return getDB()
    .prepare('SELECT * FROM bots WHERE bot_id = ?')
    .get(botId);
}

/**
 * Marca TODOS os bots como offline ao iniciar o servidor.
 * Evita bots "fantasma" que ficaram online por crash ou teste direto na API.
 */
function markAllBotsOffline() {
  const now = nowBrasilia();
  getDB()
    .prepare(`UPDATE bots SET status = 'offline', socket_id = NULL, updated_at = ? WHERE status = 'online'`)
    .run(now);
}

/**
 * Remove um bot e todos os seus dados relacionados do banco.
 * @param {string} botId
 */
function deleteBot(botId) {
  getDB().prepare('DELETE FROM bots WHERE bot_id = ?').run(botId);
}

/**
 * Atualiza o heartbeat de um bot (last_seen).
 * @param {string} botId
 */
function botHeartbeat(botId) {
  const now = nowBrasilia();
  getDB()
    .prepare('UPDATE bots SET last_seen = ?, updated_at = ?, status = ? WHERE bot_id = ?')
    .run(now, now, 'online', botId);
}

/**
 * Registra uma mudança de status no histórico (online/offline).
 * Chamado sempre que um bot conecta ou desconecta via Socket.io.
 * @param {string} botId
 * @param {'online'|'offline'} status
 */
function recordBotStatusChange(botId, status) {
  getDB()
    .prepare(`
      INSERT INTO bot_status_history (bot_id, status, changed_at)
      VALUES (?, ?, ?)
    `)
    .run(botId, status, nowBrasilia());
}

/**
 * Retorna o histórico de status de um bot (mais recentes primeiro).
 * @param {string} botId
 * @param {number} limit
 * @returns {Array<{id, bot_id, status, changed_at}>}
 */
function getBotStatusHistory(botId, limit = 20) {
  return getDB()
    .prepare('SELECT * FROM bot_status_history WHERE bot_id = ? ORDER BY id DESC LIMIT ?')
    .all(botId, limit);
}

// ══════════════════════════════════════════════════════════════════════════════
// BOT LOGS
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Salva um log enviado por um bot.
 * @param {string} botId
 * @param {'info'|'success'|'error'|'warn'} level
 * @param {string} message
 */
function addBotLog(botId, level, message) {
  getDB()
    .prepare(`
      INSERT INTO bot_logs (bot_id, level, message, created_at)
      VALUES (?, ?, ?, ?)
    `)
    .run(botId, level, message, nowBrasilia());
}

/**
 * Retorna os últimos N logs de um bot.
 * @param {string} botId
 * @param {number} limit
 * @returns {Array}
 */
function getBotLogs(botId, limit = 100) {
  return getDB()
    .prepare('SELECT * FROM bot_logs WHERE bot_id = ? ORDER BY id DESC LIMIT ?')
    .all(botId, limit);
}

// ══════════════════════════════════════════════════════════════════════════════
// BOT PROFILES (multi-perfil por bot)
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Garante que a relação bot-perfil existe.
 * @param {string} botId
 * @param {number} profileId
 */
function ensureBotProfile(botId, profileId) {
  const now = nowBrasilia();
  const existing = getDB()
    .prepare('SELECT id FROM bot_profiles WHERE bot_id = ? AND profile_id = ?')
    .get(botId, profileId);
  if (!existing) {
    getDB()
      .prepare(`
        INSERT INTO bot_profiles (bot_id, profile_id, status, updated_at)
        VALUES (?, ?, 'closed', ?)
      `)
      .run(botId, profileId, now);
  }
}

/**
 * Registra a abertura de um perfil em um bot específico.
 * @param {string} botId
 * @param {number} profileId
 * @param {string} wsEndpoint
 * @param {string} currentUrl
 */
function recordBotProfileOpen(botId, profileId, wsEndpoint = null, currentUrl = null) {
  ensureBotProfile(botId, profileId);
  const now = nowBrasilia();
  getDB()
    .prepare(`
      UPDATE bot_profiles
      SET status = 'open', ws_endpoint = ?, current_url = ?,
          open_count = open_count + 1, last_opened_at = ?, updated_at = ?
      WHERE bot_id = ? AND profile_id = ?
    `)
    .run(wsEndpoint, currentUrl, now, now, botId, profileId);
}

/**
 * Registra o fechamento de um perfil em um bot específico.
 * @param {string} botId
 * @param {number} profileId
 */
function recordBotProfileClose(botId, profileId) {
  const now = nowBrasilia();
  getDB()
    .prepare(`
      UPDATE bot_profiles
      SET status = 'closed', ws_endpoint = NULL, current_url = NULL,
          last_closed_at = ?, updated_at = ?
      WHERE bot_id = ? AND profile_id = ?
    `)
    .run(now, now, botId, profileId);
}

/**
 * Retorna todos os perfis de um bot.
 * @param {string} botId
 * @returns {Array}
 */
function getBotProfiles(botId) {
  return getDB()
    .prepare('SELECT * FROM bot_profiles WHERE bot_id = ? ORDER BY profile_id ASC')
    .all(botId);
}

/**
 * Sincroniza o status real dos perfis abertos no ixBrowser com o banco de dados.
 * @param {string} botId
 * @param {number[]} openedProfileIds - Array com os IDs dos perfis que estão de fato abertos.
 */
function syncBotProfiles(botId, openedProfileIds) {
  const now = nowBrasilia();
  const db = getDB();
  
  // Transação para evitar concorrência e garantir atomicidade
  const tx = db.transaction(() => {
    // 1. Pega todos os perfis do bot para verificar status
    const allProfiles = getBotProfiles(botId);
    
    const updateOpen = db.prepare(`
      UPDATE bot_profiles 
      SET status = 'open', updated_at = ? 
      WHERE bot_id = ? AND profile_id = ? AND status != 'open'
    `);
    
    const updateClosed = db.prepare(`
      UPDATE bot_profiles 
      SET status = 'closed', last_closed_at = ?, updated_at = ? 
      WHERE bot_id = ? AND profile_id = ? AND status != 'closed'
    `);

    for (const bp of allProfiles) {
      const isActuallyOpen = openedProfileIds.includes(bp.profile_id);
      
      if (isActuallyOpen && bp.status !== 'open') {
        updateOpen.run(now, botId, bp.profile_id);
      } else if (!isActuallyOpen && bp.status === 'open') {
        updateClosed.run(now, now, botId, bp.profile_id);
      }
    }
  });
  
  tx();
}

// ══════════════════════════════════════════════════════════════════════════════
// IX PROFILES (perfis globais do IxBrowser cadastrados no dashboard)
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Retorna todos os perfis globais cadastrados.
 * @returns {Array}
 */
function getAllIxProfiles() {
  return getDB()
    .prepare('SELECT * FROM ix_profiles ORDER BY profile_id ASC')
    .all();
}

/**
 * Retorna um perfil global pelo ID do IxBrowser.
 * @param {number} profileId
 * @returns {object|undefined}
 */
function getIxProfile(profileId) {
  return getDB()
    .prepare('SELECT * FROM ix_profiles WHERE profile_id = ?')
    .get(profileId);
}

/**
 * Cria um ou mais perfis globais. Ignora duplicatas.
 * @param {number[]} profileIds - Array de IDs de perfis do IxBrowser
 * @param {string} [name] - Nome opcional (aplicado só se for um único perfil)
 * @param {string} [notes] - Anotações opcionais
 * @returns {{ created: number, skipped: number }}
 */
function createIxProfiles(profileIds, name = null, notes = null) {
  const now = nowBrasilia();
  const stmt = getDB().prepare(`
    INSERT OR IGNORE INTO ix_profiles (profile_id, name, notes, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
  `);
  let created = 0;
  let skipped = 0;
  const multi = profileIds.length > 1;
  for (const pid of profileIds) {
    const result = stmt.run(pid, multi ? null : name, multi ? null : notes, now, now);
    if (result.changes > 0) created++;
    else skipped++;
  }
  return { created, skipped };
}

/**
 * Atualiza o nome e notas de um perfil global.
 * @param {number} profileId
 * @param {string|null} name
 * @param {string|null} notes
 */
function updateIxProfile(profileId, name, notes) {
  const now = nowBrasilia();
  getDB()
    .prepare('UPDATE ix_profiles SET name = ?, notes = ?, updated_at = ? WHERE profile_id = ?')
    .run(name, notes, now, profileId);
}

/**
 * Remove um perfil global do cadastro (e suas atribuições em cascade).
 * @param {number} profileId
 */
function deleteIxProfile(profileId) {
  getDB().prepare('DELETE FROM ix_profiles WHERE profile_id = ?').run(profileId);
}

/**
 * Incrementa o contador de aberturas de um perfil global e registra o timestamp.
 * Deve ser chamado sempre que o bot abrir o perfil.
 * @param {number} profileId
 */
function incrementIxProfileOpenCount(profileId) {
  const now = nowBrasilia();
  getDB()
    .prepare(`
      UPDATE ix_profiles
      SET open_count = open_count + 1,
          last_opened_at = ?,
          updated_at = ?
      WHERE profile_id = ?
    `)
    .run(now, now, profileId);
}

// ══════════════════════════════════════════════════════════════════════════════
// BOT PROFILE ASSIGNMENTS (quais perfis cada bot controla)
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Retorna todos os perfis atribuídos a um bot.
 * @param {string} botId
 * @returns {Array<{profile_id, name, notes, created_at}>}
 */
function getBotProfileAssignments(botId) {
  return getDB().prepare(`
    SELECT bpa.profile_id, ip.name, ip.notes, bpa.created_at
    FROM bot_profile_assignments bpa
    LEFT JOIN ix_profiles ip ON ip.profile_id = bpa.profile_id
    WHERE bpa.bot_id = ?
    ORDER BY bpa.profile_id ASC
  `).all(botId);
}

/**
 * Define (substitui) os perfis atribuídos a um bot.
 * Remove os existentes e insere os novos.
 * @param {string} botId
 * @param {number[]} profileIds
 */
function setBotProfileAssignments(botId, profileIds) {
  const now = nowBrasilia();
  const db = getDB();
  const del = db.prepare('DELETE FROM bot_profile_assignments WHERE bot_id = ?');
  const ins = db.prepare(`
    INSERT OR IGNORE INTO bot_profile_assignments (bot_id, profile_id, created_at)
    VALUES (?, ?, ?)
  `);
  const tx = db.transaction(() => {
    del.run(botId);
    for (const pid of profileIds) {
      ins.run(botId, pid, now);
    }
  });
  tx();
}

// ══════════════════════════════════════════════════════════════════════════════
// SEARCH MODULES (Módulos de Pesquisa — Palavras-chave)
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Cria um novo módulo de pesquisa.
 * @param {string} label
 * @param {string|null} description
 * @returns {object} O módulo criado
 */
function createSearchModule(label, description = null) {
  const now = nowBrasilia();
  const result = getDB().prepare(`
    INSERT INTO search_modules (label, description, is_active, created_at, updated_at)
    VALUES (?, ?, 1, ?, ?)
  `).run(label, description, now, now);
  return getDB().prepare('SELECT * FROM search_modules WHERE id = ?').get(result.lastInsertRowid);
}

/**
 * Atualiza um módulo de pesquisa.
 * @param {number} id
 * @param {string} label
 * @param {string|null} description
 * @param {number} isActive - 1 ou 0
 */
function updateSearchModule(id, label, description, isActive) {
  const now = nowBrasilia();
  getDB().prepare(`
    UPDATE search_modules
    SET label = ?, description = ?, is_active = ?, updated_at = ?
    WHERE id = ?
  `).run(label, description, isActive ? 1 : 0, now, id);
}

/**
 * Remove um módulo de pesquisa e suas palavras (ON DELETE CASCADE).
 * @param {number} id
 */
function deleteSearchModule(id) {
  getDB().prepare('DELETE FROM search_modules WHERE id = ?').run(id);
}

/**
 * Retorna todos os módulos com contagem de palavras.
 * @returns {Array}
 */
function getAllSearchModules() {
  return getDB().prepare(`
    SELECT sm.*,
           (SELECT COUNT(*) FROM search_words sw WHERE sw.module_id = sm.id) AS word_count
    FROM search_modules sm
    ORDER BY sm.created_at DESC
  `).all();
}

/**
 * Retorna um módulo pelo ID, junto com todas as suas palavras.
 * @param {number} id
 * @returns {object|undefined}
 */
function getSearchModuleById(id) {
  const mod = getDB().prepare('SELECT * FROM search_modules WHERE id = ?').get(id);
  if (!mod) return undefined;
  mod.words = getDB().prepare(
    'SELECT * FROM search_words WHERE module_id = ? ORDER BY id ASC'
  ).all(id);
  return mod;
}

/**
 * Adiciona palavras em massa a um módulo.
 * @param {number} moduleId
 * @param {string[]} words
 * @returns {number} Quantidade adicionada
 */
function addWordsToModule(moduleId, words) {
  const now = nowBrasilia();
  const stmt = getDB().prepare(`
    INSERT INTO search_words (module_id, word, created_at) VALUES (?, ?, ?)
  `);
  let count = 0;
  const tx = getDB().transaction(() => {
    for (const w of words) {
      const trimmed = w.trim();
      if (trimmed.length > 0) {
        stmt.run(moduleId, trimmed, now);
        count++;
      }
    }
    // Atualiza updated_at do módulo
    getDB().prepare('UPDATE search_modules SET updated_at = ? WHERE id = ?').run(now, moduleId);
  });
  tx();
  return count;
}

/**
 * Atualiza o texto de uma palavra.
 * @param {number} wordId
 * @param {string} newWord
 */
function updateWord(wordId, newWord) {
  getDB().prepare('UPDATE search_words SET word = ? WHERE id = ?').run(newWord.trim(), wordId);
}

/**
 * Remove uma palavra pelo ID.
 * @param {number} wordId
 */
function deleteWord(wordId) {
  getDB().prepare('DELETE FROM search_words WHERE id = ?').run(wordId);
}

/**
 * Remove todas as palavras de um módulo.
 * @param {number} moduleId
 */
function deleteAllWordsFromModule(moduleId) {
  const now = nowBrasilia();
  getDB().prepare('DELETE FROM search_words WHERE module_id = ?').run(moduleId);
  getDB().prepare('UPDATE search_modules SET updated_at = ? WHERE id = ?').run(now, moduleId);
}

// ══════════════════════════════════════════════════════════════════════════════
// PROFILE ↔ MODULE LINKS (vínculo perfil → módulo de pesquisa)
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Retorna o módulo vinculado a um perfil.
 * @param {number} profileId
 * @returns {object|undefined} { profile_id, module_id, label, ... }
 */
function getProfileModuleLink(profileId) {
  return getDB().prepare(`
    SELECT pml.profile_id, pml.module_id, sm.label, sm.description, sm.is_active
    FROM profile_module_links pml
    JOIN search_modules sm ON sm.id = pml.module_id
    WHERE pml.profile_id = ?
  `).get(profileId);
}

/**
 * Retorna todos os vínculos perfil→módulo de uma vez.
 * @returns {Array}
 */
function getAllProfileModuleLinks() {
  return getDB().prepare(`
    SELECT pml.profile_id, pml.module_id, sm.label
    FROM profile_module_links pml
    JOIN search_modules sm ON sm.id = pml.module_id
  `).all();
}

/**
 * Define o módulo vinculado a um perfil (UPSERT).
 * @param {number} profileId
 * @param {number} moduleId
 */
function setProfileModuleLink(profileId, moduleId) {
  const now = nowBrasilia();
  getDB().prepare(`
    INSERT INTO profile_module_links (profile_id, module_id, created_at)
    VALUES (?, ?, ?)
    ON CONFLICT(profile_id) DO UPDATE SET module_id = ?, created_at = ?
  `).run(profileId, moduleId, now, moduleId, now);
}

/**
 * Remove o vínculo de módulo de um perfil.
 * @param {number} profileId
 */
function removeProfileModuleLink(profileId) {
  getDB().prepare('DELETE FROM profile_module_links WHERE profile_id = ?').run(profileId);
}

module.exports = {
  // Bot state (legado)
  getBotState,
  setBotStatus,
  // Profiles (legado)
  getProfile,
  getAllProfiles,
  ensureProfile,
  recordProfileOpen,
  recordProfileClose,
  // Bots (multi-bot)
  registerBot,
  updateBotStatus,
  getAllBots,
  getBotById,
  botHeartbeat,
  markAllBotsOffline,
  deleteBot,
  // Bot logs
  addBotLog,
  getBotLogs,
  // Bot status history (online/offline em tempo real)
  recordBotStatusChange,
  getBotStatusHistory,
  // Bot profiles
  ensureBotProfile,
  recordBotProfileOpen,
  recordBotProfileClose,
  getBotProfiles,
  syncBotProfiles,
  // IxBrowser profiles (cadastro global)
  getAllIxProfiles,
  getIxProfile,
  createIxProfiles,
  updateIxProfile,
  deleteIxProfile,
  incrementIxProfileOpenCount,
  // Bot profile assignments
  getBotProfileAssignments,
  setBotProfileAssignments,
  // Search modules (Módulos de Pesquisa)
  createSearchModule,
  updateSearchModule,
  deleteSearchModule,
  getAllSearchModules,
  getSearchModuleById,
  addWordsToModule,
  updateWord,
  deleteWord,
  deleteAllWordsFromModule,
  // Profile ↔ Module links
  getProfileModuleLink,
  getAllProfileModuleLinks,
  setProfileModuleLink,
  removeProfileModuleLink,
};
