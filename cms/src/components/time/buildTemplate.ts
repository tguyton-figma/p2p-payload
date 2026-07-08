/**
 * fr weight by distance from the focused cell, keyed by window size (1–7).
 * Values derived from Figma node 3:625.
 */
export const FR_SCALE: Record<number, readonly number[]> = {
  1: [1],
  2: [3, 1],
  3: [6, 2, 1],
  4: [8, 4, 2, 1],
  5: [20, 12, 6, 3, 1],
  6: [10, 6, 2, 1],
  7: [28, 10, 4, 3, 2, 1],
}

export const CAROUSEL_SCALE = [15, 5, 3, 1] as const

export function buildTemplate(n: number, focusIndex: number): string {
  if (n === 0) return '1fr'

  if (n <= 7) {
    const scale = FR_SCALE[n] ?? []
    return Array.from({ length: n }, (_, i) => {
      const distance = Math.abs(i - focusIndex)
      return `${scale[distance] ?? 1}fr`
    }).join(' ')
  }

  return Array.from({ length: n }, (_, i) => {
    const distance = Math.abs(i - focusIndex)
    return distance < CAROUSEL_SCALE.length
      ? `${CAROUSEL_SCALE[distance]}fr`
      : '0fr'
  }).join(' ')
}
