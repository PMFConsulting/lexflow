import Link from "next/link";
import { Building2, Mail, ScrollText, ShieldCheck, Users } from "lucide-react";
import { exigirAdministracao } from "@/lib/sessao";
import {
  resumoEquipa,
  sociedadeDe,
} from "@/features/administracao/consultas";

export const metadata = { title: "Administração" };
export const dynamic = "force-dynamic";

const CARTOES = [
  {
    href: "/gestao/configuracoes",
    titulo: "Configurações da sociedade",
    icone: Building2,
    descricao:
      "Dados da sociedade, logótipo, modelos de email, Termos e Condições e conformidade. Agrupa tudo o que é configurável na sociedade.",
  },
  {
    href: "/gestao/utilizadores",
    titulo: "Utilizadores e convites",
    icone: Users,
    descricao:
      "Quem tem acesso, com que perfil, e os convites por aceitar. É por aqui que entra alguém de novo.",
  },
];

export default async function Administracao() {
  const { eu } = await exigirAdministracao();
  const [org, resumo] = await Promise.all([
    sociedadeDe(eu.organizacaoId),
    resumoEquipa(eu.organizacaoId),
  ]);

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <div>
        <h1 className="text-2xl">Administração</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          A conta da {org?.nome ?? "sociedade"} nesta plataforma: quem lá entra, com que perfil, e
          os Termos e Condições que vinculam os vossos clientes.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Numero rotulo="Pessoas com acesso" valor={resumo.ativos} />
        <Numero rotulo="Convites por aceitar" valor={resumo.convitesPendentes} />
        <Numero
          rotulo="Versão dos T&C"
          valor={org?.termosVersao ?? "—"}
          aviso={!org?.termosVersao}
        />
      </div>

      {/* O aviso mais importante desta página, e por isso não está num rodapé:
          sem Termos e Condições da sociedade, o passo 7 do cliente está a servir o texto
          genérico da plataforma — ou seja, a sociedade está a fazer os seus
          clientes aceitarem um contrato que não escreveu. */}
      {!org?.termosVersao && (
        <div className="border-latao/40 bg-latao/5 rounded-sm border p-4">
          <p className="text-sm font-medium">Ainda não há Termos e Condições da sociedade.</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Enquanto não houver, os vossos clientes aceitam o texto genérico da plataforma — que é
            texto de demonstração e não o contrato da sociedade.{" "}
            <Link href="/gestao/configuracoes" className="underline underline-offset-2">
              Publicar Termos e Condições
            </Link>
            .
          </p>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        {CARTOES.map((c) => (
          <Link
            key={c.href}
            href={c.href}
            className="border-linha bg-papel-alto hover:border-tinta-suave flex flex-col gap-2 rounded-sm border p-4 transition-colors"
          >
            <div className="flex items-center gap-2">
              <c.icone className="text-tinta-suave size-4" />
              <h2 className="text-lg">{c.titulo}</h2>
            </div>
            <p className="text-sm text-muted-foreground">{c.descricao}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}

function Numero({
  rotulo,
  valor,
  aviso = false,
}: {
  rotulo: string;
  valor: string | number;
  aviso?: boolean;
}) {
  return (
    <div className="border-linha bg-papel-alto rounded-sm border p-4">
      <p className="text-2xs font-mono tracking-[0.14em] text-muted-foreground uppercase">
        {rotulo}
      </p>
      <p className={`mt-1 font-mono text-xl ${aviso ? "text-latao" : ""}`}>{valor}</p>
    </div>
  );
}
