import "server-only";
import { ENTREPRISE } from "@/lib/entreprise";
import { depuisBase, tauxDepuisMontants } from "@/lib/montants";
import {
  datePdf,
  dessinerEnTete,
  dessinerTableau,
  dessinerTotaux,
  eurosPdf,
  GRIS,
  nombrePdf,
  pourPdf,
  produirePdf,
  zone,
} from "@/lib/pdf/commun";

// Rétro-compatibilité : pourPdf était exporté d'ici.
export { pourPdf };

export type DonneesDevisPdf = {
  numero: string;
  date_emission: string;
  total_ht: number | string;
  tva: number | string;
  total_ttc: number | string;
  prospect: { nom: string; societe: string | null; email: string | null; telephone: string | null } | null;
  lignes: { designation: string; quantite: number; prix_unitaire: number | string; montant_ht: number | string }[];
};

/** Produit le PDF d'un devis, en mémoire. */
export function genererPdfDevis(d: DonneesDevisPdf): Promise<Buffer> {
  return produirePdf(`Devis ${d.numero}`, ENTREPRISE.raisonSociale, (doc) => {
    const { gauche, largeur } = zone(doc);
    const basEnTete = dessinerEnTete(doc, ENTREPRISE, "DEVIS", [
      `N° ${d.numero}`,
      `Date : ${datePdf(d.date_emission)}`,
    ]);

    // ── Destinataire ──
    const yDest = Math.max(basEnTete + 20, 150);
    const xDest = gauche + largeur / 2;
    doc.font("Helvetica").fontSize(9).fillColor(GRIS).text("DESTINATAIRE", xDest, yDest);
    doc
      .font("Helvetica-Bold")
      .fontSize(11)
      .fillColor("black")
      .text(pourPdf(d.prospect?.nom ?? "—"), xDest, yDest + 14, { width: largeur / 2 });
    doc.font("Helvetica").fontSize(10);
    for (const info of [d.prospect?.societe, d.prospect?.email, d.prospect?.telephone]) {
      if (info) doc.text(pourPdf(info), { width: largeur / 2 });
    }

    // ── Lignes ──
    const y = dessinerTableau(
      doc,
      [
        { titre: "Désignation", largeur: largeur - 230, align: "left" },
        { titre: "Qté", largeur: 50, align: "right" },
        { titre: "PU HT", largeur: 90, align: "right" },
        { titre: "Montant HT", largeur: 90, align: "right" },
      ],
      d.lignes.map((l) => [
        pourPdf(l.designation),
        nombrePdf(Number(l.quantite)),
        eurosPdf(l.prix_unitaire),
        eurosPdf(l.montant_ht),
      ]),
      Math.max(doc.y, yDest + 80) + 20,
    );

    // ── Totaux ──
    dessinerTotaux(
      doc,
      [
        ["Total HT", eurosPdf(d.total_ht), false],
        [`TVA (${tauxDepuisMontants(depuisBase(d.total_ht), depuisBase(d.tva))})`, eurosPdf(d.tva), false],
        ["Total TTC", eurosPdf(d.total_ttc), true],
      ],
      y,
    );
  });
}
