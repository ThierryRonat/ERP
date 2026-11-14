"use client";

import { useState, useTransition } from "react";
import {
  changerRole,
  creerAcces,
  creerFicheEtRattacher,
  rattacherCompte,
  reinitialiserMotDePasse,
  revoquerAcces,
} from "@/lib/actions/utilisateurs";
import { LIBELLES_ROLES, ROLES, type Role } from "@/lib/roles";
import type { CompteAcces, FicheCollaborateur, Identifiants, ResultatAction } from "@/lib/utilisateurs";

type Proprietes = {
  fiches: FicheCollaborateur[];
  comptes: CompteAcces[];
  monId: string;
};

const bouton =
  "rounded-md border px-3 py-1.5 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50";
const boutonPrincipal = `${bouton} border-blue-700 bg-blue-700 text-white hover:bg-blue-800`;
const boutonSecondaire = `${bouton} border-slate-300 bg-white text-slate-800 hover:bg-slate-50`;
const boutonDanger = `${bouton} border-red-300 bg-white text-red-700 hover:bg-red-50`;
const liste = "rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm";

function nomComplet(f: FicheCollaborateur) {
  return [f.prenom, f.nom].filter(Boolean).join(" ");
}

function formaterDate(iso: string | null) {
  if (!iso) return "jamais connecté";
  return "dernière connexion le " + new Date(iso).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" });
}

