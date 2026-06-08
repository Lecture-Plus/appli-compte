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
import { eur, escHtml, nomMois, addMonth, showToast,
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
    </div>
    <div id="tab-content"></div>
    <button class="fab" id="fab-add" aria-label="Ajouter" style="${_tab === 'budgets' ? 'display:none;' : ''}">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
    </button>
  `;

  const renderTab = () => {
    if (_tab === 'recurrentes') renderRecurrentes(container);
    else if (_tab === 'achats') renderAchats(container);
    else                        renderBudgets(container);
  };

  container.querySelectorAll('#charges-tabs .tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      container.querySelectorAll('#charges-tabs .tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      _tab = btn.dataset.tab;
      const fab = container.querySelector('#fab-add');
      if (fab) fab.style.display = _tab === 'budgets' ? 'none' : '';
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
  const charges = await getAllCharges();
  const tc      = container.querySelector('#tab-content');

  if (!charges.length) {
    tc.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">📋</div>
        <div class="empty-state-title">Aucune charge récurrente</div>
        <div class="empty-state-text">Ajoutez vos charges fixes : loyer, EDF, abonnements…</div>
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

  tc.innerHTML = html;

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
  const persoTag = c.perso ? `<span class="chip" style="font-size:0.62rem;padding:1px 5px;background:var(--warning-bg);color:var(--warning);">Perso</span>` : '';
  const activeIcon = c.active
    ? `<svg viewBox="0 0 24 24" fill="none" stroke="var(--success)" stroke-width="2.5" width="14" height="14"><path d="M20 6L9 17l-5-5"/></svg>`
    : `<svg viewBox="0 0 24 24" fill="none" stroke="var(--danger)" stroke-width="2" width="14" height="14"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
  const monthsText = c.months === 'all' ? 'Tous les mois'
    : Array.isArray(c.months) ? c.months.map(m => nomMois(m).slice(0, 3)).join(', ') : '';

  const linesSub = lines.length > 1
    ? lines.map(l => `<span class="chip" style="font-size:0.62rem;padding:1px 6px;">${escHtml(getQuiLabel(l.qui))}&nbsp;${eur(Number(l.amount)||0)}${l.dayOfMonth ? ` j.${l.dayOfMonth}` : ''}</span>`).join(' ')
    : `<span class="qui-badge">${escHtml(getQuiLabel(lines[0].qui))}</span>`;

  return `
    <div class="list-item" data-id="${c.id}" style="cursor:pointer;${!c.active ? 'opacity:0.5;' : ''}">
      <div class="list-item-icon" style="background:var(--primary-bg);">${info.emoji}</div>
      <div class="list-item-body">
        <div class="list-item-title">${escHtml(c.label)} ${persoTag}</div>
        <div class="list-item-sub" style="display:flex;flex-wrap:wrap;gap:3px;align-items:center;">${monthsText} · ${activeIcon} ${linesSub}</div>
      </div>
      <div class="list-item-right">
        <div class="list-item-amount">${eur(total)}</div>
      </div>
    </div>
  `;
}

// ── Rendu d'une ligne de prélèvement dans le modal ──
function _renderLineRow(line, idx, container) {
  const quiOpts = `
    <option value="shared" ${!line.qui || line.qui === 'shared' ? 'selected' : ''}>🤝 Partagé</option>
    ${_users.map(u => `<option value="${u.id}" ${String(line.qui) === String(u.id) ? 'selected' : ''}>${escHtml(u.name)}</option>`).join('')}
  `;
  const row = document.createElement('div');
  row.className = 'charge-line-row';
  row.dataset.idx = idx;
  row.style.cssText = 'display:flex;align-items:center;gap:6px;margin-bottom:6px;';
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
  container.appendChild(row);
  row.querySelector('.cl-remove').addEventListener('click', () => {
    const lines = container.querySelectorAll('.charge-line-row');
    if (lines.length <= 1) { showToast('Au moins une ligne est requise', 'error'); return; }
    row.remove();
  });
}

