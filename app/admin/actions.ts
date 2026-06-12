'use server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import type { Role } from '@/lib/permissions'

type ActionResult = { ok: true } | { error: string }
type ReportAuditMetadata = Record<string, any> & {
  message_id: string | null
  previous_status: string | null
}

function isUniqueViolation(error: { code?: string } | null | undefined): boolean {
  return error?.code === '23505'
}

async function getAdminUserId(): Promise<string | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data } = await supabase
    .from('group_members')
    .select('role')
    .eq('user_id', user.id)
    .eq('role', 'admin')
    .limit(1)
    .single()

  return data ? user.id : null
}

async function logAudit(
  adminId: string,
  action: string,
  targetType: string | null,
  targetId: string | null,
  metadata: Record<string, any>
) {
  const supabase = await createClient()
  await supabase.from('audit_log').insert({
    admin_id: adminId,
    action,
    target_type: targetType,
    target_id: targetId,
    metadata,
  })
}

async function getReportAuditMetadata(reportId: string): Promise<ReportAuditMetadata> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('reports')
    .select(`
      id,
      message_id,
      category,
      reason,
      moderation_note,
      status,
      reported_by,
      messages(content, channel_id, user_id),
      profiles!reports_reported_by_fkey(username)
    `)
    .eq('id', reportId)
    .single()

  const report = data as any
  return {
    report_id: reportId,
    message_id: report?.message_id ?? null,
    category: report?.category ?? null,
    reason: report?.reason ?? null,
    moderation_note: report?.moderation_note ?? null,
    previous_status: report?.status ?? null,
    reported_by: report?.reported_by ?? null,
    reporter_username: report?.profiles?.username ?? null,
    channel_id: report?.messages?.channel_id ?? null,
    message_author_id: report?.messages?.user_id ?? null,
    message_preview: report?.messages?.content?.slice(0, 160) ?? null,
  }
}

function reportActionClosedError(metadata: ReportAuditMetadata): ActionResult | null {
  if (metadata.previous_status === 'pending') return null
  return { error: 'Only pending reports can be modified.' }
}

export async function changeRole(
  userId: string,
  groupId: string,
  newRole: Role,
  targetUsername: string,
  _fromRole: Role,
): Promise<ActionResult> {
  const adminId = await getAdminUserId()
  if (!adminId) return { error: 'Unauthorized' }
  if (newRole === 'admin') return { error: 'Admin role assignment is disabled.' }
  if (userId === adminId) return { error: 'You cannot change your own role.' }

  const supabase = await createClient()
  const { data: targetMembership, error: targetError } = await supabase
    .from('group_members')
    .select('role')
    .eq('user_id', userId)
    .eq('group_id', groupId)
    .single()

  if (targetError) return { error: targetError.message }
  const targetRole = targetMembership?.role as Role | undefined
  if (!targetRole) return { error: 'Target user is not a member of this group.' }
  if (targetRole === 'admin') return { error: 'Cannot change an admin\'s role.' }
  if (targetRole === newRole) return { ok: true }

  const { error } = await supabase
    .from('group_members')
    .update({ role: newRole })
    .eq('user_id', userId)
    .eq('group_id', groupId)

  if (error) return { error: error.message }

  await logAudit(adminId, 'role_change', 'user', userId, {
    from_role: targetRole,
    to_role: newRole,
    target_username: targetUsername,
  })

  return { ok: true }
}

export async function banUser(
  userId: string,
  targetUsername: string,
  reason: string,
): Promise<ActionResult> {
  const adminId = await getAdminUserId()
  if (!adminId) return { error: 'Unauthorized' }

  const supabase = await createClient()
  const { error } = await supabase
    .from('banned_users')
    .upsert({ user_id: userId, banned_by: adminId, reason })

  if (error) return { error: error.message }

  // Ban via Supabase Auth admin API if service role key available
  if (process.env.SUPABASE_SERVICE_ROLE_KEY) {
    const adminClient = createAdminClient()
    const { error: authError } = await adminClient.auth.admin.updateUserById(userId, { ban_duration: '876600h' }) // ~100 years
    if (authError) return { error: authError.message }
  }

  await logAudit(adminId, 'ban', 'user', userId, { reason, target_username: targetUsername })
  return { ok: true }
}

export async function unbanUser(
  userId: string,
  targetUsername: string,
): Promise<ActionResult> {
  const adminId = await getAdminUserId()
  if (!adminId) return { error: 'Unauthorized' }

  const supabase = await createClient()
  const { error } = await supabase
    .from('banned_users')
    .delete()
    .eq('user_id', userId)

  if (error) return { error: error.message }

  if (process.env.SUPABASE_SERVICE_ROLE_KEY) {
    const adminClient = createAdminClient()
    const { error: authError } = await adminClient.auth.admin.updateUserById(userId, { ban_duration: 'none' })
    if (authError) return { error: authError.message }
  }

  await logAudit(adminId, 'unban', 'user', userId, { target_username: targetUsername })
  return { ok: true }
}

