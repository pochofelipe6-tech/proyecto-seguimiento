import { readFileSync } from "node:fs";
import { build } from "esbuild";

const variables = {};
try {
  for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*(NEXT_PUBLIC_SUPABASE_URL|NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY|SUPABASE_URL|SUPABASE_ANON_KEY)\s*=\s*(.*)\s*$/);
    if (match) variables[match[1]] = match[2].replace(/^['"]|['"]$/g, "").trim();
  }
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}

const url = variables.NEXT_PUBLIC_SUPABASE_URL || variables.SUPABASE_URL || "";
const publicUrl = /(tu-proyecto|your-project|example)\.supabase\.co/i.test(url) ? "" : url;
const publicKey = variables.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || variables.SUPABASE_ANON_KEY || "";
await build({
  entryPoints: ["src/app-entry.js"],
  outfile: "dist/app.js",
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "chrome60",
  loader: { ".png": "dataurl" },
  define: {
    "process.env.SUPABASE_URL": JSON.stringify(publicUrl),
    "process.env.SUPABASE_ANON_KEY": JSON.stringify(publicUrl ? publicKey : ""),
  },
});
console.log("Recursos web/Android compilados. Configuración pública de Supabase:", publicUrl ? "presente" : "pendiente");
