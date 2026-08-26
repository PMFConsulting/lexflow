/**
 * O erro de um campo, debaixo da caixa que o causou.
 *
 * Vive ao nível do módulo e não dentro de cada formulário, e não é arrumação:
 * um componente **definido durante o render** é um tipo novo em cada passagem,
 * e o React desmonta e remonta o que ele produz em vez de o atualizar. Numa
 * mensagem de erro isso custa o que mais interessa aqui — o `role="alert"`
 * volta a disparar a cada tecla, e um leitor de ecrã lê o mesmo erro outra vez
 * a meio de quem está a corrigi-lo.
 *
 * Um erro por campo, o primeiro (ver `erros()` em `../schemas.ts`): dois
 * debaixo da mesma caixa fazem ler o segundo e corrigir o primeiro.
 */
export function Erro({ erros, campo }: { erros: Record<string, string>; campo: string }) {
  const mensagem = erros[campo];
  if (!mensagem) return null;

  return (
    <p className="text-selo text-xs" role="alert">
      {mensagem}
    </p>
  );
}

/** O erro que não é de campo nenhum — o do formulário todo. */
export function ErroGeral({ erros }: { erros: Record<string, string> }) {
  if (!erros._) return null;

  return (
    <p className="border-selo/40 bg-selo/10 text-selo rounded-sm border p-2.5 text-sm" role="alert">
      {erros._}
    </p>
  );
}
