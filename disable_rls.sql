-- Script SQL para desabilitar Row Level Security (RLS) na tabela 'produtos' e configurar políticas para o storage do Supabase
-- Execute este script no SQL Editor do Supabase (https://supabase.com/dashboard/project/YOUR_PROJECT/sql)

-- Desabilitar RLS para a tabela produtos
ALTER TABLE produtos DISABLE ROW LEVEL SECURITY;

-- Para o storage, não podemos desabilitar RLS na tabela objects, mas podemos criar políticas permissivas para o bucket 'produtos'
-- Primeiro, garantir que o bucket existe (se não, crie via dashboard)
-- Políticas para permitir operações no bucket 'produtos'

-- Política para SELECT (visualizar arquivos)
CREATE POLICY "Allow public select on produtos bucket" ON storage.objects
FOR SELECT USING (bucket_id = 'produtos');

-- Política para INSERT (upload de arquivos)
CREATE POLICY "Allow public insert on produtos bucket" ON storage.objects
FOR INSERT WITH CHECK (bucket_id = 'produtos');

-- Política para UPDATE (se necessário)
CREATE POLICY "Allow public update on produtos bucket" ON storage.objects
FOR UPDATE USING (bucket_id = 'produtos');

-- Política para DELETE (remover arquivos)
CREATE POLICY "Allow public delete on produtos bucket" ON storage.objects
FOR DELETE USING (bucket_id = 'produtos');

-- Nota: Essas políticas permitem acesso público ao bucket 'produtos'.
-- Para mais segurança, restrinja a usuários autenticados, mas para o painel admin funcionar, isso resolve.
-- Se o bucket não existir, crie-o no dashboard do Supabase primeiro.