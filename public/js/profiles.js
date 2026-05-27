/**
 * public/js/profiles.js
 * Gerenciamento de perfis globais do IxBrowser e atribuições de perfis a bots.
 * Depende de: dashboard.js (state, escapeHtml, appendLog, showToast)
 */

'use strict';

function showToastModerno(message, type = 'info') {
  if (typeof window.showToastModerno === 'function') {
    window.showToastModerno(message, type);
  } else {
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
      <div class="toast-message">${message}</div>
    `;
    container.appendChild(box);
    setTimeout(() => {
      box.classList.add('toast-out');
      box.addEventListener('animationend', () => {
        box.remove();
        if (container.children.length === 0) container.remove();
      });
    }, 3000);
  }
}

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

document.addEventListener('bot:profiles_synced', (e) => {
  if (window._activeBotModal && e.detail.botId === window._activeBotModal) {
    renderModalAssignments();
  }
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
    renderModalAssignments();
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

      const openCount = p.open_count || 0;
      const openBadge = openCount > 0
        ? `<span class="open-count-badge" title="Última abertura: ${p.last_opened_at || '—'}">${openCount}x</span>`
        : `<span class="dim-text">0</span>`;

      return `
        <tr>
          <td><span class="profile-id-badge">#${p.profile_id}</span></td>
          <td>${escapeHtml(p.name) || '<span class="dim-text">—</span>'}</td>
          <td>${escapeHtml(p.notes) || '<span class="dim-text">—</span>'}</td>
          <td>
            <span class="device-badge ${(p.device_type || 'desktop').toLowerCase()}">
              ${(p.device_type || 'desktop') === 'mobile' ? '📱 Mobile' : '💻 Desktop'}
            </span>
          </td>
          <td>
            <span class="lang-badge">
              🌐 ${escapeHtml(p.browser_language || 'PT').toUpperCase()}
            </span>
          </td>
          <td class="dim-text">${p.created_at || '—'}</td>
          <td><div class="bot-link-badges">${botBadges}</div></td>
          <td style="text-align:center;">${openBadge}</td>
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

    const device_type = document.getElementById('pfSingleDevice').value;
    const browser_language = document.getElementById('pfSingleLang').value.trim() || 'PT';

    if (!profileId || profileId <= 0) {
      showToastModerno('Digite um ID de perfil válido.', 'warning');
      return;
    }

    await createProfiles([profileId], name, notes, device_type, browser_language);

    // Limpa formulário
    document.getElementById('pfSingleId').value = '';
    document.getElementById('pfSingleName').value = '';
    document.getElementById('pfSingleNotes').value = '';
    document.getElementById('pfSingleDevice').value = 'desktop';
    document.getElementById('pfSingleLang').value = 'PT';
  });

  // Em massa
  document.getElementById('btnAddBulkProfiles')?.addEventListener('click', async () => {
    const raw = document.getElementById('pfBulkIds').value;
    const ids = raw
      .split(/[\s,;]+/)
      .map((s) => parseInt(s.trim()))
      .filter((n) => !isNaN(n) && n > 0);

    const device_type = document.getElementById('pfBulkDevice').value;
    const browser_language = document.getElementById('pfBulkLang').value.trim() || 'PT';

    if (ids.length === 0) {
      showToastModerno('Nenhum ID válido encontrado. Use vírgulas, espaços ou quebras de linha.', 'warning');
      return;
    }

    await createProfiles(ids, null, null, device_type, browser_language);
    document.getElementById('pfBulkIds').value = '';
    document.getElementById('pfBulkDevice').value = 'desktop';
    document.getElementById('pfBulkLang').value = 'PT';
  });

  // Botão de atualizar
  document.getElementById('btnRefreshProfiles')?.addEventListener('click', loadProfiles);
}

