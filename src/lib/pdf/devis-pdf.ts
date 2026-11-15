import "server-only";
import { ENTREPRISE } from "@/lib/entreprise";
import { depuisBase, formaterEuros, tauxDepuisMontants } from "@/lib/montants";

// Variante STANDALONE de pdfkit : les polices standard y sont intégrées sous forme de code,
// rien n'est lu sur le disque au moment de produire le PDF (sinon : panne une fois déployé).
// Ce fichier n'est pas déclaré dans les « exports » de pdfkit : on l'importe donc par son chemin.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const PDFDocument: typeof import("pdfkit") = require("../../../node_modules/pdfkit/js/pdfkit.standalone.js");

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
      if (c === "\n" || (code >= 0x20 && code <= 0x7e) || (code >= 0xa1 && code <= 0xff) || WINANSI_EXTRA.has(c)) return c;
      return "?"; // caractère impossible à dessiner (émoji, idéogramme…)
    })
    .join("");
}

const euros = (valeur: number | string | null) => pourPdf(formaterEuros(depuisBase(valeur)));
const nombre = (valeur: number) => pourPdf(valeur.toLocaleString("fr-FR", { maximumFractionDigits: 2 }));
const date = (iso: string) => new Date(iso).toLocaleDateString("fr-FR", { timeZone: "UTC" });

export type DonneesDevisPdf = {
  numero: string;
  date_emission: string;
  total_ht: number | string;
  tva: number | string;
  total_ttc: number | string;
  prospect: { nom: string; societe: string | null; email: string | null; telephone: string | null } | null;
  lignes: { designation: string; quantite: number; prix_unitaire: number | string; montant_ht: number | string }[];
};

const GRIS = "#64748b";
const TRAIT = "#cbd5e1";
const FOND = "#f1f5f9";

/** Produit le PDF d'un devis, en mémoire. */
export function genererPdfDevis(d: DonneesDevisPdf): Promise<Buffer> {
  const doc = new PDFDocument({ size: "A4", margin: 50, info: { Title: `Devis ${d.numero}`, Author: ENTREPRISE.nom } });
  const morceaux: Buffer[] = [];
  doc.on("data", (m: Uint8Array) => morceaux.push(Buffer.from(m)));
  const fini = new Promise<Buffer>((ok) => doc.on("end", () => ok(Buffer.concat(morceaux))));

  const gauche = doc.page.margins.left;
  const largeur = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const bas = doc.page.height - doc.page.margins.bottom;

  // ── En-tête : émetteur à gauche, « DEVIS » à droite ──
  doc.font("Helvetica-Bold").fontSize(16).fillColor("black").text(pourPdf(ENTREPRISE.nom), gauche, 50, { width: largeur / 2 });
  doc.font("Helvetica").fontSize(10).fillColor(GRIS);
  for (const l of ENTREPRISE.lignes) doc.text(pourPdf(l), { width: largeur / 2 });

  doc.font("Helvetica-Bold").fontSize(24).fillColor("black").text("DEVIS", gauche, 50, { width: largeur, align: "right" });
  doc.font("Helvetica").fontSize(10).fillColor("black")
    .text(`N° ${pourPdf(d.numero)}`, { width: largeur, align: "right" })
    .text(`Date : ${date(d.date_emission)}`, { width: largeur, align: "right" });

  // ── Destinataire ──
  const yDest = 140;
  const xDest = gauche + largeur / 2;
  doc.font("Helvetica").fontSize(9).fillColor(GRIS).text("DESTINATAIRE", xDest, yDest);
  doc.font("Helvetica-Bold").fontSize(11).fillColor("black").text(pourPdf(d.prospect?.nom ?? "—"), xDest, yDest + 14, { width: largeur / 2 });
  doc.font("Helvetica").fontSize(10);
  for (const info of [d.prospect?.societe, d.prospect?.email, d.prospect?.telephone]) {
    if (info) doc.text(pourPdf(info), { width: largeur / 2 });
  }

  // ── Tableau des lignes ──
  const colonnes = [
    { titre: "Désignation", largeur: largeur - 230, align: "left" as const },
    { titre: "Qté", largeur: 50, align: "right" as const },
    { titre: "PU HT", largeur: 90, align: "right" as const },
    { titre: "Montant HT", largeur: 90, align: "right" as const },
  ];
  const ESP = 6; // marge intérieure des cellules

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

  let y = enTete(Math.max(doc.y, yDest + 80) + 20);
  doc.font("Helvetica").fontSize(10);
  for (const l of d.lignes) {
    const cellules = [pourPdf(l.designation), nombre(Number(l.quantite)), euros(l.prix_unitaire), euros(l.montant_ht)];
    const hauteur = Math.max(...cellules.map((t, i) => doc.heightOfString(t, { width: colonnes[i].largeur - 2 * ESP }))) + 2 * ESP;
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
    doc.moveTo(gauche, y).lineTo(gauche + largeur, y).lineWidth(0.5).strokeColor(TRAIT).stroke();
  }

  // ── Totaux ──
  if (y + 80 > bas) {
    doc.addPage();
    y = doc.page.margins.top;
  }
  const xLib = gauche + largeur - 230;
  const totaux: [string, string, boolean][] = [
    ["Total HT", euros(d.total_ht), false],
    [`TVA (${pourPdf(tauxDepuisMontants(depuisBase(d.total_ht), depuisBase(d.tva)))})`, euros(d.tva), false],
    ["Total TTC", euros(d.total_ttc), true],
  ];
  y += 12;
  for (const [libelle, valeur, gras] of totaux) {
    if (gras) doc.rect(xLib, y - 4, 230, 20).fill(FOND);
    doc.font(gras ? "Helvetica-Bold" : "Helvetica").fontSize(gras ? 11 : 10).fillColor("black");
    doc.text(libelle, xLib + ESP, y, { width: 120, lineBreak: false });
    doc.text(valeur, xLib + 120, y, { width: 110 - ESP, align: "right", lineBreak: false });
    y += 20;
  }

  doc.end();
  return fini;
}
