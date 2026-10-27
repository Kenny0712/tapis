import { io, type Socket } from 'socket.io-client';
import type { ClientToServer, Identity, ServerToClient } from '@tapis/engine';

export const socket: Socket<ServerToClient, ClientToServer> = io({ transports: ['websocket', 'polling'] });

// crypto.randomUUID n'existe pas hors HTTPS (test sur téléphone via l'IP du PC) : on passe par getRandomValues.
function randomId() {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}

const KEY = 'tapis.identite';

export function identity(): Identity & { name: string } {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (saved?.playerId && saved?.token) return saved;
  } catch { /* stockage indisponible : identité de session */ }
  const fresh = { playerId: randomId(), token: randomId(), name: '' };
  try { localStorage.setItem(KEY, JSON.stringify(fresh)); } catch { /* idem */ }
  sessionIdentity ??= fresh;
  return sessionIdentity;
}
let sessionIdentity: (Identity & { name: string }) | null = null;

export function rememberName(name: string) {
  try {
    const id = identity();
    localStorage.setItem(KEY, JSON.stringify({ ...id, name }));
  } catch { /* rien */ }
}

type Payload<K extends keyof ClientToServer> = Parameters<ClientToServer[K]>[0];
type Reply<K extends keyof ClientToServer> = Parameters<Parameters<ClientToServer[K]>[1]>[0];

/** Envoie une commande au serveur ; rejette avec le message d'erreur en français. */
export function call<K extends keyof ClientToServer>(event: K, payload: Payload<K>) {
  return new Promise<Extract<Reply<K>, { ok: true }>>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Le serveur ne répond pas')), 8000);
    (socket.emit as (...a: unknown[]) => void)(event, payload, (res: Reply<K>) => {
      clearTimeout(timer);
      if (res.ok) resolve(res as Extract<Reply<K>, { ok: true }>);
      else reject(new Error(res.error));
    });
  });
}

export function navigate(path: string) {
  history.pushState(null, '', path);
  dispatchEvent(new PopStateEvent('popstate'));
}
