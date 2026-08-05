import { jwtDecode } from 'jwt-decode'
import { GoalieOrg, GoalieUser } from '../types'

export const GOALIE_USER = 'GOALIE_USER'
export const GOALIE_JWT_TOKEN = 'GOALIE_JWT_TOKEN'
export const GOALIE_REFRESH_TOKEN = 'GOALIE_REFRESH_TOKEN'
export const GOALIE_ORG = 'GOALIE_ORG'

export const decodeJwtPayload = <T = any>(token: string): T | null => {
  try {
    if (!token) return null
    return jwtDecode<T>(token)
  } catch (error) {
    return null
  }
}

export const getStorage = (rememberMe?: boolean): Storage => {
  if (typeof window === 'undefined') {
    return { getItem: () => null, setItem: () => {}, removeItem: () => {} } as any
  }
  if (rememberMe === true) return window.localStorage
  if (rememberMe === false) return window.sessionStorage
  if (window.localStorage.getItem(GOALIE_JWT_TOKEN) || window.localStorage.getItem(GOALIE_USER)) {
    return window.localStorage
  }
  if (window.sessionStorage.getItem(GOALIE_JWT_TOKEN) || window.sessionStorage.getItem(GOALIE_USER)) {
    return window.sessionStorage
  }
  return window.localStorage
}

export const saveGoalieOrg = (org: GoalieOrg, rememberMe?: boolean) => {
  getStorage(rememberMe).setItem(GOALIE_ORG, JSON.stringify(org))
}

export const saveGoalieUser = (user: GoalieUser, rememberMe?: boolean) => {
  try {
    getStorage(rememberMe).setItem(GOALIE_USER, JSON.stringify(user))
  } catch (error) {
    return
  }
}

export const clearGoalieUser = () => {
  try {
    window.localStorage.removeItem(GOALIE_USER)
    window.sessionStorage.removeItem(GOALIE_USER)
  } catch (error) {
    return
  }
}

export const getGoalieUser = () => {
  try {
    const raw = getStorage().getItem(GOALIE_USER)
    return JSON.parse(raw || '{}') as GoalieUser
  } catch (error) {
    return null
  }
}

export const saveGoalieToken = (token: string, rememberMe?: boolean) => {
  try {
    getStorage(rememberMe).setItem(GOALIE_JWT_TOKEN, token)
  } catch (error) {
    console.log('jwt token not saved')
  }
}

export const saveGoalieRefreshToken = (token: string, rememberMe?: boolean) => {
  try {
    getStorage(rememberMe).setItem(GOALIE_REFRESH_TOKEN, token)
  } catch (error) {
    console.log('refresh token not saved')
  }
}

export const isSessionExpired = () => {
  const now = Date.now()
  const decoded = getDecodeRefreshToken()
  const exp = decoded.exp

  return exp * 1000 + 30000 < now
}

export const isSessionStillAlive = () => {
  return !isSessionExpired()
}

export const getDecodeRefreshToken = () => {
  try {
    const token = getGoalieRefreshToken()
    const decoded = decodeJwtPayload<{ exp: number }>(token || '')
    return decoded ? decoded : { exp: 0 }
  } catch (error) {
    return { exp: 0 }
  }
}

export const getGoalieToken = () => {
  try {
    return getStorage().getItem(GOALIE_JWT_TOKEN)
  } catch (error) {
    return null
  }
}

export const getGoalieRefreshToken = () => {
  try {
    return getStorage().getItem(GOALIE_REFRESH_TOKEN)
  } catch (error) {
    return null
  }
}

export const clearAllGoalieToken = () => {
  try {
    window.localStorage.removeItem(GOALIE_REFRESH_TOKEN)
    window.localStorage.removeItem(GOALIE_JWT_TOKEN)
    window.sessionStorage.removeItem(GOALIE_REFRESH_TOKEN)
    window.sessionStorage.removeItem(GOALIE_JWT_TOKEN)
  } catch (error) {
    return null
  }
}
