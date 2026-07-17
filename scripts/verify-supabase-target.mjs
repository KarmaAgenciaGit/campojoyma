import { readFile } from "node:fs/promises";

const EXPECTED_PROJECT_REF = "adbprpemmbspntbttziz";

const parseEnv = (content) =>
  Object.fromEntries(
    content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => {
        const separator = line.indexOf("=");
        return [
          line.slice(0, separator).trim(),
          line.slice(separator + 1).trim().replace(/^"(.*)"$/, "$1"),
        ];
      }),
  );

const decodeJwtPayload = (jwt) => {
  const [, payload] = String(jwt ?? "").split(".");
  if (!payload) return {};
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
};

const assertRef = (actual, source) => {
  if (actual !== EXPECTED_PROJECT_REF) {
    throw new Error(
      `${source} apunta a ${actual || "(vacío)"}; se esperaba ${EXPECTED_PROJECT_REF}.`,
    );
  }
};

const main = async () => {
  const env = parseEnv(await readFile(new URL("../.env", import.meta.url), "utf8"));
  const linkedRef = (
    await readFile(new URL("../supabase/.temp/project-ref", import.meta.url), "utf8")
  ).trim();
  const configuredRef = env.VITE_SUPABASE_PROJECT_ID;
  const urlRef = new URL(env.VITE_SUPABASE_URL).hostname.split(".")[0];
  const servicePayload = env.SUPABASE_SERVICE_ROLE_KEY
    ? decodeJwtPayload(env.SUPABASE_SERVICE_ROLE_KEY)
    : {};

  assertRef(linkedRef, "supabase/.temp/project-ref");
  assertRef(configuredRef, "VITE_SUPABASE_PROJECT_ID");
  assertRef(urlRef, "VITE_SUPABASE_URL");
  if (servicePayload.ref) assertRef(servicePayload.ref, "SUPABASE_SERVICE_ROLE_KEY");
  if (servicePayload.role && servicePayload.role !== "service_role") {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY no contiene el rol service_role.");
  }

  const apiKey = env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!apiKey) throw new Error("Falta VITE_SUPABASE_PUBLISHABLE_KEY.");
  const headers = { apikey: apiKey };
  if (apiKey.split(".").length === 3) headers.Authorization = `Bearer ${apiKey}`;

  const requiredTables = [
    "facturasrecibidas",
    "facturasrecibidas_ctb",
    "facturasrecibidas_punteos",
  ];
  const missing = [];
  for (const table of requiredTables) {
    const url = new URL(`${env.VITE_SUPABASE_URL}/rest/v1/${table}`);
    url.searchParams.set("select", "*");
    url.searchParams.set("limit", "0");
    const response = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) missing.push(`${table} (HTTP ${response.status})`);
  }
  if (missing.length > 0) {
    throw new Error(`La Data API no expone: ${missing.join(", ")}.`);
  }

  console.log(`OK: destino Supabase verificado (${EXPECTED_PROJECT_REF}).`);
};

main().catch((error) => {
  console.error(`ERROR: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
