import type { CollectionBeforeValidateHook } from 'payload'
import crypto from 'crypto'

// ── Word lists ────────────────────────────────────────────────────────────────
// Pattern: [connector] [article] [noun] [verb-past] [adverb/adjective]
// e.g. "When the bird rose sharply"

const CONNECTORS = [
  'When', 'Where', 'While', 'As', 'Before', 'After', 'Once', 'Since',
  'Until', 'Though', 'Because', 'Beyond', 'Between', 'Within', 'Beneath',
  'Above', 'Across', 'Along', 'Among', 'Around', 'Behind', 'Below',
  'Beside', 'During', 'Inside', 'Outside', 'Through', 'Toward', 'Under',
  'Upon',
] as const

const ARTICLES = [
  'the', 'a', 'each', 'one', 'that', 'this', 'her', 'his',
  'our', 'my', 'your', 'no', 'some', 'every',
] as const

const NOUNS = [
  'bird', 'light', 'cloud', 'river', 'stone', 'wind', 'flame', 'wave',
  'leaf', 'moth', 'star', 'bell', 'rain', 'tide', 'seed', 'fox',
  'owl', 'fern', 'root', 'bloom', 'dusk', 'dawn', 'mist', 'frost',
  'drift', 'pulse', 'hush', 'glow', 'shade', 'spark', 'shore', 'trail',
  'brook', 'ridge', 'field', 'grove', 'reef', 'vale', 'marsh', 'peak',
] as const

const VERBS = [
  'rose', 'fell', 'turned', 'drifted', 'opened', 'broke', 'grew',
  'spun', 'swept', 'sank', 'curved', 'split', 'burned', 'poured',
  'shifted', 'crept', 'folded', 'lifted', 'dimmed', 'blazed', 'stirred',
  'woke', 'shook', 'bloomed', 'faded', 'rippled', 'hummed', 'gleamed',
  'swelled', 'cracked', 'wandered', 'trembled', 'lingered', 'vanished',
  'emerged', 'scattered',
] as const

const MODIFIERS = [
  'sharply', 'softly', 'slowly', 'golden', 'quiet', 'wild', 'sudden',
  'gentle', 'bright', 'still', 'hollow', 'distant', 'open', 'deep',
  'clear', 'faint', 'warm', 'pale', 'vast', 'swift', 'alone', 'twice',
  'apart', 'forward', 'inward', 'skyward', 'further', 'sideways',
  'barely', 'freely', 'onward', 'lightly',
] as const

// ── Generator ─────────────────────────────────────────────────────────────────

function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

export function generatePoeticName(): string {
  return `${pick(CONNECTORS)} ${pick(ARTICLES)} ${pick(NOUNS)} ${pick(VERBS)} ${pick(MODIFIERS)}`
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

function shortHex(): string {
  return crypto.randomBytes(2).toString('hex') // 4-char hex
}

/** Generates a standalone poetic slug (for defaultValue pre-fill). */
export function generatePoeticSlug(): string {
  return `${slugify(generatePoeticName())}-${shortHex()}`
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export const generateMomentDefaults: CollectionBeforeValidateHook = ({
  data,
  operation,
}) => {
  if (operation !== 'create') return data

  // Auto-generate poetic name if empty
  if (!data?.name) {
    data = { ...data, name: generatePoeticName() }
  }

  // Append a unique suffix to the slug on create for guaranteed uniqueness.
  // slugField() may have already set a slug from the name — we append if no suffix exists.
  const currentSlug = (data?.slug as string) || slugify(data.name as string)
  if (!/^.+-[0-9a-f]{4}$/.test(currentSlug)) {
    data = { ...data, slug: `${currentSlug}-${shortHex()}` }
  }

  // Auto-generate UUID
  if (!data?.uuid) {
    data = { ...data, uuid: crypto.randomUUID() }
  }

  return data
}
