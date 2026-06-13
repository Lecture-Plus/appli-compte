// ============================================================
// js/ui/charges.js – Charges, achats exceptionnels & suivi budgets
// ============================================================

import { State }                                          from '../app.js';
import { getAllCharges, saveCharge, deleteCharge,
         getAchatsForMonth, saveAchat, deleteAchat,
         getActiveUsers, getAvailableYears,
         getMonthlyData, getBudgetOpsForMonth,
         saveBudgetOp, deleteBudgetOp,
         getAllSettings, setSetting }                       from '../db.js';
import { eur, escHtml, nomMois, addMonth, showToast, showToastWithUndo,
         openModal, closeModal, getCategoryInfo,
         CATEGORIES, MOIS }                                from '../utils.js';

const PRESET_ICONS = ['🛒','🎉','🍽️','🚗','💊','🏋️','🐾','📚','🎮','🎬','✈️','🏠','👗','💇','🎁','⚡️','📱','🌿'];

let _tab   = 'recurrentes'; // 'recurrentes' | 'achats' | 'budgets'
let _users = [];

export async function render(container) {
  _users = await getActiveUsers();

  container.innerHTML = `
    <div class="tabs" id="charges-tabs">

      <button class="tab-btn ${_tab === 'recurrentes' ? 'active' : ''}" data-tab="recurrentes">Récurrentes</button>
      <button class="tab-btn ${_tab === 'achats'      ? 'active' : ''}" data-tab="achats">Exceptionnels</button>
      <button class="tab-btn ${_tab === 'budgets'     ? 'active' : ''}" data-tab="budgets">Budgets</button>
      <button class="tab-btn ${_tab === 'calendrier'  ? 'active' : ''}" data-tab="calendrier">📅 Calendrier</button>
    </div>
    <div id="tab-content"></div>
    <button class="fab" id="fab-add" aria-label="Ajouter" style="${_tab === 'budgets' ? 'display:none;' : ''}">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
    </button>
  `;

  const renderTab = () => {
    if (_tab === 'recurrentes') renderRecurrentes(container);
    else if (_tab === 'achats') renderAchats(container);
    else if (_tab === 'calendrier') renderCalendrier(container);
    else                        renderBudgets(container);
  };

  container.querySelectorAll('#charges-tabs .tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      container.querySelectorAll('#charges-tabs .tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      _tab = btn.dataset.tab;
      const fab = container.querySelector('#fab-add');
      if (fab) fab.style.display = (_tab === 'budgets' || _tab === 'calendrier') ? 'none' : '';
      renderTab();
    });
  });

  container.querySelector('#fab-add')?.addEventListener('click', () => {
    if (_tab === 'recurrentes') showChargeModal(null, () => renderTab());
    else if (_tab === 'achats') showAchatModal(null,  () => renderTab());
  });

  renderTab();
}

// ── Export: rendu d'une section individuelle (pour argent.js 5 onglets) ──
export async function renderSection(container, section = 'recurrentes') {
  _users = await getActiveUsers();
  _tab   = section;
  container.innerHTML = `<div id="tab-content"></div>`;
  if (section !== 'budgets') {
    const fab = document.createElement('button');
    fab.className = 'fab'; fab.id = 'fab-add';
    fab.setAttribute('aria-label', 'Ajouter');
    fab.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>';
    container.appendChild(fab);
    fab.addEventListener('click', () => {
      if (_tab === 'recurrentes') showChargeModal(null, () => renderSection(container, 'recurrentes'));
      else if (_tab === 'achats') showAchatModal(null,  () => renderSection(container, 'achats'));
    });
  }
  if (section === 'recurrentes') renderRecurrentes(container);
  else if (section === 'achats')  renderAchats(container);
  else                            renderBudgets(container);
}

// ── Export: modal d'ajout d'opération budget (pour dashboard quick-add) ──
export async function showBudgetOpModal(catId, catLabel, year, month, onSave) {
  const users = await getActiveUsers();
  _showAddBudgetOpModal({ catId, catLabel }, users, year, month, onSave);
}

// ══════════════════════════════════════════════════
// CHARGES RÉCURRENTES
// ══════════════════════════════════════════════════

