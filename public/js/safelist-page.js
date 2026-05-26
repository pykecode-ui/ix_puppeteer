/**
 * public/js/safelist-page.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Módulo da página dedicada de Anúncios na Safelist (Whitelist).
 * Exibe apenas os anúncios marcados como seguros, com suporte a busca,
 * ordenação, paginação e WebSocket para atualizações em tempo real.
 * ─────────────────────────────────────────────────────────────────────────────
 */

// ── Estado ──────────────────────────────────────────────────────────────────
const safelistState = {
  ads: [],
  total: 0,
  page: 0,
  perPage: 30,
  filterKeyword: '',
  filterDomain: '',
  orderBy: 'recent' // 'recent' ou 'repetitions'
};

// ── Helpers ─────────────────────────────────────────────────────────────────

function escapeHtmlAds(str) {
  if (!str) return '';
  const el = document.createElement('span');
  el.textContent = str;
  return el.innerHTML;
}

function truncate(str, max = 60) {
  if (!str) return '—';
  return str.length > max ? str.slice(0, max) + '…' : str;
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
    <div class="toast-message">${escapeHtmlAds(message)}</div>
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

function positionBadge(pos) {
  const map = {
    top:     { label: '⬆ Topo', cls: 'pos-top' },
    bottom:  { label: '⬇ Rodapé', cls: 'pos-bottom' },
    unknown: { label: '— ?', cls: 'pos-unknown' },
  };
  const info = map[pos] || map.unknown;
  return `<span class="ad-pos-badge ${info.cls}">${info.label}</span>`;
}

function flagBadges(ad) {
  let html = '';
  if (ad.is_blacklisted) {
    html += `<span class="ad-flag blacklisted" title="Blacklisted">
      <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="margin-right:3px;"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>
      Blacklist
    </span>`;
  }
  if (ad.is_whitelisted) {
    html += `<span class="ad-flag whitelisted" title="Safelist">
      <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="margin-right:3px;"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 11 2 2 4-4"/></svg>
      Safelist
    </span>`;
  }
  if (ad.is_suspicious && !ad.is_blacklisted && !ad.is_whitelisted) {
    html += `<span class="ad-flag suspicious" title="Suspeito">
      <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="margin-right:3px;"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
      Suspeito
    </span>`;
  }
  return html || '<span class="dim-text">—</span>';
}

function createEmptyState() {
  const div = document.createElement('div');
  div.className = 'profile-empty-state';
  div.id = 'adsEmptyState';
  div.innerHTML = `
    <div class="empty-icon">📢</div>
    <div class="empty-title">Nenhum anúncio na safelist encontrado</div>
    <div class="empty-desc">Anúncios marcados como safelist aparecerão aqui em tempo real.</div>
  `;
  return div;
}

// ── Carregar Anúncios da Safelist ───────────────────────────────────────────

async function loadSafelistAds() {
  const offset = safelistState.page * safelistState.perPage;
  const params = new URLSearchParams({
    limit: safelistState.perPage,
    offset,
    is_whitelisted: 'true',
    orderBy: safelistState.orderBy
  });

  if (safelistState.filterKeyword) params.set('keyword', safelistState.filterKeyword);
  if (safelistState.filterDomain) params.set('domain', safelistState.filterDomain);

  try {
    const res = await fetch(`/api/ads/all?${params}`);
    const data = await res.json();
    if (!data.ok) return;

    safelistState.ads = data.ads || [];
    safelistState.total = data.total || 0;

    renderAdsTable();
    updatePagination();
  } catch (err) {
    console.error('[Safelist] Erro ao carregar anúncios:', err);
  }
}

// ── Renderizar Tabela ───────────────────────────────────────────────────────

function renderAdsTable() {
  const container = document.getElementById('adsTableContainer');
  const emptyState = document.getElementById('adsEmptyState');

  if (safelistState.ads.length === 0) {
    container.innerHTML = '';
    container.appendChild(emptyState || createEmptyState());
    if (emptyState) emptyState.style.display = 'flex';
    return;
  }

  if (emptyState) emptyState.style.display = 'none';

  const table = document.createElement('table');
  table.className = 'profiles-table ads-table';
  table.innerHTML = `
    <thead>
      <tr>
        <th style="text-align:center; width:55px;">Vezes</th>
        <th style="text-align:center; width:70px;">Posição</th>
        <th>Keywords</th>
        <th>Título do Anúncio</th>
        <th>URL de Exibição</th>
        <th>data-pcu</th>
        <th>data-rw</th>
        <th>País</th>
        <th>Estado / Cidade</th>
        <th style="text-align:center; width:60px;">Flags</th>
        <th style="width:130px;">Primeira vez</th>
        <th style="width:130px;">Última vez</th>
        <th style="width:50px; text-align:center;">Ação</th>
      </tr>
    </thead>
    <tbody>
      ${safelistState.ads.map(ad => {
        const reps = ad.repetitions || 1;
        const repClass = reps >= 5 ? 'rep-high' : reps >= 2 ? 'rep-mid' : 'rep-low';
        const kwList = (ad.keywords || ad.keyword || '').split(',').filter(Boolean);
        const kwChips = kwList.map(kw => `<span class="ad-keyword-chip" title="${escapeHtmlAds(kw.trim())}">${escapeHtmlAds(kw.trim())}</span>`).join(' ');

        const pcuVal = ad.data_pcu || '';
        const rwVal = ad.data_rw || '';

        const titles = [...new Set((ad.all_titles || ad.ad_title || '').split(' ||| ').map(t => t.trim()).filter(Boolean))];

        return `
        <tr data-ad-ids="${ad.all_ids || ad.id}" class="ad-row-whitelisted">
          <td style="text-align:center;">
            <span class="ad-rep-badge ${repClass}">${reps}x</span>
          </td>
          <td style="text-align:center;">${positionBadge(ad.position)}</td>
          <td>
            <div class="ad-keywords-wrap">${kwChips}</div>
          </td>
          <td>
            <div class="ad-title-cell-wrap" style="display:flex; align-items:center; gap:8px;">
              <div class="ad-title-cell" title="${escapeHtmlAds(ad.ad_title)}" style="flex:1;">
                ${escapeHtmlAds(truncate(ad.ad_title, 50))}
              </div>
              <button class="ad-details-btn toolbar-btn" 
                      data-domain="${escapeHtmlAds(ad.display_url)}" 
                      data-titles="${escapeHtmlAds(titles.join(' ||| '))}" 
                      title="Ver todos os títulos (${titles.length})" 
                      style="padding:2px 6px; font-size:11px; display:inline-flex; align-items:center; gap:4px; cursor:pointer;">
                📋 Info (${titles.length})
              </button>
            </div>
            ${ad.ad_description ? `<div class="ad-desc-cell">${escapeHtmlAds(truncate(ad.ad_description, 70))}</div>` : ''}
          </td>
          <td>
            <span class="ad-display-url" title="${escapeHtmlAds(ad.display_url)}">${escapeHtmlAds(truncate(ad.display_url, 35))}</span>
          </td>
          <td>
            ${pcuVal
              ? `<div class="ad-data-cell">
                   <a href="${escapeHtmlAds(pcuVal)}" target="_blank" rel="noopener" class="ad-link ad-data-link" title="${escapeHtmlAds(pcuVal)}">data-pcu</a>
                   <button class="ad-copy-btn" data-copy="${escapeHtmlAds(pcuVal)}" title="Copiar data-pcu">📋</button>
                 </div>`
              : '<span class="dim-text">—</span>'
            }
          </td>
          <td>
            ${rwVal
              ? `<div class="ad-data-cell">
                   <a href="${escapeHtmlAds(rwVal)}" target="_blank" rel="noopener" class="ad-link ad-data-link" title="${escapeHtmlAds(rwVal)}">data-rw</a>
                   <button class="ad-copy-btn" data-copy="${escapeHtmlAds(rwVal)}" title="Copiar data-rw">📋</button>
                 </div>`
              : '<span class="dim-text">—</span>'
            }
          </td>
          <td>${ad.geo_country ? `<span class="geo-badge geo-country">🌍 ${escapeHtmlAds(ad.geo_country)}</span>` : '<span class="dim-text">—</span>'}</td>
          <td>${(ad.geo_region || ad.geo_city) ? `<span class="geo-badge geo-region">📍 ${escapeHtmlAds([ad.geo_region, ad.geo_city].filter(Boolean).join(' / '))}</span>` : '<span class="dim-text">—</span>'}</td>
          <td style="text-align:center;">${flagBadges(ad)}</td>
          <td style="font-size:12px; color:var(--text-secondary);">${ad.first_found_at || ad.found_at || '—'}</td>
          <td style="font-size:12px; color:var(--text-secondary);">${ad.found_at || '—'}</td>
          <td style="text-align:center;">
            <div style="display:flex; gap:10px; justify-content:center; align-items:center;">
              <button class="ad-action-btn blacklist ad-add-blacklist-btn" data-domain="${escapeHtmlAds(ad.display_url)}" title="Adicionar domínio à Blacklist">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>
              </button>
              <button class="ad-action-btn whitelist ad-add-whitelist-btn" data-domain="${escapeHtmlAds(ad.display_url)}" title="Adicionar domínio à Safelist">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 11 2 2 4-4"/></svg>
              </button>
              <button class="ad-action-btn delete ad-delete-btn" data-ad-ids="${ad.all_ids || ad.id}" title="Excluir anúncio (${reps} registro${reps > 1 ? 's' : ''})">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
              </button>
            </div>
          </td>
        </tr>
      `}).join('')}
    </tbody>
  `;

  container.innerHTML = '';
  container.appendChild(table);

  // Bind dos botões de detalhes/info
  table.querySelectorAll('.ad-details-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const domain = btn.dataset.domain;
      const titlesStr = btn.dataset.titles;
      const titles = titlesStr.split(' ||| ').filter(Boolean);
      openAdTitlesModal(domain, titles);
    });
  });

  // Bind dos botões de copiar links
  table.querySelectorAll('.ad-copy-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const text = btn.dataset.copy;
      navigator.clipboard.writeText(text).then(() => {
        const orig = btn.textContent;
        btn.textContent = '✅';
        setTimeout(() => { btn.textContent = orig; }, 1200);
      }).catch(() => {});
    });
  });

  // Bind add blacklist buttons
  table.querySelectorAll('.ad-add-blacklist-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const domain = btn.dataset.domain;
      if (!domain) return;
      try {
        const res = await fetch('/api/ads/blacklist', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pattern: domain, description: `Ação rápida de anúncios: ${domain}` })
        });
        const data = await res.json();
        if (data.ok) {
          if (data.alreadyExists) {
            showToast(data.message, 'warning');
          } else {
            showToast('Domínio adicionado à Blacklist!', 'success');
            loadSafelistAds();
          }
        } else {
          showToast('Erro: ' + (data.error || 'Falha ao salvar'), 'error');
        }
      } catch (err) {
        showToast('Erro de rede: ' + err.message, 'error');
      }
    });
  });

  // Bind add whitelist buttons
  table.querySelectorAll('.ad-add-whitelist-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const domain = btn.dataset.domain;
      if (!domain) return;
      try {
        const res = await fetch('/api/ads/whitelist', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pattern: domain, description: `Ação rápida de anúncios: ${domain}` })
        });
        const data = await res.json();
        if (data.ok) {
          if (data.alreadyExists) {
            showToast(data.message, 'warning');
          } else {
            showToast('Domínio adicionado à Safelist!', 'success');
            loadSafelistAds();
          }
        } else {
          showToast('Erro: ' + (data.error || 'Falha ao salvar'), 'error');
        }
      } catch (err) {
        showToast('Erro de rede: ' + err.message, 'error');
      }
    });
  });

  // Bind dos botões de exclusão
  table.querySelectorAll('.ad-delete-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const ids = (btn.dataset.adIds || '').split(',').map(Number).filter(Boolean);
      const count = ids.length;
      if (!confirm(`Excluir ${count} registro${count > 1 ? 's' : ''} deste anúncio na safelist?`)) return;
      try {
        await Promise.all(ids.map(id => fetch(`/api/ads/${id}`, { method: 'DELETE' })));
        loadSafelistAds();
      } catch (_) {}
    });
  });
}

