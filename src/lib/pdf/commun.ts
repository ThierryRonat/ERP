import "server-only";
import { A_RENSEIGNER, ouARenseigner, type Entreprise } from "@/lib/entreprise";
import { depuisBase, formaterEuros } from "@/lib/montants";

// Outils PDF communs aux devis et aux factures.

// Variante STANDALONE de pdfkit : les polices standard y sont intégrées sous forme de code,
// rien n'est lu sur le disque au moment de produire le PDF (sinon : panne une fois déployé).
// Ce fichier n'est pas déclaré dans les « exports » de pdfkit : on l'importe donc par son chemin.
// eslint-disable-next-line @typescript-eslint/no-require-imports
export const PDFDocument: typeof import("pdfkit") = require("../../../node_modules/pdfkit/js/pdfkit.standalone.js");

// ─── Texte compatible avec les polices PDF standard (encodage WinAnsi) ───────────────
// toLocaleString("fr-FR") sépare les milliers par une ESPACE FINE INSÉCABLE (U+202F) et met une
// espace insécable (U+00A0) avant « € ». U+202F n'existe pas dans WinAnsi : sans traitement,
// « 1 282,50 » s'imprime « 1 /282,50 ». On remplace toutes les espaces spéciales par une espace normale.
const ESPACES_SPECIALES = /[  -​  　]/g;
const WINANSI_EXTRA = new Set("€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ");

export function pourPdf(texte: string): string {
  return [...texte.replace(ESPACES_SPECIALES, " ")]
    .map((c) => {
      const code = c.codePointAt(0)!;
      if (c === "\n" || (code >= 0x20 && code <= 0x7e) || (code >= 0xa1 && code <= 0xff) || WINANSI_EXTRA.has(c))
        return c;
      return "?"; // caractère impossible à dessiner (émoji, idéogramme…)
    })
    .join("");
}

export const eurosPdf = (valeur: number | string | bigint | null) =>
  pourPdf(formaterEuros(typeof valeur === "bigint" ? valeur : depuisBase(valeur)));
export const nombrePdf = (valeur: number) => pourPdf(valeur.toLocaleString("fr-FR", { maximumFractionDigits: 2 }));
export const datePdf = (iso: string) =>
  new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString("fr-FR", { timeZone: "UTC" });

export const GRIS = "#64748b";
export const TRAIT = "#cbd5e1";
export const FOND = "#f1f5f9";
export const ROUGE = "#b91c1c";
export const ESP = 6; // marge intérieure des cellules

/** Produit un PDF A4 en mémoire : on dessine dans `dessiner`, on récupère les octets. */
export function produirePdf(
  titre: string,
  auteur: string,
  dessiner: (doc: PDFKit.PDFDocument) => void,
): Promise<Buffer> {
  const doc = new PDFDocument({ size: "A4", margin: 50, info: { Title: pourPdf(titre), Author: pourPdf(auteur) } });
  const morceaux: Buffer[] = [];
  doc.on("data", (m: Uint8Array) => morceaux.push(Buffer.from(m)));
  const fini = new Promise<Buffer>((ok) => doc.on("end", () => ok(Buffer.concat(morceaux))));
  dessiner(doc);
  doc.end();
  return fini;
}

export const zone = (doc: PDFKit.PDFDocument) => ({
  gauche: doc.page.margins.left,
  largeur: doc.page.width - doc.page.margins.left - doc.page.margins.right,
  bas: doc.page.height - doc.page.margins.bottom,
});

/** Texte d'une mention : en ROUGE et « À RENSEIGNER » si elle est vide dans src/lib/entreprise.ts. */
function mention(doc: PDFKit.PDFDocument, prefixe: string, valeur: string, largeur: number) {
  const texte = ouARenseigner(valeur);
  doc.fillColor(texte === A_RENSEIGNER ? ROUGE : GRIS).text(pourPdf(`${prefixe}${texte}`), { width: largeur });
}