async function renderRecurrentes(container) {
  const allCharges = await getAllCharges();
  const charges = allCharges.filter(c => c.year === State.year && c.month === State.month);
  const tc      = container.querySelector('#tab-content');

  if (!charges.length) {
    tc.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">📋</div>
        <div class="empty-state-title">Aucune charge ce mois-ci</div>
        <div class="empty-state-text">Ajoutez les charges de ce mois : loyer, EDF, abonnements…</div>
      </div>
    `;
    return;
  }

  // Groupement par catégorie
  const byCat = {};
  for (const c of charges) {
    const cat = c.category || 'autre';
    if (!byCat[cat]) byCat[cat] = [];
    byCat[cat].push(c);
  }

  let html = '';
  for (const catId of Object.keys(byCat)) {
    const info  = getCategoryInfo(catId);
    const items = byCat[catId];
    const total = items.reduce((acc, c) => acc + (Number(c.amount) || 0), 0);

    html += `
      <div class="section-header" style="margin-top:12px;">
        <span class="section-label">${info.emoji} ${escHtml(info.label)}</span>
        <span class="chip">${eur(total)}</span>
      </div>
      <div class="item-list">
        ${items.map(c => buildChargeItem(c)).join('')}
      </div>
    `;
  }

  const totalAll = charges.reduce((acc, c) => {
    const lines = c.lines?.length ? c.lines : [{ amount: c.amount }];
    return acc + lines.reduce((s, l) => s + (Number(l.amount) || 0), 0);
  }, 0);
  html = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
      <span style="font-size:0.78rem;color:var(--text-3);">${charges.length} charge(s)</span>
      <span class="chip danger">Total: ${eur(totalAll)}</span>
    </div>
    ${html}
    <div style="height:80px;"></div>
  `;

  // FM-2 : barre de recherche des charges récurrentes
  const searchWrap = `<div style="margin-bottom:10px;"><input type="search" class="form-input" id="charges-search" placeholder="🔍 Rechercher une charge…" style="width:100%;"></div>`;
  tc.innerHTML = searchWrap + html;
  tc.querySelector('#charges-search')?.addEventListener('input', (e) => {
    const q = e.target.value.toLowerCase();
    tc.querySelectorAll('.list-item[data-id]').forEach(item => {
      const label = item.querySelector('.list-item-title')?.textContent?.toLowerCase() || '';
      item.style.display = label.includes(q) ? '' : 'none';
    });
  });

  tc.querySelectorAll('.list-item[data-id]').forEach(el => {
    el.addEventListener('click', async () => {
      const id = Number(el.dataset.id);
      const c  = charges.find(x => x.id === id);
      if (c) showChargeModal(c, () => renderRecurrentes(container));
    });
  });
}

function buildChargeItem(c) {
  const info   = getCategoryInfo(c.category);
  const lines  = c.lines?.length ? c.lines : [{ amount: c.amount, qui: c.qui, dayOfMonth: c.dayOfMonth }];
  const total  = lines.reduce((s, l) => s + (Number(l.amount) || 0), 0);
  const persoTag = c.perso
    ? `<span class="chip" style="font-size:0.62rem;padding:1px 5px;background:var(--warning-bg);color:var(--warning);">Perso</span>`
    : c.payerViaPerso
      ? `<span class="chip" style="font-size:0.62rem;padding:1px 5px;background:var(--primary-bg);color:var(--primary);">💳 ${escHtml(getQuiLabel(c.payerViaPerso))}</span>`
      : '';
  const activeIcon = c.active
    ? `<svg viewBox="0 0 24 24" fill="none" stroke="var(--success)" stroke-width="2.5" width="14" height="14"><path d="M20 6L9 17l-5-5"/></svg>`
    : `<svg viewBox="0 0 24 24" fill="none" stroke="var(--danger)" stroke-width="2" width="14" height="14"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
  const linesSub = lines.length > 1
    ? lines.map(l => `<span class="chip" style="font-size:0.62rem;padding:1px 6px;">${escHtml(getQuiLabel(l.qui))}&nbsp;${eur(Number(l.amount)||0)}${l.dayOfMonth ? ` j.${l.dayOfMonth}` : ''}</span>`).join(' ')
    : `<span class="qui-badge">${escHtml(getQuiLabel(lines[0].qui))}</span>`;

  return `
    <div class="list-item" data-id="${c.id}" style="cursor:pointer;${!c.active ? 'opacity:0.5;' : ''}">
      <div class="list-item-icon" style="background:var(--primary-bg);">${info.emoji}</div>
      <div class="list-item-body">
        <div class="list-item-title">${escHtml(c.label)} ${persoTag}</div>
        <div class="list-item-sub" style="display:flex;flex-wrap:wrap;gap:3px;align-items:center;">${activeIcon} ${linesSub}</div>
      </div>
      <div class="list-item-right">
        <div class="list-item-amount">${eur(total)}</div>
      </div>
    </div>
  `;
}

// ── Formate un validFrom 'YYYY-MM' en libellé lisible ──
function _fmtValidFrom(ym) {
  const [y, m] = ym.split('-');
  return `${MOIS[Number(m) - 1]} ${y}`;
}

// ── Rendu de la section historique d'une ligne ──
function _renderHistorySection(el, history, onUpdate) {
  el.innerHTML = '';
  el.style.cssText = 'background:var(--surface-2,#F8FAFC);border-radius:8px;padding:8px 10px;margin-bottom:8px;border:1px solid var(--border,#E2E8F0);';

  const title = document.createElement('div');
  title.style.cssText = 'font-size:0.72rem;font-weight:700;color:var(--text-2,#64748B);text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px;';
  title.textContent = '📅 Historique des tarifs';
  el.appendChild(title);

  if (history.length === 0) {
    const empty = document.createElement('p');
    empty.style.cssText = 'font-size:0.78rem;color:var(--text-3,#94A3B8);margin-bottom:6px;';
    empty.textContent = 'Aucun historique. Montant de base appliqué à tous les mois.';
    el.appendChild(empty);
  } else {
    const list = document.createElement('div');
    list.style.marginBottom = '6px';
    history.forEach((h, i) => {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:3px 0;border-bottom:1px solid var(--border,#E2E8F0);font-size:0.8rem;';
      row.innerHTML = `
        <span style="color:var(--text-2,#64748B);flex:1;">À partir de <strong>${_fmtValidFrom(h.validFrom)}</strong></span>
        <span style="font-weight:700;">${eur(h.amount)}</span>
        <button type="button" class="btn-text" style="color:var(--danger,#EF4444);font-size:0.75rem;padding:0 4px;" data-hidx="${i}">✕</button>
      `;
      row.querySelector('[data-hidx]').addEventListener('click', () => {
        history.splice(i, 1);
        onUpdate();
      });
      list.appendChild(row);
    });
    el.appendChild(list);
  }

  // Formulaire d'ajout
  const addForm = document.createElement('div');
  addForm.style.cssText = 'display:flex;gap:5px;align-items:center;margin-top:4px;flex-wrap:wrap;';
  addForm.innerHTML = `
    <input type="month" class="form-input hist-vf" style="flex:1;min-width:120px;font-size:0.8rem;padding:5px 8px;">
    <div class="input-wrap" style="flex:1;min-width:80px;">
      <input type="number" class="form-input input-euro hist-amt" min="0" step="0.01" placeholder="Montant" style="padding-right:22px;font-size:0.8rem;">
      <span class="input-suffix">€</span>
    </div>
    <button type="button" class="btn btn-outline btn-sm hist-add-btn">+</button>
  `;
  addForm.querySelector('.hist-add-btn').addEventListener('click', () => {
    const vf  = addForm.querySelector('.hist-vf').value;
    const amt = Number(addForm.querySelector('.hist-amt').value) || 0;
    if (!vf)  { showToast('Sélectionnez un mois de départ', 'error'); return; }
    if (!amt) { showToast('Entrez un montant > 0', 'error'); return; }
    history.push({ amount: amt, validFrom: vf });
    history.sort((a, b) => a.validFrom < b.validFrom ? -1 : 1);
    onUpdate();
  });
  el.appendChild(addForm);
}

// ── Rendu d'une ligne de prélèvement dans le modal ──
function _renderLineRow(line, idx, container) {
  const lineHistory = line.priceHistory ? [...line.priceHistory] : [];

  const _N = _users.length;
  const _defaultQui = _N === 1 ? String(_users[0]?.id ?? 'shared') : (line.qui === 'shared' || !line.qui ? 'shared' : String(line.qui));
  const quiOpts = (
    (_N > 1 ? `<option value="shared" ${_defaultQui === 'shared' ? 'selected' : ''}>🤝 Partagé (tous)</option>` : '') +
    _users.map(u => `<option value="${u.id}" ${_defaultQui === String(u.id) ? 'selected' : ''}>${escHtml(u.name)}</option>`).join('')
  );

  // Wrapper (contient la ligne + la section historique)
  const wrapper = document.createElement('div');
  wrapper.className = 'charge-line-wrapper';
  wrapper.style.marginBottom = '4px';

  // Ligne
  const row = document.createElement('div');
  row.className = 'charge-line-row';
  row.dataset.idx = idx;
  row.style.cssText = 'display:flex;align-items:center;gap:6px;margin-bottom:4px;';
  row.innerHTML = `
    <div class="input-wrap" style="flex:1;min-width:70px;">
      <input type="number" class="form-input input-euro cl-amount" min="0" step="0.01" placeholder="0" value="${line.amount || ''}" style="padding-right:22px;">
      <span class="input-suffix">€</span>
    </div>
    <select class="form-select cl-qui" style="flex:1.4;">${quiOpts}</select>
    <div class="input-wrap" style="width:72px;">
      <input type="number" class="form-input cl-day" min="1" max="31" placeholder="Jour" value="${line.dayOfMonth || ''}" style="padding-right:22px;">
      <span class="input-suffix">j.</span>
    </div>
    <button type="button" class="btn btn-danger btn-sm cl-remove" style="flex-shrink:0;padding:4px 8px;" aria-label="Supprimer la ligne">✕</button>
  `;

  // ── Section répartition personnalisée (visible si N > 1 et qui = shared) ──
  const splitSection = document.createElement('div');
  splitSection.className = 'charge-line-split';
  const existingSplitPcts = line.splitPcts && typeof line.splitPcts === 'object' ? line.splitPcts : null;
  const splitActive = _N > 1 && _defaultQui === 'shared';
  splitSection.style.cssText = `display:${splitActive ? '' : 'none'};padding:6px 8px 8px;margin-top:2px;background:var(--bg-secondary);border-radius:var(--radius-sm);font-size:0.78rem;`;
  if (_N > 1) {
    const sumPctsSaved = existingSplitPcts ? Object.values(existingSplitPcts).reduce((s, v) => s + (Number(v) || 0), 0) : 0;
    splitSection.innerHTML = `
      <div style="font-size:0.7rem;color:var(--text-3);margin-bottom:6px;">Répartition personnalisée (%) — total doit faire 100%</div>
      <div style="display:flex;flex-direction:column;gap:4px;" class="split-rows">
        ${_users.map(u => {
          const defPct = existingSplitPcts ? (Number(existingSplitPcts[String(u.id)]) || 0) : Math.round(100 / _N);
          return `<div style="display:flex;align-items:center;gap:6px;">
            <span style="width:8px;height:8px;border-radius:50%;background:${escHtml(u.color||'#6C63FF')};display:inline-block;flex-shrink:0;"></span>
            <span style="flex:1;font-size:0.78rem;">${escHtml(u.name)}</span>
            <div style="display:flex;align-items:center;gap:2px;">
              <input type="number" class="form-input cl-split-pct" data-uid="${u.id}" min="0" max="100" step="1" value="${defPct}" style="width:62px;text-align:right;padding:4px 6px;">
              <span style="color:var(--text-3);">%</span>
            </div>
          </div>`;
        }).join('')}
      </div>
      <div class="split-total-hint" style="text-align:right;font-size:0.7rem;margin-top:4px;color:var(--text-3);"></div>
    `;
    // Update total hint
    const updateSplitHint = () => {
      const total = [...splitSection.querySelectorAll('.cl-split-pct')].reduce((s, i) => s + (Number(i.value) || 0), 0);
      const hint = splitSection.querySelector('.split-total-hint');
      if (hint) hint.style.color = Math.abs(total - 100) < 0.5 ? 'var(--success)' : 'var(--danger)';
      if (hint) hint.textContent = `Total : ${total}%${Math.abs(total - 100) >= 0.5 ? ' ⚠️ doit être 100%' : ' ✅'}`;
    };
    splitSection.querySelectorAll('.cl-split-pct').forEach(inp => inp.addEventListener('input', updateSplitHint));
    updateSplitHint();
  }

  // Afficher/masquer la section split selon qui sélectionné
  const quiSelect = row.querySelector('.cl-qui');
  const toggleSplit = () => {
    if (_N > 1 && quiSelect?.value === 'shared') {
      if (splitSection.style.display === 'none') splitSection.style.display = '';
    } else {
      splitSection.style.display = 'none';
    }
  };
  quiSelect?.addEventListener('change', toggleSplit);

  // Section historique (masquée par défaut)
  const histSection = document.createElement('div');
  histSection.className = 'charge-line-history';
  histSection.style.display = lineHistory.length > 0 ? '' : 'none';
  _renderHistorySection(histSection, lineHistory, () => {
    _renderHistorySection(histSection, lineHistory, () => {});
  });

  // Réactiver le onUpdate correctement (closure circulaire évitée)
  const refresh = () => _renderHistorySection(histSection, lineHistory, refresh);
  _renderHistorySection(histSection, lineHistory, refresh);

  // Supprimer ligne + section
  row.querySelector('.cl-remove').addEventListener('click', () => {
    const wrappers = container.querySelectorAll('.charge-line-wrapper');
    if (wrappers.length <= 1) { showToast('Au moins une ligne est requise', 'error'); return; }
    wrapper.remove();
  });

  // Stocker la référence à lineHistory sur le wrapper pour la récupérer au save
  wrapper._lineHistory = lineHistory;

  wrapper.appendChild(row);
  wrapper.appendChild(splitSection);
  // histSection no longer shown (historique des tarifs removed)
  container.appendChild(wrapper);
}

export async function showChargeModal(charge, onSave) {
  if (!_users.length) _users = await getActiveUsers();
  const isNew = !charge;
  const c = charge ?? {
    label: '', category: 'logement', months: 'all', active: true, perso: false, notes: '',
  };

  // Initialise les lignes depuis `lines` ou les champs legacy
  const initLines = c.lines?.length
    ? c.lines
    : [{ amount: c.amount || 0, qui: c.qui ?? 'shared', dayOfMonth: c.dayOfMonth ?? null }];

  const catOptions = CATEGORIES.map(cat =>
    `<option value="${cat.id}" ${c.category === cat.id ? 'selected' : ''}>${cat.emoji} ${cat.label}</option>`
  ).join('');

  const monthCheckboxes = MOIS.map((m, i) => {
    const checked = c.months === 'all' || (Array.isArray(c.months) && c.months.includes(i + 1));
    return `<label style="display:flex;align-items:center;gap:5px;font-size:0.8rem;cursor:pointer;">
      <input type="checkbox" data-mois="${i+1}" ${checked ? 'checked' : ''}> ${m.slice(0, 3)}
    </label>`;
  }).join('');

  const hasNonDefaultOptions = c.perso || c.payerViaPerso || !c.active;

  const body = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px;">
      <div class="form-group" style="grid-column:1/-1;">
        <label class="form-label">Libellé</label>
        <input type="text" class="form-input" id="c-label" placeholder="Ex: Loyer, EDF, Netflix…" value="${escHtml(c.label)}">
      </div>
      <div class="form-group">
        <label class="form-label">Catégorie</label>
        <select class="form-select" id="c-cat">${catOptions}</select>
      </div>
    </div>

    <div class="form-group" style="margin-bottom:10px;">
      <label class="form-label">Lignes de prélèvement</label>
      <p class="form-hint" style="margin-top:2px;">Montant · Qui · Jour dans le mois (facultatif)</p>
      <div id="c-lines-container" style="margin-top:6px;"></div>
      <button type="button" class="btn btn-outline btn-sm" id="c-add-line" style="margin-top:4px;width:100%;">
        + Ajouter une ligne
      </button>
    </div>

    <details class="settings-group" style="margin-bottom:4px;" ${hasNonDefaultOptions ? 'open' : ''}>
      <summary class="settings-group-title" style="font-size:0.82rem;">⚙️ Options</summary>
      <div class="settings-group-body">
        <div class="toggle-wrap" style="padding:6px 0;">
          <div class="toggle-info">
            <label for="c-perso">Charge personnelle</label>
            <p>Exclue du calcul de répartition (reste dans les dépenses)</p>
          </div>
          <label class="toggle">
            <input type="checkbox" id="c-perso" ${c.perso ? 'checked' : ''}>
            <span class="toggle-slider"></span>
          </label>
        </div>
        ${_users.length > 1 ? `
        <div class="form-group" style="padding:6px 0;border-top:1px solid var(--border);">
          <label class="form-label">Prélevée via</label>
          <p class="form-hint" style="margin-bottom:4px;">Charge partagée mais payée depuis le compte personnel d’une personne. Sa part est déduite de son "à payer".</p>
          <select class="form-select" id="c-payer-perso">
            <option value="" ${!c.payerViaPerso ? 'selected' : ''}>Compte joint (défaut)</option>
            ${_users.map(u => `<option value="${u.id}" ${String(c.payerViaPerso) === String(u.id) ? 'selected' : ''}>${escHtml(u.name)}</option>`).join('')}
          </select>
        </div>` : ''}
        <div class="toggle-wrap" style="padding:6px 0;border-top:1px solid var(--border);">
          <div class="toggle-info">
            <label for="c-active">Charge active</label>
            <p>Désactiver pour la suspendre temporairement</p>
          </div>
          <label class="toggle">
            <input type="checkbox" id="c-active" ${c.active ? 'checked' : ''}>
            <span class="toggle-slider"></span>
          </label>
        </div>
      </div>
    </details>
  `;

  const footer = `
    ${!isNew ? `<button class="btn btn-danger btn-sm" id="c-delete">Supprimer</button>` : ''}
    <button class="btn btn-outline" id="c-cancel">Annuler</button>
    <button class="btn btn-primary" id="c-save" style="margin-left:auto;">Enregistrer</button>
  `;

  openModal(isNew ? 'Nouvelle charge' : 'Modifier la charge', body, footer);

  // Rendu initial des lignes
  const linesContainer = document.getElementById('c-lines-container');
  initLines.forEach((line, i) => _renderLineRow(line, i, linesContainer));

  document.getElementById('c-add-line')?.addEventListener('click', () => {
    const idx = linesContainer.querySelectorAll('.charge-line-wrapper').length;
    _renderLineRow({ amount: 0, qui: 'shared', dayOfMonth: null }, idx, linesContainer);
  });

  document.getElementById('c-cancel')?.addEventListener('click', closeModal);

  document.getElementById('c-delete')?.addEventListener('click', async () => {
    const toDelete = { ...charge };
    closeModal();
    await deleteCharge(toDelete.id);
    onSave();
    showToastWithUndo(`Charge « ${toDelete.label || 'sans nom'} » supprimée`,
      () => {}, 6000, 'warning',
      async () => { await saveCharge(toDelete); onSave(); });
  });

  document.getElementById('c-save')?.addEventListener('click', async () => {
    const label = document.getElementById('c-label')?.value.trim();
    if (!label) { showToast('Le libellé est requis', 'error'); return; }

    // Collecte des lignes
    const wrappers = [...linesContainer.querySelectorAll('.charge-line-wrapper')];
    const lines = [];
    for (const wrapper of wrappers) {
      const row = wrapper.querySelector('.charge-line-row');
      const amt = Number(row.querySelector('.cl-amount')?.value) || 0;
      const quiRaw = row.querySelector('.cl-qui')?.value;
      const qui = quiRaw === 'shared' ? 'shared' : Number(quiRaw);
      const day = Number(row.querySelector('.cl-day')?.value) || null;
      const history = wrapper._lineHistory || [];
      // Répartition personnalisée si splitSection visible et qui = shared
      const splitInputs = wrapper.querySelectorAll('.cl-split-pct');
      const splitPcts = (qui === 'shared' && splitInputs.length > 0 && wrapper.querySelector('.charge-line-split')?.style.display !== 'none')
        ? Object.fromEntries([...splitInputs].map(inp => [inp.dataset.uid, Number(inp.value) || 0]))
        : null;
      // line.amount = montant de base saisi dans le champ (fallback quand aucune entrée historique n'est applicable)
      // L'historique des prix est géré séparément par resolveLineAmount dans db.js
      lines.push({
        amount: amt,
        qui,
        dayOfMonth: day,
        ...(splitPcts ? { splitPcts } : {}),
        ...(history.length ? { priceHistory: history } : {}),
      });
    }
    if (!lines.length) { showToast('Ajoutez au moins une ligne', 'error'); return; }

    const totalAmount = lines.reduce((s, l) => s + l.amount, 0);

    // Top-level qui: single-user → that user; multi-line with same qui → that qui; otherwise 'shared'
    const allSame = lines.every(l => String(l.qui) === String(lines[0].qui));
    const topQui  = (allSame && lines[0].qui != null) ? lines[0].qui : 'shared';

    await saveCharge({
      ...(isNew ? {} : { id: charge.id }),
      label,
      category: document.getElementById('c-cat')?.value || 'autre',
      lines,
      amount:   totalAmount,
      qui:      topQui,
      year:     State.year,
      month:    State.month,
      active:   document.getElementById('c-active')?.checked ?? true,
      perso:    document.getElementById('c-perso')?.checked ?? false,
      payerViaPerso: (() => {
        const v = document.getElementById('c-payer-perso')?.value;
        if (!v) return undefined;
        return isNaN(Number(v)) ? v : Number(v);
      })(),
      notes:    '',
    });
    closeModal();
    showToast(isNew ? 'Charge ajoutée ✅' : 'Charge mise à jour ✅', 'success');
    onSave();
  });
}

// ══════════════════════════════════════════════════
// CHARGES TYPES (modale d'import)
// ══════════════════════════════════════════════════

export function showChargesTemplatesModal(onSave) {
  const TEMPLATES = [
    { label: 'Loyer',              category: 'logement',   amount: 800,  qui: 'shared' },
    { label: 'Électricité (EDF)',  category: 'logement',   amount: 80,   qui: 'shared' },
    { label: 'Gaz',               category: 'logement',   amount: 50,   qui: 'shared' },
    { label: 'Internet / Box',    category: 'abonnements', amount: 40,   qui: 'shared' },
    { label: 'Eau',               category: 'logement',   amount: 30,   qui: 'shared' },
    { label: 'Charges copro.',    category: 'logement',   amount: 120,  qui: 'shared' },
    { label: 'Assurance habitation', category: 'assurances', amount: 25, qui: 'shared' },
    { label: 'Assurance voiture 1',  category: 'assurances', amount: 60, qui: 'shared' },
    { label: 'Assurance voiture 2',  category: 'assurances', amount: 55, qui: 'shared' },
    { label: 'Mutuelle santé',    category: 'sante',      amount: 70,   qui: 'shared' },
    { label: 'Forfait mobile 1',  category: 'abonnements', amount: 20,  qui: 'shared' },
    { label: 'Forfait mobile 2',  category: 'abonnements', amount: 20,  qui: 'shared' },
    { label: 'Netflix',           category: 'abonnements', amount: 18,  qui: 'shared' },
    { label: 'Spotify',           category: 'abonnements', amount: 10,  qui: 'shared' },
    { label: 'Crédit auto',       category: 'credit',     amount: 250,  qui: 'shared' },
    { label: 'Prêt immobilier',   category: 'credit',     amount: 900,  qui: 'shared' },
    { label: 'Crèche / Garde enfant', category: 'enfants', amount: 600, qui: 'shared' },
    { label: 'Cantine scolaire',  category: 'enfants',    amount: 80,   qui: 'shared' },
    { label: 'Abonnement sport',  category: 'loisirs',    amount: 30,   qui: 'shared' },
    { label: 'Parking',           category: 'transport',  amount: 80,   qui: 'shared' },
  ];
  const rows = TEMPLATES.map((t, i) =>
    `<label style="display:flex;align-items:center;gap:10px;padding:7px 0;border-bottom:1px solid var(--border);cursor:pointer;">
      <input type="checkbox" class="tmpl-check" data-i="${i}" style="width:16px;height:16px;flex-shrink:0;">
      <span style="flex:1;font-size:0.85rem;">${escHtml(t.label)}</span>
      <input type="number" class="form-input tmpl-amount" data-i="${i}" value="${t.amount}" min="0" step="1"
        style="width:80px;padding:4px 8px;font-size:0.82rem;" placeholder="0">
      <span style="font-size:0.75rem;color:var(--text-3);">€/mois</span>
    </label>`
  ).join('');
  openModal('📋 Charges types',
    `<p style="font-size:0.78rem;color:var(--text-3);margin-bottom:10px;">Cochez les charges à ajouter et ajustez les montants.</p>
     <div>${rows}</div>`,
    `<button class="btn btn-outline" id="tmpl-cancel">Annuler</button>
     <button class="btn btn-primary" id="tmpl-confirm">Importer les sélectionnées</button>`
  );
  document.getElementById('tmpl-cancel')?.addEventListener('click', closeModal);
  document.getElementById('tmpl-confirm')?.addEventListener('click', async () => {
    const checks = document.querySelectorAll('.tmpl-check:checked');
    if (!checks.length) { showToast('Sélectionnez au moins une charge', 'error'); return; }
    let count = 0;
    for (const cb of checks) {
      const i = parseInt(cb.dataset.i);
      const t = TEMPLATES[i];
      const amt = parseFloat(document.querySelector(`.tmpl-amount[data-i="${i}"]`)?.value) || t.amount;
      if (amt <= 0) continue;
      await saveCharge({
        label:    t.label,
        category: t.category || 'autre',
        active:   true,
        perso:    false,
        year:     State.year,
        month:    State.month,
        lines:    [{ amount: amt, qui: t.qui, dayOfMonth: 1 }],
        amount:   amt,
      });
      count++;
    }
    closeModal();
    showToast(`${count} charge${count > 1 ? 's' : ''} importée${count > 1 ? 's' : ''} ✅`, 'success');
    onSave?.();
  });
}

// ══════════════════════════════════════════════════

async function renderAchats(container) {
  const { year, month } = State;
  const tc     = container.querySelector('#tab-content');
  const achats = await getAchatsForMonth(year, month);

  const monthNav = `
    <div class="month-nav" style="margin-bottom:12px;">
      <button class="month-btn" id="ach-prev">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M15 18l-6-6 6-6"/></svg>
      </button>
      <div style="text-align:center;">
        <div class="month-nav-label">${nomMois(month)}</div>
        <div class="month-nav-year">${year}</div>
      </div>
      <button class="month-btn" id="ach-next">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M9 18l6-6-6-6"/></svg>
      </button>
    </div>
  `;

  if (!achats.length) {
    tc.innerHTML = monthNav + `
      <div class="empty-state">
        <div class="empty-state-icon">🛍️</div>
        <div class="empty-state-title">Aucune dépense ponctuelle</div>
        <div class="empty-state-text">Pour ce mois, aucune dépense exceptionnelle enregistrée.</div>
      </div>
      <div style="height:80px;"></div>
    `;
  } else {
    const total = achats.reduce((acc, a) => acc + (Number(a.amount) || 0), 0);
    tc.innerHTML = monthNav + `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
        <span style="font-size:0.78rem;color:var(--text-3);">${achats.length} achat(s)</span>
        <span class="chip danger">Total: ${eur(total)}</span>
      </div>
      <div class="item-list">
        ${achats.map(a => buildAchatItem(a)).join('')}
      </div>
      <div style="height:80px;"></div>
    `;
  }

  tc.querySelectorAll('.list-item[data-aid]').forEach(el => {
    el.addEventListener('click', async () => {
      const id = Number(el.dataset.aid);
      const a  = achats.find(x => x.id === id);
      if (a) showAchatModal(a, () => renderAchats(container));
    });
  });

  tc.querySelector('#ach-prev')?.addEventListener('click', () => {
    const n = addMonth(State.year, State.month, -1);
    State.year = n.year; State.month = n.month;
    renderAchats(container);
  });
  tc.querySelector('#ach-next')?.addEventListener('click', () => {
    const n = addMonth(State.year, State.month, 1);
    State.year = n.year; State.month = n.month;
    renderAchats(container);
  });

  tc.querySelector('#btn-copy-achats')?.addEventListener('click', () =>
    showCopyAchatsModal(year, month, () => renderAchats(container))
  );
}

async function showCopyAchatsModal(destYear, destMonth, onSave) {
  const years   = await getAvailableYears();
  if (!years.length) { showToast('Aucun mois disponible', 'error'); return; }

  const MOIS_LABEL = ['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre'];
  const destLabel  = `${MOIS_LABEL[destMonth - 1]} ${destYear}`;

  // Générer la liste de tous les mois disponibles sauf le mois de destination
  const monthOptions = [];
  for (const y of years.sort((a, b) => b - a)) {
    for (let m = 12; m >= 1; m--) {
      if (y === destYear && m === destMonth) continue;
      monthOptions.push(`<option value="${y}-${m}">${MOIS_LABEL[m-1]} ${y}</option>`);
    }
  }

  openModal(`📋 Copier vers ${destLabel}`, `
    <p style="font-size:0.85rem;color:var(--text-2);margin-bottom:12px;">
      Sélectionnez le mois source. Les achats exceptionnels seront copiés vers <strong>${destLabel}</strong>.
    </p>
    <div class="form-group" style="margin-bottom:12px;">
      <label class="form-label">Mois source</label>
      <select class="form-input" id="copy-src-month">
        ${monthOptions.join('')}
      </select>
    </div>
    <div id="copy-preview" style="font-size:0.82rem;color:var(--text-3);min-height:40px;"></div>
  `, `<button class="btn btn-primary btn-full" id="copy-confirm">Copier les achats</button>`);

  let srcAchats = [];

  const preview = document.getElementById('copy-preview');
  const doPreview = async () => {
    const [y, m] = document.getElementById('copy-src-month')?.value.split('-').map(Number) || [];
    if (!y || !m) return;
    srcAchats = await getAchatsForMonth(y, m);
    if (!srcAchats.length) {
      preview.innerHTML = `<span style="color:var(--warning);">Aucune dépense ponctuelle pour ce mois.</span>`;
    } else {
      preview.innerHTML = `✅ ${srcAchats.length} achat(s) trouvé(s) — ${srcAchats.map(a => escHtml(a.label)).join(', ')}`;
    }
  };

  document.getElementById('copy-src-month')?.addEventListener('change', doPreview);
  doPreview();

  document.getElementById('copy-confirm')?.addEventListener('click', async () => {
    if (!srcAchats.length) { showToast('Aucun achat à copier', 'error'); return; }
    for (const a of srcAchats) {
      const { id: _id, ...rest } = a;
      await saveAchat({ ...rest, year: destYear, month: destMonth });
    }
    closeModal();
    showToast(`${srcAchats.length} achat(s) copié(s) ✅`, 'success');
    onSave();
  });
}

function buildAchatItem(a) {
  const info     = getCategoryInfo(a.category);
  const amount   = Number(a.amount) || 0;
  const quiLabel = getQuiLabel(a.qui);

  return `
    <div class="list-item" data-aid="${a.id}" style="cursor:pointer;">
      <div class="list-item-icon" style="background:var(--warning-bg);">${info.emoji}</div>
      <div class="list-item-body">
        <div class="list-item-title">${escHtml(a.label)}</div>
        <div class="list-item-sub">${escHtml(info.label)}</div>
      </div>
      <div class="list-item-right">
        <div class="list-item-amount">${eur(amount)}</div>
        <span class="qui-badge">${escHtml(quiLabel)}</span>
      </div>
    </div>
  `;
}

// ══════════════════════════════════════════════════
// ONGLET BUDGETS (repris de budgets.js)
// ══════════════════════════════════════════════════

async function renderBudgets(container) {
  const { year, month } = State;
  const [achats, budgetOps, settings] = await Promise.all([
    getAchatsForMonth(year, month),
    getBudgetOpsForMonth(year, month),
    getAllSettings(),
  ]);
  const users = _users;
  const ym = `${year}-${month}`;
  const customBudgets  = (settings.customBudgets || []).filter(b => !b.yearMonth || b.yearMonth === ym);
  const pinnedBudgets  = settings.pinnedBudgets   || [];
  const tc = container.querySelector('#tab-content');

  // Effective budget total (handles allocation modes)
  const effectiveBudget = b => {
    if (b.allocation === 'equal')  return (Number(b.amount) || 0) * users.length;
    if (b.allocation === 'custom') return Object.values(b.amountByUser || {}).reduce((s, v) => s + (Number(v) || 0), 0);
    return Number(b.amount) || 0;
  };

  const opsByCategory = {};
  for (const op of budgetOps) { (opsByCategory[op.category] ??= []).push(op); }
  const spent = cat => (opsByCategory[cat] || []).reduce((s, op) => s + (Number(op.amount) || 0), 0);

  const pendingCraquages = achats.filter(a => a.category === 'craquage' && a.craquage_source === 'pending');

  tc.innerHTML = `
    <div style="display:flex;justify-content:flex-end;margin-bottom:14px;">
      <button class="btn btn-sm btn-secondary" id="bgt-manage">⚙️ Gérer les budgets</button>
    </div>
    ${pendingCraquages.length > 0 ? `
    <div class="card" style="margin-bottom:12px;border:1.5px solid var(--warning);">
      <div class="card-header">
        <span class="card-title">⚠️ Dépassements en attente</span>
        <span class="chip warning">${pendingCraquages.length}</span>
      </div>
      <p style="font-size:0.78rem;color:var(--text-3);margin-bottom:8px;">Ces dépassements de budget n'ont pas encore de source de financement.</p>
      <div class="item-list">${pendingCraquages.map(a => `<div class="list-item"><div class="list-item-icon" style="background:var(--warning-bg);">⏳</div><div class="list-item-body"><div class="list-item-title">${escHtml(a.label)}</div></div><div class="list-item-right"><div class="list-item-amount" style="color:var(--warning);">−${eur(a.amount)}</div><button class="btn btn-sm btn-primary" style="margin-top:4px;" data-attrib-crq="${a.id}">Attribuer</button></div></div>`).join('')}</div>
    </div>` : ''}
    ${customBudgets.length === 0
      ? `<div style="text-align:center;padding:28px 0 16px;color:var(--text-3);">
          <div style="font-size:2rem;margin-bottom:8px;">📌</div>
          <p style="font-size:0.84rem;margin-bottom:4px;">Aucun budget créé pour le moment.</p>
          <p style="font-size:0.78rem;">Cliquez sur <strong>+ Nouveau budget personnalisé</strong> ci-dessous pour commencer.</p>
        </div>`
      : customBudgets.map(b => _buildBudCatSection({ id:b.id, icon:b.icon||'📌', title:b.name, budget:effectiveBudget(b), spent:spent(b.id), ops:opsByCategory[b.id]||[], users, isPinned:pinnedBudgets.includes(b.id) })).join('')
    }
    <button class="btn btn-outline btn-full" id="bgt-add-custom" style="margin-bottom:80px;">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="15" height="15"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
      Nouveau budget personnalisé
    </button>
  `;

  tc.querySelector('#bgt-add-custom')?.addEventListener('click', () => showEditBudgetModal(null, customBudgets, () => renderBudgets(container), users, year, month));
  tc.querySelector('#bgt-manage')?.addEventListener('click', () => _showManageBudgetsModal(customBudgets, () => renderBudgets(container), users));

  tc.querySelectorAll('[data-bgt-add-op]').forEach(btn => {
    btn.addEventListener('click', () => {
      const catId   = btn.dataset.bgtAddOp;
      const catName = btn.dataset.catName || catId;
      const catIcon = btn.dataset.catIcon || '📌';
      _showAddBudgetOpModal({ catId, catLabel:`${catIcon} ${catName}` }, users, year, month, () => renderBudgets(container));
    });
  });
  tc.querySelectorAll('[data-bgt-del-op]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const opId = Number(btn.dataset.bgtDelOp);
      const li = btn.closest('.list-item');
      if (li) li.style.display = 'none';
      showToastWithUndo('Opération supprimée',
        async () => { await deleteBudgetOp(opId); renderBudgets(container); }, 6000, 'warning',
        () => { if (li) li.style.display = ''; });
    });
  });
  tc.querySelectorAll('[data-bgt-peruser]').forEach(btn => {
    btn.addEventListener('click', () => {
      const catId = btn.dataset.bgtPeruser;
      const sec = tc.querySelector(`#bgt-peruser-${catId}`);
      if (!sec) return;
      const open = sec.style.display !== 'none';
      sec.style.display = open ? 'none' : '';
      btn.textContent = open ? '🏠 Foyer' : '👤 Par personne';
    });
  });

  tc.querySelectorAll('[data-bgt-pin]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const catId = btn.dataset.bgtPin;
      const s2    = await getAllSettings();
      const pins  = [...(s2.pinnedBudgets || ['courses', 'extras'])];
      const idx   = pins.indexOf(catId);
      if (idx >= 0) {
        pins.splice(idx, 1);
        await setSetting('pinnedBudgets', pins);
        showToast("Désépinglé de l'accueil", 'success');
      } else {
        if (pins.length >= 2) { showToast('Maximum 2 budgets épinglés en accueil', 'warning'); return; }
        pins.push(catId);
        await setSetting('pinnedBudgets', pins);
        showToast('Épinglé en accueil ✅', 'success');
      }
      renderBudgets(container);
    });
  });

  tc.querySelectorAll('[data-bgt-edit]').forEach(btn => {
    btn.addEventListener('click', () => {
      const b = customBudgets.find(b => b.id === btn.dataset.bgtEdit);
      if (b) showEditBudgetModal(b, customBudgets, () => renderBudgets(container), users);
    });
  });

  // Attribuer une source à un craquage en attente
  tc.querySelectorAll('[data-attrib-crq]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const achatId = parseInt(btn.dataset.attribCrq);
      const pendingAchat = pendingCraquages.find(a => a.id === achatId);
      if (!pendingAchat) return;
      const { showCraquageModal } = await import('./saisie.js');
      showCraquageModal(null, month, year, users, () => renderBudgets(container),
        { label: pendingAchat.label, amount: pendingAchat.amount, pendingId: achatId });
    });
  });

  // Toggle ops list collapse per budget category
  tc.querySelectorAll('[data-bgt-ops-toggle]').forEach(btn => {
    btn.addEventListener('click', () => {
      const catId = btn.dataset.bgtOpsToggle;
      const sec = tc.querySelector(`#bgt-ops-${catId}`);
      if (!sec) return;
      const open = sec.style.display !== 'none';
      sec.style.display = open ? 'none' : '';
      btn.querySelector('span') && (btn.querySelector('span').textContent =
        open ? `📋 Voir les opérations` : `📋 Masquer les opérations`);
    });
  });

}

