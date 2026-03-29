/**
 * public/js/profiles.js
 * Gerenciamento de perfis globais do IxBrowser e atribuições de perfis a bots.
 * Depende de: dashboard.js (state, escapeHtml, appendLog, showToast)
 */

'use strict';

// ── Estado dos perfis ─────────────────────────────────────────────────────────
const profilesState = {
  profiles: [],        // Array de ix_profiles
  assignments: {},     // { botId: [profileIds] } — cache local (por bot)
  allAssignments: {},  // { profileId: [{ botId, botName }] } — cache por perfil
  _isBusy: false,      // Flag para evitar re-render durante operações (delete, edit)
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

  // Se estamos no meio de uma operação (delete/edit), adia o re-render
  if (profilesState._isBusy) return;

  renderProfilesTable();
  updateProfileStats();
  renderModalAssignments(); // Atualiza lista no modal se aberto
});

// ── Carregar perfis da API ────────────────────────────────────────────────────
async function loadProfiles() {
  try {
    const [profRes, assignRes] = await Promise.all([
      fetch('/api/profiles'),
      fetch('/api/profiles/all-assignments'),
    ]);
    const [profData, assignData] = await Promise.all([profRes.json(), assignRes.json()]);
    if (!profData.ok) throw new Error(profData.error);
    profilesState.profiles = profData.profiles || [];
    profilesState.allAssignments = assignData.ok ? (assignData.assignments || {}) : {};
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
    .map((p) => {
      const bots = profilesState.allAssignments[p.profile_id] || [];
      const botBadges = bots.length > 0
        ? bots.map((b) => `<span class="bot-link-badge" title="${b.botId}">${escapeHtml(b.botName)}</span>`).join('')
        : '<span class="dim-text">Nenhum</span>';

      return `
        <tr>
          <td><span class="profile-id-badge">#${p.profile_id}</span></td>
          <td>${escapeHtml(p.name) || '<span class="dim-text">—</span>'}</td>
          <td>${escapeHtml(p.notes) || '<span class="dim-text">—</span>'}</td>
          <td class="dim-text">${p.created_at || '—'}</td>
          <td><div class="bot-link-badges">${botBadges}</div></td>
          <td>
            <div class="profile-actions">
              <button type="button" class="toolbar-btn accent" onclick="openAssignBotModal(${p.profile_id})" title="Vincular a Bot">🔗 Vincular</button>
              <button type="button" class="toolbar-btn" onclick="editProfilePrompt(${p.profile_id})" title="Editar">✏️</button>
              <button type="button" class="toolbar-btn danger" onclick="deleteProfile(${p.profile_id})" title="Remover">🗑️</button>
            </div>
          </td>
        </tr>`;
    })
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

// ── Modal de Confirmação Customizado ──────────────────────────────────────────
// Substitui o confirm() nativo — imune a Socket.io, re-renders e políticas do browser.

/**
 * Exibe um modal de confirmação estilizado e retorna uma Promise.
 * @param {string} title - Título do modal
 * @param {string} body  - Corpo da mensagem (aceita HTML)
 * @param {string} [confirmText='🗑️ Remover'] - Texto do botão de confirmação
 * @returns {Promise<boolean>} true se confirmado, false se cancelado
 */
function showConfirmModal(title, body, confirmText = '🗑️ Remover') {
  return new Promise((resolve) => {
    const overlay   = document.getElementById('confirmModalOverlay');
    const titleEl   = document.getElementById('confirmModalTitle');
    const bodyEl    = document.getElementById('confirmModalBody');
    const btnCancel = document.getElementById('confirmModalCancel');
    const btnConfirm = document.getElementById('confirmModalConfirm');
    if (!overlay) { resolve(false); return; }

    titleEl.textContent = title;
    bodyEl.innerHTML = body;
    btnConfirm.innerHTML = confirmText;
    btnConfirm.disabled = false;

    // Abre o modal
    overlay.classList.add('visible');

    // Cleanup: remove listeners antigos para evitar duplicatas
    const newBtnCancel  = btnCancel.cloneNode(true);
    const newBtnConfirm = btnConfirm.cloneNode(true);
    btnCancel.parentNode.replaceChild(newBtnCancel, btnCancel);
    btnConfirm.parentNode.replaceChild(newBtnConfirm, btnConfirm);

    function close(result) {
      overlay.classList.remove('visible');
      resolve(result);
    }

    newBtnCancel.addEventListener('click', () => close(false));
    newBtnConfirm.addEventListener('click', () => close(true));

    // Fechar ao clicar no overlay (fora do modal)
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close(false);
    }, { once: true });

    // Fechar com Escape
    const onKey = (e) => {
      if (e.key === 'Escape') {
        document.removeEventListener('keydown', onKey);
        close(false);
      }
    };
    document.addEventListener('keydown', onKey);
  });
}

