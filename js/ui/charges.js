// ============================================================
// js/ui/charges.js – Gestion des charges récurrentes & achats exceptionnels
// ============================================================

import { State }                                          from '../app.js';
import { getAllCharges, saveCharge, deleteCharge,
         getAchatsForMonth, saveAchat, deleteAchat,
         getAllSettings }                                  from '../db.js';
import { eur, escHtml, nomMois, addMonth, showToast,
         openModal, closeModal, getCategoryInfo,
         CATEGORIES, QUI_OPTIONS, MOIS }                   from '../utils.js';

let _tab = 'recurrentes'; // 'recurrentes' | 'achats'

export async function render(container) {
  const s      = await getAllSettings();
  const p1Name = escHtml(s.p1Name || 'Personne 1');
  const p2Name = escHtml(s.p2Name || 'Personne 2');

  container.innerHTML = `
    <div class="tabs" id="charges-tabs">
      <button class="tab-btn ${_tab === 'recurrentes' ? 'active' : ''}" data-tab="recurrentes">Récurrentes</button>
      <button class="tab-btn ${_tab === 'achats'      ? 'active' : ''}" data-tab="achats">Exceptionnels</button>
    </div>
    <div id="tab-content"></div>
    <button class="fab" id="fab-add" aria-label="Ajouter">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
    </button>
  `;

  const renderTab = () => {
    if (_tab === 'recurrentes') renderRecurrentes(container, p1Name, p2Name);
    else                         renderAchats(container, p1Name, p2Name);
  };

  container.querySelectorAll('#charges-tabs .tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      container.querySelectorAll('#charges-tabs .tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      _tab = btn.dataset.tab;
      renderTab();
    });
  });

  container.querySelector('#fab-add')?.addEventListener('click', () => {
    if (_tab === 'recurrentes') showChargeModal(null, p1Name, p2Name, () => renderTab());
    else                         showAchatModal(null, p1Name, p2Name, () => renderTab());
  });

  renderTab();
}

// ══════════════════════════════════════════════════
// CHARGES RÉCURRENTES
// ══════════════════════════════════════════════════

async function renderRecurrentes(container, p1Name, p2Name) {
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
    const total = items.reduce((acc, c) => acc + ((Number(c.amount_p1) || 0) + (Number(c.amount_p2) || 0)), 0);

    html += `
      <div class="section-header" style="margin-top:12px;">
        <span class="section-label">${info.emoji} ${escHtml(info.label)}</span>
        <span class="chip">${eur(total)}</span>
      </div>
      <div class="item-list">
        ${items.map(c => buildChargeItem(c, p1Name, p2Name)).join('')}
      </div>
    `;
  }

  // Résumé total
  const totalAll = charges.reduce((acc, c) => acc + ((Number(c.amount_p1)||0) + (Number(c.amount_p2)||0)), 0);
  html = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
      <span style="font-size:0.78rem;color:var(--text-3);">${charges.length} charge(s)</span>
      <span class="chip danger">Total: ${eur(totalAll)}</span>
    </div>
    ${html}
    <div style="height:80px;"></div>
  `;

  tc.innerHTML = html;

  // Clic sur un item → modifier
  tc.querySelectorAll('.list-item[data-id]').forEach(el => {
    el.addEventListener('click', async () => {
      const id = Number(el.dataset.id);
      const c  = charges.find(x => x.id === id);
      if (c) showChargeModal(c, p1Name, p2Name, () => renderRecurrentes(container, p1Name, p2Name));
    });
  });
}

function buildChargeItem(c, p1Name, p2Name) {
  const info    = getCategoryInfo(c.category);
  const total   = (Number(c.amount_p1) || 0) + (Number(c.amount_p2) || 0);
  const quiMap  = { p1: p1Name, p2: p2Name, les_deux: 'Les deux', '50_50': '50/50' };
  const quiText = quiMap[c.qui] || c.qui;
  const quiCss  = { p1: 'qui-p1', p2: 'qui-p2', les_deux: 'qui-both', '50_50': 'qui-both' }[c.qui] || '';

  const monthsText = c.months === 'all'
    ? 'Tous les mois'
    : Array.isArray(c.months) ? c.months.map(m => nomMois(m).slice(0,3)).join(', ') : '';

  const activeIcon = c.active
    ? `<svg viewBox="0 0 24 24" fill="none" stroke="var(--success)" stroke-width="2.5" width="14" height="14"><path d="M20 6L9 17l-5-5"/></svg>`
    : `<svg viewBox="0 0 24 24" fill="none" stroke="var(--danger)" stroke-width="2" width="14" height="14"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;

  return `
    <div class="list-item" data-id="${c.id}" style="cursor:pointer; ${!c.active ? 'opacity:0.5;' : ''}">
      <div class="list-item-icon" style="background:var(--primary-bg);">${info.emoji}</div>
      <div class="list-item-body">
        <div class="list-item-title">${escHtml(c.label)}</div>
        <div class="list-item-sub">${monthsText} · ${activeIcon}</div>
      </div>
      <div class="list-item-right">
        <div class="list-item-amount">${eur(total)}</div>
        <span class="qui-badge ${quiCss}">${quiText}</span>
      </div>
    </div>
  `;
}

