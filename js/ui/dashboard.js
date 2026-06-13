// ============================================================
// js/ui/dashboard.js – Tableau de bord
// ============================================================

import { State, navigateTo }                              from '../app.js';
import { getMonthlyData, getChargesForMonth,
         getAchatsForMonth, getAllAchats, getRepartition, getAllRepartitions,
         getAllSettings, getMonthsByYear,
         computeCurrentSavingsBalance,
         getAllSavingsOperations, saveSavingsOperation,
         deleteSavingsOperation, getAllSavingsConfirmed,
         getAllCharges, getAllBudgetOps,
         getBudgetOpsForMonth, saveBudgetOp,
         getActiveUsers, setSetting }                                  from '../db.js';
import { calcMonth, calcPrevisionnel, calcBudgetScore } from '../calculs.js';
import { eur, pct, nomMois, addMonth, signClass,
         txEparClass, completenessStatus, MOIS,
         progressColor, escHtml, showToast, showToastWithUndo,
         openModal, closeModal }                          from '../utils.js';
import { showCraquageModal }                              from './saisie.js';
import { showEditBudgetModal, showAchatModal }             from './charges.js';
import { on }                                             from '../events.js';

let _activeTab = 'resume';
let _detailMode = 'reel'; // 'reel' | 'previsionnel'

// ── Phrase narrative contextuelle (1 ligne) ──
function _buildNarrative(kpi, s, daysLeft, isCurrentMonth) {
  const parts = [];
  const tx = kpi.txEpargne?.total ?? 0;
  const solde = kpi.solde.total;
  if (isCurrentMonth && daysLeft > 0 && solde < 0) {
    parts.push(`<strong style="color:var(--danger);">Budget dépassé</strong> de ${eur(Math.abs(solde))}`);
  }

  const cibles = s.budgetCibles || {};
  const budgC  = Number(cibles.courses) || 0;
  if (budgC > 0 && kpi.courses.total > budgC * 0.8) {
    const over = kpi.courses.total > budgC;
    parts.push(`<span style="color:var(--${over ? 'danger' : 'warning'});">Courses à ${Math.round(kpi.courses.total / budgC * 100)} %</span>`);
  }

  if (tx < 0) parts.push(`<span style="color:var(--danger);">\uD83D\uDD34 Déficit</span>`);

  return parts.join(' · ');
}

export async function render(container) {
  const [s, users] = await Promise.all([getAllSettings(), getActiveUsers()]);
  const { year, month } = State;

  container.innerHTML = `
    <!-- Navigation mois -->
    <div class="month-nav" id="dash-month-nav" style="margin-bottom:12px;">
      <button class="month-btn" id="prev-month" aria-label="Mois précédent">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M15 18l-6-6 6-6"/></svg>
      </button>
      <button id="month-picker-btn" style="text-align:center;background:transparent;border:none;cursor:pointer;padding:4px 8px;border-radius:8px;transition:background .15s;" title="Sélectionner un mois">
        <div class="month-nav-label" style="pointer-events:none;">${nomMois(month)}</div>
        <div class="month-nav-year" style="pointer-events:none;">${year} ▾</div>
      </button>
      <button class="month-btn" id="next-month" aria-label="Mois suivant">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M9 18l6-6-6-6"/></svg>
      </button>
    </div>

    <!-- Onglets supprimés en V2 – le prévisionnel vit dans Historique -->
    <div id="dash-content"></div>
  `;

  container.querySelector('#prev-month')?.addEventListener('click', () => {
    const n = addMonth(State.year, State.month, -1);
    State.year = n.year; State.month = n.month;
    render(container);
  });
  container.querySelector('#next-month')?.addEventListener('click', () => {
    const n = addMonth(State.year, State.month, 1);
    State.year = n.year; State.month = n.month;
    render(container);
  });

  // ── Sélecteur rapide de mois ──
  container.querySelector('#month-picker-btn')?.addEventListener('click', async () => {
    const allMonths = await getMonthsByYear();
    // Construire une liste des 24 derniers mois + mois courant
    const months = [];
    let cy = State.year, cm = State.month;
    for (let i = 0; i < 24; i++) {
      months.unshift({ year: cy, month: cm });
      const prev = addMonth(cy, cm, -1);
      cy = prev.year; cm = prev.month;
    }
    const completedSet = new Set((allMonths.flat ? allMonths : Object.values(allMonths).flat()).map(m => `${m.year}-${m.month}`));
    const rows = months.map(m => {
      const key = `${m.year}-${m.month}`;
      const hasData = completedSet.has(key);
      const isCurrent = m.year === State.year && m.month === State.month;
      return `<button class="btn ${isCurrent ? 'btn-primary' : 'btn-outline'} month-pick-item"
        data-y="${m.year}" data-m="${m.month}"
        style="padding:8px 12px;font-size:0.82rem;text-align:left;justify-content:space-between;display:flex;gap:8px;">
        <span>${nomMois(m.month)} ${m.year}</span>
        <span style="font-size:0.72rem;opacity:0.6;">${hasData ? '📄' : '○'}</span>
      </button>`;
    }).reverse().join('');
    openModal('📅 Choisir un mois',
      `<div style="display:flex;flex-direction:column;gap:4px;max-height:60vh;overflow-y:auto;">${rows}</div>`,
      ''
    );
    document.querySelectorAll('.month-pick-item').forEach(btn => {
      btn.addEventListener('click', () => {
        State.year  = parseInt(btn.dataset.y);
        State.month = parseInt(btn.dataset.m);
        closeModal();
        render(container);
      });
    });
  });


  await _renderResume(container, s, users);
}

async function _renderContent(container, s, users) {
  await _renderResume(container, s, users);
}

