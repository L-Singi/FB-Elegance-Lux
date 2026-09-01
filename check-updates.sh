#!/bin/bash
# Confere se tem commit novo no GitHub (feito por qualquer pessoa) que
# ainda não está no seu clone local, e atualiza automaticamente quando
# for seguro (sem alteração sua não salva no meio do caminho).
#
# Uso: cole este arquivo inteiro no terminal, ou rode com
#   bash check-updates.sh

set -e
cd "/Users/adrianotavares/Documents/Projetos PK Digital/FB-Elegance-Lux"

echo "Verificando atualizações em FB-Elegance-Lux..."
git fetch origin --quiet

LOCAL=$(git rev-parse main)
REMOTE=$(git rev-parse origin/main)

if [ "$LOCAL" = "$REMOTE" ]; then
  echo "Sem novidade — seu código já está no commit mais recente."
  exit 0
fi

echo ""
echo "Commit(s) novo(s) no GitHub que você ainda não tem:"
git log HEAD..origin/main --oneline --format="  %h  %ad  %an  %s" --date=short
echo ""

if [ -n "$(git status --porcelain)" ]; then
  echo "Você tem alterações locais não commitadas — não vou atualizar sozinho"
  echo "pra não perder seu trabalho. Salve/commite o que está fazendo e rode"
  echo "de novo, ou atualize manualmente com: git pull"
  exit 1
fi

echo "Sem alterações locais pendentes — atualizando..."
git pull --ff-only origin main
echo "Pronto, código atualizado pro commit mais recente."
