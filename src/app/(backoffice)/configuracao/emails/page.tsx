import Link from "next/link";
import { ArrowLeft, Mail } from "lucide-react";
import { exigirSocietyAdmin } from "@/lib/sessao";
import { sociedadeDe } from "@/features/administracao/consultas";
import { consultarModelosEmail } from "@/features/emails/consultas";
import { EditorModelosEmail } from "@/features/emails/componentes/EditorModelosEmail";
import { PreferenciaNotificacaoEmail } from "@/features/notificacoes/componentes/PreferenciaNotificacaoEmail";
import { urlLogotipoSociedade } from "@/lib/emails/moldura";

export const metadata = { title: "Modelos de Email — Configuração" };
export const dynamic = "force-dynamic";

export default async function PaginaModelosEmail() {
  const { eu } = await exigirSocietyAdmin();

  const [org, modelos] = await Promise.all([
    sociedadeDe(eu.organizacaoId),
    consultarModelosEmail(eu.organizacaoId),
  ]);

  const logotipoUrl = urlLogotipoSociedade(org);

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <div>
        <Link
          href="/gestao"
          className="text-tinta-suave hover:text-foreground inline-flex items-center gap-1.5 text-xs transition-colors"
        >
          <ArrowLeft className="size-3.5" />
          Voltar à Administração
        </Link>
        <div className="mt-2 flex items-center gap-3">
          <div className="border-linha bg-papel-alto flex size-10 items-center justify-center rounded-sm border">
            <Mail className="text-tinta-suave size-5" />
          </div>
          <div>
            <h1 className="text-2xl">Textos e Modelos de Email</h1>
            <p className="text-sm text-muted-foreground">
              Personalize o assunto e o corpo das mensagens de email enviadas aos seus clientes.
            </p>
          </div>
        </div>
      </div>

      <PreferenciaNotificacaoEmail ativadoInicial={org?.notificarSubmissoesEmail ?? false} />

      <EditorModelosEmail modelosIniciais={modelos} logotipoUrl={logotipoUrl} />
    </div>
  );
}
