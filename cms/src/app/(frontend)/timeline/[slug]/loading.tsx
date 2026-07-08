export default function TimelineLoading() {
  return (
    <main>
      <article aria-busy="true" aria-label="Loading timeline…">
        <header>
          <h2>Loading…</h2>
        </header>
        <figure style={{ height: 48, opacity: 0.3 }} />
      </article>
    </main>
  )
}