function showChargeModal(charge, p1Name, p2Name, onSave) {
  const isNew    = !charge;
  const c        = charge ?? {
    label: '', category: 'logement', amount_p1: 0, amount_p2: 0,
    qui: 'les_deux', months: 'all', active: true, notes: '', dayOfMonth: null,
  };

  const catOptions = CATEGORIES.map(cat =>
    `<option value="${cat.id}" ${c.category === cat.id ? 'selected' : ''}>${cat.emoji} ${cat.label}</option>`
  ).join('');

  const quiOptions = QUI_OPTIONS.map(q =>
    `<option value="${q.id}" ${c.qui === q.id ? 'selected' : ''}>${q.label}</option>`
  ).join('');

  const monthCheckboxes = MOIS.map((m, i) => {
    const checked = c.months === 'all' || (Array.isArray(c.months) && c.months.includes(i + 1));
    return `<label style="display:flex;align-items:center;gap:5px;font-size:0.8rem;cursor:pointer;">
      <input type="checkbox" data-mois="${i+1}" ${checked ? 'checked' : ''}> ${m.slice(0,3)}
    </label>`;
  }).join('');

  const body = `
    <div class="form-group" style="margin-bottom:10px;">
      <label class="form-label">Libellé</label>
      <input type="text" class="form-input" id="c-label" placeholder="Ex: Loyer, EDF, Netflix…" value="${escHtml(c.label)}">
    </div>
    <div class="form-grid-2" style="margin-bottom:10px;">
      <div class="form-group">
        <label class="form-label">Catégorie</label>
        <select class="form-select" id="c-cat">${catOptions}</select>
      </div>
      <div class="form-group">
        <label class="form-label">Qui paie ?</label>
        <select class="form-select" id="c-qui">${quiOptions}</select>
      </div>
    </div>
    <div class="form-grid-2" style="margin-bottom:10px;">
      <div class="form-group">
        <label class="form-label">${p1Name} (€)</label>
        <div class="input-wrap">
          <input type="number" class="form-input input-euro" id="c-p1" min="0" step="0.01" value="${c.amount_p1 || ''}">
          <span class="input-suffix">€</span>
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">${p2Name} (€)</label>
        <div class="input-wrap">
          <input type="number" class="form-input input-euro" id="c-p2" min="0" step="0.01" value="${c.amount_p2 || ''}">
          <span class="input-suffix">€</span>
        </div>
      </div>
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
    <div class="form-group" style="margin-bottom:10px;">
      <label class="form-label">Jour de prélèvement dans le mois</label>
      <div class="input-wrap">
        <input type="number" class="form-input" id="c-day"
          min="1" max="31" step="1" placeholder="Ex: 5"
          value="${c.dayOfMonth || ''}">
        <span class="input-suffix">/ mois</span>
      </div>
      <p class="form-hint">Utilisé par le prévisionnel. Laissez vide si variable.</p>
    </div>
  `;

  const footer = `
    ${!isNew ? `<button class="btn btn-danger btn-sm" id="c-delete">Supprimer</button>` : ''}
    <button class="btn btn-outline" id="c-cancel">Annuler</button>
    <button class="btn btn-primary" id="c-save" style="margin-left:auto;">Enregistrer</button>
  `;

  openModal(isNew ? 'Nouvelle charge' : 'Modifier la charge', body, footer);

  // Toggle "tous les mois"
  document.getElementById('c-allmonths')?.addEventListener('change', (e) => {
    const grid = document.getElementById('c-months-grid');
    grid.style.opacity = e.target.checked ? '0.4' : '1';
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

    const allMonths = document.getElementById('c-allmonths')?.checked;
    let months = 'all';
    if (!allMonths) {
      months = [...document.querySelectorAll('[data-mois]:checked')].map(el => Number(el.dataset.mois));
      if (!months.length) { showToast('Sélectionnez au moins un mois', 'error'); return; }
    }

    const updated = {
      ...(isNew ? {} : { id: charge.id }),
      label,
      category:   document.getElementById('c-cat')?.value || 'autre',
      amount_p1:  Number(document.getElementById('c-p1')?.value) || 0,
      amount_p2:  Number(document.getElementById('c-p2')?.value) || 0,
      qui:        document.getElementById('c-qui')?.value || 'les_deux',
      months,
      active:     document.getElementById('c-active')?.checked ?? true,
      dayOfMonth: Number(document.getElementById('c-day')?.value) || null,
      notes:      '',
    };

    await saveCharge(updated);
    closeModal();
    showToast(isNew ? 'Charge ajoutée ✅' : 'Charge mise à jour ✅', 'success');
    onSave();
  });
}

// ══════════════════════════════════════════════════
// ACHATS EXCEPTIONNELS
// ══════════════════════════════════════════════════

