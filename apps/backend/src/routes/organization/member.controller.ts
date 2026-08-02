import {
  mdMemberGetAllByProjectId,
  mdOrgGetOne,
  mdOrgMemberAdd,
  mdOrgMemberExist,
  mdOrgMemberGet,
  mdOrgMemberGetAll,
  mdOrgMemberSeach,
  mdUserFindEmail
} from '@database'
import {
  BaseController,
  Controller,
  Delete,
  Get,
  Post,
  UseMiddleware
} from '../../core'
import { authMiddleware } from '../../middlewares'
import { AuthRequest } from '../../types'
import InternalServerException from '../../exceptions/InternalServerException'
import { InvitationStatus, OrganizationRole } from '@prisma/client'
import BadRequestException from '../../exceptions/BadRequestException'
import OrgMemberRemoveService from '../../services/orgMember/remove.service'
import { sendEmail } from '../../lib/email'

const MAX_ORGANIZATION_MEMBER = 25

@Controller('/org/member')
@UseMiddleware([authMiddleware])
export class OrganizationMemberController extends BaseController {
  orgMemberRemoveService: OrgMemberRemoveService
  constructor() {
    super()
    this.orgMemberRemoveService = new OrgMemberRemoveService()
  }
  @Get('/:orgId')
  async getMembersByOrgId() {
    const req = this.req
    try {
      const { orgId } = req.params as { orgId: string }
      const result = await mdOrgMemberGet(orgId)
      const users = result.map(r => {
        const user = r.users
        user.password = ''

        return { ...user, role: r.role }
      })
      return users
    } catch (error) {
      console.log(error)
      throw new InternalServerException()
    }
  }

  @Post('/invite')
  async inviteMember() {
    const req = this.req as AuthRequest
    const { id: uid } = req.authen
    const { orgId, email } = req.body as {
      orgId: string
      email: string
    }

    const feGateway = process.env.NEXT_PUBLIC_FE_GATEWAY || 'https://crm.technewity.com/'

    // Fetch org name for email content
    let orgName = 'your team'
    try {
      const org = await mdOrgGetOne(orgId)
      if (org && org.name) orgName = org.name
    } catch (_) {
      // silently fall back to generic name
    }

    const foundUser = await mdUserFindEmail(email)

    if (!foundUser) {
      // User has not registered an account yet - dispatch invitation email
      try {
        const signupLink = `${feGateway}sign-up`
        await sendEmail({
          emails: [email],
          subject: `You have been invited to join "${orgName}"`,
          html: `
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
    <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f8f8f8; border-radius: 5px;">
        <tr>
            <td style="padding: 20px;">
                <h1 style="color: #4a4a4a; text-align: center;">You've Been Invited!</h1>
                <p style="font-size: 16px;">Hello,</p>
                <p style="font-size: 16px;">You have been invited to join <strong>${orgName}</strong> on Technewity Labs.</p>
                <p style="font-size: 16px;">Create your free account and start collaborating:</p>
                <table width="100%" cellpadding="0" cellspacing="0">
                    <tr>
                        <td align="center" style="padding: 20px 0;">
                            <a href="${signupLink}" style="background-color: #4CAF50; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; font-weight: bold; display: inline-block;">Accept Invitation &amp; Sign Up</a>
                        </td>
                    </tr>
                </table>
                <p style="font-size: 14px; color: #666;">If you did not expect this invitation, you can safely ignore this email.</p>
                <p style="font-size: 16px;">Best regards,<br>Technewity Labs Team</p>
            </td>
        </tr>
    </table>
</body>`
        })
      } catch (emailErr) {
        console.warn('Failed to send org invitation email:', emailErr)
      }

      return { id: 'pending', email, name: email, status: 'INVITED' }
    }

    const isAlreadyExist = await mdOrgMemberExist({
      orgId,
      uid: foundUser.id
    })

    if (isAlreadyExist) throw new BadRequestException('ALREADY_EXIST')

    const members = await mdOrgMemberGetAll(orgId)

    if (members.length >= MAX_ORGANIZATION_MEMBER) {
      throw new BadRequestException('MAX_ORGANIZATION_MEMBER')
    }

    await mdOrgMemberAdd({
      organizationId: orgId,
      uid: foundUser.id,
      status: InvitationStatus.ACCEPTED,
      role: OrganizationRole.MEMBER,
      createdAt: new Date(),
      createdBy: uid,
      updatedAt: null,
      updatedBy: null
    })

    try {
      await sendEmail({
        emails: [email],
        subject: `You have been added to "${orgName}"`,
        html: `
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
    <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f8f8f8; border-radius: 5px;">
        <tr>
            <td style="padding: 20px;">
                <h1 style="color: #4a4a4a; text-align: center;">You've Been Added to a Team!</h1>
                <p style="font-size: 16px;">Hello <strong>${foundUser.name}</strong>,</p>
                <p style="font-size: 16px;">Great news! You have been added to <strong>${orgName}</strong> on Technewity Labs.</p>
                <p style="font-size: 16px;">You can now log in and start working with your team:</p>
                <table width="100%" cellpadding="0" cellspacing="0">
                    <tr>
                        <td align="center" style="padding: 20px 0;">
                            <a href="${feGateway}" style="background-color: #4CAF50; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; font-weight: bold; display: inline-block;">Open Workspace</a>
                        </td>
                    </tr>
                </table>
                <p style="font-size: 14px; color: #666;">If you did not expect to be added, please contact your organization admin.</p>
                <p style="font-size: 16px;">Best regards,<br>Technewity Labs Team</p>
            </td>
        </tr>
    </table>
</body>`
      })
    } catch (emailErr) {
      console.warn('Failed to send org invite email:', emailErr)
    }

    return foundUser
  }

  @Delete('/remove/:orgId/:uid')
  async removeMember() {
    const { uid, orgId } = this.req.params as { uid: string, orgId: string }

    try {
      console.log('run 5')
      const result = await this.orgMemberRemoveService.implement(uid, orgId)
      return result
    } catch (error) {
      console.log(error)
      throw new InternalServerException(error)
    }

  }

  @Post('/search')
  async searchMember() {
    const req = this.req
    const { projectId, orgId, term } = req.body as {
      projectId: string
      orgId: string
      term: string
    }

    console.log('search query', projectId, orgId, term)

    try {
      const existingMembers = await mdMemberGetAllByProjectId(projectId)
      const existingMemIds = existingMembers.map(m => m.uid)

      const data = await mdOrgMemberSeach({
        orgId,
        term,
        notUids: existingMemIds
      })

      return data
    } catch (error) {
      console.log(error)
      throw new InternalServerException()
    }
  }
}
