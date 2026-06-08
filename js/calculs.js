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
export function calcMonth(monthData, charges, achats, repartCfg, users) {
  const uids = (users || []).map(u => _uid(u.id));
  const N    = uids.length || 1;
  const mode = N <= 1 ? 'solo' : (repartCfg?.mode || 'separe');

  // ── Données saisies par utilisateur ──
  const revU = _mk(uids), priU = _mk(uids);
  const crsU = _mk(uids), extU = _mk(uids), impU = _mk(uids);

  for (const uid of uids) {
    const ud   = monthData?.users?.[uid] ?? {};
    revU[uid]  = Number(ud.revenus)  || 0;
    priU[uid]  = Number(ud.primes)   || 0;
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

  for (const c of (charges ?? [])) {
    const amt  = Number(c.amount) || 0;
    const qui  = _uid(c.qui);
    if (c.perso) {
      const target = uids.includes(qui) ? qui : uids[0];
      if (target) chgPersoU[target] += amt;
    } else if (c.qui === 'shared' || !uids.includes(qui)) {
      totalSharedChg += amt;
    } else {
      chgPersonalU[qui] += amt;
    }
  }

  // ── Achats exceptionnels ──
  const achPersonalU = _mk(uids);
  let   totalSharedAch = 0;

  for (const a of (achats ?? [])) {
    if (a.craquage_source === 'savings') continue;
    const amt = Number(a.amount) || 0;
    const qui = _uid(a.qui);
    if (a.qui === 'shared' || !uids.includes(qui)) {
      totalSharedAch += amt;
    } else {
      achPersonalU[qui] += amt;
    }
  }

  // ── Part des coûts partagés selon le mode ──
  const partSharedU = _mk(uids);
  const totalCommon = totalSharedChg + totalCrs + totalSharedAch;

  if (mode === 'solo') {
    if (uids[0]) partSharedU[uids[0]] = totalCommon + _sum(extU);
  } else if (mode === 'fixe') {
    const pcts    = repartCfg?.pcts ?? {};
    const sumPcts = uids.reduce((s, uid) => s + (Number(pcts[uid]) || 0), 0) || 100;
    for (const uid of uids) {
      partSharedU[uid] = totalCommon * ((Number(pcts[uid]) || 0) / sumPcts);
    }
  } else if (mode === 'equitable') {
    const base = totalRev || 1;
    for (const uid of uids) {
      partSharedU[uid] = totalCommon * (revU[uid] / base);
    }
  } else {
    // 'separe' : coûts partagés divisés équitablement
    for (const uid of uids) {
      partSharedU[uid] = totalCommon / N;
    }
  }

  // ── Part totale par user ──
  const partU = _mk(uids);
  for (const uid of uids) {
    // en mode solo, partSharedU inclut déjà les extras
    partU[uid] = partSharedU[uid]
      + chgPersonalU[uid]
      + achPersonalU[uid]
      + (mode === 'solo' ? 0 : extU[uid]);
  }

  // ── À payer = part + imprévus (perso charges exclues) ──
  const aPayerU = _mk(uids);
  for (const uid of uids) aPayerU[uid] = partU[uid] + impU[uid];

  // ── Solde = (revenus + primes) − aPayer ──
  const soldeU = _mk(uids);
  for (const uid of uids) soldeU[uid] = revU[uid] + priU[uid] - aPayerU[uid];

  // ── Dépenses = aPayer + charges perso (tracking complet) ──
  const depU = _mk(uids);
  for (const uid of uids) depU[uid] = aPayerU[uid] + chgPersoU[uid];

  // ── Économie possible (sans imprévus ni achats exc.) ──
  const ecoU = _mk(uids);
  for (const uid of uids) {
    const achP  = achPersonalU[uid];
    const shAch = mode === 'solo' ? totalSharedAch : totalSharedAch / N;
    ecoU[uid]   = revU[uid] + priU[uid] - (aPayerU[uid] - impU[uid] - achP - shAch);
  }

  // ── Taux d'épargne ──
  const txU = _mk(uids);
  for (const uid of uids) {
    const rp = revU[uid] + priU[uid];
    txU[uid] = rp > 0 ? soldeU[uid] / rp : 0;
  }

  const mkKPI = map => ({ total: _sum(map), byUser: { ...map } });

  return {
    revenus:      mkKPI(revU),
    primes:       mkKPI(priU),
    charges:      { total: totalSharedChg + _sum(chgPersonalU), byUser: Object.fromEntries(uids.map(uid => [uid, chgPersonalU[uid] + partSharedU[uid] * (totalSharedChg / (totalCommon || 1))])) },
    chargesPerso: mkKPI(chgPersoU),
    courses:      mkKPI(crsU),
    extras:       mkKPI(extU),
    achats:       { total: totalSharedAch + _sum(achPersonalU), byUser: Object.fromEntries(uids.map(uid => [uid, achPersonalU[uid]])) },
    imprevus:     mkKPI(impU),
    depenses:     mkKPI(depU),
    part:         mkKPI(partU),
    aPayer:       mkKPI(aPayerU),
    solde:        mkKPI(soldeU),
    ecoPossible:  mkKPI(ecoU),
    txEpargne:    mkKPI(txU),
    _meta: { mode, N, totalSharedChg, totalSharedAch, totalCrs },
  };
}

/**
 * Calcule les agrégats annuels depuis un tableau de résultats mensuels.
 */
