// ============================================================
// js/ui/budgets.js – Suivi des budgets (courses, extras, custom)
// ============================================================

import { getMonthlyData, getAchatsForMonth,
         getBudgetOpsForMonth, saveBudgetOp, deleteBudgetOp,
         getActiveUsers, getAllSettings, setSetting }         from '../db.js';
import { eur, escHtml, showToast, openModal, closeModal,
         today, nomMois }                                    from '../utils.js';
import { State }                                             from '../app.js';

const PRESET_ICONS = ['🛒','🎉','🍽️','🚗','💊','🏋️','🐾','📚','🎮','🎬','✈️','🏠','👗','💇','🎁','⚡','📱','🌿'];

// ────────────────────────────────────────────────────────────
// Point d'entrée
// ────────────────────────────────────────────────────────────
export async function render(container) {
  await _renderPage(container);
}

async function _renderPage(container) {
  const { year, month } = State;
  const [md, achats, budgetOps, users, settings] = await Promise.all([
    getMonthlyData(year, month),
    getAchatsForMonth(year, month),
    getBudgetOpsForMonth(year, month),
    getActiveUsers(),
    getAllSettings(),
  ]);

  const customBudgets = settings.customBudgets || [];
  const pinnedBudgets = settings.pinnedBudgets || [];

  // ── Budgets depuis la saisie mensuelle ──
  const budgetCourses = users.reduce((s, u) => s + (Number(md?.users?.[String(u.id)]?.courses) || 0), 0);
  const budgetExtras  = users.reduce((s, u) => s + (Number(md?.users?.[String(u.id)]?.extras)  || 0), 0);

  // ── Opérations par catégorie ──
  const opsByCategory = {};
  for (const op of budgetOps) {
    if (!opsByCategory[op.category]) opsByCategory[op.category] = [];
    opsByCategory[op.category].push(op);
  }
  const spent = cat => (opsByCategory[cat] || []).reduce((s, op) => s + (Number(op.amount) || 0), 0);

  // ── Achats exceptionnels ──
  const totalAchats = achats.reduce((s, a) => s + (Number(a.amount) || 0), 0);

  container.innerHTML = `
    <!-- Header : nav mois + bouton gérer -->
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;gap:8px;">
      <button class="btn btn-outline btn-sm" id="btn-prev-month">‹</button>
      <span style="font-weight:700;font-size:0.95rem;flex:1;text-align:center;">${nomMois(month)} ${year}</span>
      <button class="btn btn-outline btn-sm" id="btn-next-month">›</button>
      <button class="btn btn-sm btn-secondary" id="btn-manage-budgets" title="Gérer mes budgets">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>
        Gérer
      </button>
    </div>

    <!-- ── Courses ── -->
    ${(budgetCourses > 0 || spent('courses') > 0) ? _buildCategorySection({
      id:     'courses',
      icon:   '🛒',
      title:  'Courses',
      budget: budgetCourses,
      spent:  spent('courses'),
      ops:    opsByCategory['courses'] || [],
      users,
      pinned: pinnedBudgets.includes('courses'),
    }) : ''}

    <!-- ── Extras ── -->
    ${(budgetExtras > 0 || spent('extras') > 0) ? _buildCategorySection({
      id:     'extras',
      icon:   '🎉',
      title:  'Extras & loisirs',
      budget: budgetExtras,
      spent:  spent('extras'),
      ops:    opsByCategory['extras'] || [],
      users,
      pinned: pinnedBudgets.includes('extras'),
    }) : ''}

    <!-- ── Budgets personnalisés ── -->
    ${customBudgets.map(b => _buildCategorySection({
      id:     b.id,
      icon:   b.icon || '📌',
      title:  b.name,
      budget: Number(b.amount) || 0,
      pinned: pinnedBudgets.includes(b.id),
      spent:  spent(b.id),
      ops:    opsByCategory[b.id] || [],
      users,
    })).join('')}

    <!-- ── Achats exceptionnels ── -->
    <div class="card" style="margin-bottom:12px;">
      <div class="card-header">
        <span class="card-title">💥 Achats exceptionnels</span>
        <span class="chip danger">${eur(totalAchats)}</span>
      </div>
      <p style="font-size:0.78rem;color:var(--text-3);margin-bottom:10px;">
        Gérés depuis l'onglet <strong>Charges → Exceptionnels</strong>.
      </p>
      ${achats.length === 0
        ? `<div style="font-size:0.82rem;color:var(--text-3);text-align:center;padding:10px 0;">Aucun achat exceptionnel ce mois-ci</div>`
        : `<div class="item-list">${achats.map(a => _buildAchatItem(a)).join('')}</div>`
      }
    </div>

    <!-- Bouton ajouter un budget -->
    <button class="btn btn-outline btn-full" id="btn-add-budget" style="margin-bottom:24px;">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="15" height="15"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
      Nouveau budget personnalisé
    </button>
  `;

  // ── Navigation mois ──
  container.querySelector('#btn-prev-month')?.addEventListener('click', () => {
    const d = _addMonth(year, month, -1);
    State.year = d.year; State.month = d.month;
    _renderPage(container);
  });
  container.querySelector('#btn-next-month')?.addEventListener('click', () => {
    const d = _addMonth(year, month, +1);
    State.year = d.year; State.month = d.month;
    _renderPage(container);
  });

  // ── Ajouter opération ──
  container.querySelectorAll('[data-add-op]').forEach(btn => {
    const catId    = btn.dataset.addOp;
    const catName  = btn.dataset.catName || catId;
    const catIcon  = btn.dataset.catIcon || '📌';
    btn.addEventListener('click', () => {
      _showAddOpModal({ catId, catLabel: `${catIcon} ${catName}` }, users, year, month, () => _renderPage(container));
    });
  });

  // ── Supprimer opération ──
  container.querySelectorAll('[data-del-op]').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('Supprimer cette opération ?')) return;
      await deleteBudgetOp(Number(btn.dataset.delOp));
      showToast('Opération supprimée', 'success');
      _renderPage(container);
    });
  });

  // ── Nouveau budget personnalisé ──
  container.querySelector('#btn-add-budget')?.addEventListener('click', () => {
    _showEditBudgetModal(null, customBudgets, () => _renderPage(container));
  });

  // ── Épingler / désépingler sur l'accueil ──
  container.querySelectorAll('.bgt-pin-toggle').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.bgtId;
      const current = (await getAllSettings()).pinnedBudgets || [];
      const newPinned = current.includes(id)
        ? current.filter(p => p !== id)
        : [...current, id].slice(0, 4);
      await setSetting('pinnedBudgets', newPinned);
      showToast(newPinned.includes(id) ? '📌 Épinglé sur l\'accueil' : 'Retiré de l\'accueil', 'success');
      _renderPage(container);
    });
  });

  // ── Gérer les budgets ──
  container.querySelector('#btn-manage-budgets')?.addEventListener('click', () => {
    _showManageBudgetsModal(customBudgets, () => _renderPage(container));
  });

  // ── Modifier un budget custom (clic sur l'icône crayon) ──
  container.querySelectorAll('[data-edit-budget]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.editBudget;
      const bgt = customBudgets.find(b => b.id === id);
      if (bgt) _showEditBudgetModal(bgt, customBudgets, () => _renderPage(container));
    });
  });
}

