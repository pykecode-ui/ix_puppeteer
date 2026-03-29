/**
 * public/js/dashboard.js
 * Lógica do dashboard multi-bot — lado cliente.
 * Gerencia: lista de bots, modal de controle, logs em tempo real, stats.
 */

'use strict';

// ── Estado global ────────────────────────────────────────────────────────────
const state = {
  bots: {},        // { botId: botData }
  logs: [],        // Array de logs globais
  logCount: 0,
  activeBotModal: null, // botId da página de controle aberta
  logFilter: 'all',
};

const MAX_LOGS = 500;

// ── Relógio ──────────────────────────────────────────────────────────────────
function updateClock() {
  const el = document.getElementById('headerTime');
  if (el) {
    el.textContent = new Date().toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  }
}
setInterval(updateClock, 1000);
updateClock();

// ── Navegação Lateral ────────────────────────────────────────────────────────
document.querySelectorAll('.nav-item[data-section]').forEach((item) => {
  item.addEventListener('click', (e) => {
    e.preventDefault();
    const section = item.dataset.section;

    document.querySelectorAll('.nav-item').forEach((n) => n.classList.remove('active'));
    item.classList.add('active');

    document.querySelectorAll('.section-page').forEach((s) => s.classList.remove('active'));
    const sectionKey = section.charAt(0).toUpperCase() + section.slice(1);
    const target = document.getElementById(`section${sectionKey}`);
    if (target) target.classList.add('active');

    // Atualiza header
    const titles = {
      bots:       ['Bots Registrados', 'Controle múltiplos bots em tempo real'],
      profiles:   ['Perfis do IxBrowser', 'Gerencie e atribua perfis aos seus bots'],
      logs:       ['Terminal Global', 'Logs de todos os bots em tempo real'],
      settings:   ['Configurações', 'Informações do sistema'],
      botControl: ['Controle do Bot', 'Configurar, vincular perfis e enviar comandos'],
    };
    if (titles[section]) {
      document.getElementById('headerTitle').textContent = titles[section][0];
      document.getElementById('headerSubtitle').textContent = titles[section][1];
    }
  });
});

// ── Status do Socket ─────────────────────────────────────────────────────────
document.addEventListener('socket:connected', (e) => {
  setSocketConnected(true, e.detail.id);
});
document.addEventListener('socket:disconnected', () => {
  setSocketConnected(false, null);
});
document.addEventListener('socket:error', () => {
  setSocketConnected(false, null);
});

