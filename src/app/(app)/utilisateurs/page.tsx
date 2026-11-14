import { exigerAdmin } from "@/lib/session";
import { ModuleAVenir } from "@/composants/ModuleAVenir";

export default async function PageUtilisateurs() {
  await exigerAdmin();
  return <ModuleAVenir titre="Utilisateurs" description="Accès des collaborateurs à l'application (étape 4)." />;
}
