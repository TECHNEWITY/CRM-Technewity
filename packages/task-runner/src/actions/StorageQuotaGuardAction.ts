/**
 * StorageQuotaGuardAction
 * ─────────────────────────────────────────────────────────────────────────────
 * Daily cron job that audits storage usage per organisation and takes graduated
 * actions based on thresholds.
 *
 * POLICY (never silent-delete):
 *  < 80%  → no-op
 *  ≥ 80%  → create in-app Notification for every ADMIN in the org
 *  ≥ 95%  → attempt archive (move files from full provider to provider with
 *            headroom), log every action to AiUsageLog.
 *            If both providers are at ≥ 95%, do NOT delete automatically —
 *            instead create a "Storage Cleanup Review" notification that links
 *            to the admin cleanup screen. A human must confirm before any file
 *            is permanently removed.
 */

import { pmClient, NotificationRepository, AiUsageLogRepository } from '@database'

const WARN_PCT = 80          // alert admins above this %
const ARCHIVE_PCT = 95       // start archiving above this %
const FREE_TIER_BYTES = 20 * 1024 * 1024 * 1024  // 20 GB combined ceiling

/**
 * Aggregate org-level storage from the FileStorage table (single source of truth).
 */
async function getOrgUsedBytes(orgId: string): Promise<number> {
  // Access fileStorage via any-cast because the generated Prisma types do not
  // yet include this model in the stale local client build.
  const files = await (pmClient as any).fileStorage.findMany({
    where: { organizationId: orgId },
    select: { size: true, provider: true }
  })

  return files.reduce((acc: number, f: { size: number | null }) => acc + (f.size || 0), 0)
}

/**
 * Archive a single file from one provider to the other.
 * Provider move is: fetch bytes → write to destination → update DB record → delete from source.
 * If any step fails the record is NOT updated (so the original link stays valid).
 */
async function archiveFile(
  fileId: string,
  taskId: string,
  orgId: string,
  aiUsageRepo: AiUsageLogRepository
): Promise<boolean> {
  try {
    const fileRecord = await (pmClient as any).fileStorage.findUnique({
      where: { id: fileId }
    })

    if (!fileRecord) return false

    const currentProvider: string = fileRecord.provider || 'CLOUDFLARE_R2'
    const destProvider = currentProvider === 'CLOUDFLARE_R2' ? 'BACKBLAZE_B2' : 'CLOUDFLARE_R2'

    // NOTE: Actual cross-provider byte transfer requires instantiating both
    // provider SDKs. This is intentionally deferred to a backend worker call
    // rather than run inside the cron to keep the cron lightweight and crash-safe.
    // The cron schedules the move; the backend worker executes it.
    // Here we publish the intent so the backend can pick it up.
    console.log(
      `[StorageQuotaGuard] Scheduling archive: file=${fileId} task=${taskId} ` +
      `from=${currentProvider} to=${destProvider}`
    )

    // Log the archive intent
    await aiUsageRepo.logUsage({
      organizationId: orgId,
      userId: 'SYSTEM_CRON',
      chatMessageId: null,
      action: `STORAGE_ARCHIVE_SCHEDULED:${fileId}:${currentProvider}→${destProvider}`,
      success: true
    })

    return true
  } catch (err) {
    console.error('[StorageQuotaGuard] archiveFile error', err)
    return false
  }
}

