'use client';

const CLIENT_SESSION_KEY = 'mirogd_client_session_id';
const ROOM_SESSION_KEY = 'mirogd_room_session';

type StoredRoomSession = {
  roomId: string;
  nickname: string;
};

function safeGetStorage() {
  if (typeof window === 'undefined') return null;
  try {
    return window.sessionStorage;
  } catch (_) {
    return null;
  }
}

export function getClientSessionId() {
  const storage = safeGetStorage();
  if (!storage) return 'server';

  const existing = storage.getItem(CLIENT_SESSION_KEY);
  if (existing) return existing;

  const created =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `mirogd_${Date.now()}_${Math.random().toString(36).slice(2)}`;

  storage.setItem(CLIENT_SESSION_KEY, created);
  return created;
}

export function saveRoomSession(session: StoredRoomSession) {
  const storage = safeGetStorage();
  if (!storage) return;
  storage.setItem(ROOM_SESSION_KEY, JSON.stringify(session));
}

export function getRoomSession(roomId?: string): StoredRoomSession | null {
  const storage = safeGetStorage();
  if (!storage) return null;

  try {
    const raw = storage.getItem(ROOM_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredRoomSession | null;
    if (!parsed?.roomId || !parsed?.nickname) return null;
    if (roomId && parsed.roomId !== roomId) return null;
    return parsed;
  } catch (_) {
    return null;
  }
}

export function clearRoomSession(roomId?: string) {
  const storage = safeGetStorage();
  if (!storage) return;
  const current = getRoomSession();
  if (!current) return;
  if (roomId && current.roomId !== roomId) return;
  storage.removeItem(ROOM_SESSION_KEY);
}
