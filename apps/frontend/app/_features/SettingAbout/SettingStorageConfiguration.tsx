'use client'

import { orgUpdateStorageConfig } from '@/services/organization'
import {
  Button,
  Form,
  ListItemValue,
  confirmAlert,
  messageError,
  messageSuccess,
} from '@ui-components'
import { useFormik } from 'formik'
import { useState } from 'react'
import { useUserRole } from '../UserPermission/useUserRole'
import { useGetParams } from '@/hooks/useGetParams'
import ListPreset from '@/components/ListPreset'
import { OrgStorageType } from '@prisma/client'
import { HiOutlineCloud, HiOutlineServer } from 'react-icons/hi2'
import { SiGoogledrive } from 'react-icons/si'

const STORAGE_TYPES = [
  {
    id: OrgStorageType.AWS_S3,
    title: 'AWS S3',
    icon: HiOutlineServer,
    desc: 'Amazon Web Services Simple Storage Service'
  },
  {
    id: OrgStorageType.DIGITAL_OCEAN_S3,
    title: 'DigitalOcean Spaces',
    icon: HiOutlineCloud,
    desc: 'DigitalOcean object storage compatible with S3'
  },
  {
    id: OrgStorageType.GOOGLE_DRIVE,
    title: 'Google Drive',
    icon: SiGoogledrive,
    desc: 'Free storage using a Google Service Account & shared Drive folder'
  }
]

const List = Form.List

