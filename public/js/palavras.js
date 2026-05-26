/**
 * public/js/palavras.js
 * Lógica do frontend para gerenciamento de Módulos de Pesquisa (Palavras-chave).
 * CRUD completo: criar, editar, excluir módulos e palavras.
 */

'use strict';

// ── Estado ───────────────────────────────────────────────────────────────────
const palavrasState = {
  modules: [],
  activeModuleId: null, // ID do módulo aberto no detalhe
};

// ── Helpers ──────────────────────────────────────────────────────────────────
function escapeHtmlP(str) {
  if (!str) return '';
  const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
  return str.replace(/[&<>"']/g, (c) => map[c]);
}

function showToast(message, type = 'info') {
  let container = document.getElementById('toastNotificationsContainer');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toastNotificationsContainer';
    container.className = 'toast-container';
    document.body.appendChild(container);
  }

  const box = document.createElement('div');
  box.className = `toast-box ${type}`;

  let icon = 'ℹ️';
  if (type === 'success') icon = '✅';
  else if (type === 'warning') icon = '⚠️';
  else if (type === 'error') icon = '❌';

  box.innerHTML = `
    <div class="toast-icon-wrapper">${icon}</div>
    <div class="toast-message">${escapeHtmlP(message)}</div>
  `;

  container.appendChild(box);

  setTimeout(() => {
    box.classList.add('toast-out');
    box.addEventListener('animationend', () => {
      box.remove();
      if (container.children.length === 0) {
        container.remove();
      }
    });
  }, 3000);
}

function showToastP(type, msg) {
  const mappedType = type === 'online' ? 'success' : (type === 'offline' ? 'error' : type);
  showToast(msg, mappedType);
}

// ── Carregar Módulos ─────────────────────────────────────────────────────────
async function loadModules() {
  try {
    const res = await fetch('/api/search-modules');
    const data = await res.json();
    if (!data.ok) throw new Error(data.error);

    palavrasState.modules = data.modules || [];
    renderModulesGrid();
    updateModuleStats();
  } catch (err) {
    console.error('[Palavras] Erro ao carregar módulos:', err);
  }
}

// ── Atualizar Stats ──────────────────────────────────────────────────────────
function updateModuleStats() {
  const mods = palavrasState.modules;
  const totalModules = mods.length;
  const totalWords = mods.reduce((acc, m) => acc + (m.word_count || 0), 0);
  const activeModules = mods.filter(m => m.is_active).length;

  const el1 = document.getElementById('statTotalModules');
  const el2 = document.getElementById('statTotalWords');
  const el3 = document.getElementById('statActiveModules');
  const badge = document.getElementById('navModuleCount');

  if (el1) el1.textContent = totalModules;
  if (el2) el2.textContent = totalWords;
  if (el3) el3.textContent = activeModules;
  if (badge) badge.textContent = totalModules;
}

// ── Renderizar Grid de Módulos ───────────────────────────────────────────────
function renderModulesGrid() {
  const container = document.getElementById('modulesGrid');
  if (!container) return;

  const mods = palavrasState.modules;

  if (mods.length === 0) {
    container.innerHTML = `
      <div class="profile-empty-state" style="grid-column:1/-1;">
        <div class="empty-icon">📦</div>
        <div class="empty-title">Nenhum módulo criado</div>
        <div class="empty-desc">Use o formulário acima para criar seu primeiro módulo de pesquisa.</div>
      </div>`;
    return;
  }

  container.innerHTML = mods.map(m => {
    const isActive = m.is_active;
    const statusBadge = isActive
      ? '<span class="module-status-badge active">🟢 Ativo</span>'
      : '<span class="module-status-badge inactive">🔴 Inativo</span>';

    return `
      <div class="module-card ${isActive ? '' : 'inactive'}" data-module-id="${m.id}">
        <div class="module-card-header">
          <div class="module-card-icon">📦</div>
          <div class="module-card-info">
            <div class="module-card-label">${escapeHtmlP(m.label)}</div>
            <div class="module-card-desc">${escapeHtmlP(m.description) || '<span class="dim-text">Sem descrição</span>'}</div>
          </div>
          <label class="module-toggle" title="Ativar/Desativar">
            <input type="checkbox" ${isActive ? 'checked' : ''} onchange="toggleModule(${m.id}, this.checked)" />
            <span class="slider"></span>
          </label>
        </div>
        <div class="module-card-stats">
          <div class="module-stat">
            <span class="module-stat-icon">🔤</span>
            <span class="module-stat-value">${m.word_count || 0}</span>
            <span>palavras</span>
          </div>
          ${statusBadge}
        </div>
        <div class="module-card-actions">
          <button class="module-btn primary" onclick="openModuleDetail(${m.id})">📖 Abrir</button>
          <button class="module-btn" onclick="editModule(${m.id})">✏️ Editar</button>
          <button class="module-btn danger" onclick="deleteModule(${m.id}, '${escapeHtmlP(m.label)}')">🗑 Excluir</button>
        </div>
      </div>
    `;
  }).join('');
}

// ── Criar Módulo ─────────────────────────────────────────────────────────────
async function createModule() {
  const labelInput = document.getElementById('smLabel');
  const descInput = document.getElementById('smDescription');
  const label = labelInput?.value.trim();
  const description = descInput?.value.trim() || null;

  if (!label) {
    labelInput?.focus();
    return;
  }

  try {
    const res = await fetch('/api/search-modules', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label, description }),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error);

    showToastP('online', `📦 Módulo "${label}" criado com sucesso!`);
    labelInput.value = '';
    descInput.value = '';
    await loadModules();
  } catch (err) {
    showToast(`Erro ao criar módulo: ${err.message}`, 'error');
  }
}

