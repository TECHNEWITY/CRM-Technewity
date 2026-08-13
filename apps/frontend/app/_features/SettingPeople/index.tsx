'use client'
import CreateNewMember from './CreateNewMember'
import SettingPeopleMemberList from './SettingPeopleMemberList'
import SettingPeopleInvitation from './SettingPeopleInvitation'

export default function SettingPeopleContent() {

  return (
    <div
      className="overflow-y-auto pb-20 pt-20 custom-scrollbar"
      style={{
        height: 'calc(100dvh - 84px)'
      }}>
      <div className="w-full max-w-[600px] px-4 md:px-0 md:w-[600px] mx-auto">
        <h2 className="text-gray-500 dark:text-gray-400 pb-3">{`Send an invitation via email here 👇`}</h2>
        <div className='flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3'>

          <SettingPeopleInvitation />
          <CreateNewMember />
        </div>
        <SettingPeopleMemberList />
      </div>
    </div>
  )
}
