/**
 * Arranque do processo servidor — o sítio onde o Resumo Diário passa a ter
 * quem o dispare.
 *
 * O agendamento vive **dentro do processo** e não num cron externo, pela mesma
 * razão da D51: o contentor do Coolify é de vida longa (não é uma função
 * serverless que morre com a resposta), a alternativa custava configuração fora
 * do repositório — um cron no servidor, que ninguém vê num `git log` e que se
 * perde na migração seguinte de máquina —, e o que aqui se agenda usa
 * exatamente o mesmo caminho de envio que todo o resto (`enviarEmail`), com a
 * linha em `email_log` que isso garante (D34).
 *
 * O que isto não é: um agendador distribuído. Com mais de uma instância da
 * aplicação a correr, o resumo sai uma vez por instância — a fila é marcada
 * como processada logo a seguir ao primeiro envio aceite, por isso a segunda
 * encontra-a vazia e não repete o conteúdo, mas pode sair um email quase vazio.
 * Para a POC, que corre num contentor só, chega. O `scripts/resumo_diario.mjs`
 * continua a ser a via manual e é o caminho a usar se um dia isto passar a
 * várias instâncias.
 */

/** A hora local a que o resumo sai. */
const HORA_DO_RESUMO = 9;

const UM_DIA_MS = 24 * 60 * 60_000;

/** Milissegundos até ao próximo {@link HORA_DO_RESUMO}:00 local. */
function ateAoProximoResumo(agora = new Date()): number {
  const proximo = new Date(agora);
  proximo.setHours(HORA_DO_RESUMO, 0, 0, 0);
  if (proximo.getTime() <= agora.getTime()) {
    proximo.setDate(proximo.getDate() + 1);
  }
  return proximo.getTime() - agora.getTime();
}

export async function register(): Promise<void> {
  // O `instrumentation` também corre no runtime `edge`, onde não há `db()` nem
  // temporizadores de longa duração.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  // Importação dinâmica e não estática: este ficheiro é carregado pelos dois
  // runtimes, e um `import` no topo puxava `server-only` e o driver de Postgres
  // para o bundle do edge.
  const { executarResumoDiario } = await import("@/features/notificacoes/resumo-diario");

  const agendar = () => {
    const espera = ateAoProximoResumo();
    console.info(
      `[resumo-diario] próximo resumo daqui a ${Math.round(espera / 60_000)} minuto(s) ` +
        `(${HORA_DO_RESUMO}:00 local).`,
    );

    const temporizador = setTimeout(() => {
      // Sem `await`: o `register` já devolveu há muito, e uma rejeição aqui
      // não pode matar o reagendamento — `executarResumoDiario` não lança, e
      // o `catch` é a rede por baixo disso.
      void executarResumoDiario()
        .catch((e) => console.error("[resumo-diario] o resumo rebentou:", e))
        .finally(agendar);
    }, espera) as unknown as { unref?: () => void };

    // `unref` para o temporizador não segurar o processo: um `docker stop` não
    // pode ficar à espera de uma espera de vinte horas.
    temporizador.unref?.();
  };

  agendar();
}

/**
 * Um reinício antes da hora não perde nada: as linhas da fila só são marcadas
 * como processadas depois de um envio aceite, por isso o que ficou por avisar
 * entra no resumo do dia seguinte. Deliberadamente **não** há uma passagem de
 * recuperação ao arranque — com uma, cada deploy da tarde mandava mais um
 * email, e o que se prometeu ao dono foi um por dia.
 */