// ────────────────────────────────────────────────────────────
// Section catégorie
// ────────────────────────────────────────────────────────────
function _buildCategorySection({ id, icon, title, budget, spent, ops, users, hint, isCustom = false, pinned = false }) {
  const remaining = budget - spent;
  const pctUsed   = budget > 0 ? Math.min(100, Math.round((spent / budget) * 100)) : (spent > 0 ? 100 : 0);
  const color     = pctUsed >= 100 ? 'danger' : pctUsed >= 80 ? 'warning' : 'success';
  const sortedOps = [...ops].sort((a, b) => (b.day || 0) - (a.day || 0));

  const editBtn = (id !== 'courses' && id !== 'extras') ? `
    <button class="btn-icon" data-edit-budget="${id}" title="Modifier ce budget"
      style="width:28px;height:28px;color:var(--text-3);margin-right:4px;">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13">
        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4z"/>
      </svg>
    </button>` : '';

  return `
    <div class="card" style="margin-bottom:12px;">
      <div class="card-header">
        <span class="card-title">${icon} ${escHtml(title)}</span>
        <div style="display:flex;align-items:center;gap:0;">
          ${editBtn}
          <button class="btn-icon bgt-pin-toggle" data-bgt-id="${escHtml(id)}" title="${pinned ? 'Retirer de l\'accueil' : 'Épingler sur l\'accueil'}"
            style="width:28px;height:28px;color:${pinned ? 'var(--primary)' : 'var(--text-3)'};margin-right:2px;">
            📌
          </button>
          <button class="btn btn-sm btn-primary" data-add-op="${id}" data-cat-name="${escHtml(title)}" data-cat-icon="${escHtml(icon)}">+ Ajouter</button>
        </div>
      </div>

      ${hint ? `<div style="font-size:0.75rem;color:var(--warning);background:var(--warning-bg);padding:6px 10px;border-radius:var(--radius-sm);margin-bottom:10px;">${hint}</div>` : ''}

      <div style="margin-bottom:10px;">
        <div class="progress-track" style="height:10px;margin-bottom:6px;">
          <div class="progress-bar ${color}" style="width:${pctUsed}%;transition:width 0.3s;"></div>
        </div>
        <div style="display:flex;justify-content:space-between;font-size:0.78rem;">
          <span style="color:var(--${color});font-weight:700;">${eur(spent)} dépensé${pctUsed > 0 ? ' (' + pctUsed + '%)' : ''}</span>
          <span style="color:var(--text-2);">Budget : ${budget > 0 ? eur(budget) : '—'}</span>
        </div>
        ${budget > 0 ? `<div style="font-size:0.72rem;color:${remaining >= 0 ? 'var(--success)' : 'var(--danger)'};margin-top:3px;text-align:right;">
          ${remaining >= 0 ? `✅ Reste ${eur(remaining)}` : `⚠️ Dépassement de ${eur(Math.abs(remaining))}`}
        </div>` : ''}
      </div>

      ${sortedOps.length === 0
        ? `<div style="font-size:0.82rem;color:var(--text-3);text-align:center;padding:8px 0;">Aucune opération — cliquez sur <strong>+ Ajouter</strong></div>`
        : `<div class="item-list">${sortedOps.map(op => _buildOpItem(op, users)).join('')}</div>`
      }
    </div>
  `;
}

