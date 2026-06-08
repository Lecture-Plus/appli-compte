// ============================================================
// js/calculs.js – Moteur de calcul budget
// Portage fidèle de la logique Apps Script
// ============================================================

/**
 * Répartit les montants P1/P2 selon la règle "qui".
 * @param {number} amountP1 - Montant affecté P1
 * @param {number} amountP2 - Montant affecté P2
 * @param {string} qui - 'p1' | 'p2' | 'les_deux' | '50_50'
 */
export function repartir(amountP1, amountP2, qui) {
  const v1    = Number(amountP1) || 0;
  const v2    = Number(amountP2) || 0;
  const total = v1 + v2;

  switch (qui) {
    case 'p1':       return { p1: total, p2: 0 };
    case 'p2':       return { p1: 0,     p2: total };
    case 'les_deux': return { p1: v1,    p2: v2 };
    case '50_50':    return { p1: total / 2, p2: total / 2 };
    default:         return { p1: v1,    p2: v2 };
  }
}

/**
 * Calcule tous les KPIs pour un mois donné.
 *
 * ── Logique vérifiée ──────────────────────────────────────────────────────
 *  REVENUS     = p1.revenus + p2.revenus  (salaires nets)
 *  PRIMES      = p1.primes  + p2.primes   (primes, aides, CAF…)
 *  CHARGES     = somme des charges récurrentes après règle "qui"
 *  COURSES     = saisie libre (ce que chacun a payé en caisse)
 *  EXTRAS      = sorties / dépenses perso
 *  ACHATS EXC. = achats one-shot après règle "qui"
 *  IMPRÉVUS    = dépenses non planifiées
 *
 *  PART DE PAIEMENT (partP1/P2) :
 *   Mode SÉPARÉ    → chacun paie ses charges+extras + la moitié des courses
 *   Mode FIXE %    → la somme commune (charges+courses+extras) est répartie
 *                    selon les % définis par l'utilisateur
 *   Mode ÉQUITABLE → proportionnel aux revenus (sans primes)
 *   Dans tous les modes : achats exceptionnels restent imputés à la personne
 *
 *  À PAYER         = part de paiement + imprévus
 *  SOLDE           = (revenus + primes) − à payer
 *  TAUX D'ÉPARGNE  = solde / (revenus + primes)
 *  DÉPENSES        = charges + courses + extras + achats + imprévus
 *                    (total "cash sorti" réel, pas la part théorique)
 *  ÉCO POSSIBLE    = (revenus + primes) − part_commune (sans achats exc. ni imprévus)
 * ─────────────────────────────────────────────────────────────────────────
 *
 * @param {Object} monthData   - Données mensuelles
 * @param {Array}  charges     - Charges récurrentes actives pour ce mois
 * @param {Array}  achats      - Achats exceptionnels du mois (inclut craquages 'direct')
 * @param {Object} repartCfg  - Config répartition { mode, pct_p1, pct_p2 }
 * @returns {Object}           - Tous les KPIs calculés
 */