function _buildBudCatSection({ id, icon, title, budget, spent, ops, users, hint, isPinned = false, perUserBudgets = null }) {
  const remaining = budget - spent;
  const pct = budget > 0 ? Math.min(100, Math.round((spent / budget) * 100)) : (spent > 0 ? 100 : 0);
  const color = pct >= 100 ? 'danger' : pct >= 80 ? 'warning' : 'success';
  const sorted = [...ops].sort((a,b) => (b.day||0)-(a.day||0));
  const editBtn = `<button class="btn-icon" data-bgt-edit="${id}" title="Modifier" style="width:28px;height:28px;color:var(--text-3);">✏️</button>`;
  const pinBtn  = `<button class="btn-icon" data-bgt-pin="${id}" title="${isPinned ? 'Désépingler de l\'accueil' : 'Épingler en accueil'}" style="width:28px;height:28px;color:${isPinned ? 'var(--primary)' : 'var(--text-3)'};background:${isPinned ? 'var(--primary-bg)' : 'transparent'};border-radius:6px;border:${isPinned ? '1.5px solid var(--primary)' : '1.5px solid var(--border)'};">${isPinned ? '📌' : '📍'}</button>`;

  // Per-user view toggle (only for extras when N>1)
  const showPerUserToggle = perUserBudgets && perUserBudgets.length > 1;
  const perUserToggleBtn  = showPerUserToggle
    ? `<button class="btn btn-sm btn-outline" data-bgt-peruser="${id}" style="font-size:0.72rem;padding:3px 8px;">🏠 Foyer</button>`
    : '';
  const perUserSection    = showPerUserToggle
    ? `<div id="bgt-peruser-${id}" style="display:none;margin-top:8px;border-top:1px solid var(--border);padding-top:8px;">
        ${perUserBudgets.map(u => {
          const uPct   = u.budget > 0 ? Math.min(100, Math.round((u.spent / u.budget) * 100)) : 0;
          const uColor = uPct >= 100 ? 'danger' : uPct >= 80 ? 'warning' : 'success';
          return `<div style="margin-bottom:6px;">
            <div style="display:flex;justify-content:space-between;font-size:0.75rem;margin-bottom:3px;">
              <span style="display:flex;align-items:center;gap:5px;font-weight:600;">
                <span style="width:7px;height:7px;border-radius:50%;background:${escHtml(u.color||'#6C63FF')};display:inline-block;"></span>
                ${escHtml(u.name)}
              </span>
              <span style="color:var(--text-3);">${eur(u.spent)} / ${u.budget > 0 ? eur(u.budget) : '—'}</span>
            </div>
            <div class="progress-track" style="height:6px;"><div class="progress-bar ${uColor}" style="width:${uPct}%;"></div></div>
          </div>`;
        }).join('')}
      </div>`
    : '';

  return `<div class="card" data-budget-id="${id}" style="margin-bottom:12px;">
    <div class="card-header">
      <span class="card-title">${icon} ${escHtml(title)}</span>
      <div style="display:flex;align-items:center;gap:4px;">
        ${perUserToggleBtn}
        ${editBtn}
        ${pinBtn}
        <button class="btn btn-sm btn-primary" data-bgt-add-op="${id}" data-cat-name="${escHtml(title)}" data-cat-icon="${escHtml(icon)}" data-cat-budget="${budget}" data-cat-spent="${spent}">+ Ajouter</button>
      </div>
    </div>
    ${hint ? `<div style="font-size:0.75rem;color:var(--warning);background:var(--warning-bg);padding:6px 10px;border-radius:var(--radius-sm);margin-bottom:10px;">${hint}</div>` : ''}
    <div style="margin-bottom:10px;">
      <div class="progress-track" style="height:10px;margin-bottom:6px;"><div class="progress-bar ${color}" style="width:${pct}%;"></div></div>
      <div style="display:flex;justify-content:space-between;font-size:0.78rem;">
        <span style="color:var(--${color});font-weight:700;">${eur(spent)} dépensé${pct > 0 ? ' (' + pct + '%)' : ''}</span>
        <span style="color:var(--text-2);">Budget : ${budget > 0 ? eur(budget) : '—'}</span>
      </div>
      ${budget > 0 ? `<div style="font-size:0.72rem;color:${remaining>=0?'var(--success)':'var(--danger)'};text-align:right;margin-top:3px;">${remaining>=0?`✅ Reste ${eur(remaining)}`:`⚠️ Dépassement ${eur(Math.abs(remaining))}`}</div>` : ''}
    </div>
    ${perUserSection}
    ${sorted.length === 0
      ? `<div style="font-size:0.82rem;color:var(--text-3);text-align:center;padding:8px 0;">Aucune opération — cliquez sur <strong>+ Ajouter</strong></div>`
      : `<button class="btn btn-outline btn-full btn-sm" data-bgt-ops-toggle="${id}" style="font-size:0.78rem;">📋 Voir les opérations (${sorted.length})</button>
         <div id="bgt-ops-${id}" style="display:none;margin-top:8px;">
           <div class="item-list">${sorted.map(op => {
             const u = op.userId ? users.find(u => String(u.id)===String(op.userId)) : null;
             const dateStr = op.day ? `${op.day} ${nomMois(op.month)}` : nomMois(op.month);
             return `<div class="list-item">
               <div class="list-item-icon" style="background:var(--danger-bg);">🧾</div>
               <div class="list-item-body">
                 <div class="list-item-title">${escHtml(op.label||'Opération')}</div>
                 <div class="list-item-sub">${dateStr}${u?` · ${escHtml(u.name)}`:''}</div>
               </div>
               <div class="list-item-right">
                 <div class="list-item-amount" style="color:var(--danger);">−${eur(op.amount)}</div>
                 <button class="btn-icon" data-bgt-del-op="${op.id}" style="width:24px;height:24px;color:var(--text-3);font-size:0.8rem;" title="Supprimer">🗑️</button>
               </div>
             </div>`;
           }).join('')}</div>
         </div>`
    }
  </div>`;
}

