// ============================================================
// js/calculs.js – Moteur de calcul budget
// Portage fidèle de la logique Apps Script
// ============================================================

// ============================================================
// js/calculs.js – Logique de calcul budget (multi-utilisateurs)
// ============================================================

/* ── Utilitaires internes ── */
const _sum  = obj => Object.values(obj).reduce((s, v) => s + (Number(v) || 0), 0);
const _mk   = uids => Object.fromEntries(uids.map(uid => [uid, 0]));
const _uid  = id   => String(id);

/**
 * Calcule tous les KPIs pour un mois donné.
 *
 * ── Structure données ─────────────────────────────────────────
 *  monthData.users = { "1": {revenus, primes, courses, extras, imprevus}, ... }
 *  charges[i]      = { amount, qui: userId|'shared', perso: bool, ... }
 *  achats[i]       = { amount, qui: userId|'shared', craquage_source?, ... }
 *  repartCfg       = { mode: 'separe'|'fixe'|'equitable'|'solo', pcts: {"1":60,"2":40} }
 *  users           = [{ id, name, color, ... }]  – utilisateurs actifs
 *
 * ── Logique ───────────────────────────────────────────────────
 *  PART (à payer hors imprévus, hors perso) :
 *   solo      → tout au seul utilisateur
 *   separe    → charges personnelles + courses/N + achats partagés/N
 *   fixe      → (charges partagées + courses totales + achats partagés) × pct[user]
 *   equitable → idem, proportionnel aux revenus
 *
 *  Charges 'perso: true' → comptées en dépenses, EXCLUES de aPayer
 *  Achats 'craquage_source: savings' → exclus du bilan mensuel
 *
 *  SOLDE = (revenus + primes) − aPayer
 *  TAUX  = solde / (revenus + primes)
 * ─────────────────────────────────────────────────────────────
 */
