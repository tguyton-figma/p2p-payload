import type { CollectionConfig, CollectionBeforeValidateHook } from 'payload'
import { extname } from 'path'
import { enrichMedia } from '@/hooks/enrichMedia'

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

function slugifyFilename(value: string): string {
  const ext = extname(value)
  const base = ext ? value.slice(0, -ext.length) : value
  return slugify(base)
}

/**
 * Auto-fill and guarantee a unique `slug` on every media doc.
 *
 * Runs in `beforeValidate` so the final slug is set before Payload validates
 * the field and before the Content-API write (whose DB-level unique index is
 * the only thing enforcing uniqueness — Payload's built-in slug helper does no
 * collision handling of its own).
 *
 *  - create: derive the base slug from the filename (falling back to alt, then
 *    "media"), or use an admin-provided value; then append `-2`, `-3`, … until
 *    it doesn't collide with an existing doc.
 *  - update: if the payload doesn't touch `slug`, leave the stored slug alone
 *    (partial enrichment writes must never clobber it). If it does, re-dedupe
 *    the new value, excluding this doc.
 */
const ensureMediaSlug: CollectionBeforeValidateHook = async ({
  data,
  originalDoc,
  operation,
  req,
}) => {
  if (!data) return data

  const provided = typeof data.slug === 'string' ? data.slug.trim() : ''

  let desired: string
  if (provided) {
    // Admin typed (or a caller passed) a slug — normalize it as-is.
    desired = slugify(provided) || 'media'
  } else if (operation === 'update') {
    // No slug in this write — preserve whatever is already stored.
    return data
  } else {
    const source =
      (typeof data.filename === 'string' && data.filename) ||
      (typeof data.alt === 'string' && data.alt) ||
      'media'
    desired = slugifyFilename(source) || 'media'
  }

  // Unchanged from what's stored — nothing to check.
  if (operation === 'update' && originalDoc && desired === originalDoc.slug) {
    data.slug = desired
    return data
  }

  const base = desired
  let candidate = base
  let n = 1
  for (let i = 0; i < 1000; i++) {
    const { totalDocs } = await req.payload.find({
      collection: 'media',
      where: {
        and: [
          { slug: { equals: candidate } },
          ...(originalDoc?.id ? [{ id: { not_equals: originalDoc.id } }] : []),
        ],
      },
      limit: 1,
      depth: 0,
      overrideAccess: true,
    })
    if (totalDocs === 0) break
    n += 1
    candidate = `${base}-${n}`
  }

  data.slug = candidate
  return data
}
function audioWaveformThumbnail(doc: Record<string, unknown>): string {
  const waveform = Array.isArray(doc.waveform)
    ? doc.waveform.filter((v): v is number => typeof v === 'number')
    : []

  const samples = waveform.length > 0
    ? waveform
    : new Array(64).fill(0).map((_, i) => 0.16 + Math.sin(i * 0.55) * 0.08)

  const dominantColor = doc.dominantColor as
    | { l?: number | null; c?: number | null; h?: number | null }
    | null
    | undefined

  const l = dominantColor?.l ?? 0.62
  const c = dominantColor?.c ?? 0.12
  const h = dominantColor?.h ?? 270
  const fill = `oklch(${l} ${c} ${h})`

  const width = 640
  const height = 360
  const midY = height / 2
  const barWidth = width / samples.length

  const bars = samples.map((amp, i) => {
    const barH = Math.max(8, Math.min(1, Math.abs(amp)) * height * 0.75)
    const x = i * barWidth + barWidth * 0.15
    const y = midY - barH / 2
    const w = Math.max(2, barWidth * 0.7)
    const rx = Math.max(1, w * 0.35)
    return `<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${w.toFixed(2)}" height="${barH.toFixed(2)}" rx="${rx.toFixed(2)}" />`
  }).join('')

  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    '<rect width="100%" height="100%" fill="oklch(0.08 0 0)" />',
    `<g fill="${fill}" opacity="0.85">${bars}</g>`,
    '</svg>',
  ].join('')

  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

