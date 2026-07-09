'use client'

import { useCallback, useState } from 'react'
import { LiveKitRoom, PreJoin, VideoConference } from '@livekit/components-react'
import type { LocalUserChoices } from '@livekit/components-react'
import '@livekit/components-styles'
import './session.css'

// A live session is a LiveKit room. Flow: pick/create a room -> pre-join
// (set a display name, preview camera/mic) -> connect. We fetch a short-lived,
// room-scoped access token from our own /api/livekit/token endpoint (which also
// returns the server URL, so no public env var is needed), then hand it to
// <LiveKitRoom>. LiveKit's SFU handles signaling, media forwarding, and
// reconnection, scaling to many-to-many (1-10) without a mesh fan-out cap.

type Phase = 'idle' | 'prejoin' | 'connected'

interface Connection {
  room: string
  token: string
  url: string
  choices: LocalUserChoices
}

async function fetchToken(room: string, name: string): Promise<{ token: string; url: string }> {
  const res = await fetch('/api/livekit/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ room, name }),
  })
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(body.error ?? 'Could not join the room.')
  }
  return (await res.json()) as { token: string; url: string }
}

export default function SessionPage() {
  const [phase, setPhase] = useState<Phase>('idle')
  const [room, setRoom] = useState('')
  const [joinId, setJoinId] = useState('')
  const [connection, setConnection] = useState<Connection | null>(null)
  const [error, setError] = useState<string | null>(null)

  const toPrejoin = useCallback((r: string) => {
    setRoom(r)
    setError(null)
    setPhase('prejoin')
  }, [])

  // Start a new call with a short random room name; anyone with the name can join.
  const createRoom = useCallback(() => toPrejoin(crypto.randomUUID().slice(0, 8)), [toPrejoin])
  const joinRoom = useCallback(() => {
    const id = joinId.trim()
    if (id) toPrejoin(id)
  }, [joinId, toPrejoin])

  const onPreJoinSubmit = useCallback(
    async (choices: LocalUserChoices) => {
      setError(null)
      try {
        const { token, url } = await fetchToken(room, choices.username)
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
            defaults={{ username: '', videoEnabled: true, audioEnabled: true }}
            onSubmit={onPreJoinSubmit}
            onError={(e) => setError(e.message)}
            joinLabel="Join call"
          />
        </div>
      </div>
    )
  }

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
      </header>
      {error && <p className="session__error">{error}</p>}
    </div>
  )
}
