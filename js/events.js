// ============================================================
// js/events.js – EventBus minimaliste (pub/sub synchrone)
// ============================================================

const _listeners = Object.create(null);

/**
 * S'abonner à un événement. Retourne une fonction de désinscription.
 * @param {string} event
 * @param {function} fn
 * @returns {function} unsubscribe
 */
export function on(event, fn) {
  if (!_listeners[event]) _listeners[event] = [];
  _listeners[event].push(fn);
  return () => {
    _listeners[event] = _listeners[event].filter(f => f !== fn);
  };
}

/**
 * Émettre un événement. Tous les abonnés sont appelés de façon synchrone.
 * Les erreurs individuelles sont silencieuses pour ne pas bloquer les autres.
 * @param {string} event
 * @param {*} [data]
 */
export function emit(event, data) {
  const fns = _listeners[event];
  if (!fns) return;
  for (const fn of fns) {
    try { fn(data); } catch (_) {}
  }
}