export function calcMonth(monthData, charges, achats, repartCfg, users, budgetOps = null) {
  const uids = (users || []).map(u => _uid(u.id));
  const N    = uids.length || 1;
  const mode = N <= 1 ? 'solo' : (repartCfg?.mode || 'separe');

  // ── Données saisies par utilisateur ──
  const revU = _mk(uids), priU = _mk(uids), aidesU = _mk(uids);
  const crsU = _mk(uids), extU = _mk(uids), impU = _mk(uids);

  for (const uid of uids) {
    const ud   = monthData?.users?.[uid] ?? {};
    revU[uid]  = Number(ud.revenus)  || 0;
    priU[uid]  = Number(ud.primes)   || 0;
    aidesU[uid]= Number(ud.aides)    || 0;
    crsU[uid]  = Number(ud.courses)  || 0;
    extU[uid]  = Number(ud.extras)   || 0;
    impU[uid]  = Number(ud.imprevus) || 0;
  }

  const totalRev = _sum(revU);
  const totalCrs = _sum(crsU);

  // ── Charges récurrentes ──
  const chgPersonalU = _mk(uids);   // charges dédiées à un user (non perso)
  const chgPersoU    = _mk(uids);   // charges perso (tracking only)
  let   totalSharedChg = 0;
  // Charges partagées avec répartition personnalisée (splitPcts)
  const chgCustomU   = _mk(uids);

  for (const c of (charges ?? [])) {
    const amt  = Number(c.amount) || 0;
    const qui  = _uid(c.qui);
    if (c.perso) {
      const target = uids.includes(qui) ? qui : uids[0];
      if (target) chgPersoU[target] += amt;
    } else if ((c.qui === 'shared' || !uids.includes(qui)) && c.splitPcts && typeof c.splitPcts === 'object') {
      // Répartition personnalisée : distribuer selon splitPcts
      const sumPcts = uids.reduce((s, uid) => s + (Number(c.splitPcts[uid]) || 0), 0) || 100;
      for (const uid of uids) {
        chgCustomU[uid] += amt * ((Number(c.splitPcts[uid]) || 0) / sumPcts);
      }
    } else if (c.qui === 'shared' || !uids.includes(qui)) {
      totalSharedChg += amt;
    } else {
      chgPersonalU[qui] += amt;
    }
  }

  // ── Achats exceptionnels ──
  const achPersonalU = _mk(uids);
  let   totalSharedAch = 0;
  const achCustomU = _mk(uids);

  for (const a of (achats ?? [])) {
    if (a.craquage_source === 'savings') continue;
    const amt = Number(a.amount) || 0;
    const qui = _uid(a.qui);
    if ((a.qui === 'shared' || !uids.includes(qui)) && a.splitPcts && typeof a.splitPcts === 'object') {
      const sumPcts = uids.reduce((s, uid) => s + (Number(a.splitPcts[uid]) || 0), 0) || 100;
      for (const uid of uids) {
        achCustomU[uid] += amt * ((Number(a.splitPcts[uid]) || 0) / sumPcts);
      }
    } else if (a.qui === 'shared' || !uids.includes(qui)) {
      totalSharedAch += amt;
    } else {
      achPersonalU[qui] += amt;
    }
  }

  // ── Budget ops (dépenses réelles par catégorie budgétisée) ──
  // Si fournis, remplacent les plafonds courses/extras dans le calcul du solde.
  const useBudgetOps = Array.isArray(budgetOps);
  const bopsU = _mk(uids);
  let   bopsShared = 0;
  if (useBudgetOps) {
    for (const op of (budgetOps || [])) {
      const amt = Number(op.amount) || 0;
      const qui = _uid(op.userId);
      if (qui && uids.includes(qui)) { bopsU[qui] += amt; }
      else                           { bopsShared += amt; }
    }
  }

  // ── Part des coûts partagés selon le mode ──
  const partSharedU = _mk(uids);
  // Quand budgetOps fournis : courses = plafond seulement, pas dans aPayer
  const totalCommon = totalSharedChg + (useBudgetOps ? 0 : totalCrs) + totalSharedAch;

  if (mode === 'solo') {
    if (uids[0]) partSharedU[uids[0]] = totalCommon + (useBudgetOps ? bopsShared + _sum(bopsU) : _sum(extU));
  } else if (mode === 'fixe') {
    const pcts    = repartCfg?.pcts ?? {};
    const sumPcts = uids.reduce((s, uid) => s + (Number(pcts[uid]) || 0), 0) || 100;
    for (const uid of uids) {
      partSharedU[uid] = (totalCommon + (useBudgetOps ? bopsShared : 0)) * ((Number(pcts[uid]) || 0) / sumPcts);
    }
  } else if (mode === 'equitable') {
    // Répartition selon revenus + aides (si coché par l'user)
    const aidesRep = repartCfg?.aidesRepartition || {};
    const revForDist = _mk(uids);
    for (const uid of uids) revForDist[uid] = revU[uid] + (aidesRep[uid] ? aidesU[uid] : 0);
    const base = _sum(revForDist) || 1;
    for (const uid of uids) {
      partSharedU[uid] = (totalCommon + (useBudgetOps ? bopsShared : 0)) * (revForDist[uid] / base);
    }
  } else {
    // 'separe' : coûts partagés divisés équitablement
    for (const uid of uids) {
      partSharedU[uid] = (totalCommon + (useBudgetOps ? bopsShared : 0)) / N;
    }
  }

  // ── Part totale par user ──
  const partU = _mk(uids);
  for (const uid of uids) {
    // en mode solo, partSharedU inclut déjà les extras/budgetOps
    partU[uid] = partSharedU[uid]
      + chgPersonalU[uid]
      + chgCustomU[uid]         // charges à répartition personnalisée
      + achPersonalU[uid]
      + achCustomU[uid]         // achats à répartition personnalisée
      + (mode === 'solo' ? 0 : (useBudgetOps ? bopsU[uid] : extU[uid]));
  }

  // ── À payer = part + imprévus (perso charges exclues) ──
  const aPayerU = _mk(uids);
  for (const uid of uids) aPayerU[uid] = partU[uid] + impU[uid];

  // ── Solde = (revenus + primes + aides) − aPayer ──
  const soldeU = _mk(uids);
  for (const uid of uids) soldeU[uid] = revU[uid] + priU[uid] + aidesU[uid] - aPayerU[uid];

  // ── Dépenses = aPayer + charges perso (tracking complet) ──
  const depU = _mk(uids);
  for (const uid of uids) depU[uid] = aPayerU[uid] + chgPersoU[uid];

  // ── Économie possible (sans imprévus ni achats exc.) ──
  // La part d'achats partagés est recalculée selon le mode (identique à partSharedU mais sans les charges)
  const ecoU = _mk(uids);
  for (const uid of uids) {
    const achP = achPersonalU[uid] + achCustomU[uid];
    let shAchU;
    if (mode === 'solo') {
      shAchU = uid === uids[0] ? totalSharedAch : 0;
    } else if (mode === 'fixe') {
      const pcts    = repartCfg?.pcts ?? {};
      const sumPcts = uids.reduce((s, u) => s + (Number(pcts[u]) || 0), 0) || 100;
      shAchU = totalSharedAch * ((Number(pcts[uid]) || 0) / sumPcts);
    } else if (mode === 'equitable') {
      const aidesRep   = repartCfg?.aidesRepartition || {};
      const revForDist = _mk(uids);
      for (const u of uids) revForDist[u] = revU[u] + (aidesRep[u] ? aidesU[u] : 0);
      const base = _sum(revForDist) || 1;
      shAchU = totalSharedAch * (revForDist[uid] / base);
    } else {
      shAchU = totalSharedAch / N;
    }
    ecoU[uid] = revU[uid] + priU[uid] + aidesU[uid] - (aPayerU[uid] - impU[uid] - achP - shAchU);
  }

  // ── Taux d'épargne (par user = solde/revenus+aides+primes ; total = agrégat) ──
  const txU = _mk(uids);
  for (const uid of uids) {
    const rp = revU[uid] + priU[uid] + aidesU[uid];
    txU[uid] = rp > 0 ? soldeU[uid] / rp : 0;
  }
  const _totalRev = _sum(revU) + _sum(priU) + _sum(aidesU);
  const txTotal   = _totalRev > 0 ? _sum(soldeU) / _totalRev : 0;

  // ── Taux d'épargne possible (sans imprévus ni achats exc.) ──
  const txEcoU = _mk(uids);
  for (const uid of uids) {
    const rp = revU[uid] + priU[uid] + aidesU[uid];
    txEcoU[uid] = rp > 0 ? ecoU[uid] / rp : 0;
  }
  const txEcoTotal = _totalRev > 0 ? _sum(ecoU) / _totalRev : 0;

  const mkKPI = map => ({ total: _sum(map), byUser: { ...map } });

  return {
    revenus:      mkKPI(revU),
    primes:       mkKPI(priU),
    aides:        mkKPI(aidesU),
    charges:      { total: totalSharedChg + _sum(chgPersonalU) + _sum(chgCustomU), byUser: Object.fromEntries(uids.map(uid => [uid, chgPersonalU[uid] + chgCustomU[uid] + partSharedU[uid] * (totalSharedChg / (totalCommon || 1))])) },
    chargesPerso: mkKPI(chgPersoU),
    courses:      mkKPI(crsU),
    extras:       mkKPI(extU),
    achats:       { total: totalSharedAch + _sum(achPersonalU) + _sum(achCustomU), byUser: Object.fromEntries(uids.map(uid => [uid, achPersonalU[uid] + achCustomU[uid]])) },
    imprevus:     mkKPI(impU),
    depenses:     mkKPI(depU),
    part:         mkKPI(partU),
    aPayer:       mkKPI(aPayerU),
    solde:        mkKPI(soldeU),
    ecoPossible:  mkKPI(ecoU),
    txEpargne:    { total: txTotal,    byUser: { ...txU } },
    txEcoPossible:{ total: txEcoTotal, byUser: { ...txEcoU } },
    _meta: { mode, N, totalSharedChg, totalSharedAch, totalCrs },
  };
}