// ── Remover perfil ────────────────────────────────────────────────────────────
async function deleteProfile(profileId) {
  // Bloqueia re-render via socket durante a operação
  profilesState._isBusy = true;

  const confirmed = await showConfirmModal(
    'Remover Perfil',
    `Tem certeza que deseja remover o perfil <strong>#${profileId}</strong>?<br><br>` +
    `<span style="color:var(--text-muted);">Isso também removerá todas as atribuições deste perfil a bots.</span>`,
    '🗑️ Remover'
  );

  if (!confirmed) {
    profilesState._isBusy = false;
    return;
  }

  // Desabilita botão enquanto processa
  const btnConfirm = document.getElementById('confirmModalConfirm');
  if (btnConfirm) { btnConfirm.disabled = true; btnConfirm.innerHTML = '⏳ Removendo...'; }

  try {
    const res = await fetch(`/api/profiles/${profileId}`, { method: 'DELETE' });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error);
    appendLog(null, 'warn', `Perfil #${profileId} removido.`);
    showToast('offline', `🗑️ Perfil #${profileId} removido com sucesso.`, null);
  } catch (err) {
    alert(`Erro ao remover perfil: ${err.message}`);
  } finally {
    profilesState._isBusy = false;
    // Agora faz o re-render que foi adiado
    renderProfilesTable();
    updateProfileStats();
    renderModalAssignments();
  }
}

// ── Gerenciar atribuições no modal do bot ─────────────────────────────────────

/**
 * Renderiza perfis do bot em tabela (igual à aba Perfis).
 * Chamado ao abrir a página de controle e quando profiles:updated chega.
 */