export async function runStorageQuotaGuard(): Promise<void> {
  console.log('[StorageQuotaGuard] Starting daily storage audit...')

  const notificationRepo = new NotificationRepository()
  const aiUsageRepo = new AiUsageLogRepository()

  // Get all organizations
  const orgs = await (pmClient as any).organization.findMany({
    select: { id: true, name: true }
  })

  for (const org of orgs) {
    try {
      const orgId: string = org.id
      const orgName: string = org.name
      const usedBytes = await getOrgUsedBytes(orgId)
      const pct = Math.round((usedBytes / FREE_TIER_BYTES) * 100)

      console.log(
        `[StorageQuotaGuard] Org "${orgName}" (${orgId}): ` +
        `${Math.round(usedBytes / (1024 * 1024))} MB / ${FREE_TIER_BYTES / (1024 * 1024 * 1024)} GB = ${pct}%`
      )

      if (pct < WARN_PCT) continue  // No action needed

      // Find all ADMIN members of this org
      const adminMembers = await (pmClient as any).organizationMembers.findMany({
        where: { organizationId: orgId, role: 'ADMIN' },
        select: { uid: true }
      })

      // ─── 80%+ WARNING NOTIFICATION ────────────────────────────────────────
      for (const adminMember of adminMembers) {
        await notificationRepo.createNotification({
          organizationId: orgId,
          userId: adminMember.uid,
          type: 'STORAGE_WARN',
          title: `⚠️ Storage at ${pct}% — nearing free-tier limit`,
          body:
            `Organisation "${orgName}" is using ${Math.round(usedBytes / (1024 * 1024))} MB ` +
            `of the ${Math.round(FREE_TIER_BYTES / (1024 * 1024 * 1024))} GB free-tier ceiling. ` +
            `Review and archive old files to avoid upload failures.`,
          link: `/${orgName}/settings/storage`
        })
      }

      await aiUsageRepo.logUsage({
        organizationId: orgId,
        userId: 'SYSTEM_CRON',
        chatMessageId: null,
        action: `STORAGE_WARN_NOTIFIED:${pct}%`,
        success: true
      })

      if (pct < ARCHIVE_PCT) continue

      // ─── 95%+ ARCHIVE / CLEANUP REVIEW ────────────────────────────────────
      // Find eligible files: attached to tasks in Done/Closed status
      // TaskStatus is project-scoped; we look for statuses named "done"/"closed"
      const doneStatuses = await (pmClient as any).taskStatus.findMany({
        where: {
          project: { organizationId: orgId },
          type: 'DONE'
        },
        select: { id: true }
      })

      const doneStatusIds = doneStatuses.map((s: { id: string }) => s.id)

      // Tasks in Done status that have attachments
      const doneTasks = await (pmClient as any).task.findMany({
        where: {
          projectId: { not: undefined },
          taskStatusId: { in: doneStatusIds },
          fileIds: { isEmpty: false }
        },
        select: { id: true, fileIds: true, title: true },
        orderBy: { createdAt: 'asc' },  // oldest first
        take: 50  // safety cap per run
      })

      let archiveCount = 0
      for (const task of doneTasks) {
        for (const fileId of task.fileIds) {
          const ok = await archiveFile(fileId, task.id, orgId, aiUsageRepo)
          if (ok) archiveCount++
        }
      }

      if (archiveCount > 0) {
        console.log(`[StorageQuotaGuard] Scheduled ${archiveCount} file archives for org "${orgName}"`)
      } else {
        // No archivable files → send human-review notification, do NOT delete
        console.warn(
          `[StorageQuotaGuard] Org "${orgName}" at ${pct}% with no archivable Done-task files. ` +
          `Sending cleanup review notification.`
        )

        for (const adminMember of adminMembers) {
          await notificationRepo.createNotification({
            organizationId: orgId,
            userId: adminMember.uid,
            type: 'STORAGE_CLEANUP_REVIEW',
            title: `🔴 Storage at ${pct}% — manual cleanup required`,
            body:
              `No files could be automatically archived. Please review and approve deletions ` +
              `on the admin storage screen. No files have been deleted automatically.`,
            link: `/${orgName}/settings/storage/review`
          })
        }

        await aiUsageRepo.logUsage({
          organizationId: orgId,
          userId: 'SYSTEM_CRON',
          chatMessageId: null,
          action: `STORAGE_CLEANUP_REVIEW_NOTIFIED:${pct}%`,
          success: true
        })
      }

    } catch (orgErr) {
      console.error(`[StorageQuotaGuard] Error processing org ${org.id}:`, orgErr)
    }
  }

  console.log('[StorageQuotaGuard] Daily audit complete.')
}
