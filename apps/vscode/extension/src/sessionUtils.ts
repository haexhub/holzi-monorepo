export type SessionMeta = {
  id: string
  title: string
  lastMessage: string
  updatedAt: number
}

export function isSessionMeta(x: unknown): x is SessionMeta {
  if (!x || typeof x !== 'object') return false
  const s = x as Record<string, unknown>
  return typeof s.id === 'string' && s.id.length > 0
    && typeof s.title === 'string'
    && typeof s.lastMessage === 'string'
    && typeof s.updatedAt === 'number' && isFinite(s.updatedAt)
}

export function mergeSessions(local: SessionMeta[], remote: SessionMeta[]): SessionMeta[] {
  const map = new Map<string, SessionMeta>()
  for (const s of local.filter(isSessionMeta)) map.set(s.id, s)
  for (const s of remote.filter(isSessionMeta)) map.set(s.id, s)
  return [...map.values()].sort((a, b) => b.updatedAt - a.updatedAt)
}
