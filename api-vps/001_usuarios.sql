-- ============================================================
-- 001_usuarios.sql — autenticação do painel admin da FB Elegance
--
-- Antes disto o painel era "protegido" por uma senha literal no
-- JavaScript do navegador ('fbadmin'), e a API não tinha
-- autenticação nenhuma: qualquer pessoa na internet podia criar,
-- editar e apagar produtos, marcas, categorias e a configuração do
-- site chamando https://api.fbelegancelux.com.br diretamente.
--
-- Decisões:
--   - `senha_hash` guarda bcrypt, nunca a senha. Um vazamento do
--     banco não entrega as senhas.
--   - `papel` = 'admin' | 'usuario'. Admin ignora a checagem de
--     permissões (tem tudo) e é o único que gerencia usuários.
--   - `permissoes` é um array de strings com as áreas liberadas
--     para um 'usuario'. Guardado como jsonb para o admin poder
--     ligar/desligar cada uma sem precisar de migration nova.
--   - `ativo` desliga o acesso sem apagar o histórico da pessoa.
--
-- Idempotente — pode rodar mais de uma vez.
-- ============================================================

CREATE TABLE IF NOT EXISTS usuarios (
  id          SERIAL PRIMARY KEY,
  nome        TEXT NOT NULL,
  email       TEXT NOT NULL,
  senha_hash  TEXT NOT NULL,
  papel       TEXT NOT NULL DEFAULT 'usuario'
                CHECK (papel IN ('admin', 'usuario')),
  ativo       BOOLEAN NOT NULL DEFAULT TRUE,
  permissoes  JSONB NOT NULL DEFAULT '[]'::jsonb,
  ultimo_login TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- E-mail é a credencial de login: único, e comparado sempre em
-- minúsculas para "Maria@x.com" e "maria@x.com" não virarem contas
-- diferentes. O índice funcional garante isso no banco, não só no
-- código.
CREATE UNIQUE INDEX IF NOT EXISTS idx_usuarios_email_lower
  ON usuarios (lower(email));

CREATE OR REPLACE FUNCTION set_usuarios_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS usuarios_updated_at ON usuarios;
CREATE TRIGGER usuarios_updated_at
  BEFORE UPDATE ON usuarios
  FOR EACH ROW
  EXECUTE FUNCTION set_usuarios_updated_at();
