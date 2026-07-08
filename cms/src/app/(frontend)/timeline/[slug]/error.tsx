'use client'

export default function TimelineError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <main>
      <article aria-live="assertive">
        <h2>Something went wrong</h2>
        <p>{error.message}</p>
        <button type="button" onClick={reset}>
          Try again
        </button>
      </article>
    </main>
  )
}