async function _showAddBudgetOpModal({ catId, catLabel }, users, year, month, onSave) {
  // Fetch fresh budget and spent values before opening the modal
  const [freshMd, freshSettings, freshBudgetOps] = await Promise.all([
    getMonthlyData(year, month),
    getAllSettings(),
    getBudgetOpsForMonth(year, month),
  ]);
  const freshCustom = freshSettings.customBudgets || [];
  const customEntry = freshCustom.find(b => b.id === catId);
  const catBudget = customEntry
    ? (Number(customEntry.amount) || 0)
    : users.reduce((s, u) => s + (Number(freshMd?.users?.[String(u.id)]?.[catId]) || 0), 0);
  const catSpent = freshBudgetOps
    .filter(op => op.category === catId)
    .reduce((s, op) => s + (Number(op.amount) || 0), 0);

  const daysInMonth = new Date(year, month, 0).getDate();
  const todayDay    = new Date().getDate();
  const userSelect  = users.length > 1
    ? `<div class="form-group" style="margin-bottom:10px;"><label class="form-label">Personne</label><select class="form-input" id="bop-user"><option value="">— Sans attribution —</option><option value="shared">🤝 Partagé (tous)</option>${users.map(u=>`<option value="${u.id}">${escHtml(u.name)}</option>`).join('')}</select></div>
    <div id="bop-split-section" style="display:none;padding:8px;background:var(--bg-secondary);border-radius:var(--radius-sm);margin-bottom:10px;">
      <div style="font-size:0.7rem;color:var(--text-3);margin-bottom:6px;">Répartition personnalisée (%) — total doit faire 100%</div>
      ${users.map(u => `<div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;">
        <span style="width:8px;height:8px;border-radius:50%;background:${escHtml(u.color||'#6C63FF')};display:inline-block;"></span>
        <span style="flex:1;font-size:0.78rem;">${escHtml(u.name)}</span>
        <input type="number" class="form-input bop-split-pct" data-uid="${u.id}" min="0" max="100" step="1" value="${Math.round(100/users.length)}" style="width:62px;text-align:right;padding:4px 6px;">
        <span style="color:var(--text-3);font-size:0.78rem;">%</span>
      </div>`).join('')}
      <div id="bop-split-hint" style="text-align:right;font-size:0.7rem;margin-top:2px;"></div>
    </div>`
    : '';
  const remaining0  = catBudget > 0 ? Math.max(0, catBudget - catSpent) : null;
  const budgetInfo  = catBudget > 0
    ? `<div style="background:var(--bg-2);border-radius:var(--radius-sm);padding:8px 10px;margin-bottom:10px;font-size:0.78rem;display:flex;gap:12px;flex-wrap:wrap;">
        <span>Plafond : <strong>${eur(catBudget)}</strong></span>
        <span>Dépensé : <strong>${eur(catSpent)}</strong></span>
        <span style="color:${remaining0 <= 0 ? 'var(--danger)' : 'var(--success)'};">Restant : <strong>${eur(remaining0)}</strong></span>
      </div>`
    : '';
  openModal(`+ Opération ${catLabel}`, `
    ${budgetInfo}
    <div class="form-group" style="margin-bottom:10px;"><label class="form-label">Enseigne / Description *</label><input type="text" class="form-input" id="bop-label" placeholder="Ex: Carrefour, restaurant…" autocomplete="off"></div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px;">
      <div class="form-group"><label class="form-label">Jour</label><input type="number" class="form-input" id="bop-day" min="1" max="${daysInMonth}" value="${todayDay}"></div>
      <div class="form-group"><label class="form-label">Montant (€) *</label><div class="input-wrap"><input type="number" class="form-input input-euro" id="bop-amount" min="0.01" step="0.01" placeholder="0.00"><span class="input-suffix">€</span></div></div>
    </div>
    ${userSelect}
    <p style="font-size:0.72rem;color:var(--text-3);">Mois : ${nomMois(month)} ${year}</p>
  `, `<button class="btn btn-primary btn-full" id="bop-save">Enregistrer</button>`);
  document.getElementById('bop-label')?.focus();
  // ── Répartition personnalisée ──
  const bopUserSel  = document.getElementById('bop-user');
  const bopSplitSec = document.getElementById('bop-split-section');
  const updateBopHint = () => {
    const total = [...document.querySelectorAll('.bop-split-pct')].reduce((s,i)=>s+(Number(i.value)||0),0);
    const hint  = document.getElementById('bop-split-hint');
    if (hint) { hint.style.color = Math.abs(total-100)<0.5?'var(--success)':'var(--danger)'; hint.textContent=`Total : ${total}%${Math.abs(total-100)>=0.5?' ⚠️':' ✅'}`; }
  };
  if (bopSplitSec) {
    bopUserSel?.addEventListener('change', () => {
      bopSplitSec.style.display = bopUserSel.value==='shared' ? '' : 'none';
      if (bopUserSel.value==='shared') updateBopHint();
    });
    document.querySelectorAll('.bop-split-pct').forEach(i=>i.addEventListener('input', updateBopHint));
  }
  document.getElementById('bop-save')?.addEventListener('click', async () => {
    const label   = document.getElementById('bop-label')?.value.trim();
    const amount  = parseFloat(document.getElementById('bop-amount')?.value);
    const day     = parseInt(document.getElementById('bop-day')?.value, 10) || null;
    const userVal = (() => { const el = document.getElementById('bop-user'); return el ? (el.value || null) : (users.length === 1 ? String(users[0].id) : null); })();
    if (!label)              { showToast('Saisissez une description', 'error'); return; }
    if (!amount || amount <= 0) { showToast('Montant invalide', 'error'); return; }

    // Overflow detection using values fetched before modal opened (captured in closure)
    const remaining    = catBudget > 0 ? Math.max(0, catBudget - catSpent) : Infinity;
    const hasOverflow  = catBudget > 0 && amount > remaining;
    const cappedAmount = hasOverflow ? remaining : amount;
    const overflowAmt  = hasOverflow ? +(amount - remaining).toFixed(2) : 0;

    if (userVal === 'shared' && users.length > 1) {
      if (cappedAmount > 0) {
        const splitInputs = document.querySelectorAll('.bop-split-pct');
        const useSplit = splitInputs.length > 0 && bopSplitSec?.style.display !== 'none';
        const sumPcts = useSplit ? [...splitInputs].reduce((s,i)=>s+(Number(i.value)||0),0)||100 : 100;
        for (const u of users) {
          const pct = useSplit ? (Number(document.querySelector(`.bop-split-pct[data-uid='${u.id}']`)?.value)||0) / sumPcts : 1/users.length;
          const share = +(cappedAmount * pct).toFixed(2);
          if (share > 0) await saveBudgetOp({ category: catId, year, month, day, label, amount: share, userId: u.id });
        }
      }
    } else {
      if (cappedAmount > 0) await saveBudgetOp({ category: catId, year, month, day, label, amount: cappedAmount, userId: userVal });
    }
    if (overflowAmt > 0) {
      await saveAchat({
        year, month, day: day || new Date().getDate(),
        label: `${label} — Dépassement de budget`,
        amount: overflowAmt,
        category: 'craquage',
        craquage_source: 'pending',
        qui: userVal === 'shared' ? 'shared' : (userVal || 'shared'),
        createdAt: new Date().toISOString(),
      });
      closeModal();
      showToast(`Budget atteint — ${eur(overflowAmt)} en attente d'attribution 💥`, 'warning');
    } else {
      closeModal();
      showToast('Opération ajoutée ✅', 'success');
    }
    onSave();
  });
}

