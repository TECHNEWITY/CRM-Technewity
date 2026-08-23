import { InvitationStatus, MemberRole, OrganizationRole } from '@prisma/client'
import { pmClient } from './_prisma'

export const BOT_USER_EMAIL_DOMAIN = 'technewity.ai'

export const getOrgBotEmail = (orgSlugOrId: string) => {
  return `bot+${orgSlugOrId}@${BOT_USER_EMAIL_DOMAIN}`
}

export const ensureBotUserForOrg = async (organizationId: string) => {
  try {
    const org = await pmClient.organization.findUnique({
      where: { id: organizationId }
    })

    if (!org) {
      console.warn(`[Bot Seed] Organization ${organizationId} not found`)
      return null
    }

    const botEmail = getOrgBotEmail(org.slug || org.id)
    let botUser = await pmClient.user.findFirst({
      where: {
        email: botEmail,
        isBot: true
      }
    })

    if (!botUser) {
      botUser = await pmClient.user.create({
        data: {
          email: botEmail,
          password: 'BOT_INTERNAL_NO_LOGIN',
          name: 'AI Bot',
          bio: 'Automated CRM AI Assistant',
          photo: 'https://api.dicebear.com/7.x/bottts/svg?seed=' + org.slug,
          status: 'ACTIVE',
          isBot: true,
          createdAt: new Date(),
          createdBy: 'SYSTEM'
        }
      })
      console.log(`[Bot Seed] Created Bot User for Org "${org.name}":`, botUser.id)
    }

    // Ensure bot is an OrganizationMember
    const orgMember = await pmClient.organizationMembers.findFirst({
      where: {
        organizationId,
        uid: botUser.id
      }
    })

    if (!orgMember) {
      await pmClient.organizationMembers.create({
        data: {
          uid: botUser.id,
          organizationId,
          role: OrganizationRole.MEMBER,
          status: InvitationStatus.ACCEPTED,
          createdAt: new Date(),
          createdBy: 'SYSTEM'
        }
      })
      console.log(`[Bot Seed] Attached Bot User as OrgMember for Org "${org.name}"`)
    }

    return botUser
  } catch (error) {
    console.error('[Bot Seed Error] Failed to ensure bot user:', error)
    return null
  }
}

export const ensureBotMemberForProject = async (projectId: string, organizationId: string) => {
  try {
    const botUser = await ensureBotUserForOrg(organizationId)
    if (!botUser) return null

    const existingProjectMember = await pmClient.members.findFirst({
      where: {
        projectId,
        uid: botUser.id
      }
    })

    if (!existingProjectMember) {
      const newMember = await pmClient.members.create({
        data: {
          projectId,
          uid: botUser.id,
          role: MemberRole.MEMBER,
          createdAt: new Date(),
          createdBy: 'SYSTEM'
        }
      })
      console.log(`[Bot Seed] Auto-added Bot User to Project ${projectId}`)
      return newMember
    }

    return existingProjectMember
  } catch (error) {
    console.error('[Bot Seed Error] Failed to ensure bot member for project:', error)
    return null
  }
}
