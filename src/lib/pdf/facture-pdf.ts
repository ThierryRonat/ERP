import "server-only";
import { ENTREPRISE, ouARenseigner, A_RENSEIGNER, type Entreprise } from "@/lib/entreprise";
import { versTexteDecimal } from "@/lib/montants";
import type { CalculFacture } from "@/lib/finance";
import {
  datePdf,
  dessinerEnTete,
  dessinerTableau,
  dessinerTotaux,
  eurosPdf,
  GRIS,
  pourPdf,
  produirePdf,
  ROUGE,
  zone,
} from "@/lib/pdf/commun";

export type DonneesFacturePdf = {
  numero: string;
  date_emission: string;
  date_echeance: string;
  periode_debut: string;
  periode_fin: string;
  total_ht: number | string; // montants FIGÉS à l'émission : ce sont eux qui s'impriment
  tva: number | string;
  total_ttc: number | string;
  client: { nom: string; adresse: string | null; email_contact: string | null; telephone: string | null } | null;
};

const heures = (c: bigint) =>
  pourPdf(
    versTexteDecimal(c)
      .replace(/\.?0+$/, "")
      .replace(".", ","),
  );

/**
 * Produit le PDF d'une facture. Les lignes sont reconstituées depuis les temps rattachés ;
 * l'appelant DOIT avoir vérifié qu'elles correspondent aux montants figés (sinon : pas de PDF).
 */
export function genererPdfFacture(
  f: DonneesFacturePdf,
  calcul: CalculFacture,
  entreprise: Entreprise = ENTREPRISE,
): Promise<Buffer> {
  return produirePdf(`Facture ${f.numero}`, entreprise.raisonSociale, (doc) => {
    const { gauche, largeur, bas } = zone(doc);
    const basEnTete = dessinerEnTete(doc, entreprise, "FACTURE", [
      `N° ${f.numero}`,
      `Date d'émission : ${datePdf(f.date_emission)}`,
      `Échéance : ${datePdf(f.date_echeance)}`,
      `Période : du ${datePdf(f.periode_debut)} au ${datePdf(f.periode_fin)}`,
    ]);

    // ── Client ──
    const yClient = Math.max(basEnTete + 20, 170);
    const xClient = gauche + largeur / 2;
    doc.font("Helvetica").fontSize(9).fillColor(GRIS).text("FACTURÉ À", xClient, yClient);
    doc
      .font("Helvetica-Bold")
      .fontSize(11)
      .fillColor("black")
      .text(pourPdf(f.client?.nom ?? "—"), xClient, yClient + 14, { width: largeur / 2 });
    doc.font("Helvetica").fontSize(10);
    for (const info of [f.client?.adresse, f.client?.email_contact, f.client?.telephone]) {
      if (info) doc.text(pourPdf(info), { width: largeur / 2 });
    }

    // ── Lignes : une par projet et par taux horaire ──
    const y = dessinerTableau(
      doc,
      [
        { titre: "Désignation", largeur: largeur - 250, align: "left" },
        { titre: "Heures", largeur: 60, align: "right" },
        { titre: "Taux HT", largeur: 90, align: "right" },
        { titre: "Montant HT", largeur: 100, align: "right" },
      ],
      calcul.lignes.map((l) => [
        pourPdf(`${l.projet}${l.collaborateurs.length ? `\n${l.collaborateurs.join(", ")}` : ""}`),
        heures(l.heures),
        eurosPdf(l.taux),
        eurosPdf(l.montant),
      ]),
      Math.max(doc.y, yClient + 80) + 20,
    );

    // ── Totaux FIGÉS ──
    let yFin = dessinerTotaux(
      doc,
      [
        ["Total HT", eurosPdf(f.total_ht), false],
        ["TVA 20 %", eurosPdf(f.tva), false],
        ["Total TTC", eurosPdf(f.total_ttc), true],
      ],
      y,
    );

    // ── Mentions de paiement ──
    const mentions: [string, string][] = [
      ["Conditions de paiement : ", `paiement à réception, au plus tard le ${datePdf(f.date_echeance)}.`],
      ["Pénalités de retard : ", ouARenseigner(entreprise.penalitesRetard)],
      ["Indemnité forfaitaire pour frais de recouvrement : ", ouARenseigner(entreprise.indemniteRecouvrement)],
    ];
    yFin += 20;
    if (yFin + 70 > bas) {
      doc.addPage();
      yFin = doc.page.margins.top;
    }
    doc.font("Helvetica").fontSize(8.5);
    doc.text("", gauche, yFin);
    for (const [libelle, valeur] of mentions) {
      doc.fillColor(GRIS).text(pourPdf(libelle), { continued: true, width: largeur });
      doc.fillColor(valeur === A_RENSEIGNER ? ROUGE : GRIS).text(pourPdf(valeur), { width: largeur });
    }
  });
}
