-- ============================================================
-- 003_produto_consignado.sql
--
-- Peças que a FB anuncia mas não são dela: vieram de um cliente
-- pelo formulário em /vender.
--
-- `vendedor_telefone` é o que muda o comportamento da vitrine —
-- quando está preenchido, o botão "Consultar via WhatsApp" daquela
-- peça abre a conversa com quem está vendendo, não com a loja. É
-- exatamente o papel de intermediária que a FB tem aqui: ela mostra
-- a peça e liga as duas pontas.
--
-- Guardado já normalizado (só dígitos, com o 55 na frente), porque é
-- o formato que o wa.me exige e porque a pessoa digita de um jeito
-- diferente a cada vez no formulário. O original continua intacto em
-- `propostas.telefone`.
--
-- NULL nas peças da própria loja — que são a maioria e seguem
-- mandando para o número da FB. Por isso a coluna é anulável e sem
-- default: a ausência de valor é que significa "peça nossa".
--
-- `proposta_id` mantém o rastro de qual proposta virou qual peça.
-- ON DELETE SET NULL: apagar uma proposta antiga não pode derrubar
-- um produto que já está anunciado e vendendo.
--
-- Idempotente — pode rodar mais de uma vez.
-- ============================================================

ALTER TABLE produtos
  ADD COLUMN IF NOT EXISTS vendedor_telefone TEXT;

ALTER TABLE produtos
  ADD COLUMN IF NOT EXISTS proposta_id INTEGER;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'produtos_proposta_fk'
  ) THEN
    ALTER TABLE produtos
      ADD CONSTRAINT produtos_proposta_fk
      FOREIGN KEY (proposta_id) REFERENCES propostas(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Uma proposta vira uma peça só. Sem isto, clicar duas vezes em
-- "publicar" criaria o produto duas vezes no catálogo.
CREATE UNIQUE INDEX IF NOT EXISTS idx_produtos_proposta_unica
  ON produtos (proposta_id) WHERE proposta_id IS NOT NULL;
