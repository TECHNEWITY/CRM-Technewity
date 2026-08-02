import { randomUUID } from 'crypto'
import { IStorageProvider } from './IStorageProvider'
import { google } from 'googleapis'
import { Readable } from 'stream'

export interface IGoogleDriveConfig {
  clientEmail: string
  privateKey: string
  folderId: string
  orgId: string
}

/**
 * GoogleDriveStorageProvider
 *
 * Uses a Google Service Account to store files in a specified Google Drive folder.
 * Files are NOT publicly accessible — all access goes through this server (secure proxy).
 *
 * Security model:
 *  - Service account credentials are stored encrypted in MongoDB
 *  - No direct public URLs are issued; all downloads proxy through the backend
 *  - Only authenticated org members can request a download URL
 */
export default class GoogleDriveStorageProvider implements IStorageProvider {
  private folderId: string
  private orgId: string
  private auth: ReturnType<typeof google.auth.fromJSON> | null = null
  private clientEmail: string
  private privateKey: string

  constructor(config: IGoogleDriveConfig) {
    this.folderId = config.folderId
    this.orgId = config.orgId
    this.clientEmail = config.clientEmail
    // Google stores private keys with literal \n — convert to real newlines
    this.privateKey = config.privateKey.replace(/\\n/g, '\n')
  }

  private getDriveClient() {
    const auth = new google.auth.JWT({
      email: this.clientEmail,
      key: this.privateKey,
      scopes: ['https://www.googleapis.com/auth/drive']
    })
    return google.drive({ version: 'v3', auth })
  }

  randomObjectKeyName(name: string): string {
    const parts = name.split('.')
    const ext = parts[parts.length - 1]
    const base = parts.slice(0, -1).join('-')
    return `${base}-${randomUUID()}.${ext}`
  }

  /**
   * For Google Drive we upload the file directly from the backend
   * and return a special internal proxy URL (/api/storage/drive-proxy/:fileId).
   * The caller must first upload to the presigned URL path — but since Drive
   * doesn't support presigned URLs like S3, we return a special marker URL
   * and the frontend uses a different upload flow (multipart via the backend).
   *
   * NOTE: The name here will be used as the Drive file name.
   */
  async createPresignedUrlWithClient(name: string, type: string): Promise<string> {
    // For Google Drive: return a marker that the upload route will handle.
    // The upload will happen server-side in the storage route.
    // We return a placeholder so the flow knows it's a Drive upload.
    return `drive-upload:${name}:${type}`
  }

  /**
   * Upload a file buffer/stream directly to Google Drive.
   * Used by the storage route when provider is Google Drive.
   */
  async uploadFile(name: string, mimeType: string, content: Buffer | Readable): Promise<{ driveFileId: string; url: string }> {
    const drive = this.getDriveClient()

    const media = {
      mimeType,
      body: content instanceof Buffer ? Readable.from(content) : content
    }

    const response = await drive.files.create({
      requestBody: {
        name,
        parents: [this.folderId]
      },
      media,
      fields: 'id, name'
    })

    const driveFileId = response.data.id!

    // Return internal proxy URL — never a direct Google Drive URL
    const proxyUrl = `/api/storage/drive-proxy/${driveFileId}`

    return { driveFileId, url: proxyUrl }
  }

  /**
   * Returns an internal proxy URL (not a direct Drive URL).
   * The frontend calls /api/storage/drive-proxy/:fileId which streams the file.
   */
  async getObjectURL(name: string): Promise<string> {
    // 'name' here is the Drive file ID stored as keyName
    return `/api/storage/drive-proxy/${name}`
  }

  /**
   * Read a file's content from Google Drive by file ID.
   */
  async getObject(driveFileId: string): Promise<string | null> {
    try {
      const drive = this.getDriveClient()
      const response = await drive.files.get(
        { fileId: driveFileId, alt: 'media' },
        { responseType: 'text' }
      )
      return response.data as string
    } catch (error) {
      console.error('GoogleDriveStorageProvider.getObject error:', error)
      return null
    }
  }

  /**
   * Stream a file from Drive (for the proxy endpoint).
   */
  async getObjectStream(driveFileId: string): Promise<Readable | null> {
    try {
      const drive = this.getDriveClient()
      const response = await drive.files.get(
        { fileId: driveFileId, alt: 'media' },
        { responseType: 'stream' }
      )
      return response.data as Readable
    } catch (error) {
      console.error('GoogleDriveStorageProvider.getObjectStream error:', error)
      return null
    }
  }

  /**
   * Get file metadata (name, mimeType, size) for the proxy to set correct headers.
   */
  async getFileMetadata(driveFileId: string): Promise<{ name: string; mimeType: string; size: string } | null> {
    try {
      const drive = this.getDriveClient()
      const response = await drive.files.get({
        fileId: driveFileId,
        fields: 'name, mimeType, size'
      })
      return {
        name: response.data.name || 'file',
        mimeType: response.data.mimeType || 'application/octet-stream',
        size: response.data.size || '0'
      }
    } catch (error) {
      console.error('GoogleDriveStorageProvider.getFileMetadata error:', error)
      return null
    }
  }

  /**
   * Permanently delete a file from Google Drive by file ID.
   */
  async deleteObject(driveFileId: string): Promise<boolean | null> {
    try {
      const drive = this.getDriveClient()
      await drive.files.delete({ fileId: driveFileId })
      return true
    } catch (error) {
      console.error('GoogleDriveStorageProvider.deleteObject error:', error)
      return null
    }
  }

  /**
   * Validate configuration by trying to list files in the target folder.
   */
  async validateConfig(): Promise<boolean> {
    try {
      const drive = this.getDriveClient()
      await drive.files.list({
        q: `'${this.folderId}' in parents and trashed = false`,
        pageSize: 1,
        fields: 'files(id)'
      })
      return true
    } catch (error) {
      console.error('GoogleDriveStorageProvider.validateConfig error:', error)
      return false
    }
  }
}
