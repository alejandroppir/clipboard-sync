import {Resvg} from '@resvg/resvg-js';
import pngToIco from 'png-to-ico';
import {readFileSync, writeFileSync} from 'fs';

const svg = readFileSync('assets/logo.svg', 'utf8');
const sizes = [16, 32, 48, 256];

const pngs = sizes.map((s) => {
  const resvg = new Resvg(svg, {
    fitTo: {mode: 'width', value: s},
    font: {loadSystemFonts: true},
  });
  return resvg.render().asPng();
});

writeFileSync('assets/logo.ico', await pngToIco(pngs));
console.log('assets/logo.ico generado.');