async function createProfiles(profileIds, name, notes, device_type = 'desktop', browser_language = 'PT') {
  try {
    const res = await fetch('/api/profiles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profileIds, name, notes, device_type, browser_language }),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error);

    appendLog(null, 'success', `✅ Perfis: ${data.message}`);
    showToast('online', `✅ ${data.message}`, null);
    await loadProfiles();
  } catch (err) {
    showToastModerno(`Erro ao criar perfis: ${err.message}`, 'error');
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

  const devType = prompt('Dispositivo (desktop ou mobile):', profile.device_type || 'desktop');
  if (devType === null) return;
  const normalizedDev = devType.trim().toLowerCase();
  if (normalizedDev !== 'desktop' && normalizedDev !== 'mobile') {
    showToastModerno('Dispositivo inválido. Digite "desktop" ou "mobile".', 'warning');
    return;
  }

  const lang = prompt('Idioma do navegador (ex: PT, ENG):', profile.browser_language || 'PT');
  if (lang === null) return;

  try {
    const res = await fetch(`/api/profiles/${profileId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        notes,
        device_type: normalizedDev,
        browser_language: lang.trim().toUpperCase()
      }),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error);
    appendLog(null, 'success', `Perfil #${profileId} atualizado.`);
    await loadProfiles();
  } catch (err) {
    showToastModerno(`Erro ao atualizar perfil: ${err.message}`, 'error');
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
    showToastModerno(`Erro ao remover perfil: ${err.message}`, 'error');
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

  // Carrega atribuições atuais do bot e o estado de execução dos perfis
  let currentAssignments = profilesState.assignments[botId] || [];
  let botProfilesInfo = {};

  try {
    const [resAssign, resBot] = await Promise.all([
      fetch(`/api/bots/${botId}/assignments`),
      fetch(`/api/bots/${botId}`)
    ]);
    const dataAssign = await resAssign.json();
    const dataBot = await resBot.json();

    if (dataAssign.ok) {
      currentAssignments = dataAssign.assignments.map((a) => a.profile_id);
      profilesState.assignments[botId] = currentAssignments;
    }
    if (dataBot.ok && dataBot.profiles) {
      dataBot.profiles.forEach(bp => {
        botProfilesInfo[bp.profile_id] = bp;
      });
    }
  } catch (_) {}

  // Oculta perfis não vinculados conforme pedido do usuário
  const assignedProfiles = profiles.filter(p => currentAssignments.includes(p.profile_id));

  if (assignedProfiles.length === 0) {
    container.innerHTML = `
      <div class="profile-empty-state">
        <div class="empty-icon">🔗</div>
        <div class="empty-title">Nenhum perfil vinculado</div>
        <div class="empty-desc">Vá até a aba <strong>Perfis</strong> e clique em <strong>Vincular a Bot</strong>.</div>
      </div>`;
    updateAssignmentsCount();
    return;
  }

  // Carrega os vínculos perfil→módulo e a lista de módulos disponíveis
  let moduleLinksMap = {};
  let availableModules = [];
  try {
    const [resLinks, resMods] = await Promise.all([
      fetch('/api/profile-module-links'),
      fetch('/api/search-modules')
    ]);
    const dataLinks = await resLinks.json();
    const dataMods = await resMods.json();
    if (dataLinks.ok) {
      dataLinks.links.forEach(l => { moduleLinksMap[l.profile_id] = l; });
    }
    if (dataMods.ok) {
      availableModules = dataMods.modules || [];
    }
  } catch (_) {}

  container.innerHTML = `
    <table class="profiles-table assign-table">
      <thead>
        <tr>
          <th style="width:40px; text-align:center;">
            <input type="checkbox" id="assignCheckAll" title="Selecionar todos" checked style="accent-color:var(--accent); cursor:pointer;" />
          </th>
          <th>ID</th>
          <th style="text-align:center;">Status</th>
          <th style="text-align:center;">Click</th>
          <th>Nome</th>
          <th style="text-align:center;">Módulo</th>
          <th>País</th>
          <th>Estado / Cidade</th>
          <th>Anotações</th>
          <th style="text-align:center;">Atribuído</th>
          <th style="text-align:center;">Aberturas</th>
          <th style="text-align:center;">Config</th>
        </tr>
      </thead>
      <tbody>
        ${assignedProfiles.map((p) => {
          const checked = currentAssignments.includes(p.profile_id);
          const bpInfo = botProfilesInfo[p.profile_id] || { status: 'closed', open_count: 0 };
          
          const statusBadge = bpInfo.status === 'open' 
            ? `<span style="color:var(--green);font-weight:600;font-size:12px;" title="Aberto em: ${bpInfo.last_opened_at || '—'}">🟢 Aberto</span>`
            : `<span style="color:var(--red);font-weight:600;font-size:12px;" title="Fechado em: ${bpInfo.last_closed_at || '—'}">🔴 Fechado</span>`;

          const clickEnabled = p.click_enabled || 0;
          const clickCount = p.click_count !== undefined ? p.click_count : 3;

          const clickBadge = clickEnabled === 1
            ? `<span class="click-status-badge on" onclick="toggleClickConfig(${p.profile_id}, 0)" title="Clique para desativar os cliques">ON</span>`
            : `<span class="click-status-badge off" onclick="toggleClickConfig(${p.profile_id}, 1)" title="Clique para ativar os cliques">OFF</span>`;

          const openCount = p.open_count || 0;
          const openBadge = openCount > 0
            ? `<span class="open-count-badge" title="Última abertura: ${p.last_opened_at || '—'}">${openCount}x</span>`
            : `<span class="dim-text">0</span>`;

          const linkedModule = moduleLinksMap[p.profile_id];
          const moduleBadge = linkedModule
            ? `<span class="module-link-badge linked" title="Módulo: ${escapeHtml(linkedModule.label)}">${escapeHtml(linkedModule.label)}</span>`
            : `<span class="module-link-badge unlinked">—</span>`;

          const geoCountry = bpInfo.geo_country || '';
          const geoRegion = bpInfo.geo_region || '';
          const geoCity = bpInfo.geo_city || '';
          const geoRegionCity = [geoRegion, geoCity].filter(Boolean).join(' / ');

          const loopCount = p.loop_count !== undefined ? p.loop_count : 1;
          const isInfinite = !!p.infinite_loop;
          const loopText = isInfinite ? '∞' : `${loopCount}x`;

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
            <td style="text-align:center;">${statusBadge}</td>
            <td style="text-align:center;">
              <div style="display:inline-flex; align-items:center; gap:6px;">
                ${clickBadge}
                <button class="module-link-btn" onclick="openClickConfigModal(${p.profile_id})" title="Configurar cliques" style="padding:0; background:none; border:none; cursor:pointer;">⚙️</button>
              </div>
            </td>
            <td>${escapeHtml(p.name) || '<span class="dim-text">—</span>'}</td>
            <td style="text-align:center;">
              <div class="module-link-cell">
                ${moduleBadge}
                <button class="module-link-btn" onclick="openModuleSelector(${p.profile_id})" title="Vincular módulo">📦</button>
              </div>
            </td>
            <td>${geoCountry ? `<span class="geo-badge geo-country">🌍 ${escapeHtml(geoCountry)}</span>` : '<span class="dim-text">—</span>'}</td>
            <td>${geoRegionCity ? `<span class="geo-badge geo-region">📍 ${escapeHtml(geoRegionCity)}</span>` : '<span class="dim-text">—</span>'}</td>
            <td>${escapeHtml(p.notes) || '<span class="dim-text">—</span>'}</td>
            <td style="text-align:center;">
              <span class="assign-status-badge ${checked ? 'assigned' : 'unassigned'}">
                ${checked ? '✔ Sim' : '— Não'}
              </span>
            </td>
            <td style="text-align:center;">${openBadge}</td>
            <td style="text-align:center;">
              <div class="module-link-cell">
                <span class="module-link-badge ${isInfinite || loopCount > 1 ? 'linked' : 'unlinked'}" style="${isInfinite ? 'background:var(--purple-soft); color:var(--purple); border-color:rgba(139, 92, 246, 0.3);' : ''}">${loopText}</span>
                <button class="module-link-btn" onclick="openLoopConfigModal(${p.profile_id})" title="Configurar Repetição">⚙️</button>
              </div>
            </td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>`;

  // Guarda módulos disponíveis no estado para o seletor
  window._availableModules = availableModules;
  window._moduleLinksMap = moduleLinksMap;

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
      showToastModerno(`Erro ao salvar atribuições: ${err.message}`, 'error');
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
  // Pequeno timeout para garantir a transição CSS
  setTimeout(() => overlay.classList.add('visible'), 10);

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
  const overlay = document.getElementById('assignBotOverlay');
  if (overlay) {
    overlay.classList.remove('visible');
    setTimeout(() => {
      overlay.style.display = 'none';
    }, 300); // Tempo da transição CSS
  }
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
      showToastModerno(`Erro ao salvar vínculos: ${err.message}`, 'error');
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

// ── Modal Seletor de Módulo para Perfil ──────────────────────────────────────

/**
 * Abre um popup flutuante ao lado do botão clicado para escolher um módulo.
 * @param {number} profileId
 */
function openModuleSelector(profileId) {
  // Remove popup existente se houver
  document.getElementById('moduleSelectorPopup')?.remove();

  const modules = window._availableModules || [];
  const currentLink = (window._moduleLinksMap || {})[profileId];

  const popup = document.createElement('div');
  popup.id = 'moduleSelectorPopup';
  popup.className = 'module-selector-popup';
  popup.innerHTML = `
    <div class="module-selector-header">
      <span>📦 Módulo para #${profileId}</span>
      <button class="module-selector-close" onclick="closeModuleSelector()">✕</button>
    </div>
    <div class="module-selector-list">
      ${currentLink ? `
        <div class="module-selector-item active" onclick="unlinkModule(${profileId})">
          <span>❌</span>
          <span>Remover vínculo</span>
        </div>
      ` : ''}
      ${modules.length === 0
        ? '<div class="module-selector-empty">Nenhum módulo criado.<br>Vá até <strong>Palavras</strong> para criar.</div>'
        : modules.map(m => {
            const isSelected = currentLink && currentLink.module_id === m.id;
            const activeLabel = m.is_active ? '' : ' <span style="color:var(--red);font-size:10px;">(inativo)</span>';
            return `
              <div class="module-selector-item ${isSelected ? 'selected' : ''}" onclick="selectModuleForProfile(${profileId}, ${m.id})">
                <span>${isSelected ? '✅' : '📦'}</span>
                <span>${escapeHtml(m.label)}${activeLabel}</span>
                <span class="module-selector-count">${m.word_count || 0} palavras</span>
              </div>`;
          }).join('')
      }
    </div>
  `;

  document.body.appendChild(popup);

  // Posiciona perto do centro da tela
  requestAnimationFrame(() => {
    popup.classList.add('visible');
  });

  // Fecha ao clicar fora
  setTimeout(() => {
    document.addEventListener('click', _closeSelectorOnOutsideClick);
  }, 50);
}

function _closeSelectorOnOutsideClick(e) {
  const popup = document.getElementById('moduleSelectorPopup');
  if (popup && !popup.contains(e.target) && !e.target.classList.contains('module-link-btn')) {
    closeModuleSelector();
  }
}

function closeModuleSelector() {
  const popup = document.getElementById('moduleSelectorPopup');
  if (popup) {
    popup.classList.remove('visible');
    setTimeout(() => popup.remove(), 200);
  }
  document.removeEventListener('click', _closeSelectorOnOutsideClick);
}

async function selectModuleForProfile(profileId, moduleId) {
  try {
    const res = await fetch(`/api/profiles/${profileId}/module`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ module_id: moduleId }),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error);

    closeModuleSelector();
    if (typeof showToast === 'function') showToast('online', `📦 Módulo vinculado ao perfil #${profileId}!`);
    renderModalAssignments(); // Recarrega tabela
  } catch (err) {
    showToastModerno(`Erro ao vincular módulo: ${err.message}`, 'error');
  }
}

async function unlinkModule(profileId) {
  try {
    const res = await fetch(`/api/profiles/${profileId}/module`, { method: 'DELETE' });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error);

    closeModuleSelector();
    if (typeof showToast === 'function') showToast('offline', `❌ Módulo desvinculado do perfil #${profileId}`);
    renderModalAssignments();
  } catch (err) {
    showToastModerno(`Erro ao desvincular módulo: ${err.message}`, 'error');
  }
}

// ── Modal de Configuração de Loop (Repetição) ─────────────────────────────────
let _loopConfigTargetProfileId = null;

function openLoopConfigModal(profileId) {
  _loopConfigTargetProfileId = profileId;
  const profile = profilesState.profiles.find((p) => p.profile_id === profileId);
  if (!profile) return;

  const overlay = document.getElementById('loopConfigOverlay');
  const label = document.getElementById('loopConfigProfileLabel');
  const infiniteCheckbox = document.getElementById('loopConfigInfinite');
  const countInput = document.getElementById('loopConfigCount');
  const countGroup = document.getElementById('loopConfigCountGroup');
  const randomFpCheckbox = document.getElementById('loopConfigRandomFp');
  const cleanCacheCheckbox = document.getElementById('loopConfigCleanCache');

  if (!overlay) return;

  label.textContent = `#${profileId} (${profile.name || 'Sem Nome'})`;
  infiniteCheckbox.checked = !!profile.infinite_loop;
  countInput.value = profile.loop_count !== undefined ? profile.loop_count : 1;

  if (randomFpCheckbox) randomFpCheckbox.checked = !!profile.random_fp;
  if (cleanCacheCheckbox) cleanCacheCheckbox.checked = !!profile.clean_cache;

  if (infiniteCheckbox.checked) {
    countGroup.style.display = 'none';
  } else {
    countGroup.style.display = 'block';
  }

  overlay.style.display = 'flex';
  setTimeout(() => overlay.classList.add('visible'), 10);
}

function closeLoopConfigModal() {
  _loopConfigTargetProfileId = null;
  const overlay = document.getElementById('loopConfigOverlay');
  if (overlay) {
    overlay.classList.remove('visible');
    setTimeout(() => {
      overlay.style.display = 'none';
    }, 300);
  }
}

// Setup Event Listeners para o Modal de Configuração de Loop
document.addEventListener('DOMContentLoaded', () => {
  const overlay = document.getElementById('loopConfigOverlay');
  const infiniteCheckbox = document.getElementById('loopConfigInfinite');
  const countGroup = document.getElementById('loopConfigCountGroup');
  const randomFpCheckbox = document.getElementById('loopConfigRandomFp');
  const cleanCacheCheckbox = document.getElementById('loopConfigCleanCache');

  document.getElementById('loopConfigClose')?.addEventListener('click', closeLoopConfigModal);
  document.getElementById('loopConfigCancel')?.addEventListener('click', closeLoopConfigModal);
  overlay?.addEventListener('click', (e) => {
    if (e.target === overlay) closeLoopConfigModal();
  });

  infiniteCheckbox?.addEventListener('change', () => {
    if (infiniteCheckbox.checked) {
      countGroup.style.display = 'none';
    } else {
      countGroup.style.display = 'block';
    }
  });

  document.getElementById('loopConfigSave')?.addEventListener('click', async () => {
    const profileId = _loopConfigTargetProfileId;
    if (!profileId) return;

    const isInfinite = infiniteCheckbox.checked;
    const loopCount = isInfinite ? 1 : parseInt(document.getElementById('loopConfigCount').value);
    const randomFp = randomFpCheckbox ? (randomFpCheckbox.checked ? 1 : 0) : 0;
    const cleanCache = cleanCacheCheckbox ? (cleanCacheCheckbox.checked ? 1 : 0) : 0;

    if (!isInfinite && (isNaN(loopCount) || loopCount < 1)) {
      showToastModerno('Por favor, insira um número válido de repetições (mínimo 1).', 'warning');
      return;
    }

    const btn = document.getElementById('loopConfigSave');
    btn.disabled = true;
    btn.textContent = 'Salvando...';

    try {
      const res = await fetch(`/api/profiles/${profileId}/loop-config`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          loop_count: loopCount,
          infinite_loop: isInfinite ? 1 : 0,
          random_fp: randomFp,
          clean_cache: cleanCache
        }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error);

      if (typeof showToast === 'function') {
        showToast('online', `⚙️ Configurações gerais salvas para o perfil #${profileId}!`, null);
      }
      closeLoopConfigModal();
      await loadProfiles();
    } catch (err) {
      showToastModerno(`Erro ao salvar configurações de repetição: ${err.message}`, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = '💾 Salvar Configurações';
    }
  });
});

// ── Modal de Configuração de Cliques (Blacklist) ──────────────────────────────
let _clickConfigTargetProfileId = null;

function openClickConfigModal(profileId) {
  _clickConfigTargetProfileId = profileId;
  const profile = profilesState.profiles.find((p) => p.profile_id === profileId);
  if (!profile) return;

  const overlay = document.getElementById('clickConfigOverlay');
  const label = document.getElementById('clickConfigProfileLabel');
  const countInput = document.getElementById('clickConfigCount');

  if (!overlay) return;

  label.textContent = `#${profileId} (${profile.name || 'Sem Nome'})`;
  countInput.value = profile.click_count !== undefined ? profile.click_count : 3;

  overlay.style.display = 'flex';
  setTimeout(() => overlay.classList.add('visible'), 10);
}

function closeClickConfigModal() {
  _clickConfigTargetProfileId = null;
  const overlay = document.getElementById('clickConfigOverlay');
  if (overlay) {
    overlay.classList.remove('visible');
    setTimeout(() => {
      overlay.style.display = 'none';
    }, 300);
  }
}

async function toggleClickConfig(profileId, isEnabled) {
  const profile = profilesState.profiles.find((p) => p.profile_id === profileId);
  if (!profile) return;
  const clickCount = profile.click_count !== undefined ? profile.click_count : 3;

  try {
    const res = await fetch(`/api/profiles/${profileId}/click-config`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        click_enabled: isEnabled,
        click_count: clickCount
      }),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error);

    if (typeof showToast === 'function') {
      showToast('online', `🖱️ Cliques ${isEnabled ? 'ativados' : 'desativados'} para o perfil #${profileId}!`, null);
    }
    await loadProfiles();
  } catch (err) {
    showToastModerno(`Erro ao atualizar configuração de cliques: ${err.message}`, 'error');
  }
}

