/**
 * UUID constante reservado para eventos de auditoria ao nível da plataforma
 * (ações executadas por super_admin sem vínculo a uma organização específica).
 *
 * Permite manter uma cadeia de integridade hash (SHA-256) consistente e isolada
 * para ações de plataforma sem violar a restrição NOT NULL de organizacao_id.
 */
export const ORGANIZACAO_PLATAFORMA_ID = "00000000-0000-0000-0000-000000000000";