export function calcMonth(monthData, charges, achats, repartCfg) {
  const p1  = monthData?.p1  ?? {};
  const p2  = monthData?.p2  ?? {};
  const cfg = repartCfg      ?? { mode: 'separe', pct_p1: 50, pct_p2: 50 };

  // ── Revenus & Primes ──
  const revP1 = Number(p1.revenus)  || 0;
  const revP2 = Number(p2.revenus)  || 0;
  const priP1 = Number(p1.primes)   || 0;
  const priP2 = Number(p2.primes)   || 0;

  // ── Charges récurrentes (filtrage : seuls les craquages 'from_savings' sont exclus) ──
  let chgP1 = 0, chgP2 = 0;
  for (const c of (charges ?? [])) {
    const r  = repartir(c.amount_p1, c.amount_p2, c.qui);
    chgP1   += r.p1;
    chgP2   += r.p2;
  }

  // ── Courses ──
  const coursP1 = Number(p1.courses) || 0;
  const coursP2 = Number(p2.courses) || 0;

  // ── Extras / Sorties ──
  const extP1 = Number(p1.extras) || 0;
  const extP2 = Number(p2.extras) || 0;

  // ── Achats exceptionnels (craquages 'from_savings' exclus du bilan mensuel) ──
  let achP1 = 0, achP2 = 0;
  for (const a of (achats ?? [])) {
    if (a.craquage_source === 'savings') continue; // couvert par épargne → hors bilan mois
    const r  = repartir(a.amount_p1, a.amount_p2, a.qui);
    achP1   += r.p1;
    achP2   += r.p2;
  }

  // ── Imprévus ──
  const impP1 = Number(p1.imprevus) || 0;
  const impP2 = Number(p2.imprevus) || 0;

  // ── Part de paiement commune (charges + courses + extras, sans imprévus/achats) ──
  const totalCours  = coursP1 + coursP2;
  const totalChg    = chgP1   + chgP2;
  const totalExt    = extP1   + extP2;
  const totalCommun = totalChg + totalCours + totalExt;

  let partP1_common = 0, partP2_common = 0;

  if (cfg.mode === 'fixe') {
    const pct1  = Math.max(0, Number(cfg.pct_p1) || 0);
    const pct2  = Math.max(0, Number(cfg.pct_p2) || 0);
    const sumP  = pct1 + pct2 || 100;
    partP1_common = totalCommun * (pct1 / sumP);
    partP2_common = totalCommun * (pct2 / sumP);

  } else if (cfg.mode === 'equitable') {
    const totalRev = revP1 + revP2;
    if (totalRev > 0) {
      partP1_common = totalCommun * (revP1 / totalRev);
      partP2_common = totalCommun * (revP2 / totalRev);
    } else {
      partP1_common = totalCommun / 2;
      partP2_common = totalCommun / 2;
    }

  } else {
    // 'separe' : courses 50/50, charges & extras imputés à la personne
    const halfCours = totalCours / 2;
    partP1_common   = halfCours + chgP1 + extP1;
    partP2_common   = halfCours + chgP2 + extP2;
  }

  // Part totale (part commune + achats exceptionnels personnels)
  const partP1 = partP1_common + achP1;
  const partP2 = partP2_common + achP2;

  // ── À payer = part + imprévus ──
  const aPayerP1 = partP1 + impP1;
  const aPayerP2 = partP2 + impP2;

  // ── Solde = (revenus + primes) − à payer ──
  const soldeP1 = revP1 + priP1 - aPayerP1;
  const soldeP2 = revP2 + priP2 - aPayerP2;
  const soldeT  = soldeP1 + soldeP2;

  // ── Économie possible théorique (sans imprévus ni achats exc.) ──
  const ecoPossP1 = (revP1 + priP1) - partP1_common;
  const ecoPossP2 = (revP2 + priP2) - partP2_common;

  // ── Dépenses totales (cash réellement sorti, agrégé par personne) ──
  const depP1 = chgP1 + coursP1 + extP1 + achP1 + impP1;
  const depP2 = chgP2 + coursP2 + extP2 + achP2 + impP2;
  const depT  = depP1 + depP2;

  // ── Taux d'épargne = solde / (revenus + primes) ──
  const revPriP1 = revP1 + priP1;
  const revPriP2 = revP2 + priP2;
  const revPriT  = revPriP1 + revPriP2;
  const txP1 = revPriP1 > 0 ? soldeP1 / revPriP1 : 0;
  const txP2 = revPriP2 > 0 ? soldeP2 / revPriP2 : 0;
  const txT  = revPriT  > 0 ? soldeT  / revPriT  : 0;

  return {
    revenus:     { p1: revP1,    p2: revP2,    total: revP1 + revP2 },
    primes:      { p1: priP1,    p2: priP2,    total: priP1 + priP2 },
    charges:     { p1: chgP1,    p2: chgP2,    total: totalChg },
    courses:     { p1: coursP1,  p2: coursP2,  total: totalCours },
    extras:      { p1: extP1,    p2: extP2,    total: totalExt },
    achats:      { p1: achP1,    p2: achP2,    total: achP1 + achP2 },
    imprevus:    { p1: impP1,    p2: impP2,    total: impP1 + impP2 },
    depenses:    { p1: depP1,    p2: depP2,    total: depT },
    part:        { p1: partP1,   p2: partP2,   total: partP1 + partP2 },
    aPayer:      { p1: aPayerP1, p2: aPayerP2, total: aPayerP1 + aPayerP2 },
    solde:       { p1: soldeP1,  p2: soldeP2,  total: soldeT },
    ecoPossible: { p1: ecoPossP1, p2: ecoPossP2, total: ecoPossP1 + ecoPossP2 },
    txEpargne:   { p1: txP1,      p2: txP2,     total: txT },
  };
}