// Setup Event Listeners para o Modal de Configuração de Cliques
document.addEventListener('DOMContentLoaded', () => {
  const clickOverlay = document.getElementById('clickConfigOverlay');
  document.getElementById('clickConfigClose')?.addEventListener('click', closeClickConfigModal);
  document.getElementById('clickConfigCancel')?.addEventListener('click', closeClickConfigModal);
  clickOverlay?.addEventListener('click', (e) => {
    if (e.target === clickOverlay) closeClickConfigModal();
  });

  document.getElementById('clickConfigSave')?.addEventListener('click', async () => {
    const profileId = _clickConfigTargetProfileId;
    if (!profileId) return;

    const clickCount = parseInt(document.getElementById('clickConfigCount').value);

    if (isNaN(clickCount) || clickCount < 0) {
      showToastModerno('Por favor, insira um número válido de cliques (mínimo 0).', 'warning');
      return;
    }

    const btn = document.getElementById('clickConfigSave');
    btn.disabled = true;
    btn.textContent = 'Salvando...';

    // Obtém o estado atual de click_enabled
    const profile = profilesState.profiles.find((p) => p.profile_id === profileId);
    const clickEnabled = profile ? (profile.click_enabled || 0) : 0;

    try {
      const res = await fetch(`/api/profiles/${profileId}/click-config`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          click_enabled: clickEnabled,
          click_count: clickCount
        }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error);

      if (typeof showToast === 'function') {
        showToast('online', `⚙️ Configuração de cliques salva para o perfil #${profileId}!`, null);
      }
      closeClickConfigModal();
      await loadProfiles();
    } catch (err) {
      showToastModerno(`Erro ao salvar configurações de cliques: ${err.message}`, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = '💾 Salvar Configurações';
    }
  });
});

// Expõe funções globais usadas no onclick inline da tabela
window.editProfilePrompt = editProfilePrompt;
window.deleteProfile = deleteProfile;
window.openAssignBotModal = openAssignBotModal;
window.openModuleSelector = openModuleSelector;
window.closeModuleSelector = closeModuleSelector;
window.selectModuleForProfile = selectModuleForProfile;
window.unlinkModule = unlinkModule;
window.openLoopConfigModal = openLoopConfigModal;
window.closeLoopConfigModal = closeLoopConfigModal;
window.openClickConfigModal = openClickConfigModal;
window.closeClickConfigModal = closeClickConfigModal;
window.toggleClickConfig = toggleClickConfig;
