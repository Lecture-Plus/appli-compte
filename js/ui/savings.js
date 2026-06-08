// ============================================================
// js/ui/savings.js – Page suivi des économies
// ============================================================

import { getAllSavingsOperations, saveSavingsOperation,
         deleteSavingsOperation, getLatestSavingsConfirmed,
         saveSavingsConfirmed, getAllSettings, setSetting,
         getActiveUsers }                                    from '../db.js';
import { calcSavingsBalance }                                from '../calculs.js';
import { eur, escHtml, showToast, openModal, closeModal,
         today, nomMois }                                    from '../utils.js';

export async function render(container) {
  await _renderPage(container);
}

async function _renderPage(container) {
  const [allOps, latest, users] = await Promise.all([
    getAllSavingsOperations(),
    getLatestSavingsConfirmed(),
    getActiveUsers(),
  ]);
  const { balance, base, delta } = calcSavingsBalance(latest, allOps);

  const { year, month } = today();
  const currentMonthConfirmed = latest && latest.year === year && latest.month === month;

  // ── Solde par user : somme des opérations avec userId ──
  const userBalances = users.map(u => {
    const uOps = allOps.filter(op => String(op.userId) === String(u.id));
    const bal  = uOps.reduce((s, op) => s + (Number(op.amount) || 0), 0);
    return { user: u, balance: bal };
  });
  const hasUserData = userBalances.some(ub => ub.balance !== 0);

  // Tri : plus récent d'abord
  const sortedOps = [...allOps].sort((a, b) => {
    if (b.year  !== a.year)  return b.year  - a.year;
    if (b.month !== a.month) return b.month - a.month;
    return (b.day || 0) - (a.day || 0);
  });

  // Running total for display
  let running = balance;
  const opsWithRunning = [...sortedOps].reverse().reduce((acc, op) => {
    const nb = { ...op, _running: running };
    running -= (Number(op.amount) || 0);
    acc.unshift(nb);
    return acc;
  }, []);

  const balanceClass = balance >= 0 ? 'positive' : 'negative';

  container.innerHTML = `
    <!-- Solde total -->
    <div class="kpi-card success" style="--kpi-color:var(--success); margin-bottom:12px; padding:20px 20px 16px;">
      <div class="kpi-label">💰 Solde total des économies</div>
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

    <!-- Soldes par user -->
    ${users.length > 1 ? `
    <div style="display:grid;grid-template-columns:${users.map(() => '1fr').join(' ')};gap:8px;margin-bottom:12px;">
      ${userBalances.map(ub => `
        <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius);padding:12px;text-align:center;">
          <div style="width:10px;height:10px;border-radius:50%;background:${escHtml(ub.user.color||'#6C63FF')};display:inline-block;margin-bottom:4px;"></div>
          <div style="font-size:0.72rem;font-weight:600;color:var(--text-3);">${escHtml(ub.user.name)}</div>
          <div style="font-size:1.05rem;font-weight:800;color:${ub.balance >= 0 ? 'var(--success)' : 'var(--danger)'};">${eur(ub.balance)}</div>
        </div>
      `).join('')}
    </div>` : ''}

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
      : `<div class="item-list">${opsWithRunning.map(op => buildOpItem(op, users)).join('')}</div>`
    }

    <div style="height:24px;"></div>
  `;

  // ── Événements ──
  container.querySelector('#btn-confirm')?.addEventListener('click', () => showConfirmModal(() => _renderPage(container)));
  container.querySelector('#btn-quick-confirm')?.addEventListener('click', () => showConfirmModal(() => _renderPage(container)));
  container.querySelector('#btn-add-op')?.addEventListener('click', () => showOpModal('add', users, () => _renderPage(container)));
  container.querySelector('#btn-withdraw-op')?.addEventListener('click', () => showOpModal('withdraw', users, () => _renderPage(container)));

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
function buildOpItem(op, users = []) {
  const amount    = Number(op.amount) || 0;
  const isPos     = amount >= 0;
  const typeLabel = {
    add:             '💰 Versement',
    withdraw:        '🏧 Retrait',
    craquage_cover:  '💥 Craquage couvert',
    monthly_savings: '📅 Épargne mensuelle',
    confirm:         '✅ Confirmation',
  }[op.type] || '📌 Opération';

  const dateStr = `${nomMois(op.month)} ${op.year}`;
  const userLabel = op.userId
    ? (users.find(u => String(u.id) === String(op.userId))?.name ?? `User ${op.userId}`)
    : null;

  return `
    <div class="list-item" style="position:relative;">
      <div class="list-item-icon" style="background:${isPos ? 'var(--success-bg)' : 'var(--danger-bg)'};">
        ${isPos ? '📈' : '📉'}
      </div>
      <div class="list-item-body">
        <div class="list-item-title">${escHtml(op.label || typeLabel)}</div>
        <div class="list-item-sub">${typeLabel} · ${dateStr}${userLabel ? ` · <span style="font-weight:600;">${escHtml(userLabel)}</span>` : ''}</div>
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
async function showConfirmModal(onSave) {
  const [allOps, latest] = await Promise.all([
    getAllSavingsOperations(),
    getLatestSavingsConfirmed(),
  ]);
  const { balance } = calcSavingsBalance(latest, allOps);
  const { year, month } = today();
  const moisLabel      = nomMois(month);
  const lastDayOfMonth = new Date(year, month, 0).getDate();

  openModal('✅ Confirmer le solde épargne', `
    <p style="color:var(--text-2); font-size:0.875rem; margin-bottom:12px;">
      Indiquez le solde <strong>réel actuel</strong> de votre épargne (livret, compte, cash…).
    </p>
    <div class="form-group" style="margin-bottom:10px;">
      <label class="form-label">Solde logique (calculé)</label>
      <button class="btn btn-outline trf-preset" id="conf-use-calc"
        style="width:100%;justify-content:flex-start;font-size:0.85rem;padding:8px 12px;text-align:left;">
        ✅ Utiliser : <strong>${eur(balance)}</strong>
      </button>
      <div style="font-size:0.72rem;color:var(--text-3);margin-top:4px;">Basé sur la dernière confirmation + toutes les opérations</div>
    </div>
    <div class="form-group" style="margin-bottom:10px;">
      <label class="form-label">Ou saisir manuellement (€)</label>
      <div class="input-wrap">
        <input type="number" class="form-input input-euro" id="conf-amount"
          min="0" step="0.01" placeholder="0.00">
        <span class="input-suffix">€</span>
      </div>
      <div style="font-size:0.72rem;color:var(--text-3);margin-top:4px;">Si supérieur au solde logique, la différence sera enregistrée comme ajustement de ${moisLabel}</div>
    </div>
    <div class="form-group">
      <label class="form-label">Note (optionnel)</label>
      <input type="text" class="form-input" id="conf-note" placeholder="Ex: Vérification début de mois">
    </div>
    <div style="margin-top:10px; font-size:0.75rem; color:var(--text-3);">
      Mois : ${moisLabel} ${year}
    </div>
  `, `
    <button class="btn btn-outline" id="conf-cancel">Annuler</button>
    <button class="btn btn-primary" id="conf-save">Confirmer</button>
  `);

  document.getElementById('conf-cancel')?.addEventListener('click', closeModal);

  document.getElementById('conf-use-calc')?.addEventListener('click', () => {
    const inp = document.getElementById('conf-amount');
    if (inp) inp.value = balance.toFixed(2);
  });

  document.getElementById('conf-save')?.addEventListener('click', async () => {
    const amountStr = document.getElementById('conf-amount')?.value?.trim();
    const amount = amountStr ? Number(amountStr) : balance;
    if (isNaN(amount) || amount < 0) {
      showToast('Montant invalide', 'error');
      return;
    }
    const note = document.getElementById('conf-note')?.value.trim() || '';
    const now  = new Date();

    // Si montant manuel > solde logique : enregistrer un ajustement daté au dernier jour du mois
    if (amount > balance + 0.01) {
      const diff = Math.round((amount - balance) * 100) / 100;
      await saveSavingsOperation({
        amount:    diff,
        label:     `Ajustement ${moisLabel} ${year}`,
        type:      'add',
        year,
        month,
        day:       lastDayOfMonth,
        createdAt: now.toISOString(),
      });
    }

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
function showOpModal(type, users, onSave) {
  const isAdd    = type === 'add';
  const title    = isAdd ? '💰 Nouveau versement' : '🏧 Nouveau retrait';
  const { year, month } = today();
  const now      = new Date();
  const N        = users.length;

  // Pour craquage partagé (passé en paramètre) : total à distribuer
  const sharedTotal = null; // pas de total pré-rempli en usage direct

  const userSection = N > 1 ? `
    <div class="form-group" style="margin-bottom:10px;">
      <label class="form-label">Répartition par personne</label>
      <p style="font-size:0.72rem;color:var(--text-3);margin-bottom:8px;">Laissez vide pour ne pas affecter un user précis</p>
      <div style="display:flex;flex-direction:column;gap:6px;" id="op-user-rows">
        ${users.map(u => `
          <div style="display:flex;align-items:center;gap:8px;">
            <span style="width:10px;height:10px;border-radius:50%;background:${escHtml(u.color||'#6C63FF')};display:inline-block;flex-shrink:0;"></span>
            <span style="font-size:0.82rem;font-weight:600;flex:1;">${escHtml(u.name)}</span>
            <div class="input-wrap" style="width:110px;">
              <input type="number" class="form-input input-euro op-user-amount" data-uid="${u.id}"
                min="0" step="0.01" placeholder="0.00" style="padding-right:22px;">
              <span class="input-suffix">€</span>
            </div>
            <button type="button" class="btn btn-outline btn-sm op-fill-rest" data-uid="${u.id}" style="white-space:nowrap;padding:6px 10px;font-size:0.75rem;">← Reste</button>
          </div>
        `).join('')}
      </div>
      <div id="op-user-total" style="text-align:right;font-size:0.78rem;color:var(--text-3);margin-top:6px;"></div>
    </div>
  ` : '';

  openModal(title, `
    <div class="form-group" style="margin-bottom:10px;">
      <label class="form-label">Montant total (€)</label>
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
    <div class="form-grid-2" style="margin-bottom:10px;">
      <div class="form-group">
        <label class="form-label">Mois</label>
        <input type="number" class="form-input" id="op-month" min="1" max="12" value="${month}">
      </div>
      <div class="form-group">
        <label class="form-label">Année</label>
        <input type="number" class="form-input" id="op-year" min="2020" max="2099" value="${year}">
      </div>
    </div>
    ${userSection}
  `, `
    <button class="btn btn-outline" id="op-cancel">Annuler</button>
    <button class="btn ${isAdd ? 'btn-success' : 'btn-danger'}" id="op-save">
      ${isAdd ? '+ Ajouter' : '- Retirer'}
    </button>
  `);

  // ── Logique fill-rest ──
  if (N > 1) {
    function updateUserTotal() {
      const total = [...document.querySelectorAll('.op-user-amount')]
        .reduce((s, inp) => s + (Number(inp.value) || 0), 0);
      const mainAmt = Number(document.getElementById('op-amount')?.value) || 0;
      const el = document.getElementById('op-user-total');
      if (el) el.textContent = total > 0 ? `Alloué : ${eur(total)}${mainAmt > 0 ? ` / ${eur(mainAmt)}` : ''}` : '';
    }

    document.querySelectorAll('.op-user-amount').forEach(inp => {
      inp.addEventListener('input', updateUserTotal);
    });

    document.getElementById('op-amount')?.addEventListener('input', updateUserTotal);

    document.querySelectorAll('.op-fill-rest').forEach(btn => {
      btn.addEventListener('click', () => {
        const uid  = btn.dataset.uid;
        const mainAmt = Number(document.getElementById('op-amount')?.value) || 0;
        const allocated = [...document.querySelectorAll('.op-user-amount')]
          .filter(inp => inp.dataset.uid !== uid)
          .reduce((s, inp) => s + (Number(inp.value) || 0), 0);
        const rest = Math.max(0, Math.round((mainAmt - allocated) * 100) / 100);
        const target = document.querySelector(`.op-user-amount[data-uid="${uid}"]`);
        if (target) { target.value = rest; updateUserTotal(); }
      });
    });
  }

  document.getElementById('op-cancel')?.addEventListener('click', closeModal);

  document.getElementById('op-save')?.addEventListener('click', async () => {
    const amount = Number(document.getElementById('op-amount')?.value);
    if (!amount || amount <= 0) { showToast('Montant invalide', 'error'); return; }
    const label = document.getElementById('op-label')?.value.trim() || (isAdd ? 'Versement' : 'Retrait');
    const m     = Number(document.getElementById('op-month')?.value) || month;
    const y     = Number(document.getElementById('op-year')?.value) || year;

    const userAmounts = N > 1
      ? [...document.querySelectorAll('.op-user-amount')]
          .map(inp => ({ uid: inp.dataset.uid, amt: Number(inp.value) || 0 }))
          .filter(u => u.amt > 0)
      : [];

    if (userAmounts.length > 0) {
      // Enregistrer une op par user
      for (const { uid, amt } of userAmounts) {
        await saveSavingsOperation({
          amount:  isAdd ? amt : -amt,
          label,
          type:    isAdd ? 'add' : 'withdraw',
          userId:  uid,
          year:    y,
          month:   m,
          day:     now.getDate(),
          createdAt: now.toISOString(),
        });
      }
    } else {
      // Op globale sans user
      await saveSavingsOperation({
        amount:  isAdd ? amount : -amount,
        label,
        type:    isAdd ? 'add' : 'withdraw',
        year:    y,
        month:   m,
        day:     now.getDate(),
        createdAt: now.toISOString(),
      });
    }

    closeModal();
    showToast(isAdd ? `+${eur(amount)} ajouté ✅` : `-${eur(amount)} retiré`, 'success');
    onSave();
  });
}
