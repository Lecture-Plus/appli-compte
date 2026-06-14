// ============================================================
// js/fb-sync.js — Synchronisation Firestore temps réel
// ============================================================
// Stratégie : snapshot unique par foyer (document Firestore).
//   - Chaque appareil push un export complet après chaque modif (debounce 5s).
//   - onSnapshot déclenche un import si le snapshot distant est plus récent.
//   - Le backup Drive reste indépendant et continu (filet de sécurité).
// ============================================================

import { exportAllData, importAllData, setSetting, getSetting } from './db.js';
import { getFirestoreDb, getCurrentUser, isFirebaseReady }      from './firebase.js';
import { showToast }                                             from './utils.js';
import { emit }                                                  from './events.js';

const FB_SDK      = 'https://www.gstatic.com/firebasejs/10.14.1';
const FB_SYNC_KEY = 'fbLastSync';
const DEBOUNCE_MS = 6_000;   // 6 s après la dernière modif
const LOOP_GAP_MS = 8_000;   // ignorer les retours de nos propres pushes

// ID unique par appareil (persiste en localStorage) — permet de distinguer
// deux appareils utilisant le même compte Firebase
function _getDeviceId() {
  let id = localStorage.getItem('_fbDeviceId');
  if (!id) { id = Math.random().toString(36).slice(2) + Date.now().toString(36); localStorage.setItem('_fbDeviceId', id); }
  return id;
}

let _unsubscribe  = null;
let _syncTimer    = null;
let _isSyncing    = false;
let _isDirty      = false;
let _lastPushAt   = 0;

// ── Indicateur visuel dans le header ──────────────────────────────────────

export function setFbStatus(status) { // 'none' | 'ok' | 'syncing' | 'error'
  const dot = document.getElementById('fb-sync-dot');
  if (!dot) return;
  dot.dataset.status = status;
  const labels = {
    none:    'Firebase non configuré',
    ok:      'Sync Firebase actif',
    syncing: 'Synchronisation Firebase…',
    error:   'Erreur sync Firebase',
  };
  dot.title = labels[status] ?? '';
}

export function getFbStatus() {
  return document.getElementById('fb-sync-dot')?.dataset.status ?? 'none';
}

// ── Marquer les données comme modifiées ───────────────────────────────────

export function markFirebaseDirty() { _isDirty = true; }

// ── Push ──────────────────────────────────────────────────────────────────

async function _sdkFirestore() {
  return import(`${FB_SDK}/firebase-firestore.js`);
}

/**
 * Exporte les données locales et les écrit dans Firestore.
 * Silencieux en cas d'erreur (Drive reste le backup principal).
 */
export async function pushToFirebase(foyerId) {
  if (_isSyncing) return;
  const user = await getCurrentUser();
  if (!user || !foyerId) return;

  _isSyncing = true;
  setFbStatus('syncing');

  try {
    const { doc, setDoc, serverTimestamp } = await _sdkFirestore();
    const db   = getFirestoreDb();
    const data = await exportAllData();

    await setDoc(
      doc(db, 'foyers', foyerId, 'snapshots', 'current'),
      { data, updatedAt: serverTimestamp(), updatedBy: _getDeviceId() }
    );

    await setSetting(FB_SYNC_KEY, new Date().toISOString());
    _isDirty      = false;
    _lastPushAt   = Date.now();
    setFbStatus('ok');
    console.log('[FB-Sync] Push OK');
  } catch (e) {
    console.warn('[FB-Sync] Push échoué :', e.message);
    setFbStatus('error');
  } finally {
    _isSyncing = false;
  }
}

// ── Pull ─────────────────────────────────────────────────────────────────

/**
 * Récupère le snapshot Firestore et l'importe si plus récent que local.
 * Retourne true si un import a été effectué.
 */
export async function pullFromFirebase(foyerId) {
  const user = await getCurrentUser();
  if (!user || !foyerId) return false;

  try {
    const { doc, getDoc } = await _sdkFirestore();
    const db   = getFirestoreDb();
    const snap = await getDoc(doc(db, 'foyers', foyerId, 'snapshots', 'current'));

    if (!snap.exists()) return false;
    const remote = snap.data();
    if (!remote?.data?.appName) return false;

    const remoteTs = remote.updatedAt?.toDate?.()?.getTime() ?? 0;
    const localStr = await getSetting(FB_SYNC_KEY);
    const localTs  = localStr ? new Date(localStr).getTime() : 0;

    if (remoteTs <= localTs + 3_000) return false; // local déjà à jour

    await importAllData(remote.data);
    await setSetting(FB_SYNC_KEY, new Date().toISOString());
    emit('db:write', { store: 'firebase-pull' });
    return true;
  } catch (e) {
    console.warn('[FB-Sync] Pull échoué :', e.message);
    return false;
  }
}

