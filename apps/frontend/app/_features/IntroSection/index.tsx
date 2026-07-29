import { Button } from "@ui-components";
import Link from "next/link";
import { HiOutlineRocketLaunch } from "react-icons/hi2";
import { FaGithub } from "react-icons/fa";
import './index.css'

export default function IntroSection() {

  return <div className="intro-section overflow-hidden pt-14 w-full shrink-0 dark:bg-gray-900 px-32 flex flex-col">

    <h2 className='mt-[95px] text-[42px] font-extrabold leading-tight text-white sign-text-shadow'>Technewity Labs <br />Enterprise Workspace</h2>

    <p className="text-[19px] mt-6 text-[#CCE1FB] sign-text-shadow">Streamline team collaboration, project management, and <br />automated workflows for your organization.</p>

    <img src="/sign-background-cover1.png" className="w-[1100px] mt-7 -ml-[60px]" style={{ maxWidth: 'initial' }} />

    <div className="flex items-center gap-2">
      <Link href={'https://technewity.com'} target="_blank">
        <Button ghost leadingIcon={<HiOutlineRocketLaunch />} size="md" title="Visit Technewity" />
      </Link>
    </div>

    <div>

    </div>
  </div>
}
