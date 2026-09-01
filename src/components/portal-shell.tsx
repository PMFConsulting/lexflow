import Link from "next/link";
import type { LucideIcon } from "lucide-react";
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
import { BotaoSair } from "@/features/conta/componentes/BotaoSair";
import { SeletorSociedade } from "@/features/conta/componentes/SeletorSociedade";
import { Logotipo } from "@/components/logotipo";
import { SinoNotificacoes } from "@/features/notificacoes/componentes/SinoNotificacoes";

/**
 * A moldura dos três portais.
 *
 * Desde que há três papéis há três barras laterais, e a alternativa a esta
 * moldura era o mesmo ficheiro copiado três vezes — com o defeito conhecido de
 * quem copia layouts: a terceira cópia deixa de acompanhar as outras duas, e
 * ninguém dá por isso porque cada papel só vê a sua.
 *
 * O que muda entre portais é o que vem por parâmetro: as entradas, a legenda do
 * grupo e a etiqueta do cabeçalho. **O guard não vem daqui** — cada layout
 * chama o seu antes de montar isto, porque é ele que sabe quem entra.
 */

export type EntradaDeMenu = {
  titulo: string;
  href: string;
  icone: LucideIcon;
};

export function PortalShell({
  gruposDeMenu,
  cabecalho,
  legendaDaMarca,
  utilizador,
  logotipoUrl,
  contagemNotificacoes,
  hrefNotificacoes,
  sociedadeAtiva,
  outrasSociedades,
  children,
}: {
  gruposDeMenu: { label: string; entradas: EntradaDeMenu[] }[];
  cabecalho: string;
  legendaDaMarca: string;
  utilizador: { nome: string; papel: string };
  logotipoUrl?: string | null;
  contagemNotificacoes?: number;
  hrefNotificacoes?: string;
  /** A sociedade desta sessão e as outras da mesma conta (BUG3-002). */
  sociedadeAtiva?: { id: string; nome: string };
  outrasSociedades?: { id: string; nome: string }[];
  children: React.ReactNode;
}) {
  // O seletor só aparece com 2+ sociedades — com uma só não há escolha
  // nenhuma a fazer, e mostrá-lo sempre seria uma pergunta sem resposta
  // possível para a generalidade das contas.
  const opcoesSociedade =
    sociedadeAtiva && outrasSociedades?.length ? [sociedadeAtiva, ...outrasSociedades] : null;
  return (
    <TooltipProvider delayDuration={300}>
      <SidebarProvider>
        <Sidebar collapsible="icon">
          <SidebarHeader className="px-3 py-4 group-data-[collapsible=icon]:px-1.5">
            {/* A lombada do dossier, com a marca da sociedade. É SVG com fundo
                próprio (verde-arquivo), por isso assenta direto na tinta sólida
                da barra sem precisar de uma caixa clara por trás.

                `group-data-[collapsible=icon]` é o estado recolhido: aí só cabe
                a marca, e a legenda sairia por cima do ícone seguinte. O
                `shrink-0` impede a alternativa — encolher só a largura e
                entregar o logo esticado. */}
            <Link href={gruposDeMenu[0]?.entradas[0]?.href ?? "/"} className="flex min-w-0 items-center gap-2.5">
              {logotipoUrl ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={logotipoUrl}
                  alt={legendaDaMarca}
                  className="h-8 max-w-[140px] w-auto shrink-0 object-contain group-data-[collapsible=icon]:hidden"
                />
              ) : (
                <Logotipo sobreEscuro className="h-8 w-auto shrink-0 group-data-[collapsible=icon]:hidden" />
              )}
              <span className="font-mono text-2xs truncate tracking-[0.16em] uppercase opacity-60 group-data-[collapsible=icon]:hidden">
                {legendaDaMarca}
              </span>
            </Link>
          </SidebarHeader>

          <SidebarContent>
            {gruposDeMenu.map((grupo) => (
              <SidebarGroup key={grupo.label}>
                <SidebarGroupLabel>{grupo.label}</SidebarGroupLabel>
                <SidebarGroupContent>
                  <SidebarMenu>
                    {grupo.entradas.map((item) => (
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
            ))}
          </SidebarContent>

          <SidebarFooter className="gap-2 px-3 py-3">
            <div className="min-w-0">
              <p className="truncate text-xs font-medium">{utilizador.nome}</p>
              <p className="text-2xs truncate font-mono tracking-wider uppercase opacity-60">
                {utilizador.papel}
              </p>
            </div>
            {opcoesSociedade && sociedadeAtiva && (
              <SeletorSociedade atual={sociedadeAtiva.id} opcoes={opcoesSociedade} />
            )}
            <BotaoSair />
            <span className="text-2xs font-mono opacity-40">LexFlow · v1.0.0</span>
          </SidebarFooter>
        </Sidebar>

        <SidebarInset>
          <header className="flex h-12 shrink-0 items-center justify-between border-b border-linha bg-papel-alto px-4">
            <div className="flex items-center gap-2">
              <SidebarTrigger className="-ml-1" />
              <Separator orientation="vertical" className="mr-1 h-4" />
              <span className="font-mono text-xs tracking-wider text-muted-foreground uppercase">
                {cabecalho}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <SinoNotificacoes
                href={hrefNotificacoes ?? "/notificacoes"}
                contagemNaoLidas={contagemNotificacoes ?? 0}
              />
            </div>
          </header>
          <main className="flex-1 p-4 md:p-6">{children}</main>
        </SidebarInset>
      </SidebarProvider>
    </TooltipProvider>
  );
}

/**
 * O papel como se escreve para uma pessoa.
 *
 * A barra lateral mostrava `eu.papel` em cru, que com `admin`/`socio` ainda se
 * lia. Com `society_admin` deixou de se ler — um sublinhado no meio de uma
 * palavra é um identificador de base de dados a aparecer numa interface, e a
 * regra do projeto é que o que o utilizador vê está em português.
 */
export const ROTULO_DO_PAPEL: Record<string, string> = {
  super_admin: "Administração da plataforma",
  society_admin: "Administração da sociedade",
  gestor: "Gestor",
  utilizador: "Utilizador",
};

/** Same lookup as `ROTULO_DO_PAPEL[papel]`, with the raw value as a fallback for a papel not in the map. */
export function rotuloDoPapel(papel: string): string {
  return ROTULO_DO_PAPEL[papel] ?? papel;
}