function showChargeModal(charge, onSave) {
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

  const body = `
    <div class="form-group" style="margin-bottom:10px;">
      <label class="form-label">Libellé</label>
      <input type="text" class="form-input" id="c-label" placeholder="Ex: Loyer, EDF, Netflix…" value="${escHtml(c.label)}">
    </div>
    <div class="form-group" style="margin-bottom:10px;">
      <label class="form-label">Catégorie</label>
      <select class="form-select" id="c-cat">${catOptions}</select>
    </div>

    <div class="form-group" style="margin-bottom:10px;">
      <label class="form-label">Lignes de prélèvement</label>
      <p class="form-hint" style="margin-top:2px;">Montant · Qui · Jour dans le mois (facultatif)</p>
      <div id="c-lines-container" style="margin-top:6px;"></div>
      <button type="button" class="btn btn-outline btn-sm" id="c-add-line" style="margin-top:4px;width:100%;">
        + Ajouter une ligne
      </button>
    </div>

    <div class="toggle-wrap" style="padding:8px 0;">
      <div class="toggle-info">
        <label for="c-perso">Charge personnelle</label>
        <p>Exclue du calcul de répartition (reste dans les dépenses)</p>
      </div>
      <label class="toggle">
        <input type="checkbox" id="c-perso" ${c.perso ? 'checked' : ''}>
        <span class="toggle-slider"></span>
      </label>
    </div>
    <div class="form-group" style="margin-bottom:10px;">
      <label class="form-label">Mois actifs</label>
      <label style="display:flex;align-items:center;gap:8px;margin-bottom:8px;font-size:0.85rem;cursor:pointer;">
        <input type="checkbox" id="c-allmonths" ${c.months === 'all' ? 'checked' : ''}> Tous les mois
      </label>
      <div id="c-months-grid" style="display:grid;grid-template-columns:repeat(4,1fr);gap:6px;${c.months === 'all' ? 'opacity:0.4;pointer-events:none;' : ''}">
        ${monthCheckboxes}
      </div>
    </div>
    <div class="toggle-wrap" style="padding:10px 0;">
      <div class="toggle-info">
        <label for="c-active">Charge active</label>
        <p>Désactiver pour la suspendre temporairement</p>
      </div>
      <label class="toggle">
        <input type="checkbox" id="c-active" ${c.active ? 'checked' : ''}>
        <span class="toggle-slider"></span>
      </label>
    </div>
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
    const idx = linesContainer.querySelectorAll('.charge-line-row').length;
    _renderLineRow({ amount: 0, qui: 'shared', dayOfMonth: null }, idx, linesContainer);
  });

  document.getElementById('c-allmonths')?.addEventListener('change', (e) => {
    const grid = document.getElementById('c-months-grid');
    grid.style.opacity       = e.target.checked ? '0.4' : '1';
    grid.style.pointerEvents = e.target.checked ? 'none' : '';
  });

  document.getElementById('c-cancel')?.addEventListener('click', closeModal);

  document.getElementById('c-delete')?.addEventListener('click', async () => {
    if (!confirm('Supprimer cette charge ?')) return;
    await deleteCharge(charge.id);
    closeModal();
    showToast('Charge supprimée', 'success');
    onSave();
  });

  document.getElementById('c-save')?.addEventListener('click', async () => {
    const label = document.getElementById('c-label')?.value.trim();
    if (!label) { showToast('Le libellé est requis', 'error'); return; }

    // Collecte des lignes
    const lineRows = linesContainer.querySelectorAll('.charge-line-row');
    const lines = [];
    for (const row of lineRows) {
      const amt = Number(row.querySelector('.cl-amount')?.value) || 0;
      const quiRaw = row.querySelector('.cl-qui')?.value;
      const qui = quiRaw === 'shared' ? 'shared' : Number(quiRaw);
      const day = Number(row.querySelector('.cl-day')?.value) || null;
      lines.push({ amount: amt, qui, dayOfMonth: day });
    }
    if (!lines.length) { showToast('Ajoutez au moins une ligne', 'error'); return; }

    const allMonths = document.getElementById('c-allmonths')?.checked;
    let months = 'all';
    if (!allMonths) {
      months = [...document.querySelectorAll('[data-mois]:checked')].map(el => Number(el.dataset.mois));
      if (!months.length) { showToast('Sélectionnez au moins un mois', 'error'); return; }
    }

    const totalAmount = lines.reduce((s, l) => s + l.amount, 0);

    await saveCharge({
      ...(isNew ? {} : { id: charge.id }),
      label,
      category: document.getElementById('c-cat')?.value || 'autre',
      lines,
      amount:   totalAmount,   // total pour compatibilité
      months,
      active:   document.getElementById('c-active')?.checked ?? true,
      perso:    document.getElementById('c-perso')?.checked ?? false,
      notes:    '',
    });
    closeModal();
    showToast(isNew ? 'Charge ajoutée ✅' : 'Charge mise à jour ✅', 'success');
    onSave();
  });
}

// ══════════════════════════════════════════════════
// ACHATS EXCEPTIONNELS
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
        <div class="empty-state-title">Aucun achat exceptionnel</div>
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
      preview.innerHTML = `<span style="color:var(--warning);">Aucun achat exceptionnel pour ce mois.</span>`;
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
  const [md, achats, budgetOps, settings] = await Promise.all([
    getMonthlyData(year, month),
    getAchatsForMonth(year, month),
    getBudgetOpsForMonth(year, month),
    getAllSettings(),
  ]);
  const users = _users;
  const customBudgets  = settings.customBudgets  || [];
  const pinnedBudgets  = settings.pinnedBudgets   || ['courses', 'extras'];
  const tc = container.querySelector('#tab-content');

  const budgetCourses = users.reduce((s, u) => s + (Number(md?.users?.[String(u.id)]?.courses) || 0), 0);
  const budgetExtras  = users.reduce((s, u) => s + (Number(md?.users?.[String(u.id)]?.extras)  || 0), 0);

  const opsByCategory = {};
  for (const op of budgetOps) { (opsByCategory[op.category] ??= []).push(op); }
  const spent = cat => (opsByCategory[cat] || []).reduce((s, op) => s + (Number(op.amount) || 0), 0);

  // Per-user extras for foyer/individuel toggle
  const extrasPerUser = users.length > 1 ? users.map(u => ({
    id: u.id, name: u.name, color: u.color,
    budget: Number(md?.users?.[String(u.id)]?.extras) || 0,
    spent:  (opsByCategory['extras'] || []).filter(op => String(op.userId) === String(u.id)).reduce((s, op) => s + (Number(op.amount)||0), 0),
  })) : null;

  const totalAchats = achats.reduce((s, a) => s + (Number(a.amount) || 0), 0);

  tc.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin:8px 0 12px;">
      <button class="btn btn-outline btn-sm" id="bgt-prev-month">‹</button>
      <span style="font-weight:700;font-size:0.95rem;">${nomMois(month)} ${year}</span>
      <div style="display:flex;gap:6px;">
        <button class="btn btn-sm btn-secondary" id="bgt-manage">⚙️ Gérer</button>
        <button class="btn btn-outline btn-sm" id="bgt-next-month">›</button>
      </div>
    </div>
    ${_buildBudCatSection({ id:'courses', icon:'🛒', title:'Courses', budget:budgetCourses, spent:spent('courses'), ops:opsByCategory['courses']||[], users, hint:budgetCourses===0?'⚠️ Aucun budget courses dans la saisie mensuelle.':null, isPinned:pinnedBudgets.includes('courses') })}
    ${_buildBudCatSection({ id:'extras',  icon:'�', title:'Loisirs', budget:budgetExtras,  spent:spent('extras'),  ops:opsByCategory['extras'] ||[], users, hint:budgetExtras ===0?'⚠️ Aucun budget loisirs dans la saisie mensuelle.' :null, isPinned:pinnedBudgets.includes('extras'), perUserBudgets:extrasPerUser })}
    ${customBudgets.map(b => _buildBudCatSection({ id:b.id, icon:b.icon||'📌', title:b.name, budget:Number(b.amount)||0, spent:spent(b.id), ops:opsByCategory[b.id]||[], users })).join('')}
    <div class="card" style="margin-bottom:12px;">
      <div class="card-header">
        <span class="card-title">💥 Achats exceptionnels</span>
        <div style="display:flex;align-items:center;gap:6px;">
          <span class="chip danger">${eur(totalAchats)}</span>
          <button class="btn btn-sm btn-primary" id="bgt-add-achat">+ Ajouter</button>
        </div>
      </div>
      ${achats.length===0
        ? `<div style="font-size:0.82rem;color:var(--text-3);text-align:center;padding:8px 0;">Aucun achat exceptionnel ce mois-ci</div>`
        : `<button class="btn btn-outline btn-full btn-sm" id="bgt-ops-toggle-achats" style="font-size:0.78rem;">📋 Voir les achats (${achats.length})</button>
           <div id="bgt-ops-achats" style="display:none;margin-top:8px;">
             <div class="item-list">${achats.map(a => {
               const info = getCategoryInfo(a.category);
               const dateStr = a.day ? `${a.day} ${nomMois(a.month)} ${a.year}` : `${nomMois(a.month)} ${a.year}`;
               return `<div class="list-item"><div class="list-item-icon" style="background:var(--warning-bg);">${info.emoji}</div><div class="list-item-body"><div class="list-item-title">${escHtml(a.label)}</div><div class="list-item-sub">${dateStr}</div></div><div class="list-item-right"><div class="list-item-amount" style="color:var(--danger);">−${eur(a.amount)}</div></div></div>`;
             }).join('')}</div>
           </div>`
      }
    </div>
    <button class="btn btn-outline btn-full" id="bgt-add-custom" style="margin-bottom:80px;">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="15" height="15"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
      Nouveau budget personnalisé
    </button>
  `;

  tc.querySelector('#bgt-prev-month')?.addEventListener('click', () => { const d=addMonth(year,month,-1); State.year=d.year;State.month=d.month; renderBudgets(container); });
  tc.querySelector('#bgt-next-month')?.addEventListener('click', () => { const d=addMonth(year,month, 1); State.year=d.year;State.month=d.month; renderBudgets(container); });
  tc.querySelector('#bgt-add-custom')?.addEventListener('click', () => _showEditBudgetModal(null, customBudgets, () => renderBudgets(container)));
  tc.querySelector('#bgt-manage')?.addEventListener('click', () => _showManageBudgetsModal(customBudgets, () => renderBudgets(container)));

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
      if (!confirm('Supprimer cette opération ?')) return;
      await deleteBudgetOp(Number(btn.dataset.bgtDelOp));
      showToast('Supprimé', 'success');
      renderBudgets(container);
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
      if (b) _showEditBudgetModal(b, customBudgets, () => renderBudgets(container));
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

  // Achats exceptionnels: + button and ops collapse
  tc.querySelector('#bgt-add-achat')?.addEventListener('click', () => {
    showAchatModal(null, () => renderBudgets(container));
  });
  tc.querySelector('#bgt-ops-toggle-achats')?.addEventListener('click', () => {
    const sec = tc.querySelector('#bgt-ops-achats');
    if (!sec) return;
    const open = sec.style.display !== 'none';
    sec.style.display = open ? 'none' : '';
  });
}