// ══════════════════════════════════════════════════
// ONGLET RÉSUMÉ
// ══════════════════════════════════════════════════
async function _renderResume(container, s, users) {
  const { year, month } = State;

  const customBudgets = s.customBudgets || [];
  const pinnedBudgets = s.pinnedBudgets || [];

  const [md, charges, achats, repCfg, savInfo, allSavOps, allBudgetOps, allAchats] = await Promise.all([
    getMonthlyData(year, month),
    getChargesForMonth(month, year),
    getAchatsForMonth(year, month),
    getRepartition(year, month),
    computeCurrentSavingsBalance(),
    getAllSavingsOperations(),
    getBudgetOpsForMonth(year, month),
    getAllAchats(),
  ]);

  const pendingCraquages = allAchats.filter(a => a.category === 'craquage' && a.craquage_source === 'pending');

  const kpi    = calcMonth(md, charges, achats, repCfg, users, allBudgetOps);
  const kpiPrev = calcMonth(md, charges, achats, repCfg, users); // sans budgetOps = plafonds budgets
  // Courses / extras confirmés (depuis les budget_ops réels, pas les plafonds)
  const realCourses = { total: 0, byUser: {} };
  const realExtras  = { total: 0, byUser: {} };
  for (const op of allBudgetOps) {
    const uid = String(op.userId || '');
    const amt = Number(op.amount) || 0;
    if (op.category === 'courses') { realCourses.total += amt; realCourses.byUser[uid] = (realCourses.byUser[uid] || 0) + amt; }
    else if (op.category === 'extras')  { realExtras.total  += amt; realExtras.byUser[uid]  = (realExtras.byUser[uid]  || 0) + amt; }
  }
  const status = completenessStatus(md);

  // ── Charges réelles : filtrer les charges dont le jour de passage est passé ──
  // (pour le mode réel uniquement – si mois courant, exclure les charges futures)
  const { year: _cy, month: _cm, day: _cday } = (() => { const t = new Date(); return { year: t.getFullYear(), month: t.getMonth()+1, day: t.getDate() }; })();
  const _isCurrentMonth = (year === _cy && month === _cm);
  const chargesReel = _isCurrentMonth
    ? charges.map(chg => {
        if (!chg.lines || chg.lines.length === 0) {
          // Single-line charge
          if (chg.dayOfMonth && Number(chg.dayOfMonth) > _cday) return null; // not yet
          return chg;
        }
        // Multi-line charge: filter lines by dayOfMonth
        const passedLines = chg.lines.filter(l => !l.dayOfMonth || Number(l.dayOfMonth) <= _cday);
        if (passedLines.length === 0) return null;
        return { ...chg, lines: passedLines };
      }).filter(Boolean)
    : charges; // past months: all charges count

  const kpiReel = calcMonth(md, chargesReel, achats, repCfg, users, allBudgetOps);

  // Pinned budget cards data
  const budgCourses  = users.reduce((acc, u) => acc + (Number(md?.users?.[String(u.id)]?.courses) || 0), 0) || (Number(s.budgetCibles?.courses) || 0);
  const budgExtras   = users.reduce((acc, u) => acc + (Number(md?.users?.[String(u.id)]?.extras)  || 0), 0) || (Number(s.budgetCibles?.extras)  || 0);
  const spentCourses = allBudgetOps.filter(o => o.category === 'courses').reduce((a, o) => a + (Number(o.amount)||0), 0);
  const spentExtras  = allBudgetOps.filter(o => o.category === 'extras').reduce((a, o) => a + (Number(o.amount)||0), 0);

  const pinnedCards = pinnedBudgets.map(pid => {
    if (pid === 'courses') return { id:'courses', icon:'🛒', label:'Courses', budget:budgCourses, spent:spentCourses };
    if (pid === 'extras')  return { id:'extras',  icon:'🎮', label:'Loisirs',  budget:budgExtras,  spent:spentExtras  };
    const cb = customBudgets.find(b => b.id === pid);
    if (!cb) return null;
    const spentCustom = allBudgetOps.filter(o => o.category === pid).reduce((a, o) => a + (Number(o.amount)||0), 0);
    return { id:pid, icon:cb.icon||'📌', label:cb.name, budget:Number(cb.amount)||0, spent:spentCustom };
  }).filter(Boolean);

  const goal     = Number(s.savingsGoal) || 0;
  const goalYear = s.savingsGoalYear ?? year;
  let epargneYTD = 0;

  if (goal > 0 && goalYear === year) {
    const allMonths = await getMonthsByYear(year);
    // Pré-charger tout en mémoire pour éviter N×4 requêtes IDB
    const [allChargesYTD, allAchatsYTD, allRepsYTD, allBopsYTD] = await Promise.all([
      getAllCharges(), getAllAchats(), getAllRepartitions(), getAllBudgetOps(),
    ]);
    const ytdValues = allMonths.map(m => {
      const mChg  = allChargesYTD.filter(c => {
        const ms = Array.isArray(c.months) ? c.months : (c.months === 'all' ? null : []);
        return ms === null || ms.includes(m.month);
      });
      const mAch  = allAchatsYTD.filter(a => a.year === year && a.month === m.month);
      const mRep  = allRepsYTD.find(r => r.year === year && r.month === m.month) ?? {};
      const mBops = allBopsYTD.filter(b => b.year === year && b.month === m.month);
      return calcMonth(m, mChg, mAch, mRep, users, mBops).solde.total;
    });
    epargneYTD = ytdValues.reduce((s, v) => s + v, 0);
  }
  const goalPct   = goal > 0 ? Math.min(200, Math.round((epargneYTD / goal) * 100)) : 0;
  const pBarColor = progressColor(goalPct);

  // ── Épargne réelle = ops du mois en cours (versements/retraits) ──
  const monthlySavOps = allSavOps.filter(op => op.year === year && op.month === month);
  const realSavings   = monthlySavOps.reduce((s, op) => s + (Number(op.amount) || 0), 0);
  const savingsByUser = users.map(u => {
    const uOps = monthlySavOps.filter(op => String(op.userId) === String(u.id));
    return [u.name, uOps.reduce((s, op) => s + (Number(op.amount) || 0), 0)];
  });

  const badgeClass = { done: 'done', partial: 'partial', empty: 'empty' }[status];
  const badgeIcon  = status === 'done'
    ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" width="12" height="12"><path d="M20 6L9 17l-5-5"/></svg>`
    : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><circle cx="12" cy="12" r="10"/><path d="M12 8v4l3 3"/></svg>`;
  const badgeText  = { done: 'Complet', partial: 'En cours', empty: 'Non rempli' }[status];

  const soldeColor = kpi.solde.total >= 0 ? 'var(--success)' : 'var(--danger)';
  const txColor    = kpi.txEpargne.total >= 0.10 ? 'var(--success)' : kpi.txEpargne.total >= 0 ? 'var(--warning)' : 'var(--danger)';

  // ── Score budgétaire (mini ring) — BM-1 : source unique de vérité via calcBudgetScore ──
  const { total: score, scoreHex, criteria: _scoreCriteria } = calcBudgetScore(kpi, s);
  const _tx    = kpi.txEpargne?.total ?? 0;
  const _budgC = Number((s.budgetCibles || {}).courses) || 0;
  const _budgE = Number((s.budgetCibles || {}).extras)  || 0;
  const sR = 22, sCirc = 2 * Math.PI * sR;
  const sOffset   = sCirc - (score / 100) * sCirc;

  // ── Budget journalier restant ──
  const _today     = new Date();
  const _daysLeft  = _isCurrentMonth
    ? (new Date(year, month, 0).getDate() - _today.getDate() + 1)
    : new Date(year, month, 0).getDate();

  // ── Détection premier lancement : mois vide + pas encore de charges ni de budget ──
  const isFirstUse = status === 'empty' && charges.length === 0 && allBudgetOps.length === 0
    && users.every(u => {
      const ud = md?.users?.[String(u.id)];
      return !ud || (!(ud.revenus) && !(ud.primes) && !(ud.aides));
    });

  // ── Guide d'initialisation (persiste jusqu'aux 4 étapes complètes) ──
  const allSavConfirmed = await getAllSavingsConfirmed();
  // Chaque étape se valide uniquement sur la donnée réelle, SAUF si le mois est validé
  // (les 3 premières étapes sont considérées faites quand on valide le mois)
  const monthComplete = md?.isComplete === true;
  const guideDone1   = monthComplete || users.some(u => (md?.users?.[String(u.id)]?.revenus || 0) > 0);
  const guideDone2   = monthComplete || charges.length > 0;
  const guideDoneOpt = monthComplete || allBudgetOps.length > 0;
  // Étape 4 (épargne) : jamais forcée par le mois, doit être confirmée indépendamment
  const guideDone3   = allSavConfirmed.length > 0;
  // Bravo uniquement quand les 4 étapes sont toutes validées
  const allGuideDone = guideDone1 && guideDone2 && guideDoneOpt && guideDone3;
  // localStorage seulement pour mémoriser le clic sur "Découvrir" (jamais auto)
  const guideDismissed = localStorage.getItem('compta-guide-dismissed') === '1';
  const showBravo = allGuideDone && !guideDismissed;

  const el = container.querySelector('#dash-content');

  // ── Guide en cours : seule la guide card visible jusqu'aux 3 étapes ──
  if (!guideDismissed && !allGuideDone) {
    el.innerHTML = `
    <div class="guide-card">
      <div style="font-size:1.5rem;margin-bottom:8px;">👋</div>
      <div class="guide-card-title">Bienvenue sur Compta+ !</div>
      <div class="guide-card-sub">Voici comment démarrer en 4 étapes :</div>
      <div class="guide-steps-list">
        <button class="guide-step ${guideDone1 ? 'done' : ''}" id="gs-step1" type="button">
          <div class="guide-step-num ${guideDone1 ? 'done' : ''}">${guideDone1 ? '✓' : '1'}</div>
          <div class="guide-step-body">
            <div class="guide-step-title">💰 Saisir les revenus</div>
            <div class="guide-step-sub">${guideDone1 ? 'Revenus renseignés ✓' : 'Renseignez vos revenus et charges de ce mois'}</div>
          </div>
          ${!guideDone1 ? '<span class="guide-step-arrow">›</span>' : ''}
        </button>
        <button class="guide-step ${guideDone2 ? 'done' : ''}" id="gs-step2" type="button">
          <div class="guide-step-num ${guideDone2 ? 'done' : ''}">${guideDone2 ? '✓' : '2'}</div>
          <div class="guide-step-body">
            <div class="guide-step-title">📋 Saisir les charges du mois</div>
            <div class="guide-step-sub">${guideDone2 ? 'Charges importées ✓' : 'Importez ou ajoutez les dépenses fixes du mois (loyer, EDF, abonnements…)'}</div>
          </div>
          ${!guideDone2 ? '<span class="guide-step-arrow">›</span>' : ''}
        </button>
        <button class="guide-step ${guideDoneOpt ? 'done' : ''}" id="gs-step-opt" type="button">
          <div class="guide-step-num ${guideDoneOpt ? 'done' : ''}">${guideDoneOpt ? '✓' : '3'}</div>
          <div class="guide-step-body">
            <div class="guide-step-title">📊 Configurer vos budgets <span style="font-size:0.72rem;font-weight:400;color:var(--text-3);">(optionnel)</span></div>
            <div class="guide-step-sub">${guideDoneOpt ? 'Budgets configurés ✓' : 'Définissez vos enveloppes de dépenses : courses, loisirs, sorties…'}</div>
          </div>
          ${!guideDoneOpt ? '<span class="guide-step-arrow">›</span>' : ''}
        </button>
        <button class="guide-step ${guideDone3 ? 'done' : ''}" id="gs-step3" type="button">
          <div class="guide-step-num ${guideDone3 ? 'done' : ''}">${guideDone3 ? '✓' : '4'}</div>
          <div class="guide-step-body">
            <div class="guide-step-title">🏦 Déclarer votre épargne</div>
            <div class="guide-step-sub">${guideDone3 ? 'Épargne déclarée ✓' : 'Confirmez votre solde épargne actuel pour commencer le suivi'}</div>
          </div>
          ${!guideDone3 ? '<span class="guide-step-arrow">›</span>' : ''}
        </button>
      </div>
    </div>`;
    if (!guideDone1)   el.querySelector('#gs-step1')?.addEventListener('click', () => navigateTo('argent', { tab: 'saisie', section: 'revenus' }));
    if (!guideDone2)   el.querySelector('#gs-step2')?.addEventListener('click', () => navigateTo('argent', { tab: 'saisie', section: 'charges' }));
    if (!guideDoneOpt) el.querySelector('#gs-step-opt')?.addEventListener('click', () => navigateTo('argent', { tab: 'budgets' }));
    if (!guideDone3)   el.querySelector('#gs-step3')?.addEventListener('click', () => navigateTo('savings'));
    return;
  }

  // ── Configuration complète : carte Bravo seule, dashboard masqué jusqu'au clic ──
  if (showBravo) {
    el.innerHTML = `
    <div class="guide-card" style="border-left:3px solid var(--success);">
      <div style="font-size:2rem;margin-bottom:8px;">🎉</div>
      <div class="guide-card-title" style="color:var(--success);">Configuration complète !</div>
      <div class="guide-card-sub" style="line-height:1.65;margin-top:6px;">
        Bravo — vos revenus, vos budgets et votre épargne sont bien renseignés.<br><br>
        Compta+ peut maintenant vous offrir un suivi fiable et personnalisé de vos finances.
        Pour en tirer le meilleur parti, revenez chaque mois mettre à jour votre saisie mensuelle :
        vous bénéficierez d'un historique précis, de projections budgétaires et de conseils
        adaptés à votre situation réelle.
      </div>
      <button class="btn btn-sm btn-primary" id="btn-bravo-dismiss" style="margin-top:14px;font-size:0.82rem;padding:9px 20px;">Découvrir mon tableau de bord →</button>
    </div>`;
    el.querySelector('#btn-bravo-dismiss').addEventListener('click', async () => {
      localStorage.setItem('compta-guide-dismissed', '1');
      await _renderResume(container, s, users);
    });
    return;
  }

  el.innerHTML = `
    <!-- ── HERO compact + score ring ── -->
    <div class="hero-card" style="margin-bottom:12px;">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;">
        <div style="flex:1;min-width:0;">
          <div class="hero-label">Solde de ${nomMois(month)} ${year}</div>
          <div class="hero-amount" style="color:${soldeColor};">${isFirstUse ? '<span style="font-size:0.82rem;font-weight:600;color:var(--text-3);">Complétez votre saisie pour voir ce chiffre →</span>' : eur(kpi.solde.total)}</div>
          <div class="hero-meta">
            <span>${eur(kpi.revenus.total + (kpi.aides?.total ?? 0))} revenus</span>
            <span style="color:var(--text-3);"> · </span>
            <span style="color:var(--danger);">${eur(kpi.depenses.total)} dépensés</span>
          </div>
          ${users.length > 1 ? `<div style="font-size:0.72rem;color:var(--text-3);margin-top:3px;">${users.map(u => `${escHtml(u.name)}: ${eur(kpi.solde.byUser?.[u.id] ?? 0)}`).join(' · ')}</div>` : ''}          ${(()=>{ const n = _buildNarrative(kpi, s, _daysLeft, _isCurrentMonth); return n ? `<div style="margin-top:7px;font-size:0.74rem;color:var(--text-2);line-height:1.5;">${n}</div>` : ''; })()}
        </div>
        <div id="dash-score-area" style="display:flex;flex-direction:column;align-items:center;gap:2px;flex-shrink:0;cursor:pointer;" title="Score budgétaire (épargne, solde, courses, loisirs) — Cliquer pour le détail">
          <svg width="58" height="58" viewBox="0 0 56 56" style="overflow:visible;cursor:help;">
            <circle cx="28" cy="28" r="${sR}" stroke-width="5" fill="none" stroke="var(--bg-2)"/>
            <circle cx="28" cy="28" r="${sR}" stroke-width="5" fill="none"
              stroke="${scoreHex}" stroke-dasharray="${sCirc.toFixed(2)}" stroke-dashoffset="${sCirc.toFixed(2)}"
              stroke-linecap="round" transform="rotate(-90 28 28)" id="mini-score-arc"/>
            <text x="28" y="33" text-anchor="middle" fill="${scoreHex}"
              style="font-family:Inter,sans-serif;font-size:13px;font-weight:900;">${score}</text>
          </svg>
          <div style="font-size:0.68rem;font-weight:700;color:var(--text-3);text-transform:uppercase;letter-spacing:0.06em;">Santé budget</div>
          <div style="font-size:0.6rem;color:var(--text-3);margin-top:1px;">↗ détail</div>
        </div>
      </div>
      <div style="display:flex;align-items:center;justify-content:space-between;margin-top:10px;gap:8px;">
        <span class="completeness-badge ${badgeClass}">${badgeIcon} ${badgeText}</span>
        ${kpi.primes.total > 0 ? `<span class="chip warning" style="font-size:0.68rem;">+${eur(kpi.primes.total)} primes</span>` : ''}
      </div>
    </div>

    <!-- ── CTAs adaptatifs ── -->
    <div id="dash-cta-area" style="margin-bottom:8px;">
      ${status === 'empty'
        ? `<button class="btn btn-primary" id="btn-go-saisie" style="width:100%;font-size:0.84rem;padding:13px;white-space:normal;text-align:center;">✏️ Commencer ma saisie du mois →</button>`
        : status === 'partial'
          ? `<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
              <button class="btn btn-primary" id="btn-go-saisie" style="grid-column:1/-1;font-size:0.82rem;padding:11px;white-space:normal;text-align:center;">✏️ Continuer la saisie mensuelle</button>
              <button class="btn btn-outline" id="btn-go-craquage" style="font-size:0.82rem;padding:11px;">💸 Craquage et Dépassement</button>
              <button class="btn btn-outline" id="btn-add-achat" style="font-size:0.82rem;padding:11px;">💳 Dépense ponctuelle</button>
            </div>`
          : `<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
              <button class="btn btn-outline" id="btn-go-craquage" style="font-size:0.82rem;padding:11px;">💸 Craquage et Dépassement</button>
              <button class="btn btn-outline" id="btn-add-achat" style="font-size:0.82rem;padding:11px;">💳 Dépense ponctuelle</button>
            </div>`
    </div>

    <!-- ── Suivi budgets épinglés ── -->
    ${(() => {
      const availableToPinIds = customBudgets.map(b=>b.id).filter(id=>!pinnedBudgets.includes(id));
      const canAddMore = pinnedCards.length < 4;
      const allItems = [...pinnedCards, ...(canAddMore ? [{ type:'add' }] : [])];
      if (!allItems.length) return '<div style="margin-bottom:12px;"></div>';
      const gridCols = Math.min(allItems.length, 2);
      return `<div style="display:grid;grid-template-columns:repeat(${gridCols},1fr);gap:8px;margin-top:12px;margin-bottom:12px;align-items:stretch;">
        ${allItems.map(c => {
          if (c.type === 'add') return `<div class="card dash-pin-add" style="padding:12px;box-sizing:border-box;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;cursor:pointer;min-height:80px;border:1.5px dashed var(--border);">
            <div style="width:30px;height:30px;border-radius:50%;background:var(--primary-bg);display:flex;align-items:center;justify-content:center;font-size:1.2rem;color:var(--primary);font-weight:700;">+</div>
            <div style="font-size:0.72rem;color:var(--text-3);text-align:center;">Épingler</div>
          </div>`;
          const pBar = c.budget > 0 ? (c.spent/c.budget >= 1 ? 'danger' : c.spent/c.budget >= 0.8 ? 'warning' : 'success') : 'success';
          const pct  = c.budget > 0 ? Math.min(100, Math.round(c.spent/c.budget*100)) : 0;
          return `<div class="card" style="padding:12px;box-sizing:border-box;position:relative;" data-quickadd-cat="${escHtml(c.id)}" data-quickadd-label="${escHtml(c.label)}">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
              <div style="font-size:0.72rem;font-weight:600;color:var(--text-3);">${c.icon} ${escHtml(c.label)}</div>
              <div style="display:flex;gap:2px;align-items:center;">
                <button class="btn-icon dash-unpin-card" data-pid="${escHtml(c.id)}" title="Désépingler" style="width:22px;height:22px;font-size:0.7rem;color:var(--primary);">📌</button>
                <button class="btn btn-sm btn-primary btn-quickadd" data-qcat="${escHtml(c.id)}" data-qlabel="${escHtml(c.icon+' '+c.label)}" style="padding:2px 8px;font-size:0.7rem;line-height:1.4;">+</button>
              </div>
            </div>
            <div class="progress-track" style="height:6px;margin-bottom:6px;"><div class="progress-bar ${pBar}" style="width:${pct}%;"></div></div>
            <div style="display:flex;justify-content:space-between;font-size:0.75rem;">
              <span style="color:var(--${pBar});">${eur(c.spent)} dépensé</span>
              <span style="color:var(--text-3);">/ ${eur(c.budget)}</span>
            </div>
            ${(c.budget > 0 && c.spent > c.budget) ? `<div style="font-size:0.7rem;color:var(--danger);margin-top:3px;">⚠️ +${eur(c.spent - c.budget)}</div>` : ''}
          </div>`;
        }).join('')}
      </div>`;
    })()}

    <!-- ── Détail mensuel (accordéon) ── -->
    ${(() => {
      const buildDashDetailTable = (isReel) => {
        const dk = isReel ? kpiReel : kpiPrev;
        const courses = isReel ? realCourses.total : kpiPrev.courses?.total || 0;
        const extras  = isReel ? realExtras.total  : kpiPrev.extras?.total  || 0;
        const uCols   = users.length > 1;
        const hdr = uCols ? users.map(u => `<th style="text-align:right"><span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:${escHtml(u.color||'#7C5CFC')};margin-right:3px;"></span>${escHtml(u.name)}</th>`).join('') : '';
        const bRow = (label, cat) => {
          if (!cat) return '';
          const uc = uCols ? users.map(u => `<td style="text-align:right">${eur(cat.byUser?.[u.id]??0)}</td>`).join('') : '';
          return `<tr><td>${label}</td>${uc}<td style="text-align:right">${eur(cat.total)}</td></tr>`;
        };
        const sTotal = dk.solde?.total ?? 0;
        return `<table class="data-table" style="width:100%;">
          <thead><tr><th>Catégorie</th>${hdr}<th style="text-align:right">Total</th></tr></thead>
          <tbody>
            ${bRow('Revenus &amp; Aides', { total:(dk.revenus?.total||0)+(dk.aides?.total||0), byUser: uCols?Object.fromEntries(users.map(u=>[u.id,(dk.revenus?.byUser?.[u.id]??0)+(dk.aides?.byUser?.[u.id]??0)])):{}  })}
            ${(dk.primes?.total??0)>0 ? bRow('Primes', dk.primes) : ''}
            ${bRow('Charges', dk.charges)}
            ${courses > 0 ? `<tr><td>${isReel?'Courses (confirmé)':'Budget courses'}</td>${uCols?users.map(u=>`<td style="text-align:right">${eur(dk.courses?.byUser?.[u.id]??0)}</td>`).join(''):''}<td style="text-align:right">${eur(courses)}</td></tr>` : ''}
            ${extras > 0 ? `<tr><td>${isReel?'Loisirs (confirmé)':'Budget loisirs'}</td>${uCols?users.map(u=>`<td style="text-align:right">${eur(dk.extras?.byUser?.[u.id]??0)}</td>`).join(''):''}<td style="text-align:right">${eur(extras)}</td></tr>` : ''}
            ${bRow('Dép. ponctuelles', dk.achats ?? {total:0,byUser:{}})}
            ${bRow('Imprévus', dk.imprevus ?? {total:0,byUser:{}})}
            ${customBudgets.map(b => {
              if (isReel) {
                const bOps = allBudgetOps.filter(o=>o.category===b.id);
                const spent = bOps.reduce((s,o)=>s+(Number(o.amount)||0),0);
                const bByUser = uCols ? (() => { const acc={}; for(const o of bOps){if(o.userId){const k=String(o.userId);acc[k]=(acc[k]||0)+(Number(o.amount)||0);}else{const share=(Number(o.amount)||0)/users.length;for(const u of users){const k=String(u.id);acc[k]=(acc[k]||0)+share;}}} return acc; })() : {};
                return `<tr><td>${b.icon||'📌'} ${escHtml(b.name)}</td>${uCols?users.map(u=>`<td style="text-align:right">${eur(bByUser[String(u.id)]??0)}</td>`).join(''):''}<td style="text-align:right">${eur(spent)}</td></tr>`;
              } else {
                const bgt = b.allocation==='equal'?(Number(b.amount)||0)*users.length:b.allocation==='custom'?Object.values(b.amountByUser||{}).reduce((s,v)=>s+(Number(v)||0),0):Number(b.amount)||0;
                const bByUserP = uCols ? (() => { const acc={}; if(b.allocation==='custom'){for(const u of users)acc[String(u.id)]=Number(b.amountByUser?.[u.id]??b.amountByUser?.[String(u.id)])||0;}else if(b.allocation==='equal'){for(const u of users)acc[String(u.id)]=Number(b.amount)||0;}else{const sh=users.length?bgt/users.length:bgt;for(const u of users)acc[String(u.id)]=sh;} return acc; })() : {};
                return `<tr><td>${b.icon||'📌'} ${escHtml(b.name)}</td>${uCols?users.map(u=>`<td style="text-align:right">${eur(bByUserP[String(u.id)]??0)}</td>`).join(''):''}<td style="text-align:right">${eur(bgt)}</td></tr>`;
              }
            }).join('')}
          </tbody>
          <tfoot>
            ${uCols ? `<tr class="row-total"><td>${isReel?'À payer':'À envoyer (prév.)'}</td>${users.map(u=>`<td style="text-align:right">${eur(dk.aPayer?.byUser?.[u.id]??0)}</td>`).join('')}<td style="text-align:right">${eur(dk.aPayer?.total||0)}</td></tr>` : ''}
            <tr class="row-total"><td>Solde ${isReel?'net':'prévisionnel'}</td>${uCols?users.map(u=>{const v=dk.solde?.byUser?.[u.id]??0;return`<td style="text-align:right;color:${v>=0?'var(--success)':'var(--danger)'}">${eur(v)}</td>`;}).join(''):''}<td style="text-align:right;color:${sTotal>=0?'var(--success)':'var(--danger)'}">${eur(sTotal)}</td></tr>
          </tfoot>
        </table>${!isReel?'<p style="font-size:0.72rem;color:var(--text-3);margin:8px 12px 4px;">💡 Ce calcul utilise les plafonds de budget et la répartition configurée.</p>':''}`;
      };
      return `<details class="settings-group" id="dash-detail-accord" style="margin-bottom:12px;">
        <summary class="settings-group-title">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
          📋 Détail ${nomMois(month)} ${year}
        </summary>
        <div class="settings-group-body" style="padding:0;">
          <div class="card" style="margin:0;border-radius:0 0 var(--radius) var(--radius);">
            <div class="card-header" style="flex-wrap:wrap;gap:6px;">
              <span class="card-title">📋 Détail ${escHtml(MOIS[month-1])} ${year}</span>
              <div style="margin-left:auto;display:flex;gap:4px;">
                <button class="btn btn-sm dash-dmode btn-outline" data-dmode="reel" style="font-size:0.68rem;padding:2px 8px;">✅ Réel</button>
                <button class="btn btn-sm dash-dmode btn-primary" data-dmode="previsionnel" style="font-size:0.68rem;padding:2px 8px;">📅 Prévisionnel</button>
              </div>
            </div>
            <p id="dash-detail-hint" style="font-size:0.72rem;color:var(--text-3);margin-bottom:8px;">📅 Simulation avec tous les budgets et charges du mois configurés</p>
            <div id="dash-detail-table">${buildDashDetailTable(false)}</div>
          </div>
        </div>
      </details>`;
    })()}

    <div style="height:16px;"></div>
  `;

  // ── Animate score ring ──
  requestAnimationFrame(() => requestAnimationFrame(() => {
    const arc = el.querySelector('#mini-score-arc');
    if (arc) arc.style.strokeDashoffset = sOffset.toFixed(2);
  }));

  // ── Score : clic → modal de détail ──
  el.querySelector('#dash-score-area')?.addEventListener('click', () => {
    const rows = _scoreCriteria.map(c => {
      let hint = '';
      if (c.label === "Taux d'épargne") {
        hint = _tx >= 0.15 ? "Excellent taux d'épargne ✓" : _tx >= 0.05 ? 'Correct — viser 15 % ou plus' : _tx > 0 ? 'Faible — augmenter les virements épargne' : 'Aucune épargne ce mois';
      } else if (c.label === 'Solde du mois') {
        hint = kpi.solde.total >= 0 ? 'Solde positif ✓' : 'Réduire les dépenses ou augmenter les revenus';
      } else if (c.label === 'Charges fixes') {
        hint = c.pts === c.max ? 'Charges bien maîtrisées ✓' : c.pts > 0 ? 'Charges élevées — revoir les abonnements et postes fixes' : 'Charges très élevées — plus de 65 % des revenus';
      } else if (c.label === 'Dépenses imprévues') {
        hint = c.pts === c.max ? 'Aucune dépense imprévue ✓' : c.pts > 0 ? 'Quelques imprévus — surveiller les achats exceptionnels' : 'Imprévus importants — plus de 8 % des revenus';
      } else if (c.label === 'Budget courses') {
        hint = c.pts === c.max ? 'Dans le budget ✓' : `Dépassé de ${eur(kpi.courses.total - _budgC)} — ajuster le budget courses`;
      } else if (c.label === 'Budget loisirs') {
        hint = c.pts === c.max ? 'Dans le budget ✓' : `Dépassé de ${eur(kpi.extras.total - _budgE)} — surveiller les extras`;
      }
      return { ...c, hint };
    });
    const worstRow = [...rows].sort((a, b) => (a.pts / a.max) - (b.pts / b.max))[0];
    openModal(`🎯 Score budgétaire — ${score}/100`,
      `<div style="font-size:0.85rem;line-height:1.6;margin-bottom:16px;">
        <div style="display:flex;align-items:center;gap:10px;padding:12px;background:var(--bg-2);border-radius:var(--radius);margin-bottom:12px;">
          <svg width="44" height="44" viewBox="0 0 56 56"><circle cx="28" cy="28" r="22" stroke-width="5" fill="none" stroke="var(--border)"/><circle cx="28" cy="28" r="22" stroke-width="5" fill="none" stroke="${scoreHex}" stroke-dasharray="${sCirc.toFixed(2)}" stroke-dashoffset="${(sCirc - (score / 100) * sCirc).toFixed(2)}" stroke-linecap="round" transform="rotate(-90 28 28)"/><text x="28" y="33" text-anchor="middle" fill="${scoreHex}" style="font-family:Inter,sans-serif;font-size:13px;font-weight:900;">${score}</text></svg>
          <div><div style="font-weight:800;font-size:1.1rem;color:${scoreHex};">${score >= 75 ? 'Excellent' : score >= 50 ? 'Bien' : score >= 25 ? 'À améliorer' : 'Attention'}</div><div style="font-size:0.75rem;color:var(--text-3);">Score global du mois</div></div>
        </div>
        ${rows.map(r => `
          <div style="margin-bottom:10px;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
              <span style="font-size:0.82rem;font-weight:600;">${r.label}</span>
              <span style="font-size:0.82rem;font-weight:800;color:${r.pts === r.max ? 'var(--success)' : r.pts > 0 ? 'var(--warning)' : 'var(--danger)'};">${r.pts}/${r.max}</span>
            </div>
            <div style="height:6px;background:var(--bg-2);border-radius:99px;overflow:hidden;">
              <div style="height:100%;width:${Math.round(r.pts/r.max*100)}%;background:${r.pts === r.max ? 'var(--success)' : r.pts > 0 ? 'var(--warning)' : 'var(--danger)'};border-radius:99px;transition:width .4s;"></div>
            </div>
            <div style="font-size:0.72rem;color:var(--text-3);margin-top:3px;">${r.hint}</div>
          </div>`).join('')}
        ${score < 100 ? `<div style="background:var(--primary-bg);border-radius:var(--radius);padding:12px;margin-top:4px;font-size:0.8rem;"><strong>💡 Priorité :</strong> ${worstRow.hint}</div>` : ''}
      </div>`,
      `<button class="btn btn-primary" onclick="document.getElementById('modal-close').click()">OK</button>`
    );
  });

  el.querySelector('#btn-go-saisie')?.addEventListener('click', () => navigateTo('argent', { tab: 'saisie' }));
  el.querySelector('#btn-add-achat')?.addEventListener('click', () => {
    showAchatModal(null, async () => { await _renderResume(container, s, users); });
  });
  el.querySelector('#btn-go-analyse-detail')?.addEventListener('click', () => navigateTo('stats'));
  el.querySelector('#btn-go-craquage')?.addEventListener('click', () => {
    showCraquageModal(null, month, year, users, async () => {
      await _renderResume(container, s, users);
    });
  });

  // ── Attribuer un craquage en attente depuis l'accueil ──
  el.querySelectorAll('.dash-attrib-crq').forEach(btn => {
    btn.addEventListener('click', async () => {
      const pendingId = parseInt(btn.dataset.id);
      const label     = btn.dataset.label;
      const amount    = parseFloat(btn.dataset.amount);
      const m         = parseInt(btn.dataset.month);
      const y         = parseInt(btn.dataset.year);
      showCraquageModal(null, m, y, users, async () => { await _renderResume(container, s, users); },
        { label, amount, pendingId });
    });
  });

  // ── Quick-add sur cartes budgets épinglées ──
  el.querySelectorAll('.btn-quickadd').forEach(btn => {
    btn.addEventListener('click', async e => {
      e.stopPropagation();
      const { showBudgetOpModal } = await import('./charges.js');
      showBudgetOpModal(
        btn.dataset.qcat, btn.dataset.qlabel, year, month,
        async () => { await _renderResume(container, s, users); }
      );
    });
  });

  // ── Épingler / désépingler ──
  el.querySelectorAll('.dash-unpin-card').forEach(btn => {
    btn.addEventListener('click', async e => {
      e.stopPropagation();
      const newPinned = pinnedBudgets.filter(p => p !== btn.dataset.pid);
      await setSetting('pinnedBudgets', newPinned);
      const freshS = await getAllSettings();
      await _renderResume(container, freshS, users);
    });
  });

  el.querySelector('.dash-pin-add')?.addEventListener('click', () => {
    _showPinBudgetModal(pinnedBudgets, customBudgets, async () => {
      const freshS = await getAllSettings();
      await _renderResume(container, freshS, users);
    }, users);
  });

  // ── Toggle détail prévisionnel/réel ──
  let _dashDetailMode = 'previsionnel';
  el.querySelectorAll('.dash-dmode').forEach(btn => {
    btn.addEventListener('click', () => {
      _dashDetailMode = btn.dataset.dmode;
      el.querySelectorAll('.dash-dmode').forEach(b => {
        b.classList.toggle('btn-primary', b.dataset.dmode === _dashDetailMode);
        b.classList.toggle('btn-outline',  b.dataset.dmode !== _dashDetailMode);
      });
      const hint  = el.querySelector('#dash-detail-hint');
      const table = el.querySelector('#dash-detail-table');
      const isReel = _dashDetailMode === 'reel';
      if (hint) hint.textContent = isReel
        ? '✅ Dépenses et charges réelles constatées'
        : '📅 Simulation avec tous les budgets et charges du mois configurés';
      // Rebuild table inline (closure over kpiPrev/kpiReel/realCourses/realExtras)
      if (table) {
        const dk = isReel ? kpiReel : kpiPrev;
        const courses = isReel ? realCourses.total : (kpiPrev.courses?.total || 0);
        const extras  = isReel ? realExtras.total  : (kpiPrev.extras?.total  || 0);
        const uCols   = users.length > 1;
        const hdr = uCols ? users.map(u => `<th style="text-align:right"><span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:${escHtml(u.color||'#7C5CFC')};margin-right:3px;"></span>${escHtml(u.name)}</th>`).join('') : '';
        const bRow = (label, cat) => {
          if (!cat) return '';
          const uc = uCols ? users.map(u => `<td style="text-align:right">${eur(cat.byUser?.[u.id]??0)}</td>`).join('') : '';
          return `<tr><td>${label}</td>${uc}<td style="text-align:right">${eur(cat.total)}</td></tr>`;
        };
        const sTotal = dk.solde?.total ?? 0;
        table.innerHTML = `<table class="data-table" style="width:100%;">
          <thead><tr><th>Catégorie</th>${hdr}<th style="text-align:right">Total</th></tr></thead>
          <tbody>
            ${bRow('Revenus &amp; Aides', { total:(dk.revenus?.total||0)+(dk.aides?.total||0), byUser: uCols?Object.fromEntries(users.map(u=>[u.id,(dk.revenus?.byUser?.[u.id]??0)+(dk.aides?.byUser?.[u.id]??0)])):{}  })}
            ${(dk.primes?.total??0)>0 ? bRow('Primes', dk.primes) : ''}
            ${bRow('Charges', dk.charges)}
            ${courses > 0 ? `<tr><td>${isReel?'Courses (confirmé)':'Budget courses'}</td>${uCols?users.map(u=>`<td style="text-align:right">${eur(dk.courses?.byUser?.[u.id]??0)}</td>`).join(''):''}<td style="text-align:right">${eur(courses)}</td></tr>` : ''}
            ${extras > 0 ? `<tr><td>${isReel?'Loisirs (confirmé)':'Budget loisirs'}</td>${uCols?users.map(u=>`<td style="text-align:right">${eur(dk.extras?.byUser?.[u.id]??0)}</td>`).join(''):''}<td style="text-align:right">${eur(extras)}</td></tr>` : ''}
            ${bRow('Dép. ponctuelles', dk.achats ?? {total:0,byUser:{}})}
            ${bRow('Imprévus', dk.imprevus ?? {total:0,byUser:{}})}
            ${customBudgets.map(b => {
              if (isReel) {
                const bOps2 = allBudgetOps.filter(o=>o.category===b.id);
                const spent = bOps2.reduce((s,o)=>s+(Number(o.amount)||0),0);
                const bByUser2 = uCols ? (() => { const acc={}; for(const o of bOps2){if(o.userId){const k=String(o.userId);acc[k]=(acc[k]||0)+(Number(o.amount)||0);}else{const share=(Number(o.amount)||0)/users.length;for(const u of users){const k=String(u.id);acc[k]=(acc[k]||0)+share;}}} return acc; })() : {};
                return `<tr><td>${b.icon||'📌'} ${escHtml(b.name)}</td>${uCols?users.map(u=>`<td style="text-align:right">${eur(bByUser2[String(u.id)]??0)}</td>`).join(''):''}<td style="text-align:right">${eur(spent)}</td></tr>`;
              } else {
                const bgt2 = b.allocation==='equal'?(Number(b.amount)||0)*users.length:b.allocation==='custom'?Object.values(b.amountByUser||{}).reduce((s,v)=>s+(Number(v)||0),0):Number(b.amount)||0;
                const bByUserP2 = uCols ? (() => { const acc={}; if(b.allocation==='custom'){for(const u of users)acc[String(u.id)]=Number(b.amountByUser?.[u.id]??b.amountByUser?.[String(u.id)])||0;}else if(b.allocation==='equal'){for(const u of users)acc[String(u.id)]=Number(b.amount)||0;}else{const sh=users.length?bgt2/users.length:bgt2;for(const u of users)acc[String(u.id)]=sh;} return acc; })() : {};
                return `<tr><td>${b.icon||'📌'} ${escHtml(b.name)}</td>${uCols?users.map(u=>`<td style="text-align:right">${eur(bByUserP2[String(u.id)]??0)}</td>`).join(''):''}<td style="text-align:right">${eur(bgt2)}</td></tr>`;
              }
            }).join('')}
          </tbody>
          <tfoot>
            ${uCols ? `<tr class="row-total"><td>${isReel?'À payer':'À envoyer (prév.)'}</td>${users.map(u=>`<td style="text-align:right">${eur(dk.aPayer?.byUser?.[u.id]??0)}</td>`).join('')}<td style="text-align:right">${eur(dk.aPayer?.total||0)}</td></tr>` : ''}
            <tr class="row-total"><td>Solde ${isReel?'net':'prévisionnel'}</td>${uCols?users.map(u=>{const v=dk.solde?.byUser?.[u.id]??0;return`<td style="text-align:right;color:${v>=0?'var(--success)':'var(--danger)'}">${eur(v)}</td>`;}).join(''):''}<td style="text-align:right;color:${sTotal>=0?'var(--success)':'var(--danger)'}">${eur(sTotal)}</td></tr>
          </tfoot>
        </table>${!isReel?'<p style="font-size:0.72rem;color:var(--text-3);margin:8px 0 4px;">💡 Ce calcul utilise les plafonds de budget et la répartition configurée.</p>':''}`;
      }
    });
  });
}
// ── Modal : épingler un budget ──
function _showPinBudgetModal(currentPinned, customBudgets, onPin, users = []) {
  const available = (customBudgets || [])
    .map(b => ({ id: b.id, icon: b.icon || '📌', label: b.name }))
    .filter(b => !currentPinned.includes(b.id));

  if (!customBudgets || customBudgets.length === 0) {
    openModal('📌 Épingler un budget',
      `<div style="text-align:center;padding:20px 0;">
        <div style="font-size:2rem;margin-bottom:8px;">📌</div>
        <p style="font-size:0.84rem;color:var(--text-3);margin-bottom:4px;">Aucun budget créé pour le moment.</p>
        <p style="font-size:0.78rem;color:var(--text-3);">Créez un budget dans <strong>Ce mois → Budgets</strong> pour pouvoir l'épingler ici.</p>
        <button class="btn btn-primary" style="margin-top:16px;width:100%;" id="pin-go-budgets">⭐ Créer un budget</button>
      </div>`,
      `<button class="btn btn-outline" id="pin-modal-cancel">Fermer</button>`
    );
    document.getElementById('pin-modal-cancel')?.addEventListener('click', closeModal);
    document.getElementById('pin-go-budgets')?.addEventListener('click', async () => {
      closeModal();
      const freshS = await getAllSettings();
      const beforeIds = new Set((freshS.customBudgets || []).map(b => b.id));
      showEditBudgetModal(null, freshS.customBudgets || [], async () => {
        const afterS = await getAllSettings();
        const newBudget = (afterS.customBudgets || []).find(b => !beforeIds.has(b.id));
        if (newBudget) {
          const pinned = [...(afterS.pinnedBudgets || []), newBudget.id].slice(0, 4);
          await setSetting('pinnedBudgets', pinned);
        }
        await onPin();
      }, users);
    });
    return;
  }

  if (!available.length) {
    // Tous les budgets existants sont déjà épinglés → proposer d'en créer un nouveau
    openModal('📌 Épingler un budget',
      `<div style="text-align:center;padding:20px 0;">
        <div style="font-size:2rem;margin-bottom:8px;">✅</div>
        <p style="font-size:0.84rem;color:var(--text-3);margin-bottom:4px;">Tous vos budgets sont déjà épinglés.</p>
        <p style="font-size:0.78rem;color:var(--text-3);">Créez un nouveau budget pour l'épingler ici.</p>
        <button class="btn btn-primary" style="margin-top:16px;width:100%;" id="pin-go-budgets2">⭐ Créer un budget</button>
      </div>`,
      `<button class="btn btn-outline" id="pin-modal-cancel2">Fermer</button>`
    );
    document.getElementById('pin-modal-cancel2')?.addEventListener('click', closeModal);
    document.getElementById('pin-go-budgets2')?.addEventListener('click', async () => {
      closeModal();
      const freshS = await getAllSettings();
      const beforeIds = new Set((freshS.customBudgets || []).map(b => b.id));
      showEditBudgetModal(null, freshS.customBudgets || [], async () => {
        const afterS = await getAllSettings();
        const newBudget = (afterS.customBudgets || []).find(b => !beforeIds.has(b.id));
        if (newBudget) {
          const pinned = [...(afterS.pinnedBudgets || []), newBudget.id].slice(0, 4);
          await setSetting('pinnedBudgets', pinned);
        }
        await onPin();
      }, users);
    });
    return;
  }
  openModal('📌 Épingler un budget',
    `<p style="font-size:0.78rem;color:var(--text-3);margin-bottom:12px;">Sélectionnez un budget à afficher sur l'accueil (max 4).</p>
     <div style="display:flex;flex-direction:column;gap:8px;">
      ${available.map(b => `
        <button class="btn btn-outline dash-pin-choice" data-bid="${escHtml(b.id)}" style="text-align:left;padding:10px 14px;">
          ${b.icon} <strong>${escHtml(b.label)}</strong>
        </button>`).join('')}
    </div>`,
    `<button class="btn btn-outline" id="pin-modal-cancel">Annuler</button>`
  );
  document.getElementById('pin-modal-cancel')?.addEventListener('click', closeModal);
  document.querySelectorAll('.dash-pin-choice').forEach(btn => {
    btn.addEventListener('click', async () => {
      const newPinned = [...currentPinned, btn.dataset.bid].slice(0, 4);
      await setSetting('pinnedBudgets', newPinned);
      closeModal();
      onPin();
    });
  });
}