/** En-tête : émetteur (avec ses mentions légales) à gauche, titre et références à droite. */
export function dessinerEnTete(
  doc: PDFKit.PDFDocument,
  entreprise: Entreprise,
  titre: string,
  references: string[],
): number {
  const { gauche, largeur } = zone(doc);
  const demi = largeur / 2;
  const raison = ouARenseigner(entreprise.raisonSociale);
  doc
    .font("Helvetica-Bold")
    .fontSize(14)
    .fillColor(raison === A_RENSEIGNER ? ROUGE : "black")
    .text(pourPdf(raison === A_RENSEIGNER ? "Raison sociale : À RENSEIGNER" : raison), gauche, 50, { width: demi });
  doc.font("Helvetica").fontSize(9);
  mention(doc, entreprise.formeJuridique.trim() ? "" : "Forme juridique : ", entreprise.formeJuridique, demi);
  if (entreprise.adresse.some((l) => l.trim())) {
    doc.fillColor(GRIS);
    for (const l of entreprise.adresse) if (l.trim()) doc.text(pourPdf(l), { width: demi });
  } else {
    mention(doc, "Adresse : ", "", demi);
  }
  mention(doc, "SIRET : ", entreprise.siret, demi);
  mention(doc, entreprise.rcs.trim() ? "" : "RCS : ", entreprise.rcs, demi);
  mention(doc, "TVA intracommunautaire : ", entreprise.tvaIntracommunautaire, demi);
  doc.fillColor(GRIS);
  if (entreprise.email.trim()) doc.text(pourPdf(entreprise.email), { width: demi });
  if (entreprise.telephone.trim()) doc.text(pourPdf(entreprise.telephone), { width: demi });
  const basGauche = doc.y;

  doc
    .font("Helvetica-Bold")
    .fontSize(24)
    .fillColor("black")
    .text(titre, gauche, 50, { width: largeur, align: "right" });
  doc.font("Helvetica").fontSize(10).fillColor("black");
  for (const r of references) doc.text(pourPdf(r), { width: largeur, align: "right" });
  return Math.max(basGauche, doc.y);
}

export type Colonne = { titre: string; largeur: number; align: "left" | "right" };

/** Tableau avec saut de page automatique. Renvoie la position verticale après la dernière ligne. */
export function dessinerTableau(
  doc: PDFKit.PDFDocument,
  colonnes: Colonne[],
  lignes: string[][],
  yDepart: number,
): number {
  const { gauche, largeur, bas } = zone(doc);
  const enTete = (y: number) => {
    doc.rect(gauche, y, largeur, 20).fill(FOND);
    doc.font("Helvetica-Bold").fontSize(9).fillColor("black");
    let x = gauche;
    for (const c of colonnes) {
      doc.text(c.titre, x + ESP, y + 6, { width: c.largeur - 2 * ESP, align: c.align, lineBreak: false });
      x += c.largeur;
    }
    return y + 20;
  };
  let y = enTete(yDepart);
  doc.font("Helvetica").fontSize(10);
  for (const cellules of lignes) {
    const hauteur =
      Math.max(...cellules.map((t, i) => doc.heightOfString(t, { width: colonnes[i].largeur - 2 * ESP }))) + 2 * ESP;
    if (y + hauteur > bas - 100) {
      doc.addPage();
      y = enTete(doc.page.margins.top);
      doc.font("Helvetica").fontSize(10);
    }
    let x = gauche;
    doc.fillColor("black");
    cellules.forEach((t, i) => {
      doc.text(t, x + ESP, y + ESP, { width: colonnes[i].largeur - 2 * ESP, align: colonnes[i].align });
      x += colonnes[i].largeur;
    });
    y += hauteur;
    doc
      .moveTo(gauche, y)
      .lineTo(gauche + largeur, y)
      .lineWidth(0.5)
      .strokeColor(TRAIT)
      .stroke();
  }
  return y;
}

/** Bloc des totaux aligné à droite. Renvoie la position verticale après le bloc. */
export function dessinerTotaux(doc: PDFKit.PDFDocument, totaux: [string, string, boolean][], yDepart: number): number {
  const { gauche, largeur, bas } = zone(doc);
  let y = yDepart;
  if (y + 80 > bas) {
    doc.addPage();
    y = doc.page.margins.top;
  }
  const xLib = gauche + largeur - 230;
  y += 12;
  for (const [libelle, valeur, gras] of totaux) {
    if (gras) doc.rect(xLib, y - 4, 230, 20).fill(FOND);
    doc
      .font(gras ? "Helvetica-Bold" : "Helvetica")
      .fontSize(gras ? 11 : 10)
      .fillColor("black");
    doc.text(pourPdf(libelle), xLib + ESP, y, { width: 120, lineBreak: false });
    doc.text(valeur, xLib + 120, y, { width: 110 - ESP, align: "right", lineBreak: false });
    y += 20;
  }
  return y;
}