export function showEditBudgetModal(existing, customBudgets, onSave, users = [], year = null, month = null) {
  const isNew      = !existing;
  const _year  = year  ?? State.year;
  const _month = month ?? State.month;
  const multiUser  = users.length > 1;
  const selIcon    = existing?.icon || '📌';
  const existingAlloc = existing?.allocation || 'shared';
  // RF-3 : garantir que les valeurs amountByUser sont des Numbers (données legacy éventuellement des strings)
  const existingAmountByUser = Object.fromEntries(
    Object.entries(existing?.amountByUser || {}).map(([k, v]) => [k, Number(v) || 0])
  );

  const PRESET_BUDGETS = [
    { name: 'Restaurant', icon: '🍽️' },
    { name: 'Loisirs',    icon: '🎉' },
    { name: 'Courses',    icon: '🛒' },
    { name: 'Vêtements',  icon: '👗' },
    { name: 'Gaming',     icon: '🎮' },
    { name: 'Cinéma',     icon: '🎬' },
    { name: 'Voyage',     icon: '✈️' },
  ];
  const availablePresets = isNew ? PRESET_BUDGETS : [];
  const presetsPlaceholder = availablePresets.length > 0
    ? `<div style="margin-bottom:14px;">
        <div style="font-size:0.72rem;font-weight:700;color:var(--text-3);text-transform:uppercase;margin-bottom:6px;">Démarrer depuis un modèle</div>
        <div id="bgt-presets-container" style="display:flex;flex-wrap:wrap;gap:6px;"></div>
      </div><hr style="margin-bottom:14px;border-color:var(--border);">`
    : '';

  const allocSection = `
    <div class="form-group" style="margin-bottom:16px;">
      <label class="form-label">Répartition du budget</label>
      <div class="alloc-opts">
        <label class="alloc-opt">
          <input type="radio" name="bgt-alloc" value="shared" ${existingAlloc==='shared'?'checked':''}>
          <span class="alloc-opt-inner">
            <span class="alloc-opt-emoji">🏠</span>
            <span class="alloc-opt-text"><strong>Budget commun</strong><small>Plafond unique pour le foyer</small></span>
            <span class="alloc-opt-check">✓</span>
          </span>
        </label>
        ${multiUser ? `
        <label class="alloc-opt">
          <input type="radio" name="bgt-alloc" value="equal" ${existingAlloc==='equal'?'checked':''}>
          <span class="alloc-opt-inner">
            <span class="alloc-opt-emoji">⚖️</span>
            <span class="alloc-opt-text"><strong>Parts égales</strong><small>Même montant par personne</small></span>
            <span class="alloc-opt-check">✓</span>
          </span>
        </label>
        <label class="alloc-opt">
          <input type="radio" name="bgt-alloc" value="custom" ${existingAlloc==='custom'?'checked':''}>
          <span class="alloc-opt-inner">
            <span class="alloc-opt-emoji">🎯</span>
            <span class="alloc-opt-text"><strong>Personnalisé</strong><small>Montant différent par personne</small></span>
            <span class="alloc-opt-check">✓</span>
          </span>
        </label>` : ''}
      </div>
    </div>`;

  const sharedAmountLabel = !multiUser ? 'Montant mensuel (€)' : existingAlloc === 'equal' ? 'Montant par personne (€)' : 'Montant total mensuel (€)';
  const amountSection = `
    <div id="bgt-amount-shared" style="${multiUser && existingAlloc==='custom' ? 'display:none;' : ''}margin-bottom:12px;">
      <div class="form-group">
        <label class="form-label" id="bgt-amount-label">${sharedAmountLabel}</label>
        <div class="input-wrap">
          <input type="number" class="form-input input-euro" id="bgt-amount" min="0" step="5" placeholder="0" value="${existing?.amount||''}">
          <span class="input-suffix">€</span>
        </div>
        <p class="form-hint">0 = suivi libre sans plafond.</p>
      </div>
    </div>
    ${multiUser ? `<div id="bgt-amount-custom" style="${existingAlloc==='custom' ? '' : 'display:none;'}margin-bottom:12px;">
      ${users.map(u => `
        <div class="form-group" style="margin-bottom:8px;">
          <label class="form-label" style="display:flex;align-items:center;gap:6px;">
            <span style="width:8px;height:8px;border-radius:50%;background:${escHtml(u.color||'#6C63FF')};display:inline-block;"></span>
            ${escHtml(u.name)} (€)
          </label>
          <div class="input-wrap">
            <input type="number" class="form-input input-euro bgt-amount-user" data-uid="${u.id}" min="0" step="5" placeholder="0" value="${existingAmountByUser[u.id]||''}">
            <span class="input-suffix">€</span>
          </div>
        </div>`).join('')}
    </div>` : ''}`;

  openModal(isNew ? '📌 Nouveau budget' : `✏️ Modifier "${existing.name}"`, `${presetsPlaceholder}
    <div class="form-group" style="margin-bottom:12px;"><label class="form-label">Nom *</label><input type="text" class="form-input" id="bgt-name" placeholder="Ex: Restaurant, Sport…" value="${escHtml(existing?.name||'')}" autocomplete="off"></div>
    ${allocSection}
    ${amountSection}
    <div class="form-group" style="margin-bottom:12px;"><label class="form-label">Icône</label><input type="text" class="form-input" id="bgt-icon" maxlength="4" value="${escHtml(selIcon)}" style="font-size:1.4rem;text-align:center;" readonly></div>
    <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:14px;">${PRESET_ICONS.map(ic=>`<button type="button" class="btn-icon icon-pick" data-icon="${ic}" style="width:36px;height:36px;font-size:1.2rem;border:2px solid ${ic===selIcon?'var(--primary)':'transparent'};border-radius:8px;background:var(--bg-card);">${ic}</button>`).join('')}</div>
    ${!isNew ? `<hr style="margin-bottom:12px;"><button class="btn btn-outline btn-full" id="bgt-delete" style="color:var(--danger);border-color:var(--danger);">🗑️ Supprimer ce budget</button>` : ''}
  `, `<button class="btn btn-primary btn-full" id="bgt-save">${isNew ? 'Créer' : 'Enregistrer'}</button>`);

  document.getElementById('bgt-name')?.focus();

  // Presets via createElement (emoji-safe)
  const presetsContainer = document.getElementById('bgt-presets-container');
  if (presetsContainer) {
    availablePresets.forEach(p => {
      const btn = document.createElement('button');
      btn.type = 'button'; btn.className = 'btn btn-sm btn-outline';
      btn.style.cssText = 'font-size:0.78rem;padding:4px 10px;';
      btn.textContent = p.icon + ' ' + p.name;
      btn.addEventListener('click', () => {
        const nameEl = document.getElementById('bgt-name');
        const iconEl = document.getElementById('bgt-icon');
        if (nameEl) nameEl.value = p.name;
        if (iconEl) iconEl.value = p.icon;
        document.querySelectorAll('.icon-pick').forEach(b => { b.style.borderColor = b.dataset.icon === p.icon ? 'var(--primary)' : 'transparent'; });
      });
      presetsContainer.appendChild(btn);
    });
  }

  // Allocation toggle (multi-user only)
  if (multiUser) {
    document.querySelectorAll('input[name="bgt-alloc"]').forEach(radio => {
      radio.addEventListener('change', () => {
        const val = radio.value;
        const sharedDiv = document.getElementById('bgt-amount-shared');
        const customDiv = document.getElementById('bgt-amount-custom');
        const lbl = document.getElementById('bgt-amount-label');
        if (val === 'custom') {
          if (sharedDiv) sharedDiv.style.display = 'none';
          if (customDiv) customDiv.style.display = '';
        } else {
          if (sharedDiv) sharedDiv.style.display = '';
          if (customDiv) customDiv.style.display = 'none';
          if (lbl) lbl.textContent = val === 'equal' ? 'Montant par personne (€)' : 'Montant total mensuel (€)';
        }
      });
    });
  }

  document.querySelectorAll('.icon-pick').forEach(btn => {
    btn.addEventListener('click', () => { document.querySelectorAll('.icon-pick').forEach(b=>b.style.borderColor='transparent'); btn.style.borderColor='var(--primary)'; document.getElementById('bgt-icon').value=btn.dataset.icon; });
  });
  document.getElementById('bgt-delete')?.addEventListener('click', async () => {
    if (!confirm(`Supprimer le budget "${existing.name}" ?`)) return;
    await setSetting('customBudgets', customBudgets.filter(b=>b.id!==existing.id));
    closeModal(); showToast('Budget supprimé', 'success'); await onSave();
  });
  document.getElementById('bgt-save')?.addEventListener('click', async () => {
    const name  = document.getElementById('bgt-name')?.value.trim();
    const icon  = document.getElementById('bgt-icon')?.value || '📌';
    const alloc = multiUser ? (document.querySelector('input[name="bgt-alloc"]:checked')?.value || 'shared') : 'shared';
    if (!name) { showToast('Saisissez un nom', 'error'); return; }

    let amount, amountByUser;
    if (alloc === 'custom') {
      amountByUser = {};
      let total = 0;
      document.querySelectorAll('.bgt-amount-user').forEach(inp => {
        const v = parseFloat(inp.value) || 0;
        amountByUser[inp.dataset.uid] = v;
        total += v;
      });
      amount = total;
      if (isNew && total <= 0) { showToast('Saisissez au moins un montant', 'error'); return; }
    } else {
      amount = parseFloat(document.getElementById('bgt-amount')?.value) || 0;
      if (isNew && amount <= 0) { showToast('Saisissez un montant mensuel', 'error'); return; }
      amountByUser = undefined;
    }

    const entry = isNew
      ? { id: 'custom_'+Date.now(), name, icon, amount, allocation: alloc, amountByUser, yearMonth: `${_year}-${_month}` }
      : { ...existing, name, icon, amount, allocation: alloc, amountByUser };
    const updated = isNew ? [...customBudgets, entry] : customBudgets.map(b => b.id===existing.id ? entry : b);
    await setSetting('customBudgets', updated);
    closeModal(); showToast(isNew ? `Budget "${name}" créé ✅` : 'Mis à jour ✅', 'success'); await onSave();
  });
}

