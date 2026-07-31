import { cn } from "@/lib/utils";

/**
 * Referência de processo. Sempre em mono — qualquer identificador é mono, e
 * isso é regra e não sugestão (§3 do brief).
 *
 * O mesmo componente serve NIF, IBAN, hashes e timestamps de auditoria.
 */
export function Ref({
  children,
  className,
  titulo,
}: {
  children: React.ReactNode;
  className?: string;
  titulo?: string;
}) {
  return (
    <span
      data-ref
      title={titulo}
      className={cn(
        "font-mono text-[0.95em] tracking-tight tabular-nums",
        className,
      )}
    >
      {children}
    </span>
  );
}
