import StorageConfigurationNotFoundException from "../exceptions/StorageConfigurationNotFoundException"
import OrganizationStorageService, { IStorageAWSConfig, IStorageGoogleDriveConfig } from "./organizationStorage.service"
import AwsS3StorageProvider from "../providers/storage/AwsS3StorageProvider"
import DigitalOceanStorageProvider from '../providers/storage/DigitalOceanStorageProvider'
import GoogleDriveStorageProvider from '../providers/storage/GoogleDriveStorageProvider'
import CloudflareR2StorageProvider from '../providers/storage/CloudflareR2StorageProvider'
import BackblazeB2StorageProvider from '../providers/storage/BackblazeB2StorageProvider'
import { IStorageProvider } from '../providers/storage/IStorageProvider'
import { OrgStorageType } from "@prisma/client"
import { PutObjectCommand, HeadBucketCommand, S3Client } from "@aws-sdk/client-s3"
import { fileStorageModel, mdStorageGetOne, mdTaskGetOne, mdTaskUpdate } from '@database'
import StorageCache from "../caches/StorageCache"
import IncorrectConfigurationException from "../exceptions/IncorrectConfigurationException"
import { findNDelCaches } from "../lib/redis"


export const MB = 1024 * 1024
export const GB = 1024 * MB
export const MAX_STORAGE_SIZE = 10 * GB // 10Gb

const minioEndpoint = process.env.AWS_MINIO_ENDPOINT

export class StorageService {
  protected orgId: string
  private storageProvider: IStorageProvider

  constructor(orgId: string) {
    this.orgId = orgId
  }

  protected async getStorageConfig() {
    const orgStorageService = new OrganizationStorageService(this.orgId)
    const storage = await orgStorageService.getConfig()

    console.log('get storage config', storage)

    if (!storage) {
      throw new StorageConfigurationNotFoundException()
    }

    return storage
  }

  protected async initStorageProvider(): Promise<IStorageProvider> {
    if (this.storageProvider) {
      return this.storageProvider
    }

    const storage = await this.getStorageConfig()
    const config = storage.config

    console.log('storage type', storage.type)

    switch (storage.type) {
      case OrgStorageType.DIGITAL_OCEAN_S3: {
        const c = config as IStorageAWSConfig
        this.storageProvider = new DigitalOceanStorageProvider({
          region: c.region,
          accessKey: c.accessKey,
          secretKey: c.secretKey,
          bucketName: c.bucketName,
          orgId: this.orgId
        })
        break
      }

      case OrgStorageType.AWS_S3: {
        const c = config as IStorageAWSConfig
        if (minioEndpoint) {
          this.storageProvider = new AwsS3StorageProvider({
            orgId: this.orgId,
            ...c,
            endpoint: minioEndpoint,
            forcePathStyle: true
          })
        } else {
          this.storageProvider = new AwsS3StorageProvider({
            orgId: this.orgId,
            ...c
          })
        }
        break
      }

      case OrgStorageType.GOOGLE_DRIVE: {
        const c = config as IStorageGoogleDriveConfig
        this.storageProvider = new GoogleDriveStorageProvider({
          clientEmail: c.clientEmail,
          privateKey: c.privateKey,
          folderId: c.folderId,
          orgId: this.orgId
        })
        break
      }

      case OrgStorageType.CLOUDFLARE_R2: {
        const c = config as any
        this.storageProvider = new CloudflareR2StorageProvider({
          accountId: c.accountId || c.region,
          accessKeyId: c.accessKey || c.accessKeyId,
          secretAccessKey: c.secretKey || c.secretAccessKey,
          bucketName: c.bucketName,
          customDomain: c.customDomain,
          orgId: this.orgId
        })
        break
      }

      case OrgStorageType.BACKBLAZE_B2: {
        const c = config as any
        this.storageProvider = new BackblazeB2StorageProvider({
          region: c.region || 'us-east-005',
          keyId: c.keyId || c.accessKey,
          applicationKey: c.applicationKey || c.secretKey,
          bucketName: c.bucketName,
          orgId: this.orgId
        })
        break
      }

      default:
        throw new Error(`Unsupported storage type: ${storage.type}`)
    }

    return this.storageProvider
  }