export function EcranUtilisateurs({ fiches, comptes, monId }: Proprietes) {
  const [enCours, demarrer] = useTransition();
  const [message, setMessage] = useState<ResultatAction | null>(null);
  const [identifiants, setIdentifiants] = useState<Identifiants | null>(null);

  const compteParFiche = new Map(comptes.filter((c) => c.collaborateurId).map((c) => [c.collaborateurId!, c]));
  const comptesOrphelins = comptes.filter((c) => !c.collaborateurId);
  const fichesSansAcces = fiches.filter((f) => !compteParFiche.has(f.id));
  const emailsComptes = new Set(comptes.map((c) => c.email?.toLowerCase()));

  function executer(action: () => Promise<ResultatAction>) {
    demarrer(async () => {
      const resultat = await action();
      setMessage(resultat);
      // Un mot de passe provisoire n'est visible que jusqu'à l'action suivante.
      setIdentifiants(resultat.identifiants ?? null);
    });
  }

  return (
    <div className="space-y-8">
      {identifiants && <PanneauIdentifiants identifiants={identifiants} onFermer={() => setIdentifiants(null)} />}

      {message?.erreur && (
        <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {message.erreur}
        </p>
      )}
      {message?.succes && !message.erreur && (
        <p role="status" className="rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">
          {message.succes}
        </p>
      )}

      {/* ── Collaborateurs et état de leur accès ── */}
      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-slate-600">
            <tr>
              <th className="px-4 py-3 font-medium">Collaborateur</th>
              <th className="px-4 py-3 font-medium">Email de la fiche</th>
              <th className="px-4 py-3 font-medium">Accès</th>
              <th className="px-4 py-3 font-medium">Rôle</th>
              <th className="px-4 py-3 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {fiches.map((fiche) => {
              const compte = compteParFiche.get(fiche.id);
              return (
                <LigneCollaborateur
                  key={fiche.id + (compte?.id ?? "")}
                  fiche={fiche}
                  compte={compte}
                  estMoi={compte?.id === monId}
                  emailDejaUtilise={!compte && emailsComptes.has(fiche.email?.toLowerCase())}
                  enCours={enCours}
                  executer={executer}
                />
              );
            })}
            {fiches.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-slate-500">
                  Aucune fiche collaborateur.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* ── Comptes sans fiche (ex. le compte admin créé à l'inscription) ── */}
      {comptesOrphelins.length > 0 && (
        <div>
          <h2 className="mb-1 text-lg font-semibold">Comptes non rattachés à une fiche</h2>
          <p className="mb-3 text-sm text-slate-600">
            Ces comptes ne voient aucune donnée tant qu&apos;ils ne sont pas rattachés à une fiche collaborateur.
          </p>
          <div className="space-y-3">
            {comptesOrphelins.map((compte) => (
              <CompteOrphelin
                key={compte.id}
                compte={compte}
                estMoi={compte.id === monId}
                fichesSansAcces={fichesSansAcces}
                enCours={enCours}
                executer={executer}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function LigneCollaborateur({
  fiche,
  compte,
  estMoi,
  emailDejaUtilise,
  enCours,
  executer,
}: {
  fiche: FicheCollaborateur;
  compte?: CompteAcces;
  estMoi: boolean;
  emailDejaUtilise: boolean;
  enCours: boolean;
  executer: (a: () => Promise<ResultatAction>) => void;
}) {
  const [role, setRole] = useState<Role>(compte?.role ?? "collaborateur");

  return (
    <tr className="border-b border-slate-100 last:border-0 align-top">
      <td className="px-4 py-3">
        <div className="font-medium text-slate-900">
          {nomComplet(fiche)} {estMoi && <span className="text-xs font-normal text-blue-700">(vous)</span>}
        </div>
        {fiche.poste && <div className="text-xs text-slate-500">{fiche.poste}</div>}
      </td>
      <td className="px-4 py-3 text-slate-700">{fiche.email ?? <em className="text-slate-400">aucun</em>}</td>
      <td className="px-4 py-3">
        {compte ? (
          <>
            <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">Accès actif</span>
            <div className="mt-1 text-xs text-slate-500">{formaterDate(compte.derniereConnexion)}</div>
          </>
        ) : (
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">Aucun accès</span>
        )}
      </td>
      <td className="px-4 py-3">
        <select
          aria-label={`Rôle de ${nomComplet(fiche)}`}
          className={liste}
          value={role}
          disabled={estMoi || enCours}
          onChange={(e) => setRole(e.target.value as Role)}
        >
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {LIBELLES_ROLES[r]}
            </option>
          ))}
        </select>
        {estMoi && <div className="mt-1 text-xs text-slate-500">Votre propre rôle n&apos;est pas modifiable.</div>}
      </td>
      <td className="px-4 py-3">
        <div className="flex flex-wrap gap-2">
          {!compte && (
            <>
              <button
                className={boutonPrincipal}
                disabled={enCours || !fiche.email || emailDejaUtilise}
                onClick={() => executer(() => creerAcces(fiche.id, role))}
              >
                Créer l&apos;accès
              </button>
              {!fiche.email && <span className="text-xs text-slate-500">Fiche sans email.</span>}
              {emailDejaUtilise && (
                <span className="text-xs text-slate-500">Un compte existe avec cet email : rattachez-le plus bas.</span>
              )}
            </>
          )}
          {compte && !estMoi && (
            <>
              <button
                className={boutonSecondaire}
                disabled={enCours || role === compte.role}
                onClick={() => executer(() => changerRole(compte.id, role))}
              >
                Changer le rôle
              </button>
              <button
                className={boutonSecondaire}
                disabled={enCours}
                onClick={() => executer(() => reinitialiserMotDePasse(compte.id))}
              >
                Réinitialiser le mot de passe
              </button>
              <button
                className={boutonDanger}
                disabled={enCours}
                onClick={() => {
                  if (
                    window.confirm(
                      `Révoquer l'accès de ${nomComplet(fiche)} ?\n\nSon compte de connexion sera supprimé. Sa fiche collaborateur est conservée.`,
                    )
                  )
                    executer(() => revoquerAcces(compte.id));
                }}
              >
                Révoquer l&apos;accès
              </button>
            </>
          )}
          {compte && estMoi && (
            <button
              className={boutonSecondaire}
              disabled={enCours}
              onClick={() => executer(() => reinitialiserMotDePasse(compte.id))}
            >
              Réinitialiser mon mot de passe
            </button>
          )}
        </div>
      </td>
    </tr>
  );
}

function CompteOrphelin({
  compte,
  estMoi,
  fichesSansAcces,
  enCours,
  executer,
}: {
  compte: CompteAcces;
  estMoi: boolean;
  fichesSansAcces: FicheCollaborateur[];
  enCours: boolean;
  executer: (a: () => Promise<ResultatAction>) => void;
}) {
  const ficheMemeEmail = fichesSansAcces.find((f) => f.email?.toLowerCase() === compte.email?.toLowerCase());
  const [ficheChoisie, setFicheChoisie] = useState(ficheMemeEmail?.id ?? "");
  const [creationOuverte, setCreationOuverte] = useState(false);

  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 p-4">
      <div className="mb-3 text-sm">
        <span className="font-medium text-slate-900">{compte.email}</span>{" "}
        {estMoi && <span className="text-xs text-blue-700">(vous)</span>} — {LIBELLES_ROLES[compte.role]}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <select
          aria-label={`Fiche à rattacher à ${compte.email}`}
          className={liste}
          value={ficheChoisie}
          disabled={enCours}
          onChange={(e) => setFicheChoisie(e.target.value)}
        >
          <option value="">— Choisir une fiche sans accès —</option>
          {fichesSansAcces.map((f) => (
            <option key={f.id} value={f.id}>
              {nomComplet(f)} {f.email ? `(${f.email})` : ""}
            </option>
          ))}
        </select>
        <button
          className={boutonPrincipal}
          disabled={enCours || !ficheChoisie}
          onClick={() => executer(() => rattacherCompte(compte.id, ficheChoisie))}
        >
          Rattacher
        </button>
        <span className="text-sm text-slate-500">ou</span>
        <button className={boutonSecondaire} disabled={enCours} onClick={() => setCreationOuverte((o) => !o)}>
          Créer une fiche pour ce compte
        </button>
      </div>

      {creationOuverte && (
        <form
          className="mt-4 grid gap-3 sm:grid-cols-2"
          action={(donnees) => executer(() => creerFicheEtRattacher(compte.id, donnees))}
        >
          <Champ libelle="Prénom" nom="prenom" requis />
          <Champ libelle="Nom" nom="nom" requis />
          <Champ libelle="Poste" nom="poste" />
          <Champ libelle="Taux horaire (€) — 0 si non applicable" nom="taux_horaire" type="number" valeur="0" requis />
          <div className="sm:col-span-2">
            <p className="mb-2 text-xs text-slate-600">Email de la fiche : {compte.email}</p>
            <button type="submit" className={boutonPrincipal} disabled={enCours}>
              Créer la fiche et rattacher
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

function Champ({
  libelle,
  nom,
  type = "text",
  valeur,
  requis = false,
}: {
  libelle: string;
  nom: string;
  type?: string;
  valeur?: string;
  requis?: boolean;
}) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block font-medium text-slate-700">{libelle}</span>
      <input
        name={nom}
        type={type}
        defaultValue={valeur}
        required={requis}
        min={type === "number" ? 0 : undefined}
        step={type === "number" ? "0.01" : undefined}
        className="w-full rounded-md border border-slate-300 bg-white px-3 py-1.5"
      />
    </label>
  );
}

function PanneauIdentifiants({ identifiants, onFermer }: { identifiants: Identifiants; onFermer: () => void }) {
  const [copie, setCopie] = useState(false);
  const adresse = typeof window !== "undefined" ? `${window.location.origin}/connexion` : "";
  const texte = `Adresse : ${adresse}\nEmail : ${identifiants.email}\nMot de passe provisoire : ${identifiants.motDePasse}`;

  return (
    <div role="dialog" aria-label="Identifiants provisoires" className="rounded-lg border-2 border-blue-600 bg-blue-50 p-5">
      <h2 className="mb-1 text-lg font-semibold text-blue-900">Mot de passe provisoire</h2>
      <p className="mb-4 text-sm text-blue-900">
        Il ne sera <strong>plus jamais affiché</strong>. Copiez-le maintenant et transmettez-le à la personne.
      </p>
      <dl className="mb-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="text-slate-600">Email</dt>
        <dd className="font-mono" data-testid="identifiant-email">{identifiants.email}</dd>
        <dt className="text-slate-600">Mot de passe</dt>
        <dd className="font-mono text-base font-semibold" data-testid="identifiant-mot-de-passe">
          {identifiants.motDePasse}
        </dd>
      </dl>
      <div className="flex gap-2">
        <button
          className={boutonPrincipal}
          onClick={async () => {
            await navigator.clipboard.writeText(texte);
            setCopie(true);
          }}
        >
          {copie ? "✓ Copié" : "Copier les identifiants"}
        </button>
        <button className={boutonSecondaire} onClick={onFermer}>
          J&apos;ai copié, masquer
        </button>
      </div>
    </div>
  );
}
