import type { CollectionConfig } from 'payload'
import { isAdmin, isAdminOrEditor } from '../lib/access'

export const Users: CollectionConfig = {
  slug: 'users',
  admin: {
    useAsTitle: 'email',
  },
  auth: {
    useAPIKey: true,
  },
  access: {
    // Gate admin panel login to admin and editor roles
    admin: ({ req: { user } }) => {
      if (!user) return false
      return isAdminOrEditor(user)
    },
    // Admins can create users
    create: ({ req: { user } }) => isAdmin(user),
    // Admins read all; others read only themselves
    read: ({ req: { user } }) => {
      if (!user) return false
      if (isAdmin(user)) return true
      return { id: { equals: user.id } }
    },
    // Admins update all; others update only themselves
    update: ({ req: { user } }) => {
      if (!user) return false
      if (isAdmin(user)) return true
      return { id: { equals: user.id } }
    },
    // Only admins can delete users
    delete: ({ req: { user } }) => isAdmin(user),
  },
  fields: [
    {
      name: 'roles',
      type: 'select',
      hasMany: true,
      options: ['admin', 'editor', 'user'],
      defaultValue: ['user'],
      required: true,
      saveToJWT: true,
      access: {
        // Only admins can change roles
        update: ({ req: { user } }) => isAdmin(user),
      },
    },
  ],
}
