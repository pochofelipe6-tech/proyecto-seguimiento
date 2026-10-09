import RutaSegura from "./ruta-segura";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export const dynamic = "force-dynamic";

export default function Home() {
  // Solo estos dos valores son públicos. Nunca enviar las claves secretas al cliente.
  const url = process.env.SUPABASE_URL || "";
  const config = {
    url: /(tu-proyecto|your-project|example)\.supabase\.co/i.test(url) ? "" : url,
    anonKey: process.env.SUPABASE_ANON_KEY || "",
  };
  const document = readFileSync(join(process.cwd(), "dist", "index.html"), "utf8");
  const body = document.match(/<body>([\s\S]*?)<\/body>/i)?.[1]
    .replace(/<script\s+src="\.\/app\.js"><\/script>/i, "") || "";
  return <RutaSegura config={config} markup={body} />;
}
