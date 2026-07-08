import configPromise from '@payload-config'
import { getPayload } from 'payload'
import { headers as getHeaders } from 'next/headers'

// TODO: Remove this debug endpoint after verifying RBAC
export const GET = async (_request: Request) => {
  const payload = await getPayload({ config: configPromise })
  const headersList = await getHeaders()

  const { user } = await payload.auth({ headers: headersList })

  if (!user) {
    return Response.json({ error: 'Not authenticated' }, { status: 401 })
  }

  return Response.json({
    id: user.id,
    email: user.email,
    roles: user.roles,
    allKeys: Object.keys(user),
  })
}
