import {
  ARQUIVO,
  botao,
  escapar,
  FONTE_MONO,
  LATAO,
  linkCopiavel,
  moldura,
  p,
  saudacao,
  TINTA,
  TINTA_SUAVE,
} from "./moldura";

/**
 * Os emails dos percursos internos: o convite à sociedade e o convite a cada
 * pessoa que se junta a ela.
 *
 * Ao contrário dos cinco de `jmassano.ts`, estes **não seguem nenhum documento
 * do cliente** — não existe um. São escritos aqui, com a mesma moldura, e é de
 * propósito que dizem pouco: um convite não é o sítio para explicar a
 * plataforma, é o sítio para dizer quem convidou, para quê, e o que acontece a
 * seguir. Quem tiver dúvidas tem o percurso à frente.
 *
 * O que os dois têm em comum e não é decorativo: **dizem quanto tempo o link
 * dura**. Um link de 30 dias que não o anuncia é um link que expira sem aviso,
 * e quem o recebe descobre-o quando já não o pode usar.
 */

const VALIDADE = "30 dias";

/** Uma linha de destaque — a sociedade que convida, o papel que se recebe. */
const destaque = (etiqueta: string, valor: string) => `
<p style="font-family:${FONTE_MONO};font-size:11px;letter-spacing:0.08em;
   text-transform:uppercase;color:${TINTA_SUAVE};margin:0 0 6px;">
  ${escapar(etiqueta)}
  <span style="color:${TINTA};font-weight:500;">${escapar(valor)}</span>
</p>`;

/* --------------------------------------------- 1. convite à própria sociedade */

export const ASSUNTO_CONVITE_SOCIEDADE = "LexFlow | Registo da sociedade";

export function emailConviteSociedade({
  sociedade,
  link,
}: {
  sociedade: string;
  link: string;
}): string {
  const href = escapar(link);
  return moldura(
    `
    ${saudacao(null)}
    ${destaque("Sociedade ", sociedade)}
    ${p(
      "Foi aberto um registo para a vossa sociedade na plataforma de onboarding de clientes. " +
        "Para o concluir, é preciso preencher seis passos: a identificação da sociedade, a morada e " +
        "contactos, a certidão permanente, os Termos e Condições que os vossos clientes vão aceitar, " +
        "quem administra a conta, e uma declaração final.",
    )}
    ${botao(href, "Concluir o registo")}
    ${linkCopiavel(href)}
    ${p(
      "O preenchimento pode ser interrompido e retomado — o que ficar gravado num passo não se perde " +
        `ao fechar o separador. O link é válido durante ${VALIDADE}.`,
    )}
    ${p(
      "<strong>Sobre os Termos e Condições:</strong> o articulado que a plataforma apresenta hoje aos " +
        "clientes é um texto genérico. A partir do momento em que submeterem o vosso, é o vosso que " +
        "passa a ser apresentado — e cada advogado ou colaborador que se junte à sociedade terá de o " +
        "aceitar no próprio registo.",
    )}
    ${p("Ficamos ao dispor para qualquer esclarecimento.")}
  `,
    ARQUIVO,
  );
}

/* ------------------------------------------- 2. convite a uma pessoa da equipa */

export const ASSUNTO_CONVITE_UTILIZADOR = "LexFlow | Convite para criar a sua conta";

/**
 * Os papéis por extenso.
 *
 * Um mapa exaustivo e não um `Record<string, string>` com recuo: um papel novo
 * no enum parte a compilação aqui, que é onde falta a tradução, em vez de sair
 * `socio` em cru dentro de um email para uma pessoa.
 */
const PAPEIS: Record<"admin" | "socio" | "advogado" | "assistente", string> = {
  admin: "Administrador",
  socio: "Sócio",
  advogado: "Advogado",
  assistente: "Assistente",
};

export function emailConviteUtilizador({
  nome,
  sociedade,
  link,
  papel,
}: {
  nome?: string | null;
  sociedade: string;
  link: string;
  papel: keyof typeof PAPEIS;
}): string {
  const href = escapar(link);
  const eAdmin = papel === "admin";

  return moldura(
    `
    ${saudacao(nome)}
    ${destaque("Sociedade ", sociedade)}
    ${destaque("Perfil ", PAPEIS[papel])}
    ${p(
      eAdmin
        ? `Foi indicado como administrador da conta da ${escapar(sociedade)} na plataforma de ` +
            "onboarding de clientes. Para começar, é preciso concluir o seu registo — cinco passos: " +
            "os seus dados pessoais, os dados profissionais, os documentos, os Termos e Condições da " +
            "sociedade e a definição da palavra-passe."
        : `Foi convidado a juntar-se à ${escapar(sociedade)} na plataforma de onboarding de ` +
            "clientes. Para começar, é preciso concluir o seu registo — cinco passos: os seus dados " +
            "pessoais, os dados profissionais, os documentos, os Termos e Condições da sociedade e a " +
            "definição da palavra-passe.",
    )}
    ${botao(href, "Concluir o registo")}
    ${linkCopiavel(href)}
    ${p(
      "A palavra-passe é definida por si, no último passo, e a plataforma nunca a conhece — fica " +
        "guardada apenas o suficiente para a poder confirmar quando entrar.",
    )}
    ${p(
      `O link é pessoal e é válido durante ${VALIDADE}. Se não o reconhece, ignore esta mensagem: ` +
        "nenhuma conta é criada sem que o registo seja concluído.",
    )}
  `,
    LATAO,
  );
}
