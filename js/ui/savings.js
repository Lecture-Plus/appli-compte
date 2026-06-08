// ============================================================
// js/ui/savings.js – Page suivi des économies
// ============================================================

import { getAllSavingsOperations, saveSavingsOperation,
         deleteSavingsOperation, getLatestSavingsConfirmed,
         saveSavingsConfirmed, getAllSettings, setSetting }  from '../db.js';
import { calcSavingsBalance }                                from '../calculs.js';
import { eur, escHtml, showToast, openModal, closeModal,
         today, nomMois }                                    from '../utils.js';

export async function render(container) {
  await _renderPage(container);
}

async function _renderPage(container) {
  const allOps = await getAllSavingsOperations();
  const latest = await getLatestSavingsConfirmed();
  const { balance, base, delta } = calcSavingsBalance(latest, allOps);

  const { year, month } = today();
  const currentMonthConfirmed = latest && latest.year === year && latest.month === month;

  // Tri : plus récent d'abord
  const sortedOps = [...allOps].sort((a, b) => {
    if (b.year  !== a.year)  return b.year  - a.year;
    if (b.month !== a.month) return b.month - a.month;
    return (b.day || 0) - (a.day || 0);
  });

  // Calcul solde courant avec running total pour affichage
  let running = balance;
  const opsWithRunning = [...sortedOps].reverse().reduce((acc, op) => {
    const nb = { ...op, _running: running };
    running -= (Number(op.amount) || 0);
    acc.unshift(nb);
    return acc;
  }, []);

  const balanceClass = balance >= 0 ? 'positive' : 'negative';

  container.innerHTML = `
    <!-- Solde actuel -->
    <div class="kpi-card success" style="--kpi-color:var(--success); margin-bottom:12px; padding:20px 20px 16px;">
      <div class="kpi-label">💰 Solde des économies estimé</div>
      <div class="kpi-value ${balanceClass}" style="font-size:2rem; margin:8px 0;">${eur(balance)}</div>
      ${latest
        ? `<div class="kpi-sub">
             Base confirmée : ${eur(base)}
             ${delta !== 0 ? ` · Opérations : <span style="color:${delta >= 0 ? 'var(--success)':'var(--danger)'}">${delta >= 0 ? '+' : ''}${eur(delta)}</span>` : ''}
             <br>Le ${new Date(latest.confirmedAt).toLocaleDateString('fr-FR')} (${nomMois(latest.month)} ${latest.year})
           </div>`
        : `<div class="kpi-sub" style="color:var(--warning);">⚠️ Aucune confirmation – solde basé sur les opérations uniquement</div>`
      }
    </div>

    <!-- Rappel mensuel -->
    ${!currentMonthConfirmed ? `
    <div style="background:var(--warning-bg); border:1.5px solid var(--warning); border-radius:var(--radius); padding:14px 16px; margin-bottom:12px; display:flex; align-items:center; gap:12px;">
      <span style="font-size:1.4rem;">🔔</span>
      <div style="flex:1;">
        <div style="font-weight:700; font-size:0.9rem;">Vérification mensuelle</div>
        <div style="font-size:0.78rem; color:var(--text-2); margin-top:2px;">${nomMois(month)} ${year} n'est pas encore confirmé.</div>
      </div>
      <button class="btn btn-sm btn-primary" id="btn-quick-confirm">Confirmer</button>
    </div>
    ` : ''}

    <!-- Actions -->
    <div style="display:flex; gap:8px; margin-bottom:16px;">
      <button class="btn btn-success" style="flex:1;" id="btn-confirm">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="16" height="16"><path d="M20 6L9 17l-5-5"/></svg>
        Confirmer le solde
      </button>
      <button class="btn btn-secondary" id="btn-add-op">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="16" height="16"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        Versement
      </button>
      <button class="btn btn-outline" id="btn-withdraw-op">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="16" height="16"><line x1="5" y1="12" x2="19" y2="12"/></svg>
        Retrait
      </button>
    </div>

    <!-- Historique -->
    <div class="section-header" style="margin-bottom:8px;">
      <span class="section-label">📋 Historique des opérations</span>
      <span class="chip">${sortedOps.length}</span>
    </div>

    ${opsWithRunning.length === 0
      ? `<div class="empty-state">
           <div class="empty-state-icon">💰</div>
           <div class="empty-state-title">Aucune opération</div>
           <div class="empty-state-text">Commencez par confirmer votre solde actuel.</div>
         </div>`
      : `<div class="item-list">${opsWithRunning.map(op => buildOpItem(op)).join('')}</div>`
    }

    <div style="height:24px;"></div>
  `;

  // ── Événements ──
  container.querySelector('#btn-confirm')?.addEventListener('click', () => showConfirmModal(() => _renderPage(container)));
  container.querySelector('#btn-quick-confirm')?.addEventListener('click', () => showConfirmModal(() => _renderPage(container)));
  container.querySelector('#btn-add-op')?.addEventListener('click', () => showOpModal('add', () => _renderPage(container)));
  container.querySelector('#btn-withdraw-op')?.addEventListener('click', () => showOpModal('withdraw', () => _renderPage(container)));

  // Supprimer une opération au clic
  container.querySelectorAll('.op-delete').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = Number(btn.dataset.id);
      if (!confirm('Supprimer cette opération ?')) return;
      await deleteSavingsOperation(id);
      showToast('Opération supprimée', 'success');
      _renderPage(container);
    });
  });
}