// ── Editar Módulo (prompt simples) ───────────────────────────────────────────
async function editModule(id) {
  const mod = palavrasState.modules.find(m => m.id === id);
  if (!mod) return;

  const newLabel = prompt('Novo label para o módulo:', mod.label);
  if (newLabel === null) return; // Cancelou
  if (!newLabel.trim()) {
    showToast('O label não pode ser vazio.', 'warning');
    return;
  }

  const newDesc = prompt('Nova descrição (deixe vazio para remover):', mod.description || '');
  if (newDesc === null) return;

  try {
    const res = await fetch(`/api/search-modules/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        label: newLabel.trim(),
        description: newDesc.trim() || null,
      }),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error);

    showToastP('online', `✏️ Módulo "${newLabel.trim()}" atualizado!`);
    await loadModules();

    // Se o detalhe estiver aberto para este módulo, recarrega
    if (palavrasState.activeModuleId === id) {
      await openModuleDetail(id);
    }
  } catch (err) {
    showToast(`Erro ao editar módulo: ${err.message}`, 'error');
  }
}

// ── Excluir Módulo ───────────────────────────────────────────────────────────
async function deleteModule(id, label) {
  if (!confirm(`Tem certeza que deseja excluir o módulo "${label}" e todas as suas palavras?`)) return;

  try {
    const res = await fetch(`/api/search-modules/${id}`, { method: 'DELETE' });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error);

    showToastP('offline', `🗑 Módulo "${label}" excluído.`);

    // Se o detalhe estava aberto para este módulo, fecha
    if (palavrasState.activeModuleId === id) {
      closeModuleDetail();
    }

    await loadModules();
  } catch (err) {
    showToast(`Erro ao excluir módulo: ${err.message}`, 'error');
  }
}

// ── Toggle Ativo/Inativo ─────────────────────────────────────────────────────
async function toggleModule(id, isActive) {
  try {
    const res = await fetch(`/api/search-modules/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_active: isActive ? 1 : 0 }),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error);

    await loadModules();
  } catch (err) {
    showToast(`Erro ao alterar status: ${err.message}`, 'error');
  }
}

// ── Abrir Detalhe do Módulo (lista de palavras) ──────────────────────────────
async function openModuleDetail(id) {
  palavrasState.activeModuleId = id;

  const card = document.getElementById('moduleDetailCard');
  if (!card) return;

  card.style.display = '';

  // Título provisório
  document.getElementById('moduleDetailTitle').textContent = 'Carregando...';
  document.getElementById('moduleDetailSubtitle').textContent = '';
  document.getElementById('moduleWordsList').innerHTML = '<div class="log-empty"><span>Carregando...</span></div>';

  try {
    const res = await fetch(`/api/search-modules/${id}`);
    const data = await res.json();
    if (!data.ok) throw new Error(data.error);

    const mod = data.module;
    document.getElementById('moduleDetailTitle').textContent = `Palavras: "${escapeHtmlP(mod.label)}"`;
    document.getElementById('moduleDetailSubtitle').textContent = mod.description || '—';
    document.getElementById('moduleWordCount').textContent = `${mod.words.length} palavra(s)`;

    renderWordChips(mod.words, id);

    // Scroll suave até o detalhe
    card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  } catch (err) {
    document.getElementById('moduleDetailTitle').textContent = 'Erro';
    document.getElementById('moduleWordsList').innerHTML =
      `<div class="log-empty"><span>Erro: ${escapeHtmlP(err.message)}</span></div>`;
  }
}

// ── Fechar Detalhe ───────────────────────────────────────────────────────────
function closeModuleDetail() {
  palavrasState.activeModuleId = null;
  const card = document.getElementById('moduleDetailCard');
  if (card) card.style.display = 'none';
}

