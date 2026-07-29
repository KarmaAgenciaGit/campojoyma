import { createHmac, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";

const EXPECTED = {
  frrId: 49305,
  numero: 5052,
  invoiceNumber: "A-00748886",
  ejercicio: 25,
  regimenId: 2110,
  tipoFactura: "OT",
  base: 42341.52,
  vat: 8891.72,
  total: 51233.24,
  expenseAccount: "60200000001",
  providerAccount: "41000000017",
  technicalEntryId: 390305,
  visibleEntryNumber: "48732",
  accountingStatus: "created",
  accountingEntries: 3,
  punteos: 17,
  materialLines: 21,
};

const parseEnv = (content) =>
  Object.fromEntries(
    content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => {
        const separator = line.indexOf("=");
        const key = line.slice(0, separator).trim();
        const value = line.slice(separator + 1).trim().replace(/^"(.*)"$/, "$1");
        return [key, value];
      }),
  );

const base64Url = (value) =>
  Buffer.from(value)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");

const signJwt = (secret) => {
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = base64Url(
    JSON.stringify({
      sub: "agroiris-edge",
      iat: now,
      exp: now + 300,
      jti: randomUUID(),
    }),
  );
  const unsigned = `${header}.${payload}`;
  const signature = createHmac("sha256", secret)
    .update(unsigned)
    .digest("base64url");
  return `${unsigned}.${signature}`;
};

const asNumber = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const assertEqual = (actual, expected, label) => {
  if (actual !== expected) {
    throw new Error(`${label}: esperado ${expected}, recibido ${actual}`);
  }
};

const assertMoney = (actual, expected, label) => {
  const numeric = asNumber(actual);
  if (numeric === null || Math.abs(numeric - expected) > 0.01) {
    throw new Error(`${label}: esperado ${expected.toFixed(2)}, recibido ${actual}`);
  }
};

const unwrapSingle = (payload) => {
  if (!payload || typeof payload !== "object") return payload;
  if (Array.isArray(payload)) return payload[0] ?? null;
  if (payload.item && typeof payload.item === "object") return payload.item;
  if (payload.datos && !Array.isArray(payload.datos) && typeof payload.datos === "object") {
    return payload.datos;
  }
  if (payload.data && !Array.isArray(payload.data) && typeof payload.data === "object") {
    return payload.data;
  }
  if (Array.isArray(payload.items)) return payload.items[0] ?? null;
  return payload;
};

const unwrapList = (payload) => {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return [];
  for (const key of ["items", "data", "datos", "ctb", "punteos", "apuntes", "entries", "lines"]) {
    if (Array.isArray(payload[key])) return payload[key];
  }
  return [];
};