// ────────────────────────────────────────────────────────────
// Item opération
// ────────────────────────────────────────────────────────────
function _buildOpItem(op, users) {
  const user    = op.userId ? users.find(u => String(u.id) === String(op.userId)) : null;
  const userDot = user
    ? `<span style="width:7px;height:7px;border-radius:50%;background:${escHtml(user.color||'#6C63FF')};display:inline-block;margin-right:3px;"></span>`
    : '';
  const dateStr = op.day ? `${op.day} ${nomMois(op.month)}` : nomMois(op.month);

  return `
    <div class="list-item" style="position:relative;">
      <div class="list-item-icon" style="background:var(--danger-bg);">🧾</div>
      <div class="list-item-body">
        <div class="list-item-title">${escHtml(op.label || 'Opération')}</div>
        <div class="list-item-sub">${dateStr}${user ? ` · ${userDot}${escHtml(user.name)}` : ''}</div>
      </div>
      <div class="list-item-right">
        <div class="list-item-amount" style="color:var(--danger);">−${eur(op.amount)}</div>
      </div>
      <button class="btn-icon" data-del-op="${op.id}"
        style="position:absolute;top:4px;right:4px;width:26px;height:26px;color:var(--text-3);" title="Supprimer">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13">
          <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>
    </div>
  `;
}

// ────────────────────────────────────────────────────────────
// Item achat exceptionnel (readonly)
// ────────────────────────────────────────────────────────────
function _buildAchatItem(a) {
  const dateStr = a.day ? `${a.day} ${nomMois(a.month)}` : nomMois(a.month);
  return `
    <div class="list-item">
      <div class="list-item-icon" style="background:var(--danger-bg);">💥</div>
      <div class="list-item-body">
        <div class="list-item-title">${escHtml(a.label || 'Achat')}</div>
        <div class="list-item-sub">${dateStr}</div>
      </div>
      <div class="list-item-right">
        <div class="list-item-amount" style="color:var(--danger);">−${eur(a.amount)}</div>
      </div>
    </div>
  `;
}