export const Media: CollectionConfig = {
  slug: 'media',
  access: {
    read: () => true,
    create: ({ req: { user } }) => Boolean(user),
  },
  hooks: {
    beforeValidate: [ensureMediaSlug],
    beforeOperation: [
      ({ args, operation }) => {
        // With initClientUploads the file is already in S3. The alpha.64
        // static handler returns a 302 redirect, so addDataAndFileToRequest
        // ends up setting req.file.data to an empty buffer. For images,
        // generateFileData then tries to run Sharp on that empty buffer and
        // throws a 400. Clearing req.file lets generateFileData skip
        // processing; we copy the essential metadata into the document data
        // so filename / mimeType / filesize are still persisted.
        if (
          (operation === 'create' || operation === 'update') &&
          args.req.file?.clientUploadContext
        ) {
          const file = args.req.file
          args.data = {
            ...args.data,
            filename: args.data.filename || file.name,
            mimeType: args.data.mimeType || file.mimetype,
            filesize: args.data.filesize || file.size,
          }
          args.req.file = undefined
        }
        return args
      },
    ],
    afterChange: [enrichMedia],
    beforeDelete: [
      async ({ id, req }) => {
        // Cascade-delete any thumbnail or variant docs that belong to this media.
        const { docs } = await req.payload.find({
          collection: 'media',
          where: { _parentMediaId: { equals: id } },
          limit: 100,
          depth: 0,
        })
        for (const child of docs) {
          await req.payload.delete({
            collection: 'media',
            id: child.id,
            context: { skipThumbnailGeneration: true, skipColorExtraction: true },
            req,
          })
        }
      },
    ],
  },
  fields: [
    {
      name: 'processingStatus',
      type: 'ui',
      admin: {
        condition: (data) => Boolean(data.id),
        components: {
          Field: '/components/admin/ProcessingStatus#ProcessingStatus',
        },
      },
    },
    {
      name: 'mediaHero',
      type: 'ui',
      admin: {
        condition: (data) => Boolean(data.id),
        components: {
          Field: '/components/admin/MediaHero#MediaHero',
        },
      },
    },
    {
      name: 'alt',
      type: 'text',
      required: true,
      admin: {
        position: 'sidebar',
      },
    },
    {
      name: 'slug',
      type: 'text',
      unique: true,
      index: true,
      admin: {
        position: 'sidebar',
        description:
          'URL slug for public and embed links. Auto-filled from the filename on upload; edit to override. Must be unique.',
      },
    },
    {
      name: '_parentMediaId',
      type: 'text',
      index: true,
      admin: {
        hidden: true,
        description: 'Set on auto-generated child docs (thumbnails) to link them to their parent.',
      },
      access: { read: () => false },
    },
    {
      name: 'uploadedBy',
      type: 'relationship',
      relationTo: 'accounts',
      admin: {
        readOnly: true,
        position: 'sidebar',
        description: 'Account that uploaded this via the recorder.',
      },
    },
    {
      name: 'dominantColor',
      type: 'group',
      admin: {
        readOnly: true,
        position: 'sidebar',
        description: 'Auto-extracted OKLCH dominant color.',
        condition: (data) =>
          data.mimeType?.startsWith('image/') ||
          data.mimeType?.startsWith('video/') ||
          data.mimeType?.startsWith('audio/'),
      },
      fields: [
        { name: 'l', type: 'number', admin: { step: 0.001 } },
        { name: 'c', type: 'number', admin: { step: 0.001 } },
        { name: 'h', type: 'number', admin: { step: 0.1 } },
      ],
    },
    {
      name: 'waveform',
      type: 'json',
      admin: {
        readOnly: true,
        position: 'sidebar',
        description: '128-sample normalized amplitude array (audio only).',
        condition: (data) => data.mimeType?.startsWith('audio/'),
      },
    },
    {
      // Thumbnail for video — URL-only reference, no relationship doc needed.
      name: 'thumbnailURL',
      type: 'text',
      admin: {
        readOnly: true,
        position: 'sidebar',
        description: 'URL of the auto-generated video thumbnail.',
        condition: (data) => data.mimeType?.startsWith('video/'),
      },
    },
    {
      name: 'durationSeconds',
      type: 'number',
      admin: {
        readOnly: true,
        position: 'sidebar',
        description: 'Duration in seconds, auto-extracted from video/audio.',
        condition: (data) =>
          data.mimeType?.startsWith('video/') ||
          data.mimeType?.startsWith('audio/'),
      },
    },
    {
      name: 'mediaWidth',
      type: 'number',
      admin: {
        readOnly: true,
        position: 'sidebar',
        description: 'Video frame width in pixels, auto-extracted.',
        condition: (data) => data.mimeType?.startsWith('video/'),
      },
    },
    {
      name: 'mediaHeight',
      type: 'number',
      admin: {
        readOnly: true,
        position: 'sidebar',
        description: 'Video frame height in pixels, auto-extracted.',
        condition: (data) => data.mimeType?.startsWith('video/'),
      },
    },
    {
      name: '_processingErrors',
      type: 'json',
      admin: {
        readOnly: true,
        position: 'sidebar',
        description: 'Per-job error messages from the enrichment pipeline. Null when all jobs succeed.',
        condition: (data) => data._processingErrors != null,
      },
    },
    {
      name: 'anchor',
      type: 'select',
      label: 'Anchor Point',
      defaultValue: 'center',
      options: [
        { label: 'Top Left',      value: 'top-left' },
        { label: 'Top Center',    value: 'top-center' },
        { label: 'Top Right',     value: 'top-right' },
        { label: 'Center Left',   value: 'center-left' },
        { label: 'Center',        value: 'center' },
        { label: 'Center Right',  value: 'center-right' },
        { label: 'Bottom Left',   value: 'bottom-left' },
        { label: 'Bottom Center', value: 'bottom-center' },
        { label: 'Bottom Right',  value: 'bottom-right' },
      ],
      admin: {
        position: 'sidebar',
        description: 'Focal point used when the video fills the display area.',
        components: {
          Field: '/components/AnchorPointPicker#AnchorPointPicker',
        },
      },
    },
  ],
  upload: {
    // Required for Figma Cloud: the client upload flow sends file metadata only
    // (file goes to S3 via presigned URL, final POST /api/media has no binary).
    // Without this, all uploads fail with MissingFile error.
    filesRequiredOnCreate: false,
    // Use our generated thumbnail for video previews in list/header
    adminThumbnail: ({ doc }) => {
      if (typeof doc.thumbnailURL === 'string') return doc.thumbnailURL
      if (typeof doc.mimeType === 'string' && doc.mimeType.startsWith('audio/')) {
        return audioWaveformThumbnail(doc)
      }
      return null
    },
  },
  admin: {
    useAsTitle: 'filename',
    defaultColumns: ['filename', 'alt', 'mimeType', 'filesize', 'createdAt'],
  },
}
