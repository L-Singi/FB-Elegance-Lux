-- ============================================================
-- 002_feedbacks_propostas.sql
--
-- Três coisas novas no site:
--
--   1. `feedbacks`  — depoimentos de clientes exibidos na home.
--      Aceita duas formas na mesma lista, escolhidas item a item:
--      print da conversa (imagem) ou depoimento escrito (texto +
--      nome). É por isso que `imagem`, `texto` e `nome` são todos
--      opcionais no banco: qual deles é obrigatório depende do
--      `tipo`, e essa checagem fica na API, onde a mensagem de erro
--      pode ser útil para quem está cadastrando.
--
--   2. `propostas`  — pessoas oferecendo peças para a FB comprar,
--      vindas da página /vender. É a primeira tabela alimentada por
--      alguém de fora do painel, então trata todo campo como
--      não-confiável: nada aqui é usado em consulta dinâmica, e a
--      API limita tamanho de texto, quantidade de fotos e número de
--      envios por IP antes de gravar.
--
--   3. `config.sobre_*` — a seção "Sobre nós" da home, editável pelo
--      painel como já são o hero e os selos de confiança.
--
-- Idempotente — pode rodar mais de uma vez.
-- ============================================================

-- ─── FEEDBACKS ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS feedbacks (
  id         SERIAL PRIMARY KEY,
  tipo       TEXT NOT NULL DEFAULT 'print'
               CHECK (tipo IN ('print', 'texto')),
  imagem     TEXT,
  texto      TEXT,
  nome       TEXT,
  cidade     TEXT,
  -- Ordem de exibição no carrossel, definida pelo painel. Empates
  -- caem para o id, então a lista nunca sai embaralhada entre um
  -- carregamento e outro.
  ordem      INTEGER NOT NULL DEFAULT 0,
  -- Esconde do site sem apagar: um depoimento real não deve ser
  -- perdido só porque saiu de cartaz.
  ativo      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_feedbacks_exibicao
  ON feedbacks (ativo, ordem, id);

-- ─── PROPOSTAS DE VENDA ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS propostas (
  id          SERIAL PRIMARY KEY,
  nome        TEXT NOT NULL,
  telefone    TEXT NOT NULL,
  marca       TEXT,
  peca        TEXT NOT NULL,
  tamanho     TEXT,
  estado      TEXT,
  valor       TEXT,
  observacoes TEXT,
  -- URLs das fotos enviadas pelo formulário, na ordem em que a
  -- pessoa anexou.
  imagens     JSONB NOT NULL DEFAULT '[]'::jsonb,
  status      TEXT NOT NULL DEFAULT 'aguardando'
                CHECK (status IN ('aguardando', 'aprovada', 'recusada')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- A fila do painel abre nas que ainda não foram respondidas, mais
-- recentes primeiro.
CREATE INDEX IF NOT EXISTS idx_propostas_fila
  ON propostas (status, created_at DESC);

-- ─── SOBRE NÓS (config) ─────────────────────────────────────
ALTER TABLE config ADD COLUMN IF NOT EXISTS sobre_titulo TEXT;
ALTER TABLE config ADD COLUMN IF NOT EXISTS sobre_texto  TEXT;
ALTER TABLE config ADD COLUMN IF NOT EXISTS sobre_imagem TEXT;