// ── Item d'opération ──
function buildOpItem(op) {
  const amount    = Number(op.amount) || 0;
  const isPos     = amount >= 0;
  const typeLabel = {
    add:             '💰 Versement',
    withdraw:        '🏧 Retrait',
    craquage_cover:  '💥 Craquage couvert',
    monthly_savings: '📅 Épargne mensuelle',
    confirm:         '✅ Confirmation',
  }[op.type] || '📌 Opération';

  const dateStr = op.day
    ? `${String(op.day).padStart(2,'0')}/${String(op.month).padStart(2,'0')}/${op.year}`
    : `${nomMois(op.month)} ${op.year}`;

  return `
    <div class="list-item" style="position:relative;">
      <div class="list-item-icon" style="background:${isPos ? 'var(--success-bg)' : 'var(--danger-bg)'};">
        ${isPos ? '📈' : '📉'}
      </div>
      <div class="list-item-body">
        <div class="list-item-title">${escHtml(op.label || typeLabel)}</div>
        <div class="list-item-sub">${typeLabel} · ${dateStr}</div>
      </div>
      <div class="list-item-right">
        <div class="list-item-amount" style="color:${isPos ? 'var(--success)' : 'var(--danger)'};">
          ${isPos ? '+' : ''}${eur(amount)}
        </div>
        <div style="font-size:0.7rem; color:var(--text-3);">Solde : ${eur(op._running)}</div>
      </div>
      <button class="btn-icon op-delete" data-id="${op.id}"
        style="position:absolute; top:4px; right:4px; width:28px; height:28px; color:var(--text-3);"
        title="Supprimer">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
          <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>
    </div>
  `;
}

