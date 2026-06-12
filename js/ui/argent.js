// ============================================================
// js/ui/argent.js – Page "Ce mois" : Saisie mensuelle + Budgets
// ============================================================

import * as saisieModule  from './saisie.js';
import * as chargesModule from './charges.js';
import { getActiveUsers, getMonthlyData, getChargesForMonth,
         getBudgetOpsForMonth }                               from '../db.js';
import { State }                                              from '../app.js';
import { nomMois }                                            from '../utils.js';
import { on }                                                 from '../events.js';

// tabs: saisie | budgets
let _arTab = 'saisie';

// ── Suivi de l'activité revenus (pour la barre de progression) ──
let _lastRevInput  = 0;
let _revDoneTimer  = null;

// ── Suivi des charges (pour la barre de progression) ──
let _chgValidated  = false;
let _chgHasData    = false;

// ── Persistance _chgValidated en localStorage par mois ──
function _chgKey() { const { year, month } = State; return `compta-chg-ok-${year}-${month}`; }
function _loadChgState() { _chgValidated = localStorage.getItem(_chgKey()) === '1'; }
function _saveChgState() { localStorage.setItem(_chgKey(), '1'); }

// ── Barre de progression partagée Saisie / Budgets ──
async function _renderSharedProgress(container) {
  const bar = container.querySelector('#argent-shared-progress');
  if (!bar) return;
  const { year, month } = State;
  const [users, md, charges, budgetOps] = await Promise.all([
    getActiveUsers(),
    getMonthlyData(year, month),
    getChargesForMonth(month, year),
    getBudgetOpsForMonth(year, month),
  ]);
  const hasRevData  = users.some(u => (md?.users?.[String(u.id)]?.revenus || 0) > 0);
  const isRevRecent = _lastRevInput > 0 && (Date.now() - _lastRevInput) < 3000;
  const revState  = hasRevData && !isRevRecent ? 'done'
                  : hasRevData || isRevRecent  ? 'active' : '';
  const hasChg  = charges.length > 0;
  if (hasChg) _chgHasData = true; // persistance si charges supprimées après validation
  const chgState = _chgValidated ? 'done'
                 : (_chgHasData || hasChg) ? 'active' : (revState === 'done' ? 'active' : '');
  const hasBudg = budgetOps.length > 0;
  const isDone  = md?.isComplete;

  // ── Auto-avance : quand chgState passe à 'done', basculer vers Budgets ──
  if (_chgValidated && _prevChgState !== 'done' && _arTab === 'saisie') {
    setTimeout(() => {
      if (!document.contains(container)) return;
      const tabBudgets = container.querySelector('[data-artab="budgets"]');
      if (tabBudgets && _arTab !== 'budgets') tabBudgets.click();
    }, 200);
  }
  _prevChgState = chgState;
  const states = [
    revState,
    chgState,
    hasBudg ? 'done' : (_arTab === 'budgets' ? 'active' : (chgState === 'done' ? 'active' : '')),
    isDone  ? 'done' : '',
  ];
  const texts = [states[0] === 'done' ? '✓' : '1', chgState === 'done' ? '✓' : '2', hasBudg ? '✓' : '3', isDone ? '✓' : '4'];
  const labels = ['Revenus', 'Charges', 'Budgets', 'Valider'];
  bar.innerHTML = `<div class="saisie-progress" id="saisie-progress-bar">
    ${states.map((s, i) => `
      <button type="button" class="saisie-prog-step ${s} saisie-prog-global-nav" data-prog-idx="${i}" style="background:none;border:none;cursor:pointer;">
        <div class="saisie-prog-dot ${s}">${texts[i]}</div>
        <div class="saisie-prog-label">${labels[i]}${i === 2 ? '<span style="display:block;font-size:0.58rem;color:var(--text-3);font-weight:400;">optionnel</span>' : ''}</div>
      </button>`).join('')}
  </div>`;
  bar.querySelectorAll('.saisie-prog-global-nav').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = Number(btn.dataset.progIdx);
      const tabSaisie  = container.querySelector('[data-artab="saisie"]');
      const tabBudgets = container.querySelector('[data-artab="budgets"]');
      if (idx === 0 || idx === 1 || idx === 3) {
        // Basculer sur Saisie mensuelle
        if (tabSaisie) { tabSaisie.click(); }
        // Puis ouvrir le bon accordéon (avec léger délai pour le render)
        const targets = ['accord-revenus', 'accord-charges', null, 'accord-recap'];
        const target = targets[idx];
        if (target) {
          setTimeout(() => {
            const body = container.querySelector('#argent-body');
            ['accord-revenus', 'accord-charges', 'accord-recap'].forEach(id => {
              const el = body?.querySelector(`#${id}`);
              if (el) el.removeAttribute('open');
            });
            const targetEl = body?.querySelector(`#${target}`);
            if (targetEl) { targetEl.setAttribute('open', ''); targetEl.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
          }, 80);
        }
      } else {
        // idx === 2 → Budgets
        if (tabBudgets) tabBudgets.click();
      }
    });
  });
}

// ── Observation des champs revenus pour la barre de progression ──
function _watchSaisieInputs(container) {
  const body = container.querySelector('#argent-body');
  if (!body) return;
  body.querySelectorAll('input[id^="rev-"]').forEach(input => {
    if (input.dataset.progressWatched) return;
    input.dataset.progressWatched = '1';
    input.addEventListener('input', () => {
      _lastRevInput = Date.now();
      _renderSharedProgress(container);
      if (_revDoneTimer) clearTimeout(_revDoneTimer);
      _revDoneTimer = setTimeout(() => {
        _renderSharedProgress(container);
      }, 3000);
    });
  });
}

