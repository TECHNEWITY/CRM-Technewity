import {
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
  S3Client
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { randomUUID } from 'crypto'
import { IStorageProvider } from './IStorageProvider'

interface BackblazeB2Config {
  region: string
  keyId: string
  applicationKey: string
  bucketName: string
  orgId: string
}

export default class BackblazeB2StorageProvider implements IStorageProvider {
  protected client: S3Client
  protected bucket: string
  protected region: string
  protected orgId: string

  constructor(config: BackblazeB2Config) {
    this.bucket = config.bucketName
    this.region = config.region || 'us-east-005'
    this.orgId = config.orgId

    const endpoint = `https://s3.${this.region}.backblazeb2.com`

    this.client = new S3Client({
      region: this.region,
      endpoint,
      credentials: {
        accessKeyId: config.keyId,
        secretAccessKey: config.applicationKey
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
    return `https://${this.bucket}.s3.${this.region}.backblazeb2.com/${name}`
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
      console.error('[Backblaze B2 getObject error]', error)
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
      console.error('[Backblaze B2 deleteObject error]', error)
      return null
    }
  }

  async validateConfig(): Promise<boolean> {
    try {
      const command = new PutObjectCommand({
        Bucket: this.bucket,
        Key: '.healthcheck-b2.txt',
        Body: 'B2 Connection Test'
      })
      await this.client.send(command)
      return true
    } catch (error) {
      console.error('[Backblaze B2 validation error]', error)
      return false
    }
  }
}
