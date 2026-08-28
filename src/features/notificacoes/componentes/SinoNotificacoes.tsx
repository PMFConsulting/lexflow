"use client";

import Link from "next/link";
import { Bell } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export function SinoNotificacoes({
  href = "/notificacoes",
  contagemNaoLidas = 0,
}: {
  href?: string;
  contagemNaoLidas?: number;
}) {
  const temNaoLidas = contagemNaoLidas > 0;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Link
          href={href}
          aria-label={
            temNaoLidas
              ? `Notificações (${contagemNaoLidas} não lida${contagemNaoLidas > 1 ? "s" : ""})`
              : "Notificações"
          }
          className="hover:bg-papel text-tinta relative flex size-8 items-center justify-center rounded-sm transition-colors"
        >
          <Bell className="size-4.5" />
          {temNaoLidas && (
            <span className="bg-selo absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full px-1 font-mono text-[10px] font-bold text-white shadow-xs">
              {contagemNaoLidas > 99 ? "99+" : contagemNaoLidas}
            </span>
          )}
        </Link>
      </TooltipTrigger>
      <TooltipContent side="bottom" align="end">
        {temNaoLidas
          ? `${contagemNaoLidas} notificaç${contagemNaoLidas > 1 ? "ões" : "ão"} por ler`
          : "Sem novas notificações"}
      </TooltipContent>
    </Tooltip>
  );
}
