import { ReactNode } from 'react'

export default function ListCell({
  width,
  align,
  className,
  children
}: {
  width?: number
  align?: 'center' | 'left' | 'right'
  className?: string
  children: ReactNode
}) {
  const classes: string[] = ['list-cell shrink-0']
  align && classes.push(`text-${align}`)
  className && classes.push(className)
  return (
    <div
      className={classes.join(' ')}
      style={width ? { width: `${width}px` } : undefined}>
      {children}
    </div>
  )
}