/**
 * Calcule les agrégats annuels à partir d'un tableau de résultats mensuels.
 */
export function calcYear(monthsResults) {
  if (!monthsResults || !monthsResults.length) return null;

  const s = (key, sub) => monthsResults.reduce((acc, m) => {
    const v = m?.[key]?.[sub];
    return acc + (typeof v === 'number' && isFinite(v) ? v : 0);
  }, 0);

  const revT = s('revenus', 'total') + s('primes', 'total');
  const solT = s('solde', 'total');

  return {
    revenus:   { p1: s('revenus','p1'),  p2: s('revenus','p2'),  total: s('revenus','total') },
    primes:    { p1: s('primes','p1'),   p2: s('primes','p2'),   total: s('primes','total') },
    charges:   { p1: s('charges','p1'),  p2: s('charges','p2'),  total: s('charges','total') },
    courses:   { p1: s('courses','p1'),  p2: s('courses','p2'),  total: s('courses','total') },
    extras:    { p1: s('extras','p1'),   p2: s('extras','p2'),   total: s('extras','total') },
    achats:    { p1: s('achats','p1'),   p2: s('achats','p2'),   total: s('achats','total') },
    imprevus:  { p1: s('imprevus','p1'), p2: s('imprevus','p2'), total: s('imprevus','total') },
    depenses:  { p1: s('depenses','p1'), p2: s('depenses','p2'), total: s('depenses','total') },
    solde:     { p1: s('solde','p1'),    p2: s('solde','p2'),    total: solT },
    epargne:   { total: solT },
    txEpargne: { total: revT > 0 ? solT / revT : 0 },
  };
}

/**
 * Calcule le prévisionnel jour par jour pour le reste du mois.
 *
 * Logique :
 *  - On part du revenu total du mois (s'il est saisi)
 *  - On soustrait chaque jour : les charges dont c'est le "jour du mois" (dayOfMonth)
 *    + une estimation quotidienne des courses (budget hebdo / 7)
 *  - On retourne un tableau de 31 entrées max avec le solde projeté chaque jour
 *
 * @param {Object} p
 * @param {number}  p.totalIncome         - Revenus + primes du mois
 * @param {Array}   p.charges             - Charges récurrentes (avec .dayOfMonth optionnel)
 * @param {number}  p.weeklyCoursesEstimate - Budget courses hebdomadaire (€)
 * @param {number}  p.year
 * @param {number}  p.month
 * @returns {Object}
 */
export function calcPrevisionnel({ totalIncome, charges, weeklyCoursesEstimate, year, month }) {
  const daysInMonth     = new Date(year, month, 0).getDate();
  const now             = new Date();
  const isCurrentMonth  = now.getFullYear() === year && (now.getMonth() + 1) === month;
  const todayDay        = isCurrentMonth ? now.getDate() : 0;
  const dailyCourses    = (Number(weeklyCoursesEstimate) || 0) / 7;

  // Charges avec un jour de prélèvement défini
  const timedCharges = (charges || []).filter(c => c.active && Number(c.dayOfMonth) > 0);

  const days = [];
  let runningBalance = Number(totalIncome) || 0;

  for (let d = 1; d <= daysInMonth; d++) {
    const dayCharges = timedCharges.filter(c => Number(c.dayOfMonth) === d);
    const chargesAmt = dayCharges.reduce(
      (sum, c) => sum + (Number(c.amount_p1) || 0) + (Number(c.amount_p2) || 0), 0
    );
    const coursesAmt = Math.round(dailyCourses * 100) / 100;

    runningBalance -= chargesAmt + coursesAmt;

    days.push({
      day:         d,
      chargesAmt,
      coursesAmt,
      deducted:    chargesAmt + coursesAmt,
      balance:     Math.round(runningBalance * 100) / 100,
      isPast:      d < todayDay,
      isToday:     d === todayDay && isCurrentMonth,
      chargeItems: dayCharges.map(c => ({ label: c.label, amount: (Number(c.amount_p1)||0)+(Number(c.amount_p2)||0) })),
    });
  }

  return { days, daysInMonth, todayDay, totalIncome: Number(totalIncome) || 0 };
}

