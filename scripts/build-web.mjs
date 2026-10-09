import { readFileSync } from "node:fs";
import { build } from "esbuild";

const variables = {};
try {
  for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*(SUPABASE_URL|SUPABASE_ANON_KEY)\s*=\s*(.*)\s*$/);
    if (match) variables[match[1]] = match[2].replace(/^['"]|['"]$/g, "").trim();
  }
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}

const url = variables.SUPABASE_URL || "";
const publicUrl = /(tu-proyecto|your-project|example)\.supabase\.co/i.test(url) ? "" : url;
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
    "process.env.SUPABASE_ANON_KEY": JSON.stringify(publicUrl ? variables.SUPABASE_ANON_KEY || "" : ""),
  },
});
console.log("Recursos web/Android compilados. Configuración pública de Supabase:", publicUrl ? "presente" : "pendiente");
