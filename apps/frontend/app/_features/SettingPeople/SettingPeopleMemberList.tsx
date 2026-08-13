'use client'
import { useServiceOrgMember } from '@/hooks/useServiceOrgMember'
import { useOrgMemberGet } from '@/services/organizationMember'
import { useOrgMemberStore } from '@/store/orgMember'
import {
  Avatar,
  Button,
  confirmAlert,
  messageSuccess
} from '@ui-components'
import { HiOutlineTrash } from 'react-icons/hi2'
import SettingPeopleDelete from './SettingPeopleDelete'

export default function SettingPeopleMemberList() {
  const { orgMembers } = useOrgMemberStore()
  const { removeMemberFromOrg } = useServiceOrgMember()
  useOrgMemberGet()

  return <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-5">
    {orgMembers.map(mem => {
      return (
        <div
          key={mem.id}
          className="flex group items-center justify-between gap-2 py-2 px-3 bg-white dark:bg-gray-900 dark:border-gray-700 rounded-md border shadow-lg shadow-indigo-100 dark:shadow-gray-900 dark:divide-gray-700">
          <div className="flex items-center gap-2 min-w-0">
            <Avatar src={mem.photo || ''} name={mem.name || ''} />
            <section className="text-gray-600 dark:text-gray-400 min-w-0 truncate">
              <h2 className="truncate font-semibold">{mem.name}</h2>
              <div className="text-xs text-gray-400 dark:text-gray-500 truncate">
                {mem.email}
              </div>
            </section>
          </div>
          <div>
            <div className='block md:hidden md:group-hover:block min-w-[44px] min-h-[44px] flex items-center justify-center'>
              <SettingPeopleDelete
                className=''
                id={mem.id}
                email={mem.email} />
            </div>
          </div>
        </div>
      )
    })}
  </div>
}