/**
 * Calcule le solde d'épargne courant depuis une liste d'opérations.
 */
export function calcSavingsBalance(latestConfirmed, allOperations) {
  const base = latestConfirmed ? (Number(latestConfirmed.amount) || 0) : 0;

  const opsSince = latestConfirmed
    ? (allOperations || []).filter(op => {
        if (op.year  > latestConfirmed.year)  return true;
        if (op.year  < latestConfirmed.year)  return false;
        if (op.month > latestConfirmed.month) return true;
        if (op.month < latestConfirmed.month) return false;
        return (op.day || 1) >= (latestConfirmed.confirmedDay || 1);
      })
    : (allOperations || []);

  const delta = opsSince.reduce((s, op) => s + (Number(op.amount) || 0), 0);
  return { balance: base + delta, base, delta, opsSince };
}

/**
 * Simulateur What-if : impact d'un revenu supplémentaire.
 */
export function whatIf(baseResult, extraP1, extraP2) {
  if (!baseResult) return null;
  const dP1   = Number(extraP1) || 0;
  const dP2   = Number(extraP2) || 0;
  const dTot  = dP1 + dP2;

  const newSoldeP1  = baseResult.solde.p1 + dP1;
  const newSoldeP2  = baseResult.solde.p2 + dP2;
  const newSoldeT   = newSoldeP1 + newSoldeP2;
  const newRevPriT  = (baseResult.revenus.total + baseResult.primes.total) + dTot;

  return {
    deltaP1:      dP1,
    deltaP2:      dP2,
    deltaTotal:   dTot,
    newSolde:     { p1: newSoldeP1, p2: newSoldeP2, total: newSoldeT },
    newTxEpargne: { total: newRevPriT > 0 ? newSoldeT / newRevPriT : 0 },
  };
}

 * @param {number} amountP1 - Montant affecté P1
 * @param {number} amountP2 - Montant affecté P2
 * @param {string} qui - 'p1' | 'p2' | 'les_deux' | '50_50'
 */
export function repartir(amountP1, amountP2, qui) {
  const v1    = Number(amountP1) || 0;
  const v2    = Number(amountP2) || 0;
  const total = v1 + v2;

  switch (qui) {
    case 'p1':      return { p1: total, p2: 0 };
    case 'p2':      return { p1: 0,     p2: total };
    case 'les_deux': return { p1: v1,   p2: v2 };
    case '50_50':   return { p1: total / 2, p2: total / 2 };
    default:        return { p1: v1,    p2: v2 };
  }
}

/**
 * Calcule tous les KPIs pour un mois donné.
 *
 * @param {Object} monthData    - Données mensuelles (revenus, courses, etc.)
 * @param {Array}  charges      - Charges récurrentes actives pour ce mois
 * @param {Array}  achats       - Achats exceptionnels du mois
 * @param {Object} repartCfg   - Config répartition { mode, pct_p1, pct_p2 }
 * @returns {Object}            - Tous les KPIs calculés
 */