// ── Paginação ───────────────────────────────────────────────────────────────

function updatePagination() {
  const pagination = document.getElementById('adsPagination');
  const info = document.getElementById('adsPaginationInfo');
  const prevBtn = document.getElementById('btnAdsPrevPage');
  const nextBtn = document.getElementById('btnAdsNextPage');

  if (safelistState.total === 0) {
    pagination.style.display = 'none';
    return;
  }

  pagination.style.display = 'flex';

  const start = safelistState.page * safelistState.perPage + 1;
  const end = Math.min(start + safelistState.perPage - 1, safelistState.total);
  const totalPages = Math.ceil(safelistState.total / safelistState.perPage);

  info.textContent = `${start}–${end} de ${safelistState.total} anúncio(s) · Página ${safelistState.page + 1}/${totalPages}`;
  prevBtn.disabled = safelistState.page <= 0;
  nextBtn.disabled = end >= safelistState.total;
}

// ── Modal de Títulos Históricos ──────────────────────────────────────────────

function openAdTitlesModal(domain, titles) {
  const overlay = document.getElementById('adTitlesModalOverlay');
  const domainLabel = document.getElementById('adTitlesDomainLabel');
  const container = document.getElementById('adTitlesListContainer');
  if (!overlay || !domainLabel || !container) return;

  domainLabel.textContent = domain;
  container.innerHTML = titles.map(title => `
    <li class="ad-title-item" style="padding:8px 12px; background:var(--background-secondary); border-radius:6px; border:1px solid var(--border-color); font-size:13px; color:var(--text-primary); word-break:break-word;">
      ✨ ${escapeHtmlAds(title)}
    </li>
  `).join('');

  overlay.classList.add('visible');
}