function _showManageBudgetsModal(customBudgets, onSave, users = []) {
  openModal('⚙️ Gérer mes budgets', customBudgets.length===0
    ? `<p style="color:var(--text-3);font-size:0.85rem;text-align:center;padding:12px 0;">Aucun budget personnalisé.<br>Utilisez <strong>+ Nouveau budget</strong>.</p>`
    : `<div class="item-list">${customBudgets.map(b=>`<div class="list-item" style="padding:10px 12px;"><div class="list-item-icon" style="font-size:1.2rem;background:var(--bg-2);">${b.icon||'📌'}</div><div class="list-item-body"><div class="list-item-title">${escHtml(b.name)}</div><div class="list-item-sub">${b.amount>0?eur(b.amount)+'/mois':'Suivi libre'}</div></div><div style="display:flex;gap:6px;"><button class="btn btn-sm btn-outline manage-edit" data-id="${b.id}">Modifier</button><button class="btn btn-sm btn-outline manage-del" data-id="${b.id}" style="color:var(--danger);border-color:var(--danger);">Supprimer</button></div></div>`).join('')}</div>`
  , `<button class="btn btn-primary btn-full" id="manage-add-new">+ Nouveau budget</button>`);
  document.getElementById('manage-add-new')?.addEventListener('click', () => { closeModal(); showEditBudgetModal(null, customBudgets, onSave, users); });
  document.querySelectorAll('.manage-edit').forEach(btn => {
    btn.addEventListener('click', () => { const b=customBudgets.find(b=>b.id===btn.dataset.id); if(b){closeModal();showEditBudgetModal(b,customBudgets,onSave,users);} });
  });
  document.querySelectorAll('.manage-del').forEach(btn => {
    btn.addEventListener('click', async () => {
      const b = customBudgets.find(b=>b.id===btn.dataset.id);
      if (!b) return;
      closeModal();
      const budgetSection = document.querySelector(`[data-budget-id="${b.id}"]`);
      if (budgetSection) budgetSection.style.display = 'none';
      showToastWithUndo(`Budget « ${b.name} » supprimé`,
        async () => { await setSetting('customBudgets',customBudgets.filter(x=>x.id!==b.id)); onSave(); },
        6000, 'warning',
        () => { if (budgetSection) budgetSection.style.display = ''; });
    });
  });
}

