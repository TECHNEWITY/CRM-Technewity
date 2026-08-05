import { generateRefreshToken, generateToken } from '../lib/jwt'

interface JwtEncodeData {
  id: string
  email: string
  name: string
  photo: string
}

export default class JwtProvider {
  private data: JwtEncodeData
  private rememberMe?: boolean

  constructor(data: JwtEncodeData, rememberMe?: boolean) {
    this.data = data
    this.rememberMe = rememberMe
  }

  generate() {
    console.time('gen-token')
    const token = generateToken(this.data)
    console.timeEnd('gen-token')

    console.time('gen-refresh-token')
    const refreshExpiry = this.rememberMe ? '30d' : (process.env.JWT_REFRESH_EXPIRED || '4h')
    const refreshToken = generateRefreshToken(
      {
        email: this.data.email,
        rememberMe: !!this.rememberMe
      },
      refreshExpiry
    )

    console.timeEnd('gen-refresh-token')
    return {
      token,
      refreshToken
    }
  }
}
