import { z } from "zod";
import { email, morada, obrigatorio, telefone, website } from "@/lib/campos";

/**
 * O que o portal de administração da sociedade aceita.
 *
 * Revalidado no servidor, sempre — a validação do lado do cliente é conforto
 * (regra do projeto).
 */

/**
 * Os «dados mãe» da sociedade: identidade, e por isso fora do alcance de quem
 * a administra.
 *
 * `nome`, `nif` e `prefixoReferencia` não são campos como os outros. O nome e
 * o NIPC são o que a certidão permanente confirma — alterá-los sem reconfirmar
 * o documento deixa a plataforma a afirmar uma entidade que nenhum papel
 * sustenta. E o prefixo entra em referências já emitidas (`PMF-2026-0142`),
 * que estão em emails enviados e PDFs arquivados: mudá-lo parte a
 * correspondência entre o que a sociedade tem em papel e o que aqui se lê —
 * é a razão do aviso na `EditarSociedade` do super_admin, que é o único sítio
 * onde os três se mudam (`atualizarSociedade`).
 */
export const CAMPOS_MAE = ["nome", "nif", "prefixoReferencia"] as const;

export const MENSAGEM_CAMPOS_MAE =
  "O nome, o NIPC e o prefixo das referências identificam a sociedade e não se alteram por " +
  "aqui — uma alteração a qualquer deles obriga a reconfirmar a certidão e não reescreve as " +
  "referências já emitidas. Fale com a administração da plataforma.";

/**
 * Os dados não-mãe da sociedade, editáveis por quem a administra.
 *
 * As regras são exatamente as do registo da sociedade (`passoSociedade1` e
 * `passoSociedade2`), porque são as mesmas colunas: uma sociedade não pode ter
 * uma morada que o registo recusaria e a edição aceita. O que falta aqui em
 * relação a esses passos é o que não é editável — os três campos mãe acima,
 * mais o remetente e o domínio de email, que são configuração de canal e
 * vivem no portal da plataforma.
 *
 * Todos obrigatórios, tal como no registo: uma sociedade criada de raiz pelo
 * super_admin nasce com estas colunas a `null`, e é este formulário que as
 * completa — deixá-las opcionais era garantir que ficavam meias.
 */
export const dadosSociedadeSchema = z.object({
  naturezaJuridica: obrigatorio("A forma jurídica"),
  numeroOrdem: obrigatorio("O número de inscrição na Ordem dos Advogados"),
  emailGeral: email,
  telefone,
  website,
  ...morada,
});

export type DadosSociedadeEditaveis = z.infer<typeof dadosSociedadeSchema>;