function _buildBudCatSection({ id, icon, title, budget, spent, ops, users, hint, isPinned = false, perUserBudgets = null }) {
  const remaining = budget - spent;
  const pct = budget > 0 ? Math.min(100, Math.round((spent / budget) * 100)) : (spent > 0 ? 100 : 0);
  const color = pct >= 100 ? 'danger' : pct >= 80 ? 'warning' : 'success';
  const sorted = [...ops].sort((a,b) => (b.day||0)-(a.day||0));
  const editBtn = (id !== 'courses' && id !== 'extras') ? `<button class="btn-icon" data-bgt-edit="${id}" title="Modifier" style="width:28px;height:28px;color:var(--text-3);">✏️</button>` : '';
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

  return `<div class="card" style="margin-bottom:12px;">
    <div class="card-header">
      <span class="card-title">${icon} ${escHtml(title)}</span>
      <div style="display:flex;align-items:center;gap:4px;">
        ${perUserToggleBtn}
        ${editBtn}
        ${pinBtn}
        <button class="btn btn-sm btn-primary" data-bgt-add-op="${id}" data-cat-name="${escHtml(title)}" data-cat-icon="${escHtml(icon)}">+ Ajouter</button>
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
             return `<div class="list-item" style="position:relative;">
               <div class="list-item-icon" style="background:var(--danger-bg);">🧾</div>
               <div class="list-item-body">
                 <div class="list-item-title">${escHtml(op.label||'Opération')}</div>
                 <div class="list-item-sub">${dateStr}${u?` · ${escHtml(u.name)}`:''}</div>
               </div>
               <div class="list-item-right"><div class="list-item-amount" style="color:var(--danger);">−${eur(op.amount)}</div></div>
               <button class="btn-icon" data-bgt-del-op="${op.id}" style="position:absolute;top:4px;right:4px;width:26px;height:26px;color:var(--text-3);">✕</button>
             </div>`;
           }).join('')}</div>
         </div>`
    }
  </div>`;
}

function _showAddBudgetOpModal({ catId, catLabel }, users, year, month, onSave) {
  const daysInMonth = new Date(year, month, 0).getDate();
  const todayDay    = new Date().getDate();
  const userSelect  = users.length > 1
    ? `<div class="form-group" style="margin-bottom:10px;"><label class="form-label">Personne</label><select class="form-input" id="bop-user"><option value="">— Sans attribution —</option><option value="tous">👥 Tous (diviser en parts égales)</option>${users.map(u=>`<option value="${u.id}">${escHtml(u.name)}</option>`).join('')}</select></div>`
    : '';
  openModal(`+ Opération ${catLabel}`, `
    <div class="form-group" style="margin-bottom:10px;"><label class="form-label">Enseigne / Description *</label><input type="text" class="form-input" id="bop-label" placeholder="Ex: Carrefour, restaurant…" autocomplete="off"></div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px;">
      <div class="form-group"><label class="form-label">Jour</label><input type="number" class="form-input" id="bop-day" min="1" max="${daysInMonth}" value="${todayDay}"></div>
      <div class="form-group"><label class="form-label">Montant (€) *</label><div class="input-wrap"><input type="number" class="form-input input-euro" id="bop-amount" min="0.01" step="0.01" placeholder="0.00"><span class="input-suffix">€</span></div></div>
    </div>
    ${userSelect}
    <p style="font-size:0.72rem;color:var(--text-3);">Mois : ${nomMois(month)} ${year}</p>
  `, `<button class="btn btn-primary btn-full" id="bop-save">Enregistrer</button>`);
  document.getElementById('bop-label')?.focus();
  document.getElementById('bop-save')?.addEventListener('click', async () => {
    const label  = document.getElementById('bop-label')?.value.trim();
    const amount = parseFloat(document.getElementById('bop-amount')?.value);
    const day    = parseInt(document.getElementById('bop-day')?.value, 10) || null;
    const userVal = document.getElementById('bop-user')?.value || null;
    if (!label) { showToast('Saisissez une description', 'error'); return; }
    if (!amount || amount <= 0) { showToast('Montant invalide', 'error'); return; }
    if (userVal === 'tous' && users.length > 1) {
      const share = amount / users.length;
      for (const u of users) {
        await saveBudgetOp({ category: catId, year, month, day, label, amount: share, userId: u.id });
      }
    } else {
      await saveBudgetOp({ category: catId, year, month, day, label, amount, userId: userVal });
    }
    closeModal(); showToast('Opération ajoutée ✅', 'success'); onSave();
  });
}

function _showEditBudgetModal(existing, customBudgets, onSave) {
  const isNew = !existing;
  const selIcon = existing?.icon || '📌';
  openModal(isNew ? '📌 Nouveau budget' : `✏️ Modifier "${existing.name}"`, `
    <div class="form-group" style="margin-bottom:12px;"><label class="form-label">Nom *</label><input type="text" class="form-input" id="bgt-name" placeholder="Ex: Restaurant, Sport…" value="${escHtml(existing?.name||'')}" autocomplete="off"></div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px;">
      <div class="form-group"><label class="form-label">Montant mensuel (€)</label><div class="input-wrap"><input type="number" class="form-input input-euro" id="bgt-amount" min="0" step="5" placeholder="0" value="${existing?.amount||''}"><span class="input-suffix">€</span></div><p class="form-hint">0 = suivi libre</p></div>
      <div class="form-group"><label class="form-label">Icône</label><input type="text" class="form-input" id="bgt-icon" maxlength="2" value="${escHtml(selIcon)}" style="font-size:1.4rem;text-align:center;" readonly></div>
    </div>
    <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:14px;">${PRESET_ICONS.map(ic=>`<button type="button" class="btn-icon icon-pick" data-icon="${ic}" style="width:36px;height:36px;font-size:1.2rem;border:2px solid ${ic===selIcon?'var(--primary)':'transparent'};border-radius:8px;background:var(--bg-card);">${ic}</button>`).join('')}</div>
    ${!isNew ? `<hr style="margin-bottom:12px;"><button class="btn btn-outline btn-full" id="bgt-delete" style="color:var(--danger);border-color:var(--danger);">🗑️ Supprimer ce budget</button>` : ''}
  `, `<button class="btn btn-primary btn-full" id="bgt-save">${isNew ? 'Créer' : 'Enregistrer'}</button>`);
  document.getElementById('bgt-name')?.focus();
  document.querySelectorAll('.icon-pick').forEach(btn => {
    btn.addEventListener('click', () => { document.querySelectorAll('.icon-pick').forEach(b=>b.style.borderColor='transparent'); btn.style.borderColor='var(--primary)'; document.getElementById('bgt-icon').value=btn.dataset.icon; });
  });
  document.getElementById('bgt-delete')?.addEventListener('click', async () => {
    if (!confirm(`Supprimer "${existing.name}" ?`)) return;
    await setSetting('customBudgets', customBudgets.filter(b=>b.id!==existing.id));
    closeModal(); showToast('Budget supprimé', 'success'); onSave();
  });
  document.getElementById('bgt-save')?.addEventListener('click', async () => {
    const name   = document.getElementById('bgt-name')?.value.trim();
    const amount = parseFloat(document.getElementById('bgt-amount')?.value) || 0;
    const icon   = document.getElementById('bgt-icon')?.value || '📌';
    if (!name) { showToast('Saisissez un nom', 'error'); return; }
    const updated = isNew ? [...customBudgets, {id:'custom_'+Date.now(), name, icon, amount}]
      : customBudgets.map(b => b.id===existing.id ? {...b, name, icon, amount} : b);
    await setSetting('customBudgets', updated);
    closeModal(); showToast(isNew ? `Budget "${name}" créé ✅` : 'Mis à jour ✅', 'success'); onSave();
  });
}

function _showManageBudgetsModal(customBudgets, onSave) {
  openModal('⚙️ Gérer mes budgets', customBudgets.length===0
    ? `<p style="color:var(--text-3);font-size:0.85rem;text-align:center;padding:12px 0;">Aucun budget personnalisé.<br>Utilisez <strong>+ Nouveau budget</strong>.</p>`
    : `<div class="item-list">${customBudgets.map(b=>`<div class="list-item" style="padding:10px 12px;"><div class="list-item-icon" style="font-size:1.2rem;background:var(--bg-2);">${b.icon||'📌'}</div><div class="list-item-body"><div class="list-item-title">${escHtml(b.name)}</div><div class="list-item-sub">${b.amount>0?eur(b.amount)+'/mois':'Suivi libre'}</div></div><div style="display:flex;gap:6px;"><button class="btn btn-sm btn-outline manage-edit" data-id="${b.id}">Modifier</button><button class="btn btn-sm btn-outline manage-del" data-id="${b.id}" style="color:var(--danger);border-color:var(--danger);">Supprimer</button></div></div>`).join('')}</div>`
  , `<button class="btn btn-primary btn-full" id="manage-add-new">+ Nouveau budget</button>`);
  document.getElementById('manage-add-new')?.addEventListener('click', () => { closeModal(); _showEditBudgetModal(null, customBudgets, onSave); });
  document.querySelectorAll('.manage-edit').forEach(btn => {
    btn.addEventListener('click', () => { const b=customBudgets.find(b=>b.id===btn.dataset.id); if(b){closeModal();_showEditBudgetModal(b,customBudgets,onSave);} });
  });
  document.querySelectorAll('.manage-del').forEach(btn => {
    btn.addEventListener('click', async () => {
      const b=customBudgets.find(b=>b.id===btn.dataset.id);
      if(!b||!confirm(`Supprimer "${b.name}" ?`)) return;
      await setSetting('customBudgets',customBudgets.filter(x=>x.id!==b.id));
      closeModal(); showToast('Supprimé','success'); onSave();
    });
  });
}

function showAchatModal(achat, onSave) {
  const now = new Date();
  const a = achat ?? { year: State.year, month: State.month, day: now.getDate(), label: '', category: 'loisirs', amount: 0, qui: 'shared' };

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
        <option value="shared" ${a.qui === 'shared' ? 'selected' : ''}>🤝 Partagé (tous)</option>
        ${_users.map(u => `<option value="${u.id}" ${String(a.qui) === String(u.id) ? 'selected' : ''}>${escHtml(u.name)}</option>`).join('')}
      </select>
    </div>
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
      <input type="number" class="form-input" id="a-year" min="2020" max="2099" value="${a.year || year}">
    </div>
  `;

  const footer = `
    ${!isNew ? `<button class="btn btn-danger btn-sm" id="a-delete">Supprimer</button>` : ''}
    <button class="btn btn-outline" id="a-cancel">Annuler</button>
    <button class="btn btn-primary" id="a-save" style="margin-left:auto;">Enregistrer</button>
  `;

  openModal(isNew ? 'Nouvel achat exceptionnel' : 'Modifier l\'achat', body, footer);

  document.getElementById('a-cancel')?.addEventListener('click', closeModal);
  document.getElementById('a-delete')?.addEventListener('click', async () => {
    if (!confirm('Supprimer cet achat ?')) return;
    await deleteAchat(achat.id);
    closeModal();
    showToast('Achat supprimé', 'success');
    onSave();
  });

  document.getElementById('a-save')?.addEventListener('click', async () => {
    const label = document.getElementById('a-label')?.value.trim();
    if (!label) { showToast('Le libellé est requis', 'error'); return; }
    const quiRaw = document.getElementById('a-qui')?.value;
    const qui    = quiRaw === 'shared' ? 'shared' : Number(quiRaw);

    await saveAchat({
      ...(isNew ? {} : { id: achat.id }),
      label,
      category: document.getElementById('a-cat')?.value || 'autre',
      amount:   Number(document.getElementById('a-amount')?.value) || 0,
      qui,
      month:    Number(document.getElementById('a-month')?.value) || month,
      year:     Number(document.getElementById('a-year')?.value) || year,
      day:      Number(document.getElementById('a-day')?.value)   || now.getDate(),
    });
    State.year  = Number(document.getElementById('a-year')?.value) || year;
    State.month = Number(document.getElementById('a-month')?.value) || month;
    closeModal();
    showToast(isNew ? 'Achat ajouté ✅' : 'Achat mis à jour ✅', 'success');
    onSave();
  });
}

// ── Helper : libellé "qui" ──
function getQuiLabel(qui) {
  if (!qui || qui === 'shared') return '🤝 Partagé';
  const u = _users.find(u => String(u.id) === String(qui));
  return u ? u.name : String(qui);
}