// ── Modal : confirmer le solde mensuel ──
function showConfirmModal(onSave) {
  const { year, month } = today();
  const allOps = getAllSavingsOperations();

  openModal('✅ Confirmer le solde épargne', `
    <p style="color:var(--text-2); font-size:0.875rem; margin-bottom:16px;">
      Indiquez le solde <strong>réel actuel</strong> de votre épargne (livret, compte, cash…).
      Cela servira de base pour les calculs futurs.
    </p>
    <div class="form-group" style="margin-bottom:12px;">
      <label class="form-label">Solde actuel (€)</label>
      <div class="input-wrap">
        <input type="number" class="form-input input-euro" id="conf-amount"
          min="0" step="0.01" placeholder="0.00">
        <span class="input-suffix">€</span>
      </div>
    </div>
    <div class="form-group">
      <label class="form-label">Note (optionnel)</label>
      <input type="text" class="form-input" id="conf-note" placeholder="Ex: Vérification début de mois">
    </div>
    <div style="margin-top:10px; font-size:0.75rem; color:var(--text-3);">
      Mois : ${nomMois(month)} ${year}
    </div>
  `, `
    <button class="btn btn-outline" id="conf-cancel">Annuler</button>
    <button class="btn btn-primary" id="conf-save">Confirmer</button>
  `);

  document.getElementById('conf-cancel')?.addEventListener('click', closeModal);

  document.getElementById('conf-save')?.addEventListener('click', async () => {
    const amount = Number(document.getElementById('conf-amount')?.value);
    if (isNaN(amount) || amount < 0) {
      showToast('Montant invalide', 'error');
      return;
    }
    const note = document.getElementById('conf-note')?.value.trim() || '';
    const now  = new Date();

    await saveSavingsConfirmed({
      year, month,
      amount,
      confirmedAt:  now.toISOString(),
      confirmedDay: now.getDate(),
      note,
    });

    closeModal();
    showToast(`Solde confirmé : ${eur(amount)} ✅`, 'success');
    onSave();
  });
}

// ── Modal : ajouter ou retirer une opération ──
function showOpModal(type, onSave) {
  const isAdd    = type === 'add';
  const title    = isAdd ? '💰 Nouveau versement' : '🏧 Nouveau retrait';
  const { year, month } = today();
  const now      = new Date();

  openModal(title, `
    <div class="form-group" style="margin-bottom:10px;">
      <label class="form-label">Montant (€)</label>
      <div class="input-wrap">
        <input type="number" class="form-input input-euro" id="op-amount"
          min="0" step="0.01" placeholder="0.00">
        <span class="input-suffix">€</span>
      </div>
    </div>
    <div class="form-group" style="margin-bottom:10px;">
      <label class="form-label">Libellé</label>
      <input type="text" class="form-input" id="op-label"
        placeholder="${isAdd ? 'Ex: Virement Livret A, Salaire épargné…' : 'Ex: Achat voiture, Vacances…'}">
    </div>
    <div class="form-grid-2">
      <div class="form-group">
        <label class="form-label">Mois</label>
        <input type="number" class="form-input" id="op-month" min="1" max="12" value="${month}">
      </div>
      <div class="form-group">
        <label class="form-label">Année</label>
        <input type="number" class="form-input" id="op-year" min="2020" max="2099" value="${year}">
      </div>
    </div>
  `, `
    <button class="btn btn-outline" id="op-cancel">Annuler</button>
    <button class="btn ${isAdd ? 'btn-success' : 'btn-danger'}" id="op-save">
      ${isAdd ? '+ Ajouter' : '- Retirer'}
    </button>
  `);

  document.getElementById('op-cancel')?.addEventListener('click', closeModal);

  document.getElementById('op-save')?.addEventListener('click', async () => {
    const amount = Number(document.getElementById('op-amount')?.value);
    if (!amount || amount <= 0) { showToast('Montant invalide', 'error'); return; }
    const label = document.getElementById('op-label')?.value.trim() || (isAdd ? 'Versement' : 'Retrait');
    const m     = Number(document.getElementById('op-month')?.value) || month;
    const y     = Number(document.getElementById('op-year')?.value) || year;

    await saveSavingsOperation({
      amount:  isAdd ? amount : -amount,
      label,
      type:    isAdd ? 'add' : 'withdraw',
      year:    y,
      month:   m,
      day:     now.getDate(),
      createdAt: now.toISOString(),
    });

    closeModal();
    showToast(isAdd ? `+${eur(amount)} ajouté ✅` : `-${eur(amount)} retiré`, 'success');
    onSave();
  });
}