function setSocketConnected(connected, socketId) {
  const dot = document.getElementById('socketStatusDot');
  const label = document.getElementById('socketStatusLabel');
  const sidebarDot = document.getElementById('sidebarStatusDot');
  const sidebarLabel = document.getElementById('sidebarStatusLabel');
  const statSocket = document.getElementById('statSocketId');
  const settSocket = document.getElementById('settSocketId');

  if (connected) {
    dot?.classList.add('online');
    dot?.classList.remove('offline');
    if (label) label.textContent = 'Conectado';
    sidebarDot?.classList.add('online');
    sidebarDot?.classList.remove('offline');
    if (sidebarLabel) { sidebarLabel.textContent = 'Online'; sidebarLabel.className = 'status-label online'; }
    if (statSocket) statSocket.textContent = socketId ? socketId.slice(0, 8) + '…' : '—';
    if (settSocket) settSocket.textContent = socketId || '—';
    document.getElementById('settServer').textContent = window.location.host;
  } else {
    dot?.classList.remove('online');
    dot?.classList.add('offline');
    if (label) label.textContent = 'Desconectado';
    sidebarDot?.classList.remove('online');
    sidebarDot?.classList.add('offline');
    if (sidebarLabel) { sidebarLabel.textContent = 'Offline'; sidebarLabel.className = 'status-label offline'; }
    if (statSocket) statSocket.textContent = '—';
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// LISTA DE BOTS
// ══════════════════════════════════════════════════════════════════════════════

document.addEventListener('bots:list', (e) => {
  const { bots = [] } = e.detail;
  state.bots = {};
  bots.forEach((b) => (state.bots[b.bot_id] = b));
  renderBotGrid();
  updateStats();
  updateLogFilter();
});

document.addEventListener('bots:updated', (e) => {
  const { bots = [] } = e.detail;
  state.bots = {};
  bots.forEach((b) => (state.bots[b.bot_id] = b));
  renderBotGrid();
  updateStats();
  updateLogFilter();
});

document.addEventListener('bot:online', (e) => {
  const { botId, name, timestamp } = e.detail;

  // Atualiza estado local
  if (state.bots[botId]) {
    state.bots[botId].status = 'online';
  }

  // Anima o card
  flashBotCard(botId, 'online');
  renderBotGrid();
  updateStats();

  // Toast de notificação
  showToast('online', `🟢 ${name || botId} ficou ONLINE`, timestamp);
  appendLog(null, 'success', `Bot "${name || botId}" conectado ao dashboard.`);
});

document.addEventListener('bot:offline', (e) => {
  const { botId, name, reason, timestamp } = e.detail;

  // Atualiza estado local
  if (state.bots[botId]) {
    state.bots[botId].status = 'offline';
  }

  // Anima o card
  flashBotCard(botId, 'offline');
  renderBotGrid();
  updateStats();

  // Atualiza a página de controle se for o bot em questão
  if (state.activeBotModal === botId) {
    appendCtrlLog('error', `Bot ficou offline. Motivo: ${reason || 'desconexão'}`);
    // Atualiza badge de status no breadcrumb
    const badge = document.getElementById('botCtrlStatusBadge');
    if (badge) { badge.className = 'bot-status-badge offline'; badge.textContent = formatStatus('offline'); }
  }

  // Toast de notificação
  showToast('offline', `🔴 ${name || botId} ficou OFFLINE`, timestamp);
  appendLog(null, 'error', `Bot "${name || botId}" desconectado. Motivo: ${reason || 'desconexão'}.`);
});


document.addEventListener('bot:heartbeat', () => {
  // Silencioso — só atualiza last_seen internamente
});

document.addEventListener('bot:status', (e) => {
  const { botId, profileId, status, currentUrl } = e.detail;
  // Atualiza o card do bot se visível
  const card = document.querySelector(`[data-bot-id="${botId}"]`);
  if (card) {
    const profilesBadge = card.querySelector('.bot-profiles-count');
    if (profilesBadge && status === 'open') {
      const current = parseInt(profilesBadge.textContent) || 0;
      profilesBadge.textContent = current + 1;
    }
  }
  updateStats();

  // Atualiza página de controle se for o bot em questão
  if (state.activeBotModal === botId) {
    appendCtrlLog(`info`, `Perfil #${profileId} → status: ${status}${currentUrl ? ' | ' + currentUrl : ''}`);
  }
});

/**
 * Renderiza o grid de cards de bots.
 */
function renderBotGrid() {
  const grid = document.getElementById('botsGrid');
  const emptyState = document.getElementById('botsEmptyState');
  const bots = Object.values(state.bots);

  if (bots.length === 0) {
    if (emptyState) emptyState.style.display = 'flex';
    // Remove cards existentes
    grid.querySelectorAll('.bot-card').forEach((c) => c.remove());
    return;
  }

  if (emptyState) emptyState.style.display = 'none';

  // Adiciona ou atualiza cards
  const existingIds = new Set([...grid.querySelectorAll('.bot-card')].map((c) => c.dataset.botId));

  bots.forEach((bot) => {
    if (existingIds.has(bot.bot_id)) {
      updateBotCard(bot);
    } else {
      grid.appendChild(createBotCard(bot));
    }
    existingIds.delete(bot.bot_id);
  });

  // Remove cards de bots que não existem mais
  existingIds.forEach((id) => {
    grid.querySelector(`[data-bot-id="${id}"]`)?.remove();
  });

  // Atualiza badge de contagem na nav
  document.getElementById('navBotCount').textContent = bots.length;
}

/**
 * Cria um card de bot.
 */
function createBotCard(bot) {
  const card = document.createElement('article');
  card.className = 'bot-card';
  card.dataset.botId = bot.bot_id;
  card.innerHTML = botCardHTML(bot);

  card.querySelector('.btn-control-bot').addEventListener('click', () => openBotModal(bot.bot_id));
  card.querySelector('.btn-delete-bot').addEventListener('click', () => confirmDeleteBot(bot.bot_id, bot.name));

  return card;
}

/**
 * Pede confirmação e deleta o bot via API.
 */
async function confirmDeleteBot(botId, name) {
  if (!confirm(`Remover o bot "${name}" do painel?\n\nIsso apaga o bot e todos os seus logs do banco de dados.`)) return;

  try {
    const res = await fetch(`/api/bots/${botId}`, { method: 'DELETE' });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error);
    appendLog(null, 'warn', `Bot "${name}" removido do painel.`);
  } catch (err) {
    alert(`Erro ao remover bot: ${err.message}`);
  }
}

/**
 * Atualiza um card de bot existente.
 */
function updateBotCard(bot) {
  const card = document.querySelector(`[data-bot-id="${bot.bot_id}"]`);
  if (!card) return;

  // Avatar emoji (🟢 online / ⭕ offline)
  const avatar = card.querySelector('.bot-avatar');
  if (avatar) avatar.textContent = bot.status === 'online' ? '🟢' : '⭕';

  // Badge de status: classe + texto interno
  const statusBadge = card.querySelector('.bot-status-badge');
  if (statusBadge) {
    statusBadge.className = `bot-status-badge ${bot.status}`;
    statusBadge.textContent = formatStatus(bot.status);
  }

  // Último sinal
  const lastSeenEl = card.querySelector('.bot-last-seen');
  if (lastSeenEl) lastSeenEl.textContent = bot.last_seen || '—';
}

/**
 * Gera o HTML interno de um card de bot.
 */
function botCardHTML(bot) {
  return `
    <div class="bot-card-header">
      <div class="bot-avatar">${bot.status === 'online' ? '🟢' : '⭕'}</div>
      <div class="bot-card-info">
        <div class="bot-card-name">${escapeHtml(bot.name || 'Bot')}</div>
        <div class="bot-card-id">${bot.bot_id}</div>
      </div>
      <span class="bot-status-badge ${bot.status}">${formatStatus(bot.status)}</span>
    </div>
    <div class="bot-card-meta">
      <div class="bot-meta-item">
        <span class="bot-meta-label">IP</span>
        <span class="bot-meta-value">${bot.ip || '—'}</span>
      </div>
      <div class="bot-meta-item">
        <span class="bot-meta-label">Último sinal</span>
        <span class="bot-meta-value bot-last-seen">${bot.last_seen || '—'}</span>
      </div>
      <div class="bot-meta-item">
        <span class="bot-meta-label">Perfis ativos</span>
        <span class="bot-meta-value bot-profiles-count">0</span>
      </div>
    </div>
    <div class="bot-card-actions">
      <button class="btn btn-primary btn-control-bot" aria-label="Controlar bot ${escapeHtml(bot.name || '')}">
        ⚡ Controlar
      </button>
      <button class="btn btn-delete-bot" title="Remover bot do painel" aria-label="Remover bot ${escapeHtml(bot.name || '')}">
        🗑
      </button>
    </div>
  `;
}

function formatStatus(status) {
  const map = { online: '● Online', offline: '○ Offline', busy: '◐ Ocupado' };
  return map[status] || status;
}

// ── Stats ────────────────────────────────────────────────────────────────────
function updateStats() {
  const bots = Object.values(state.bots);
  const online = bots.filter((b) => b.status === 'online').length;

  document.getElementById('statTotalBots').textContent = bots.length;
  document.getElementById('statOnlineBots').textContent = online;
}

// ══════════════════════════════════════════════════════════════════════════════
// LOGS
// ══════════════════════════════════════════════════════════════════════════════

document.addEventListener('bot:log', (e) => {
  const { botId, level, message, timestamp } = e.detail;
  appendLog(botId, level, message, timestamp);

  // Se a página de controle está aberta para este bot, atualiza o log também
  if (state.activeBotModal === botId) {
    appendCtrlLog(level, message, timestamp);
  }
});

function appendLog(botId, level, message, timestamp) {
  const terminal = document.getElementById('logTerminal');
  if (!terminal) return;

  // Remove empty state
  terminal.querySelector('.log-empty')?.remove();

  // Aplica filtro
  const shouldShow = state.logFilter === 'all' || state.logFilter === botId;

  const entry = document.createElement('div');
  entry.className = `log-entry ${level || 'info'}`;
  entry.dataset.botId = botId || 'system';

  const ts = timestamp || new Date().toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  const botLabel = botId && state.bots[botId] ? `[${state.bots[botId].name || botId.slice(0, 8)}] ` : '';

  entry.innerHTML = `
    <span class="log-ts">${ts}</span>
    <span class="log-level-badge ${level}">${level || 'info'}</span>
    <span class="log-msg">${botLabel}${escapeHtml(message)}</span>
  `;

  if (!shouldShow) entry.style.display = 'none';

  terminal.appendChild(entry);
  terminal.scrollTop = terminal.scrollHeight;

  // Limita quantidade de logs
  state.logs.push({ botId, level, message, timestamp: ts });
  if (state.logs.length > MAX_LOGS) {
    state.logs.shift();
    terminal.firstElementChild?.remove();
  }

  // Atualiza contador
  state.logCount++;
  document.getElementById('logCounter').textContent = state.logCount;
}

function appendModalLog(level, message, timestamp) {
  const terminal = document.getElementById('modalLogTerminal');
  if (!terminal) return;
  terminal.querySelector('.log-empty')?.remove();

  const entry = document.createElement('div');
  entry.className = `log-entry ${level || 'info'}`;
  const ts = timestamp || new Date().toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  entry.innerHTML = `
    <span class="log-ts">${ts}</span>
    <span class="log-level-badge ${level}">${level || 'info'}</span>
    <span class="log-msg">${escapeHtml(message)}</span>
  `;
  terminal.appendChild(entry);
  terminal.scrollTop = terminal.scrollHeight;
}

// Filtro de logs por bot
document.getElementById('logBotFilter')?.addEventListener('change', (e) => {
  state.logFilter = e.target.value;
  document.querySelectorAll('#logTerminal .log-entry').forEach((entry) => {
    const show = state.logFilter === 'all' || entry.dataset.botId === state.logFilter;
    entry.style.display = show ? '' : 'none';
  });
});

function updateLogFilter() {
  const select = document.getElementById('logBotFilter');
  if (!select) return;
  const bots = Object.values(state.bots);
  const existingOptions = new Set([...select.options].map((o) => o.value));

  bots.forEach((b) => {
    if (!existingOptions.has(b.bot_id)) {
      const opt = document.createElement('option');
      opt.value = b.bot_id;
      opt.textContent = b.name || b.bot_id;
      select.appendChild(opt);
    }
  });
}

// Limpar logs
document.getElementById('btnClearLogs')?.addEventListener('click', () => {
  const terminal = document.getElementById('logTerminal');
  if (terminal) {
    terminal.innerHTML = '<div class="log-empty"><span class="empty-icon">🖥</span><span>Logs limpos.</span></div>';
  }
  state.logs = [];
  state.logCount = 0;
  document.getElementById('logCounter').textContent = 0;
});

// ══════════════════════════════════════════════════════════════════════════════
// PÁGINA DE CONTROLE DO BOT (substitui o modal)
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Navega para a página de controle do bot (substitui openBotModal).
 */
function openBotModal(botId) {
  const bot = state.bots[botId];
  if (!bot) return;

  state.activeBotModal = botId;
  window._activeBotModal = botId;

  // Atualiza breadcrumb
  const avatar = document.getElementById('botCtrlAvatar');
  const nameEl = document.getElementById('botCtrlName');
  const idEl   = document.getElementById('botCtrlId');
  const badge  = document.getElementById('botCtrlStatusBadge');
  if (avatar) avatar.textContent = bot.status === 'online' ? '🟢' : '⭕';
  if (nameEl) nameEl.textContent = bot.name || 'Bot';
  if (idEl)   idEl.textContent   = botId;
  if (badge)  { badge.className = `bot-status-badge ${bot.status}`; badge.textContent = formatStatus(bot.status); }

  // Atualiza grid de info
  updateBotCtrlInfo(bot);

  // Limpa log da página
  const logEl = document.getElementById('ctrlLogTerminal');
  if (logEl) logEl.innerHTML = '<div class="log-empty"><span>Aguardando ações...</span></div>';

  // Navega para a seção
  document.querySelectorAll('.nav-item').forEach((n) => n.classList.remove('active'));
  document.getElementById('navBotControl')?.classList.add('active');

  document.querySelectorAll('.section-page').forEach((s) => s.classList.remove('active'));
  document.getElementById('sectionBotControl')?.classList.add('active');

  document.getElementById('headerTitle').textContent    = `Controle: ${bot.name || 'Bot'}`;
  document.getElementById('headerSubtitle').textContent = `ID: ${botId}`;

  // Carrega lista de perfis atribuídos (em profiles.js)
  if (typeof window.profiles_onModalOpen === 'function') {
    window.profiles_onModalOpen(botId);
  }
}

/**
 * Volta para a lista de bots.
 */
function closeBotControl() {
  state.activeBotModal = null;
  window._activeBotModal = null;

  document.querySelectorAll('.nav-item').forEach((n) => n.classList.remove('active'));
  document.getElementById('navBots')?.classList.add('active');

  document.querySelectorAll('.section-page').forEach((s) => s.classList.remove('active'));
  document.getElementById('sectionBots')?.classList.add('active');

  document.getElementById('headerTitle').textContent    = 'Bots Registrados';
  document.getElementById('headerSubtitle').textContent = 'Controle múltiplos bots em tempo real';
}

// Botão Voltar
document.getElementById('btnBackToBots')?.addEventListener('click', closeBotControl);

function updateBotCtrlInfo(bot) {
  if (!bot) return;
  const grid = document.getElementById('botCtrlInfoGrid');
  if (!grid) return;
  grid.innerHTML = `
    <div class="botctrl-info-item">
      <span class="botctrl-info-label">Status</span>
      <span class="botctrl-info-value"><span class="bot-status-badge ${bot.status}">${formatStatus(bot.status)}</span></span>
    </div>
    <div class="botctrl-info-item">
      <span class="botctrl-info-label">IP</span>
      <span class="botctrl-info-value">${bot.ip || '—'}</span>
    </div>
    <div class="botctrl-info-item">
      <span class="botctrl-info-label">Último sinal</span>
      <span class="botctrl-info-value">${bot.last_seen || '—'}</span>
    </div>
    <div class="botctrl-info-item">
      <span class="botctrl-info-label">Bot ID</span>
      <span class="botctrl-info-value" style="font-family:var(--font-mono);font-size:11px;">${bot.bot_id}</span>
    </div>
  `;
}

// ── Log da página de controle ──────────────────────────────────────────────

function appendCtrlLog(level, message, timestamp) {
  const terminal = document.getElementById('ctrlLogTerminal');
  if (!terminal) return;
  terminal.querySelector('.log-empty')?.remove();

  const entry = document.createElement('div');
  entry.className = `log-entry ${level || 'info'}`;
  const ts = timestamp || new Date().toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  entry.innerHTML = `
    <span class="log-ts">${ts}</span>
    <span class="log-level-badge ${level}">${level || 'info'}</span>
    <span class="log-msg">${escapeHtml(message)}</span>
  `;
  terminal.appendChild(entry);
  terminal.scrollTop = terminal.scrollHeight;
}

// Mantém compatibilidade com profiles.js que chama appendModalLog
function appendModalLog(level, message, timestamp) {
  appendCtrlLog(level, message, timestamp);
}

// Limpar log
document.getElementById('ctrlBtnClearLog')?.addEventListener('click', () => {
  const t = document.getElementById('ctrlLogTerminal');
  if (t) t.innerHTML = '<div class="log-empty"><span>Logs limpos.</span></div>';
});

// ══════════════════════════════════════════════════════════════════════════════
// CONTROLES START / PAUSE DO BOT
// ══════════════════════════════════════════════════════════════════════════════

// Estado local do bot nesta sessão
const botRunState = { running: false };

/**
 * Atualiza o visual dos botões e o indicador de estado.
 * @param {'idle'|'running'|'pausing'} status
 */
function setBotRunUI(status) {
  const dot   = document.getElementById('botRunDot');
  const label = document.getElementById('botRunLabel');
  const btnStart = document.getElementById('btnBotStart');
  const btnPause = document.getElementById('btnBotPause');
  if (!dot || !label || !btnStart || !btnPause) return;

  dot.className = `run-state-dot ${status}`;

  if (status === 'running') {
    label.textContent    = 'Rodando';
    btnStart.disabled    = true;
    btnPause.disabled    = false;
    botRunState.running  = true;
  } else if (status === 'pausing') {
    label.textContent    = 'Pausando…';
    btnStart.disabled    = true;
    btnPause.disabled    = true;
    botRunState.running  = false;
  } else {
    label.textContent    = 'Parado';
    btnStart.disabled    = false;
    btnPause.disabled    = true;
    botRunState.running  = false;
  }
}

/**
 * Busca os perfis atribuídos ao bot ativo e envia o comando start_bot.
 * O bot irá abrir todos esses perfis em série.
 */
document.getElementById('btnBotStart')?.addEventListener('click', async () => {
  const botId = state.activeBotModal;
  if (!botId) return;

  // Busca os perfis atribuídos a este bot
  let profileIds = [];
  try {
    const res  = await fetch(`/api/bots/${botId}/assignments`);
    const data = await res.json();
    if (data.ok) profileIds = data.assignments.map((a) => a.profile_id);
  } catch (err) {
    appendCtrlLog('error', `Erro ao buscar perfis atribuídos: ${err.message}`);
    return;
  }

  if (profileIds.length === 0) {
    appendCtrlLog('warn', '⚠ Nenhum perfil atribuído a este bot. Atribua perfis primeiro.');
    return;
  }

  setBotRunUI('running');
  appendCtrlLog('info', `▶ Iniciando bot com ${profileIds.length} perfil(is): ${profileIds.join(', ')}`);

  socket.emit('dashboard:sendCommand', {
    botId,
    command: 'start_bot',
    payload: { profileIds },
  });
});

/**
 * Envia o comando pause_bot: fecha todos os perfis abertos.
 */
document.getElementById('btnBotPause')?.addEventListener('click', () => {
  const botId = state.activeBotModal;
  if (!botId) return;

  setBotRunUI('pausing');
  appendCtrlLog('warn', '⏸ Pausando bot — fechando todos os perfis...');

  socket.emit('dashboard:sendCommand', {
    botId,
    command: 'pause_bot',
    payload: {},
  });
});

// Reseta estado visual ao sair da página de controle
const _origCloseBotControl = closeBotControl;
// Sobrescreve para limpar estado
window.closeBotControl = function () {
  setBotRunUI('idle');
  _origCloseBotControl();
};

// Escuta confirmação do bot via log para atualizar estado
socket.on('bot:log', ({ botId, level, message }) => {
  if (botId !== state.activeBotModal) return;
  if (message.includes('⏹ Bot pausado') || message.includes('pause_bot concluído')) {
    setBotRunUI('idle');
  }
});


document.addEventListener('bot:detail', (e) => {
  const { logs = [] } = e.detail;
  logs.slice(-50).forEach((l) => appendCtrlLog(l.level, l.message, l.created_at));
});

// ── Toast de notificação em tempo real ───────────────────────────────────────

let toastContainer = null;

/**
 * Exibe um toast flutuante de notificação de status do bot.
 * @param {'online'|'offline'} type
 * @param {string} message
 * @param {string} timestamp
 */
function showToast(type, message, timestamp) {
  if (!toastContainer) {
    toastContainer = document.createElement('div');
    toastContainer.id = 'toastContainer';
    document.body.appendChild(toastContainer);
  }

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `
    <span class="toast-msg">${escapeHtml(message)}</span>
    <span class="toast-time">${timestamp || ''}</span>
  `;

  toastContainer.appendChild(toast);

  // Anima entrada
  requestAnimationFrame(() => toast.classList.add('toast-visible'));

  // Remove após 4s
  setTimeout(() => {
    toast.classList.remove('toast-visible');
    setTimeout(() => toast.remove(), 400);
  }, 4000);
}

/**
 * Faz um flash visual no card do bot quando muda de status.
 * @param {string} botId
 * @param {'online'|'offline'} type
 */
function flashBotCard(botId, type) {
  const card = document.querySelector(`[data-bot-id="${botId}"]`);
  if (!card) return;
  const cls = type === 'online' ? 'flash-online' : 'flash-offline';
  card.classList.add(cls);
  setTimeout(() => card.classList.remove(cls), 1200);
}

// ── Utilitários ───────────────────────────────────────────────────────────────

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Log de inicialização
appendLog(null, 'info', 'Dashboard iniciado. Aguardando bots...');
