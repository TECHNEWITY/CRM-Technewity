import { Router } from 'express'

import {
  mdOrgGetOne,
  mdStorageAdd,
  mdStorageGet,
  mdStorageGetByOwner,
  mdStorageGetOne,
  mdTaskGetOne,
  mdTaskUpdate
} from '@database'
import { FileOwnerType, FileStorage, OrgStorageType } from '@prisma/client'
import { AuthRequest } from '../../types'
import { fileStorageModel, pmClient } from 'packages/database/src/lib/_prisma'
import { CKEY, findNDelCaches } from '../../lib/redis'
import StorageCache from '../../caches/StorageCache'
import { StorageService } from '../../services/storage.service'
import MaxStorageSizeException from '../../exceptions/MaxStorageSizeException'
import GoogleDriveStorageProvider from '../../providers/storage/GoogleDriveStorageProvider'
import OrganizationStorageService from '../../services/organizationStorage.service'
import { IStorageGoogleDriveConfig } from '../../services/organizationStorage.service'

const router = Router()

export const MAX_STORAGE_SIZE = 100 * 1024 * 1024 // 100Mb
router.get('/current-storage-size', async (req, res) => {
  const { orgId } = req.query as { orgId: string }
  if (!orgId) {
    return res.status(500).send('ORG_MUST_PROVIDED')
  }

  const storageCache = new StorageCache(orgId)
  const totalSize = await storageCache.getTotalSize()

  const { maxStorageSize } = await mdOrgGetOne(orgId)

  res.json({
    status: 200,
    data: {
      maximum: maxStorageSize || MAX_STORAGE_SIZE,
      total: totalSize
    }
  })
})

router.post('/create-presigned-url', async (req, res, next) => {

  const { name, type, orgId, projectId } = req.body as {
    name: string
    type: string
    projectId: string
    orgId: string
  }

  try {
    console.log('initiate storage service', orgId)
    const storageService = new StorageService(orgId)

    const isExceed = await storageService.exceedMaxStorageSize()
    if (isExceed) {
      throw new MaxStorageSizeException()
    }

    console.log('start generating presigned url')

    const { presignedUrl, randName, url } = await storageService.createPresignedUrl({
      path: projectId,
      name,
      type
    })

    console.log('generate presigned 2', presignedUrl)

    res.status(200).json({
      data: {
        name: randName,
        presignedUrl,
        url: url
      }
    })


  } catch (error) {
    console.log(error)
    res.status(error.status).send(error.message)
  }

})

router.delete('/del-file', async (req: AuthRequest, res) => {
  const { id, projectId, orgId } = req.query as { id: string; projectId: string, orgId: string }
  try {
    const key = [CKEY.TASK_QUERY, projectId]
    const storageService = new StorageService(orgId)

    // 1. find file's owner inside storage collection
    const { id: fileId, owner, ownerType, keyName } = await fileStorageModel.findFirst({
      where: {
        id
      }
    })


    if (ownerType === FileOwnerType.TASK) {
      // 2. remove the file from it's owner
      storageService.removeFileFromOwner(owner, fileId)

      // 3. delete file from s3, clear cache and decrease current volume
      await storageService.removeFileFromStorage(keyName, key, fileId)

      res.json({
        status: 200,
      })
    }

  } catch (error) {
    res.status(500).send(error)
  }
})

router.get('/get-files', async (req: AuthRequest, res) => {
  const { ids } = req.query as { ids: string[] }

  try {
    const results = await mdStorageGet(ids)
    res.json({ status: 200, data: results })
  } catch (error) {
    res.status(500).send(error)
  }
})

router.get('/get-files-by-owner', async (req: AuthRequest, res) => {
  try {
    const { ownerId, ownerType } = req.query as {
      ownerId: string
      ownerType: FileOwnerType
    }

    const result = await mdStorageGetByOwner(ownerId, ownerType)

    res.json({ status: 200, data: result })
  } catch (error) {
    res.status(500).send(error)
  }
})

router.post('/save-to-drive', async (req: AuthRequest, res, next) => {
  const { id: uid } = req.authen
  const {
    organizationId,
    owner,
    ownerType,
    projectId,
    name,
    keyName,
    type,
    url,
    size,
    mimeType,
    parentId
  } = req.body as FileStorage

  try {
    if (size) {
      const storageCache = new StorageCache(organizationId)
      await storageCache.incrSize(size)
    }

    const result = await mdStorageAdd({
      organizationId,
      projectId,
      name,
      keyName,
      type,
      url,
      size,
      mimeType,
      parentId: parentId || null,
      isDeleted: false,
      owner,
      ownerType,
      createdAt: new Date(),
      createdBy: uid,
      deletedAt: null,
      deletedBy: null
    })

    res.status(200).json({
      data: result
    })
  } catch (error) {
    res.status(500).send(error)
  }
})

router.get('/get-object-url', async (req, res) => {
  const { keyName, orgId } = req.query as { keyName: string; orgId: string }
  
  try {
    if (!keyName || !orgId) {
      return res.status(400).send('KEY_NAME_AND_ORG_ID_REQUIRED')
    }

    const storageService = new StorageService(orgId)
    const url = await storageService.getObjectUrl(keyName)

    res.json({ 
      status: 200,
      data: { url } 
    })
  } catch (error) {
    console.log('Error generating view URL:', error)
    res.status(500).send(error)
  }
})

/**
 * Secure Google Drive file proxy
 * Streams a Drive file through the backend so it is never directly accessible from Drive.
 * Auth: user must be authenticated (authMiddleware applied at router level in index.ts)
 */
router.get('/drive-proxy/:driveFileId', async (req: AuthRequest, res) => {
  const { driveFileId } = req.params
  const { orgId } = req.query as { orgId: string }

  if (!driveFileId || !orgId) {
    return res.status(400).send('driveFileId and orgId are required')
  }

  try {
    // Load org Drive config
    const orgStorageSvc = new OrganizationStorageService(orgId)
    const storageConfig = await orgStorageSvc.getConfig()

    if (!storageConfig || storageConfig.type !== OrgStorageType.GOOGLE_DRIVE) {
      return res.status(404).send('Google Drive storage not configured for this organization')
    }

    const driveConfig = storageConfig.config as IStorageGoogleDriveConfig
    const driveProvider = new GoogleDriveStorageProvider({
      clientEmail: driveConfig.clientEmail,
      privateKey: driveConfig.privateKey,
      folderId: driveConfig.folderId,
      orgId
    })

    // Fetch file metadata for headers
    const meta = await driveProvider.getFileMetadata(driveFileId)
    if (meta) {
      res.setHeader('Content-Type', meta.mimeType)
      res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(meta.name)}"`)
      if (meta.size && meta.size !== '0') {
        res.setHeader('Content-Length', meta.size)
      }
    }

    // Stream the file directly to the response
    const stream = await driveProvider.getObjectStream(driveFileId)
    if (!stream) {
      return res.status(404).send('File not found in Google Drive')
    }

    stream.pipe(res)
    stream.on('error', (err) => {
      console.error('Drive proxy stream error:', err)
      if (!res.headersSent) res.status(500).send('Stream error')
    })

  } catch (error) {
    console.error('drive-proxy error:', error)
    res.status(500).send('Internal server error')
  }
})

export const storageRouter = router