// ────────────────────────────────────────────────────────────
// Modal : ajouter une opération
// ────────────────────────────────────────────────────────────
function _showAddOpModal({ catId, catLabel }, users, year, month, onSave) {
  const daysInMonth = new Date(year, month, 0).getDate();
  const todayDay    = new Date().getDate();

  const userSelect = users.length > 1 ? `
    <div class="form-group" style="margin-bottom:10px;">
      <label class="form-label">Personne</label>
      <select class="form-input" id="bop-user">
        <option value="">— Sans attribution —</option>
        ${users.map(u => `<option value="${u.id}">${escHtml(u.name)}</option>`).join('')}
      </select>
    </div>` : '';

  openModal(`+ Opération ${catLabel}`, `
    <div class="form-group" style="margin-bottom:10px;">
      <label class="form-label">Enseigne / Description *</label>
      <input type="text" class="form-input" id="bop-label" placeholder="Ex: Carrefour, restaurant…" autocomplete="off">
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px;">
      <div class="form-group">
        <label class="form-label">Jour</label>
        <input type="number" class="form-input" id="bop-day" min="1" max="${daysInMonth}" value="${todayDay}">
      </div>
      <div class="form-group">
        <label class="form-label">Montant (€) *</label>
        <div class="input-wrap">
          <input type="number" class="form-input input-euro" id="bop-amount" min="0.01" step="0.01" placeholder="0.00">
          <span class="input-suffix">€</span>
        </div>
      </div>
    </div>
    ${userSelect}
    <p style="font-size:0.72rem;color:var(--text-3);">Mois : ${nomMois(month)} ${year}</p>
  `, `<button class="btn btn-primary btn-full" id="bop-save">Enregistrer</button>`);

  document.getElementById('bop-label')?.focus();

  document.getElementById('bop-save')?.addEventListener('click', async () => {
    const label  = document.getElementById('bop-label')?.value.trim();
    const amount = parseFloat(document.getElementById('bop-amount')?.value);
    const day    = parseInt(document.getElementById('bop-day')?.value, 10) || null;
    const userId = document.getElementById('bop-user')?.value || null;

    if (!label)            { showToast('Saisissez une description', 'error'); return; }
    if (!amount || amount <= 0) { showToast('Montant invalide', 'error'); return; }

    await saveBudgetOp({ category: catId, year, month, day, label, amount, userId });
    closeModal();
    showToast('Opération ajoutée ✅', 'success');
    onSave();
  });
}