// ── Renderizar Word Chips ────────────────────────────────────────────────────
function renderWordChips(words, moduleId) {
  const container = document.getElementById('moduleWordsList');
  if (!container) return;

  if (!words || words.length === 0) {
    container.innerHTML = '<div class="log-empty"><span>Nenhuma palavra adicionada. Use o campo acima para adicionar.</span></div>';
    return;
  }

  container.innerHTML = words.map(w => `
    <div class="word-chip" data-word-id="${w.id}">
      <span class="word-chip-text" title="${escapeHtmlP(w.word)}">${escapeHtmlP(w.word)}</span>
      <button class="word-chip-btn edit" onclick="editWord(${moduleId}, ${w.id}, '${escapeHtmlP(w.word).replace(/'/g, "\\'")}')" title="Editar">✏️</button>
      <button class="word-chip-btn delete" onclick="deleteWord(${moduleId}, ${w.id})" title="Excluir">✕</button>
    </div>
  `).join('');
}

// ── Adicionar Palavras ───────────────────────────────────────────────────────
async function addWords() {
  const moduleId = palavrasState.activeModuleId;
  if (!moduleId) return;

  const textarea = document.getElementById('smNewWords');
  const text = textarea?.value.trim();
  if (!text) {
    textarea?.focus();
    return;
  }

  try {
    const res = await fetch(`/api/search-modules/${moduleId}/words`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ words: text }),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error);

    showToastP('online', `⚡ ${data.added} palavra(s) adicionada(s)!`);
    textarea.value = '';

    await loadModules(); // Atualiza contagem
    await openModuleDetail(moduleId); // Recarrega palavras
  } catch (err) {
    showToast(`Erro ao adicionar palavras: ${err.message}`, 'error');
  }
}

// ── Editar Palavra ───────────────────────────────────────────────────────────
async function editWord(moduleId, wordId, currentWord) {
  const newWord = prompt('Editar palavra:', currentWord);
  if (newWord === null) return;
  if (!newWord.trim()) {
    showToast('A palavra não pode ser vazia.', 'warning');
    return;
  }

  try {
    const res = await fetch(`/api/search-modules/${moduleId}/words/${wordId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ word: newWord.trim() }),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error);

    await openModuleDetail(moduleId);
  } catch (err) {
    showToast(`Erro ao editar palavra: ${err.message}`, 'error');
  }
}

// ── Excluir Palavra ──────────────────────────────────────────────────────────
async function deleteWord(moduleId, wordId) {
  try {
    const res = await fetch(`/api/search-modules/${moduleId}/words/${wordId}`, {
      method: 'DELETE',
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error);

    await loadModules(); // Atualiza contagem
    await openModuleDetail(moduleId); // Recarrega palavras
  } catch (err) {
    showToast(`Erro ao excluir palavra: ${err.message}`, 'error');
  }
}

// ── Limpar Todas as Palavras ─────────────────────────────────────────────────
async function clearAllWords() {
  const moduleId = palavrasState.activeModuleId;
  if (!moduleId) return;
  if (!confirm('Tem certeza que deseja remover TODAS as palavras deste módulo?')) return;

  try {
    const res = await fetch(`/api/search-modules/${moduleId}/words`, {
      method: 'DELETE',
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error);

    showToastP('offline', '🗑 Todas as palavras foram removidas.');
    await loadModules();
    await openModuleDetail(moduleId);
  } catch (err) {
    showToast(`Erro ao limpar palavras: ${err.message}`, 'error');
  }
}

// ── Inicialização e Event Listeners ──────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  // Botão de criar módulo
  document.getElementById('btnCreateModule')?.addEventListener('click', createModule);

  // Enter no input de label = cria módulo
  document.getElementById('smLabel')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') createModule();
  });

  // Botão de atualizar grid
  document.getElementById('btnRefreshModules')?.addEventListener('click', loadModules);

  // Botão de adicionar palavras
  document.getElementById('btnAddWords')?.addEventListener('click', addWords);

  // Botão de limpar todas as palavras
  document.getElementById('btnClearWords')?.addEventListener('click', clearAllWords);

  // Botão de fechar detalhe
  document.getElementById('btnCloseModuleDetail')?.addEventListener('click', closeModuleDetail);

  // Carrega módulos ao iniciar
  loadModules();
});

// ── Exposição global (para onclick inline) ───────────────────────────────────
window.toggleModule = toggleModule;
window.openModuleDetail = openModuleDetail;
window.editModule = editModule;
window.deleteModule = deleteModule;
window.editWord = editWord;
window.deleteWord = deleteWord;
