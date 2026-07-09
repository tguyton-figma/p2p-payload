'use client'

import { useCallback, useEffect, useState } from 'react'
import { PreJoin } from '@livekit/components-react'
import type { LocalUserChoices } from '@livekit/components-react'
import { DisconnectReason } from 'livekit-client'
import '@livekit/components-styles'
import './session.css'
import SessionCanvas from './SessionCanvas'

// A live session is a LiveKit room. Access is per-session: an "Open Session" can
// be joined by anyone (including anonymous guests/agents); a closed session
// requires signing in with Figma. Creating a room always requires sign-in — the
// creator becomes the host and picks the initial Open Session setting. Flow:
// (sign in or go guest) -> pick/create a room -> pre-join (preview) -> connect.
// The token comes from /api/livekit/token, which also returns the server URL.

interface Account {
  figmaId: string
  handle: string | null
  avatarUrl: string | null
}

type Phase = 'idle' | 'prejoin' | 'connected'

interface Connection {
  room: string
  token: string
  url: string
  choices: LocalUserChoices
}

async function fetchToken(
  room: string,
  opts: { openSession?: boolean; name?: string },
): Promise<{ token: string; url: string }> {
  const res = await fetch('/api/livekit/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ room, ...opts }),
  })
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(body.error ?? 'Could not join the room.')
  }
  return (await res.json()) as { token: string; url: string }
}

export default function SessionPage() {
  // undefined = still checking auth; null = signed out; Account = signed in.
  const [account, setAccount] = useState<Account | null | undefined>(undefined)
  const [phase, setPhase] = useState<Phase>('idle')
  const [room, setRoom] = useState('')
  const [joinId, setJoinId] = useState('')
  // Open Session choice when creating a room; undefined when joining (joins
  // inherit the room's existing setting).
  const [pendingOpen, setPendingOpen] = useState<boolean | undefined>(undefined)
  const [openSession, setOpenSession] = useState(false)
  const [connection, setConnection] = useState<Connection | null>(null)
  const [error, setError] = useState<string | null>(null)

  const loadMe = useCallback(async () => {
    try {
      const res = await fetch('/api/accounts/oauth/me', { credentials: 'include' })
      const data = (await res.json()) as { account: Account | null }
      setAccount(data.account)
    } catch {
      setAccount(null)
    }
  }, [])

  useEffect(() => {
    void loadMe()
  }, [loadMe])

  const signOut = useCallback(async () => {
    await fetch('/api/accounts/oauth/logout', { method: 'POST', credentials: 'include' }).catch(
      () => {},
    )
    setConnection(null)
    setPhase('idle')
    setAccount(null)
  }, [])

  const toPrejoin = useCallback((r: string, open?: boolean) => {
    setRoom(r)
    setPendingOpen(open)
    setError(null)
    setPhase('prejoin')
  }, [])
  // Start a new room (must be signed in) — the checkbox sets its Open Session.
  const createRoom = useCallback(
    () => toPrejoin(crypto.randomUUID().slice(0, 8), openSession),
    [toPrejoin, openSession],
  )
  // Join an existing room by id (works for accounts and guests).
  const joinRoom = useCallback(() => {
    const id = joinId.trim()
    if (id) toPrejoin(id)
  }, [joinId, toPrejoin])

  const onPreJoinSubmit = useCallback(
    async (choices: LocalUserChoices) => {
      setError(null)
      try {
        const { token, url } = await fetchToken(room, {
          openSession: pendingOpen,
          name: choices.username,
        })
        setConnection({ room, token, url, choices })
        setPhase('connected')
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not join the room.')
      }
    },
    [room, pendingOpen],
  )

  // Called when the LiveKit room disconnects. A server-side removal (host turned
  // off Open Session) surfaces an explanation; normal leaves are silent.
  const leave = useCallback((reason?: DisconnectReason) => {
    setConnection(null)
    setPhase('idle')
    setError(
      reason === DisconnectReason.PARTICIPANT_REMOVED
        ? 'The host turned off Open Session, so you were removed.'
        : null,
    )
  }, [])

  // In a call.
  if (phase === 'connected' && connection) {
    return (
      <div className="session session--live">
        <header className="session__bar">
          <h1 className="session__title">Session</h1>
          <div className="session__meta">
            <code className="session__id">{connection.room}</code>
            <button
              className="session__btn session__btn--ghost"
              onClick={() => navigator.clipboard?.writeText(connection.room)}
            >
              Copy ID
            </button>
          </div>
        </header>
        <SessionCanvas connection={connection} onLeave={leave} />
      </div>
    )
  }

  // Device/name preview before connecting. Allowed for accounts and guests.
  if (phase === 'prejoin') {
    return (
      <div className="session session--live" data-lk-theme="default">
        <header className="session__bar">
          <h1 className="session__title">
            Join <code className="session__id">{room}</code>
          </h1>
          <button className="session__btn session__btn--ghost" onClick={() => setPhase('idle')}>
            Back
          </button>
        </header>
        {error && <p className="session__error">{error}</p>}
        <div className="session__prejoin">
          <PreJoin
            defaults={{
              username: account?.handle ?? '',
              videoEnabled: true,
              audioEnabled: true,
            }}
            onSubmit={onPreJoinSubmit}
            onError={(e) => setError(e.message)}
            joinLabel="Join call"
          />
        </div>
      </div>
    )
  }

  // Still checking auth.
  if (account === undefined) {
    return (
      <div className="session">
        <header className="session__bar">
          <h1 className="session__title">Live Session</h1>
        </header>
      </div>
    )
  }

  // Signed out — can still join an Open Session as a guest.
  if (!account) {
    return (
      <div className="session">
        <header className="session__bar">
          <h1 className="session__title">Live Session</h1>
        </header>
        <div className="session__signin">
          <p>Sign in with Figma to start a call or join a members-only session.</p>
          <button
            className="session__btn session__btn--primary"
            onClick={() => {
              // Full-page navigation (not client routing) so the OAuth redirect
              // chain stays top-level and the session cookie is delivered.
              window.location.href = '/api/accounts/oauth/login?redirect=/session'
            }}
          >
            Sign in with Figma
          </button>
          <div className="session__guest">
            <span className="session__or">or join an open session as a guest</span>
            <div className="session__controls">
              <input
                className="session__input"
                placeholder="Room ID"
                value={joinId}
                onChange={(e) => setJoinId(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') joinRoom()
                }}
              />
              <button className="session__btn" onClick={joinRoom}>
                Join as guest
              </button>
            </div>
          </div>
        </div>
        {error && <p className="session__error">{error}</p>}
      </div>
    )
  }

  // Signed in — lobby.
  return (
    <div className="session">
      <header className="session__bar">
        <h1 className="session__title">Live Session</h1>
        <div className="session__controls">
          <button className="session__btn session__btn--primary" onClick={createRoom}>
            Start call
          </button>
          <label className="session__checkbox">
            <input
              type="checkbox"
              checked={openSession}
              onChange={(e) => setOpenSession(e.target.checked)}
            />
            Open Session
          </label>
          <span className="session__or">or</span>
          <input
            className="session__input"
            placeholder="Room ID"
            value={joinId}
            onChange={(e) => setJoinId(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') joinRoom()
            }}
          />
          <button className="session__btn" onClick={joinRoom}>
            Join
          </button>
        </div>
        <div className="session__meta">
          <span className="session__id">@{account.handle ?? account.figmaId}</span>
          <button className="session__btn session__btn--ghost" onClick={signOut}>
            Sign out
          </button>
        </div>
      </header>
      {error && <p className="session__error">{error}</p>}
    </div>
  )
}