// ────────────────────────────────────────────────────────────
// Modal : créer / modifier un budget personnalisé
// ────────────────────────────────────────────────────────────
function _showEditBudgetModal(existing, customBudgets, onSave) {
  const isNew   = !existing;
  const title   = isNew ? '📌 Nouveau budget' : `✏️ Modifier "${existing.name}"`;
  const selIcon = existing?.icon || '📌';

  // Modèles prédéfinis (filtrés pour ceux non encore créés)
  const PRESET_BUDGETS = [
    { name: 'Restaurant', icon: '🍽️' },
    { name: 'Loisirs',    icon: '🎉' },
    { name: 'Courses',    icon: '🛒' },
    { name: 'Vêtements',  icon: '👗' },
    { name: 'Gaming',     icon: '🎮' },
    { name: 'Cinéma',     icon: '🎬' },
    { name: 'Voyage',     icon: '✈️' },
  ];
  const existingNames = (customBudgets || []).map(b => b.name.toLowerCase());
  const availablePresets = isNew
    ? PRESET_BUDGETS.filter(p => !existingNames.includes(p.name.toLowerCase()))
    : [];

  const presetsHtml = availablePresets.length > 0
    ? `<div style="margin-bottom:14px;">
        <div style="font-size:0.72rem;font-weight:700;color:var(--text-3);text-transform:uppercase;margin-bottom:6px;">Démarrer depuis un modèle</div>
        <div style="display:flex;flex-wrap:wrap;gap:6px;">${
          availablePresets.map(p =>
            `<button type="button" class="btn btn-sm btn-outline preset-pick" data-pname="${escHtml(p.name)}" data-picon="${p.icon}" style="font-size:0.78rem;padding:4px 10px;">${p.icon} ${escHtml(p.name)}</button>`
          ).join('')
        }</div>
      </div><hr style="margin-bottom:14px;border-color:var(--border);">`
    : '';

  openModal(title, `${presetsHtml}
    <div class="form-group" style="margin-bottom:12px;">
      <label class="form-label">Nom du budget *</label>
      <input type="text" class="form-input" id="bgt-name" placeholder="Ex: Restaurant, Sport, Vêtements…"
        value="${escHtml(existing?.name || '')}" autocomplete="off">
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px;">
      <div class="form-group">
        <label class="form-label">Montant mensuel (€)</label>
        <div class="input-wrap">
          <input type="number" class="form-input input-euro" id="bgt-amount" min="0" step="5"
            placeholder="0" value="${existing?.amount || ''}">
          <span class="input-suffix">€</span>
        </div>
        <p class="form-hint">Laisser à 0 pour un suivi libre sans plafond.</p>
      </div>
      <div class="form-group">
        <label class="form-label">Icône</label>
        <input type="text" class="form-input" id="bgt-icon" maxlength="4"
          value="${escHtml(selIcon)}" placeholder="📌"
          style="font-size:1.4rem;text-align:center;cursor:pointer;" readonly>
      </div>
    </div>
    <!-- Sélecteur d'icônes -->
    <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:14px;">
      ${PRESET_ICONS.map(ic => `
        <button type="button" class="btn-icon icon-pick" data-icon="${ic}"
          style="width:36px;height:36px;font-size:1.2rem;border:2px solid ${ic === selIcon ? 'var(--primary)' : 'transparent'};
                 border-radius:8px;background:var(--bg-card);">
          ${ic}
        </button>`).join('')}
    </div>
    ${!isNew ? `<hr style="margin-bottom:12px;border-color:var(--border);">
    <button class="btn btn-outline btn-full" id="bgt-delete" style="color:var(--danger);border-color:var(--danger);">
      🗑️ Supprimer ce budget
    </button>` : ''}
  `, `<button class="btn btn-primary btn-full" id="bgt-save">${isNew ? 'Créer le budget' : 'Enregistrer'}</button>`);

  document.getElementById('bgt-name')?.focus();

  // Modèles prédéfinis : remplir le formulaire
  document.querySelectorAll('.preset-pick').forEach(btn => {
    btn.addEventListener('click', () => {
      document.getElementById('bgt-name').value = btn.dataset.pname;
      const iconEl = document.getElementById('bgt-icon');
      if (iconEl) iconEl.value = btn.dataset.picon;
      document.querySelectorAll('.icon-pick').forEach(b => {
        b.style.borderColor = b.dataset.icon === btn.dataset.picon ? 'var(--primary)' : 'transparent';
      });
    });
  });

  // Sélecteur icône
  document.querySelectorAll('.icon-pick').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.icon-pick').forEach(b => b.style.borderColor = 'transparent');
      btn.style.borderColor = 'var(--primary)';
      document.getElementById('bgt-icon').value = btn.dataset.icon;
    });
  });

  // Supprimer
  document.getElementById('bgt-delete')?.addEventListener('click', async () => {
    if (!confirm(`Supprimer le budget "${existing.name}" ? Les opérations enregistrées ne seront pas effacées.`)) return;
    const updated = customBudgets.filter(b => b.id !== existing.id);
    await setSetting('customBudgets', updated);
    closeModal();
    showToast('Budget supprimé', 'success');
    onSave();
  });

  // Sauvegarder
  document.getElementById('bgt-save')?.addEventListener('click', async () => {
    const name   = document.getElementById('bgt-name')?.value.trim();
    const amount = parseFloat(document.getElementById('bgt-amount')?.value) || 0;
    const icon   = document.getElementById('bgt-icon')?.value || '📌';

    if (!name) { showToast('Saisissez un nom', 'error'); return; }

    let updated;
    if (isNew) {
      const id = 'custom_' + Date.now();
      updated  = [...customBudgets, { id, name, icon, amount }];
    } else {
      updated = customBudgets.map(b => b.id === existing.id ? { ...b, name, icon, amount } : b);
    }

    await setSetting('customBudgets', updated);
    closeModal();
    showToast(isNew ? `Budget "${name}" créé ✅` : 'Budget mis à jour ✅', 'success');
    onSave();
  });
}

// ────────────────────────────────────────────────────────────
// Modal : gérer tous les budgets custom (liste + réordonner)
// ────────────────────────────────────────────────────────────
function _showManageBudgetsModal(customBudgets, onSave) {
  openModal('⚙️ Gérer mes budgets', `
    ${customBudgets.length === 0
      ? `<p style="color:var(--text-3);font-size:0.85rem;text-align:center;padding:12px 0;">
           Aucun budget personnalisé.<br>Utilisez <strong>+ Nouveau budget</strong> pour en créer.
         </p>`
      : `<div class="item-list" id="manage-budget-list">
          ${customBudgets.map(b => `
            <div class="list-item" style="padding:10px 12px;">
              <div class="list-item-icon" style="font-size:1.2rem;background:var(--bg-2);">${b.icon || '📌'}</div>
              <div class="list-item-body">
                <div class="list-item-title">${escHtml(b.name)}</div>
                <div class="list-item-sub">${b.amount > 0 ? eur(b.amount) + '/mois' : 'Suivi libre'}</div>
              </div>
              <div style="display:flex;gap:6px;">
                <button class="btn btn-sm btn-outline manage-edit" data-id="${b.id}">Modifier</button>
                <button class="btn btn-sm btn-outline manage-del" data-id="${b.id}"
                  style="color:var(--danger);border-color:var(--danger);">Supprimer</button>
              </div>
            </div>
          `).join('')}
        </div>`
    }
  `, `<button class="btn btn-primary btn-full" id="manage-add-new">+ Nouveau budget</button>`);

  document.getElementById('manage-add-new')?.addEventListener('click', () => {
    closeModal();
    _showEditBudgetModal(null, customBudgets, onSave);
  });

  document.querySelectorAll('.manage-edit').forEach(btn => {
    btn.addEventListener('click', () => {
      const bgt = customBudgets.find(b => b.id === btn.dataset.id);
      if (!bgt) return;
      closeModal();
      _showEditBudgetModal(bgt, customBudgets, onSave);
    });
  });

  document.querySelectorAll('.manage-del').forEach(btn => {
    btn.addEventListener('click', async () => {
      const bgt = customBudgets.find(b => b.id === btn.dataset.id);
      if (!bgt) return;
      if (!confirm(`Supprimer "${bgt.name}" ?`)) return;
      const updated = customBudgets.filter(b => b.id !== bgt.id);
      await setSetting('customBudgets', updated);
      closeModal();
      showToast('Budget supprimé', 'success');
      onSave();
    });
  });
}

