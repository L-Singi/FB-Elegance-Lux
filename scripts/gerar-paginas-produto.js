#!/usr/bin/env node
/**
 * Gera as pastas estáticas por categoria e produto (ex: /casacos/talproduto/)
 * e o sitemap.xml para o site FB Elegance Lux.
 *
 * Por que isto existe:
 * -------------------
 * O site é uma Single Page Application hospedada no GitHub Pages.
 * Os robôs que montam o cartão de preview (WhatsApp, Instagram, Telegram)
 * e indexadores de busca leem o HTML cru e não executam JavaScript.
 *
 * Este script cria arquivos index.html reais em:
 *   - /<categoria>/ (ex: /casacos/)
 *   - /<categoria>/<slug-do-produto>/ (ex: /casacos/talproduto/)
 *   - /produto/<id>-<slug>/ (legado mantido para compatibilidade de links antigos)
 *
 * Cada arquivo possui marcações Open Graph completas (imagem, título, preço)
 * e redirecionamento instantâneo para a aplicação carregar a peça ou categoria.
 */

const fs = require('fs/promises');
const path = require('path');

const API = process.env.FB_API || 'https://api.fbelegancelux.com.br';
const SITE = process.env.FB_SITE || 'https://fbelegancelux.com.br';
const RAIZ = path.join(__dirname, '..');

const CAT_LABELS = {
  casacos: 'Casacos',
  camisetas: 'Camisetas',
  shorts: 'Shorts',
  calcados: 'Calçados',
  acessorios: 'Acessórios',
  perfumes: 'Perfumes',
  vestuario: 'Vestuário',
  lifestyle: 'Lifestyle',
};