// ══════════════════════════════════════════════════
// ONGLET PRÉVISIONNEL
// ══════════════════════════════════════════════════
async function _renderPrevisionnel(container, s, users) {
  const { year, month } = State;

  const [md, charges, achats, budgetOps] = await Promise.all([
    getMonthlyData(year, month),
    getChargesForMonth(month, year),
    getAchatsForMonth(year, month),
    getBudgetOpsForMonth(year, month),
  ]);

  // ── Revenus totaux ──
  let totalIncome = 0;
  if (md?.users) {
    for (const u of users) {
      const ud = md.users[String(u.id)];
      if (ud) totalIncome += (Number(ud.revenus) || 0) + (Number(ud.primes) || 0);
    }
  }

  // ── Budgets saisis ──
  const totalCourses  = users.reduce((s, u) => s + (Number(md?.users?.[String(u.id)]?.courses) || 0), 0);
  const totalExtras   = users.reduce((s, u) => s + (Number(md?.users?.[String(u.id)]?.extras) || 0), 0);

  // ── Dépenses réelles par jour (achats + budgetOps + imprévus) ──
  const spentByDay = {};
  const _addSpent = (day, label, amount) => {
    const d = Number(day) || 0;
    if (!spentByDay[d]) spentByDay[d] = [];
    spentByDay[d].push({ label, amount: Number(amount) || 0 });
  };
  for (const a of achats) {
    if (a.year === year && a.month === month)
      _addSpent(a.day, '💥 ' + (a.label || a.category), Number(a.amount) || 0);
  }
  for (const op of budgetOps) {
    _addSpent(op.day, op.label || op.category, Number(op.amount) || 0);
  }
  for (const imp of (md?.imprévusList || [])) {
    _addSpent(imp.day || 0, '⚡ ' + (imp.label || 'Imprévu'), Number(imp.amount) || 0);
  }

  // ── Totaux pour les cards suivi ──
  const spentCourses    = budgetOps.filter(o => o.category === 'courses').reduce((s, o) => s + (Number(o.amount)||0), 0);
  const spentExtras     = budgetOps.filter(o => o.category === 'extras').reduce((s, o) => s + (Number(o.amount)||0), 0);
  const totalImprSpent  = (md?.imprévusList || []).reduce((s, i) => s + (Number(i.amount) || 0), 0);
  const totalAchatSpent = achats.filter(a => a.year === year && a.month === month)
                                .reduce((s, a) => s + (Number(a.amount)||0), 0);

  // ── Calcul prévisionnel (charges récurrentes seulement) ──
  const now        = new Date();
  const isCurrentM = now.getFullYear() === year && now.getMonth() + 1 === month;
  const simDay     = isCurrentM ? now.getDate() : 0;

  const { days: baseDays } = calcPrevisionnel({ totalIncome, charges, year, month, simDay, deductions: 0, weeklyGroceries: 0 });

  // Re-calculer le solde en intégrant toutes les dépenses réelles par jour
  let _prevBalance = Number(totalIncome) || 0;
  const adjustedDays = baseDays.map(d => {
    const chargesAmt = d.chargeItems.reduce((s, c) => s + c.amount, 0);
    const extraItems = spentByDay[d.day] || [];
    const extraAmt   = extraItems.reduce((s, i) => s + i.amount, 0);
    _prevBalance -= chargesAmt + extraAmt;
    return { ...d, extraItems, balance: Math.round(_prevBalance * 100) / 100 };
  });

  const timedCount = charges.filter(c => c.active && Number(c.dayOfMonth) > 0).length;
  const noTimedMsg = timedCount === 0
    ? `<div style="background:var(--warning-bg);border-radius:var(--radius-sm);padding:10px 14px;margin-bottom:12px;font-size:0.78rem;color:var(--warning);">
         ⚠️ Aucune charge n'a de <strong>date de prélèvement</strong> définie. Allez dans <strong>Charges</strong> pour les configurer.
       </div>`
    : '';

  const el = container.querySelector('#dash-content');
  el.innerHTML = `
    ${noTimedMsg}

    <!-- Suivi des budgets -->
    ${(() => {
      const cibles = s.budgetCibles || {};
      const budgCourses = totalCourses > 0 ? totalCourses : (Number(cibles.courses) || 0);
      const budgExtras  = totalExtras  > 0 ? totalExtras  : (Number(cibles.extras)  || 0);
      const budgImpr    = Number(cibles.imprevus) || 0;
      const customBudgets = s.customBudgets || [];
      const spentCustom = id => budgetOps.filter(o => o.category === id).reduce((sum, o) => sum + (Number(o.amount)||0), 0);
      const customCards = customBudgets.length > 0
        ? customBudgets.map(b => {
            const bgt = b.allocation === 'equal' ? (Number(b.amount)||0) * users.length
                      : b.allocation === 'custom' ? Object.values(b.amountByUser||{}).reduce((s,v)=>s+(Number(v)||0),0)
                      : Number(b.amount)||0;
            return _buildBudgetCard(`${b.icon||'📌'} ${b.name}`, bgt, spentCustom(b.id), 'Budget');
          })
        : [`<div class="card" id="btn-prev-add-budget" style="padding:12px;box-sizing:border-box;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;cursor:pointer;min-height:80px;">
             <div style="width:30px;height:30px;border-radius:50%;background:var(--primary-bg);display:flex;align-items:center;justify-content:center;font-size:1.2rem;color:var(--primary);font-weight:700;">+</div>
             <div style="font-size:0.72rem;color:var(--text-3);text-align:center;">Ajouter un budget</div>
           </div>`];
      const cards = [
        budgCourses > 0 ? _buildBudgetCard('🛒 Courses',      budgCourses, spentCourses,   totalCourses > 0 ? 'Saisi' : 'Cible') : '',
        budgExtras  > 0 ? _buildBudgetCard('🎮 Loisirs',       budgExtras,  spentExtras,    totalExtras  > 0 ? 'Saisi' : 'Cible') : '',
        budgImpr    > 0 ? _buildBudgetCard('⚡ Imprévus',     budgImpr,    totalImprSpent, 'Cible') : '',
        totalAchatSpent > 0 ? _buildBudgetCard('💥 Exceptionnels', 0, totalAchatSpent, 'Réalisé') : '',
        ...customCards,
      ].filter(Boolean);
      return cards.length > 0
        ? `<div style="display:grid;grid-template-columns:repeat(${Math.min(cards.length, 2)},1fr);gap:8px;margin-bottom:12px;align-items:stretch;">${cards.join('')}</div>`
        : '';
    })()}

    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
      <span class="section-label">Projection jour par jour</span>
      <span class="chip ${totalIncome > 0 ? 'primary' : 'danger'}">Base : ${eur(totalIncome)}</span>
    </div>

    ${totalIncome === 0
      ? `<div class="empty-state">
           <div class="empty-state-icon">📋</div>
           <div class="empty-state-title">Revenus non saisis</div>
           <div class="empty-state-text">Saisissez vos revenus du mois pour activer le prévisionnel.</div>
         </div>`
      : `<div class="card" style="padding:0;overflow:hidden;">
           <table class="data-table">
             <thead><tr><th>Jour</th><th>Charges &amp; dépenses</th><th style="text-align:right">Solde estimé</th></tr></thead>
             <tbody>${adjustedDays.map(d => _buildPrevDay(d)).join('')}</tbody>
           </table>
         </div>`
    }
    <div style="height:16px;"></div>
  `;

  el.querySelector('#btn-prev-add-budget')?.addEventListener('click', async () => {
    const currentCustom = (await getAllSettings()).customBudgets || [];
    showEditBudgetModal(null, currentCustom, async () => {
      const newS = await getAllSettings();
      await _renderPrevisionnel(container, newS, users);
    });
  });

}

