// ============================================================
// js/insights.js – Moteur de conseils budgétaires contextuels
// Analyse les 3-6 derniers mois et produit des insights actionnables.
// ============================================================

import { getMonthsByYear, getAllCharges, getAllBudgetOps,
         getAchatsForYear, getAllSavingsGoals,
         computeCurrentSavingsBalance }         from './db.js';
import { calcMonth, calcPrevisionnel }           from './calculs.js';
import { addMonth }                              from './utils.js';

/**
 * Calcule les insights pour le mois courant.
 * @param {number} year
 * @param {number} month
 * @param {object[]} users   - tableau d'utilisateurs actifs
 * @param {object}   settings
 * @returns {Promise<Array<{icon:string, text:string, type:'warning'|'info'|'success'}>>}
 */
export async function computeInsights(year, month, users, settings) {
  const insights = [];
  if (!users?.length) return insights;

  // ── Charger 6 mois d'historique ──────────────────────────────
  const history = [];
  for (let i = 1; i <= 6; i++) {
    const m = addMonth(year, month, -i);
    history.push(m);
  }

  const years = [...new Set(history.map(m => m.year))];
  const allMonthsData = (await Promise.all(years.map(y => getMonthsByYear(y)))).flat();
  const allCharges    = await getAllCharges();
  const allBudgetOps  = await getAllBudgetOps();

  // Achats pour les années concernées
  const achatsMap = {};
  for (const y of years) {
    achatsMap[y] = await getAchatsForYear(y);
  }

  /** Récupère monthlyData pour un mois/année donné */
  const getMd = (y, m) => allMonthsData.find(d => d.year === y && d.month === m) || null;
  /** Récupère les achats pour un mois */
  const getAchats = (y, m) => (achatsMap[y] || []).filter(a => a.month === m);
  /** Récupère les budgetOps pour un mois */
  const getBudgetOps = (y, m) => allBudgetOps.filter(o => o.year === y && o.month === m);

  // ── Calculer les KPIs pour chaque mois historique ──
  const historicKpis = [];
  for (const { year: hy, month: hm } of history) {
    const md = getMd(hy, hm);
    if (!md) continue;
    const charges = allCharges.filter(c => {
      if (!c.active) return false;
      if (c.year != null) return c.year === hy && c.month === hm;
      return c.months === 'all' || (Array.isArray(c.months) && c.months.includes(hm));
    });
    const achats   = getAchats(hy, hm);
    const budgetOps = getBudgetOps(hy, hm);
    const rep = { mode: 'equitable', pcts: {} };
    const kpi  = calcMonth(md, charges, achats, rep, users, budgetOps.length ? budgetOps : null);
    historicKpis.push({ year: hy, month: hm, kpi, md, charges });
  }

  if (!historicKpis.length) return insights;

  // ──────────────────────────────────────────────────────────────
  // Règle 1 : Charges récurrentes en hausse sur 6 mois
  // ──────────────────────────────────────────────────────────────
  try {
    const chargeTotals = historicKpis.map(h => h.kpi?.charges?.total || 0);
    if (chargeTotals.length >= 3) {
      const oldest  = chargeTotals.slice(-3).reduce((s, v) => s + v, 0) / 3;
      const recent  = chargeTotals.slice(0, 3).reduce((s, v) => s + v, 0) / 3;
      const pctDiff = oldest > 0 ? (recent - oldest) / oldest : 0;
      if (pctDiff >= 0.07) {
        const pctFmt = Math.round(pctDiff * 100);
        insights.push({
          icon: '📈',
          text: `Vos charges fixes ont augmenté de ${pctFmt} % sur les 3 derniers mois. Vérifiez vos abonnements.`,
          type: 'warning',
        });
      }
    }
  } catch (_) {}

  // ──────────────────────────────────────────────────────────────
  // Règle 2 : Mois où l'épargne est systématiquement faible
  // ──────────────────────────────────────────────────────────────
  try {
    const weakMonths = historicKpis
      .filter(h => {
        const tx = h.kpi?.txEpargne?.total ?? 0;
        const rev = h.kpi?.revenus?.total || 0;
        return rev > 0 && tx < 0.03;
      })
      .map(h => h.month);
    if (weakMonths.length >= 2) {
      const { nomMois } = await import('./utils.js');
      const labels = [...new Set(weakMonths)].map(m => nomMois(m)).join(', ');
      insights.push({
        icon: '💡',
        text: `Épargne très faible en ${labels} — pensez à un virement automatique dès réception du salaire.`,
        type: 'info',
      });
    }
  } catch (_) {}

  // ──────────────────────────────────────────────────────────────
  // Règle 3 : Date estimée d'atteinte de l'objectif d'épargne
  // ──────────────────────────────────────────────────────────────
  try {
    const goals = await getAllSavingsGoals();
    const activeGoal = goals.find(g => !g.reached);
    if (activeGoal) {
      const { balance } = await computeCurrentSavingsBalance();
      const target = Number(activeGoal.targetAmount) || 0;
      if (target > balance && balance >= 0) {
        const remaining = target - balance;
        const avgSavings = historicKpis
          .filter(h => (h.kpi?.solde?.total || 0) > 0)
          .map(h => h.kpi.solde.total);
        if (avgSavings.length > 0) {
          const monthlyAvg = avgSavings.reduce((s, v) => s + v, 0) / avgSavings.length;
          if (monthlyAvg > 0) {
            const monthsLeft = Math.ceil(remaining / monthlyAvg);
            const { nomMois: nm } = await import('./utils.js');
            const targetDate = addMonth(year, month, monthsLeft);
            insights.push({
              icon: '🎯',
              text: `À ce rythme, vous atteindrez « ${activeGoal.label || 'Objectif'} » (${target.toLocaleString('fr-FR')} €) vers ${nm(targetDate.month)} ${targetDate.year}.`,
              type: 'success',
            });
          }
        }
      }
    }
  } catch (_) {}

  // ──────────────────────────────────────────────────────────────
  // Règle 4 : Répartition déséquilibrée des loisirs entre utilisateurs
  // ──────────────────────────────────────────────────────────────
  try {
    if (users.length >= 2) {
      const customBudgets = settings.customBudgets || [];
      const loisirsBudgets = customBudgets.filter(b => b.allocation !== 'custom');
      if (loisirsBudgets.length > 0) {
        const userTotals = {};
        users.forEach(u => { userTotals[String(u.id)] = 0; });

        for (const h of historicKpis.slice(0, 3)) {
          const ops = getBudgetOps(h.year, h.month);
          for (const op of ops) {
            const uid = String(op.userId);
            if (userTotals[uid] !== undefined) userTotals[uid] += Number(op.amount) || 0;
          }
        }

        const totals  = Object.values(userTotals).filter(v => v > 0);
        if (totals.length >= 2) {
          const max  = Math.max(...totals);
          const min  = Math.min(...totals);
          const ratio = min > 0 ? max / min : Infinity;
          if (ratio >= 2.5) {
            const richestId = Object.entries(userTotals).sort((a, b) => b[1] - a[1])[0][0];
            const richest   = users.find(u => String(u.id) === richestId)?.name || 'Un utilisateur';
            insights.push({
              icon: '⚖️',
              text: `${richest} dépense ${Math.round(ratio)}× plus en loisirs que les autres ces 3 derniers mois.`,
              type: 'warning',
            });
          }
        }
      }
    }
  } catch (_) {}

  return insights;
}