const main = async () => {
  const env = parseEnv(await readFile(new URL("../.env", import.meta.url), "utf8"));
  const webhookUrl = env.N8N_CAMPOJOYMA_READ_WEBHOOK_URL;
  const jwtSecret = env.N8N_CAMPOJOYMA_WEBHOOK_JWT_SECRET;
  if (!webhookUrl || !jwtSecret) {
    throw new Error("Faltan N8N_CAMPOJOYMA_READ_WEBHOOK_URL o N8N_CAMPOJOYMA_WEBHOOK_JWT_SECRET.");
  }

  const jwt = signJwt(jwtSecret);
  const apiGet = async (consulta) => {
    const url = new URL(webhookUrl);
    url.searchParams.set("consulta", consulta);
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${jwt}` },
      signal: AbortSignal.timeout(45_000),
    });
    if (!response.ok) {
      throw new Error(`${consulta}: HTTP ${response.status}`);
    }
    return response.json();
  };

  const header = unwrapSingle(await apiGet(`facturasrecibidas/${EXPECTED.frrId}`));
  assertEqual(asNumber(header.FRR_id), EXPECTED.frrId, "FRR_id");
  assertEqual(asNumber(header.FRR_numero), EXPECTED.numero, "FRR_numero");
  assertEqual(header.FRR_numerofactura, EXPECTED.invoiceNumber, "Número de factura");
  assertEqual(asNumber(header.FRR_ejercicio), EXPECTED.ejercicio, "Ejercicio ERP");
  assertEqual(asNumber(header.FRR_idregimen), EXPECTED.regimenId, "Régimen ERP");
  assertEqual(header.FRR_tipofactura, EXPECTED.tipoFactura, "Tipo de factura ERP");
  assertMoney(header.FRR_base1, EXPECTED.base, "Base imponible");
  assertMoney(header.FRR_cuota1, EXPECTED.vat, "Cuota IVA");
  assertMoney(header.FRR_totalfac, EXPECTED.total, "Total factura");
  assertEqual(String(header.FRR_ctagasto1), EXPECTED.expenseAccount, "Cuenta de gasto");
  assertEqual(String(header.FRR_idcuenta), EXPECTED.providerAccount, "Cuenta de proveedor");
  assertEqual(asNumber(header.FRR_IdAsientoNet), EXPECTED.technicalEntryId, "ID técnico del asiento");

  const ctb = unwrapList(await apiGet(`facturasrecibidas/${EXPECTED.frrId}/ctb`));
  assertEqual(ctb.length, 0, "CTB real de ONDUSPAN");

  const punteos = unwrapList(
    await apiGet(`facturasrecibidas/${EXPECTED.frrId}/punteos?include_lines=true`),
  );
  assertEqual(punteos.length, EXPECTED.punteos, "Número de albaranes MA");
  for (const punteo of punteos) {
    assertEqual(punteo.source_table, "albmaterial", "Fuente del punteo");
  }

  const materialLines = punteos.reduce((sum, punteo) => {
    if (Array.isArray(punteo.source_lines)) return sum + punteo.source_lines.length;
    return sum + (asNumber(punteo.line_count) ?? 0);
  }, 0);
  assertEqual(materialLines, EXPECTED.materialLines, "Número de líneas de material");

  const punteoTotal = punteos.reduce(
    (sum, punteo) => sum + (asNumber(punteo.Importe ?? punteo.importe) ?? 0),
    0,
  );
  assertMoney(punteoTotal, EXPECTED.base, "Suma de albaranes MA");

  const asientoPayload = await apiGet(`facturasrecibidas/${EXPECTED.frrId}/asiento`);
  const asiento = unwrapSingle(asientoPayload);
  const accounting = asiento.accounting ?? asiento;
  assertEqual(
    asNumber(accounting.technical_id ?? accounting.FRR_IdAsientoNet),
    EXPECTED.technicalEntryId,
    "ID técnico del asiento leído",
  );
  assertEqual(
    accounting.visible_number ?? accounting.numero ?? accounting.asiento_numero ?? null,
    EXPECTED.visibleEntryNumber,
    "Número visible del asiento",
  );
  assertEqual(accounting.requested, true, "Solicitud contable histórica");
  assertEqual(accounting.created, true, "Asiento verificado en el diario oficial");
  assertEqual(accounting.status, EXPECTED.accountingStatus, "Estado contable verificable");
  assertEqual(accounting.balanced, true, "Asiento Debe/Haber cuadrado");
  assertMoney(accounting.total_debit, EXPECTED.total, "Total Debe");
  assertMoney(accounting.total_credit, EXPECTED.total, "Total Haber");

  const entries = unwrapList(asientoPayload);
  assertEqual(entries.length, EXPECTED.accountingEntries, "Apuntes contables verificados");

  if (process.argv.includes("--details")) {
    const headerKeys = [
      "FRR_id",
      "FRR_numero",
      "FRR_ejercicio",
      "FRR_idproveedor",
      "FRR_idcuenta",
      "FRR_numerofactura",
      "FRR_fechafactura",
      "FRR_fechactb",
      "FRR_Idempresa",
      "FRR_idregimen",
      "FRR_tipofactura",
      "FRR_base1",
      "FRR_iva1",
      "FRR_cuota1",
      "FRR_igasto1",
      "FRR_ctagasto1",
      "FRR_totalfac",
      "FRR_IdAsientoNet",
      "FRR_Contabilizar",
      "FRR_GeneraCartera",
      "FRR_CtaCartera",
      "FRR_IdBanco",
      "FRR_IdFormaPago",
      "FechaVto",
      "ImporteVto",
      "FRR_Concepto",
      "FRR_Observaciones",
      "FRR_ObservacionesAEAT",
    ];
    console.log(JSON.stringify({
      header: Object.fromEntries(headerKeys.map((key) => [key, header[key] ?? null])),
      accounting,
      ctb_count: ctb.length,
      punteos_count: punteos.length,
      material_lines: materialLines,
    }, null, 2));
  }

  console.log(
    "OK: aceptación de lectura ONDUSPAN completada; asiento histórico verificado en el diario.",
  );
};

main().catch((error) => {
  console.error(`ERROR: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