// ────────────────────────────────────────────────────────────
// Utilitaire
// ────────────────────────────────────────────────────────────
function _addMonth(year, month, delta) {
  let m = month + delta, y = year;
  if (m > 12) { m = 1; y++; }
  if (m < 1)  { m = 12; y--; }
  return { year: y, month: m };
}


import { getMonthlyData, getAchatsForMonth,
         getBudgetOpsForMonth, saveBudgetOp, deleteBudgetOp,
         getActiveUsers }                                    from '../db.js';
import { eur, escHtml, showToast, openModal, closeModal,
         today, nomMois }                                    from '../utils.js';
import { State }                                             from '../app.js';

// ────────────────────────────────────────────────────────────
// Point d'entrée
// ────────────────────────────────────────────────────────────
export async function render(container) {
  await _renderPage(container);
}

async function _renderPage(container) {
  const { year, month } = State;
  const [md, achats, budgetOps, users] = await Promise.all([
    getMonthlyData(year, month),
    getAchatsForMonth(year, month),
    getBudgetOpsForMonth(year, month),
    getActiveUsers(),
  ]);

  // ── Budgets depuis la saisie mensuelle ──
  const budgetCourses = users.reduce((s, u) => s + (Number(md?.users?.[String(u.id)]?.courses) || 0), 0);
  const budgetExtras  = users.reduce((s, u) => s + (Number(md?.users?.[String(u.id)]?.extras)  || 0), 0);

  // ── Opérations saisies ──
  const opsCourses = budgetOps.filter(op => op.category === 'courses');
  const opsExtras  = budgetOps.filter(op => op.category === 'extras');
  const totalSpentCourses = opsCourses.reduce((s, op) => s + (Number(op.amount) || 0), 0);
  const totalSpentExtras  = opsExtras.reduce((s,  op) => s + (Number(op.amount) || 0), 0);

  // ── Achats exceptionnels (depuis le store achats) ──
  const totalAchats = achats.reduce((s, a) => s + (Number(a.amount) || 0), 0);

  container.innerHTML = `
    <!-- Sélecteur mois -->
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">
      <button class="btn btn-outline btn-sm" id="btn-prev-month">‹</button>
      <span style="font-weight:700;font-size:0.95rem;">${nomMois(month)} ${year}</span>
      <button class="btn btn-outline btn-sm" id="btn-next-month">›</button>
    </div>

    <!-- ── Courses ── -->
    ${_buildCategorySection({
      id:         'courses',
      icon:       '🛒',
      title:      'Courses',
      budget:     budgetCourses,
      spent:      totalSpentCourses,
      ops:        opsCourses,
      users,
      hint:       budgetCourses === 0 ? '⚠️ Aucun budget saisi pour les courses ce mois-ci (saisie mensuelle).' : null,
    })}

    <!-- ── Extras ── -->
    ${_buildCategorySection({
      id:         'extras',
      icon:       '🎉',
      title:      'Extras & loisirs',
      budget:     budgetExtras,
      spent:      totalSpentExtras,
      ops:        opsExtras,
      users,
      hint:       budgetExtras === 0 ? '⚠️ Aucun budget saisi pour les extras ce mois-ci (saisie mensuelle).' : null,
    })}

    <!-- ── Achats exceptionnels ── -->
    <div class="card" style="margin-bottom:12px;">
      <div class="card-header">
        <span class="card-title">💥 Achats exceptionnels</span>
        <span class="chip danger">${eur(totalAchats)}</span>
      </div>
      <p style="font-size:0.78rem;color:var(--text-3);margin-bottom:10px;">
        Gérés depuis l'onglet <strong>Charges → Exceptionnels</strong>.
      </p>
      ${achats.length === 0
        ? `<div style="font-size:0.82rem;color:var(--text-3);text-align:center;padding:10px 0;">Aucun achat exceptionnel ce mois-ci</div>`
        : `<div class="item-list">${achats.map(a => _buildAchatItem(a)).join('')}</div>`
      }
    </div>

    <div style="height:24px;"></div>
  `;

  // ── Navigation mois ──
  container.querySelector('#btn-prev-month')?.addEventListener('click', () => {
    const d = _addMonth(year, month, -1);
    State.year = d.year; State.month = d.month;
    _renderPage(container);
  });
  container.querySelector('#btn-next-month')?.addEventListener('click', () => {
    const d = _addMonth(year, month, +1);
    State.year = d.year; State.month = d.month;
    _renderPage(container);
  });

  // ── Boutons "Ajouter" ──
  container.querySelectorAll('[data-add-op]').forEach(btn => {
    btn.addEventListener('click', () => {
      _showAddOpModal(btn.dataset.addOp, users, year, month, () => _renderPage(container));
    });
  });

  // ── Suppression ──
  container.querySelectorAll('[data-del-op]').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('Supprimer cette opération ?')) return;
      await deleteBudgetOp(Number(btn.dataset.delOp));
      showToast('Opération supprimée', 'success');
      _renderPage(container);
    });
  });
}

