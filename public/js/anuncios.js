/**
 * public/js/anuncios.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Módulo de Anúncios (#anuncios) — exibe resultados das pesquisas dos bots.
 * ─────────────────────────────────────────────────────────────────────────────
 */

// ── Estado ──────────────────────────────────────────────────────────────────
const adsState = {
  ads: [],
  total: 0,
  page: 0,
  perPage: 30,
  filterKeyword: '',
  filterDomain: '',
  stats: null,
  topAdvertisers: [],
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
  if (ad.is_blacklisted) html += '<span class="ad-flag blacklisted" title="Blacklisted">🚨</span>';
  if (ad.is_whitelisted) html += '<span class="ad-flag whitelisted" title="Whitelisted">⏭️</span>';
  return html || '<span class="dim-text">—</span>';
}

// ── Carregar Stats ──────────────────────────────────────────────────────────

async function loadAdsStats() {
  try {
    const res = await fetch('/api/ads/stats');
    const data = await res.json();
    if (!data.ok) return;

    adsState.stats = data.stats;
    document.getElementById('statTotalAds').textContent = data.stats.totalAds || 0;
    document.getElementById('statUniqueDomains').textContent = data.stats.uniqueDomains || 0;
    document.getElementById('statUniqueKeywords').textContent = data.stats.uniqueKeywords || 0;
    document.getElementById('statBlacklistedAds').textContent = data.stats.totalBlacklisted || 0;

    // Badge no nav
    document.getElementById('navAdsCount').textContent = data.stats.totalAds || 0;
  } catch (_) {}
}

// ── Carregar Anúncios ───────────────────────────────────────────────────────

async function loadAds() {
  const offset = adsState.page * adsState.perPage;
  const params = new URLSearchParams({
    limit: adsState.perPage,
    offset,
  });
  if (adsState.filterKeyword) params.set('keyword', adsState.filterKeyword);
  if (adsState.filterDomain) params.set('domain', adsState.filterDomain);

  try {
    const res = await fetch(`/api/ads/all?${params}`);
    const data = await res.json();
    if (!data.ok) return;

    adsState.ads = data.ads || [];
    adsState.total = data.total || 0;

    renderAdsTable();
    updatePagination();
  } catch (err) {
    console.error('[Anúncios] Erro ao carregar:', err);
  }
}

// ── Render Tabela ───────────────────────────────────────────────────────────

function renderAdsTable() {
  const container = document.getElementById('adsTableContainer');
  const emptyState = document.getElementById('adsEmptyState');

  if (adsState.ads.length === 0) {
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
        <th style="width:50px; text-align:center;">#</th>
        <th style="text-align:center; width:70px;">Posição</th>
        <th>Keyword</th>
        <th>Título do Anúncio</th>
        <th>URL de Exibição</th>
        <th>Link Real</th>
        <th style="text-align:center; width:60px;">Flags</th>
        <th style="width:130px;">Encontrado em</th>
        <th style="width:50px; text-align:center;">Ação</th>
      </tr>
    </thead>
    <tbody>
      ${adsState.ads.map(ad => `
        <tr data-ad-id="${ad.id}" class="${ad.is_blacklisted ? 'ad-row-blacklisted' : ''}${ad.is_whitelisted ? 'ad-row-whitelisted' : ''}">
          <td style="text-align:center; font-family:var(--font-mono); font-size:12px; color:var(--text-secondary);">${ad.id}</td>
          <td style="text-align:center;">${positionBadge(ad.position)}</td>
          <td>
            <span class="ad-keyword-chip" title="${escapeHtmlAds(ad.keyword)}">${escapeHtmlAds(ad.keyword)}</span>
          </td>
          <td>
            <div class="ad-title-cell" title="${escapeHtmlAds(ad.ad_title)}">${escapeHtmlAds(truncate(ad.ad_title, 50))}</div>
            ${ad.ad_description ? `<div class="ad-desc-cell">${escapeHtmlAds(truncate(ad.ad_description, 70))}</div>` : ''}
          </td>
          <td>
            <span class="ad-display-url" title="${escapeHtmlAds(ad.display_url)}">${escapeHtmlAds(truncate(ad.display_url, 40))}</span>
          </td>
          <td>
            ${ad.href_decoded
              ? `<a href="${escapeHtmlAds(ad.href_decoded)}" target="_blank" rel="noopener" class="ad-link" title="${escapeHtmlAds(ad.href_decoded)}">${escapeHtmlAds(truncate(ad.href_decoded, 45))}</a>`
              : '<span class="dim-text">—</span>'
            }
          </td>
          <td style="text-align:center;">${flagBadges(ad)}</td>
          <td style="font-size:12px; color:var(--text-secondary);">${ad.found_at || '—'}</td>
          <td style="text-align:center;">
            <button class="toolbar-btn ad-delete-btn" data-ad-id="${ad.id}" title="Excluir anúncio" style="padding:4px 8px; font-size:12px;">🗑</button>
          </td>
        </tr>
      `).join('')}
    </tbody>
  `;

  container.innerHTML = '';
  container.appendChild(table);

  // Bind delete buttons
  table.querySelectorAll('.ad-delete-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const adId = btn.dataset.adId;
      if (!confirm(`Excluir anúncio #${adId}?`)) return;
      try {
        await fetch(`/api/ads/${adId}`, { method: 'DELETE' });
        loadAds();
        loadAdsStats();
      } catch (_) {}
    });
  });
}

function createEmptyState() {
  const div = document.createElement('div');
  div.className = 'profile-empty-state';
  div.id = 'adsEmptyState';
  div.innerHTML = `
    <div class="empty-icon">📢</div>
    <div class="empty-title">Nenhum anúncio encontrado</div>
    <div class="empty-desc">Os anúncios aparecerão aqui após as pesquisas dos bots.</div>
  `;
  return div;
}