async function renderModalAssignments() {
  const container = document.getElementById('ctrlAssignmentsList') || document.getElementById('modalAssignmentsList');
  if (!container) return;

  const botId = window._activeBotModal;
  if (!botId) return;

  const profiles = profilesState.profiles;

  if (profiles.length === 0) {
    container.innerHTML = `
      <div class="profile-empty-state">
        <div class="empty-icon">👤</div>
        <div class="empty-title">Nenhum perfil cadastrado</div>
        <div class="empty-desc">Adicione perfis na aba <strong>Perfis</strong>.</div>
      </div>`;
    updateAssignmentsCount();
    return;
  }

  // Carrega atribuições atuais do bot
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
    <table class="profiles-table assign-table">
      <thead>
        <tr>
          <th style="width:40px; text-align:center;">
            <input type="checkbox" id="assignCheckAll" title="Selecionar todos" style="accent-color:var(--accent); cursor:pointer;" />
          </th>
          <th>ID</th>
          <th>Nome</th>
          <th>Anotações</th>
          <th style="text-align:center;">Atribuído</th>
        </tr>
      </thead>
      <tbody>
        ${profiles.map((p) => {
          const checked = currentAssignments.includes(p.profile_id);
          return `
          <tr class="${checked ? 'assign-row-active' : ''}">
            <td style="text-align:center;">
              <input
                type="checkbox"
                class="assignment-checkbox"
                id="assign_${p.profile_id}"
                value="${p.profile_id}"
                ${checked ? 'checked' : ''}
                style="accent-color:var(--accent); cursor:pointer; width:15px; height:15px;"
              />
            </td>
            <td><span class="profile-id-badge">#${p.profile_id}</span></td>
            <td>${escapeHtml(p.name) || '<span class="dim-text">—</span>'}</td>
            <td>${escapeHtml(p.notes) || '<span class="dim-text">—</span>'}</td>
            <td style="text-align:center;">
              <span class="assign-status-badge ${checked ? 'assigned' : 'unassigned'}">
                ${checked ? '✔ Sim' : '— Não'}
              </span>
            </td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>`;

  // Checkbox "marcar todos" no cabeçalho
  const checkAll = document.getElementById('assignCheckAll');
  checkAll?.addEventListener('change', () => {
    container.querySelectorAll('.assignment-checkbox').forEach((cb) => {
      cb.checked = checkAll.checked;
      _updateRowHighlight(cb);
    });
    updateAssignmentsCount();
  });

  // Highlight de linha + contador ao mudar checkbox individual
  container.querySelectorAll('.assignment-checkbox').forEach((cb) => {
    cb.addEventListener('change', () => {
      _updateRowHighlight(cb);
      updateAssignmentsCount();
    });
  });

  // Botões do header (Selecionar Todos / Desmarcar Todos)
  document.getElementById('btnSelectAllAssign')?.addEventListener('click', () => {
    container.querySelectorAll('.assignment-checkbox').forEach((cb) => { cb.checked = true; _updateRowHighlight(cb); });
    if (checkAll) checkAll.checked = true;
    updateAssignmentsCount();
  });
  document.getElementById('btnDeselectAllAssign')?.addEventListener('click', () => {
    container.querySelectorAll('.assignment-checkbox').forEach((cb) => { cb.checked = false; _updateRowHighlight(cb); });
    if (checkAll) checkAll.checked = false;
    updateAssignmentsCount();
  });

  updateAssignmentsCount();
}

function _updateRowHighlight(cb) {
  const row = cb.closest('tr');
  if (!row) return;
  if (cb.checked) {
    row.classList.add('assign-row-active');
    const badge = row.querySelector('.assign-status-badge');
    if (badge) { badge.className = 'assign-status-badge assigned'; badge.textContent = '✔ Sim'; }
  } else {
    row.classList.remove('assign-row-active');
    const badge = row.querySelector('.assign-status-badge');
    if (badge) { badge.className = 'assign-status-badge unassigned'; badge.textContent = '— Não'; }
  }
}

function updateAssignmentsCount() {
  const container = document.getElementById('ctrlAssignmentsList') || document.getElementById('modalAssignmentsList');
  const checked = container?.querySelectorAll('.assignment-checkbox:checked').length || 0;
  const el = document.getElementById('assignmentsCount');
  if (el) el.textContent = `${checked} selecionado(s)`;
}

function setupProfileAssignmentsModal() {
  // Salvar atribuições (suporte aos dois botões: novo (ctrlBtn) e legado)
  const saveBtn = document.getElementById('ctrlBtnSaveAssignments') || document.getElementById('modalBtnSaveAssignments');
  saveBtn?.addEventListener('click', async () => {
    const botId = window._activeBotModal;
    if (!botId) return;

    const container = document.getElementById('ctrlAssignmentsList') || document.getElementById('modalAssignmentsList');
    const checkboxes = container?.querySelectorAll('.assignment-checkbox:checked') || [];
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

// ── Modal: Vincular Perfil a Bot ──────────────────────────────────────────────

let _assignBotTargetProfileId = null;

/**
 * Abre o modal de vínculo para um perfil específico.
 * Lista todos os bots com checkbox marcado nos que já têm este perfil.
 */
async function openAssignBotModal(profileId) {
  _assignBotTargetProfileId = profileId;
  const overlay = document.getElementById('assignBotOverlay');
  const label   = document.getElementById('assignBotProfileLabel');
  const list    = document.getElementById('assignBotList');
  if (!overlay || !list) return;

  label.textContent = `#${profileId}`;
  list.innerHTML = '<div class="log-empty"><span>Carregando bots...</span></div>';
  overlay.style.display = 'flex';

  try {
    // Carrega todos os bots
    const res  = await fetch('/api/bots');
    const data = await res.json();
    const bots = data.bots || [];

    if (bots.length === 0) {
      list.innerHTML = '<div class="log-empty"><span>Nenhum bot registrado no dashboard.</span></div>';
      return;
    }

    // Para cada bot, verifica se este perfil já está atribuído
    const checks = await Promise.all(
      bots.map(async (bot) => {
        const r = await fetch(`/api/bots/${bot.bot_id}/assignments`);
        const d = await r.json();
        const assigned = d.ok ? d.assignments.some((a) => a.profile_id === profileId) : false;
        return { bot, assigned };
      })
    );

    list.innerHTML = checks.map(({ bot, assigned }) => `
      <label class="assign-bot-item" for="assignBot_${bot.bot_id}">
        <input
          type="checkbox"
          id="assignBot_${bot.bot_id}"
          class="assign-bot-checkbox"
          value="${bot.bot_id}"
          ${assigned ? 'checked' : ''}
          style="accent-color:var(--accent); width:15px; height:15px; cursor:pointer; flex-shrink:0;"
        />
        <div class="assign-bot-info">
          <span class="assign-bot-name">${escapeHtml(bot.name) || bot.bot_id.slice(0, 12)}</span>
          <span class="assign-bot-status ${bot.status === 'online' ? 'online' : 'offline'}">
            ${bot.status === 'online' ? '● Online' : '● Offline'}
          </span>
        </div>
      </label>
    `).join('');

  } catch (err) {
    list.innerHTML = `<div class="log-empty"><span>Erro ao carregar bots: ${escapeHtml(err.message)}</span></div>`;
  }
}

function closeAssignBotModal() {
  _assignBotTargetProfileId = null;
  document.getElementById('assignBotOverlay').style.display = 'none';
}

// Listeners do modal de vínculo
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('assignBotClose')?.addEventListener('click', closeAssignBotModal);
  document.getElementById('assignBotCancel')?.addEventListener('click', closeAssignBotModal);
  document.getElementById('assignBotOverlay')?.addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeAssignBotModal();
  });

  document.getElementById('assignBotSave')?.addEventListener('click', async () => {
    const profileId = _assignBotTargetProfileId;
    if (!profileId) return;

    const checkboxes = document.querySelectorAll('.assign-bot-checkbox');
    const btn = document.getElementById('assignBotSave');
    btn.disabled = true;
    btn.textContent = 'Salvando...';

    try {
      // Para cada bot: adiciona ou remove o perfil conforme checkbox
      for (const cb of checkboxes) {
        const botId = cb.value;
        // Carrega assignments atuais do bot
        const r = await fetch(`/api/bots/${botId}/assignments`);
        const d = await r.json();
        let current = d.ok ? d.assignments.map((a) => a.profile_id) : [];

        if (cb.checked && !current.includes(profileId)) {
          current = [...current, profileId];
        } else if (!cb.checked && current.includes(profileId)) {
          current = current.filter((id) => id !== profileId);
        } else {
          continue; // Sem mudança
        }

        await fetch(`/api/bots/${botId}/assignments`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ profileIds: current }),
        });
      }

      showToast('online', `🔗 Vínculos do perfil #${profileId} atualizados!`, null);
      closeAssignBotModal();
      await loadProfiles(); // Recarrega tabela com novos badges
    } catch (err) {
      alert(`Erro ao salvar vínculos: ${err.message}`);
    } finally {
      btn.disabled = false;
      btn.textContent = '💾 Salvar Vínculos';
    }
  });
});

// Expõe para uso pelo dashboard.js ao abrir o modal
window.profiles_onModalOpen = function (botId) {
  renderModalAssignments();
};

// Expõe funções globais usadas no onclick inline da tabela
window.editProfilePrompt = editProfilePrompt;
window.deleteProfile = deleteProfile;
window.openAssignBotModal = openAssignBotModal;
