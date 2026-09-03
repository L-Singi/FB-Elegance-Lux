/**
 * Gera as versões reduzidas das fotos que já estavam no servidor antes
 * de a geração automática existir: a miniatura do painel (160px) e a
 * foto da vitrine da loja (700px).
 *
 * Roda uma vez, direto no container da API:
 *
 *   sudo docker exec fbelegance-api node gerar-miniaturas.js
 *
 * É seguro rodar de novo: pula o que já tem miniatura. Se algo falhar no
 * meio, rodar outra vez retoma de onde parou.
 */
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const ORIGEM = '/app/uploads/produtos';
const TAMANHOS = [
  // A miniatura do painel admin.
  { destino: path.join(ORIGEM, 'thumbs'), largura: 160, qualidade: 72 },
  // A foto que a LOJA mostra na grade. E' o que tira a lentidao de
  // abrir e rolar o site: a original e' foto de celular de 3 a 6 MB.
  { destino: path.join(ORIGEM, 'vitrine'), largura: 700, qualidade: 80 },
];

// Uma de cada vez, de propósito. O objetivo é não competir por CPU com a
// API que está no ar atendendo a loja — o script pode demorar alguns
// minutos, e não há pressa nenhuma nisso.
async function main() {
  for (const t of TAMANHOS) await fs.promises.mkdir(t.destino, { recursive: true });

  const arquivos = (await fs.promises.readdir(ORIGEM)).filter((f) =>
    /\.(jpe?g|png|webp|gif|avif)$/i.test(f)
  );

  let feitas = 0;
  let puladas = 0;
  let falhas = 0;

  // Uma de cada vez, de propósito. O objetivo é não competir por CPU com a
  // API que está no ar atendendo a loja — o script pode demorar alguns
  // minutos, e não há pressa nenhuma nisso.
  for (const [i, nome] of arquivos.entries()) {
    for (const { destino, largura, qualidade } of TAMANHOS) {
      const saida = path.join(destino, `${nome}.webp`);
      try {
        await fs.promises.access(saida);
        puladas++;
        continue;
      } catch {
        /* não existe ainda — segue e gera */
      }

      try {
        await sharp(path.join(ORIGEM, nome))
          .rotate() // respeita o EXIF: foto de celular vem deitada
          .resize({ width: largura, withoutEnlargement: true })
          .webp({ quality: qualidade })
          .toFile(saida);
        feitas++;
      } catch (err) {
        falhas++;
        console.error(`  falhou: ${nome} (${largura}px) — ${err.message}`);
      }
    }

    if ((i + 1) % 50 === 0) {
      console.log(`  ${i + 1}/${arquivos.length}…`);
    }
  }

  console.log(`\ngeradas: ${feitas} | já existiam: ${puladas} | falharam: ${falhas}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
