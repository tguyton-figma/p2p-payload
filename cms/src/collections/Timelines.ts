import type { CollectionConfig } from 'payload'
import { isAdmin, isAdminOrEditor } from '../lib/access'

export const Timelines: CollectionConfig = {
  slug: 'timelines',
  admin: {
    useAsTitle: 'title',
    defaultColumns: ['title', 'slug', '_status', 'updatedAt'],
  },
  versions: {
    drafts: {
      autosave: true,
      validate: false,
    },
  },
  access: {
    read: ({ req: { user } }) => {
      if (!user) return false
      if (isAdminOrEditor(user)) return true
      return { _status: { equals: 'published' } }
    },
    create: ({ req: { user } }) => isAdminOrEditor(user),
    update: ({ req: { user } }) => isAdminOrEditor(user),
    delete: ({ req: { user } }) => isAdmin(user),
  },
  fields: [
    {
      name: 'title',
      type: 'text',
      required: true,
    },
    {
      name: 'slug',
      type: 'text',
      unique: true,
      index: true,
      required: true,
    },
    {
      name: 'description',
      type: 'textarea',
    },
    {
      name: 'scenes',
      type: 'array',
      label: 'Scenes',
      labels: {
        singular: 'Scene',
        plural: 'Scenes',
      },
      fields: [
        {
          name: 'title',
          type: 'text',
        },
        {
          name: 'items',
          type: 'blocks',
          labels: {
            singular: 'Item',
            plural: 'Items',
          },
          blocks: [
            {
              slug: 'video',
              labels: { singular: 'Video', plural: 'Videos' },
              fields: [
                {
                  name: 'media',
                  type: 'relationship',
                  relationTo: 'media',
                  required: true,
                },
                {
                  name: 'startTime',
                  type: 'number',
                  label: 'Start Time (seconds)',
                  defaultValue: 0,
                },
                {
                  name: 'label',
                  type: 'text',
                },
              ],
            },
            {
              slug: 'audio',
              labels: { singular: 'Audio', plural: 'Audio' },
              fields: [
                {
                  name: 'media',
                  type: 'relationship',
                  relationTo: 'media',
                  required: true,
                },
                {
                  name: 'startTime',
                  type: 'number',
                  label: 'Start Time (seconds)',
                  defaultValue: 0,
                },
                {
                  name: 'label',
                  type: 'text',
                },
              ],
            },
            {
              slug: 'document',
              labels: { singular: 'Document', plural: 'Documents' },
              fields: [
                {
                  name: 'content',
                  type: 'richText',
                },
                {
                  name: 'startTime',
                  type: 'number',
                  label: 'Start Time (seconds)',
                  defaultValue: 0,
                },
                {
                  name: 'duration',
                  type: 'number',
                  label: 'Duration (seconds)',
                },
                {
                  name: 'label',
                  type: 'text',
                },
              ],
            },
          ],
        },
      ],
    },
  ],
}
