import type { CollectionConfig } from 'payload'
import { isAdmin, isAdminOrEditor } from '../lib/access'

export const Recordings: CollectionConfig = {
  slug: 'recordings',
  admin: {
    useAsTitle: 'title',
    defaultColumns: ['title', 'account', 'createdAt'],
  },
  access: {
    read: () => true,
    create: ({ req: { user } }) => isAdminOrEditor(user),
    update: ({ req: { user } }) => isAdminOrEditor(user),
    delete: ({ req: { user } }) => isAdmin(user),
  },
  hooks: {
    beforeValidate: [
      ({ data, operation }) => {
        if (operation === 'create' && data?.startedAt && !data.title) {
          const d = new Date(data.startedAt)
          data.title = `Recording ${d.toISOString().slice(0, 16).replace('T', ' ')}`
        }
        return data
      },
    ],
  },
  fields: [
    {
      name: 'title',
      type: 'text',
      admin: { readOnly: true },
    },
    {
      name: 'account',
      type: 'relationship',
      relationTo: 'accounts',
      required: true,
      index: true,
      admin: {
        readOnly: true,
        position: 'sidebar',
      },
    },
    {
      name: 'startedAt',
      type: 'date',
      required: true,
      admin: {
        date: { pickerAppearance: 'dayAndTime' },
        readOnly: true,
        description: 'Client-reported timestamp when the recording session began.',
      },
    },
    {
      name: 'tracks',
      type: 'array',
      required: true,
      minRows: 1,
      labels: { singular: 'Track', plural: 'Tracks' },
      fields: [
        {
          name: 'media',
          type: 'relationship',
          relationTo: 'media',
          required: true,
        },
        {
          name: 'sourceType',
          type: 'select',
          required: true,
          options: [
            { label: 'Camera', value: 'camera' },
            { label: 'Microphone', value: 'microphone' },
            { label: 'Screen', value: 'screen' },
            { label: 'Window', value: 'window' },
            { label: 'Tab', value: 'tab' },
          ],
        },
        {
          name: 'label',
          type: 'text',
          admin: {
            description: 'Human-readable source name, e.g. "Built-in Camera".',
          },
        },
        {
          name: 'offsetMs',
          type: 'number',
          required: true,
          defaultValue: 0,
          admin: {
            description:
              'Milliseconds between session t=0 and this track\'s first frame. ' +
              'Used to align playback across all tracks.',
          },
        },
        {
          name: 'durationMs',
          type: 'number',
          required: true,
          admin: {
            description: 'Track duration in milliseconds.',
          },
        },
      ],
    },
  ],
}
