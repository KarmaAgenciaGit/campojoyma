import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  FACTURAS_RECIBIDAS_CONTRACT_VERSION,
  applyGastosToFrr,
  buildERPContractV2,
  isAllowedERPConsulta,
  normalizeAccountingReadback,
  normalizeConfidence,
  normalizeFrcPayload,
  normalizeFrrPayload,
  normalizePunteoPayload,
  requireAgentToken,
  sanitizeAuditValue,
  sha256Base64,
  sha256Text,
  toERPCtbPayload,
  toERPFacturaPayload,
  validateAccountingReadback,
} from "./facturas-recibidas-erp.ts";

const requestWithToken = (token?: string, header = "x-agent-token") =>
  new Request("https://edge.invalid/factura-recibida-ingest", {
    headers: token ? { [header]: token } : undefined,
  });

const responsePayload = (response: Response) => response.json() as Promise<{ error?: string }>;

Deno.test("normaliza la confianza de porcentaje a fraccion y rechaza valores imposibles", () => {
  assertEquals(normalizeConfidence(0.85), 0.85);
  assertEquals(normalizeConfidence(85), 0.85);
  assertEquals(normalizeConfidence("100"), 1);
  assertEquals(normalizeConfidence(101), null);
  assertEquals(normalizeConfidence(-1), null);
});

Deno.test("la evidencia de auditoria elimina respuestas y secretos antes de persistir", () => {
  assertEquals(
    sanitizeAuditValue({
      source: "api:/acreedores",
      raw: { nif: "B123" },
      payload: { rows: [1, 2] },
      token: "secreto",
      nested: { pdf_base64: "JVBERi0", count: 1 },
      attempts: [{ path: "/acreedores", ok: true }],
    }),
    {
      source: "api:/acreedores",
      nested: { count: 1 },
      attempts: [{ path: "/acreedores", ok: true }],
    },
  );
});

Deno.test("token de ingesta ausente devuelve 401 sin consultar el backend", async () => {
  let verifierCalls = 0;
  const result = await requireAgentToken(requestWithToken(), {
    getConfiguredToken: () => null,
    verifyTokenHash: async () => {
      verifierCalls += 1;
      return true;
    },
  });

  assert(!result.ok);
  assertEquals(result.response.status, 401);
  assertEquals(verifierCalls, 0);
});

Deno.test("Edge secret tiene prioridad y no cae al verificador de hashes", async () => {
  let verifierCalls = 0;
  const accepted = await requireAgentToken(requestWithToken("token-prueba-configurado"), {
    getConfiguredToken: () => "token-prueba-configurado",
    verifyTokenHash: async () => {
      verifierCalls += 1;
      return true;
    },
  });
  const rejected = await requireAgentToken(requestWithToken("token-prueba-distinto"), {
    getConfiguredToken: () => "token-prueba-configurado",
    verifyTokenHash: async () => {
      verifierCalls += 1;
      return true;
    },
  });

  assert(accepted.ok);
  assert(!rejected.ok);
  assertEquals(rejected.response.status, 401);
  assertEquals(verifierCalls, 0);
});

Deno.test("fallback envía solo SHA-256 al verificador inyectado", async () => {
  const captured = { hash: "" };
  const result = await requireAgentToken(requestWithToken("token-prueba-fallback", "authorization"), {
    getConfiguredToken: () => null,
    verifyTokenHash: async (tokenHash) => {
      captured.hash = tokenHash;
      return true;
    },
  });

  assert(result.ok);
  assertEquals(captured.hash, await sha256Text("token-prueba-fallback"));
  assertEquals(captured.hash.length, 64);
});

Deno.test("hash no reconocido devuelve 401", async () => {
  const result = await requireAgentToken(requestWithToken("token-prueba-no-valido"), {
    getConfiguredToken: () => null,
    verifyTokenHash: async () => false,
  });

  assert(!result.ok);
  assertEquals(result.response.status, 401);
  assertEquals((await responsePayload(result.response)).error, "Unauthorized");
});