export default function SettingStorageConfiguration() {
  const { orgRole } = useUserRole()
  const { orgId } = useGetParams()
  const [loading, setLoading] = useState(false)

  const formik = useFormik({
    initialValues: {
      type: OrgStorageType.AWS_S3 as OrgStorageType,
      // S3 / DigitalOcean fields
      bucketName: '',
      region: '',
      accessKey: '',
      secretKey: '',
      maxStorageSize: '-1',
      endpoint: '',
      // Google Drive fields
      clientEmail: '',
      privateKey: '',
      folderId: ''
    },
    onSubmit: values => {
      if (!orgId) return

      if (orgRole !== 'ADMIN') {
        confirmAlert({
          title: 'Restricted Action',
          message: 'Only admins can change storage configuration.',
          yes: () => { /* noop */ }
        })
        return
      }

      const isGoogleDrive = values.type === OrgStorageType.GOOGLE_DRIVE

      // ─── Google Drive validation ────────────────────────────────────────
      if (isGoogleDrive) {
        if (!values.clientEmail || !values.privateKey || !values.folderId) {
          messageError('Client Email, Private Key, and Folder ID are required for Google Drive')
          return
        }
      } else {
        // ─── S3/DO validation ─────────────────────────────────────────────
        const maxSize = parseInt(values.maxStorageSize, 10)
        if (isNaN(maxSize)) {
          messageError('Invalid max storage size')
          return
        }
        if (!values.bucketName || !values.region || !values.accessKey || !values.secretKey) {
          messageError('All storage fields are required')
          return
        }
      }

      setLoading(true)

      const config = isGoogleDrive
        ? {
            clientEmail: values.clientEmail,
            privateKey: values.privateKey,
            folderId: values.folderId
          }
        : {
            bucketName: values.bucketName,
            region: values.region,
            accessKey: values.accessKey,
            secretKey: values.secretKey,
            maxStorageSize: values.maxStorageSize,
            endpoint: values.endpoint || undefined
          }

      orgUpdateStorageConfig(orgId, {
        type: values.type,
        config
      })
        .then(() => {
          messageSuccess('Storage configuration saved!')
          setLoading(false)
        })
        .catch(err => {
          if (err?.response?.data?.message) {
            messageError(err.response.data.message)
          } else {
            messageError('Cannot save configuration — check your credentials and try again')
          }
          setLoading(false)
        })
    }
  })

  const registerForm = (
    name: keyof typeof formik.values,
    handler: typeof formik
  ) => ({
    name,
    error: handler.errors[name],
    value: handler.values[name],
    onChange: handler.handleChange
  })

  const isGoogleDrive = formik.values.type === OrgStorageType.GOOGLE_DRIVE
  const isDigitalOcean = formik.values.type === OrgStorageType.DIGITAL_OCEAN_S3
  const selectedType = STORAGE_TYPES.find(t => t.id === formik.values.type) || STORAGE_TYPES[0]

  return (
    <>
      <form onSubmit={formik.handleSubmit} className="space-y-4">
        {/* ─── Storage Provider Selector ─── */}
        <div className="space-y-2">
          <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Storage Provider</label>
          <div className="grid grid-cols-1 gap-2">
            {STORAGE_TYPES.map(option => {
              const Icon = option.icon
              const isActive = formik.values.type === option.id
              return (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => formik.setFieldValue('type', option.id)}
                  className={`flex items-center gap-3 p-3 rounded-lg border text-left transition-all ${
                    isActive
                      ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20 dark:border-blue-400'
                      : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
                  }`}
                >
                  <Icon className={`w-5 h-5 shrink-0 ${isActive ? 'text-blue-500' : 'text-gray-500'}`} />
                  <div>
                    <p className={`text-sm font-medium ${isActive ? 'text-blue-700 dark:text-blue-300' : 'text-gray-700 dark:text-gray-300'}`}>
                      {option.title}
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">{option.desc}</p>
                  </div>
                  {isActive && (
                    <span className="ml-auto w-4 h-4 rounded-full bg-blue-500 flex items-center justify-center shrink-0">
                      <svg className="w-2.5 h-2.5 text-white" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                      </svg>
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        </div>

        <hr className="border-gray-200 dark:border-gray-700" />

        {/* ─── Google Drive Fields ─── */}
        {isGoogleDrive && (
          <div className="space-y-3">
            <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 text-xs text-amber-800 dark:text-amber-300">
              <strong>Secure Setup:</strong> Files are stored via a Service Account and accessed only through this app's backend. No direct Google Drive URLs are ever shared.
            </div>
            <Form.Input
              title="Service Account Email"
              placeholder="my-service@project.iam.gserviceaccount.com"
              help="The email of your Google Cloud Service Account"
              {...registerForm('clientEmail', formik)}
            />
            <Form.Textarea
              title="Private Key"
              placeholder="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"
              help="Paste the full private key from your service account JSON file"
              {...registerForm('privateKey', formik)}
            />
            <Form.Input
              title="Google Drive Folder ID"
              placeholder="1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms"
              help="The ID from the folder URL: drive.google.com/drive/folders/YOUR_FOLDER_ID"
              {...registerForm('folderId', formik)}
            />
          </div>
        )}

        {/* ─── S3 / DigitalOcean Fields ─── */}
        {!isGoogleDrive && (
          <div className="space-y-3">
            <Form.Input
              title="Access Key"
              {...registerForm('accessKey', formik)}
            />
            <Form.Input
              title="Secret Key"
              type="password"
              {...registerForm('secretKey', formik)}
            />
            <Form.Input
              title={isDigitalOcean ? 'Region (e.g., nyc3)' : 'AWS Region'}
              placeholder={isDigitalOcean ? 'nyc3' : 'us-east-1'}
              {...registerForm('region', formik)}
            />
            <Form.Input
              title={isDigitalOcean ? 'Space Name' : 'Bucket Name'}
              {...registerForm('bucketName', formik)}
            />
            <ListPreset
              title='Max storage size'
              value={formik.values.maxStorageSize}
              onChange={val => formik.setFieldValue('maxStorageSize', val)}
              options={[
                { id: '-1', title: 'Unlimited' },
                { id: '10', title: '10 GB' },
                { id: '20', title: '20 GB' },
                { id: '50', title: '50 GB' },
                { id: '100', title: '100 GB' }
              ]}
            />
          </div>
        )}

        <div className="mt-4 text-right">
          <Button loading={loading} type="submit" title="Save Configuration" primary />
        </div>
      </form>
    </>
  )
}