/**
 * Calcule les agrégats annuels depuis un tableau de résultats mensuels.
 */
export function calcYear(monthsResults) {
  if (!monthsResults || !monthsResults.length) return null;

  const allUids = new Set();
  for (const r of monthsResults) {
    if (r?.revenus?.byUser) Object.keys(r.revenus.byUser).forEach(u => allUids.add(u));
  }

  const sum = (field) => {
    const byUser = {};
    for (const uid of allUids) {
      byUser[uid] = monthsResults.reduce((s, r) => s + (r?.[field]?.byUser?.[uid] ?? 0), 0);
    }
    const total = monthsResults.reduce((s, r) => s + (r?.[field]?.total ?? 0), 0);
    return { total, byUser };
  };

  const revenus  = sum('revenus');
  const primes   = sum('primes');
  const solde    = sum('solde');
  const depenses = sum('depenses');
  const totalIncome = revenus.total + primes.total;

  const txEpargneByUser = {};
  for (const uid of allUids) {
    const inc = (revenus.byUser[uid] ?? 0) + (primes.byUser[uid] ?? 0);
    txEpargneByUser[uid] = inc > 0 ? (solde.byUser[uid] ?? 0) / inc : 0;
  }

  return {
    revenus,
    primes,
    charges:      sum('charges'),
    chargesPerso: sum('chargesPerso'),
    courses:      sum('courses'),
    extras:       sum('extras'),
    achats:       sum('achats'),
    imprevus:     sum('imprevus'),
    depenses,
    part:         sum('part'),
    aPayer:       sum('aPayer'),
    solde,
    ecoPossible:  sum('ecoPossible'),
    epargne:      solde,
    txEpargne: {
      total: totalIncome > 0 ? solde.total / totalIncome : 0,
      byUser: txEpargneByUser,
    },
  };
}

