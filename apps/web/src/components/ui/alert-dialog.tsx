import * as AlertDialogPrimitive from '@radix-ui/react-alert-dialog'
import type { ComponentProps } from 'react'

export const AlertDialog = AlertDialogPrimitive.Root
export const AlertDialogTrigger = AlertDialogPrimitive.Trigger
export const AlertDialogAction = AlertDialogPrimitive.Action
export const AlertDialogCancel = AlertDialogPrimitive.Cancel

export function AlertDialogContent({
  className = '',
  children,
  ...props
}: ComponentProps<typeof AlertDialogPrimitive.Content>) {
  return (
    <AlertDialogPrimitive.Portal>
      <AlertDialogPrimitive.Overlay className="alert-dialog-overlay" />
      <AlertDialogPrimitive.Content className={`alert-dialog-content ${className}`} {...props}>
        {children}
      </AlertDialogPrimitive.Content>
    </AlertDialogPrimitive.Portal>
  )
}

export function AlertDialogHeader(props: ComponentProps<'div'>) {
  return <div className="alert-dialog-header" {...props} />
}

export function AlertDialogFooter(props: ComponentProps<'div'>) {
  return <div className="alert-dialog-footer" {...props} />
}

export function AlertDialogTitle(props: ComponentProps<typeof AlertDialogPrimitive.Title>) {
  return <AlertDialogPrimitive.Title className="alert-dialog-title" {...props} />
}

export function AlertDialogDescription(
  props: ComponentProps<typeof AlertDialogPrimitive.Description>,
) {
  return <AlertDialogPrimitive.Description className="alert-dialog-description" {...props} />
}
