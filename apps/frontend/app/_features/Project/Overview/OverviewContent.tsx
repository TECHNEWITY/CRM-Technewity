import './style.css'
import { useUser } from '@auth-client'
import { Button } from '@ui-components'
import { dboardCreate } from '@/services/dashboard'
import { useParams } from 'next/navigation'
import DashboardComponentCreate from '../../Dashboard/DasboardComponentCreate'
import DboardComponentList from '../../Dashboard/DboardComponentList'
import { useOverviewContext } from './context'
import Image from 'next/image'
import { LoadingSpinnerIcon } from 'packages/ui-components/src/components/Loading/Icon'

export default function OverviewContent() {
  const { user } = useUser()
  const { projectId } = useParams()

  const { loading, setLoading, dboardId, setDboardId } = useOverviewContext()

  const onCreateDashboard = () => {
    setLoading(true)
    dboardCreate({
      projectId,
      title: 'Overview dashboard',
      isDefault: true
    })
      .then(res => {
        const { status, data } = res.data
        if (status !== 200) {
          setLoading(false)
          return
        }

        setDboardId(data ? data.id : null)
      })
      .finally(() => {
        setLoading(false)
      })
  }

  return (
    <div id="overview" className="mx-auto w-full max-w-[1130px] px-4 md:px-0 md:w-[1130px] relative pt-3">
      {loading ? (
        <div
          className="absolute top-0 left-0 w-full z-20 flex items-center justify-center"
          style={{ height: 'calc(100dvh - 83px)' }}>
          <div className="flex items-center gap-3 bg-white dark:bg-gray-900 px-4 py-3 rounded-md shadow-lg dark:shadow-gray-900 ">
            <div className="w-4 h-4">
              <LoadingSpinnerIcon />
            </div>
            <span>Loading ...</span>
          </div>
        </div>
      ) : null}

      <div className="w-full group">
        {!loading && !dboardId ? (
          <div className="flex flex-col md:flex-row items-center gap-2 w-full max-w-[720px] md:w-[720px] text-gray-500 justify-center m-auto mt-[40px] md:mt-[175px] bg-white dark:bg-gray-900 dark:border-gray-700 dark:shadow-gray-900 dark:text-gray-400 px-4 md:px-10 py-6 rounded-lg shadow-xl shadow-indigo-100 border-4 border-gray-200 hover:border-indigo-400 transition-all">
            <div className="space-y-3">
              <h2 className="text-2xl font-bold whitespace-nowrap">
                Oops! Now dashboard found 🎃.
              </h2>
              <p className="pr-3 leading-7">
                This project have no overview dashboad. Click the button below
                to create a default dashboard
              </p>
              <Button
                title="Create dashboard"
                primary
                onClick={onCreateDashboard}
              />{' '}
            </div>
            <Image
              src={'/business-report.png'}
              alt="report "
              width={250}
              height={250}
              quality={100}
            />
          </div>
        ) : null}

      </div>
      <main className="mt-3">
        {dboardId ?
          <DboardComponentList />
          : null}
      </main>
    </div>
  )
}
