import { useParams, useRouter, useSearchParams } from "next/navigation";
import HasRole from "../UserPermission/HasRole";
import { HiOutlineCog6Tooth, HiOutlineShare } from "react-icons/hi2";

export default function ProjectAdvanceTabs() {
  const searchParams = useSearchParams()
  const { push } = useRouter()
  const params = useParams()
  const mode = searchParams.get('mode')

  const onMoveTab = (name: string) => {
    push(`${params.orgName}/project/${params.projectId}?mode=${name}`)
  }

  return <div className="project-advance-tabs flex items-center gap-2">
    <div className="tab flex items-center gap-1">
      <HasRole projectRoles={['MANAGER', 'LEADER', 'MEMBER']}>
        <div
          className={`tab-item ${mode === 'mindmap' ? 'active' : ''}`}
          onClick={() => onMoveTab('mindmap')}>
          <HiOutlineShare />
          <span>Mind Map</span>
        </div>
        <div
          className={`tab-item ${mode === 'setting' ? 'active' : ''}`}
          onClick={() => onMoveTab('setting')}>
          <HiOutlineCog6Tooth />
          <span>Settings</span>
        </div>
      </HasRole>
    </div>
  </div>
}
