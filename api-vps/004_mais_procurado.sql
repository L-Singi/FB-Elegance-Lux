-- ============================================================
-- 004_mais_procurado.sql
--
-- Até aqui, "Mais Procurados" mostrava as 18 primeiras peças na ordem
-- manual do admin (arrastar-e-soltar na aba Estoque), cruzando todas
-- as categorias — pra tirar ou pôr uma peça ali, era preciso reordenar
-- o catálogo inteiro. Agora existe um campo próprio: marcar/desmarcar
-- uma peça não mexe em nada mais.
--
-- Idempotente — pode rodar mais de uma vez.
-- ============================================================

ALTER TABLE produtos ADD COLUMN IF NOT EXISTS mais_procurado BOOLEAN NOT NULL DEFAULT FALSE;

-- A vitrine só lê as marcadas — índice parcial porque é sempre um
-- recorte pequeno do catálogo.
CREATE INDEX IF NOT EXISTS idx_produtos_mais_procurado
  ON produtos (mais_procurado)
  WHERE mais_procurado = TRUE;
