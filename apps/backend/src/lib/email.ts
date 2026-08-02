import { Resend } from 'resend'

interface IEmailFields {
  subject: string
  text?: string
  html?: string
  emails: string[]
}

/**
 * Dynamically resolves Resend configuration on every call.
 * This guarantees that changes to .env or runtime environment variables
 * are immediately picked up without needing hardcoded module-level state.
 */
export const sendEmail = async ({ emails, html, subject, text }: IEmailFields) => {
  const token = process.env.RESEND_TOKEN
  const fromEmail = process.env.RESEND_EMAIL_FROM || 'noreply@technewity.com'
  const fromName = process.env.RESEND_EMAIL_NAME || process.env.NEXT_PUBLIC_APP_NAME || 'Technewity Labs'

  if (!token) {
    console.error('[Resend Error] Cannot send email. RESEND_TOKEN is missing in process.env!')
    return { error: { message: 'RESEND_TOKEN is missing in environment variables' } }
  }

  try {
    const resend = new Resend(token)
    const sender = `${fromName} <${fromEmail}>`

    console.log(`[Resend Email Dispatching] From: "${sender}" -> To:`, emails, `Subject: "${subject}"`)

    const response = await resend.emails.send({
      from: sender,
      to: emails,
      subject,
      html: html || text || ''
    })

    const res = response as any

    if (res?.error) {
      console.error('[Resend API Failure] Email was NOT delivered by Resend:', {
        to: emails,
        from: sender,
        error: res.error
      })
      return response
    }

    console.log('[Resend API Success] Email successfully sent! Email ID:', res?.id || res?.data?.id, 'To:', emails)
    return response
  } catch (error) {
    console.error('[Resend Exception] Unexpected exception while sending email:', error)
    return { error }
  }
}

export const sendVerifyEmail = ({
  userName,
  email,
  token
}: {
  userName: string
  email: string
  token: string
}) => {
  const appName = process.env.NEXT_PUBLIC_APP_NAME || 'Technewity Labs'
  const feGateway = process.env.NEXT_PUBLIC_FE_GATEWAY || 'https://crm.technewity.com/'
  const verificationLink = `${feGateway}email-verification?token=${token}`

  return sendEmail({
    emails: [email],
    subject: `[${appName}]: Please Verify Your Email Address`,
    html: `
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
    <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f8f8f8; border-radius: 5px;">
        <tr>
            <td style="padding: 20px;">
                <h1 style="color: #4a4a4a; text-align: center;">Email Verification</h1>
                <p style="font-size: 16px;">Hello <strong>${userName}</strong>,</p>
                <p style="font-size: 16px;">Thank you for signing up! To complete your registration, please verify your email address by clicking the button below:</p>
                <table width="100%" cellpadding="0" cellspacing="0">
                    <tr>
                        <td align="center" style="padding: 20px 0;">
                            <a href="${verificationLink}" style="background-color: #4CAF50; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; font-weight: bold; display: inline-block;">Verify Email</a>
                        </td>
                    </tr>
                </table>
                <p style="font-size: 16px;">If the button doesn't work, you can also copy and paste the following link into your browser:</p>
                <p style="font-size: 14px; word-break: break-all; color: #0066cc;">${verificationLink}</p>
                <p style="font-size: 16px;">If you didn't create an account, please ignore this email.</p>
                <p style="font-size: 16px;">Best regards,<br>${appName} Team</p>
            </td>
        </tr>
    </table>
    <p style="font-size: 12px; color: #888; text-align: center; margin-top: 20px;">This is an automated message, please do not reply to this email.</p>
</body>
`
  })
}
