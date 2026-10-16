-- ============================================================
-- 006_preco_antigo.sql
--
-- Adiciona suporte a preço antigo ('de por') para cálculo de desconto
-- e exibição de preço riscado e círculo pulsante com porcentagem na vitrine.
--
-- Idempotente — pode rodar mais de uma vez.
-- ============================================================

ALTER TABLE produtos ADD COLUMN IF NOT EXISTS preco_antigo VARCHAR(50);
