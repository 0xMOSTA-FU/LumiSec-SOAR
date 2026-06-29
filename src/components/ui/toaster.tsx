"use client"

import { useToast } from "@/hooks/use-toast"
import {
  Toast,
  ToastClose,
  ToastDescription,
  ToastProvider,
  ToastTitle,
  ToastViewport,
} from "@/components/ui/toast"
import { CheckCircle2, AlertOctagon } from "lucide-react"

/**
 * Professional status icons rendered automatically on every toast.
 * Replaces ad-hoc emoji characters in toast titles with consistent
 * lucide-react icons across the entire application.
 */
function ToastStatusIcon({ variant }: { variant?: "default" | "destructive" }) {
  if (variant === "destructive") {
    return (
      <AlertOctagon className="h-5 w-5 shrink-0 text-destructive-foreground" aria-hidden />
    )
  }
  return (
    <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-500" aria-hidden />
  )
}

export function Toaster() {
  const { toasts } = useToast()

  return (
    <ToastProvider>
      {toasts.map(function ({ id, title, description, action, ...props }) {
        return (
          <Toast key={id} {...props}>
            <div className="flex items-start gap-3 w-full">
              <ToastStatusIcon variant={props.variant ?? undefined} />
              <div className="grid gap-1 flex-1 min-w-0">
                {title && <ToastTitle>{title}</ToastTitle>}
                {description && (
                  <ToastDescription>{description}</ToastDescription>
                )}
              </div>
              {action}
            </div>
            <ToastClose />
          </Toast>
        )
      })}
      <ToastViewport />
    </ToastProvider>
  )
}
