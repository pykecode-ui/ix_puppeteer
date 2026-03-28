/**
 * public/js/profiles.js
 * Gerenciamento de perfis globais do IxBrowser e atribuições de perfis a bots.
 * Depende de: dashboard.js (state, escapeHtml, appendLog, showToast)
 */

'use strict';

// ── Estado dos perfis ─────────────────────────────────────────────────────────
const profilesState = {
  profiles: [],      // Array de ix_profiles
  assignments: {},   // { botId: [profileIds] } — cache local
};

// ── Inicialização ─────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  loadProfiles();
  setupProfileTabs();
  setupProfileForm();
  setupProfileAssignmentsModal();
});

// Atualiza via Socket.io
document.addEventListener('profiles:updated', (e) => {
  const { profiles = [] } = e.detail;
  profilesState.profiles = profiles;
  renderProfilesTable();
  updateProfileStats();
  renderModalAssignments(); // Atualiza lista no modal se aberto
});

// ── Carregar perfis da API ────────────────────────────────────────────────────
async function loadProfiles() {
  try {
    const res = await fetch('/api/profiles');
    const data = await res.json();
    if (!data.ok) throw new Error(data.error);
    profilesState.profiles = data.profiles || [];
    renderProfilesTable();
    updateProfileStats();
  } catch (err) {
    console.error('[Perfis] Erro ao carregar:', err.message);
  }
}

// ── Atualizar stats dos perfis ────────────────────────────────────────────────
function updateProfileStats() {
  const total = profilesState.profiles.length;
  document.getElementById('statTotalProfiles').textContent = total;
  document.getElementById('navProfileCount').textContent = total;

  // Conta perfis atribuídos (soma de todos os bots)
  let assigned = 0;
  Object.values(profilesState.assignments).forEach((ids) => {
    assigned += ids.length;
  });
  document.getElementById('statAssignedProfiles').textContent = assigned;
}

// ── Renderizar tabela de perfis ───────────────────────────────────────────────
function renderProfilesTable() {
  const body = document.getElementById('profilesTableBody');
  const table = document.getElementById('profilesTable');
  const emptyState = document.getElementById('profilesEmptyState');
  if (!body) return;

  const profiles = profilesState.profiles;

  if (profiles.length === 0) {
    table.style.display = 'none';
    emptyState.style.display = 'flex';
    return;
  }

  emptyState.style.display = 'none';
  table.style.display = 'table';

  body.innerHTML = profiles
    .map(
      (p) => `
    <tr>
      <td><span class="profile-id-badge">#${p.profile_id}</span></td>
      <td>${escapeHtml(p.name) || '<span class="dim-text">—</span>'}</td>
      <td>${escapeHtml(p.notes) || '<span class="dim-text">—</span>'}</td>
      <td class="dim-text">${p.created_at || '—'}</td>
      <td>
        <div class="profile-actions">
          <button class="toolbar-btn" onclick="editProfilePrompt(${p.profile_id})" title="Editar">✏️</button>
          <button class="toolbar-btn danger" onclick="deleteProfile(${p.profile_id})" title="Remover">🗑️</button>
        </div>
      </td>
    </tr>
  `
    )
    .join('');
}

// ── Abas individual / em massa ────────────────────────────────────────────────
function setupProfileTabs() {
  document.querySelectorAll('.ptab').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.ptab').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');

      const tab = btn.dataset.tab;
      document.getElementById('ptabContentSingle').style.display = tab === 'single' ? '' : 'none';
      document.getElementById('ptabContentBulk').style.display = tab === 'bulk' ? '' : 'none';
    });
  });
}

// ── Formulários de criação ────────────────────────────────────────────────────
function setupProfileForm() {
  // Individual
  document.getElementById('btnAddSingleProfile')?.addEventListener('click', async () => {
    const profileId = parseInt(document.getElementById('pfSingleId').value);
    const name = document.getElementById('pfSingleName').value.trim() || null;
    const notes = document.getElementById('pfSingleNotes').value.trim() || null;

    if (!profileId || profileId <= 0) {
      alert('Digite um ID de perfil válido.');
      return;
    }

    await createProfiles([profileId], name, notes);

    // Limpa formulário
    document.getElementById('pfSingleId').value = '';
    document.getElementById('pfSingleName').value = '';
    document.getElementById('pfSingleNotes').value = '';
  });

  // Em massa
  document.getElementById('btnAddBulkProfiles')?.addEventListener('click', async () => {
    const raw = document.getElementById('pfBulkIds').value;
    const ids = raw
      .split(/[\s,;]+/)
      .map((s) => parseInt(s.trim()))
      .filter((n) => !isNaN(n) && n > 0);

    if (ids.length === 0) {
      alert('Nenhum ID válido encontrado. Use vírgulas, espaços ou quebras de linha.');
      return;
    }

    await createProfiles(ids, null, null);
    document.getElementById('pfBulkIds').value = '';
  });

  // Botão de atualizar
  document.getElementById('btnRefreshProfiles')?.addEventListener('click', loadProfiles);
}