function initAdTitlesModal() {
  const overlay = document.getElementById('adTitlesModalOverlay');
  const btnClose = document.getElementById('btnCloseAdTitles');
  const btnCloseOk = document.getElementById('btnCloseAdTitlesOk');

  if (!overlay) return;

  function closeModal() {
    overlay.classList.remove('visible');
  }

  btnClose?.addEventListener('click', closeModal);
  btnCloseOk?.addEventListener('click', closeModal);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeModal();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && overlay.classList.contains('visible')) closeModal();
  });
}

// ── Modal de Configuração da Safelist (Whitelist) ───────────────────────────

function initWhitelistModal() {
  const overlay = document.getElementById('whitelistModalOverlay');
  const textarea = document.getElementById('whitelistTextarea');
  const wordCount = document.getElementById('whitelistWordCount');
  const btnOpen = document.getElementById('btnOpenWhitelist');
  const btnClose = document.getElementById('btnCloseWhitelist');
  const btnCancel = document.getElementById('btnCancelWhitelist');
  const btnSave = document.getElementById('btnSaveWhitelist');

  if (!overlay || !textarea || !btnOpen) return;

  function updateWordCount() {
    const lines = textarea.value.split('\n').map(l => l.trim()).filter(Boolean);
    wordCount.textContent = `${lines.length} regra${lines.length !== 1 ? 's' : ''}`;
  }

  async function loadWhitelistRules() {
    try {
      const res = await fetch('/api/ads/whitelist');
      const data = await res.json();
      if (data.ok && data.rules) {
        textarea.value = data.rules.map(r => r.pattern).join('\n');
      }
    } catch (_) {}
    updateWordCount();
  }

  // Abrir modal
  btnOpen.addEventListener('click', () => {
    overlay.classList.add('visible');
    loadWhitelistRules();
    setTimeout(() => textarea.focus(), 100);
  });

  // Fechar modal
  function closeModal() {
    overlay.classList.remove('visible');
  }

  btnClose?.addEventListener('click', closeModal);
  btnCancel?.addEventListener('click', closeModal);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeModal();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && overlay.classList.contains('visible')) closeModal();
  });

  textarea.addEventListener('input', updateWordCount);

  btnSave.addEventListener('click', async () => {
    const lines = textarea.value.split('\n').map(l => l.trim()).filter(Boolean);
    btnSave.disabled = true;
    btnSave.textContent = '⏳ Salvando...';

    try {
      const res = await fetch('/api/ads/whitelist/bulk-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ patterns: lines }),
      });
      const data = await res.json();

      if (data.ok) {
        closeModal();
        loadSafelistAds();
        showToast('Safelist sincronizada com sucesso!', 'success');
      } else {
        showToast('Erro: ' + (data.error || 'Falha ao salvar'), 'error');
      }
    } catch (err) {
      showToast('Erro de rede: ' + err.message, 'error');
    } finally {
      btnSave.disabled = false;
      btnSave.textContent = '💾 Salvar';
    }
  });

  if (typeof socket !== 'undefined') {
    socket.on('ads:whitelist:updated', () => {
      if (!overlay.classList.contains('visible')) {
        loadSafelistAds();
      }
    });
  }
}