// ────────────────────────────────────────────────────────────
// Construire la section d'une catégorie
// ────────────────────────────────────────────────────────────
function _buildCategorySection({ id, icon, title, budget, spent, ops, users, hint }) {
  const remaining = budget - spent;
  const pctUsed   = budget > 0 ? Math.min(100, Math.round((spent / budget) * 100)) : (spent > 0 ? 100 : 0);
  const color     = pctUsed >= 100 ? 'danger' : pctUsed >= 80 ? 'warning' : 'success';
  const sortedOps = [...ops].sort((a, b) => (b.day || 0) - (a.day || 0));

  return `
    <div class="card" style="margin-bottom:12px;">
      <div class="card-header">
        <span class="card-title">${icon} ${escHtml(title)}</span>
        <button class="btn btn-sm btn-primary" data-add-op="${id}">+ Ajouter</button>
      </div>

      ${hint ? `<div style="font-size:0.75rem;color:var(--warning);background:var(--warning-bg);padding:6px 10px;border-radius:var(--radius-sm);margin-bottom:10px;">${hint}</div>` : ''}

      <!-- Barre de progression -->
      <div style="margin-bottom:10px;">
        <div class="progress-track" style="height:10px;margin-bottom:6px;">
          <div class="progress-bar ${color}" style="width:${pctUsed}%;transition:width 0.3s;"></div>
        </div>
        <div style="display:flex;justify-content:space-between;font-size:0.78rem;">
          <span style="color:var(--${color});font-weight:700;">${eur(spent)} dépensé${pctUsed > 0 ? ' (' + pctUsed + '%)' : ''}</span>
          <span style="color:var(--text-2);">Budget : ${budget > 0 ? eur(budget) : '—'}</span>
        </div>
        ${budget > 0 ? `<div style="font-size:0.72rem;color:${remaining >= 0 ? 'var(--success)' : 'var(--danger)'};margin-top:3px;text-align:right;">
          ${remaining >= 0 ? `✅ Reste ${eur(remaining)}` : `⚠️ Dépassement de ${eur(Math.abs(remaining))}`}
        </div>` : ''}
      </div>

      <!-- Liste des opérations -->
      ${sortedOps.length === 0
        ? `<div style="font-size:0.82rem;color:var(--text-3);text-align:center;padding:8px 0;">Aucune opération — cliquez sur <strong>+ Ajouter</strong></div>`
        : `<div class="item-list">${sortedOps.map(op => _buildOpItem(op, users)).join('')}</div>`
      }
    </div>
  `;
}