// ── Paginação ───────────────────────────────────────────────────────────────

function updatePagination() {
  const pagination = document.getElementById('adsPagination');
  const info = document.getElementById('adsPaginationInfo');
  const prevBtn = document.getElementById('btnAdsPrevPage');
  const nextBtn = document.getElementById('btnAdsNextPage');

  if (adsState.total === 0) {
    pagination.style.display = 'none';
    return;
  }

  pagination.style.display = 'flex';

  const start = adsState.page * adsState.perPage + 1;
  const end = Math.min(start + adsState.perPage - 1, adsState.total);
  const totalPages = Math.ceil(adsState.total / adsState.perPage);

  info.textContent = `${start}–${end} de ${adsState.total} anúncio(s) · Página ${adsState.page + 1}/${totalPages}`;
  prevBtn.disabled = adsState.page <= 0;
  nextBtn.disabled = end >= adsState.total;
}

// ── Top Anunciantes ─────────────────────────────────────────────────────────

async function loadTopAdvertisers() {
  const container = document.getElementById('topAdvertisersContainer');
  try {
    const res = await fetch('/api/ads/top-advertisers?limit=15');
    const data = await res.json();
    if (!data.ok || !data.advertisers || data.advertisers.length === 0) {
      container.innerHTML = '<div class="log-empty"><span>Nenhum anunciante encontrado.</span></div>';
      return;
    }

    adsState.topAdvertisers = data.advertisers;
    const maxApp = data.advertisers[0]?.appearances || 1;

    container.innerHTML = `
      <div class="top-advertisers-list">
        ${data.advertisers.map((adv, i) => {
          const pct = Math.max(5, (adv.appearances / maxApp) * 100);
          const flagged = adv.times_blacklisted > 0;
          return `
            <div class="top-adv-row ${flagged ? 'flagged' : ''}">
              <div class="top-adv-rank">${i + 1}</div>
              <div class="top-adv-info">
                <div class="top-adv-domain" title="${escapeHtmlAds(adv.display_url)}">${escapeHtmlAds(truncate(adv.display_url, 50))}</div>
                <div class="top-adv-bar-bg">
                  <div class="top-adv-bar" style="width:${pct}%"></div>
                </div>
              </div>
              <div class="top-adv-stats">
                <span class="top-adv-count">${adv.appearances}x</span>
                ${flagged ? `<span class="ad-flag blacklisted" title="${adv.times_blacklisted} blacklisted">🚨 ${adv.times_blacklisted}</span>` : ''}
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;
  } catch (_) {
    container.innerHTML = '<div class="log-empty"><span>Erro ao carregar.</span></div>';
  }
}

// ── Event Listeners ─────────────────────────────────────────────────────────

document.getElementById('btnRefreshAds')?.addEventListener('click', () => {
  loadAds();
  loadAdsStats();
  loadTopAdvertisers();
});

document.getElementById('btnClearAllAds')?.addEventListener('click', async () => {
  if (!confirm('⚠️ Tem certeza que deseja excluir TODOS os anúncios? Esta ação é irreversível.')) return;
  try {
    await fetch('/api/ads/clear-all', { method: 'DELETE' });
    adsState.page = 0;
    loadAds();
    loadAdsStats();
    loadTopAdvertisers();
  } catch (_) {}
});

document.getElementById('btnApplyAdsFilter')?.addEventListener('click', () => {
  adsState.filterKeyword = document.getElementById('adsFilterKeyword')?.value.trim() || '';
  adsState.filterDomain = document.getElementById('adsFilterDomain')?.value.trim() || '';
  adsState.page = 0;
  loadAds();
});

// Enter nos filtros
document.getElementById('adsFilterKeyword')?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('btnApplyAdsFilter')?.click();
});
document.getElementById('adsFilterDomain')?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('btnApplyAdsFilter')?.click();
});

document.getElementById('btnAdsPrevPage')?.addEventListener('click', () => {
  if (adsState.page > 0) {
    adsState.page--;
    loadAds();
  }
});

document.getElementById('btnAdsNextPage')?.addEventListener('click', () => {
  const maxPage = Math.ceil(adsState.total / adsState.perPage) - 1;
  if (adsState.page < maxPage) {
    adsState.page++;
    loadAds();
  }
});

// ── Real-time via Socket ────────────────────────────────────────────────────

document.addEventListener('ads:new-ad', () => {
  // Atualiza se estiver na página de anúncios
  const section = document.getElementById('sectionAnuncios');
  if (section?.classList.contains('active')) {
    loadAds();
    loadAdsStats();
    loadTopAdvertisers();
  }
});

document.addEventListener('ads:updated', () => {
  const section = document.getElementById('sectionAnuncios');
  if (section?.classList.contains('active')) {
    loadAds();
    loadAdsStats();
    loadTopAdvertisers();
  }
});

// ── Inicialização ───────────────────────────────────────────────────────────

// Carrega dados quando a seção fica visível (troca de menu)
const adsObserver = new MutationObserver(() => {
  const section = document.getElementById('sectionAnuncios');
  if (section?.classList.contains('active')) {
    loadAds();
    loadAdsStats();
    loadTopAdvertisers();
  }
});

const anunciosSection = document.getElementById('sectionAnuncios');
if (anunciosSection) {
  adsObserver.observe(anunciosSection, { attributes: true, attributeFilter: ['class'] });

  // Se a seção JÁ está ativa ao carregar (F5 em #anuncios), carrega imediatamente
  if (anunciosSection.classList.contains('active')) {
    loadAds();
    loadAdsStats();
    loadTopAdvertisers();
  }
}

// Carrega stats na inicialização (para o badge do nav)
loadAdsStats();
