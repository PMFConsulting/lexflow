"use client"

import { Toaster as Sonner, type ToasterProps } from "sonner"
import { CircleCheckIcon, InfoIcon, TriangleAlertIcon, OctagonXIcon, Loader2Icon } from "lucide-react"

/**
 * Claro, sempre.
 *
 * Isto vinha do preset com `theme` a sair do `next-themes` e a cair em
 * `"system"` — e o `system` do sonner lê o `prefers-color-scheme` do sistema
 * operativo por sua conta. Era o único sítio da plataforma onde o modo escuro
 * chegava mesmo ao ecrã: a aplicação nunca põe a classe `.dark` em lado nenhum,
 * mas os avisos saíam escuros a quem tivesse o Windows em escuro, por cima de
 * uma interface toda em papel claro.
 */
const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      theme="light"
      className="toaster group"
      icons={{
        success: (
          <CircleCheckIcon className="size-4" />
        ),
        info: (
          <InfoIcon className="size-4" />
        ),
        warning: (
          <TriangleAlertIcon className="size-4" />
        ),
        error: (
          <OctagonXIcon className="size-4" />
        ),
        loading: (
          <Loader2Icon className="size-4 animate-spin" />
        ),
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius)",
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast: "cn-toast",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