async function createProfiles(profileIds, name, notes) {
  try {
    const res = await fetch('/api/profiles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profileIds, name, notes }),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error);

    appendLog(null, 'success', `✅ Perfis: ${data.message}`);
    showToast('online', `✅ ${data.message}`, null);
    await loadProfiles();
  } catch (err) {
    alert(`Erro ao criar perfis: ${err.message}`);
    appendLog(null, 'error', `Erro ao criar perfis: ${err.message}`);
  }
}

// ── Editar perfil ─────────────────────────────────────────────────────────────
async function editProfilePrompt(profileId) {
  const profile = profilesState.profiles.find((p) => p.profile_id === profileId);
  if (!profile) return;

  const name = prompt('Nome do perfil:', profile.name || '');
  if (name === null) return; // Cancelado

  const notes = prompt('Anotações:', profile.notes || '');
  if (notes === null) return;

  try {
    const res = await fetch(`/api/profiles/${profileId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, notes }),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error);
    appendLog(null, 'success', `Perfil #${profileId} atualizado.`);
    await loadProfiles();
  } catch (err) {
    alert(`Erro ao atualizar perfil: ${err.message}`);
  }
}

// ── Remover perfil ────────────────────────────────────────────────────────────
async function deleteProfile(profileId) {
  if (!confirm(`Remover o perfil #${profileId}?\n\nIsso também removerá todas as atribuições a bots.`)) return;

  try {
    const res = await fetch(`/api/profiles/${profileId}`, { method: 'DELETE' });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error);
    appendLog(null, 'warn', `Perfil #${profileId} removido.`);
    await loadProfiles();
  } catch (err) {
    alert(`Erro ao remover perfil: ${err.message}`);
  }
}

// ── Gerenciar atribuições no modal do bot ─────────────────────────────────────

/**
 * Renderiza a lista de checkboxes de perfis no modal do bot.
 * Chamado ao abrir o modal e quando profiles:updated chega.
 */
async function renderModalAssignments() {
  const container = document.getElementById('modalAssignmentsList');
  if (!container) return;

  const botId = window._activeBotModal; // Exposto pelo dashboard.js
  if (!botId) return;

  const profiles = profilesState.profiles;

  if (profiles.length === 0) {
    container.innerHTML =
      '<div class="log-empty"><span>Nenhum perfil cadastrado. Adicione perfis na aba <strong>Perfis</strong>.</span></div>';
    return;
  }

  // Carrega as atribuições atuais do bot
  let currentAssignments = profilesState.assignments[botId] || [];

  try {
    const res = await fetch(`/api/bots/${botId}/assignments`);
    const data = await res.json();
    if (data.ok) {
      currentAssignments = data.assignments.map((a) => a.profile_id);
      profilesState.assignments[botId] = currentAssignments;
    }
  } catch (_) {}

  container.innerHTML = `
    <div class="assignments-grid">
      ${profiles
        .map(
          (p) => `
        <label class="assignment-checkbox-label" for="assign_${p.profile_id}">
          <input
            type="checkbox"
            id="assign_${p.profile_id}"
            class="assignment-checkbox"
            value="${p.profile_id}"
            ${currentAssignments.includes(p.profile_id) ? 'checked' : ''}
          />
          <span class="assignment-profile-info">
            <span class="profile-id-badge">#${p.profile_id}</span>
            <span class="assignment-profile-name">${escapeHtml(p.name) || 'Sem nome'}</span>
            ${p.notes ? `<span class="assignment-profile-notes">${escapeHtml(p.notes)}</span>` : ''}
          </span>
        </label>
      `
        )
        .join('')}
    </div>
    <div class="assignments-select-all">
      <button class="toolbar-btn" id="btnSelectAllAssign">Selecionar Todos</button>
      <button class="toolbar-btn" id="btnDeselectAllAssign">Desmarcar Todos</button>
      <span class="assignments-count" id="assignmentsCount">${currentAssignments.length} selecionado(s)</span>
    </div>
  `;

  // Selecionar / desmarcar todos
  document.getElementById('btnSelectAllAssign')?.addEventListener('click', () => {
    container.querySelectorAll('.assignment-checkbox').forEach((cb) => (cb.checked = true));
    updateAssignmentsCount();
  });
  document.getElementById('btnDeselectAllAssign')?.addEventListener('click', () => {
    container.querySelectorAll('.assignment-checkbox').forEach((cb) => (cb.checked = false));
    updateAssignmentsCount();
  });

  // Atualiza contador ao mudar checkbox
  container.querySelectorAll('.assignment-checkbox').forEach((cb) => {
    cb.addEventListener('change', updateAssignmentsCount);
  });
}

function updateAssignmentsCount() {
  const container = document.getElementById('modalAssignmentsList');
  const checked = container?.querySelectorAll('.assignment-checkbox:checked').length || 0;
  const el = document.getElementById('assignmentsCount');
  if (el) el.textContent = `${checked} selecionado(s)`;
}

function setupProfileAssignmentsModal() {
  // Salvar atribuições
  document.getElementById('modalBtnSaveAssignments')?.addEventListener('click', async () => {
    const botId = window._activeBotModal;
    if (!botId) return;

    const checkboxes = document.querySelectorAll('#modalAssignmentsList .assignment-checkbox:checked');
    const profileIds = [...checkboxes].map((cb) => parseInt(cb.value));

    try {
      const res = await fetch(`/api/bots/${botId}/assignments`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profileIds }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error);

      profilesState.assignments[botId] = profileIds;
      updateProfileStats();

      appendLog(null, 'success', `Bot ${botId.slice(0, 8)}: ${data.message}`);
      showToast('online', `💾 Perfis salvos para o bot.`, null);
    } catch (err) {
      alert(`Erro ao salvar atribuições: ${err.message}`);
    }
  });
}

// Expõe para uso pelo dashboard.js ao abrir o modal
window.profiles_onModalOpen = function (botId) {
  renderModalAssignments();
};

// Expõe funções globais usadas no onclick inline da tabela
window.editProfilePrompt = editProfilePrompt;
window.deleteProfile = deleteProfile;