  async removeFileFromOwner(owner: string, fileId: string) {
    const task = await mdTaskGetOne(owner)

    const { fileIds } = task

    if (!fileIds.includes(fileId)) {
      // return 'FILE_NOT_EXIST_IN_TASK'
      throw new Error('FILE_NOT_EXIST_IN_TASK')
    }

    task.fileIds = fileIds.filter(f => f !== fileId)

    delete task.id

    const promises = []
    promises.push(
      fileStorageModel.delete({
        where: { id: fileId }
      })
    )

    promises.push(
      mdTaskUpdate({
        id: owner,
        ...task
      })
    )

    await Promise.all(promises)
  }

  async removeFileFromStorage(name: string, key: string[], fileId: string) {
    const storageCache = new StorageCache(this.orgId)
    const provider = await this.initStorageProvider()
    await provider.deleteObject(name)

    await findNDelCaches(key)

    // decrease storage size
    const file = await mdStorageGetOne(fileId)
    if (file && file.size) {
      storageCache.decrSize(file.size)
    }
  }

  async validateConfig({ type, config }: {
    type: OrgStorageType,
    config: {
      // AWS / DigitalOcean fields
      bucketName?: string,
      region?: string,
      secretKey?: string,
      accessKey?: string,
      endpoint?: string,
      // Google Drive fields
      clientEmail?: string,
      privateKey?: string,
      folderId?: string
    }
  }): Promise<boolean> {
    try {
      if (type === OrgStorageType.AWS_S3) {
        return await this.validateAwsConfig(config as { bucketName: string; region: string; secretKey: string; accessKey: string; endpoint?: string })
      } else if (type === OrgStorageType.DIGITAL_OCEAN_S3) {
        return await this.validateDigitalOceanConfig(config as { bucketName: string; region: string; secretKey: string; accessKey: string })
      } else if (type === OrgStorageType.GOOGLE_DRIVE) {
        return await this.validateGoogleDriveConfig(config as { clientEmail: string; privateKey: string; folderId: string })
      } else if (type === OrgStorageType.CLOUDFLARE_R2) {
        const provider = new CloudflareR2StorageProvider({
          accountId: (config as any).accountId || config.region || '',
          accessKeyId: config.accessKey || (config as any).accessKeyId || '',
          secretAccessKey: config.secretKey || (config as any).secretAccessKey || '',
          bucketName: config.bucketName || '',
          orgId: this.orgId
        })
        return await provider.validateConfig()
      } else if (type === OrgStorageType.BACKBLAZE_B2) {
        const provider = new BackblazeB2StorageProvider({
          region: config.region || 'us-east-005',
          keyId: (config as any).keyId || config.accessKey || '',
          applicationKey: (config as any).applicationKey || config.secretKey || '',
          bucketName: config.bucketName || '',
          orgId: this.orgId
        })
        return await provider.validateConfig()
      }
      return false
    } catch (error) {
      console.error('Storage validation error:', error)
      return false
    }
  }

  private async validateGoogleDriveConfig(config: {
    clientEmail: string,
    privateKey: string,
    folderId: string
  }): Promise<boolean> {
    try {
      const provider = new GoogleDriveStorageProvider({
        clientEmail: config.clientEmail,
        privateKey: config.privateKey,
        folderId: config.folderId,
        orgId: this.orgId
      })
      return await provider.validateConfig()
    } catch (error) {
      console.error('Google Drive validation error:', error)
      return false
    }
  }