export async function showAchatModal(achat, onSave) {
  if (!_users.length) _users = await getActiveUsers();
  const now = new Date();
  const isNew = !achat;
  const a = achat ?? { year: State.year, month: State.month, day: now.getDate(), label: '', category: 'loisirs', amount: 0 };

  const catOptions = CATEGORIES.map(cat =>
    `<option value="${cat.id}" ${a.category === cat.id ? 'selected' : ''}>${cat.emoji} ${cat.label}</option>`
  ).join('');

  const moisOptions = MOIS.map((m, i) =>
    `<option value="${i+1}" ${a.month === i+1 ? 'selected' : ''}>${m}</option>`
  ).join('');

  const body = `
    <div class="form-group" style="margin-bottom:10px;">
      <label class="form-label">Libellé</label>
      <input type="text" class="form-input" id="a-label" placeholder="Ex: Télévision, Vêtements…" value="${escHtml(a.label)}">
    </div>
    <div class="form-grid-2" style="margin-bottom:10px;">
      <div class="form-group">
        <label class="form-label">Catégorie</label>
        <select class="form-select" id="a-cat">${catOptions}</select>
      </div>
      <div class="form-group">
        <label class="form-label">Montant (€)</label>
        <div class="input-wrap">
          <input type="number" class="form-input input-euro" id="a-amount" min="0" step="0.01" value="${a.amount || ''}">
          <span class="input-suffix">€</span>
        </div>
      </div>
    </div>
    <div class="form-group" style="margin-bottom:10px;">
      <label class="form-label">Qui paie ?</label>
      <select class="form-select" id="a-qui">
        ${_users.length > 1 ? `
          ${isNew ? `<option value="" disabled selected>— Sélectionner qui paie —</option>` : ''}
          <option value="shared" ${!isNew && a.qui === 'shared' ? 'selected' : ''}>🤝 Partagé (tous)</option>
          ${_users.map(u => `<option value="${u.id}" ${!isNew && String(a.qui) === String(u.id) ? 'selected' : ''}>${escHtml(u.name)}</option>`).join('')}
        ` : _users.map(u => `<option value="${u.id}" selected>${escHtml(u.name)}</option>`).join('')}
      </select>
    </div>
    ${_users.length > 1 ? `
    <div id="a-split-section" style="${a.qui === 'shared' ? '' : 'display:none;'}padding:8px;background:var(--bg-secondary);border-radius:var(--radius-sm);margin-bottom:10px;">
      <div style="font-size:0.7rem;color:var(--text-3);margin-bottom:6px;">Répartition personnalisée (%) — total doit faire 100%</div>
      ${_users.map(u => {
        const defPct = a.splitPcts ? (Number(a.splitPcts[String(u.id)]) || 0) : Math.round(100 / _users.length);
        return `<div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;">
          <span style="width:8px;height:8px;border-radius:50%;background:${escHtml(u.color||'#6C63FF')};display:inline-block;"></span>
          <span style="flex:1;font-size:0.78rem;">${escHtml(u.name)}</span>
          <input type="number" class="form-input a-split-pct" data-uid="${u.id}" min="0" max="100" step="1" value="${defPct}" style="width:62px;text-align:right;padding:4px 6px;">
          <span style="color:var(--text-3);font-size:0.78rem;">%</span>
        </div>`;
      }).join('')}
      <div id="a-split-hint" style="text-align:right;font-size:0.7rem;margin-top:2px;"></div>
    </div>` : ''}
    <div class="form-grid-2" style="margin-bottom:10px;">
      <div class="form-group">
        <label class="form-label">Jour</label>
        <input type="number" class="form-input" id="a-day" min="1" max="31" value="${a.day || now.getDate()}">
      </div>
      <div class="form-group">
        <label class="form-label">Mois</label>
        <select class="form-select" id="a-month">${moisOptions}</select>
      </div>
    </div>
    <div class="form-group">
      <label class="form-label">Année</label>
      <input type="number" class="form-input" id="a-year" min="2020" max="2099" value="${a.year || State.year}">
    </div>
  `;

  const footer = `
    ${!isNew ? `<button class="btn btn-danger btn-sm" id="a-delete">Supprimer</button>` : ''}
    <button class="btn btn-outline" id="a-cancel">Annuler</button>
    <button class="btn btn-primary" id="a-save" style="margin-left:auto;">Enregistrer</button>
  `;

  openModal(isNew ? 'Nouvelle dépense ponctuelle' : 'Modifier la dépense', body, footer);

  document.getElementById('a-cancel')?.addEventListener('click', closeModal);

  // ── Répartition personnalisée : toggle & validation ──
  const aQuiSel = document.getElementById('a-qui');
  const aSplitSec = document.getElementById('a-split-section');
  const updateASplitHint = () => {
    const total = [...document.querySelectorAll('.a-split-pct')].reduce((s, i) => s + (Number(i.value)||0), 0);
    const hint = document.getElementById('a-split-hint');
    if (hint) { hint.style.color = Math.abs(total-100)<0.5 ? 'var(--success)' : 'var(--danger)'; hint.textContent = `Total : ${total}%${Math.abs(total-100)>=0.5?' ⚠️':' ✅'}`; }
  };
  if (aSplitSec) {
    aQuiSel?.addEventListener('change', () => {
      aSplitSec.style.display = aQuiSel.value === 'shared' ? '' : 'none';
      if (aQuiSel.value === 'shared') updateASplitHint();
    });
    document.querySelectorAll('.a-split-pct').forEach(i => i.addEventListener('input', updateASplitHint));
    // Afficher si déjà sur Partagé au chargement
    aSplitSec.style.display = (aQuiSel?.value === 'shared') ? '' : 'none';
    updateASplitHint();
  }
  document.getElementById('a-delete')?.addEventListener('click', async () => {
    const toDelete = { ...achat };
    closeModal();
    const li = document.querySelector(`.list-item[data-aid="${toDelete.id}"]`);
    if (li) li.style.display = 'none';
    showToastWithUndo(`Achat « ${toDelete.label || 'sans nom'} » supprimé`,
      async () => { await deleteAchat(toDelete.id); onSave(); }, 6000, 'warning',
      () => { if (li) li.style.display = ''; });
  });

  document.getElementById('a-save')?.addEventListener('click', async () => {
    const label = document.getElementById('a-label')?.value.trim();
    if (!label) { showToast('Le libellé est requis', 'error'); return; }
    const quiRaw = document.getElementById('a-qui')?.value;
    if (!quiRaw) { showToast('Veuillez sélectionner qui paie', 'error'); return; }
    const qui    = quiRaw === 'shared' ? 'shared' : Number(quiRaw);
    const splitInputs = document.querySelectorAll('.a-split-pct');
    const splitPcts = (qui === 'shared' && splitInputs.length > 0 && aSplitSec?.style.display !== 'none')
      ? Object.fromEntries([...splitInputs].map(inp => [inp.dataset.uid, Number(inp.value)||0]))
      : null;

    await saveAchat({
      ...(isNew ? {} : { id: achat.id }),
      label,
      category: document.getElementById('a-cat')?.value || 'autre',
      amount:   Number(document.getElementById('a-amount')?.value) || 0,
      qui,
      ...(splitPcts ? { splitPcts } : {}),
      month:    Number(document.getElementById('a-month')?.value) || State.month,
      year:     Number(document.getElementById('a-year')?.value) || State.year,
      day:      Number(document.getElementById('a-day')?.value)   || now.getDate(),
    });
    State.year  = Number(document.getElementById('a-year')?.value) || State.year;
    State.month = Number(document.getElementById('a-month')?.value) || State.month;
    closeModal();
    showToast(isNew ? 'Achat ajouté ✅' : 'Achat mis à jour ✅', 'success');
    onSave();
  });
}

