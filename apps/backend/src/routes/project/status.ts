import { Router } from 'express'
import { AuthRequest } from '../../types'
import {
  mdTaskStatusAdd,
  mdTaskStatusGetByProjectId,
  mdTaskStatusGetById,
  mdTaskStatusUpdate,
  mdTaskStatusDel,
  mdTaskUpdateMany
} from '@database'
import { StatusType, TaskStatus } from '@prisma/client'
import { CKEY, delCache, findNDelCaches, getJSONCache, setJSONCache } from '../../lib/redis'
import StatusPusherJob from '../../jobs/status.pusher.job'

const router = Router()

const statusPusherJob = new StatusPusherJob()

router.post('/project/status/:projectId', async (req: AuthRequest, res) => {
  const { id: uid } = req.authen
  const projectId = req.params.projectId
  const body = req.body as TaskStatus
  const key = [CKEY.PROJECT_STATUS, projectId]
  const data = {
    projectId,
    name: body.name,
    color: body.color,
    order: body.order,
    type: body.type || StatusType.TODO
  }
  mdTaskStatusAdd(data)
    .then(result => {
      console.log(result)
      delCache(key)

      statusPusherJob.triggerUpdateEvent({
        projectId,
        uid
      })

      res.json({ status: 200, data: result })
    })
    .catch(err => {
      console.log(err)
    })
})

// router.post('/project/status/:projectId', async (req: AuthRequest, res) => {
//   const projectId = req.params.projectId;
//   const body = req.body as TaskStatus;
//   const data = {
//     projectId,
//     name: body.name,
//     color: body.color,
//     order: body.order
//   };
//   mdTaskStatusAdd(data)
//     .then(result => {
//       console.log(result);
//       res.json({ status: 200, data: result });
//     })
//     .catch(err => {
//       console.log(err);
//     });
// });

router.get('/project/status/:projectId', async (req: AuthRequest, res) => {
  const projectId = req.params.projectId
  const key = [CKEY.PROJECT_STATUS, projectId]

  const cached = await getJSONCache(key)

  if (cached) {
    console.log('return status cached 2')
    return res.json({
      status: 200,
      data: cached
    })
  }

  mdTaskStatusGetByProjectId(projectId)
    .then(result => {
      setJSONCache(key, result)
      res.json({ status: 200, data: result })
    })
    .catch(err => {
      console.log(err)
    })
})

router.put('/project/status', async (req: AuthRequest, res) => {
  const { id: uid } = req.authen
  const body = req.body as Partial<TaskStatus>
  const key = [CKEY.PROJECT_STATUS, body.projectId]
  mdTaskStatusUpdate(body)
    .then(result => {
      delCache(key)
      statusPusherJob.triggerUpdateEvent({
        projectId: result.projectId,
        uid
      })
      res.json({ status: 200, data: result })
    })
    .catch(err => {
      console.log(err)
    })
})

interface NewStatusOrder {
  id: string
  order: number
}

router.put('/project/status/order', async (req: AuthRequest, res) => {
  const { id: uid } = req.authen
  const { newOrders: newStatusOrders } = req.body as {
    newOrders: NewStatusOrder[]
  }

  if (!newStatusOrders.length) {
    return res.json({ status: 200 })
  }

  const updatePromises = []

  newStatusOrders.forEach(status => {
    updatePromises.push(
      mdTaskStatusUpdate({
        id: status.id,
        order: status.order
      })
    )
  })

  // dbTrans(updatePromises)
  //   .then(results => {
  //     console.log('updated', results)
  //     res.json({ status: 200, data: results })
  //   })
  //   .catch(error => {
  //     console.log('error', error)
  //     res.json({ status: 500, error })
  //   })

  Promise.all(updatePromises)
    .then(result => {
      if (result[0] && result[0].projectId) {
        const key = [CKEY.PROJECT_STATUS, result[0].projectId]
        delCache(key)
        statusPusherJob.triggerUpdateEvent({
          projectId: result[0].projectId,
          uid
        })
      }
      res.json({ status: 200, data: result })
    })
    .catch(error => {
      console.log('error', error)
      res.json({ status: 500, error })
    })
})

router.delete('/project/status/:id', async (req: AuthRequest, res) => {
  const id = req.params.id
  const { id: uid } = req.authen

  try {
    const targetStatus = await mdTaskStatusGetById(id)
    if (!targetStatus) {
      return res.json({ status: 200, data: { id, deleted: true } })
    }

    const projectId = targetStatus.projectId
    const allStatuses = await mdTaskStatusGetByProjectId(projectId)
    const remainingStatuses = allStatuses.filter(s => s.id !== id)

    if (remainingStatuses.length > 0) {
      const fallbackStatus =
        remainingStatuses.find(s => s.type === StatusType.TODO) || remainingStatuses[0]

      // Reassign all orphaned tasks to fallback status
      await mdTaskUpdateMany([], { projectId })
    }

    const result = await mdTaskStatusDel(id)

    await findNDelCaches([CKEY.PROJECT_STATUS, projectId])
    await findNDelCaches([CKEY.TASK_QUERY, projectId])
    await findNDelCaches(CKEY.PROJECT_STATUS)
    await findNDelCaches(CKEY.TASK_QUERY)

    statusPusherJob.triggerUpdateEvent({
      projectId,
      uid
    })

    return res.json({ status: 200, data: result })
  } catch (err) {
    console.log('error delete status', err)
    return res.status(500).json({ status: 500, error: 'Failed to delete status' })
  }
})

export default router