export function calcMonth(monthData, charges, achats, repartCfg) {
  const p1  = monthData?.p1  ?? {};
  const p2  = monthData?.p2  ?? {};
  const cfg = repartCfg      ?? { mode: 'separe', pct_p1: 50, pct_p2: 50 };

  // ── Revenus & Primes ──
  const revP1 = Number(p1.revenus)  || 0;
  const revP2 = Number(p2.revenus)  || 0;
  const priP1 = Number(p1.primes)   || 0;
  const priP2 = Number(p2.primes)   || 0;

  // ── Charges récurrentes (déjà filtrées pour ce mois) ──
  let chgP1 = 0, chgP2 = 0;
  for (const c of (charges ?? [])) {
    const r  = repartir(c.amount_p1, c.amount_p2, c.qui);
    chgP1   += r.p1;
    chgP2   += r.p2;
  }

  // ── Courses ──
  const coursP1 = Number(p1.courses) || 0;
  const coursP2 = Number(p2.courses) || 0;

  // ── Extras / Sorties ──
  const extP1 = Number(p1.extras) || 0;
  const extP2 = Number(p2.extras) || 0;

  // ── Achats exceptionnels ──
  let achP1 = 0, achP2 = 0;
  for (const a of (achats ?? [])) {
    const r  = repartir(a.amount_p1, a.amount_p2, a.qui);
    achP1   += r.p1;
    achP2   += r.p2;
  }

  // ── Imprévus ──
  const impP1 = Number(p1.imprevus) || 0;
  const impP2 = Number(p2.imprevus) || 0;

  // ── Part de paiement commune (sans imprévus ni achats exc.) ──
  const totalCours  = coursP1 + coursP2;
  const totalChg    = chgP1   + chgP2;
  const totalExt    = extP1   + extP2;
  const totalCommun = totalChg + totalCours + totalExt;

  let partP1_common = 0, partP2_common = 0;

  if (cfg.mode === 'fixe') {
    // Répartition par pourcentages fixes
    const pct1  = Math.max(0, Number(cfg.pct_p1) || 0);
    const pct2  = Math.max(0, Number(cfg.pct_p2) || 0);
    const sumP  = pct1 + pct2 || 100;
    partP1_common = totalCommun * (pct1 / sumP);
    partP2_common = totalCommun * (pct2 / sumP);

  } else if (cfg.mode === 'equitable') {
    // Proportionnel aux revenus (sans primes)
    const totalRev = revP1 + revP2;
    if (totalRev > 0) {
      partP1_common = totalCommun * (revP1 / totalRev);
      partP2_common = totalCommun * (revP2 / totalRev);
    } else {
      partP1_common = totalCommun / 2;
      partP2_common = totalCommun / 2;
    }

  } else {
    // 'separe' : courses partagées 50/50, charges & extras imputés à la personne
    const halfCours = totalCours / 2;
    partP1_common   = halfCours + chgP1 + extP1;
    partP2_common   = halfCours + chgP2 + extP2;
  }

  // Part totale (avec achats exceptionnels)
  const partP1 = partP1_common + achP1;
  const partP2 = partP2_common + achP2;

  // ── À payer = part + imprévus ──
  const aPayerP1 = partP1 + impP1;
  const aPayerP2 = partP2 + impP2;

  // ── Solde = revenus + primes − à payer ──
  const soldeP1 = revP1 + priP1 - aPayerP1;
  const soldeP2 = revP2 + priP2 - aPayerP2;
  const soldeT  = soldeP1 + soldeP2;

  // ── Économie possible théorique (sans imprévus ni achats exc.) ──
  const ecoPossP1 = (revP1 + priP1) - partP1_common;
  const ecoPossP2 = (revP2 + priP2) - partP2_common;

  // ── Dépenses totales ──
  const depP1 = chgP1 + coursP1 + extP1 + achP1 + impP1;
  const depP2 = chgP2 + coursP2 + extP2 + achP2 + impP2;
  const depT  = depP1 + depP2;

  // ── Taux d'épargne ──
  const revPriP1 = revP1 + priP1;
  const revPriP2 = revP2 + priP2;
  const revPriT  = revPriP1 + revPriP2;
  const txP1 = revPriP1 > 0 ? soldeP1 / revPriP1 : 0;
  const txP2 = revPriP2 > 0 ? soldeP2 / revPriP2 : 0;
  const txT  = revPriT  > 0 ? soldeT  / revPriT  : 0;

  return {
    revenus:     { p1: revP1,    p2: revP2,    total: revP1 + revP2 },
    primes:      { p1: priP1,    p2: priP2,    total: priP1 + priP2 },
    charges:     { p1: chgP1,    p2: chgP2,    total: totalChg },
    courses:     { p1: coursP1,  p2: coursP2,  total: totalCours },
    extras:      { p1: extP1,    p2: extP2,    total: totalExt },
    achats:      { p1: achP1,    p2: achP2,    total: achP1 + achP2 },
    imprevus:    { p1: impP1,    p2: impP2,    total: impP1 + impP2 },
    depenses:    { p1: depP1,    p2: depP2,    total: depT },
    part:        { p1: partP1,   p2: partP2,   total: partP1 + partP2 },
    aPayer:      { p1: aPayerP1, p2: aPayerP2, total: aPayerP1 + aPayerP2 },
    solde:       { p1: soldeP1,  p2: soldeP2,  total: soldeT },
    ecoPossible: { p1: ecoPossP1,p2: ecoPossP2, total: ecoPossP1 + ecoPossP2 },
    txEpargne:   { p1: txP1,     p2: txP2,     total: txT },
  };
}

