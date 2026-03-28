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
  activeBotModal: null, // botId do modal aberto
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
    const target = document.getElementById(`section${section.charAt(0).toUpperCase() + section.slice(1)}`);
    if (target) target.classList.add('active');

    // Atualiza header
    const titles = {
      bots:     ['Bots Registrados', 'Controle múltiplos bots em tempo real'],
      profiles: ['Perfis do IxBrowser', 'Gerencie e atribua perfis aos seus bots'],
      logs:     ['Terminal Global', 'Logs de todos os bots em tempo real'],
      settings: ['Configurações', 'Informações do sistema'],
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

  // Fecha modal se for o bot que ficou offline
  if (state.activeBotModal === botId) {
    appendModalLog('error', `Bot ficou offline. Motivo: ${reason || 'desconexão'}`);
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

  // Atualiza modal se for o bot em questão
  if (state.activeBotModal === botId) {
    appendModalLog(`info`, `Perfil #${profileId} → status: ${status}${currentUrl ? ' | ' + currentUrl : ''}`);
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

  // Se o modal está aberto para este bot, atualiza o log do modal também
  if (state.activeBotModal === botId) {
    appendModalLog(level, message, timestamp);
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
// MODAL DE CONTROLE DO BOT
// ══════════════════════════════════════════════════════════════════════════════

function openBotModal(botId) {
  const bot = state.bots[botId];
  if (!bot) return;

  state.activeBotModal = botId;
  // Exposto globalmente para uso pelo profiles.js
  window._activeBotModal = botId;

  document.getElementById('modalTitle').textContent = `Controlar: ${bot.name || 'Bot'}`;
  document.getElementById('modalSubtitle').textContent = `ID: ${botId}`;

  updateModalInfo(bot);

  // Limpa logs do modal
  const modalLog = document.getElementById('modalLogTerminal');
  if (modalLog) {
    modalLog.innerHTML = '<div class="log-empty"><span>Aguardando ações...</span></div>';
  }

  document.getElementById('botModal').classList.add('visible');

  // Carrega lista de perfis atribuídos ao bot (em profiles.js)
  if (typeof window.profiles_onModalOpen === 'function') {
    window.profiles_onModalOpen(botId);
  }
}

function updateModalInfo(bot) {
  if (!bot) return;
  const grid = document.getElementById('modalInfoGrid');
  if (!grid) return;
  grid.innerHTML = `
    <div class="modal-info-item">
      <span class="modal-info-label">Status</span>
      <span class="modal-info-value"><span class="bot-status-badge ${bot.status}">${formatStatus(bot.status)}</span></span>
    </div>
    <div class="modal-info-item">
      <span class="modal-info-label">IP</span>
      <span class="modal-info-value">${bot.ip || '—'}</span>
    </div>
    <div class="modal-info-item">
      <span class="modal-info-label">Último sinal</span>
      <span class="modal-info-value">${bot.last_seen || '—'}</span>
    </div>
    <div class="modal-info-item">
      <span class="modal-info-label">Bot ID</span>
      <span class="modal-info-value" style="font-family: var(--font-mono); font-size:11px;">${bot.bot_id}</span>
    </div>
  `;
}

// Fechar modal
document.getElementById('modalClose')?.addEventListener('click', closeModal);
document.getElementById('botModal')?.addEventListener('click', (e) => {
  if (e.target === document.getElementById('botModal')) closeModal();
});

function closeModal() {
  document.getElementById('botModal').classList.remove('visible');
  state.activeBotModal = null;
  window._activeBotModal = null;
}

// ── Comandos do Modal ────────────────────────────────────────────────────────

function sendCommand(command, payload) {
  if (!state.activeBotModal) return;
  socket.emit('dashboard:sendCommand', {
    botId: state.activeBotModal,
    command,
    payload,
  });
  appendModalLog('info', `→ Enviando comando: ${command}${JSON.stringify(payload) !== '{}' ? ' ' + JSON.stringify(payload) : ''}`);
}

document.getElementById('modalBtnOpen')?.addEventListener('click', () => {
  const profileId = parseInt(document.getElementById('modalProfileId').value);
  if (!profileId) return alert('Digite um ID de perfil válido.');
  sendCommand('open_profile', { profileId });
});

document.getElementById('modalBtnClose')?.addEventListener('click', () => {
  const profileId = parseInt(document.getElementById('modalProfileId').value);
  if (!profileId) return alert('Digite um ID de perfil válido.');
  sendCommand('close_profile', { profileId });
});

document.getElementById('modalBtnCloseAll')?.addEventListener('click', () => {
  sendCommand('close_all_profiles', {});
});

document.getElementById('modalBtnNavigate')?.addEventListener('click', () => {
  const profileId = parseInt(document.getElementById('modalNavProfileId').value);
  const url = document.getElementById('modalNavUrl').value.trim();
  if (!profileId || !url) return alert('Preencha o ID do perfil e a URL.');
  sendCommand('navigate', { profileId, url });
});

// ── Detalhes do bot ao abrir modal ───────────────────────────────────────────
document.addEventListener('bot:detail', (e) => {
  const { logs = [] } = e.detail;
  logs.slice(-50).forEach((l) => appendModalLog(l.level, l.message, l.created_at));
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