// ────────────────────────────────────────────────────────────
// Item d'une opération budget
// ────────────────────────────────────────────────────────────
function _buildOpItem(op, users) {
  const user     = op.userId ? users.find(u => String(u.id) === String(op.userId)) : null;
  const userDot  = user
    ? `<span style="width:7px;height:7px;border-radius:50%;background:${escHtml(user.color||'#6C63FF')};display:inline-block;margin-right:3px;"></span>`
    : '';
  const dateStr  = op.day ? `${op.day} ${nomMois(op.month)}` : nomMois(op.month);

  return `
    <div class="list-item" style="position:relative;">
      <div class="list-item-icon" style="background:var(--danger-bg);">🧾</div>
      <div class="list-item-body">
        <div class="list-item-title">${escHtml(op.label || 'Opération')}</div>
        <div class="list-item-sub">${dateStr}${user ? ` · ${userDot}${escHtml(user.name)}` : ''}</div>
      </div>
      <div class="list-item-right">
        <div class="list-item-amount" style="color:var(--danger);">−${eur(op.amount)}</div>
      </div>
      <button class="btn-icon" data-del-op="${op.id}"
        style="position:absolute;top:4px;right:4px;width:26px;height:26px;color:var(--text-3);" title="Supprimer">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13">
          <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>
    </div>
  `;
}

// ────────────────────────────────────────────────────────────
// Item achat exceptionnel (readonly, redirige vers Charges)
// ────────────────────────────────────────────────────────────
function _buildAchatItem(a) {
  const dateStr = a.day ? `${a.day} ${nomMois(a.month)}` : nomMois(a.month);
  return `
    <div class="list-item">
      <div class="list-item-icon" style="background:var(--danger-bg);">💥</div>
      <div class="list-item-body">
        <div class="list-item-title">${escHtml(a.label || 'Achat')}</div>
        <div class="list-item-sub">${dateStr}</div>
      </div>
      <div class="list-item-right">
        <div class="list-item-amount" style="color:var(--danger);">−${eur(a.amount)}</div>
      </div>
    </div>
  `;
}

// ────────────────────────────────────────────────────────────
// Modal : ajouter une opération
// ────────────────────────────────────────────────────────────
function _showAddOpModal(category, users, year, month, onSave) {
  const catLabel = category === 'courses' ? '🛒 Courses' : '🎉 Extras';
  const daysInMonth = new Date(year, month, 0).getDate();
  const todayDay    = new Date().getDate();

  const userSelect = users.length > 1 ? `
    <div class="form-group" style="margin-bottom:10px;">
      <label class="form-label">Personne</label>
      <select class="form-input" id="bop-user">
        <option value="">— Sans attribution —</option>
        ${users.map(u => `<option value="${u.id}">${escHtml(u.name)}</option>`).join('')}
      </select>
    </div>
  ` : '';

  openModal(`+ Opération ${catLabel}`, `
    <div class="form-group" style="margin-bottom:10px;">
      <label class="form-label">Enseigne / Description *</label>
      <input type="text" class="form-input" id="bop-label" placeholder="Ex: Carrefour, Marché…" autocomplete="off">
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px;">
      <div class="form-group">
        <label class="form-label">Jour</label>
        <input type="number" class="form-input" id="bop-day" min="1" max="${daysInMonth}" value="${todayDay}" placeholder="1-${daysInMonth}">
      </div>
      <div class="form-group">
        <label class="form-label">Montant (€) *</label>
        <div class="input-wrap">
          <input type="number" class="form-input input-euro" id="bop-amount" min="0.01" step="0.01" placeholder="0.00">
          <span class="input-suffix">€</span>
        </div>
      </div>
    </div>
    ${userSelect}
    <p style="font-size:0.72rem;color:var(--text-3);">Mois : ${nomMois(month)} ${year}</p>
  `, `<button class="btn btn-primary btn-full" id="bop-save">Enregistrer</button>`);

  document.getElementById('bop-label')?.focus();

  document.getElementById('bop-save')?.addEventListener('click', async () => {
    const label  = document.getElementById('bop-label')?.value.trim();
    const amount = parseFloat(document.getElementById('bop-amount')?.value);
    const day    = parseInt(document.getElementById('bop-day')?.value, 10) || null;
    const userId = document.getElementById('bop-user')?.value || null;

    if (!label)     { showToast('Saisissez une description', 'error'); return; }
    if (!amount || amount <= 0) { showToast('Montant invalide', 'error'); return; }

    await saveBudgetOp({ category, year, month, day, label, amount, userId });
    closeModal();
    showToast('Opération ajoutée ✅', 'success');
    onSave();
  });
}

// ────────────────────────────────────────────────────────────
// Utilitaire
// ────────────────────────────────────────────────────────────
function _addMonth(year, month, delta) {
  let m = month + delta, y = year;
  if (m > 12) { m = 1; y++; }
  if (m < 1)  { m = 12; y--; }
  return { year: y, month: m };
}
