# Hours Control Mechanism — final version (validated by Antigravity/Gemini 3.7 Flash High, 14/08/2026)

Document: `docs/PROPOSTA_COMPLETA.html` (section 08, "Mecanismo de Controlo de Horas — Fiável,
Automatizado e Sem Faturação Inflacionada")

## The 4 pillars (final version — replaces the old 4 barriers)

1. **Intelligent Active Measurement** — the timer counts exclusively ACTIVE interaction time
   (editing, drafting, analysis). It pauses automatically after 2 minutes of inactivity; it does
   not count waiting time or pending/forgotten tickets.
2. **Automatic Maximum Cap (Lesser Value Rule)** — the LESSER of the actual measured time and the
   tabulated cap for the tier is billed (L2 simple ~15 min · L2 medium ~30 min · L3 1–2 h).
   Overruns caused by technical inefficiency are NOT charged to the client.
3. **Algorithmic Deviation & Anomaly Detection** — the engine compares times against the
   historical baseline and flags statistical deviations (atypical clustering at the cap,
   productivity per operator).
4. **Telemetry Statement & Immutable Audit Trail** — each occurrence produces a statement with
   exact timestamps, operator and a non-editable cryptographic signature, viewable in the client
   portal.

## Guarantee (key sentence for the meeting — kept in Portuguese, it is spoken to the client)
"Nenhuma hora é imputada sem validação pela telemetria dos 4 pilares — o mesmo rigor aplica-se à
implementação (48 h de referência) e ao suporte contínuo. Relatório mensal consolidado de
eficiência com detalhe ao segundo por processo e operador."

## What it replaced

- The old mechanism was "4 barriers" (timer + limit with justification + supervisor approval +
  audit). The new one is stronger and simpler to sell: the client ALWAYS pays the lesser value
  (actual time vs. table) — that is an argument about trust, not about control.

## Why it is reliable (sales argument)

- The client never pays more than the tabulated cap (lesser value rule).
- There is no manual time entry — the system measures it.
- Forgotten open tickets do not bill (inactivity pause).
- Everything auditable to the second, with a cryptographic signature, in the client portal.
