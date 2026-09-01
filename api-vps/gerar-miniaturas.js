/**
 * Gera as miniaturas das fotos que já estavam no servidor antes de a
 * geração automática existir.
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
const DESTINO = path.join(ORIGEM, 'thumbs');
const LARGURA = 160;

// Uma de cada vez, de propósito. O objetivo é não competir por CPU com a
// API que está no ar atendendo a loja — o script pode demorar alguns
// minutos, e não há pressa nenhuma nisso.
async function main() {
  await fs.promises.mkdir(DESTINO, { recursive: true });

  const arquivos = (await fs.promises.readdir(ORIGEM)).filter((f) =>
    /\.(jpe?g|png|webp|gif|avif)$/i.test(f)
  );

  let feitas = 0;
  let puladas = 0;
  let falhas = 0;

  for (const [i, nome] of arquivos.entries()) {
    const saida = path.join(DESTINO, `${nome}.webp`);
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
        .resize({ width: LARGURA, withoutEnlargement: true })
        .webp({ quality: 72 })
        .toFile(saida);
      feitas++;
    } catch (err) {
      falhas++;
      console.error(`  falhou: ${nome} — ${err.message}`);
    }

    if ((i + 1) % 100 === 0) {
      console.log(`  ${i + 1}/${arquivos.length}…`);
    }
  }

  console.log(`\ngeradas: ${feitas} | já existiam: ${puladas} | falharam: ${falhas}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