  private async validateAwsConfig(config: {
    bucketName: string,
    region: string,
    secretKey: string,
    accessKey: string,
    endpoint?: string
  }): Promise<boolean> {
    let s3Config = {
      region: config.region,
      credentials: {
        accessKeyId: config.accessKey,
        secretAccessKey: config.secretKey
      }
    }

    if (minioEndpoint) {
      s3Config = {
        ...s3Config,
        ...{
          endpoint: minioEndpoint,
          forcePathStyle: true
        }
      }
    }

    const client = new S3Client(s3Config);

    const command = new PutObjectCommand({
      Bucket: config.bucketName,
      Key: "hello-s3.txt",
      Body: "Hello S3!",
    });

    try {
      const response = await client.send(command);
      console.log(response);
      return true
    } catch (err) {
      console.error(err);
      return false
    }
  }

  private async validateDigitalOceanConfig(config: {
    bucketName: string,
    region: string,
    secretKey: string,
    accessKey: string,
    endpoint?: string
  }): Promise<boolean> {
    try {
      const s3 = new S3Client({
        credentials: {
          accessKeyId: config.accessKey,
          secretAccessKey: config.secretKey,
        },
        // https://docs.digitalocean.com/products/spaces/how-to/use-aws-sdks/#configure-a-client
        endpoint: `https://${config.region}.digitaloceanspaces.com`,
        region: 'us-east-1',
        forcePathStyle: false,
      })

      await s3.send(new PutObjectCommand({
        Bucket: config.bucketName,
        Key: "test-connection.txt",
        Body: "Testing Digital Ocean Spaces connection",
      }));

      return true
    } catch (error) {
      console.error('Digital Ocean validation error:', error)
      return false
    }
  }

  async createPresignedUrl({ path, type, name }: { path: string, name: string, type: string }) {
    path = [this.orgId, path].filter(Boolean).join('/')
    const provider = await this.initStorageProvider()
    console.log('provider', provider)
    const randName = `${path}/` + provider.randomObjectKeyName(name)

    try {
      const presignedUrl = await provider.createPresignedUrlWithClient(randName, type)
      return {
        randName,
        presignedUrl,
        url: await provider.getObjectURL(randName)
      }
    } catch (error) {
      console.log(error)
      throw new IncorrectConfigurationException()
    }
  }

  async exceedMaxStorageSize() {
    const orgId = this.orgId
    const storageCache = new StorageCache(orgId)
    const totalSize = await storageCache.getTotalSize()
    const maxStorageSize = await storageCache.getMaxStorageSize()
    // const { maxStorageSize } = await mdOrgGetOne(organizationId)

    //  unlimited storage size
    if (maxStorageSize === -1) {
      return true
    }

    if (maxStorageSize && totalSize > maxStorageSize) {
      return true
    }

    if (!isNaN(totalSize) && totalSize > MAX_STORAGE_SIZE) {
      return true
    }

    return false
  }

  public async getObjectUrl(keyName: string): Promise<string> {
    const provider = await this.initStorageProvider()
    return provider.getObjectURL(keyName)
  }

  /**
   * Returns the combined storage usage for this org across all providers,
   * using the FileStorage table as the source of truth for per-file sizes.
   *
   * FREE_TIER_CEILING_BYTES: Cloudflare R2 (10 GB) + Backblaze B2 (10 GB) = 20 GB
   */
  public static readonly FREE_TIER_CEILING_BYTES = 20 * 1024 * 1024 * 1024

  public async getCombinedUsage(): Promise<{
    usedBytes: number
    totalBytes: number
    percentUsed: number
  }> {
    const files = await fileStorageModel.findMany({
      where: { organizationId: this.orgId },
      select: { size: true }
    })

    const usedBytes = files.reduce((acc: number, f: { size: number | null }) => acc + (f.size || 0), 0)
    const totalBytes = StorageService.FREE_TIER_CEILING_BYTES
    const percentUsed = Math.round((usedBytes / totalBytes) * 100)

    return { usedBytes, totalBytes, percentUsed }
  }
}

