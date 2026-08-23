import { Router } from 'express'
import { authMiddleware } from '../../middlewares'
import { AuthRequest } from '../../types'
import { rephraseWithGemini } from '../../services/ai/gemini.client'
import { AiUsageLogRepository } from '@database'

const router = Router()
const aiUsageRepo = new AiUsageLogRepository()

router.post('/ai/rephrase', [authMiddleware], async (req: AuthRequest, res) => {
  const { text, organizationId } = req.body as { text: string; organizationId?: string }
  const { id: userId } = req.authen

  if (!text || !text.trim()) {
    return res.status(400).json({ status: 400, error: 'Text is required to rephrase.' })
  }

  try {
    const rephrasedText = await rephraseWithGemini(text)

    await aiUsageRepo.logUsage({
      organizationId: organizationId || 'UNKNOWN_ORG',
      userId,
      action: 'REPHRASE',
      tokensUsed: 80,
      success: true
    })

    return res.json({
      status: 200,
      data: {
        rephrasedText
      }
    })
  } catch (error: any) {
    console.error('[AI Rephrase API Error]', error)
    return res.status(500).json({ status: 500, error: error?.message || 'Failed to rephrase text' })
  }
})

export default router
