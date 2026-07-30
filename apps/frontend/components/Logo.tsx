import Image from 'next/image'

export default function Logo() {
  return (
    <h2 className="logo w-14 h-14 inline-flex items-center justify-center">
      <img src="/logo71x71.png" className="w-[50px] h-[50px] object-contain" alt="Technewity Labs" />
    </h2>
  )
}

