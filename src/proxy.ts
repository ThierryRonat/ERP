import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// Pages accessibles sans être connecté.
const PAGES_PUBLIQUES = ["/connexion"];

/**
 * S'exécute AVANT chaque page : rafraîchit la session et REDIRIGE
 * tout visiteur non connecté vers /connexion.
 */
export async function proxy(requete: NextRequest) {
  let reponse = NextResponse.next({ request: requete });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return requete.cookies.getAll();
        },
        setAll(cookiesAEcrire, entetes) {
          for (const { name, value } of cookiesAEcrire) requete.cookies.set(name, value);
          reponse = NextResponse.next({ request: requete });
          for (const { name, value, options } of cookiesAEcrire) {
            reponse.cookies.set(name, value, options);
          }
          for (const [cle, valeur] of Object.entries(entetes ?? {})) {
            reponse.headers.set(cle, valeur);
          }
        },
      },
    },
  );

  // getClaims() vérifie la signature du jeton : on ne fait pas confiance au cookie brut.
  const { data } = await supabase.auth.getClaims();
  const estConnecte = Boolean(data?.claims?.sub);

  const chemin = requete.nextUrl.pathname;
  const estPublique = PAGES_PUBLIQUES.some((p) => chemin === p || chemin.startsWith(p + "/"));

  if (!estConnecte && !estPublique) {
    const url = requete.nextUrl.clone();
    url.pathname = "/connexion";
    url.search = chemin !== "/" ? `?suite=${encodeURIComponent(chemin)}` : "";
    return NextResponse.redirect(url);
  }

  if (estConnecte && chemin === "/connexion") {
    const url = requete.nextUrl.clone();
    url.pathname = "/";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return reponse;
}

export const config = {
  // Tout, sauf les fichiers techniques et les images.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
