import { OrgStorageType, OrganizationStorage } from '@prisma/client';
import { orgStorage } from './_prisma';
import { mdOrgUpdate } from './organization';

export class OrgStorageRepository {
  async getAwsConfig(orgId: string) {
    return orgStorage.findFirst({
      where: {
        organizationId: orgId
      }
    })
  }

  async updateOrCreateAwsConfig(orgId: string, data: Omit<OrganizationStorage, 'id'>) {
    const result = await orgStorage.findFirst({
      where: {
        organizationId: orgId
      }
    })

    if (!data.config) return null
    const config = data.config as { [key: string]: unknown }
    const type = data.type

    // For S3-based providers, set storage size; for Google Drive, use unlimited
    const TB = 1024 * 1024 * 1024 * 1024 // 1TB
    const maxStorageSize =
      type === OrgStorageType.GOOGLE_DRIVE
        ? 9999 * TB // effectively unlimited — Google Drive storage is the user's own quota
        : 9999 * TB

    await mdOrgUpdate(orgId, { maxStorageSize })

    console.log('updateOrCreateAwsConfig', { type, orgId })

    if (result) {
      return orgStorage.update({
        where: {
          id: result.id
        },
        data: {
          type,
          config: config as object,
          updatedAt: data.updatedAt,
          updatedBy: data.updatedBy
        }
      })
    }

    // Build config object based on storage type
    let configToSave: Record<string, unknown>

    if (type === OrgStorageType.GOOGLE_DRIVE) {
      configToSave = {
        clientEmail: config.clientEmail,
        privateKey: config.privateKey,
        folderId: config.folderId
      }
    } else {
      // AWS S3 / DigitalOcean
      configToSave = {
        type,
        bucketName: config.bucketName,
        region: config.region,
        secretKey: config.secretKey,
        accessKey: config.accessKey,
        ...(config.endpoint ? { endpoint: config.endpoint } : {})
      }
    }

    return orgStorage.create({
      data: {
        ...data,
        config: configToSave as any
      }
    })
  }
}