/**
 * Calcule les agrégats annuels à partir d'un tableau de résultats mensuels.
 * @param {Array<Object>} monthsResults - Tableau de résultats de calcMonth()
 * @returns {Object} - KPIs annuels
 */
export function calcYear(monthsResults) {
  if (!monthsResults || !monthsResults.length) return null;

  const s = (key, sub) => monthsResults.reduce((acc, m) => {
    const v = m?.[key]?.[sub];
    return acc + (typeof v === 'number' && isFinite(v) ? v : 0);
  }, 0);

  const revT = s('revenus', 'total') + s('primes', 'total');
  const solT = s('solde', 'total');

  return {
    revenus:   { p1: s('revenus','p1'),  p2: s('revenus','p2'),  total: s('revenus','total') },
    primes:    { p1: s('primes','p1'),   p2: s('primes','p2'),   total: s('primes','total') },
    charges:   { p1: s('charges','p1'),  p2: s('charges','p2'),  total: s('charges','total') },
    courses:   { p1: s('courses','p1'),  p2: s('courses','p2'),  total: s('courses','total') },
    extras:    { p1: s('extras','p1'),   p2: s('extras','p2'),   total: s('extras','total') },
    achats:    { p1: s('achats','p1'),   p2: s('achats','p2'),   total: s('achats','total') },
    imprevus:  { p1: s('imprevus','p1'), p2: s('imprevus','p2'), total: s('imprevus','total') },
    depenses:  { p1: s('depenses','p1'), p2: s('depenses','p2'), total: s('depenses','total') },
    solde:     { p1: s('solde','p1'),    p2: s('solde','p2'),    total: solT },
    epargne:   { total: solT },
    txEpargne: { total: revT > 0 ? solT / revT : 0 },
  };
}

/**
 * Calcule les statistiques mensuelles pour une année complète.
 * Retourne un tableau de 12 entrées (une par mois, null si pas de données).
 */
export async function calcFullYear(year, { getMonthsByYear, getChargesForMonth, getAchatsForMonth, getRepartition }) {
  const monthsData = await getMonthsByYear(year);
  const monthMap   = Object.fromEntries(monthsData.map(m => [m.month, m]));

  const results = [];
  for (let m = 1; m <= 12; m++) {
    const md     = monthMap[m] ?? null;
    const chg    = await getChargesForMonth(m);
    const ach    = await getAchatsForMonth(year, m);
    const repCfg = await getRepartition(year, m);

    if (!md) {
      results.push(null);
    } else {
      results.push(calcMonth(md, chg, ach, repCfg));
    }
  }
  return results;
}

/**
 * Simulateur What-if : calcule l'impact d'un revenu supplémentaire sur l'épargne.
 * @param {Object} baseResult - Résultat de calcMonth() pour le mois de référence
 * @param {number} extraP1    - Revenu supplémentaire P1
 * @param {number} extraP2    - Revenu supplémentaire P2
 */
export function whatIf(baseResult, extraP1, extraP2) {
  if (!baseResult) return null;
  const dP1   = Number(extraP1) || 0;
  const dP2   = Number(extraP2) || 0;
  const dTot  = dP1 + dP2;

  const newSoldeP1  = baseResult.solde.p1 + dP1;
  const newSoldeP2  = baseResult.solde.p2 + dP2;
  const newSoldeT   = newSoldeP1 + newSoldeP2;
  const newRevPriT  = (baseResult.revenus.total + baseResult.primes.total) + dTot;

  return {
    deltaP1:     dP1,
    deltaP2:     dP2,
    deltaTotal:  dTot,
    newSolde:    { p1: newSoldeP1, p2: newSoldeP2, total: newSoldeT },
    newTxEpargne:{ total: newRevPriT > 0 ? newSoldeT / newRevPriT : 0 },
  };
}
