/**
 * bot/config.js
 * ─────────────────────────────────────────────────────────────────
 * CONFIGURAÇÃO GLOBAL DO BOT
 * ─────────────────────────────────────────────────────────────────
 * Edite este arquivo antes de iniciar o bot em uma nova máquina.
 * Apenas as configurações aqui precisam ser alteradas para
 * apontar ao dashboard correto e nomear o bot.
 */

module.exports = {
  // ── Dashboard ──────────────────────────────────────────────────
  // URL do servidor do dashboard. 
  // Ex: 'http://192.168.1.100:3000' para rede local
  // Ex: 'https://meu-dashboard.com' para servidor público
  DASHBOARD_API_URL: 'http://localhost:3000',

  // ── Identidade do Bot ──────────────────────────────────────────
  // Nome amigável exibido no painel (pode ser alterado a qualquer momento)
  BOT_NAME: 'Bot Principal',

  // ── ixBrowser API Local ────────────────────────────────────────
  // Porta da API local do ixBrowser instalado NESTA máquina
  // (não altere a menos que o ixBrowser use porta diferente)
  IX_API_BASE: 'http://127.0.0.1:53200',

  // ── Comportamento do Bot ───────────────────────────────────────
  // Intervalo em ms para enviar heartbeat ao dashboard
  HEARTBEAT_INTERVAL_MS: 3000,

  // Timeout em ms para chamadas HTTP ao dashboard
  API_TIMEOUT_MS: 10000,

  // Número de tentativas de reconexão ao dashboard
  RECONNECT_ATTEMPTS: 5,

  // Delay entre tentativas de reconexão (ms)
  RECONNECT_DELAY_MS: 3000,

  // ── Resolução Automática de CAPTCHA ────────────────────────────
  // Chave API do serviço de CAPTCHA (detecção automática pelo formato da chave):
  //   - Capsolver:  Chave começa com 'CAP-'  (ex: 'CAP-ABCD...')
  //   - CapMonster: Chave formato UUID        (ex: 'a1b2c3d4-1234-...')
  //   - 2Captcha:   Chave hex 32 chars        (ex: 'a5b86f...')
  // Deixe vazio ('') para desativar CAPTCHA.
  TWOCAPTCHA_API_KEY: 'a17e326270691f3ddc2a926e6b670778',
};