// ── Projection "dans X mois l'objectif sera atteint" ──
async function _renderProjection(el, year, month, goal, currentBalance, users) {
  if (!el) return;
  try {
    const remaining = goal - currentBalance;
    if (remaining <= 0) {
      el.innerHTML = `<span style="color:var(--success);font-weight:700;">✅ Objectif déjà atteint !</span>`;
      return;
    }
    // Calculer la moyenne des 3 derniers mois de solde
    const months = [];
    let y = year, m = month;
    for (let i = 0; i < 3; i++) {
      const prev = addMonth(y, m, -1);
      y = prev.year; m = prev.month;
      months.push({ year: y, month: m });
    }
    const soldes = await Promise.all(months.map(async ({ year: yr, month: mo }) => {
      const [md, charges, achats, repCfg, bopsProj] = await Promise.all([
        getMonthlyData(yr, mo),
        getChargesForMonth(mo, yr),
        getAchatsForMonth(yr, mo),
        getRepartition(yr, mo),
        getBudgetOpsForMonth(yr, mo),
      ]);
      if (!md) return null;
      return calcMonth(md, charges, achats, repCfg, users, bopsProj).solde.total;
    }));
    const validSoldes = soldes.filter(s => s !== null && s > 0);
    if (!validSoldes.length) {
      el.innerHTML = `<span style="color:var(--text-3);">Pas assez d'historique pour projeter.</span>`;
      return;
    }
    const avgMonthly = validSoldes.reduce((s, v) => s + v, 0) / validSoldes.length;
    const monthsNeeded = Math.ceil(remaining / avgMonthly);
    const targetDate = new Date(year, month - 1 + monthsNeeded, 1);
    const dateStr = targetDate.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
    el.innerHTML = `📈 À ce rythme (<strong>+${eur(Math.round(avgMonthly))}/mois</strong>), objectif atteint dans <strong>${monthsNeeded} mois</strong> (${dateStr})`;
  } catch (e) {
    el.innerHTML = '';
  }
}

