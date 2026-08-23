import {
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
  S3Client
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { randomUUID } from 'crypto'
import { IStorageProvider } from './IStorageProvider'

interface CloudflareR2Config {
  accountId: string
  accessKeyId: string
  secretAccessKey: string
  bucketName: string
  customDomain?: string
  orgId: string
}

export default class CloudflareR2StorageProvider implements IStorageProvider {
  protected client: S3Client
  protected bucket: string
  protected accountId: string
  protected customDomain?: string
  protected orgId: string

  constructor(config: CloudflareR2Config) {
    this.bucket = config.bucketName
    this.accountId = config.accountId
    this.customDomain = config.customDomain
    this.orgId = config.orgId

    const endpoint = `https://${config.accountId}.r2.cloudflarestorage.com`

    this.client = new S3Client({
      region: 'auto',
      endpoint,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey
      }
    })
  }

  randomObjectKeyName(name: string) {
    const splitName = name.split('.')
    const sliceName = splitName.slice(0, -1)
    sliceName.push(randomUUID())
    return `${sliceName.join('-')}.${splitName[splitName.length - 1]}`
  }

  createPresignedUrlWithClient = (name: string, type: string) => {
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: name,
      ContentType: type
    })
    return getSignedUrl(this.client, command, { expiresIn: 3600 })
  }

  async getObjectURL(name: string): Promise<string> {
    if (this.customDomain) {
      return `https://${this.customDomain}/${name}`
    }
    return `https://${this.bucket}.${this.accountId}.r2.cloudflarestorage.com/${name}`
  }

  async getObject(name: string) {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: name
    })
    try {
      const response = await this.client.send(command)
      return await response.Body?.transformToString()
    } catch (error) {
      console.error('[Cloudflare R2 getObject error]', error)
      return null
    }
  }

  async deleteObject(name: string) {
    const command = new DeleteObjectCommand({
      Bucket: this.bucket,
      Key: name
    })
    try {
      const response = await this.client.send(command)
      return response.DeleteMarker
    } catch (error) {
      console.error('[Cloudflare R2 deleteObject error]', error)
      return null
    }
  }

  async validateConfig(): Promise<boolean> {
    try {
      const command = new PutObjectCommand({
        Bucket: this.bucket,
        Key: '.healthcheck-r2.txt',
        Body: 'R2 Connection Test'
      })
      await this.client.send(command)
      return true
    } catch (error) {
      console.error('[Cloudflare R2 validation error]', error)
      return false
    }
  }
}
