import { MouseEvent, ReactNode, useEffect, useState } from "react";
import DialogClose from "./DialogClose";
import { useDialogContext } from "./context";

export default function DialogContent({
  size = 'base',
  className,
  position = 'center',
  children
}: {
  className?: string
  children?: ReactNode
  size?: 'sm' | 'base' | 'lg' | 'xl'
  position?: 'center' | 'right'
}) {
  const { open, onOpenChange } = useDialogContext()
  const [viewportHeight, setViewportHeight] = useState<number | null>(null)

  const visible = open ? 'show' : ''
  const classes = [className]
  size && classes.push(`size-${size}`)
  open && classes.push('show')

  useEffect(() => {
    if (!open || typeof window === 'undefined' || !window.visualViewport) return

    const handleVisualViewportResize = () => {
      if (window.visualViewport) {
        setViewportHeight(window.visualViewport.height)
      }
    }

    window.visualViewport.addEventListener('resize', handleVisualViewportResize)
    window.visualViewport.addEventListener('scroll', handleVisualViewportResize)
    handleVisualViewportResize()

    return () => {
      if (window.visualViewport) {
        window.visualViewport.removeEventListener('resize', handleVisualViewportResize)
        window.visualViewport.removeEventListener('scroll', handleVisualViewportResize)
      }
      setViewportHeight(null)
    }
  }, [open])

  const clickOutSide = () => {
    onOpenChange(false)
  }

  const stopPropagation = (ev: MouseEvent<HTMLDivElement>) => {
    ev.stopPropagation()
  }

  return (
    <div
      className={`dialog-wrapper ${open ? "" : 'pointer-events-none -z-10'}`}
      style={{
        ...(open ? {} : { overflowY: 'hidden' }),
        ...(viewportHeight ? { height: `${viewportHeight}px` } : {})
      }}
      onClick={clickOutSide}>
      <div className={`dialog-backdrop ${visible}`}></div>
      <div className={`${open ? 'overflow-y-auto' : ''} h-full z-10 relative`}>
        <div className={`dialog-wrapper-content ${position} h-full`}>
          <div onClick={stopPropagation} className={`dialog-content ${classes.join(' ')}`}>
            <DialogClose />
            {children}
          </div>
        </div>
      </div>
    </div>
  )
}
