import type { jsPDF } from 'jspdf';
import OswaldRegular from '../assets/fonts/Oswald-Regular.ttf?url';
import OswaldBold from '../assets/fonts/Oswald-Bold.ttf?url';
import LatoRegular from '../assets/fonts/Lato-Regular.ttf?url';
import LatoBold from '../assets/fonts/Lato-Bold.ttf?url';
import RobotoCondensedRegular from '../assets/fonts/RobotoCondensed-Regular.ttf?url';
import RobotoCondensedBold from '../assets/fonts/RobotoCondensed-Bold.ttf?url';

export type FontKey = 'default' | 'oswald' | 'lato' | 'roboto-condensed';

const FONTS: Record<Exclude<FontKey, 'default'>, { name: string; normal: string; bold: string }> = {
  'oswald':           { name: 'Oswald',          normal: OswaldRegular,           bold: OswaldBold },
  'lato':             { name: 'Lato',            normal: LatoRegular,             bold: LatoBold },
  'roboto-condensed': { name: 'RobotoCondensed', normal: RobotoCondensedRegular,  bold: RobotoCondensedBold },
};

async function fetchBase64(url: string): Promise<string> {
  const buf = await (await fetch(url)).arrayBuffer();
  const bytes = new Uint8Array(buf);
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

/**
 * Embed the chosen UI font into a jsPDF document and return the font name to
 * pass to doc.setFont(). Falls back to the built-in 'helvetica' for the default
 * (system) option or if the TTFs can't be loaded — so the PDF always renders.
 */
export async function registerPdfFont(doc: jsPDF, key: FontKey | undefined): Promise<string> {
  if (!key || key === 'default') return 'helvetica';
  const f = FONTS[key];
  if (!f) return 'helvetica';
  try {
    const [normalB64, boldB64] = await Promise.all([fetchBase64(f.normal), fetchBase64(f.bold)]);
    doc.addFileToVFS(`${f.name}-Regular.ttf`, normalB64);
    doc.addFont(`${f.name}-Regular.ttf`, f.name, 'normal');
    doc.addFileToVFS(`${f.name}-Bold.ttf`, boldB64);
    doc.addFont(`${f.name}-Bold.ttf`, f.name, 'bold');
    return f.name;
  } catch {
    return 'helvetica';
  }
}