/**
 * Calcul prévisionnel jour par jour pour un mois.
 */
export function calcPrevisionnel({ totalIncome, charges, year, month, simDay, deductions = 0, weeklyGroceries = 0 }) {
  const daysInMonth = new Date(year, month, 0).getDate();
  const today       = new Date();
  const todayDay    = simDay != null
    ? Number(simDay)
    : (today.getFullYear() === year && today.getMonth() + 1 === month ? today.getDate() : 0);

  // Indexe les charges par jour de prélèvement (déjà expandées par getChargesForMonth)
  const chargesByDay = {};
  for (const c of (charges ?? [])) {
    if (!c.active) continue;
    const day = Number(c.dayOfMonth);
    if (!day || day < 1 || day > 31) continue;
    const amt = Number(c.amount) || 0;
    if (!amt) continue;
    const applicable = c.months === 'all' || (Array.isArray(c.months) && c.months.includes(month));
    if (!applicable) continue;
    if (!chargesByDay[day]) chargesByDay[day] = [];
    chargesByDay[day].push({ label: c.label, amount: amt });
  }

  // Courses hebdomadaires : fonctionnalité non activée (weeklyGroceries toujours 0)

  // Le solde de départ est le revenu net des dépenses déjà connues (courses, extras, imprévus)
  let balance = (Number(totalIncome) || 0) - (Number(deductions) || 0);
  const days  = [];

  for (let d = 1; d <= daysInMonth; d++) {
    const chargeItems = chargesByDay[d] ?? [];
    const chargesAmt  = chargeItems.reduce((s, c) => s + c.amount, 0);
    balance -= chargesAmt;

    days.push({
      day:         d,
      chargeItems,
      balance:     Math.round(balance * 100) / 100,
      isPast:      todayDay > 0 && d < todayDay,
      isToday:     d === todayDay,
    });
  }

  return { days, todayDay };
}

/**
 * Calcule le solde d'épargne à partir de la dernière confirmation + opérations.
 */
export function calcSavingsBalance(latestConfirmed, allOperations) {
  if (!latestConfirmed) {
    const total = (allOperations ?? []).reduce((s, o) => s + (Number(o.amount) || 0), 0);
    return { balance: total, base: 0, delta: total, latest: null, opsSince: allOperations ?? [] };
  }

  const base = Number(latestConfirmed.amount) || 0;
  const opsSince = (allOperations ?? []).filter(op => {
    if (op.id === latestConfirmed.id) return false;
    if (op.year  > latestConfirmed.year)  return true;
    if (op.year  < latestConfirmed.year)  return false;
    if (op.month > latestConfirmed.month) return true;
    if (op.month < latestConfirmed.month) return false;
    return (op.day || 1) >= (latestConfirmed.confirmedDay || 1);
  });

  const delta = opsSince.reduce((s, op) => s + (Number(op.amount) || 0), 0);
  return { balance: base + delta, base, delta, latest: latestConfirmed, opsSince };
}

/**
 * Simule l'impact d'un revenu supplémentaire par utilisateur.
 * @param {object} baseResult   - Résultat de calcMonth()
 * @param {object} extraByUser  - { "userId": montantExtra }
 * @param {Array}  users        - Liste des utilisateurs actifs
 */
export function whatIf(baseResult, extraByUser, users) {
  if (!baseResult) return null;

  const uids = (users || []).map(u => String(u.id));
  let deltaTotal = 0;

  const newSoldeByUser = {};
  const newTxByUser    = {};

  for (const uid of uids) {
    const extra  = Number(extraByUser?.[uid]) || 0;
    deltaTotal  += extra;
    const oldSolde = baseResult.solde?.byUser?.[uid] ?? 0;
    const oldRev   = (baseResult.revenus?.byUser?.[uid] ?? 0) + (baseResult.primes?.byUser?.[uid] ?? 0);
    newSoldeByUser[uid] = oldSolde + extra;
    const newRev = oldRev + extra;
    newTxByUser[uid] = newRev > 0 ? newSoldeByUser[uid] / newRev : 0;
  }

  const oldTotalRev = (baseResult.revenus?.total ?? 0) + (baseResult.primes?.total ?? 0);
  const newTotalRev = oldTotalRev + deltaTotal;

  return {
    deltaTotal,
    newSolde: {
      total:  (baseResult.solde?.total ?? 0) + deltaTotal,
      byUser: newSoldeByUser,
    },
    newTxEpargne: {
      total:  newTotalRev > 0 ? ((baseResult.solde?.total ?? 0) + deltaTotal) / newTotalRev : 0,
      byUser: newTxByUser,
    },
  };
}
