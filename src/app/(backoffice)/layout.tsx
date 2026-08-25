import Link from "next/link";
import {
  Building2,
  FileText,
  LayoutDashboard,
  Mail,
  Settings,
  UserRound,
  Users,
  type LucideIcon,
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
import { exigirSessao, podeAdministrar, podeVerEmails } from "@/lib/sessao";
import { BotaoSair } from "@/features/conta/componentes/BotaoSair";
import { Logotipo } from "@/components/logotipo";

type Entrada = {
  titulo: string;
  href: string;
  icone: LucideIcon;
  /** Entradas sem isto são para toda a equipa. */
  soAdmin?: boolean;
};

/** O trabalho do dia: os dossiers dos clientes. */
const NAVEGACAO: Entrada[] = [
  { titulo: "Painel", href: "/", icone: LayoutDashboard },
  { titulo: "Processos", href: "/processos", icone: FileText },
  { titulo: "Clientes", href: "/clientes", icone: Users },
  // Só administração — a página tem o seu próprio guard (`exigirAdmin`), e
  // esconder a entrada aqui é cortesia, não segurança.
  { titulo: "Emails", href: "/emails", icone: Mail, soAdmin: true },
  { titulo: "Configuração", href: "/configuracao", icone: Settings },
];

/**
 * A sociedade e a pessoa — um grupo à parte, e não mais entradas na lista de
 * cima.
 *
 * São coisas de natureza diferente: acima está o trabalho sobre clientes,
 * aqui está quem trabalha. Misturá-las dava uma barra lateral em que
 * «Utilizadores» aparecia a seguir a «Clientes», e essas duas palavras já são
 * difíceis de distinguir sem as pôr lado a lado.
 *
 * «A minha conta» não tem `soAdmin`: é o portal de cada pessoa da equipa, e é
 * onde um advogado sem funções de administração vai buscar o que lhe diz
 * respeito.
 */
const NAVEGACAO_SOCIEDADE: Entrada[] = [
  { titulo: "A minha conta", href: "/advogado", icone: UserRound },
  { titulo: "Administração", href: "/admin", icone: Building2, soAdmin: true },
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
          <SidebarHeader className="px-3 py-4 group-data-[collapsible=icon]:px-1.5">
            {/* A lombada do dossier, agora com a marca da sociedade — o mesmo
                emblema do onboarding, da entrada e dos T&C. É SVG com fundo
                próprio (verde-arquivo), por isso assenta direto na tinta
                sólida da barra sem precisar de uma caixa clara por trás.

                `group-data-[collapsible=icon]` é o estado recolhido da barra:
                aí só cabe a marca, e a linha de baixo sairia por cima do
                ícone seguinte. O `shrink-0` é o que impede a alternativa a
                encolher — encolher só a largura e entregar o logo esticado. */}
            <Link href="/" className="flex min-w-0 items-center gap-2.5">
              <Logotipo className="h-8 w-auto shrink-0 group-data-[collapsible=icon]:h-6" />
              <span className="font-mono text-2xs truncate tracking-[0.16em] uppercase opacity-60 group-data-[collapsible=icon]:hidden">
                Processos
              </span>
            </Link>
          </SidebarHeader>

          <SidebarContent>
            <SidebarGroup>
              <SidebarGroupLabel>Onboarding</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {NAVEGACAO.filter(
                    (item) => !item.soAdmin || podeVerEmails(eu.papel),
                  ).map((item) => (
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
              <SidebarGroupLabel>Sociedade</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {NAVEGACAO_SOCIEDADE.filter(
                    (item) => !item.soAdmin || podeAdministrar(eu.papel),
                  ).map((item) => (
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