Deno.test("error del backend de hashes falla cerrado con 500", async () => {
  const result = await requireAgentToken(requestWithToken("token-prueba-backend"), {
    getConfiguredToken: () => null,
    verifyTokenHash: async () => {
      throw new Error("backend no disponible");
    },
  });

  assert(!result.ok);
  assertEquals(result.response.status, 500);
  assertEquals(
    (await responsePayload(result.response)).error,
    "No se pudo verificar el token de ingesta.",
  );
});

Deno.test("SHA-256 se calcula sobre los bytes decodificados, no sobre el texto base64", async () => {
  const helloBase64 = btoa("hello");
  assertEquals(
    await sha256Base64(helloBase64),
    "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
  );
});

Deno.test("normaliza cinco tramos de IVA y exactamente cuatro gastos", () => {
  const frr = applyGastosToFrr(
    normalizeFrrPayload({
      FRR_base1: 100,
      FRR_iva1: 21,
      FRR_cuota1: 21,
      FRR_base2: 50,
      FRR_iva2: 10,
      FRR_cuota2: 5,
      FRR_base3: 25,
      FRR_iva3: 4,
      FRR_cuota3: 1,
      FRR_base4: 10,
      FRR_iva4: 5,
      FRR_cuota4: 0.5,
      FRR_base5: 8,
      FRR_iva5: 0,
      FRR_cuota5: 0,
    }),
    [
      { importe: 100, cuenta: "60200000001" },
      { importe: 50, cuenta: "60200000002" },
      { importe: 25, cuenta: "60200000003" },
      { importe: 18, cuenta: "60200000004" },
      { importe: 999, cuenta: "60200000005" },
    ],
  );

  assertEquals(frr.FRR_base5, 8);
  assertEquals(frr.FRR_iva5, 0);
  assertEquals(frr.FRR_ctagasto4, "60200000004");
  assertEquals(frr.FRR_igasto4, 18);
  assertEquals(frr.FRR_ctagasto5, undefined);
});

Deno.test("conserva las cuatro dimensiones analiticas FRC", () => {
  const frc = normalizeFrcPayload({
    FRC_Importe: 42_341.52,
    FRC_Cuenta: "60200000001",
    FRC_IdActividad: 11,
    FRC_Idseccion: 12,
    FRC_Iddepartamento: 13,
    FRC_Idsubdepartamento: 14,
  }, 1);

  assertEquals(frc.FRC_IdActividad, 11);
  assertEquals(frc.FRC_Idseccion, 12);
  assertEquals(frc.FRC_Iddepartamento, 13);
  assertEquals(frc.FRC_Idsubdepartamento, 14);
});

Deno.test("normaliza albmaterial con claves estables y lineas de solo lectura", () => {
  const punteo = normalizePunteoPayload({
    source_table: "albmaterial",
    AMA_id: 49305,
    Importe: "42.341,52",
    lines: [{ id: 1 }, { id: 2 }],
  }, 1);

  assertEquals(punteo.source_table, "albmaterial");
  assertEquals(punteo.source_id, 49305);
  assertEquals(punteo.Origen, "MA");
  assertEquals(punteo.line_count, 2);
  assertEquals(punteo.source_lines, [{ id: 1 }, { id: 2 }]);
});

Deno.test("construye el contrato v2 estricto sin campos de compatibilidad v1", () => {
  const payload = buildERPContractV2({
    requestId: "11111111-1111-4111-8111-111111111111",
    dryRun: true,
    cabecera: { FRR_numerofactura: "A-1" },
    ctb: [],
    punteos: [],
  });

  assertEquals(payload.contract_version, FACTURAS_RECIBIDAS_CONTRACT_VERSION);
  assertEquals(payload.dry_run, true);
  assertEquals(payload.cabecera, { FRR_numerofactura: "A-1" });
  assertEquals("factura" in payload, false);
  assertEquals("operation" in payload, false);
});

