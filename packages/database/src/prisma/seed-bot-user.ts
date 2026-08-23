import { pmClient } from '../lib/_prisma'
import { ensureBotMemberForProject, ensureBotUserForOrg } from '../lib/botUser'

export const seedAllBotUsers = async () => {
  console.log('[Bot Seed Migration] Starting bot user backfill...')
  const orgs = await pmClient.organization.findMany({
    select: { id: true, name: true, slug: true }
  })

  console.log(`[Bot Seed Migration] Found ${orgs.length} organizations.`)

  for (const org of orgs) {
    const botUser = await ensureBotUserForOrg(org.id)
    if (!botUser) continue

    const projects = await pmClient.project.findMany({
      where: { organizationId: org.id },
      select: { id: true, name: true }
    })

    console.log(`[Bot Seed Migration] Org "${org.name}" has ${projects.length} projects.`)
    for (const project of projects) {
      await ensureBotMemberForProject(project.id, org.id)
    }
  }

  console.log('[Bot Seed Migration] Bot user backfill completed successfully!')
}

if (require.main === module) {
  seedAllBotUsers()
    .then(async () => {
      await pmClient.$disconnect()
      process.exit(0)
    })
    .catch(async (err) => {
      console.error('[Bot Seed Migration Error]', err)
      await pmClient.$disconnect()
      process.exit(1)
    })
}
