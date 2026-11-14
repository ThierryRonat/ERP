import { exigerAdmin } from "@/lib/session";
import { ModuleAVenir } from "@/composants/ModuleAVenir";

export default async function PageFinance() {
  await exigerAdmin(); // un non-admin qui tape l'adresse à la main est renvoyé à l'accueil
  return <ModuleAVenir titre="Finance" description="Factures, relances et suivi des paiements." />;
}
