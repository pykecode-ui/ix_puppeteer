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
  // Chave API do 2Captcha ou Capsolver para resolver reCAPTCHA automaticamente.
  // - Para 2Captcha: Insira a chave tradicional de 32 caracteres (ex: 'a5b86f...').
  // - Para Capsolver: Insira a chave iniciando com 'CAP-' (ex: 'CAP-ABCD...').
  // Deixe vazio ('') para desativar — CAPTCHAs serão detectados mas não resolvidos.
  TWOCAPTCHA_API_KEY: 'CAP-742B0FD85614D5BF3DD3DE23BD446BBF',

  // ── Credenciais de Proxy para Capsolver ──────────────────────────
  // O Capsolver exige o uso do mesmo proxy do perfil para resolver captchas do Google Search.
  // Como o ixBrowser oculta a senha do proxy por segurança, preencha o usuário e senha do seu provedor de proxy abaixo:
  PROXY_USER: '67ce0f6bd3b1f71b40ec__cr.br;state.riograndedonorte',
  PROXY_PASSWORD: 'd0b4e485c310b80a',
};
