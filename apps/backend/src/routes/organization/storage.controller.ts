import { OrgStorageRepository } from '@database'
import { BaseController, Controller, Get, Post, Put, UseMiddleware } from '../../core'
import { authMiddleware } from '../../middlewares'
import { AuthRequest } from '../../types'
import InternalServerException from '../../exceptions/InternalServerException'
import { OrgStorageType } from '@prisma/client'
import { IStorageAWSConfig, IStorageGoogleDriveConfig } from '../../services/organizationStorage.service'
import { GB, MB, StorageService } from '../../services/storage.service'
import StorageCache from '../../caches/StorageCache'

@Controller('/org-storage')
@UseMiddleware([authMiddleware])
export class OrganizationStorageController extends BaseController {
  storageService: StorageService
  constructor() {
    super()
    // only use this service to validate storage config
    this.storageService = new StorageService('1')
  }

  @Get('')
  async getOrgStorageConfig() {
    const req = this.req as AuthRequest
    try {
      const { orgId } = req.query as { orgId: string }
      const orgRepo = new OrgStorageRepository()
      const data = await orgRepo.getAwsConfig(orgId)

      // Return config but mask sensitive keys
      const config = data?.config as Record<string, unknown> || {}
      return {
        type: data?.type,
        config: {
          ...config,
          // Mask sensitive values so they don't leak to the frontend
          secretKey: config.secretKey ? '••••••••' : undefined,
          privateKey: config.privateKey ? '••••••••' : undefined,
          accessKey: config.accessKey ? '••••••••' : undefined
        }
      }
    } catch (error) {
      throw new InternalServerException()
    }
  }

  @Put('')
  async updateOrgStorage() {
    const req = this.req as AuthRequest
    try {
      const { orgId, type, config } = req.body as {
        orgId: string
        type: OrgStorageType
        config: (IStorageAWSConfig & { endpoint?: string }) | IStorageGoogleDriveConfig
      }

      console.log('storage configuration', { orgId, type })

      const { id } = req.authen

      // ─── Google Drive ────────────────────────────────────────────────────
      if (type === OrgStorageType.GOOGLE_DRIVE) {
        const driveConfig = config as IStorageGoogleDriveConfig
        const { clientEmail, privateKey, folderId } = driveConfig

        if (!clientEmail || !privateKey || !folderId) {
          throw new Error('Google Drive requires: clientEmail, privateKey, folderId')
        }

        console.log('Start validating Google Drive configuration')
        const valid = await this.storageService.validateConfig({
          type,
          config: { clientEmail, privateKey, folderId }
        })

        if (!valid) {
          throw new Error('Invalid Google Drive configuration – check your service account credentials and folder ID')
        }

        const orgRepo = new OrgStorageRepository()
        const result = await orgRepo.updateOrCreateAwsConfig(orgId, {
          organizationId: orgId,
          config: { clientEmail, privateKey, folderId },
          type,
          createdAt: new Date(),
          createdBy: id,
          updatedAt: null,
          updatedBy: null
        })

        StorageCache.deleteMaxStorageSize(orgId)
        return result
      }

      // ─── AWS S3 / DigitalOcean ───────────────────────────────────────────
      const s3Config = config as IStorageAWSConfig & { endpoint?: string }
      const { bucketName, region, secretKey, accessKey } = s3Config
      let maxStorageSize = parseInt(s3Config.maxStorageSize + '', 10)

      if (!bucketName || !region || !secretKey || !accessKey || !maxStorageSize) {
        throw new Error('Invalid storage configuration')
      }

      if (isNaN(maxStorageSize)) {
        throw new Error('Invalid value')
      }

      if (maxStorageSize !== -1) {
        maxStorageSize = maxStorageSize * GB
      } else {
        maxStorageSize = 999999 * GB
      }

      if (maxStorageSize < 100 * MB) {
        throw new Error('Storage size must be greater than or equal 1GB')
      }

      console.log('Start validating storage configuration')
      const valid = await this.storageService.validateConfig({
        type,
        config: {
          bucketName,
          region,
          secretKey,
          accessKey,
          endpoint: s3Config.endpoint
        }
      })

      if (!valid) {
        throw new Error(`Invalid ${type} configuration`)
      }

      const orgRepo = new OrgStorageRepository()
      const result = await orgRepo.updateOrCreateAwsConfig(orgId, {
        organizationId: orgId,
        config: {
          bucketName,
          region,
          secretKey,
          accessKey,
          maxStorageSize,
          endpoint: s3Config.endpoint
        },
        type,
        createdAt: new Date(),
        createdBy: id,
        updatedAt: null,
        updatedBy: null
      })

      StorageCache.deleteMaxStorageSize(orgId)

      return result
    } catch (error) {
      console.log('create or update org storage error', error)
      throw new Error(error)
    }
  }
}
