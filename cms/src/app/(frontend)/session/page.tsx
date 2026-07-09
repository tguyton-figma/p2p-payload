'use client'

import { useCallback, useEffect, useState } from 'react'
import { LiveKitRoom, PreJoin, VideoConference } from '@livekit/components-react'
import type { LocalUserChoices } from '@livekit/components-react'
import '@livekit/components-styles'
import './session.css'

// A live session is a LiveKit room. The user must sign in with Figma first; the
// LiveKit identity/name then come from their Account (server-trusted). Flow:
// sign in -> pick/create a room -> pre-join (preview) -> connect. The token comes
// from our own /api/livekit/token, which also returns the server URL (no public
// env var needed). LiveKit's SFU handles signaling, forwarding, and reconnection.

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

async function fetchToken(room: string): Promise<{ token: string; url: string }> {
  const res = await fetch('/api/livekit/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ room }),
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

  const toPrejoin = useCallback((r: string) => {
    setRoom(r)
    setError(null)
    setPhase('prejoin')
  }, [])
  const createRoom = useCallback(() => toPrejoin(crypto.randomUUID().slice(0, 8)), [toPrejoin])
  const joinRoom = useCallback(() => {
    const id = joinId.trim()
    if (id) toPrejoin(id)
  }, [joinId, toPrejoin])

  const onPreJoinSubmit = useCallback(
    async (choices: LocalUserChoices) => {
      setError(null)
      try {
        const { token, url } = await fetchToken(room)
        setConnection({ room, token, url, choices })
        setPhase('connected')
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not join the room.')
      }
    },
    [room],
  )

  const leave = useCallback(() => {
    setConnection(null)
    setPhase('idle')
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
        <LiveKitRoom
          className="session__room"
          token={connection.token}
          serverUrl={connection.url}
          connect
          video={connection.choices.videoEnabled}
          audio={connection.choices.audioEnabled}
          data-lk-theme="default"
          onDisconnected={leave}
          onError={(e) => setError(e.message)}
        >
          <VideoConference />
        </LiveKitRoom>
      </div>
    )
  }

  // Device/name preview before connecting.
  if (phase === 'prejoin' && account) {
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
            defaults={{ username: account.handle ?? '', videoEnabled: true, audioEnabled: true }}
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

  // Signed out.
  if (!account) {
    return (
      <div className="session">
        <header className="session__bar">
          <h1 className="session__title">Live Session</h1>
        </header>
        <div className="session__signin">
          <p>Sign in with Figma to start or join a call.</p>
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
