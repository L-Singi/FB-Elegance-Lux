-- ============================================================
-- 005_quantidade_estoque.sql
--
-- Quantidade disponível de cada produto no estoque.
-- Padrão: 1 (peça única/disponível).
-- Peças com status 'vendido' iniciam com 0.
-- Visível apenas no painel administrativo; não exibido na vitrine do cliente.
--
-- Idempotente — pode rodar mais de uma vez.
-- ============================================================

ALTER TABLE produtos ADD COLUMN IF NOT EXISTS quantidade INTEGER NOT NULL DEFAULT 1;

-- Produtos já marcados como vendidos iniciam com estoque zerado
UPDATE produtos SET quantidade = 0 WHERE status = 'vendido' AND quantidade = 1;

CREATE INDEX IF NOT EXISTS idx_produtos_quantidade
  ON produtos (quantidade);
