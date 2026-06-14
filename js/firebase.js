// ============================================================
// js/firebase.js — Firebase Auth + Firestore init + gestion du foyer
// ============================================================
// Le SDK Firebase est chargé dynamiquement (CDN officiel) pour ne pas
// alourdir l'app quand Firebase n'est pas configuré.
//
// Config stockée dans IDB : getSetting('firebaseConfig') → JSON string
// {apiKey, authDomain, projectId, storageBucket, messagingSenderId, appId}
// ============================================================

import { getSetting, setSetting } from './db.js';

const FB_APP_NAME = '_budget';
const FB_SDK      = 'https://www.gstatic.com/firebasejs/10.14.1';

let _app   = null;
let _auth  = null;
let _db    = null;

// ── Helpers SDK (lazy) ─────────────────────────────────────────────────────

async function _sdkApp()       { return import(`${FB_SDK}/firebase-app.js`); }
async function _sdkAuth()      { return import(`${FB_SDK}/firebase-auth.js`); }
async function _sdkFirestore() { return import(`${FB_SDK}/firebase-firestore.js`); }

async function _loadConfig() {
  const raw = await getSetting('firebaseConfig');
  if (!raw) throw new Error('Configuration Firebase manquante dans les réglages.');
  try   { return typeof raw === 'string' ? JSON.parse(raw) : raw; }
  catch { throw new Error('Configuration Firebase invalide (JSON mal formé).'); }
}

// ── Init ──────────────────────────────────────────────────────────────────

/** Initialise le SDK Firebase. Lance une exception si la config est absente/invalide. */
export async function initFirebase() {
  if (_app) return true;

  const cfg = await _loadConfig();
  if (!cfg?.apiKey || !cfg?.projectId) throw new Error('firebaseConfig incomplet (apiKey ou projectId manquant).');

  const { initializeApp, getApps, getApp } = await _sdkApp();
  const existing = getApps().find(a => a.name === FB_APP_NAME);
  _app = existing ?? initializeApp(cfg, FB_APP_NAME);

  const { getAuth, browserLocalPersistence, setPersistence } = await _sdkAuth();
  const { getFirestore } = await _sdkFirestore();
  _auth = getAuth(_app);
  await setPersistence(_auth, browserLocalPersistence);
  _db   = getFirestore(_app);

  return true;
}

/** Retourne true si la config Firebase est présente dans IDB (sans charger le SDK). */
export async function isFirebaseConfigured() {
  const raw = await getSetting('firebaseConfig');
  if (!raw) return false;
  try {
    const cfg = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return !!(cfg?.apiKey && cfg?.projectId);
  } catch { return false; }
}

export function isFirebaseReady() { return !!_app; }
export function getFirestoreDb()  { return _db; }
export function getFirebaseAuth() { return _auth; }

// ── Auth ──────────────────────────────────────────────────────────────────

export async function getCurrentUser() {
  return _auth?.currentUser ?? null;
}

/** Connexion email/password */
export async function signIn(email, password) {
  const { signInWithEmailAndPassword } = await _sdkAuth();
  const cred = await signInWithEmailAndPassword(_auth, email, password);
  return cred.user;
}

/** Création de compte email/password */
export async function signUp(email, password) {
  const { createUserWithEmailAndPassword } = await _sdkAuth();
  const cred = await createUserWithEmailAndPassword(_auth, email, password);
  return cred.user;
}

/** Déconnexion Firebase */
export async function signOutFirebase() {
  const { signOut } = await _sdkAuth();
  await signOut(_auth);
  await setSetting('foyerId', null);
}

/** Listener sur l'état d'authentification. Retourne l'unsubscribe. */
export async function onAuthChange(callback) {
  const { onAuthStateChanged } = await _sdkAuth();
  return onAuthStateChanged(_auth, callback);
}

// ── Foyer ─────────────────────────────────────────────────────────────────

/**
 * Crée un nouveau foyer pour l'utilisateur courant.
 * Retourne le foyerId (à partager avec les autres membres).
 */
export async function createFoyer() {
  if (!_auth?.currentUser) throw new Error('Non authentifié.');
  const uid = _auth.currentUser.uid;

  const { collection, addDoc, serverTimestamp } = await _sdkFirestore();
  const ref = await addDoc(collection(_db, 'foyers'), {
    members:   [uid],
    createdBy: uid,
    createdAt: serverTimestamp(),
  });

  await setSetting('foyerId', ref.id);
  return ref.id;
}

/**
 * Rejoint un foyer existant via son foyerId.
 * L'utilisateur courant est ajouté à la liste des membres.
 */
export async function joinFoyer(foyerId) {
  if (!_auth?.currentUser) throw new Error('Non authentifié.');
  const uid = _auth.currentUser.uid;
  const id  = foyerId.trim();

  const { doc, getDoc, updateDoc, arrayUnion } = await _sdkFirestore();
  const ref  = doc(_db, 'foyers', id);
  const snap = await getDoc(ref);

  if (!snap.exists()) throw new Error('Foyer introuvable. Vérifiez le code.');

  const data = snap.data();
  if (!data.members.includes(uid)) {
    await updateDoc(ref, { members: arrayUnion(uid) });
  }

  await setSetting('foyerId', id);
  return id;
}

/** Retourne le foyerId enregistré dans IDB. */
export async function getSavedFoyerId() {
  return getSetting('foyerId');
}
