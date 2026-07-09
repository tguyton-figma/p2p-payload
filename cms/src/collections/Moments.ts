import type { CollectionConfig } from 'payload'
import { populateMomentPaint } from '@/hooks/populateMomentPaint'
import { slugField } from 'payload'
import { generateMomentDefaults, generatePoeticName } from '@/hooks/generateMomentName'
import { isAdminOrEditor } from '@/lib/access'

export const Moments: CollectionConfig = {
  slug: 'moments',
  admin: {
    useAsTitle: 'name',
    defaultColumns: ['name', 'start', 'end', 'access', 'status', 'createdAt'],
    group: 'book',
  },
  access: {
    read: ({ req: { user } }) => {
      if (!user) return false
      if (isAdminOrEditor(user)) return true
      // Non-admin users can see public and internal moments
      return {
        or: [
          { access: { equals: 'public' } },
          { access: { equals: 'internal' } },
        ],
      }
    },
    create: ({ req: { user } }) => Boolean(user),
    update: ({ req: { user } }) => Boolean(user),
    delete: ({ req: { user } }) => isAdminOrEditor(user),
  },
  hooks: {
    beforeValidate: [generateMomentDefaults],
    beforeChange: [populateMomentPaint],
  },
  timestamps: true,
  fields: [
    {
      name: 'momentHero',
      type: 'ui',
      admin: {
        components: {
          Field: '/components/admin/moments/MomentShell#MomentShell',
        },
      },
    },
    {
      name: 'name',
      type: 'text',
      required: true,
      defaultValue: () => generatePoeticName(),
      admin: {
        position: 'sidebar',
        description: 'A poetic phrase is auto-generated on create. Override to set your own.',
      },
    },
    slugField({
      useAsSlug: 'name',
      position: 'sidebar',
    }),
    {
      name: 'uuid',
      type: 'text',
      unique: true,
      index: true,
      admin: {
        hidden: true,
      },
    },
    {
      name: 'media',
      type: 'array',
      labels: { singular: 'Media', plural: 'Media' },
      admin: {
        description: 'Media attached to this moment. The most recently added item is the primary (used for thumbnails, covers, paint derivation).',
      },
      fields: [
        {
          name: 'media',
          type: 'relationship',
          relationTo: 'media',
          required: true,
        },
      ],
    },
    // ── Sidebar: Paint ────────────────────────────────────────────────────
    {
      type: 'collapsible',
      label: 'Paint',
      admin: {
        position: 'sidebar',
        initCollapsed: true,
      },
      fields: [
        {
          name: 'paintL',
          type: 'number',
          min: 0,
          max: 1,
          admin: {
            step: 0.001,
            description: 'OKLCH lightness (0–1). Auto-derived from cover media; override to set manually.',
          },
        },
        {
          name: 'paintC',
          type: 'number',
          min: 0,
          max: 0.4,
          admin: {
            step: 0.001,
            description: 'OKLCH chroma (0–0.4).',
          },
        },
        {
          name: 'paintH',
          type: 'number',
          min: 0,
          max: 360,
          admin: {
            step: 0.1,
            description: 'OKLCH hue (0–360).',
          },
        },
        {
          name: 'paintDim',
          type: 'number',
          min: 0,
          max: 100,
          defaultValue: 15,
          admin: {
            step: 1,
            description: 'Lightness decrease −L (0–100%) applied for receding/muted state.',
          },
        },
        {
          name: 'paintLit',
          type: 'number',
          min: 0,
          max: 100,
          defaultValue: 15,
          admin: {
            step: 1,
            description: 'Lightness increase +L (0–100%) applied for hover/active/bright state.',
          },
        },
      ],
    },
    // ── Sidebar: Schedule ─────────────────────────────────────────────────
    {
      type: 'collapsible',
      label: 'Schedule',
      admin: {
        position: 'sidebar',
      },
      fields: [
        {
          name: 'start',
          type: 'date',
          required: true,
          defaultValue: () => new Date().toISOString(),
          admin: {
            date: { pickerAppearance: 'dayAndTime' },
            description: 'Moment start time (UTC).',
          },
        },
        {
          name: 'end',
          type: 'date',
          required: true,
          defaultValue: () => new Date(Date.now() + 2 * 60 * 1000).toISOString(),
          admin: {
            date: { pickerAppearance: 'dayAndTime' },
            description: 'Moment end time (UTC).',
          },
          validate: (value, { siblingData }) => {
            const start = (siblingData as { start?: unknown })?.start
            if (!value || !start) return true
            const startMs = start instanceof Date ? start.getTime() : new Date(start as string).getTime()
            const endMs = value instanceof Date ? value.getTime() : new Date(value as string).getTime()
            if (endMs <= startMs) return 'End must be after start.'
            return true
          },
        },
        {
          name: 'duration',
          type: 'number',
          virtual: true,
          admin: {
            description: 'Duration in minutes, derived from start/end.',
            readOnly: true,
          },
          hooks: {
            afterRead: [
              ({ siblingData }) => {
                const start = (siblingData as { start?: string | Date })?.start
                const end = (siblingData as { end?: string | Date })?.end
                if (!start || !end) return null
                const startMs = new Date(start as string).getTime()
                const endMs = new Date(end as string).getTime()
                return Math.round((endMs - startMs) / 60000)
              },
            ],
          },
        },
      ],
    },
    // ── Sidebar: Status & Access ──────────────────────────────────────────
    {
      name: 'status',
      type: 'select',
      required: true,
      defaultValue: 'staged',
      options: [
        { label: 'Staged', value: 'staged' },
        { label: 'Confirmed', value: 'confirmed' },
        { label: 'Active', value: 'active' },
        { label: 'Completed', value: 'completed' },
        { label: 'Cancelled', value: 'cancelled' },
      ],
      admin: {
        position: 'sidebar',
      },
    },
    {
      name: 'access',
      type: 'select',
      required: true,
      defaultValue: 'internal',
      options: [
        { label: 'Public', value: 'public' },
        { label: 'Internal', value: 'internal' },
        { label: 'Private', value: 'private' },
      ],
      admin: {
        position: 'sidebar',
      },
    },
    // ── Sidebar: Links, Participants, Related ───────────────────────────────
    {
      type: 'collapsible',
      label: 'Links',
      admin: {
        position: 'sidebar',
        initCollapsed: true,
      },
      fields: [
        {
          name: 'links',
          type: 'array',
          labels: { singular: 'Link', plural: 'Links' },
          admin: {
            description: 'First-class hyperlinks to external resources (Zoom, docs, etc.).',
          },
          fields: [
            {
              name: 'label',
              type: 'text',
              required: true,
            },
            {
              name: 'url',
              type: 'text',
              required: true,
            },
          ],
        },
      ],
    },
    {
      type: 'collapsible',
      label: 'Participants',
      admin: {
        position: 'sidebar',
        initCollapsed: true,
      },
      fields: [
        {
          name: 'participants',
          type: 'array',
          labels: { singular: 'Participant', plural: 'Participants' },
          fields: [
            {
              name: 'account',
              type: 'relationship',
              relationTo: 'accounts',
              required: true,
            },
            {
              name: 'joinTime',
              type: 'date',
              admin: {
                date: { pickerAppearance: 'dayAndTime' },
                description: 'When this participant plans to join. Defaults to moment start.',
              },
            },
            {
              name: 'leaveTime',
              type: 'date',
              admin: {
                date: { pickerAppearance: 'dayAndTime' },
                description: 'When this participant plans to leave. Defaults to moment end.',
              },
            },
            {
              name: 'note',
              type: 'text',
              admin: {
                description: 'Presence note, e.g. "Joining after standup" or "Leaving early for Moment B."',
              },
            },
          ],
        },
      ],
    },
    {
      name: 'relatedMoments',
      type: 'relationship',
      relationTo: 'moments',
      hasMany: true,
      admin: {
        position: 'sidebar',
        description: 'Related moments for recurring cadences, series, or follow-ups.',
      },
    },
    {
      name: 'createdBy',
      type: 'relationship',
      relationTo: 'accounts',
      admin: {
        readOnly: true,
        position: 'sidebar',
        description: 'Account that created this moment.',
      },
    },
  ],
}