// ── Gestion des événements charges ──
let _chgUnsubscribe = null;
let _prevChgState   = '';
function _subscribeChargesUpdated(container) {
  if (_chgUnsubscribe) _chgUnsubscribe();
  const unsub1 = on('charges:updated', () => {
    if (!document.contains(container)) { unsub1(); unsub2(); _chgUnsubscribe = null; return; }
    _chgHasData = true;
    _renderSharedProgress(container);
  });
  const unsub2 = on('charges:validated', () => {
    if (!document.contains(container)) { unsub1(); unsub2(); _chgUnsubscribe = null; return; }
    _chgValidated = true;
    _renderSharedProgress(container);
  });
  _chgUnsubscribe = () => { unsub1(); unsub2(); };
}

export async function render(container, params = {}) {
  if (params.tab) _arTab = params.tab;
  // Guard: anciens noms de tabs
  if (['saisir', 'epargne', 'recurrentes', 'charges'].includes(_arTab)) _arTab = 'saisie';
  if (_arTab === 'depenses') _arTab = 'budgets';

  // Réinitialiser l'état charges au changement de mois
  _loadChgState();
  _chgHasData   = _chgValidated; // si déjà validé, hasData aussi
  _prevChgState = '';

  const { year, month } = State;
  container.innerHTML = `
    <div id="argent-shared-progress"></div>
    <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px;">
      <div class="tabs" id="argent-tabs" style="margin-bottom:0;flex:1;">
        <button class="tab-btn ${_arTab === 'saisie'   ? 'active' : ''}" data-artab="saisie">📝 Saisie mensuelle</button>
        <button class="tab-btn ${_arTab === 'budgets'  ? 'active' : ''}" data-artab="budgets">📊 Budgets</button>
      </div>
      <button id="argent-btn-complete" class="btn btn-primary btn-sm" style="white-space:nowrap;flex-shrink:0;display:flex;align-items:center;gap:5px;">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="14" height="14"><path d="M20 6L9 17l-5-5"/></svg>
        Valider le mois
      </button>
    </div>
    <div id="argent-body" style="margin-top:0;"></div>
  `;

  _renderSharedProgress(container);

  // ── Bouton "Valider le mois" ──
  const btnComplete = container.querySelector('#argent-btn-complete');
  if (btnComplete) {
    const refreshCompleteBtn = async () => {
      const { year, month } = State;
      const db = await import('../db.js');
      const mdNow = await db.getMonthlyData(year, month);
      const isDone = mdNow?.isComplete;
      btnComplete.innerHTML = isDone
        ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="14" height="14"><path d="M20 6L9 17l-5-5"/></svg> ✅ Mois complet`
        : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="14" height="14"><path d="M20 6L9 17l-5-5"/></svg> Valider le mois`;
      btnComplete.className = 'btn btn-sm';
      btnComplete.style.cssText = isDone
        ? 'white-space:nowrap;flex-shrink:0;display:flex;align-items:center;gap:5px;color:var(--success);background:var(--success-bg);border:none;'
        : 'white-space:nowrap;flex-shrink:0;display:flex;align-items:center;gap:5px;background:var(--primary);color:#fff;border:none;';
    };
    refreshCompleteBtn();
    btnComplete.addEventListener('click', async () => {
      const { year, month } = State;
      const db = await import('../db.js');
      const mdNow = await db.getMonthlyData(year, month);
      if (mdNow?.isComplete) {
        mdNow.isComplete = false;
        await db.saveMonthlyData(mdNow);
        const { showToast } = await import('../utils.js');
        showToast('Mois marqué comme en cours', 'success');
        _chgValidated = false;
        localStorage.removeItem(_chgKey());
        _prevChgState = '';
        _renderSharedProgress(container);
        refreshCompleteBtn();
        return;
      }
      // Valider toutes les étapes + déclencher wizard
      _chgValidated = true;
      _saveChgState();
      _chgHasData = true;
      _renderSharedProgress(container);
      // Basculer sur saisie pour le wizard
      if (_arTab !== 'saisie') {
        const tabSaisie = container.querySelector('[data-artab="saisie"]');
        if (tabSaisie) tabSaisie.click();
        await new Promise(r => setTimeout(r, 250));
      }
      const { emit: emitEv } = await import('../events.js');
      emitEv('month:complete');
      const unsub = on('month:complete:done', () => {
        unsub();
        refreshCompleteBtn();
        _renderSharedProgress(container);
      });
    });
  }
    const body = container.querySelector('#argent-body');
    if (!body) return;
    if (_arTab === 'saisie')   saisieModule.render(body);
    else                       chargesModule.renderSection(body, 'budgets');
    // Rafraîchir la barre + attacher les watchers après rendu de l'onglet
    setTimeout(() => {
      _renderSharedProgress(container);
      if (_arTab === 'saisie') {
        _watchSaisieInputs(container);
        _subscribeChargesUpdated(container);
      }
    }, 200);
  };

  container.querySelectorAll('#argent-tabs .tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      container.querySelectorAll('#argent-tabs .tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      _arTab = btn.dataset.artab;
      renderTab();
    });
  });

  renderTab();
}