Deno.test("excluye IDs y campos de log generados por el ERP del payload de alta", () => {
  const cabecera = toERPFacturaPayload({
    FRR_id: 49305,
    FRR_numero: 5052,
    FRR_IdUsuarioLog: 7,
    FRR_FechaLog: "2026-07-20",
    FRR_HoraLog: "12:00:00",
    FRR_IdAsientoNet: 390305,
    FRR_IdfacturaRec: 123,
    FRR_numerofactura: "E2E-20260720-50CA89",
    FRR_Contabilizar: "N",
  });
  const ctb = toERPCtbPayload({
    FRC_id: 99,
    FRC_idfacturarecibida: 49305,
    FRC_IdUsuarioLog: 7,
    FRC_FechaLog: "2026-07-20",
    FRC_HoraLog: "12:00:00",
    FRC_Cuenta: "60000000000",
    FRC_Importe: 1,
  }, 1);

  assertEquals(cabecera.FRR_numerofactura, "E2E-20260720-50CA89");
  assertEquals(cabecera.FRR_Contabilizar, "N");
  for (const key of [
    "FRR_id",
    "FRR_numero",
    "FRR_IdUsuarioLog",
    "FRR_FechaLog",
    "FRR_HoraLog",
    "FRR_IdAsientoNet",
    "FRR_IdfacturaRec",
  ]) {
    assertEquals(key in cabecera, false);
  }

  assertEquals(ctb.FRC_Cuenta, "60000000000");
  assertEquals(ctb.FRC_Importe, 1);
  for (const key of [
    "FRC_id",
    "FRC_idfacturarecibida",
    "FRC_IdUsuarioLog",
    "FRC_FechaLog",
    "FRC_HoraLog",
  ]) {
    assertEquals(key in ctb, false);
  }
});

Deno.test("desenvuelve /asiento v2 y exige Debe/Haber cuadrado", () => {
  const accounting = normalizeAccountingReadback({
    factura_id: 49305,
    accounting: {
      status: "created",
      technical_id: 390305,
      visible_number: "48732",
    },
    entries: [
      { cuenta: "60200000001", debe: 42_341.52, haber: 0 },
      { cuenta: "47200000000", debe: 8_891.72, haber: 0 },
      { cuenta: "41000000017", debe: 0, haber: 51_233.24 },
    ],
  });
  const validation = validateAccountingReadback(accounting);

  assertEquals(accounting.lines instanceof Array, true);
  assertEquals(validation.technical_id, 390305);
  assertEquals(validation.visible_number, "48732");
  assertEquals(validation.total_debit, 51_233.24);
  assertEquals(validation.total_credit, 51_233.24);
  assert(validation.ok);
});

Deno.test("allowlist ERP acepta solo paths y query keys de lectura documentados", () => {
  const allowed = [
    "acreedores?nif=B04243655&limit=10",
    "acreedores?nombre=ONDUSPAN&limit=10",
    "cuentas-contables?q=41000000017&limit=100",
    "facturasrecibidas?numero_factura=A-00748886&limit=20",
    "facturasrecibidas/buscar?empresa_id=1&ejercicio=26&proveedor_id=17&numero_factura=A-00748886",
    "facturasrecibidas/49305/punteos?include_lines=true&limit=100",
    "facturasrecibidas/49305/asiento",
    "albaranes-gastos/punteables?empresa_id=1&proveedor_id=17&solo_pendientes=true&source_table=albmaterial&include_lines=true",
  ];
  for (const consulta of allowed) assert(isAllowedERPConsulta(consulta), consulta);

  const denied = [
    "https://attacker.invalid/facturasrecibidas",
    "../facturasrecibidas",
    "facturasrecibidas/49305/delete",
    "facturasrecibidas?redirect=https://attacker.invalid",
    "facturasrecibidas/49305/asiento?include_lines=true",
    "albaranes-gastos/punteables?sql=drop",
  ];
  for (const consulta of denied) assert(!isAllowedERPConsulta(consulta), consulta);
});