// ── Vue annuelle rapide ──
async function _renderAnnualQuickView(el, year, users) {
  if (!el) return;
  try {
    const allMonths = await getMonthsByYear(year);
    const monthMap  = {};
    for (const m of allMonths) monthMap[m.month] = m;

    const MONTH_LABELS = ['Jan','Fév','Mar','Avr','Mai','Jun','Jul','Aoû','Sep','Oct','Nov','Déc'];
    const now          = new Date();
    const curYear      = now.getFullYear();
    const curMonth     = now.getMonth() + 1;

    const boxes = await Promise.all(Array.from({ length: 12 }, async (_, i) => {
      const m   = i + 1;
      const md  = monthMap[m];
      const isFuture  = year > curYear || (year === curYear && m > curMonth);
      const isCurrent = year === curYear && m === curMonth;

      if (!md || isFuture) {
        const cls = isCurrent ? 'ym-box ym-current' : 'ym-box ym-empty';
        return `<div class="${cls}" title="${MONTH_LABELS[i]}"><span class="ym-label">${MONTH_LABELS[i]}</span><span class="ym-val">&mdash;</span></div>`;
      }

      const [charges, achats, repCfg, bopsAnn] = await Promise.all([
        getChargesForMonth(m, year),
        getAchatsForMonth(year, m),
        getRepartition(year, m),
        getBudgetOpsForMonth(year, m),
      ]);
      const kpi   = calcMonth(md, charges, achats, repCfg, users, bopsAnn);
      const solde = kpi.solde.total;
      const cls   = 'ym-box ' + (solde > 0 ? 'ym-ok' : solde < 0 ? 'ym-bad' : 'ym-neutral');
      return `<div class="${cls}" title="${MONTH_LABELS[i]}: ${eur(solde)}"><span class="ym-label">${MONTH_LABELS[i]}</span><span class="ym-val">${solde >= 0 ? '+' : ''}${eur(solde)}</span></div>`;
    }));

    el.innerHTML = `<div class="ym-grid">${boxes.join('')}</div>`;
  } catch (e) {
    el.innerHTML = `<p style="font-size:0.78rem;color:var(--text-3);padding:4px 0;">Impossible de charger la vue annuelle.</p>`;
  }
}