function normalizeCategoria(c) {
  const v = String(c || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
  if (['casacos', 'casaco'].includes(v)) return 'casacos';
  if (['camisetas', 'camiseta'].includes(v)) return 'camisetas';
  if (['shorts'].includes(v)) return 'shorts';
  if (['calcados', 'calcado'].includes(v)) return 'calcados';
  if (['acessorios', 'acessorio'].includes(v)) return 'acessorios';
  if (['perfumes', 'perfume'].includes(v)) return 'perfumes';
  if (['vestuario', 'vestuarios'].includes(v)) return 'vestuario';
  if (['lifestyle'].includes(v)) return 'lifestyle';
  return v || 'produtos';
}

/** Escapa para uso dentro de atributo HTML entre aspas duplas. */
function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Regra idêntica à do script.js para garantir que os links coincidam */
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

function paginaDoProduto(p, endereco, destino) {
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
  <link rel="canonical" href="${esc(endereco)}">

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

function paginaDaCategoria(catKey, catLabel) {
  const endereco = `${SITE}/${catKey}/`;
  const destino = `${SITE}/?rota=${encodeURIComponent(catKey)}`;
  const titulo = `${catLabel} | FB Elegance Lux`;
  const descricao = `Explore a seleção de ${catLabel.toLowerCase()} exclusivos na FB Elegance Lux. Peças 100% originais com autenticação individual e envio para todo o Brasil.`;
  const imagem = `${SITE}/logo.png`;

  return `<!DOCTYPE html>
<html lang="pt-br">

<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${esc(titulo)}</title>
  <meta name="description" content="${esc(descricao)}">
  <link rel="shortcut icon" href="${SITE}/favicon.ico" type="image/x-icon">
  <link rel="canonical" href="${esc(endereco)}">

  <meta property="og:type" content="website">
  <meta property="og:site_name" content="FB Elegance Lux">
  <meta property="og:url" content="${esc(endereco)}">
  <meta property="og:title" content="${esc(titulo)}">
  <meta property="og:description" content="${esc(descricao)}">
  <meta property="og:image" content="${esc(imagem)}">
  <meta property="og:locale" content="pt_BR">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${esc(titulo)}">
  <meta name="twitter:description" content="${esc(descricao)}">
  <meta name="twitter:image" content="${esc(imagem)}">

  <meta http-equiv="refresh" content="0; url=${esc(destino)}">
  <script>location.replace(${JSON.stringify(destino)});</script>
  <style>
    body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
           background: #0A0A0B; color: #F2EFE9; font-family: system-ui, sans-serif; text-align: center; padding: 24px; }
    a { color: #B8924F; }
  </style>
</head>

<body>
  <p>Abrindo categoria <a href="${esc(destino)}">${esc(catLabel)}</a> na FB Elegance Lux…</p>
</body>

</html>
`;
}

function sitemapXml(produtos) {
  const categoriasUnicas = [...new Set(produtos.map(p => normalizeCategoria(p.categoria)))].sort();
  const urls = [
    { loc: `${SITE}/`, prioridade: '1.0' },
    { loc: `${SITE}/vender/`, prioridade: '0.8' },
    ...categoriasUnicas.map(cat => ({
      loc: `${SITE}/${cat}/`,
      prioridade: '0.8',
    })),
    ...produtos
      .slice()
      .sort((a, b) => a.id - b.id)
      .map(p => ({
        loc: `${SITE}/${normalizeCategoria(p.categoria)}/${slug(p.nome)}/`,
        prioridade: '0.7',
      })),
  ];

  const itens = urls.map(({ loc, prioridade }) =>
    `  <url>\n    <loc>${esc(loc)}</loc>\n    <priority>${prioridade}</priority>\n  </url>`
  ).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${itens}\n</urlset>\n`;
}

async function main() {
  const resposta = await fetch(`${API}/api/produtos`);
  if (!resposta.ok) throw new Error(`API respondeu ${resposta.status}`);
  const produtos = await resposta.json();
  if (!Array.isArray(produtos) || produtos.length === 0) {
    throw new Error('A API não devolveu produto nenhum — abortando para não apagar as páginas existentes.');
  }

  // Agrupa produtos por categoria
  const porCategoria = new Map();
  for (const p of produtos) {
    const cat = normalizeCategoria(p.categoria);
    if (!porCategoria.has(cat)) porCategoria.set(cat, []);
    porCategoria.get(cat).push(p);
  }

  let totalPaginas = 0;
  const categoriasCriadas = new Set(porCategoria.keys());

  // 1. Gera páginas para cada categoria e seus respectivos produtos no formato /<categoria>/<slug>/
  for (const [cat, prods] of porCategoria.entries()) {
    const dirCat = path.join(RAIZ, cat);
    await fs.mkdir(dirCat, { recursive: true });

    // Página da categoria: /<categoria>/index.html
    const labelCat = CAT_LABELS[cat] || cat.charAt(0).toUpperCase() + cat.slice(1);
    await fs.writeFile(path.join(dirCat, 'index.html'), paginaDaCategoria(cat, labelCat), 'utf-8');

    const pastasEsperadas = new Set();
    for (const p of prods) {
      const prodSlug = slug(p.nome);
      pastasEsperadas.add(prodSlug);
      const dirProd = path.join(dirCat, prodSlug);
      await fs.mkdir(dirProd, { recursive: true });

      const endereco = `${SITE}/${cat}/${prodSlug}/`;
      const destino = `${SITE}/?rota=${encodeURIComponent(cat + '/' + prodSlug)}`;
      await fs.writeFile(path.join(dirProd, 'index.html'), paginaDoProduto(p, endereco, destino), 'utf-8');
      totalPaginas += 1;
    }

    // Limpa subdiretórios que não pertencem mais aos produtos ativos desta categoria
    for (const entrada of await fs.readdir(dirCat, { withFileTypes: true })) {
      if (!entrada.isDirectory()) continue;
      if (!pastasEsperadas.has(entrada.name)) {
        await fs.rm(path.join(dirCat, entrada.name), { recursive: true, force: true });
      }
    }
  }

  // 2. Mantém pasta legada /produto/<id>-<slug>/ para links já compartilhados não quebrarem
  const destinoLegado = path.join(RAIZ, 'produto');
  await fs.mkdir(destinoLegado, { recursive: true });
  const esperadasLegado = new Set();
  for (const p of produtos) {
    const pastaLegada = `${p.id}-${slug(p.nome)}`;
    esperadasLegado.add(pastaLegada);
    const dir = path.join(destinoLegado, pastaLegada);
    await fs.mkdir(dir, { recursive: true });

    const cat = normalizeCategoria(p.categoria);
    const prodSlug = slug(p.nome);
    const enderecoLegado = `${SITE}/produto/${pastaLegada}/`;
    const destinoLegadoUrl = `${SITE}/?rota=${encodeURIComponent(cat + '/' + prodSlug)}`;
    await fs.writeFile(path.join(dir, 'index.html'), paginaDoProduto(p, enderecoLegado, destinoLegadoUrl), 'utf-8');
  }

  for (const entrada of await fs.readdir(destinoLegado, { withFileTypes: true })) {
    if (!entrada.isDirectory() || esperadasLegado.has(entrada.name)) continue;
    await fs.rm(path.join(destinoLegado, entrada.name), { recursive: true, force: true });
  }

  // 3. Atualiza sitemap.xml com as novas URLs
  await fs.writeFile(path.join(RAIZ, 'sitemap.xml'), sitemapXml(produtos), 'utf-8');

  console.log(`${totalPaginas} páginas de produto em ${categoriasCriadas.size} categorias geradas.`);
  console.log(`Páginas de categoria, rotas legadas e sitemap.xml atualizados com sucesso.`);
}

main().catch(err => {
  console.error('Falhou:', err.message);
  process.exit(1);
});