// ── Helper : libellé "qui" ──
function getQuiLabel(qui) {
  if (!qui || qui === 'shared') return '🤝 Partagé (tous)';
  const u = _users.find(u => String(u.id) === String(qui));
  return u ? u.name : String(qui);
}

// ── Vue calendrier des charges ─────────────────────────────
async function renderCalendrier(container) {
  const tabContent = container.querySelector('#tab-content');
  const month = State.month;
  const year  = State.year;
  const charges = await getAllCharges();
  const active  = charges.filter(c => !c.archived && c.year === year && c.month === month);

  // Regrouper les charges par jour de prélèvement (1-31)
  const byDay = {};
  active.forEach(c => {
    const day = Number(c.day) || 1;
    if (!byDay[day]) byDay[day] = [];
    byDay[day].push(c);
  });

  const daysInMonth = new Date(year, month, 0).getDate();
  const firstDow    = new Date(year, month - 1, 1).getDay(); // 0=dim
  // Convert to Monday-first (0=lun)
  const startOffset = (firstDow + 6) % 7;

  const dayLabels = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];
  const headerCells = dayLabels.map(d =>
    `<div style="text-align:center;font-size:0.72rem;font-weight:700;color:var(--text-3);padding:4px 0;">${d}</div>`
  ).join('');

  const cells = [];
  for (let i = 0; i < startOffset; i++) cells.push('<div></div>');
  const today_ = new Date();
  const todayDay = today_.getFullYear() === year && today_.getMonth() + 1 === month ? today_.getDate() : -1;

  for (let d = 1; d <= daysInMonth; d++) {
    const charges_ = byDay[d] || [];
    const total = charges_.reduce((s, c) => s + (Number(c.amount) || 0), 0);
    const isToday = d === todayDay;
    const hasCh   = charges_.length > 0;
    const dots = charges_.slice(0, 3).map(c => {
      const cat = getCategoryInfo(c.category || '');
      return `<span title="${escHtml(c.name)}: ${eur(Number(c.amount)||0)}" style="font-size:0.75rem;line-height:1;">${cat?.icon || '💳'}</span>`;
    }).join('');
    cells.push(`
      <div style="border-radius:8px;padding:4px;min-height:52px;border:1px solid ${isToday ? 'var(--primary)' : 'var(--border)'};background:${isToday ? 'var(--primary-light,#e8f0ff)' : hasCh ? 'var(--bg-2)' : 'transparent'};cursor:default;position:relative;">
        <div style="font-size:0.75rem;font-weight:${isToday ? '800' : '600'};color:${isToday ? 'var(--primary)' : 'var(--text-1)'};text-align:right;">${d}</div>
        <div style="font-size:0.7rem;color:var(--danger);text-align:center;font-weight:700;">${hasCh ? eur(total) : ''}</div>
        <div style="display:flex;flex-wrap:wrap;gap:1px;justify-content:center;">${dots}</div>
      </div>`);
  }

  // Résumé total mensuel
  const totalMonth = active.reduce((s, c) => s + (Number(c.amount) || 0), 0);

  tabContent.innerHTML = `
    <div style="padding:12px 0;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
        <span style="font-size:0.82rem;color:var(--text-3);">${active.length} charges récurrentes</span>
        <span style="font-size:0.9rem;font-weight:700;color:var(--danger);">${eur(totalMonth)}/mois</span>
      </div>
      <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:3px;margin-bottom:16px;">
        ${headerCells}
        ${cells.join('')}
      </div>
      <div style="font-size:0.72rem;color:var(--text-3);margin-bottom:8px;">Les icônes indiquent les charges prévues ce jour. Saisissez le jour de prélèvement sur chaque charge.</div>
    </div>`;
}

