import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai'

let genAI: GoogleGenerativeAI | null = null

export const getGeminiClient = (): GoogleGenerativeAI => {
  const apiKey = process.env.GEMINI_API_KEY || process.env.AI_API_KEY
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY (or AI_API_KEY) is missing in environment variables!')
  }
  if (!genAI) {
    genAI = new GoogleGenerativeAI(apiKey)
  }
  return genAI
}

export interface ITaskParseResult {
  intent: 'TASK' | 'BUG' | 'EMAIL' | 'UNCLEAR'
  title: string
  rephrased_description: string
  email_subject?: string
  email_body?: string
}

/**
 * Execute an async operation with exponential backoff retry for transient network/LLM errors (429, 5xx)
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries = 3,
  initialDelayMs = 500
): Promise<T> {
  let lastError: any
  let delay = initialDelayMs

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn()
    } catch (err: any) {
      lastError = err
      const isTransient =
        err?.status === 429 ||
        err?.status >= 500 ||
        err?.message?.includes('503') ||
        err?.message?.includes('429') ||
        err?.message?.includes('overloaded') ||
        err?.message?.includes('fetch failed') ||
        err?.message?.includes('RESOURCE_EXHAUSTED')

      if (!isTransient || attempt === maxRetries) {
        throw err
      }

      console.warn(
        `[Gemini Client] Attempt ${attempt} failed with transient error (${err.message}). Retrying in ${delay}ms...`
      )
      await new Promise((resolve) => setTimeout(resolve, delay))
      delay *= 2 // Exponential backoff
    }
  }

  throw lastError
}

export const parseTaskWithGemini = async ({
  rawText,
  commandHint,
  memberNames
}: {
  rawText: string
  commandHint?: 'TASK' | 'BUG' | 'EMAIL' | null
  memberNames: string[]
}): Promise<ITaskParseResult> => {
  return withRetry(async () => {
    const client = getGeminiClient()
    const modelName = process.env.AI_MODEL || 'gemini-2.5-flash'
    const model = client.getGenerativeModel({
      model: modelName,
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: SchemaType.OBJECT,
          properties: {
            intent: {
              type: SchemaType.STRING,
              description: 'The classified intent, must be strictly one of: TASK, BUG, EMAIL, or UNCLEAR.'
            },
            title: {
              type: SchemaType.STRING,
              description: 'A crisp, actionable title (5-10 words maximum) summarizing the task or email.'
            },
            rephrased_description: {
              type: SchemaType.STRING,
              description: 'A professionally rephrased, clean description of what needs to be done. Keep all domain constraints.'
            },
            email_subject: {
              type: SchemaType.STRING,
              description: 'Subject line if the user intent is to send an email.'
            },
            email_body: {
              type: SchemaType.STRING,
              description: 'Email content body in clear HTML or text if sending an email.'
            }
          },
          required: ['intent', 'title', 'rephrased_description']
        }
      }
    })

    const systemInstruction = `
You are an expert CRM assistant for a project management system.
Your job is to parse raw chat messages into structured task/bug records or email dispatches.
${commandHint ? `Note: The user explicitly prefixed a slash command: /${commandHint}. Treat the intent as ${commandHint} unless completely contradictory.` : ''}

Project Members for reference: ${memberNames.join(', ')}.

Guidelines:
1. Rephrase free-form colloquial instructions into professional, clear, and structured descriptions (e.g., retaining specifics like dietary, technical, or marketing constraints).
2. Create a punchy, actionable title.
3. If the user says "email this to <address/person>" or "mail the report to ...", classify intent as EMAIL, provide an appropriate email_subject and clean email_body.
4. If ambiguous or completely nonsensical, set intent to UNCLEAR.
`

    const prompt = `${systemInstruction}\n\nUser Message:\n"""\n${rawText}\n"""`
    const result = await model.generateContent(prompt)
    const responseText = result.response.text()

    try {
      const parsed = JSON.parse(responseText) as ITaskParseResult
      return parsed
    } catch (error) {
      console.error('[Gemini Parse Error] Failed to parse JSON response:', responseText)
      return {
        intent: commandHint || 'TASK',
        title: rawText.slice(0, 50),
        rephrased_description: rawText
      }
    }
  })
}

export const rephraseWithGemini = async (text: string): Promise<string> => {
  return withRetry(async () => {
    const client = getGeminiClient()
    const modelName = process.env.AI_MODEL || 'gemini-2.5-flash'
    const model = client.getGenerativeModel({
      model: modelName
    })

    const prompt = `You are a professional writing assistant for a CRM and project tracker.
Rephrase and improve the following text into a clear, concise, and professional task description.
Preserve all specific requirements, bullet points, technical details, and context.
Return ONLY the rephrased text, nothing else (no introductory phrases, no markdown backticks).

Text to rephrase:
"""
${text}
"""`

    const result = await model.generateContent(prompt)
    return result.response.text().trim()
  })
}