// ── Listener temps réel ───────────────────────────────────────────────────

/**
 * Démarre l'écoute temps réel du snapshot Firestore.
 * Déclenche un import automatique si une modification est détectée
 * depuis un autre appareil.
 */
export async function startFirebaseSync(foyerId) {
  stopFirebaseSync(); // nettoyer l'ancien listener si existant

  const user = await getCurrentUser();
  if (!user || !foyerId) { setFbStatus('none'); return; }

  // Pull initial (rattraper d'éventuelles modifs hors-ligne)
  setFbStatus('syncing');
  const imported = await pullFromFirebase(foyerId);
  if (imported) {
    showToast('✅ Données récupérées depuis Firestore', 'success', 3000);
    emit('db:write', { store: 'firebase-pull' });
  }
  setFbStatus('ok');

  // Listener temps réel
  const { doc, onSnapshot } = await _sdkFirestore();
  const db  = getFirestoreDb();
  const ref = doc(db, 'foyers', foyerId, 'snapshots', 'current');

  _unsubscribe = onSnapshot(ref, async (snap) => {
    if (!snap.exists()) return;
    const remote = snap.data();
    if (!remote?.data?.appName) return;

    // Ignorer nos propres pushes (éviter la boucle)
    if (remote.updatedBy === _getDeviceId()) {
      const remoteTs = remote.updatedAt?.toDate?.()?.getTime() ?? 0;
      if (Date.now() - remoteTs < LOOP_GAP_MS) return;
    }

    // Vérifier si le snapshot distant est plus récent
    const remoteTs = remote.updatedAt?.toDate?.()?.getTime() ?? 0;
    const localStr = await getSetting(FB_SYNC_KEY);
    const localTs  = localStr ? new Date(localStr).getTime() : 0;
    if (remoteTs <= localTs + 3_000) return;

    console.log('[FB-Sync] Mise à jour distante détectée — import…');
    setFbStatus('syncing');
    try {
      await importAllData(remote.data);
      await setSetting(FB_SYNC_KEY, new Date().toISOString());
      emit('db:write', { store: 'firebase-pull' });
      showToast('🔄 Données synchronisées depuis un autre appareil', 'info', 3000);
      setFbStatus('ok');
    } catch (e) {
      console.warn('[FB-Sync] Import échoué :', e.message);
      setFbStatus('error');
    }
  }, (err) => {
    console.warn('[FB-Sync] Listener error :', err.message);
    setFbStatus('error');
  });

  // Timer de push automatique (debounce)
  _syncTimer = setInterval(async () => {
    if (!_isDirty || _isSyncing) return;
    await pushToFirebase(foyerId);
  }, DEBOUNCE_MS);

  console.log('[FB-Sync] Sync démarré pour foyer', foyerId);
}

// ── Arrêt ─────────────────────────────────────────────────────────────────

export function stopFirebaseSync() {
  if (_unsubscribe) { _unsubscribe(); _unsubscribe = null; }
  if (_syncTimer)   { clearInterval(_syncTimer);  _syncTimer  = null; }
  setFbStatus('none');
}

export function isFbSyncActive() { return !!_unsubscribe; }

// ── Initialisation au démarrage de l'app ─────────────────────────────────

/**
 * Appelé depuis app.js après initDriveSync().
 * Lance Firebase si configuré + authentifié + foyer enregistré.
 */
export async function initFirebaseSync() {
  try {
    const { isFirebaseConfigured, initFirebase, getSavedFoyerId } = await import('./firebase.js');

    if (!(await isFirebaseConfigured())) return;
    await initFirebase();

    const { onAuthStateChanged } = await import(`${FB_SDK}/firebase-auth.js`);
    const { getFirebaseAuth }    = await import('./firebase.js');
    const auth = getFirebaseAuth();

    // Attendre la résolution de l'état auth (max 3s)
    const user = await new Promise(resolve => {
      const unsub = onAuthStateChanged(auth, u => { unsub(); resolve(u); });
      setTimeout(() => resolve(null), 3000);
    });

    if (!user) { setFbStatus('none'); return; }

    const foyerId = await getSavedFoyerId();
    if (!foyerId) { setFbStatus('none'); return; }

    await startFirebaseSync(foyerId);
  } catch (e) {
    console.warn('[FB-Sync] Init échouée :', e.message);
    setFbStatus('error');
  }
}
