import Link from "next/link";
import {
  FileText,
  LayoutDashboard,
  Settings,
  ShieldAlert,
  Users,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import { TooltipProvider } from "@/components/ui/tooltip";
import { exigirSessao } from "@/lib/sessao";
import { BotaoSair } from "@/features/conta/componentes/BotaoSair";

const NAVEGACAO = [
  { titulo: "Painel", href: "/", icone: LayoutDashboard },
  { titulo: "Processos", href: "/processos", icone: FileText },
  {
    titulo: "Risco elevado",
    href: "/processos?risco=elevado",
    icone: ShieldAlert,
  },
];

const ADMINISTRACAO = [
  { titulo: "Utilizadores", href: "/definicoes/utilizadores", icone: Users },
  { titulo: "Definições", href: "/definicoes", icone: Settings },
];

/**
 * Nada aqui é pré-renderizável: cada página depende da sessão de quem a abre.
 * Sem isto, o `next build` tentava gerar o painel em estático e batia na
 * leitura das variáveis de ambiente.
 */
export const dynamic = "force-dynamic";

export default async function LayoutBackoffice({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // Guard num sítio só: todas as páginas do back-office passam por aqui, e é
  // o que impede que uma página nova nasça aberta por esquecimento.
  const { eu } = await exigirSessao();

  return (
    <TooltipProvider delayDuration={300}>
      <SidebarProvider>
        <Sidebar collapsible="icon">
          <SidebarHeader className="px-3 py-4">
            {/* A lombada do dossier: tinta sólida, marca em display. */}
            <Link href="/" className="flex flex-col gap-0.5">
              <span className="font-display text-lg leading-none">
                PMF Consulting
              </span>
              <span className="font-mono text-2xs tracking-[0.16em] uppercase opacity-60">
                Processos
              </span>
            </Link>
          </SidebarHeader>

          <SidebarContent>
            <SidebarGroup>
              <SidebarGroupLabel>Onboarding</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {NAVEGACAO.map((item) => (
                    <SidebarMenuItem key={item.href}>
                      <SidebarMenuButton asChild tooltip={item.titulo}>
                        <Link href={item.href}>
                          <item.icone />
                          <span>{item.titulo}</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>

            <SidebarGroup>
              <SidebarGroupLabel>Administração</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {ADMINISTRACAO.map((item) => (
                    <SidebarMenuItem key={item.href}>
                      <SidebarMenuButton asChild tooltip={item.titulo}>
                        <Link href={item.href}>
                          <item.icone />
                          <span>{item.titulo}</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          </SidebarContent>

          <SidebarFooter className="gap-2 px-3 py-3">
            <div className="min-w-0">
              <p className="truncate text-xs font-medium">{eu.nome}</p>
              <p className="text-2xs truncate font-mono tracking-wider uppercase opacity-60">
                {eu.papel}
              </p>
            </div>
            <BotaoSair />
            <span className="text-2xs font-mono opacity-40">POC · v0.1.0</span>
          </SidebarFooter>
        </Sidebar>

        <SidebarInset>
          <header className="flex h-12 shrink-0 items-center gap-2 border-b border-linha bg-papel-alto px-4">
            <SidebarTrigger className="-ml-1" />
            <Separator orientation="vertical" className="mr-1 h-4" />
            <span className="font-mono text-xs tracking-wider text-muted-foreground uppercase">
              Onboarding de clientes
            </span>
          </header>
          <main className="flex-1 p-4 md:p-6">{children}</main>
        </SidebarInset>
      </SidebarProvider>
    </TooltipProvider>
  );
}
