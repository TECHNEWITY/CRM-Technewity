import { useGetParams } from "@/hooks/useGetParams";
import { meetingService } from "@/services/meeting";
import { Button, Form, randomId, setFixLoading } from "@ui-components";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

export default function MeetingRoomList() {
  const { orgName } = useGetParams()
  const { push } = useRouter()
  const [loading, setloading] = useState(false)
  const [link, setLink] = useState('')

  const showRedirectingStatus = () => {
    setFixLoading(true)
    // fallback as page was suspended
    setTimeout(() => {
      setFixLoading(false)
    }, 5000)
  }

  const createInstantMeeting = () => {
    if (loading) return
    setloading(true)
    const name = randomId()
    meetingService.createRoom(name).then(res => {

      setloading(false)
      showRedirectingStatus()
      push(`/${orgName}/meeting/${name}`)

    }).catch(err => {
      setloading(false)
    })
  }

  const onJoin = () => {
    try {
      new URL(link)
      push(link)
    } catch (error) {
      if (!link) return

      push(`/${orgName}/meeting/${link}`)

    }
  }

  // only clear fixed loading as the page unmount
  useEffect(() => {
    return () => {
      // setFixLoading(false)
    }
  })

  return (
    <div className="meeting-list flex bg-white dark:bg-gray-900 items-center justify-center min-h-screen px-4 py-8">
      <div className="w-full max-w-[450px]">
        <p className="text-lg sm:text-2xl w-full mb-6 sm:mb-8 text-gray-700 dark:text-gray-400">
          Quickly create your meeting room or just paste your meeting link or code to join for free
        </p>
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 sm:gap-2 w-full">
          <Button title="Create instant meeting" loading={loading} primary onClick={createInstantMeeting} className="w-full sm:w-auto" />
          <Form.Input value={link} onChange={ev => setLink(ev.target.value)} placeholder="Paste link or enter code" className="w-full" />
          <Button title="Join now" onClick={onJoin} className="w-full sm:w-auto" />
        </div>
      </div>
    </div>
  )
}