async function renderAchats(container, p1Name, p2Name) {
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
    const total = achats.reduce((acc, a) => acc + ((Number(a.amount_p1)||0) + (Number(a.amount_p2)||0)), 0);
    tc.innerHTML = monthNav + `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
        <span style="font-size:0.78rem;color:var(--text-3);">${achats.length} achat(s)</span>
        <span class="chip danger">Total: ${eur(total)}</span>
      </div>
      <div class="item-list">
        ${achats.map(a => buildAchatItem(a, p1Name, p2Name)).join('')}
      </div>
      <div style="height:80px;"></div>
    `;
  }

  // Clic sur un achat → modifier
  tc.querySelectorAll('.list-item[data-aid]').forEach(el => {
    el.addEventListener('click', async () => {
      const id = Number(el.dataset.aid);
      const a  = achats.find(x => x.id === id);
      if (a) showAchatModal(a, p1Name, p2Name, () => renderAchats(container, p1Name, p2Name));
    });
  });

  // Navigation mois
  tc.querySelector('#ach-prev')?.addEventListener('click', () => {
    const n = addMonth(State.year, State.month, -1);
    State.year = n.year; State.month = n.month;
    renderAchats(container, p1Name, p2Name);
  });
  tc.querySelector('#ach-next')?.addEventListener('click', () => {
    const n = addMonth(State.year, State.month, 1);
    State.year = n.year; State.month = n.month;
    renderAchats(container, p1Name, p2Name);
  });

  // FAB
  container.querySelector('#fab-add')?.removeEventListener('click', container._fabListener);
  container._fabListener = () => showAchatModal(null, p1Name, p2Name, () => renderAchats(container, p1Name, p2Name));
  container.querySelector('#fab-add')?.addEventListener('click', container._fabListener);
}

function buildAchatItem(a, p1Name, p2Name) {
  const info    = getCategoryInfo(a.category);
  const total   = (Number(a.amount_p1) || 0) + (Number(a.amount_p2) || 0);
  const quiMap  = { p1: p1Name, p2: p2Name, les_deux: 'Les deux', '50_50': '50/50' };
  const quiCss  = { p1: 'qui-p1', p2: 'qui-p2', les_deux: 'qui-both', '50_50': 'qui-both' }[a.qui] || '';

  return `
    <div class="list-item" data-aid="${a.id}" style="cursor:pointer;">
      <div class="list-item-icon" style="background:var(--warning-bg);">${info.emoji}</div>
      <div class="list-item-body">
        <div class="list-item-title">${escHtml(a.label)}</div>
        <div class="list-item-sub">${escHtml(info.label)}</div>
      </div>
      <div class="list-item-right">
        <div class="list-item-amount">${eur(total)}</div>
        <span class="qui-badge ${quiCss}">${quiMap[a.qui] || a.qui}</span>
      </div>
    </div>
  `;
}

function showAchatModal(achat, p1Name, p2Name, onSave) {
  const isNew = !achat;
  const { year, month } = State;
  const a = achat ?? {
    year, month,
    label: '', category: 'loisirs', amount_p1: 0, amount_p2: 0, qui: 'p1',
  };

  const catOptions = CATEGORIES.map(cat =>
    `<option value="${cat.id}" ${a.category === cat.id ? 'selected' : ''}>${cat.emoji} ${cat.label}</option>`
  ).join('');

  const quiOptions = QUI_OPTIONS.map(q =>
    `<option value="${q.id}" ${a.qui === q.id ? 'selected' : ''}>${q.label}</option>`
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
        <label class="form-label">Qui paie ?</label>
        <select class="form-select" id="a-qui">${quiOptions}</select>
      </div>
    </div>
    <div class="form-grid-2" style="margin-bottom:10px;">
      <div class="form-group">
        <label class="form-label">${p1Name} (€)</label>
        <div class="input-wrap">
          <input type="number" class="form-input input-euro" id="a-p1" min="0" step="0.01" value="${a.amount_p1 || ''}">
          <span class="input-suffix">€</span>
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">${p2Name} (€)</label>
        <div class="input-wrap">
          <input type="number" class="form-input input-euro" id="a-p2" min="0" step="0.01" value="${a.amount_p2 || ''}">
          <span class="input-suffix">€</span>
        </div>
      </div>
    </div>
    <div class="form-grid-2">
      <div class="form-group">
        <label class="form-label">Mois</label>
        <select class="form-select" id="a-month">${moisOptions}</select>
      </div>
      <div class="form-group">
        <label class="form-label">Année</label>
        <input type="number" class="form-input" id="a-year" min="2020" max="2099" value="${a.year || year}">
      </div>
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

    const updated = {
      ...(isNew ? {} : { id: achat.id }),
      label,
      category:  document.getElementById('a-cat')?.value || 'autre',
      amount_p1: Number(document.getElementById('a-p1')?.value) || 0,
      amount_p2: Number(document.getElementById('a-p2')?.value) || 0,
      qui:       document.getElementById('a-qui')?.value || 'p1',
      month:     Number(document.getElementById('a-month')?.value) || month,
      year:      Number(document.getElementById('a-year')?.value) || year,
    };

    await saveAchat(updated);
    State.year  = updated.year;
    State.month = updated.month;
    closeModal();
    showToast(isNew ? 'Achat ajouté ✅' : 'Achat mis à jour ✅', 'success');
    onSave();
  });
}
