#!/usr/bin/env node
/**
 * Gera uma pasta por peça em /produto/<id>-<slug>/ para que o link de um
 * produto ganhe cartão de preview quando for colado no WhatsApp ou no
 * Instagram.
 *
 * Por que isto existe
 * -------------------
 * O site é uma página só, hospedada no GitHub Pages. GitHub Pages serve
 * arquivo estático e nada mais: não reescreve caminhos e não roda código
 * no servidor. Os robôs que montam o cartão de preview (WhatsApp,
 * Instagram, Telegram) leem o HTML cru e não executam JavaScript — então
 * não adianta o site preencher as marcações depois de carregar. Quando o
 * HTML entregue é sempre o mesmo index.html, todo link compartilhado
 * mostra o mesmo cartão genérico da loja.
 *
 * A saída daqui resolve isso pelo único caminho que o GitHub Pages
 * aceita: um arquivo de verdade por peça, com as marcações já escritas.
 * A pessoa que clica é mandada de volta para o site (?produto=<id>), que
 * abre a peça normalmente.
 *
 * Limite conhecido: as páginas são geradas de hora em hora pelo robô em
 * .github/workflows/paginas-de-produto.yml. Uma peça cadastrada agora só
 * ganha cartão de preview na próxima rodada. O link com ?produto=<id>
 * funciona na hora, sempre — é só o cartão que espera.
 */

const fs = require('fs/promises');
const path = require('path');

const API = process.env.FB_API || 'https://api.fbelegancelux.com.br';
const SITE = process.env.FB_SITE || 'https://fbelegancelux.com.br';
const RAIZ = path.join(__dirname, '..');
const DESTINO = path.join(RAIZ, 'produto');

/** Escapa para uso dentro de atributo HTML entre aspas duplas. */
function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Mesma regra do slugProduto() do script.js — os dois precisam gerar o
 *  mesmo endereço, senão o botão "copiar link" aponta para uma pasta que
 *  não existe. */
function slug(nome) {
  return String(nome || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'peca';
}

/** Uma linha curta para o cartão: preço, tamanho e o essencial da peça. */
function descricaoCurta(p) {
  const partes = [];
  if (p.preco) partes.push(p.preco);
  if (Array.isArray(p.tamanhos) && p.tamanhos.length) partes.push(`Tamanho ${p.tamanhos.join('/')}`);
  else if (p.numeracao) partes.push(`Numeração ${p.numeracao}`);
  if (p.status === 'vendido') partes.push('VENDIDA');
  partes.push('100% original, autenticada individualmente. Envio para todo o Brasil.');
  return partes.join(' · ');
}

function paginaDoProduto(p) {
  const endereco = `${SITE}/produto/${p.id}-${slug(p.nome)}/`;
  const destino = `${SITE}/?produto=${p.id}`;
  const titulo = `${p.nome} | FB Elegance Lux`;
  const descricao = descricaoCurta(p);
  const imagem = (Array.isArray(p.images) && p.images[0]) || `${SITE}/logo.png`;

  return `<!DOCTYPE html>
<html lang="pt-br">

<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${esc(titulo)}</title>
  <meta name="description" content="${esc(descricao)}">
  <link rel="shortcut icon" href="${SITE}/favicon.ico" type="image/x-icon">
  <link rel="canonical" href="${esc(destino)}">

  <meta property="og:type" content="product">
  <meta property="og:site_name" content="FB Elegance Lux">
  <meta property="og:url" content="${esc(endereco)}">
  <meta property="og:title" content="${esc(p.nome)}">
  <meta property="og:description" content="${esc(descricao)}">
  <meta property="og:image" content="${esc(imagem)}">
  <meta property="og:locale" content="pt_BR">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${esc(p.nome)}">
  <meta name="twitter:description" content="${esc(descricao)}">
  <meta name="twitter:image" content="${esc(imagem)}">

  <!-- Os robôs de preview leem as marcações acima e param aqui; quem é
       gente segue para a peça no site. O refresh cobre quem tem
       JavaScript desligado. -->
  <meta http-equiv="refresh" content="0; url=${esc(destino)}">
  <script>location.replace(${JSON.stringify(destino)});</script>
  <style>
    body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
           background: #0A0A0B; color: #F2EFE9; font-family: system-ui, sans-serif; text-align: center; padding: 24px; }
    a { color: #B8924F; }
  </style>
</head>

<body>
  <p>Abrindo <a href="${esc(destino)}">${esc(p.nome)}</a> na FB Elegance Lux…</p>
</body>

</html>
`;
}

async function main() {
  const resposta = await fetch(`${API}/api/produtos`);
  if (!resposta.ok) throw new Error(`API respondeu ${resposta.status}`);
  const produtos = await resposta.json();
  if (!Array.isArray(produtos) || produtos.length === 0) {
    // Sem isto, uma falha momentânea da API apagaria todas as páginas e o
    // commit seguinte publicaria a remoção.
    throw new Error('A API não devolveu produto nenhum — abortando para não apagar as páginas existentes.');
  }

  await fs.mkdir(DESTINO, { recursive: true });

  const esperadas = new Set();
  for (const p of produtos) {
    const pasta = `${p.id}-${slug(p.nome)}`;
    esperadas.add(pasta);
    const dir = path.join(DESTINO, pasta);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'index.html'), paginaDoProduto(p), 'utf-8');
  }

  // Limpa o que sobrou de peças apagadas ou renomeadas — senão o
  // diretório só cresce e acumula link quebrado.
  let removidas = 0;
  for (const entrada of await fs.readdir(DESTINO, { withFileTypes: true })) {
    if (!entrada.isDirectory() || esperadas.has(entrada.name)) continue;
    await fs.rm(path.join(DESTINO, entrada.name), { recursive: true, force: true });
    removidas += 1;
  }

  console.log(`${esperadas.size} páginas geradas, ${removidas} removidas.`);
}

main().catch(err => {
  console.error('Falhou:', err.message);
  process.exit(1);
});
