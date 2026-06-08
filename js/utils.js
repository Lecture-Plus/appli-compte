// ============================================================
// js/utils.js – Fonctions utilitaires partagées
// ============================================================

export const MOIS = [
  'Janvier','Février','Mars','Avril','Mai','Juin',
  'Juillet','Août','Septembre','Octobre','Novembre','Décembre'
];

export const MOIS_COURT = [
  'Jan','Fév','Mar','Avr','Mai','Juin',
  'Juil','Août','Sep','Oct','Nov','Déc'
];

export const CATEGORIES = [
  { id: 'logement',     label: 'Logement',          emoji: '🏠' },
  { id: 'transport',    label: 'Transport',          emoji: '🚗' },
  { id: 'alimentation', label: 'Alimentation',       emoji: '🛒' },
  { id: 'abonnements',  label: 'Abonnements',        emoji: '📱' },
  { id: 'sante',        label: 'Santé',              emoji: '💊' },
  { id: 'loisirs',      label: 'Loisirs',            emoji: '🎮' },
  { id: 'habillement',  label: 'Habillement',        emoji: '👗' },
  { id: 'banque',       label: 'Banque / Assurance', emoji: '🏦' },
  { id: 'enfants',      label: 'Enfants',            emoji: '👶' },
  { id: 'autre',        label: 'Autre',              emoji: '📦' },
];

export const QUI_OPTIONS = [
  { id: 'p1',       label: 'Personne 1' },
  { id: 'p2',       label: 'Personne 2' },
  { id: 'les_deux', label: 'Les deux' },
  { id: '50_50',    label: '50 / 50' },
];

/** Formatters singleton — instanciés une seule fois, réutilisés à chaque appel */
const _eurFmt = new Intl.NumberFormat('fr-FR', {
  style:    'currency',
  currency: 'EUR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const _pctFmt = new Intl.NumberFormat('fr-FR', {
  style:               'percent',
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

/** Formate un montant en euros */
export function eur(value) {
  return _eurFmt.format(Number(value) || 0);
}

/** Formate un pourcentage */
export function pct(value, decimals = 1) {
  const v = (Number(value) || 0) * 100;
  return v.toFixed(decimals) + ' %';
}

/** Nom du mois (1-12) */
export function nomMois(m) {
  return MOIS[(m - 1)] ?? '';
}

/** Nom court du mois (1-12) */
export function nomMoisCourt(m) {
  return MOIS_COURT[(m - 1)] ?? '';
}

/** Retourne l'année et le mois courant */
export function today() {
  const d = new Date();
  return { year: d.getFullYear(), month: d.getMonth() + 1 };
}

/** Avance ou recule d'un mois */
export function addMonth(year, month, delta = 1) {
  let m = month + delta;
  let y = year;
  while (m > 12) { m -= 12; y++; }
  while (m < 1)  { m += 12; y--; }
  return { year: y, month: m };
}

/** Retourne la classe CSS de couleur selon le signe */
export function signClass(value) {
  if (value > 0)  return 'positive';
  if (value < 0)  return 'negative';
  return 'neutral';
}

/** Retourne la classe CSS de couleur pour un taux d'épargne */
export function txEparClass(tx) {
  if (tx >= 0.15) return 'positive';
  if (tx >= 0.05) return 'neutral';
  return 'negative';
}

/** Couleur de la barre de progression selon %, seuil en % */
export function progressColor(pct) {
  if (pct >= 100) return 'success';
  if (pct >= 50)  return 'primary';
  if (pct >= 25)  return 'warning';
  return 'danger';
}

/** Retourne l'emoji + label d'une catégorie */
export function getCategoryInfo(id) {
  return CATEGORIES.find(c => c.id === id) ?? { id: 'autre', label: 'Autre', emoji: '📦' };
}

/** Échappe le HTML pour éviter les injections XSS */
export function escHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Génère un ID unique simple */
export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

/** Debounce : retarde l'exécution de fn après delay ms d'inactivité */
export function debounce(fn, delay = 400) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

/** Télécharge un fichier depuis un blob */
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a   = document.createElement('a');
  a.href    = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** Télécharge un objet JS en fichier JSON */
export function downloadJSON(data, filename) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  downloadBlob(blob, filename);
}

/** Ouvre un sélecteur de fichier JSON et retourne le contenu parsé */
export function pickJSONFile() {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type   = 'file';
    input.accept = '.json,application/json';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return reject(new Error('Aucun fichier sélectionné'));
      const reader = new FileReader();
      reader.onload  = e => {
        try   { resolve(JSON.parse(e.target.result)); }
        catch { reject(new Error('Fichier JSON invalide')); }
      };
      reader.onerror = () => reject(new Error('Erreur de lecture du fichier'));
      reader.readAsText(file);
    };
    input.click();
  });
}

/** Convertit des données mensuelle en lignes CSV */
export function buildCSV(rows, headers) {
  const sep   = ';';
  const lines = [headers.join(sep)];
  for (const row of rows) {
    lines.push(row.map(v => {
      const s = String(v ?? '').replace(/"/g, '""');
      return s.includes(sep) ? `"${s}"` : s;
    }).join(sep));
  }
  return lines.join('\n');
}

/** Vérifie si un mois a des données (au moins un champ > 0 pour n'importe quel user) */
export function isMonthEmpty(monthData) {
  if (!monthData) return true;
  // Nouveau format multi-users
  if (monthData.users && typeof monthData.users === 'object') {
    const fields = ['revenus', 'primes', 'courses', 'extras', 'imprevus'];
    return Object.values(monthData.users).every(ud =>
      fields.every(f => !(ud?.[f] > 0))
    );
  }
  // Ancien format p1/p2 (compatibilité)
  const { p1, p2 } = monthData;
  const fields = ['revenus', 'primes', 'courses', 'extras', 'imprevus'];
  return fields.every(f => !(p1?.[f] > 0) && !(p2?.[f] > 0));
}

/** Retourne le statut de complétude d'un mois */
export function completenessStatus(monthData) {
  if (!monthData || isMonthEmpty(monthData)) return 'empty';
  if (monthData.isComplete) return 'done';
  return 'partial';
}

/** Affiche un toast global */
export function showToast(message, type = '', duration = 3000) {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent  = message;
  toast.className    = `toast ${type}`;
  toast.classList.remove('hidden');
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => toast.classList.add('hidden'), duration);
}

/** Ouvre la modal avec un titre et un contenu HTML */
export function openModal(title, bodyHTML, footerHTML = '') {
  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-body').innerHTML    = bodyHTML;
  document.getElementById('modal-footer').innerHTML  = footerHTML;
  document.getElementById('modal-overlay').classList.remove('hidden');
}

/** Ferme la modal */
export function closeModal() {
  document.getElementById('modal-overlay').classList.add('hidden');
  document.getElementById('modal-body').innerHTML   = '';
  document.getElementById('modal-footer').innerHTML = '';
}
