import { cert, initializeApp, getApps } from 'firebase-admin/app'

try {
  let firebaseConfigJson: any = null
  if (process.env.NEXT_PUBLIC_FIREBASE_CLIENT_CONFIG) {
    try {
      firebaseConfigJson = JSON.parse(process.env.NEXT_PUBLIC_FIREBASE_CLIENT_CONFIG)
    } catch (e) {
      // ignore
    }
  }

  const projectId = process.env.FIREBASE_PROJECT_ID || (firebaseConfigJson && firebaseConfigJson.projectId) || 'crm-technewity'

  if (!getApps().length) {
    if (process.env.FIREBASE_PRIVATE_KEY && process.env.FIREBASE_CLIENT_EMAIL) {
      const serviceAccount = {
        projectId,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
      }
      initializeApp({
        credential: cert(serviceAccount),
        projectId
      })
    } else {
      initializeApp({
        projectId
      })
    }
  }
} catch (error) {
  console.warn('Firebase admin missing configuration, initializing default projectId')
}