export async function resetPassword(userId: string, targetUsername: string): Promise<ActionResult> {
  const adminId = await getAdminUserId()
  if (!adminId) return { error: 'Unauthorized' }

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return { error: 'Password reset requires SUPABASE_SERVICE_ROLE_KEY.' }
  }

  const adminClient = createAdminClient()
  const { data, error: lookupError } = await adminClient.auth.admin.getUserById(userId)
  if (lookupError) return { error: lookupError.message }

  const email = data.user?.email
  if (!email) return { error: 'No email address found for this user.' }

  const supabase = await createClient()
  const { headers } = await import('next/headers')
  const origin = (await headers()).get('origin') ?? ''
  // Recovery links must land on the set-new-password page, not the app.
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${origin}/auth/confirm?next=${encodeURIComponent('/reset-password')}`,
  })
  if (error) return { error: error.message }

  await logAudit(adminId, 'reset_password', 'user', userId, { target_username: targetUsername })
  return { ok: true }
}

export async function deleteGroup(
  groupId: string,
  groupName: string,
): Promise<ActionResult> {
  const adminId = await getAdminUserId()
  if (!adminId) return { error: 'Unauthorized' }

  const supabase = await createClient()
  const { error } = await supabase.from('groups').delete().eq('id', groupId)
  if (error) return { error: error.message }

  await logAudit(adminId, 'delete_group', 'group', groupId, { group_name: groupName })
  return { ok: true }
}

export async function reportMessage(
  messageId: string,
  reason: string,
  category?: string,
): Promise<ActionResult> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Unauthorized' }

  const { error } = await supabase
    .from('reports')
    .insert({
      message_id: messageId,
      reported_by: user.id,
      reason,
      ...(category ? { category } : {}),
    })

  if (isUniqueViolation(error)) return { ok: true }
  if (error) return { error: error.message }
  return { ok: true }
}

export async function markReportReviewed(reportId: string, moderationNote?: string): Promise<ActionResult> {
  const adminId = await getAdminUserId()
  if (!adminId) return { error: 'Unauthorized' }

  const supabase = await createClient()
  const auditMetadata = await getReportAuditMetadata(reportId)
  const closedError = reportActionClosedError(auditMetadata)
  if (closedError) return closedError

  const { error } = await supabase
    .from('reports')
    .update({
      status: 'reviewed',
      ...(moderationNote?.trim() ? { moderation_note: moderationNote.trim() } : {}),
    })
    .eq('id', reportId)

  if (error) return { error: error.message }

  await logAudit(adminId, 'report_reviewed', 'report', reportId, {
    ...auditMetadata,
    moderation_note: moderationNote?.trim() || null,
    status: 'reviewed',
  })

  return { ok: true }
}

export async function dismissReport(reportId: string, moderationNote?: string): Promise<ActionResult> {
  const adminId = await getAdminUserId()
  if (!adminId) return { error: 'Unauthorized' }

  const supabase = await createClient()
  const auditMetadata = await getReportAuditMetadata(reportId)
  const closedError = reportActionClosedError(auditMetadata)
  if (closedError) return closedError

  const { error } = await supabase
    .from('reports')
    .update({
      status: 'dismissed',
      ...(moderationNote?.trim() ? { moderation_note: moderationNote.trim() } : {}),
    })
    .eq('id', reportId)

  if (error) return { error: error.message }

  await logAudit(adminId, 'report_dismissed', 'report', reportId, {
    ...auditMetadata,
    moderation_note: moderationNote?.trim() || null,
    status: 'dismissed',
  })

  return { ok: true }
}

export async function deleteReportedMessage(reportId: string): Promise<ActionResult> {
  const adminId = await getAdminUserId()
  if (!adminId) return { error: 'Unauthorized' }

  const supabase = await createClient()
  const auditMetadata = await getReportAuditMetadata(reportId)
  const closedError = reportActionClosedError(auditMetadata)
  if (closedError) return closedError

  const messageId = auditMetadata.message_id

  if (!messageId) return { error: 'Report is missing a message.' }

  const { error: deleteError } = await supabase
    .from('messages')
    .delete()
    .eq('id', messageId)

  if (deleteError) return { error: deleteError.message }

  const { error: updateError } = await supabase
    .from('reports')
    .update({ status: 'reviewed' })
    .eq('id', reportId)

  if (updateError) return { error: updateError.message }

  await logAudit(adminId, 'delete_message', 'message', messageId, {
    ...auditMetadata,
    status: 'reviewed',
    source: 'report_queue',
  })

  return { ok: true }
}