// ── Rendu du tableau Réel/Prévisionnel ──
function _fillDetailTable(el, { kpi: kpiReel, kpiPrev, realCourses, realExtras }, users) {
  const wrap = el.querySelector('#detail-table-wrap');
  const hint = el.querySelector('#detail-mode-hint');
  if (!wrap) return;
  const isReel = _detailMode === 'reel';
  const dk     = isReel ? kpiReel : kpiPrev;
  const dc     = isReel ? realCourses : kpiPrev.courses;
  const de     = isReel ? realExtras  : kpiPrev.extras;
  if (hint) hint.textContent = isReel
    ? '✅ Opérations confirmées + charges dont la date de prélèvement est passée'
    : '📅 Simulation avec tous les budgets et charges du mois configurés';
  wrap.innerHTML = `
    <table class="data-table">
      <thead>
        <tr>
          <th>Catégorie</th>
          ${users.map(u => `<th style="text-align:right"><span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:${escHtml(u.color||'#7C5CFC')};margin-right:3px;"></span>${escHtml(u.name)}</th>`).join('')}
          <th style="text-align:right">Total</th>
        </tr>
      </thead>
      <tbody>
        ${buildRow('Revenus & Aides', dk.revenus, users)}
        ${dk.aides?.total > 0 ? buildRow('Aides',       dk.aides,    users) : ''}
        ${buildRow('Primes',      dk.primes,   users)}
        ${buildRow('Charges',     dk.charges,  users)}
        ${buildRow(isReel ? 'Courses (confirmé)' : 'Budget courses', dc, users)}
        ${buildRow(isReel ? 'Loisirs (confirmé)' : 'Budget loisirs', de, users)}
        ${buildRow('Dép. ponctuelles', dk.achats,   users)}
        ${buildRow('Imprévus',    dk.imprevus, users)}
      </tbody>
      <tfoot>
        <tr class="row-total">
          <td>${isReel ? 'À payer' : 'À envoyer (prév.)'}</td>
          ${users.map(u => `<td style="text-align:right">${eur(dk.aPayer.byUser?.[u.id] ?? 0)}</td>`).join('')}
          <td style="text-align:right">${eur(dk.aPayer.total)}</td>
        </tr>
        <tr class="row-total">
          <td>Solde ${isReel ? 'net' : 'prévisionnel'}</td>
          ${users.map(u => { const v = dk.solde.byUser?.[u.id] ?? 0; return `<td style="text-align:right;color:${v >= 0 ? 'var(--success)' : 'var(--danger)'};">${eur(v)}</td>`; }).join('')}
          <td style="text-align:right;color:${dk.solde.total >= 0 ? 'var(--success)' : 'var(--danger)'};">${eur(dk.solde.total)}</td>
        </tr>
      </tfoot>
    </table>
    ${!isReel ? `<p style="font-size:0.72rem;color:var(--text-3);margin-top:8px;padding:0 2px;">💡 Ce calcul utilise les plafonds de budget et la répartition configurée. Il représente le maximum à envoyer sur le compte joint.</p>` : ''}
  `;
}

function _buildBudgetCard(title, budget, spent, budgetLabel = 'Budget') {
  const pctUsed   = budget > 0 ? Math.min(100, Math.round((spent / budget) * 100)) : 0;
  const color     = pctUsed >= 90 ? 'danger' : pctUsed >= 70 ? 'warning' : 'success';
  return `
    <div class="card" style="padding:12px;box-sizing:border-box;display:flex;flex-direction:column;justify-content:space-between;">
      <div style="font-size:0.72rem;font-weight:600;color:var(--text-3);margin-bottom:6px;">${title}</div>
      <div class="progress-track" style="height:6px;margin-bottom:6px;">
        <div class="progress-bar ${color}" style="width:${pctUsed}%;"></div>
      </div>
      <div style="display:flex;justify-content:space-between;font-size:0.75rem;">
        <span style="color:var(--${color});">${eur(spent)} dépensé</span>
        <span style="color:var(--text-3);">${budgetLabel} ${eur(budget)}</span>
      </div>
      ${(budget - spent) < 0 ? `<div style="font-size:0.7rem;color:var(--danger);margin-top:3px;">⚠️ Dépassement ${eur(Math.abs(budget - spent))}</div>` : ''}
    </div>
  `;
}

// ── Quick-add budget op depuis l'accueil ──
function _showQuickAddBudgetOp(catId, catLabel, year, month, users, onSave) {
  const now = new Date();
  const daysInMonth = new Date(year, month, 0).getDate();
  const userSelect = users.length > 1
    ? `<div class="form-group" style="margin-bottom:10px;">
        <label class="form-label">Personne</label>
        <select class="form-input" id="qbop-user">
          <option value="">— Sans attribution —</option>
          <option value="shared">🤝 Partagé (tous)</option>
          ${users.map(u => `<option value="${u.id}">${escHtml(u.name)}</option>`).join('')}
        </select>
       </div>
       <div id="qbop-split-section" style="display:none;padding:8px;background:var(--bg-secondary);border-radius:var(--radius-sm);margin-bottom:10px;">
         <div style="font-size:0.7rem;color:var(--text-3);margin-bottom:6px;">Répartition personnalisée (%) — total doit faire 100%</div>
         ${users.map(u => `<div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;">
           <span style="width:8px;height:8px;border-radius:50%;background:${escHtml(u.color||'#6C63FF')};display:inline-block;"></span>
           <span style="flex:1;font-size:0.78rem;">${escHtml(u.name)}</span>
           <input type="number" class="form-input qbop-split-pct" data-uid="${u.id}" min="0" max="100" step="1" value="${Math.round(100/users.length)}" style="width:62px;text-align:right;padding:4px 6px;">
           <span style="color:var(--text-3);font-size:0.78rem;">%</span>
         </div>`).join('')}
         <div id="qbop-split-hint" style="text-align:right;font-size:0.7rem;margin-top:2px;"></div>
       </div>`
    : '';
  openModal(`+ ${catLabel}`, `
    <div class="form-group" style="margin-bottom:10px;">
      <label class="form-label">Description *</label>
      <input type="text" class="form-input" id="qbop-label" placeholder="Ex: Carrefour…" autofocus>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px;">
      <div class="form-group"><label class="form-label">Jour</label><input type="number" class="form-input" id="qbop-day" min="1" max="${daysInMonth}" value="${now.getDate()}"></div>
      <div class="form-group"><label class="form-label">Montant (€) *</label><div class="input-wrap"><input type="number" class="form-input" id="qbop-amount" min="0.01" step="0.01" placeholder="0.00"><span class="input-suffix">€</span></div></div>
    </div>
    ${userSelect}
  `, `<button class="btn btn-primary btn-full" id="qbop-save">Enregistrer</button>`);
  // ── Répartition personnalisée ──
  const qbopUserSel  = document.getElementById('qbop-user');
  const qbopSplitSec = document.getElementById('qbop-split-section');
  const updateQbopHint = () => {
    const total = [...document.querySelectorAll('.qbop-split-pct')].reduce((s,i)=>s+(Number(i.value)||0),0);
    const hint  = document.getElementById('qbop-split-hint');
    if (hint) { hint.style.color = Math.abs(total-100)<0.5?'var(--success)':'var(--danger)'; hint.textContent=`Total : ${total}%${Math.abs(total-100)>=0.5?' ⚠️':' ✅'}`; }
  };
  if (qbopSplitSec) {
    qbopUserSel?.addEventListener('change', () => {
      qbopSplitSec.style.display = qbopUserSel.value==='shared' ? '' : 'none';
      if (qbopUserSel.value==='shared') updateQbopHint();
    });
    document.querySelectorAll('.qbop-split-pct').forEach(i=>i.addEventListener('input', updateQbopHint));
  }
  document.getElementById('qbop-save')?.addEventListener('click', async () => {
    const label  = document.getElementById('qbop-label')?.value.trim();
    const amount = parseFloat(document.getElementById('qbop-amount')?.value);
    const day    = parseInt(document.getElementById('qbop-day')?.value, 10) || null;
    if (!label)            { showToast('Saisissez une description', 'error'); return; }
    if (!amount || amount <= 0) { showToast('Montant invalide', 'error'); return; }
    const userVal = document.getElementById('qbop-user')?.value || null;
    if (userVal === 'shared' && users.length > 1) {
      const splitInputs = document.querySelectorAll('.qbop-split-pct');
      const useSplit = splitInputs.length > 0 && qbopSplitSec?.style.display !== 'none';
      const sumPcts = useSplit ? [...splitInputs].reduce((s,i)=>s+(Number(i.value)||0),0)||100 : 100;
      for (const u of users) {
        const pct = useSplit ? (Number(document.querySelector(`.qbop-split-pct[data-uid='${u.id}']`)?.value)||0)/sumPcts : 1/users.length;
        const share = +(amount * pct).toFixed(2);
        if (share > 0) await saveBudgetOp({ category: catId, year, month, day, label, amount: share, userId: u.id });
      }
    } else {
      await saveBudgetOp({ category: catId, year, month, day, label, amount, userId: userVal });
    }
    closeModal();
    showToast('Ajouté ✅', 'success');
    if (onSave) await onSave();
  });
}

function _buildPrevDay(d) {
  const todayStyle = d.isToday ? 'background:var(--primary-bg);font-weight:700;' : '';
  const pastStyle  = d.isPast  ? 'opacity:0.4;'  : '';
  const balColor   = d.balance >= 0 ? 'var(--success)' : 'var(--danger)';
  const todayBadge = d.isToday ? `<span class="chip primary" style="font-size:0.6rem;padding:1px 5px;margin-left:4px;">auj.</span>` : '';

  const chargesHtml = d.chargeItems.map(c => `<span class="chip danger" style="font-size:0.65rem;padding:1px 5px;">${escHtml(c.label)} −${eur(c.amount)}</span>`).join(' ');
  const extraHtml   = (d.extraItems || []).map(e => `<span class="chip warning" style="font-size:0.65rem;padding:1px 5px;">${escHtml(e.label)} −${eur(e.amount)}</span>`).join(' ');
  const allHtml     = [chargesHtml, extraHtml].filter(Boolean).join(' ') || `<span style="color:var(--text-3);font-size:0.72rem;">—</span>`;

  return `<tr style="${todayStyle}${pastStyle}">
    <td style="white-space:nowrap;"><strong>${d.day}</strong>${todayBadge}</td>
    <td style="font-size:0.78rem;">${allHtml}</td>
    <td style="text-align:right;font-weight:700;color:${balColor};">${eur(d.balance)}</td>
  </tr>`;
}

function buildRow(label, kpiField, users) {
  return `<tr>
    <td>${label}</td>
    ${users.map(u => `<td style="text-align:right">${eur(kpiField?.byUser?.[u.id] ?? 0)}</td>`).join('')}
    <td style="text-align:right">${eur(kpiField?.total ?? 0)}</td>
  </tr>`;
}

// Fusionne deux byUser maps (addition)
function mergeByUser(a, b, users) {
  const out = {};
  for (const u of users) {
    out[u.id] = (a?.[u.id] ?? 0) + (b?.[u.id] ?? 0);
  }
  return out;
}

// ══════════════════════════════════════════════════
// MODAL : VIRER VERS L'ÉPARGNE
// ══════════════════════════════════════════════════
function showTransferSavingsModal(year, month, ecoPossible, existingOp, onSave) {
  const isEdit = !!existingOp;
  const suggested = isEdit ? Math.abs(existingOp.amount) : Math.max(0, Math.round(ecoPossible));

  openModal(
    isEdit ? '💰 Modifier le virement épargne' : '💰 Virer vers l\'épargne',
    `
    <p style="font-size:0.82rem;color:var(--text-2);margin-bottom:14px;">
      Indiquez le montant que vous souhaitez mettre de côté pour <strong>${nomMois(month)} ${year}</strong>.<br>
      Une opération sera créée dans votre suivi d'épargne.
    </p>
    <div style="margin-bottom:14px;">
      <button type="button" class="btn btn-outline trf-preset" data-val="${Math.max(0, Math.round(ecoPossible))}" style="width:100%;">
        <div style="font-size:0.68rem;color:var(--text-3);margin-bottom:2px;">Utiliser le montant possible</div>
        <div style="font-weight:700;font-size:0.95rem;color:var(--success);">${eur(Math.max(0, ecoPossible))}</div>
      </button>
    </div>
    <div class="form-group" style="margin-bottom:10px;">
      <label class="form-label">Montant à virer (€)</label>
      <div class="input-wrap">
        <input type="number" class="form-input input-euro" id="trf-amount" min="0" step="1" value="${suggested}">
        <span class="input-suffix">€</span>
      </div>
    </div>
    <div class="form-group">
      <label class="form-label">Libellé</label>
      <input type="text" class="form-input" id="trf-label" value="${isEdit ? existingOp.label || '' : `Épargne ${nomMois(month)} ${year}`}" placeholder="Ex: Virement Livret A">
    </div>
    `,
    `
    ${isEdit ? `<button class="btn btn-danger btn-sm" id="trf-delete">Supprimer</button>` : ''}
    <button class="btn btn-outline" id="trf-cancel">Annuler</button>
    <button class="btn btn-success" id="trf-save" style="margin-left:auto;">Confirmer</button>
    `
  );

  // Presets
  document.querySelectorAll('.trf-preset').forEach(btn => {
    btn.addEventListener('click', () => {
      const input = document.getElementById('trf-amount');
      if (input) input.value = btn.dataset.val;
    });
  });

  document.getElementById('trf-cancel')?.addEventListener('click', closeModal);

  document.getElementById('trf-delete')?.addEventListener('click', async () => {
    const toDelete = { ...existingOp };
    closeModal();
    showToastWithUndo(
      `Virement « ${toDelete.label || 'sans nom'} » supprimé`,
      async () => {
        await deleteSavingsOperation(toDelete.id);
        onSave();
      },
      6000,
      'warning'
    );
  });

  document.getElementById('trf-save')?.addEventListener('click', async () => {
    const amount = Number(document.getElementById('trf-amount')?.value);
    if (!amount || amount <= 0) { showToast('Montant invalide', 'error'); return; }
    const label = document.getElementById('trf-label')?.value.trim() || `Épargne ${nomMois(month)} ${year}`;
    const now   = new Date();

    if (isEdit) await deleteSavingsOperation(existingOp.id);

    await saveSavingsOperation({
      amount,
      label,
      type:      'monthly_savings',
      year,
      month,
      day:       now.getDate(),
      createdAt: now.toISOString(),
    });

    closeModal();
    showToast(`${eur(amount)} mis de côté ✅`, 'success');
    onSave();
  });
}
