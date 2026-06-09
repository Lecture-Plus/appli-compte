// ============================================================
// tests/calculs.test.js – Tests unitaires du moteur calcMonth
// Runner : Node 18+ (node --test tests/calculs.test.js)
// ============================================================

import { test } from 'node:test';
import assert   from 'node:assert/strict';
import { calcMonth }   from '../js/calculs.js';
import { validateImportData } from '../js/db.js';

// ── Helpers ────────────────────────────────────────────────
const user1 = { id: '1', name: 'Alice' };
const user2 = { id: '2', name: 'Bob' };

function md(u1 = {}, u2 = null) {
  const users = { '1': { revenus: 2000, primes: 0, courses: 0, extras: 0, imprevus: 0, aides: 0, ...u1 } };
  if (u2) users['2'] = { revenus: 2000, primes: 0, courses: 0, extras: 0, imprevus: 0, aides: 0, ...u2 };
  return { users };
}

// ── Mode solo ──────────────────────────────────────────────
test('solo : solde = revenus − charges', () => {
  const kpi = calcMonth(
    md({ revenus: 3000 }),
    [{ amount: 1000, qui: 'shared' }],
    [],
    { mode: 'solo' },
    [user1]
  );
  assert.equal(kpi.solde.total, 2000);
  assert.equal(kpi.revenus.total, 3000);
  assert.equal(kpi.charges.total, 1000);
});

test('solo : solde positif avec primes', () => {
  const kpi = calcMonth(
    md({ revenus: 2000, primes: 500 }),
    [{ amount: 1000, qui: 'shared' }],
    [],
    { mode: 'solo' },
    [user1]
  );
  assert.equal(kpi.solde.total, 1500);
});

test('solo : solde négatif si charges > revenus', () => {
  const kpi = calcMonth(
    md({ revenus: 500 }),
    [{ amount: 1000, qui: 'shared' }],
    [],
    { mode: 'solo' },
    [user1]
  );
  assert.equal(kpi.solde.total, -500);
});

// ── Mode séparé ────────────────────────────────────────────
test('separe : partage égal des charges partagées', () => {
  const kpi = calcMonth(
    md({ revenus: 2000 }, { revenus: 2000 }),
    [{ amount: 1000, qui: 'shared' }],
    [],
    { mode: 'separe' },
    [user1, user2]
  );
  assert.equal(kpi.solde.total, 3000); // 4000 revenus − 1000 charges
  assert.equal(kpi.solde.byUser['1'], 1500);
  assert.equal(kpi.solde.byUser['2'], 1500);
});

test('separe : charge personnelle attribuée au bon user', () => {
  const kpi = calcMonth(
    md({ revenus: 2000 }, { revenus: 2000 }),
    [{ amount: 400, qui: '1' }],   // charge dédiée à Alice
    [],
    { mode: 'separe' },
    [user1, user2]
  );
  assert.equal(kpi.solde.byUser['1'], 1600);
  assert.equal(kpi.solde.byUser['2'], 2000);
});

// ── Mode fixe ──────────────────────────────────────────────
test('fixe : répartition 60/40', () => {
  const kpi = calcMonth(
    md({ revenus: 3000 }, { revenus: 1000 }),
    [{ amount: 1000, qui: 'shared' }],
    [],
    { mode: 'fixe', pcts: { '1': 60, '2': 40 } },
    [user1, user2]
  );
  assert.equal(kpi.solde.byUser['1'], 3000 - 600);  // 2400
  assert.equal(kpi.solde.byUser['2'], 1000 - 400);  // 600
});

// ── Mode équitable ──────────────────────────────────────────
test('equitable : répartition proportionnelle aux revenus', () => {
  const kpi = calcMonth(
    md({ revenus: 3000 }, { revenus: 1000 }),
    [{ amount: 1000, qui: 'shared' }],
    [],
    { mode: 'equitable' },
    [user1, user2]
  );
  // Alice paie 3000/4000 * 1000 = 750, Bob paie 250
  assert.equal(kpi.solde.byUser['1'], 3000 - 750);
  assert.equal(kpi.solde.byUser['2'], 1000 - 250);
});

// ── Achats exceptionnels ───────────────────────────────────
test('achats craquage_source=savings exclus du solde', () => {
  const kpi = calcMonth(
    md({ revenus: 2000 }),
    [],
    [{ amount: 500, qui: '1', craquage_source: 'savings' }],
    { mode: 'solo' },
    [user1]
  );
  assert.equal(kpi.solde.total, 2000);  // l'achat sur épargne n'impacte pas le solde
});

test('achat partagé impacte les deux', () => {
  const kpi = calcMonth(
    md({ revenus: 2000 }, { revenus: 2000 }),
    [],
    [{ amount: 400, qui: 'shared' }],
    { mode: 'separe' },
    [user1, user2]
  );
  assert.equal(kpi.solde.byUser['1'], 1800);
  assert.equal(kpi.solde.byUser['2'], 1800);
});

// ── Taux d'épargne ─────────────────────────────────────────
test('taux épargne = solde / (revenus+primes)', () => {
  const kpi = calcMonth(
    md({ revenus: 2000 }),
    [{ amount: 1000, qui: 'shared' }],
    [],
    { mode: 'solo' },
    [user1]
  );
  assert.equal(kpi.txEpargne.total, 0.5);
});

// ── validateImportData ─────────────────────────────────────
test('validateImportData : données valides', () => {
  const { ok, errors } = validateImportData({
    appName: 'ComptaPlus',
    version: 5,
    users: [{ id: '1', name: 'Alice' }],
    monthlyData: [],
    charges: [],
  });
  assert.ok(ok);
  assert.equal(errors.length, 0);
});

test('validateImportData : null → ko', () => {
  const { ok } = validateImportData(null);
  assert.equal(ok, false);
});

test('validateImportData : appName incorrect → erreur', () => {
  const { ok, errors } = validateImportData({ appName: 'WrongApp' });
  assert.equal(ok, false);
  assert.ok(errors.some(e => e.includes('appName')));
});

test('validateImportData : users non-tableau → erreur', () => {
  const { ok, errors } = validateImportData({ appName: 'ComptaPlus', users: 'bad' });
  assert.equal(ok, false);
  assert.ok(errors.some(e => e.includes('users')));
});

test('validateImportData : user sans id → erreur', () => {
  const { ok, errors } = validateImportData({
    appName: 'ComptaPlus',
    users: [{ name: 'Alice' }],  // id manquant
  });
  assert.equal(ok, false);
  assert.ok(errors.some(e => e.includes('id')));
});
