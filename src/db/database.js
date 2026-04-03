/**
 * src/db/database.js
 * Inicialização e configuração do banco de dados SQLite.
 * Cria o arquivo config.db e todas as tabelas necessárias na primeira execução.
 * Suporta múltiplos bots registrados e seus logs em tempo real.
 */

const Database = require('better-sqlite3');
const path = require('path');

// Caminho do arquivo do banco na raiz do projeto
const DB_PATH = path.join(__dirname, '../../config.db');

// Instância única do banco (singleton)
let db = null;

/**
 * Retorna o timestamp atual no fuso horário de Brasília (UTC-3).
 * Formato: "DD/MM/AAAA HH:MM:SS"
 * @returns {string}
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
    hour12: false,
  });
}

/**
 * Inicializa o banco de dados e cria as tabelas se não existirem.
 * Deve ser chamado uma vez na inicialização do servidor.
 * @returns {Database} Instância do banco
 */
function initDatabase() {
  if (db) return db; // Já inicializado

  db = new Database(DB_PATH, { verbose: null });

  // Ativa WAL mode para melhor performance de leitura/escrita concorrente
  db.pragma('journal_mode = WAL');

  // ─── Tabelas originais ──────────────────────────────────────────────────────

  // Tabela: estado geral do bot (mantida para compatibilidade)
  db.exec(`
    CREATE TABLE IF NOT EXISTS bot_state (
      id          INTEGER PRIMARY KEY CHECK (id = 1),
      status      TEXT    NOT NULL DEFAULT 'offline',
      updated_at  TEXT    NOT NULL
    )
  `);

  // Tabela: registro de perfis do ixBrowser
  db.exec(`
    CREATE TABLE IF NOT EXISTS profiles (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      profile_id     INTEGER NOT NULL UNIQUE,
      status         TEXT    NOT NULL DEFAULT 'closed',
      open_count     INTEGER NOT NULL DEFAULT 0,
      last_opened_at TEXT,
      last_closed_at TEXT,
      created_at     TEXT    NOT NULL,
      updated_at     TEXT    NOT NULL
    )
  `);

  // ─── Novas tabelas: multi-bot ───────────────────────────────────────────────

  // Tabela: bots registrados (cada instância portável do bot)
  db.exec(`
    CREATE TABLE IF NOT EXISTS bots (
      bot_id       TEXT    PRIMARY KEY,
      name         TEXT    NOT NULL DEFAULT 'Bot',
      status       TEXT    NOT NULL DEFAULT 'offline',
      ip           TEXT,
      socket_id    TEXT,
      last_seen    TEXT,
      created_at   TEXT    NOT NULL,
      updated_at   TEXT    NOT NULL
    )
  `);

  // Tabela: logs enviados pelos bots ao dashboard
  db.exec(`
    CREATE TABLE IF NOT EXISTS bot_logs (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      bot_id     TEXT    NOT NULL,
      level      TEXT    NOT NULL DEFAULT 'info',
      message    TEXT    NOT NULL,
      created_at TEXT    NOT NULL,
      FOREIGN KEY (bot_id) REFERENCES bots(bot_id) ON DELETE CASCADE
    )
  `);

  // Tabela: histórico de status dos bots (cada mudança online/offline)
  db.exec(`
    CREATE TABLE IF NOT EXISTS bot_status_history (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      bot_id     TEXT    NOT NULL,
      status     TEXT    NOT NULL,
      changed_at TEXT    NOT NULL,
      FOREIGN KEY (bot_id) REFERENCES bots(bot_id) ON DELETE CASCADE
    )
  `);

  // Tabela: perfis sendo controlados por cada bot (many-to-many simplificado)
  db.exec(`
    CREATE TABLE IF NOT EXISTS bot_profiles (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      bot_id      TEXT    NOT NULL,
      profile_id  INTEGER NOT NULL,
      status      TEXT    NOT NULL DEFAULT 'closed',
      ws_endpoint TEXT,
      current_url TEXT,
      open_count  INTEGER NOT NULL DEFAULT 0,
      last_opened_at TEXT,
      last_closed_at TEXT,
      updated_at  TEXT    NOT NULL,
      UNIQUE(bot_id, profile_id),
      FOREIGN KEY (bot_id) REFERENCES bots(bot_id) ON DELETE CASCADE
    )
  `);

  // ─── Tabela: perfis globais do IxBrowser cadastrados no dashboard ───────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS ix_profiles (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      profile_id  INTEGER NOT NULL UNIQUE,
      name        TEXT,
      notes       TEXT,
      open_count  INTEGER NOT NULL DEFAULT 0,
      last_opened_at TEXT,
      created_at  TEXT    NOT NULL,
      updated_at  TEXT    NOT NULL
    )
  `);

  // Migração segura: adiciona colunas open_count e last_opened_at se não existirem
  // (para bancos criados antes desta versão)
  try { db.exec(`ALTER TABLE ix_profiles ADD COLUMN open_count INTEGER NOT NULL DEFAULT 0`); } catch (_) {}
  try { db.exec(`ALTER TABLE ix_profiles ADD COLUMN last_opened_at TEXT`); } catch (_) {}

  // Tabela: atribuição de perfis a bots (quais perfis um bot irá controlar)
  db.exec(`
    CREATE TABLE IF NOT EXISTS bot_profile_assignments (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      bot_id      TEXT    NOT NULL,
      profile_id  INTEGER NOT NULL,
      created_at  TEXT    NOT NULL,
      UNIQUE(bot_id, profile_id),
      FOREIGN KEY (bot_id) REFERENCES bots(bot_id) ON DELETE CASCADE,
      FOREIGN KEY (profile_id) REFERENCES ix_profiles(profile_id) ON DELETE CASCADE
    )
  `);

  // ─── Seed: garante que a linha do bot_state existe ─────────────────────────
  const existingState = db.prepare('SELECT id FROM bot_state WHERE id = 1').get();
  if (!existingState) {
    db.prepare(`
      INSERT INTO bot_state (id, status, updated_at) VALUES (1, 'offline', ?)
    `).run(nowBrasilia());
  }

  console.log(`[DB] Banco de dados inicializado: ${DB_PATH}`);
  return db;
}

/**
 * Retorna a instância ativa do banco.
 * Lança erro se o banco não foi inicializado antes.
 * @returns {Database}
 */
function getDB() {
  if (!db) throw new Error('[DB] Banco não inicializado. Chame initDatabase() primeiro.');
  return db;
}

module.exports = { initDatabase, getDB, nowBrasilia };
