"use client";

import { useState, useTransition } from "react";
import { envoyerFacture } from "@/lib/actions/finance";
import type { EtatFormulaire } from "@/lib/formulaires";

/** Bouton « Envoyer » : expédie la facture au contact du client, PDF en pièce jointe. */
export function BoutonEnvoyer({
  factureId,
  numero,
  emailClient,
  destinataireTest,
  bloque,
}: {
  factureId: string;
  numero: string;
  emailClient: string | null;
  destinataireTest: string | null;
  bloque: string | null; // raison pour laquelle l'envoi est impossible (clé absente, écart, pas d'email)
}) {
  const [enCours, demarrer] = useTransition();
  const [resultat, setResultat] = useState<EtatFormulaire | null>(null);
  const destinataire = destinataireTest ?? emailClient;

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={enCours || Boolean(bloque)}
          className="rounded-md bg-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-50"
          onClick={() => {
            if (!window.confirm(`Envoyer ${numero} à ${destinataire}, PDF en pièce jointe ?`)) return;
            setResultat(null);
            demarrer(async () => setResultat(await envoyerFacture(factureId)));
          }}
        >
          {enCours ? "Envoi en cours…" : "✉ Envoyer au client"}
        </button>
        <span className="text-sm text-slate-600">
          Destinataire : <strong>{emailClient ?? "aucun email de contact"}</strong>
        </span>
      </div>
      {destinataireTest && (
        <p data-testid="mode-test-email" className="mt-2 text-xs text-amber-800">
          Mode test : l&apos;email partira vers <strong>{destinataireTest}</strong> (jamais au client) et la facture ne
          sera pas marquée « envoyée ».
        </p>
      )}
      {bloque && (
        <p className="mt-2 text-xs text-red-700" role="alert">
          Envoi impossible : {bloque}
        </p>
      )}
      {resultat?.erreur && (
        <p role="alert" className="mt-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {resultat.erreur}
        </p>
      )}
      {resultat?.succes && (
        <p
          role="status"
          className="mt-2 rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800"
        >
          {resultat.succes}
        </p>
      )}
    </div>
  );
}

/** Version compacte pour une ligne du tableau des factures (même action, mêmes contrôles). */
export function BoutonEnvoyerLigne({
  factureId,
  numero,
  emailClient,
  destinataireTest,
  bloque,
  dateEnvoi,
}: {
  factureId: string;
  numero: string;
  emailClient: string | null;
  destinataireTest: string | null;
  bloque: string | null;
  dateEnvoi: string | null; // AAAA-MM-JJ si déjà envoyée
}) {
  const [enCours, demarrer] = useTransition();
  const [resultat, setResultat] = useState<EtatFormulaire | null>(null);
  const destinataire = destinataireTest ?? emailClient;

  return (
    <div className="min-w-32">
      <button
        type="button"
        disabled={enCours || Boolean(bloque)}
        aria-label={`Envoyer ${numero} par email`}
        title={
          bloque
            ? `Envoi impossible : ${bloque}`
            : destinataireTest
              ? `Mode test : envoi vers ${destinataireTest} (le client ne reçoit rien)`
              : `Envoyer à ${emailClient}`
        }
        className="whitespace-nowrap rounded-md bg-blue-700 px-2 py-1 text-xs font-medium text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-50"
        onClick={() => {
          if (!window.confirm(`Envoyer ${numero} à ${destinataire}, PDF en pièce jointe ?`)) return;
          setResultat(null);
          demarrer(async () => setResultat(await envoyerFacture(factureId)));
        }}
      >
        {enCours ? "Envoi…" : "✉ Envoyer"}
      </button>
      {destinataireTest && !bloque && (
        <span className="ml-1 text-[10px] font-medium uppercase text-amber-700">test</span>
      )}
      {dateEnvoi && (
        <p className="mt-1 text-xs text-slate-500">Envoyée le {dateEnvoi.split("-").reverse().join("/")}</p>
      )}
      {bloque && <p className="mt-1 max-w-48 text-xs text-red-700">{bloque}</p>}
      {resultat?.erreur && (
        <p role="alert" className="mt-1 max-w-56 text-xs text-red-700">
          {resultat.erreur}
        </p>
      )}
      {resultat?.succes && (
        <p role="status" className="mt-1 max-w-56 text-xs text-green-700">
          {resultat.succes}
        </p>
      )}
    </div>
  );
}