// ── Event Listeners ─────────────────────────────────────────────────────────

function setupEventListeners() {
  const filterKeywordInput = document.getElementById('filterKeyword');
  const filterDomainInput = document.getElementById('filterDomain');
  const orderBySelect = document.getElementById('orderBy');
  const btnApply = document.getElementById('btnApplyFilters');

  // Clique no botão Filtrar
  btnApply?.addEventListener('click', () => {
    safelistState.filterKeyword = filterKeywordInput?.value.trim() || '';
    safelistState.filterDomain = filterDomainInput?.value.trim() || '';
    safelistState.orderBy = orderBySelect?.value || 'recent';
    safelistState.page = 0;
    loadSafelistAds();
  });

  // Enter nos inputs de pesquisa
  [filterKeywordInput, filterDomainInput].forEach(input => {
    input?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        btnApply?.click();
      }
    });
  });

  // Mudança rápida na ordenação
  orderBySelect?.addEventListener('change', () => {
    btnApply?.click();
  });

  // Botões de Paginação
  document.getElementById('btnAdsPrevPage')?.addEventListener('click', () => {
    if (safelistState.page > 0) {
      safelistState.page--;
      loadSafelistAds();
    }
  });

  document.getElementById('btnAdsNextPage')?.addEventListener('click', () => {
    const maxPage = Math.ceil(safelistState.total / safelistState.perPage) - 1;
    if (safelistState.page < maxPage) {
      safelistState.page++;
      loadSafelistAds();
    }
  });

  // Real-time via Socket
  document.addEventListener('ads:new-ad', () => {
    loadSafelistAds();
  });

  document.addEventListener('ads:updated', () => {
    loadSafelistAds();
  });
}

// ── Inicialização ───────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  initAdTitlesModal();
  initWhitelistModal();
  setupEventListeners();
  loadSafelistAds();
});
