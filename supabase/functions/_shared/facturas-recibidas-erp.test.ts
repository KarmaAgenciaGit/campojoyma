import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  ERPWriterRelationsMatchSnapshot,
  FACTURAS_RECIBIDAS_CONTRACT_VERSION,
  applyFacturaERPDeterministicDefaults,
  applyGastosToFrr,
  buildFacturaERPExerciseLookupConsulta,
  buildFacturaERPExactMAPunteoConsulta,
  buildFacturaERPRegimenSuggestionConsulta,
  buildERPDuplicateConsulta,
  buildERPContractV2,
  confirmFacturaProveedorTipoFromERP,
  extractOperationalERPAvailabilityWarnings,
  forceFacturaERPAccountingDisabled,
  getERPReadAuthorizedRoutes,
  getERPProviderPreflightIssues,
  getFacturaERPDocumentedReferenceIssues,
  getFacturaProveedorTipoFromMatchEvidence,
  getFacturaActiveIvaSignature,
  getFacturaSyncEntryDecision,
  getSelectedPunteoPreflightIssues,
  getValidationErrorsForFactura,
  hasBlockingERPValidationErrors,
  isRouteSetAuthorized,
  isFacturaERPReadOnlyReference,
  isEligibleERPCommitAttempt,
  isAllowedERPConsulta,
  loadAndResolveFacturaERPAccountingRules,
  mergeValidationIssues,
  normalizeAccountingReadback,
  normalizeConfidence,
  normalizeERPDuplicateCandidates,
  normalizeFrcPayload,
  normalizeFrrPayload,
  normalizePunteoPayload,
  parseERPArrayEnvelope,
  parseERPProviderDetailResponse,
  prepareFacturaExtractionPersistence,
  requestHasServiceRoleCredential,
  resolveFacturaIngestAuthority,
  resolveFacturaERPAccountingRules,
  resolveFacturaERPExerciseFromExactInvoice,
  resolveFacturaERPRegimenFromHistory,
  resolveFacturaProveedorTipo,
  requireAgentToken,
  sanitizeAuditValue,
  sanitizeUntrustedFacturaAccountingFields,
  sha256Base64,
  sha256Text,
  syncFacturaERPAccountingMatchEvidence,
  toERPCtbPayload,
  toERPFacturaPayload,
  toERPSelectedPunteosPayload,
  upstreamResult,
  validateAccountingReadback,
  validateERPDuplicateSearchResponse,
  validateERPReadbackAgainstWrite,
  validateERPWriteRequestV2,
  validateERPWriteResponseV2,
  verifyFacturaERPExactMAPunteos,
} from "./facturas-recibidas-erp.ts";

const requestWithToken = (token?: string, header = "x-agent-token") =>
  new Request("https://edge.invalid/factura-recibida-ingest", {
    headers: token ? { [header]: token } : undefined,
  });

const responsePayload = (response: Response) => response.json() as Promise<{ error?: string }>;

Deno.test("lectura ERP comparte acreedores sin abrir facturas entre modulos", () => {
  const acreedoresRoutes = getERPReadAuthorizedRoutes("acreedores/17");
  const facturasRoutes = getERPReadAuthorizedRoutes("facturasrecibidas/49305/asiento");
  assertEquals(isRouteSetAuthorized("user", ["/pedidos"], acreedoresRoutes), true);
  assertEquals(isRouteSetAuthorized("user", ["/cambios"], acreedoresRoutes), true);
  assertEquals(isRouteSetAuthorized("user", ["/pedidos"], facturasRoutes), false);
  assertEquals(isRouteSetAuthorized("user", ["/admin"], acreedoresRoutes), false);
  assertEquals(isRouteSetAuthorized("admin", [], facturasRoutes), true);
  assertEquals(facturasRoutes, ["/facturas-recibidas"]);
});

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

Deno.test("ingesta normal rechaza inyeccion contable aunque se falsifique source ERP", async () => {
  const trustedImportSignal = await requestHasServiceRoleCredential(
    new Request("https://edge.invalid", { headers: { apikey: "credencial-falsa" } }),
    () => "service-role-real",
  );
  const result = resolveFacturaIngestAuthority({
    frr: {
      FRR_id: 49305,
      FRR_numero: 5052,
      FRR_IdAsientoNet: 390305,
      FRR_IdfacturaRec: 123,
      remote_frr_id: 49305,
      is_readonly_reference: true,
      source_kind: "erp_reference",
      sync_status: "sent",
      estado: "enviada",
      accounting_status: "created",
      accounting_visible_number: "48732",
      accounting_date: "2099-12-31",
      FRR_ejercicio: 99,
      FRR_tipofactura: "XX",
      FRR_idregimen: 9999,
      FRR_fechactb: "2099-12-31",
      FechaVto: "2099-12-31",
      ImporteVto: 999,
      FRR_FechaVto1: "2099-12-31",
      FRR_FechaVto2: "2099-12-31",
      FRR_FechaVto3: "2099-12-31",
      FRR_ImporteVto1: 333,
      FRR_ImporteVto2: 333,
      FRR_ImporteVto3: 333,
      FRR_igasto1: 999,
      FRR_igasto2: 999,
      FRR_igasto3: 999,
      FRR_igasto4: 999,
      FRR_ctagasto1: "69999999999",
      FRR_ctagasto2: "69999999999",
      FRR_ctagasto3: "69999999999",
      FRR_ctagasto4: "69999999999",
      FRR_Contabilizar: "S",
      FRR_numerofactura: "INJECTED",
    },
    source: "apiCampojoyma-read-sample",
    remoteFrrId: 49305,
    trustedImportSignal,
    ctb: [{ FRC_id: 1, FRC_Cuenta: "69999999999", FRC_Importe: 999 }],
    punteos: [{ S: true, source_table: "albmaterial", source_id: 88 }],
  });

  assertEquals(result.isERPReference, false);
  assertEquals(result.remoteFrrId, null);
  assertEquals(result.frr.FRR_numerofactura, "INJECTED");
  assertEquals(result.frr.FRR_Contabilizar, undefined);
  assertEquals(result.ctb, []);
  assertEquals(result.punteos, [{ S: false, source_table: "albmaterial", source_id: 88 }]);
  for (const field of [
    "FRR_id",
    "FRR_numero",
    "FRR_IdAsientoNet",
    "FRR_IdfacturaRec",
    "remote_frr_id",
    "is_readonly_reference",
    "source_kind",
    "sync_status",
    "estado",
    "accounting_status",
    "accounting_visible_number",
    "accounting_date",
    "FRR_ejercicio",
    "FRR_tipofactura",
    "FRR_idregimen",
    "FRR_fechactb",
    "FechaVto",
    "ImporteVto",
    "FRR_FechaVto1",
    "FRR_FechaVto2",
    "FRR_FechaVto3",
    "FRR_ImporteVto1",
    "FRR_ImporteVto2",
    "FRR_ImporteVto3",
    "FRR_igasto1",
    "FRR_igasto2",
    "FRR_igasto3",
    "FRR_igasto4",
    "FRR_ctagasto1",
    "FRR_ctagasto2",
    "FRR_ctagasto3",
    "FRR_ctagasto4",
    "FRR_Concepto",
    "FRR_ObservacionesAEAT",
    "FRR_CuotaNoDeducible",
    "FRR_Contabilizar",
  ]) {
    assertEquals(field in result.frr, false, field);
  }
});

Deno.test("el writer fuerza las facturas nuevas a no contabilizar", () => {
  assertEquals(
    forceFacturaERPAccountingDisabled({
      FRR_numerofactura: "TEST-CONTABILIZAR-N",
      FRR_Contabilizar: "S",
    }),
    {
      FRR_numerofactura: "TEST-CONTABILIZAR-N",
      FRR_Contabilizar: "N",
    },
  );
});

Deno.test("defaults Edge materializan gasto, concepto y ceros solo desde regla aprobada", () => {
  const sanitized = sanitizeUntrustedFacturaAccountingFields({
    FRR_Idempresa: 1,
    FRR_idproveedor: 17,
    FRR_idcuenta: "41000000017",
    FRR_base1: 100,
    FRR_iva1: 21,
    FRR_cuota1: 21,
    FRR_base2: 50,
    FRR_iva2: 10,
    FRR_cuota2: 5,
    FRR_base3: 0,
    FRR_iva3: 0,
    FRR_cuota3: 0,
    FRR_baseret: null,
    FRR_ret: null,
    FRR_cuotaret: null,
    FRR_CuotaNoDeducible: 999,
    FRR_ctagasto1: "69999999999",
    FRR_igasto1: 999,
    FRR_Concepto: "INYECCION",
    FRR_ObservacionesAEAT: "INYECCION",
    FRR_Contabilizar: "N",
  });
  const resolution = applyFacturaERPDeterministicDefaults(
    sanitized,
    [{
      empresa_id: 1,
      proveedor_id: null,
      cuenta_gasto_default: "60200000001",
      concepto_template: "FRA. {proveedor}",
      contabilizar_default: "S",
      activo: true,
    }],
    {
      providerType: "acreedor",
      providerName: "ONDUSPAN, S.A.",
    },
  );

  assertEquals(resolution.issues, []);
  assertEquals(resolution.factura.FRR_ctagasto1, "60200000001");
  assertEquals(resolution.factura.FRR_igasto1, 150);
  assertEquals(resolution.factura.FRR_Concepto, "FRA. ONDUSPAN, S.A.");
  assertEquals(
    resolution.factura.FRR_ObservacionesAEAT,
    "FRA. ONDUSPAN, S.A.",
  );
  assertEquals(resolution.factura.FRR_Contabilizar, "S");
  assertEquals(resolution.factura.FRR_baseret, 0);
  assertEquals(resolution.factura.FRR_ret, 0);
  assertEquals(resolution.factura.FRR_cuotaret, 0);
  assertEquals(resolution.factura.FRR_CuotaNoDeducible, 0);
  assertEquals(resolution.factura.FRR_base3, 0);
  assertEquals(resolution.factura.FRR_iva3, 0);
  assertEquals(resolution.factura.FRR_cuota3, 0);
  assertEquals(resolution.factura.FRR_base4, 0);
  assertEquals(resolution.factura.FRR_iva4, 0);
  assertEquals(resolution.factura.FRR_cuota4, 0);
});

Deno.test("un tramo IVA activo incompleto queda para revision y no inventa ceros", () => {
  const resolution = applyFacturaERPDeterministicDefaults({
    FRR_base1: 100,
    FRR_iva1: null,
    FRR_cuota1: null,
  }, []);

  assertEquals(resolution.factura.FRR_base1, 100);
  assertEquals(resolution.factura.FRR_iva1, null);
  assertEquals(resolution.factura.FRR_cuota1, null);
  assertEquals(
    resolution.issues.map((issue) => issue.field),
    ["FRR_iva1", "FRR_cuota1"],
  );
  assert(resolution.issues.every((issue) => issue.severity === "error"));
});

Deno.test("un tipo IVA no cero mantiene activo el tramo aunque falten base y cuota", () => {
  const resolution = applyFacturaERPDeterministicDefaults({
    FRR_base1: null,
    FRR_iva1: 21,
    FRR_cuota1: null,
  }, []);

  assertEquals(resolution.factura.FRR_base1, null);
  assertEquals(resolution.factura.FRR_iva1, 21);
  assertEquals(resolution.factura.FRR_cuota1, null);
  assertEquals(
    resolution.issues.map((issue) => issue.field),
    ["FRR_base1", "FRR_cuota1"],
  );
  assert(resolution.issues.every((issue) => issue.severity === "error"));
});

Deno.test("un tramo IVA plantilla 0/10/0 se normaliza como inactivo", () => {
  const resolution = applyFacturaERPDeterministicDefaults({
    FRR_base1: 0,
    FRR_iva1: 10,
    FRR_cuota1: 0,
  }, []);

  assertEquals(resolution.factura.FRR_base1, 0);
  assertEquals(resolution.factura.FRR_iva1, 0);
  assertEquals(resolution.factura.FRR_cuota1, 0);
  assertEquals(resolution.issues, []);
});

Deno.test("retencion parcial conserva ausencias y bloquea los campos incompletos", () => {
  const resolution = applyFacturaERPDeterministicDefaults({
    FRR_baseret: 100,
    FRR_ret: null,
    FRR_cuotaret: null,
  }, []);

  assertEquals(resolution.factura.FRR_baseret, 100);
  assertEquals(resolution.factura.FRR_ret, null);
  assertEquals(resolution.factura.FRR_cuotaret, null);
  assertEquals(
    resolution.issues.map((issue) => issue.field),
    ["FRR_ret", "FRR_cuotaret"],
  );
  assert(resolution.issues.every((issue) => issue.severity === "error"));
});

Deno.test("import-samples preserva referencia ERP solo con credencial service role", async () => {
  const trustedImportSignal = await requestHasServiceRoleCredential(
    new Request("https://edge.invalid", { headers: { apikey: "service-role-real" } }),
    () => "service-role-real",
  );
  const importedFrr = {
    FRR_ejercicio: 25,
    FRR_tipofactura: "OT",
    FRR_idregimen: 2110,
    FRR_fechactb: "2026-06-30",
    FechaVto: "2026-07-30",
    ImporteVto: 100,
    FRR_FechaVto1: "2026-07-30",
    FRR_ImporteVto1: 100,
    FRR_igasto1: 100,
    FRR_ctagasto1: "60200000001",
    FRR_Contabilizar: "S",
  };
  const result = resolveFacturaIngestAuthority({
    frr: importedFrr,
    source: "apiCampojoyma-read-sample",
    remoteFrrId: 49305,
    trustedImportSignal,
    ctb: [{ FRC_id: 9, FRC_Cuenta: "60200000001", FRC_Importe: 100 }],
    punteos: [{ S: true, source_table: "albmaterial", source_id: 88 }],
  });

  assertEquals(trustedImportSignal, true);
  assertEquals(result.isERPReference, true);
  assertEquals(result.remoteFrrId, 49305);
  assertEquals(result.frr, importedFrr);
  assertEquals(result.ctb, [{ FRC_id: 9, FRC_Cuenta: "60200000001", FRC_Importe: 100 }]);
  assertEquals(result.punteos, [{ S: true, source_table: "albmaterial", source_id: 88 }]);
  assert(isFacturaERPReadOnlyReference({
    is_readonly_reference: true,
    source_kind: "erp_reference",
  }));
  assert(isFacturaERPReadOnlyReference({
    is_readonly_reference: false,
    source_kind: "erp_reference",
  }));
  assertEquals(isFacturaERPReadOnlyReference({
    is_readonly_reference: false,
    source_kind: "n8n_draft",
  }), false);
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

Deno.test("limita solo la proyeccion ERP de los textos descriptivos", () => {
  const extraction = {
    concepto: "C".repeat(75),
    observaciones_visibles: "O".repeat(309),
    observaciones_aeat: "A".repeat(80),
  };
  const frr = normalizeFrrPayload(extraction);

  assertEquals(String(frr.FRR_Concepto).length, 50);
  assertEquals(String(frr.FRR_Observaciones).length, 50);
  assertEquals(String(frr.FRR_ObservacionesAEAT).length, 50);
  assertEquals(extraction.observaciones_visibles.length, 309);
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

Deno.test("normaliza albmaterial con claves estables sin persistir lineas del ERP", () => {
  const punteo = normalizePunteoPayload({
    source_table: "albmaterial",
    AMA_id: 49305,
    albaran_id: 82548,
    Importe: "42.341,52",
    lines: [{ id: 1 }, { id: 2 }],
  }, 1);

  assertEquals(punteo.source_table, "albmaterial");
  assertEquals(punteo.source_id, 49305);
  assertEquals(punteo.Origen, "MA");
  assertEquals(punteo.line_count, 2);
  assertEquals(punteo.source_lines, []);
  assertEquals("lines" in punteo.raw, false);
  assertEquals(punteo.raw.albaran_id, 82548);
  assertEquals(punteo.S, false);
});

Deno.test("no deduce fecha CTB y conserva solo una fecha CTB explicita", () => {
  const unresolved = normalizeFrrPayload({ FRR_fechafactura: "2026-06-30" });
  const explicit = normalizeFrrPayload({
    FRR_fechafactura: "2026-06-30",
    FRR_fechactb: "2026-07-01",
  });

  assertEquals(unresolved.FRR_fechactb, undefined);
  assertEquals(unresolved.FRR_Contabilizar, "N");
  assertEquals(explicit.FRR_fechactb, "2026-07-01");
  assertEquals(normalizePunteoPayload({ S: "N" }, 1).S, false);
  assertEquals(normalizePunteoPayload({ S: "S" }, 1).S, true);
});

Deno.test("proyecta punteos seleccionados explicitamente al contrato ERP estricto", () => {
  const payload = toERPSelectedPunteosPayload([
    {
      S: true,
      source_table: "ALBMATERIAL",
      source_id: "23265",
      importe_factura: "1056.00",
      Origen: "MA",
      remote_id: "legacy-1",
      raw: { no_enviar: true },
    },
    {
      S: "S",
      source_table: "albsalida_gastos",
      source_id: 77,
      importe_factura: 12.5,
      Serie: "A",
      Ver: true,
    },
    {
      S: true,
      source_table: "albmaterial",
      source_id: 88,
      importe_factura: null,
      "Importe P": 999,
      Importe: 999,
    },
  ]);

  assertEquals(payload, [
    {
      source_table: "albmaterial",
      source_id: 23265,
      importe_factura: 1056,
    },
    {
      source_table: "albsalida_gastos",
      source_id: 77,
      importe_factura: 12.5,
    },
    {
      source_table: "albmaterial",
      source_id: 88,
    },
  ]);
});

Deno.test("normalizar un punteo no convierte importes visibles ni cuenta CTB en autoridad", () => {
  const normalized = normalizePunteoPayload({
    S: true,
    source_table: "albmaterial",
    source_id: 88,
    importe_factura: null,
    importe_punteado: 777,
    "Importe P": 999,
    FRC_Cuenta: "60000000000",
  }, 1);

  assertEquals(normalized.importe_factura, null);
  assertEquals(normalized.cuenta_gasto, null);
  assertEquals(normalized["Importe P"], 999);
  assertEquals(toERPSelectedPunteosPayload([normalized]), [{
    source_table: "albmaterial",
    source_id: 88,
  }]);
});

Deno.test("preflight de punteos exige identidad completa y no duplicada", () => {
  assertEquals(
    getSelectedPunteoPreflightIssues([
      { S: true, source_table: "albmaterial", source_id: 88 },
      { S: false, source_table: null, source_id: null },
    ]),
    [],
  );

  const missing = getSelectedPunteoPreflightIssues([
    { S: true, source_table: "", source_id: 0 },
  ]);
  assertEquals(missing.map((issue) => issue.field), [
    "punteos.0.source_table",
    "punteos.0.source_id",
  ]);

  const duplicate = getSelectedPunteoPreflightIssues([
    { S: "S", source_table: " ALBMATERIAL ", source_id: "88" },
    { S: true, source_table: "albmaterial", source_id: 88 },
  ]);
  assertEquals(duplicate.length, 1);
  assertEquals(duplicate[0].field, "punteos.1.source_id");
  assert(duplicate[0].message.includes("duplicado"));

  const readOnly = getSelectedPunteoPreflightIssues([
    { S: true, source_table: "albentrada", source_id: 82285 },
    { S: true, source_table: "albentrada_his", source_id: 211790 },
  ]);
  assertEquals(readOnly.map((issue) => issue.field), [
    "punteos.0.source_table",
    "punteos.1.source_table",
  ]);
  assert(readOnly.every((issue) => issue.message.includes("solo de lectura")));
});

Deno.test("excluye del writer candidatos sin seleccion explicita", () => {
  const payload = toERPSelectedPunteosPayload([
    { S: false, source_table: "albmaterial", source_id: 1 },
    { S: "N", source_table: "albmaterial", source_id: 2 },
    { S: "true", source_table: "albmaterial", source_id: 3 },
    { S: 1, source_table: "albmaterial", source_id: 4 },
    { source_table: "albmaterial", source_id: 5 },
    { seleccionado: true, source_table: "albmaterial", source_id: 6 },
  ]);

  assertEquals(payload, []);
});

Deno.test("Edge selecciona MA solo tras verificar referencia exacta y unica", async () => {
  const factura = {
    FRR_Idempresa: 1,
    FRR_idproveedor: 17,
    FRR_tipofactura: "OT",
  };
  const punteos = [
    {
      S: true,
      source_table: "albmaterial",
      source_id: 88,
      Ref: "478974",
    },
    {
      S: false,
      source_table: "albmaterial",
      source_id: 99,
      Ref: "OTRA",
    },
  ];
  const consulta = buildFacturaERPExactMAPunteoConsulta(factura, punteos[0]);
  assert(consulta);
  assert(isAllowedERPConsulta(consulta));
  const result = await verifyFacturaERPExactMAPunteos(
    factura,
    punteos,
    () =>
      Promise.resolve({
        items: [{
          source_table: "albmaterial",
          source_id: 88,
          Ref: "478974",
          empresa: 1,
          acreedor_id: 17,
          factura_recibida_id: null,
        }],
        total: 1,
        limit: 2,
        offset: 0,
      }),
  );

  assertEquals(result.issues, []);
  assertEquals(result.evidence.status, "verified");
  assertEquals(result.punteos[0].S, true);
  assertEquals(result.punteos[0].Ver, true);
  assertEquals(result.punteos[1].S, false);
});

Deno.test("referencias documentadas solo se resuelven con punteos revalidados por Edge", async () => {
  const factura = {
    FRR_Idempresa: 1,
    FRR_idproveedor: 17,
    FRR_tipofactura: "OT",
  };
  const extraction = {
    albaranes_referenciados: [{ referencia: "478974" }],
    lineas: [{ referencia_albaran: "478974" }],
  };
  const requested = [normalizePunteoPayload({
    S: true,
    source_table: "albmaterial",
    source_id: 88,
    Ref: "478974",
    referencia_documentada: "478974",
  }, 1)];
  const verification = await verifyFacturaERPExactMAPunteos(
    factura,
    requested,
    () =>
      Promise.resolve({
        items: [{
          source_table: "albmaterial",
          source_id: 88,
          Ref: "478974",
          empresa: 1,
          acreedor_id: 17,
        }],
        total: 1,
      }),
  );

  assertEquals(
    getFacturaERPDocumentedReferenceIssues({
      factura,
      extraction,
      matchEvidence: {
        punteos: {
          documented_count: 1,
          auto_selection_safe: true,
        },
        punteos_edge_verification: verification.evidence,
      },
      punteos: verification.punteos,
    }),
    [],
  );
});

Deno.test("una senal positiva del modelo no valida referencias omitidas o ambiguas", () => {
  const issues = getFacturaERPDocumentedReferenceIssues({
    factura: {
      FRR_Idempresa: 1,
      FRR_idproveedor: 17,
      FRR_tipofactura: "OT",
    },
    extraction: {
      albaranes_referenciados: [
        { referencia: "478974" },
        { referencia: "478975" },
      ],
    },
    matchEvidence: {
      erp_rules: { resolved: true },
      punteos: {
        documented_count: 2,
        exact_unique_for_every_reference: true,
        one_to_one_identity: true,
        auto_selection_safe: true,
      },
      punteos_edge_verification: {
        status: "not_requested",
        requested: 0,
        verified: 0,
      },
    },
    punteos: [],
  });

  assertEquals(issues.length, 1);
  assertEquals(issues[0]?.field, "punteos");
  assertEquals(issues[0]?.severity, "error");
  assert(issues[0]?.message.includes("478974"));
  assert(issues[0]?.message.includes("478975"));
});

Deno.test("evidencia de referencias sin literales verificables tambien falla cerrada", () => {
  const issues = getFacturaERPDocumentedReferenceIssues({
    factura: {
      FRR_Idempresa: 1,
      FRR_idproveedor: 17,
      FRR_tipofactura: "OT",
    },
    extraction: {},
    matchEvidence: {
      punteos: {
        documented_count: 2,
        auto_selection_safe: true,
      },
      punteos_edge_verification: {
        status: "verified",
        verified: 2,
      },
    },
    punteos: [],
  });

  assertEquals(issues.length, 1);
  assertEquals(issues[0]?.severity, "error");
  assert(issues[0]?.message.includes("solo 0"));
});

Deno.test("verificacion MA es atomica ante referencia ambigua o discordante", async () => {
  const factura = {
    FRR_Idempresa: 1,
    FRR_idproveedor: 17,
    FRR_tipofactura: "OT",
  };
  const punteos = [
    { S: true, source_table: "albmaterial", source_id: 88, Ref: "478974" },
    { S: true, source_table: "albmaterial", source_id: 89, Ref: "478975" },
  ];
  const result = await verifyFacturaERPExactMAPunteos(
    factura,
    punteos,
    (consulta) => {
      const url = new URL(consulta, "https://erp.invalid/");
      const referencia = url.searchParams.get("referencia");
      return Promise.resolve(
        referencia === "478974"
          ? {
            items: [{
              source_table: "albmaterial",
              source_id: 88,
              Ref: "478974",
              empresa: 1,
              acreedor_id: 17,
            }],
            total: 1,
          }
          : {
            items: [
              {
                source_table: "albmaterial",
                source_id: 89,
                Ref: "478975",
                empresa: 1,
                acreedor_id: 17,
              },
              {
                source_table: "albmaterial",
                source_id: 90,
                Ref: "478975",
                empresa: 1,
                acreedor_id: 17,
              },
            ],
            total: 2,
          },
      );
    },
  );

  assertEquals(result.evidence.status, "rejected");
  assertEquals(result.evidence.reason, "non_unique_reference");
  assertEquals(result.punteos.map((punteo) => punteo.S), [false, false]);
  assertEquals(result.issues[0]?.severity, "error");
});

Deno.test("reextraccion preserva decisiones confirmadas y no reemplaza CTB ni punteos", () => {
  const existingFactura = {
    FRR_Idempresa: 1,
    FRR_idproveedor: 17,
    FRR_idcuenta: "41000000017",
    FRR_ejercicio: 25,
    FRR_tipofactura: "OT",
    FRR_idregimen: 2110,
    FRR_fechactb: "2026-06-30",
    FRR_Contabilizar: "S",
    FechaVto: "2026-07-30",
    ImporteVto: 100,
    FRR_FechaVto1: "2026-07-30",
    FRR_FechaVto2: "2026-08-30",
    FRR_FechaVto3: "2026-09-30",
    FRR_ImporteVto1: 25,
    FRR_ImporteVto2: 25,
    FRR_ImporteVto3: 50,
    FRR_igasto1: 100,
    FRR_ctagasto1: "60200000001",
    FRR_numerofactura: "ANTIGUA",
  };
  const result = prepareFacturaExtractionPersistence({
    existingFactura,
    extractedFrr: sanitizeUntrustedFacturaAccountingFields({
      FRR_Idempresa: null,
      FRR_idproveedor: 99,
      FRR_idcuenta: "41009999999",
      FRR_ejercicio: 26,
      FRR_tipofactura: "GE",
      FRR_idregimen: 1000,
      FRR_fechactb: "2026-07-22",
      FRR_Contabilizar: "N",
      FechaVto: "2099-12-31",
      ImporteVto: 999,
      FRR_FechaVto1: "2099-12-31",
      FRR_FechaVto2: "2099-12-31",
      FRR_FechaVto3: "2099-12-31",
      FRR_ImporteVto1: 333,
      FRR_ImporteVto2: 333,
      FRR_ImporteVto3: 333,
      FRR_igasto1: 999,
      FRR_ctagasto1: "69999999999",
      FRR_numerofactura: "NUEVA",
    }),
    ctb: [{ FRC_Cuenta: "60000000000", FRC_Importe: 100 }],
    punteos: [{ S: false, source_table: "albmaterial", source_id: 1 }],
  });

  for (const field of [
    "FRR_Idempresa",
    "FRR_idproveedor",
    "FRR_idcuenta",
    "FRR_ejercicio",
    "FRR_tipofactura",
    "FRR_idregimen",
    "FRR_fechactb",
    "FRR_Contabilizar",
    "FechaVto",
    "ImporteVto",
    "FRR_FechaVto1",
    "FRR_FechaVto2",
    "FRR_FechaVto3",
    "FRR_ImporteVto1",
    "FRR_ImporteVto2",
    "FRR_ImporteVto3",
    "FRR_igasto1",
    "FRR_ctagasto1",
  ] as const) {
    assertEquals(result.factura[field], existingFactura[field], field);
    assertEquals(result.persistedFrr[field], existingFactura[field], field);
  }
  assertEquals(result.factura.FRR_numerofactura, "NUEVA");
  assertEquals(result.persistedFrr.FRR_numerofactura, "NUEVA");
  assertEquals(result.ctb, null);
  assertEquals(result.punteos, null);
});

Deno.test("alta nueva conserva cabecera y arrays normalizados de extraccion", () => {
  const extractedFrr = {
    FRR_Idempresa: 1,
    FRR_numerofactura: "NUEVA",
    FRR_Contabilizar: "N",
  };
  const ctb = [{ FRC_Cuenta: "60000000000", FRC_Importe: 100 }];
  const punteos = [{ S: false, source_table: "albmaterial", source_id: 1 }];
  const result = prepareFacturaExtractionPersistence({
    existingFactura: null,
    extractedFrr,
    ctb,
    punteos,
  });

  assertEquals(result.factura, extractedFrr);
  assertEquals(result.persistedFrr, extractedFrr);
  assertEquals(result.ctb, ctb);
  assertEquals(result.punteos, punteos);
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

Deno.test("valida de forma estricta el sobre de respuesta del writer v2", () => {
  const requestId = "11111111-1111-4111-8111-111111111111";
  assertEquals(
    validateERPWriteResponseV2({
      contract_version: 2,
      request_id: requestId,
      ok: true,
      dry_run: true,
    }, { requestId, expectedDryRun: true }).ok,
    true,
  );

  const commit = validateERPWriteResponseV2({
    contract_version: 2,
    request_id: requestId,
    ok: true,
    dry_run: false,
    FRR_id: 49305,
  }, { requestId, expectedDryRun: false });
  assertEquals(commit.ok, true);
  assertEquals(commit.remoteFacturaId, 49305);

  const crossedRequest = validateERPWriteResponseV2({
    contract_version: 2,
    request_id: "22222222-2222-4222-8222-222222222222",
    ok: true,
    dry_run: true,
  }, { requestId, expectedDryRun: true });
  assertEquals(crossedRequest.ok, false);

  const missingOk = validateERPWriteResponseV2({
    contract_version: 2,
    request_id: requestId,
    dry_run: true,
  }, { requestId, expectedDryRun: true });
  assertEquals(missingOk.ok, false);

  const incoherentDryRun = validateERPWriteResponseV2({
    contract_version: 2,
    request_id: requestId,
    ok: true,
    dry_run: false,
  }, { requestId, expectedDryRun: true });
  assertEquals(incoherentDryRun.ok, false);

  const commitWithoutId = validateERPWriteResponseV2({
    contract_version: 2,
    request_id: requestId,
    ok: true,
    dry_run: false,
  }, { requestId, expectedDryRun: false });
  assertEquals(commitWithoutId.ok, false);
  assertEquals(commitWithoutId.remoteFacturaId, null);
});

Deno.test("replay terminal y reconciliacion ambigua nunca habilitan otro writer", () => {
  const originalRequestId = "11111111-1111-4111-8111-111111111111";
  const newRequestId = "22222222-2222-4222-8222-222222222222";
  assertEquals(getFacturaSyncEntryDecision({
    sync_status: "sent",
    last_request_id: originalRequestId,
  }, originalRequestId), {
    mode: "replay",
    syncRequestId: originalRequestId,
    writerAllowed: false,
  });
  assertEquals(getFacturaSyncEntryDecision({
    sync_status: "unknown",
    last_request_id: originalRequestId,
  }, newRequestId), {
    mode: "reconcile",
    syncRequestId: originalRequestId,
    writerAllowed: false,
  });
  assertEquals(isEligibleERPCommitAttempt({
    request_id: originalRequestId,
    phase: "commit",
    status: "unknown",
  }, originalRequestId), true);
  assertEquals(isEligibleERPCommitAttempt({
    request_id: originalRequestId,
    phase: "dry_run",
    status: "succeeded",
  }, originalRequestId), false);
  assertEquals(isEligibleERPCommitAttempt({
    request_id: originalRequestId,
    phase: "commit",
    status: "failed",
  }, originalRequestId), false);
});

Deno.test("reconciliacion usa el request original aunque cambien reglas actuales", () => {
  const requestId = "11111111-1111-4111-8111-111111111111";
  const snapshot = buildERPContractV2({
    requestId,
    dryRun: true,
    cabecera: {
      FRR_Idempresa: 1,
      FRR_ejercicio: 25,
      FRR_idproveedor: 17,
      FRR_numerofactura: "A-1",
      FRR_tipofactura: "OT",
    },
    ctb: [{ FRC_Cuenta: "60200000001", FRC_Importe: 100 }],
    punteos: [{ source_table: "albmaterial", source_id: 88, importe_factura: 100 }],
  });
  const parsed = validateERPWriteRequestV2(snapshot, { requestId, expectedDryRun: true });

  assertEquals(parsed.ok, true);
  assertEquals(parsed.cabecera.FRR_ejercicio, 25);
  assertEquals(parsed.cabecera.FRR_tipofactura, "OT");
  assertEquals(ERPWriterRelationsMatchSnapshot({
    currentCtb: [{ FRC_Importe: 100, FRC_Cuenta: "60200000001" }],
    currentPunteos: [{ importe_factura: 100, source_id: 88, source_table: "albmaterial" }],
    snapshotCtb: parsed.ctb,
    snapshotPunteos: parsed.punteos,
  }), true);
  assertEquals(ERPWriterRelationsMatchSnapshot({
    currentCtb: [{ FRC_Cuenta: "60200000001", FRC_Importe: 99 }],
    currentPunteos: parsed.punteos,
    snapshotCtb: parsed.ctb,
    snapshotPunteos: parsed.punteos,
  }), false);
});

Deno.test("bloquea errores de validacion anidados aunque el writer declare ok", () => {
  assertEquals(
    hasBlockingERPValidationErrors({
      ok: true,
      validations: {
        errors: [{ field: "cabecera", message: "invalida" }],
        warnings: [{ message: "aviso" }],
      },
    }),
    true,
  );
  assertEquals(
    hasBlockingERPValidationErrors({
      ok: true,
      validations: { errors: [], warnings: [{ severity: "warning" }] },
    }),
    false,
  );
});

Deno.test("HTTP 200 con error o detail declarado no cuenta como exito upstream", () => {
  const response = new Response("", { status: 200 });
  assertEquals(upstreamResult(response, { error: "fallo ERP" }).ok, false);
  assertEquals(upstreamResult(response, { detail: "fallo ERP" }).ok, false);
  assertEquals(upstreamResult(response, { items: [], total: 0 }).ok, true);
  assertEquals(upstreamResult(response, { ok: true, detail: "informativo" }).ok, true);
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
      created: true,
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

Deno.test("reference_only nunca confirma un asiento aunque created sea true", () => {
  const accounting = normalizeAccountingReadback({
    accounting: {
      status: "reference_only",
      created: true,
      technical_id: 390305,
      visible_number: "48732",
    },
    entries: [
      { cuenta: "60200000001", debe: 100, haber: 0 },
      { cuenta: "41000000017", debe: 0, haber: 100 },
    ],
  });

  assertEquals(validateAccountingReadback(accounting).ok, false);
});

Deno.test("readback coincide con cabecera, CTB posicional y punteos enviados", () => {
  const base = {
    remoteFacturaId: 49305,
    cabecera: {
      FRR_Idempresa: 1,
      FRR_numerofactura: "A-00748886",
      FRR_totalfac: 100,
    },
    ctb: [{
      FRC_Cuenta: "60200000001",
      FRC_Importe: 80,
      FRC_IdActividad: 11,
      FRC_Idseccion: 12,
      FRC_Iddepartamento: 13,
      FRC_Idsubdepartamento: 14,
    }],
    punteos: [
      { source_table: "albmaterial", source_id: 88, importe_factura: 80 },
      { source_table: "albsalida_gastos", source_id: 77 },
    ],
    readback: {
      factura: {
        FRR_id: 49305,
        FRR_Idempresa: 1,
        FRR_numerofactura: "A-00748886",
        FRR_totalfac: 100.009,
      },
      ctb: [{
        FRC_Cuenta: "60200000001",
        FRC_Importe: 80.009,
        FRC_IdActividad: 11,
        FRC_Idseccion: 12,
        FRC_Iddepartamento: 13,
        FRC_Idsubdepartamento: 14,
      }],
      punteos: [
        { source_table: "ALBMATERIAL", source_id: 88, importe_factura: 80.009 },
        { source_table: "albsalida_gastos", source_id: 77, importe_factura: 999 },
      ],
    },
  };

  assertEquals(validateERPReadbackAgainstWrite(base).ok, true);
  assertEquals(
    validateERPReadbackAgainstWrite({
      remoteFacturaId: 49305,
      cabecera: {
        FRR_Idempresa: 1,
        FRR_numerofactura: "A-00748886",
        FRR_ImporteVto1: null,
        FRR_ImporteVto2: null,
        FRR_ImporteVto3: null,
        FRR_BancoPrevPago: null,
      },
      ctb: [],
      punteos: [],
      readback: {
        factura: {
          FRR_id: 49305,
          FRR_Idempresa: 1,
          FRR_numerofactura: "A-00748886",
          FRR_ImporteVto1: 0,
          FRR_ImporteVto2: 0,
          FRR_ImporteVto3: 0,
          FRR_BancoPrevPago: 0,
        },
        ctb: [],
        punteos: [],
      },
    }).ok,
    true,
  );

  const mismatched = validateERPReadbackAgainstWrite({
    ...base,
    readback: {
      ...base.readback,
      factura: { ...base.readback.factura, FRR_numerofactura: "OTRA" },
      ctb: [{
        ...base.readback.ctb[0],
        FRC_Cuenta: "69999999999",
        FRC_Importe: 80.02,
        FRC_IdActividad: 99,
      }],
      punteos: [
        { source_table: "albmaterial", source_id: 88, importe_factura: 81 },
        base.readback.punteos[1],
      ],
    },
  });
  assertEquals(mismatched.ok, false);
  assertEquals(mismatched.errors.map((issue) => issue.field), [
    "factura.FRR_numerofactura",
    "ctb.0.FRC_Cuenta",
    "ctb.0.FRC_Importe",
    "ctb.0.FRC_IdActividad",
    "punteos.0.importe_factura",
  ]);
});

Deno.test("allowlist ERP acepta solo paths y query keys de lectura documentados", () => {
  const allowed = [
    "acreedores?nif=B04243655&limit=10",
    "acreedores?nombre=ONDUSPAN&limit=10",
    "acreedores/17",
    "acreedores/17/gastos",
    "acreedores/17/gastos?schema=agroiris",
    "agricultores?q=BIO&limit=10",
    "agricultores?nif=F04661460&activo=true",
    "agricultores/1680",
    "agricultores/1680/gastos",
    "cuentas-contables?q=41000000017&limit=100",
    "facturasrecibidas?numero_factura=A-00748886&limit=20",
    "facturasrecibidas/buscar?empresa_id=1&ejercicio=25&proveedor_id=17&numero_factura=A-00748886&tipo_factura=OT",
    "facturasrecibidas/49305/punteos?include_lines=true&limit=100",
    "facturasrecibidas/49305/asiento",
    "regimenes/2110/perfiles-iva",
    "regimenes/2110/perfiles-iva?proveedor_id=17&tipo_factura=OT",
    "regimenes/2110/perfiles-iva?tipo_factura=GE&schema=agroiris",
    "albaranes-gastos/punteables?empresa_id=1&proveedor_id=17&solo_pendientes=true&source_table=albmaterial&include_lines=true",
    "albaranes/entrada?limit=25&offset=0",
    "albaranes/entrada?fecha_desde=2026-07-01&fecha_hasta=2026-07-31&agricultor_id=1680&serie=A26&numero=8436",
    "albaranes/entrada/82548/lineas",
    "albaranes/entrada/82548/lineas?schema=agroiris",
    "albaranes/material/23210/lineas",
    "albaranes/material/23210/lineas?schema=agroiris",
  ];
  for (const consulta of allowed) assert(isAllowedERPConsulta(consulta), consulta);

  const denied = [
    "https://attacker.invalid/facturasrecibidas",
    "../facturasrecibidas",
    "%2e%2e/facturasrecibidas",
    "acreedores/no-numerico/gastos",
    "acreedores/17/gastos/extra",
    "acreedores/17/gastos?limit=1",
    "agricultores/1680/gastos?limit=1",
    "agricultores/no-numerico",
    "cuentas/60200000001",
    "cuentas?q=602",
    "facturasrecibidas/49305/delete",
    "facturasrecibidas?redirect=https://attacker.invalid",
    "facturasrecibidas/49305/asiento?include_lines=true",
    "facturasrecibidas/buscar?empresa_id=1&tipo_factura=OT&otra_clave=1",
    "regimenes/0/perfiles-iva",
    "regimenes/2110/perfiles-iva?limit=1",
    "regimenes/2110/perfiles-iva/delete",
    "albaranes-gastos/punteables?sql=drop",
    "albaranes/entrada?proveedor_id=1680",
    "albaranes/entrada/no-numerico/lineas",
    "albaranes/entrada/0/lineas",
    "albaranes/entrada/82548/lineas?limit=1",
    "albaranes/entrada/82548/lineas/extra",
    "albaranes/material/no-numerico/lineas",
    "albaranes/material/0/lineas",
    "albaranes/material/23210/lineas?limit=1",
    "albaranes/material/23210/lineas/extra",
  ];
  for (const consulta of denied) assert(!isAllowedERPConsulta(consulta), consulta);
});

Deno.test("perfiles IVA conserva el permiso exclusivo de facturas", () => {
  assertEquals(
    getERPReadAuthorizedRoutes(
      "regimenes/2110/perfiles-iva?proveedor_id=17&tipo_factura=OT",
    ),
    ["/facturas-recibidas"],
  );
  assert(
    !isRouteSetAuthorized(
      "authenticated",
      ["/pedidos"],
      getERPReadAuthorizedRoutes("regimenes/2110/perfiles-iva"),
    ),
  );
});

Deno.test("listado de albaranes conserva compatibilidad con el permiso de facturas", () => {
  assertEquals(getERPReadAuthorizedRoutes("albaranes/entrada?limit=25&offset=0"), [
    "/albaranes",
    "/facturas-recibidas",
  ]);
  assert(
    isRouteSetAuthorized(
      "authenticated",
      ["/facturas-recibidas"],
      getERPReadAuthorizedRoutes("albaranes/entrada"),
    ),
  );
});

Deno.test("lineas de entrada se comparten entre facturas y albaranes", () => {
  assertEquals(getERPReadAuthorizedRoutes("albaranes/entrada/82548/lineas"), [
    "/facturas-recibidas",
    "/albaranes",
  ]);
  assert(
    !isRouteSetAuthorized(
      "authenticated",
      ["/pedidos"],
      getERPReadAuthorizedRoutes("albaranes/entrada/82548/lineas"),
    ),
  );
});

Deno.test("lectura de lineas de material conserva el permiso exclusivo de facturas", () => {
  assertEquals(getERPReadAuthorizedRoutes("albaranes/material/23210/lineas"), [
    "/facturas-recibidas",
  ]);
  assert(
    !isRouteSetAuthorized(
      "authenticated",
      ["/pedidos"],
      getERPReadAuthorizedRoutes("albaranes/material/23210/lineas"),
    ),
  );
});

Deno.test("readback CTB y punteos exige arrays o envelopes explicitos incluso vacios", () => {
  assertEquals(parseERPArrayEnvelope({}, ["items", "ctb", "data"]).ok, false);
  assertEquals(parseERPArrayEnvelope({}, ["items", "punteos", "data"]).ok, false);
  assertEquals(parseERPArrayEnvelope({ items: [] }, ["items", "ctb", "data"]), {
    ok: true,
    items: [],
    error: null,
  });
  assertEquals(parseERPArrayEnvelope({ data: { items: [] } }, ["items", "punteos"]), {
    ok: true,
    items: [],
    error: null,
  });
  assertEquals(
    parseERPArrayEnvelope({ ctb: [null] }, ["items", "ctb", "data"]).ok,
    false,
  );
});

Deno.test("validacion estructural no consulta cache y fusiona avisos por campo semantico", async () => {
  const factura = {
    FRR_Idempresa: 1,
    FRR_ejercicio: 25,
    FRR_idproveedor: 17,
    FRR_idcuenta: "41000000017",
    FRR_numerofactura: "A-00748886",
    FRR_fechafactura: "2026-06-30",
    FRR_totalfac: 51_233.24,
    FRR_tipofactura: "OT",
  };
  const issues = await getValidationErrorsForFactura(factura);
  const merged = mergeValidationIssues(issues, [
    "FRR_fechactb requiere revision.",
    "Falta una regla confirmada para FRR_idregimen.",
    "FRR_fechactb requiere revision.",
  ]);

  assertEquals(merged.filter((issue) => issue.field === "FRR_fechactb").length, 1);
  assertEquals(merged.filter((issue) => issue.field === "FRR_idregimen").length, 1);
  assertEquals(merged.find((issue) => issue.field === "FRR_fechactb")?.severity, "error");
  assertEquals(merged.find((issue) => issue.field === "FRR_idregimen")?.severity, "error");
});

Deno.test("conserva por separado proveedor ausente y caida operativa de acreedores", async () => {
  const structuralIssues = await getValidationErrorsForFactura({});
  const apiWarning = "No se pudo consultar /acreedores. La resolucion queda pendiente.";
  const merged = mergeValidationIssues(structuralIssues, [apiWarning]);

  assertEquals(
    merged.find((issue) => issue.field === "FRR_idproveedor"),
    {
      field: "FRR_idproveedor",
      message: "Falta proveedor/acreedor resuelto.",
      severity: "error",
    },
  );
  assertEquals(
    merged.find((issue) => issue.field === "metadata.warnings" && issue.message === apiWarning),
    {
      field: "metadata.warnings",
      message: apiWarning,
      severity: "warning",
    },
  );
});

Deno.test("deduplica la misma causa operativa normalizada sin perder severidad", () => {
  const merged = mergeValidationIssues([], [
    "No se pudo consultar /acreedores. La resolucion queda pendiente.",
    "  NO SE PUDO CONSULTAR /ACREEDORES.   La resolución queda pendiente.  ",
  ]);

  assertEquals(merged, [{
    field: "metadata.warnings",
    message: "No se pudo consultar /acreedores. La resolucion queda pendiente.",
    severity: "warning",
  }]);
});

Deno.test("update conserva solo avisos operativos ERP y descarta validaciones obsoletas", () => {
  const operationalWarning = "No se pudo consultar /acreedores. La resolucion queda pendiente.";
  const apiBaseWarning =
    "CAMPOJOYMA_API_BASE_URL no es una URL HTTP(S) valida; no se hacen consultas ERP.";
  const preserved = extractOperationalERPAvailabilityWarnings([
    { field: "metadata.warnings", message: operationalWarning, severity: "warning" },
    {
      field: "metadata.warnings",
      message: "NO SE PUDO CONSULTAR /ACREEDORES. La resolución queda pendiente.",
      severity: "warning",
    },
    { field: "metadata.warnings", message: apiBaseWarning, severity: "warning" },
    { field: "FRR_idproveedor", message: "Falta proveedor/acreedor resuelto.", severity: "error" },
    { field: "erp_duplicate", message: "Posible duplicado ERP.", severity: "warning" },
    { field: "metadata.warnings", message: "Aviso OCR antiguo.", severity: "warning" },
    { field: "metadata.warnings", message: operationalWarning, severity: "error" },
  ]);

  assertEquals(preserved, [operationalWarning, apiBaseWarning]);
  assertEquals(
    extractOperationalERPAvailabilityWarnings(
      [{ field: "metadata.warnings", message: operationalWarning, severity: "warning" }],
      { providerPreflightVerified: true },
    ),
    [],
  );
  assertEquals(
    mergeValidationIssues([
      { field: "FRR_idproveedor", message: "Falta proveedor/acreedor resuelto.", severity: "error" },
    ], preserved),
    [
      { field: "FRR_idproveedor", message: "Falta proveedor/acreedor resuelto.", severity: "error" },
      { field: "metadata.warnings", message: operationalWarning, severity: "warning" },
      { field: "metadata.warnings", message: apiBaseWarning, severity: "warning" },
    ],
  );
});

Deno.test("preflight ERP exige mismo acreedor y misma cuenta contable", () => {
  const factura = { FRR_idproveedor: 17, FRR_idcuenta: "41000000017" };
  assertEquals(
    getERPProviderPreflightIssues(factura, {
      id: 17,
      cuenta_id: "41000000017",
      cuenta_gasto: "60200000001",
    }),
    [],
  );

  const mismatches = getERPProviderPreflightIssues(factura, {
    id: 18,
    cuenta_id: "41000000018",
  });
  assertEquals(mismatches.map((issue) => issue.field), ["FRR_idproveedor", "FRR_idcuenta"]);
  assert(mismatches.every((issue) => issue.severity === "error"));
});

Deno.test("detalle de acreedor vacio falla cerrado y un detalle identificado es reconocido", () => {
  assertEquals(parseERPProviderDetailResponse({}).ok, false);
  assertEquals(parseERPProviderDetailResponse({ data: {} }).ok, false);
  assertEquals(parseERPProviderDetailResponse({
    data: { id: 17, cuenta_id: "41000000017" },
  }), {
    ok: true,
    provider: { id: 17, cuenta_id: "41000000017" },
    error: null,
  });
});

Deno.test("preflight ERP bloquea un acreedor marcado como bloqueado", () => {
  const issues = getERPProviderPreflightIssues(
    { FRR_idproveedor: 17, FRR_idcuenta: "41000000017" },
    {
      id: 17,
      cuenta_id: "41000000017",
      activo: true,
      bloqueado: "S",
      inactivo_rgpd: "N",
    },
  );

  assertEquals(issues, [{
    field: "FRR_idproveedor",
    message: "El acreedor seleccionado esta bloqueado en el ERP.",
    severity: "error",
  }]);
});

Deno.test("preflight ERP bloquea acreedor inactivo o inactivo por RGPD", () => {
  const factura = { FRR_idproveedor: 17, FRR_idcuenta: "41000000017" };
  const inactiveIssues = getERPProviderPreflightIssues(factura, {
    id: 17,
    cuenta_id: "41000000017",
    activo: false,
    bloqueado: "N",
    inactivo_rgpd: "N",
  });
  const rgpdIssues = getERPProviderPreflightIssues(factura, {
    id: 17,
    cuenta_id: "41000000017",
    activo: true,
    bloqueado: false,
    inactivo_rgpd: "S",
  });

  assertEquals(inactiveIssues.map((issue) => issue.message), [
    "El acreedor seleccionado no esta activo en el ERP.",
  ]);
  assertEquals(rgpdIssues.map((issue) => issue.message), [
    "El acreedor seleccionado esta inactivo por RGPD en el ERP.",
  ]);
});

Deno.test("detalle y preflight ERP validan agricultores con su propio maestro", () => {
  const payload = {
    agricultor: {
      AGR_Idagricultor: 1957,
      AGR_Cuenta: "40090001957",
      AGR_Activo: "S",
      AGR_bloqueado: "N",
    },
  };
  const parsed = parseERPProviderDetailResponse(payload, "agricultor");
  assertEquals(parsed.ok, true);
  assertEquals(
    getERPProviderPreflightIssues(
      { FRR_idproveedor: 1957, FRR_idcuenta: "40090001957" },
      parsed.provider,
      "agricultor",
    ),
    [],
  );
  assertEquals(resolveFacturaProveedorTipo({ FRR_tipofactura: "GE" }), "agricultor");
  assertEquals(resolveFacturaProveedorTipo({ FRR_tipofactura: "OT" }), "acreedor");
  assertEquals(resolveFacturaProveedorTipo({ FRR_tipofactura: "MA" }), "acreedor");
  assertEquals(resolveFacturaProveedorTipo({ FRR_tipofactura: "XX" }), "acreedor");
  assertEquals(resolveFacturaProveedorTipo({ FRR_tipofactura: null }), null);
  assertEquals(
    resolveFacturaProveedorTipo({ FRR_tipofactura: "GE" }, "acreedor"),
    "agricultor",
  );
  assertEquals(
    getFacturaProveedorTipoFromMatchEvidence({
      proveedor: {
        matched: true,
        provider_id: 1957,
        entity_type: "agricultor",
      },
    }, 1957),
    "agricultor",
  );
  assertEquals(
    getFacturaProveedorTipoFromMatchEvidence({
      proveedor: {
        matched: false,
        provider_id: 17,
        entity_type: "acreedor",
        hinted_entity_type: "acreedor",
      },
    }, 17),
    null,
  );
  assertEquals(
    getFacturaProveedorTipoFromMatchEvidence({
      proveedor: {
        matched: true,
        provider_id: 17,
        hinted_entity_type: "acreedor",
      },
    }, 17),
    null,
  );
  assertEquals(
    getFacturaProveedorTipoFromMatchEvidence({
      acreedor: {
        matched: true,
        provider_id: 17,
        entity_type: "acreedor",
      },
    }, 17),
    null,
  );
  assertEquals(
    getFacturaProveedorTipoFromMatchEvidence({
      proveedor: {
        matched: true,
        provider_id: 18,
        entity_type: "acreedor",
      },
    }, 17),
    null,
  );
  assertEquals(
    getFacturaProveedorTipoFromMatchEvidence({
      proveedor: {
        matched: true,
        entity_type: "acreedor",
      },
    }, 17),
    null,
  );
  assertEquals(
    getFacturaProveedorTipoFromMatchEvidence({
      proveedor: {
        matched: true,
        provider_id: 17,
        entity_id: 18,
        entity_type: "acreedor",
      },
    }, 17),
    null,
  );
  assertEquals(
    getFacturaProveedorTipoFromMatchEvidence({
      proveedor: {
        matched: true,
        provider_id: 17,
        entity_type: "acreedor",
      },
    }, null),
    null,
  );
  assertEquals(
    getFacturaProveedorTipoFromMatchEvidence({
      proveedor: {
        matched: true,
        provider_id: 17.9,
        entity_type: "acreedor",
      },
    }, 17),
    null,
  );
  assertEquals(
    getFacturaProveedorTipoFromMatchEvidence({
      proveedor: {
        matched: true,
        provider_id: "17.0",
        entity_type: "acreedor",
      },
    }, 17),
    null,
  );
  assertEquals(
    getFacturaProveedorTipoFromMatchEvidence({
      proveedor: {
        matched: true,
        provider_id: 17,
        entity_type: "acreedor",
      },
    }, 17.9),
    null,
  );
  assertEquals(
    getFacturaProveedorTipoFromMatchEvidence({
      proveedor: {
        matched: true,
        provider_id: 17,
        entity_type: "acreedor",
        proveedor_tipo: "agricultor",
      },
    }, 17),
    null,
  );
  assertEquals(
    getFacturaProveedorTipoFromMatchEvidence({
      proveedor: {
        matched: true,
        provider_id: 17,
        entity_type: "acreedor",
        proveedor_tipo: "manipulado",
      },
    }, 17),
    null,
  );
});

Deno.test("el circuito sugerido solo se confirma con detalle ERP del mismo proveedor y cuenta", async () => {
  const consultas: string[] = [];
  const confirmation = await confirmFacturaProveedorTipoFromERP(
    {
      FRR_idproveedor: 17,
      FRR_idcuenta: "41000000017",
    },
    "acreedor",
    (consulta) => {
      consultas.push(consulta);
      return Promise.resolve({
        id: 17,
        nombre: "ONDUSPAN, S.A.",
        cuenta_id: "41000000017",
        activo: true,
        bloqueado: false,
        inactivo_rgpd: false,
      });
    },
  );

  assertEquals(consultas, ["acreedores/17"]);
  assertEquals(confirmation.providerType, "acreedor");
  assertEquals(confirmation.providerName, "ONDUSPAN, S.A.");
  assertEquals(confirmation.issues, []);
  assertEquals(confirmation.evidence, {
    source: "erp_provider_detail",
    status: "confirmed",
    provider_id: 17,
    provider_type: "acreedor",
  });
});

Deno.test("la reconfirmacion del circuito falla cerrada ante id, cuenta o estado adversarial", async () => {
  const factura = {
    FRR_idproveedor: 17,
    FRR_idcuenta: "41000000017",
  };
  const payloads = [
    {
      id: 18,
      cuenta_id: "41000000017",
      activo: true,
      bloqueado: false,
      inactivo_rgpd: false,
    },
    {
      id: 17,
      cuenta_id: "41000000999",
      activo: true,
      bloqueado: false,
      inactivo_rgpd: false,
    },
    {
      id: 17,
      cuenta_id: "41000000017",
      activo: true,
      bloqueado: true,
      inactivo_rgpd: false,
    },
  ];

  for (const payload of payloads) {
    const confirmation = await confirmFacturaProveedorTipoFromERP(
      factura,
      "acreedor",
      () => Promise.resolve(payload),
    );
    assertEquals(confirmation.providerType, null);
    assert(confirmation.issues.some((issue) => issue.severity === "error"));
    assertEquals(confirmation.evidence.status, "rejected_mismatch");
  }
});

Deno.test("caida o shape invalido del maestro nunca materializan tipo factura", async () => {
  const factura = {
    FRR_idproveedor: 1957,
    FRR_idcuenta: "40090001957",
  };
  const unavailable = await confirmFacturaProveedorTipoFromERP(
    factura,
    "agricultor",
    () => Promise.reject(new Error("ERP caido")),
  );
  const invalid = await confirmFacturaProveedorTipoFromERP(
    factura,
    "agricultor",
    () => Promise.resolve({ items: [] }),
  );

  assertEquals(unavailable.providerType, null);
  assertEquals(unavailable.evidence.status, "unavailable");
  assertEquals(unavailable.issues[0]?.field, "FRR_tipofactura");
  assertEquals(invalid.providerType, null);
  assertEquals(invalid.evidence.status, "invalid_response");
  assertEquals(invalid.issues[0]?.field, "FRR_tipofactura");
});

Deno.test("un tipo manipulado exige igualmente que el maestro ERP de ese circuito confirme id y cuenta", async () => {
  const consultas: string[] = [];
  const confirmation = await confirmFacturaProveedorTipoFromERP(
    {
      FRR_idproveedor: 17,
      FRR_idcuenta: "41000000017",
    },
    "agricultor",
    (consulta) => {
      consultas.push(consulta);
      return Promise.resolve({
        agricultor: {
          AGR_Idagricultor: 1957,
          AGR_Cuenta: "40090001957",
          AGR_Activo: "S",
          AGR_bloqueado: "N",
        },
      });
    },
  );

  assertEquals(consultas, ["agricultores/17"]);
  assertEquals(confirmation.providerType, null);
  assertEquals(confirmation.evidence.status, "rejected_mismatch");
  assert(
    confirmation.issues.some((issue) =>
      issue.severity === "error" && issue.field === "FRR_idproveedor"
    ),
  );
});

Deno.test("la reconfirmacion rechaza ids decimales aunque su truncado coincidiera", async () => {
  const confirmation = await confirmFacturaProveedorTipoFromERP(
    {
      FRR_idproveedor: 17,
      FRR_idcuenta: "41000000017",
    },
    "acreedor",
    () =>
      Promise.resolve({
        id: 17.9,
        cuenta_id: "41000000017",
        activo: true,
        bloqueado: false,
        inactivo_rgpd: false,
      }),
  );

  assertEquals(confirmation.providerType, null);
  assertEquals(confirmation.evidence.status, "invalid_response");
});

Deno.test("duplicado ERP usa la clave exacta y conserva candidatos utiles", () => {
  const consulta = buildERPDuplicateConsulta({
    FRR_Idempresa: 1,
    FRR_ejercicio: 25,
    FRR_idproveedor: 17,
    FRR_numerofactura: "A/1 & 2",
    FRR_tipofactura: "ot",
  });
  assert(consulta);
  const url = new URL(consulta, "https://erp.invalid/");
  assertEquals(url.pathname, "/facturasrecibidas/buscar");
  assertEquals(url.searchParams.get("empresa_id"), "1");
  assertEquals(url.searchParams.get("ejercicio"), "25");
  assertEquals(url.searchParams.get("proveedor_id"), "17");
  assertEquals(url.searchParams.get("numero_factura"), "A/1 & 2");
  assertEquals(url.searchParams.get("tipo_factura"), "OT");
  assertEquals(url.searchParams.get("limit"), "10");
  assertEquals(buildERPDuplicateConsulta({
    FRR_Idempresa: 1,
    FRR_ejercicio: 25,
    FRR_idproveedor: 17,
    FRR_numerofactura: "A/1 & 2",
  }), null);

  assertEquals(normalizeERPDuplicateCandidates({
    items: [{
      FRR_id: 49305,
      FRR_numero: 5052,
      FRR_Idempresa: 1,
      FRR_ejercicio: 25,
      FRR_idproveedor: 17,
      FRR_numerofactura: "A-00748886",
      FRR_tipofactura: "ot",
    }],
    total: 1,
  }), [{
    FRR_id: 49305,
    FRR_numero: 5052,
    FRR_Idempresa: 1,
    FRR_ejercicio: 25,
    FRR_idproveedor: 17,
    FRR_numerofactura: "A-00748886",
    FRR_tipofactura: "OT",
  }]);
});

Deno.test("contrato /buscar falla cerrado ante shapes o candidatos no verificables", () => {
  const factura = {
    FRR_Idempresa: 1,
    FRR_ejercicio: 25,
    FRR_idproveedor: 17,
    FRR_numerofactura: "A-00748886",
    FRR_tipofactura: "OT",
  };
  const exactCandidate = {
    FRR_id: 49305,
    FRR_numero: 5052,
    FRR_Idempresa: 1,
    FRR_ejercicio: 25,
    FRR_idproveedor: 17,
    FRR_numerofactura: "A-00748886",
    FRR_tipofactura: "OT",
  };

  assertEquals(validateERPDuplicateSearchResponse({}, factura).ok, false);
  assertEquals(validateERPDuplicateSearchResponse([], factura).ok, false);
  assertEquals(
    validateERPDuplicateSearchResponse({ items: [], total: "0" }, factura).ok,
    false,
  );
  assertEquals(
    validateERPDuplicateSearchResponse({ items: [exactCandidate], total: 0 }, factura).ok,
    false,
  );
  assertEquals(
    validateERPDuplicateSearchResponse({ items: [], total: 1 }, factura).ok,
    false,
  );
  assertEquals(
    validateERPDuplicateSearchResponse({ items: [{}], total: 1 }, factura).ok,
    false,
  );
  assertEquals(
    validateERPDuplicateSearchResponse({
      items: [{ ...exactCandidate, FRR_idproveedor: 18 }],
      total: 1,
    }, factura).ok,
    false,
  );
  assertEquals(
    validateERPDuplicateSearchResponse({
      items: [{ ...exactCandidate, FRR_tipofactura: "GE" }],
      total: 1,
    }, factura).ok,
    false,
  );
  assertEquals(
    validateERPDuplicateSearchResponse({
      items: [{ ...exactCandidate, FRR_tipofactura: "MA" }],
      total: 1,
    }, factura).ok,
    true,
  );

  assertEquals(validateERPDuplicateSearchResponse({
    items: [exactCandidate],
    total: 1,
  }, factura), {
    ok: true,
    total: 1,
    candidates: [exactCandidate],
    error: null,
  });
});

Deno.test("consulta de ejercicio se limita a una identidad ERP verificable sin confiar en n8n", () => {
  const consulta = buildFacturaERPExerciseLookupConsulta({
    FRR_Idempresa: 1,
    FRR_idproveedor: 893,
    FRR_numerofactura: "A/1036",
    FRR_fechafactura: "07/06/2026",
    FRR_tipofactura: "OT",
  }, "acreedor");

  assert(consulta);
  const url = new URL(consulta, "https://erp.invalid/");
  assertEquals(url.pathname, "/facturasrecibidas/buscar");
  assertEquals(url.searchParams.get("empresa_id"), "1");
  assertEquals(url.searchParams.get("proveedor_id"), "893");
  assertEquals(url.searchParams.get("numero_factura"), "A/1036");
  assertEquals(url.searchParams.get("fecha_factura"), "2026-06-07");
  assertEquals(url.searchParams.get("tipo_factura"), "OT");
  assertEquals(url.searchParams.get("limit"), "200");
  assertEquals(url.searchParams.get("offset"), "0");
  assertEquals(url.searchParams.has("ejercicio"), false);
  assertEquals(isAllowedERPConsulta(consulta), true);

  assertEquals(buildFacturaERPExerciseLookupConsulta({
    FRR_Idempresa: 1,
    FRR_idproveedor: 893,
    FRR_numerofactura: "A/1036",
    FRR_fechafactura: "2026-06-07",
    FRR_tipofactura: "OT",
    FRR_ejercicio: 25,
  }, "acreedor"), null);
  assertEquals(buildFacturaERPExerciseLookupConsulta({
    FRR_Idempresa: 1,
    FRR_idproveedor: 893,
    FRR_numerofactura: "A/1036",
    FRR_fechafactura: "2026-06-07",
    FRR_tipofactura: "OT",
  }, "agricultor"), null);
});

Deno.test("ejercicio solo se propaga desde una factura ERP exacta y unica", () => {
  const factura = {
    FRR_Idempresa: 1,
    FRR_idproveedor: 893,
    FRR_numerofactura: "A/1036",
    FRR_fechafactura: "2026-06-07",
    FRR_tipofactura: "OT",
  };
  const resolution = resolveFacturaERPExerciseFromExactInvoice(
    factura,
    "acreedor",
    {
      items: [{
        id: 49097,
        empresa_id: 1,
        ejercicio: 25,
        proveedor_id: 893,
        numero_factura: " a-1036 ",
        fecha_factura: "2026-06-07",
        tipo_factura: "ot",
      }],
      limit: 200,
      offset: 0,
      total: 1,
    },
  );

  assertEquals(resolution.factura.FRR_ejercicio, 25);
  assertEquals(resolution.applied, { FRR_ejercicio: 25 });
  assertEquals(resolution.issues, []);
  assertEquals(resolution.evidence?.status, "applied");
  assertEquals(resolution.evidence?.remote_frr_id, 49097);
  assertEquals("FRR_ejercicio" in factura, false);
});

Deno.test("cero, ambiguas, otro circuito o pagina incompleta dejan ejercicio sin resolver", () => {
  const factura = {
    FRR_Idempresa: 1,
    FRR_idproveedor: 893,
    FRR_numerofactura: "A/1036",
    FRR_fechafactura: "2026-06-07",
    FRR_tipofactura: "OT",
  };
  const exact = {
    id: 49097,
    empresa_id: 1,
    ejercicio: 25,
    proveedor_id: 893,
    numero_factura: "A-1036",
    fecha_factura: "2026-06-07",
    tipo_factura: "OT",
  };

  const notFound = resolveFacturaERPExerciseFromExactInvoice(
    factura,
    "acreedor",
    { items: [], total: 0 },
  );
  const ambiguous = resolveFacturaERPExerciseFromExactInvoice(
    factura,
    "acreedor",
    { items: [exact, { ...exact, id: 49098 }], total: 2 },
  );
  const otherCircuit = resolveFacturaERPExerciseFromExactInvoice(
    factura,
    "acreedor",
    { items: [{ ...exact, tipo_factura: "GE" }], total: 1 },
  );
  const incompletePage = resolveFacturaERPExerciseFromExactInvoice(
    factura,
    "acreedor",
    { items: [exact], total: 2 },
  );
  const incompleteCandidate = resolveFacturaERPExerciseFromExactInvoice(
    factura,
    "acreedor",
    { items: [{ ...exact, empresa_id: null }], total: 1 },
  );

  for (const resolution of [
    notFound,
    ambiguous,
    otherCircuit,
    incompletePage,
    incompleteCandidate,
  ]) {
    assertEquals(resolution.factura.FRR_ejercicio, undefined);
    assertEquals(resolution.applied, {});
  }
  assertEquals(notFound.evidence?.status, "not_found");
  assertEquals(ambiguous.evidence?.status, "ambiguous");
  assertEquals(otherCircuit.evidence?.status, "not_found");
  assertEquals(incompletePage.evidence?.status, "invalid_response");
  assertEquals(incompleteCandidate.evidence?.status, "invalid_candidate");
});

Deno.test("el circuito GE tambien exige coincidencia exacta antes de recuperar ejercicio", () => {
  const factura = {
    FRR_Idempresa: 1,
    FRR_idproveedor: 1957,
    FRR_numerofactura: "FTV26/217",
    FRR_fechafactura: "2026-07-15",
    FRR_tipofactura: "GE",
  };
  const resolution = resolveFacturaERPExerciseFromExactInvoice(
    factura,
    "agricultor",
    {
      items: [{
        id: 51602,
        empresa_id: 1,
        ejercicio: 25,
        proveedor_id: 1957,
        numero_factura: "FTV26-217",
        fecha_factura: "2026-07-15",
        tipo_factura: "GE",
      }],
      total: 1,
    },
  );

  assertEquals(resolution.factura.FRR_ejercicio, 25);
  assertEquals(resolution.applied, { FRR_ejercicio: 25 });
});

Deno.test("reglas contables aplican precedencia proveedor sobre empresa y completan solo vacios", () => {
  const resolution = resolveFacturaERPAccountingRules({
    FRR_Idempresa: 1,
    FRR_idproveedor: 17,
    FRR_fechafactura: "2026-06-30",
  }, [
    {
      empresa_id: 1,
      proveedor_id: null,
      ejercicio_erp: 25,
      tipo_factura: "GE",
      regimen_id: 1110,
      fecha_ctb_policy: "manual",
      activo: true,
    },
    {
      empresa_id: 1,
      proveedor_id: 17,
      ejercicio_erp: null,
      tipo_factura: "OT",
      regimen_id: 2110,
      fecha_ctb_policy: "invoice_date",
      activo: true,
    },
  ], "acreedor");

  assertEquals(resolution.factura.FRR_ejercicio, 25);
  assertEquals(resolution.factura.FRR_tipofactura, "OT");
  assertEquals(resolution.factura.FRR_idregimen, 2110);
  assertEquals(resolution.factura.FRR_fechactb, "2026-06-30");
  assertEquals(resolution.applied, {
    FRR_ejercicio: 25,
    FRR_tipofactura: "OT",
    FRR_idregimen: 2110,
    FRR_fechactb: "2026-06-30",
  });
  assertEquals(resolution.issues, []);
});

Deno.test("una politica CTB nula de proveedor hereda la regla general", () => {
  const resolution = resolveFacturaERPAccountingRules({
    FRR_Idempresa: 1,
    FRR_idproveedor: 17,
    FRR_fechafactura: "2026-06-30",
  }, [
    {
      empresa_id: 1,
      proveedor_id: null,
      fecha_ctb_policy: "invoice_date",
      activo: true,
    },
    {
      empresa_id: 1,
      proveedor_id: 17,
      tipo_factura: "OT",
      fecha_ctb_policy: null,
      activo: true,
    },
  ], "acreedor");

  assertEquals(resolution.factura.FRR_fechactb, "2026-06-30");
  assertEquals(resolution.factura.FRR_tipofactura, "OT");
  assertEquals(resolution.issues, []);
});

Deno.test("carga de reglas aplica defaults solo tras confirmar el acreedor ERP", async () => {
  const ruleRows = [{
    empresa_id: 1,
    proveedor_id: null,
    ejercicio_erp: 25,
    tipo_factura: null,
    regimen_id: 2110,
    fecha_ctb_policy: "invoice_date",
    cuenta_gasto_default: "60200000001",
    concepto_template: "FRA. {proveedor}",
    contabilizar_default: "S",
    activo: true,
  }];
  const query = {
    data: ruleRows,
    error: null,
    select() {
      return this;
    },
    eq() {
      return this;
    },
    or() {
      return this;
    },
    is() {
      return this;
    },
  };
  const consultas: string[] = [];
  const resolution = await loadAndResolveFacturaERPAccountingRules(
    { from: () => query } as never,
    {
      FRR_Idempresa: 1,
      FRR_idproveedor: 17,
      FRR_idcuenta: "41000000017",
      FRR_fechafactura: "2026-06-30",
      FRR_base1: 100,
      FRR_iva1: 21,
      FRR_cuota1: 21,
      FRR_totalfac: 121,
    },
    "acreedor",
    {
      readERP: (consulta) => {
        consultas.push(consulta);
        return Promise.resolve({
          id: 17,
          nombre: "ONDUSPAN, S.A.",
          cuenta_id: "41000000017",
          activo: true,
          bloqueado: false,
          inactivo_rgpd: false,
        });
      },
    },
  );

  assertEquals(consultas, ["acreedores/17"]);
  assertEquals(resolution.issues, []);
  assertEquals(resolution.factura.FRR_ejercicio, 25);
  assertEquals(resolution.factura.FRR_tipofactura, "OT");
  assertEquals(resolution.factura.FRR_idregimen, 2110);
  assertEquals(resolution.factura.FRR_fechactb, "2026-06-30");
  assertEquals(resolution.factura.FRR_ctagasto1, "60200000001");
  assertEquals(resolution.factura.FRR_igasto1, 100);
  assertEquals(resolution.factura.FRR_Concepto, "FRA. ONDUSPAN, S.A.");
  assertEquals(
    resolution.factura.FRR_ObservacionesAEAT,
    "FRA. ONDUSPAN, S.A.",
  );
  assertEquals(resolution.factura.FRR_Contabilizar, "S");
});

Deno.test("reglas contables nunca sobrescriben valores explicitos y exponen conflictos bloqueantes", () => {
  const resolution = resolveFacturaERPAccountingRules({
    FRR_Idempresa: 1,
    FRR_idproveedor: 17,
    FRR_ejercicio: 26,
    FRR_tipofactura: "OT",
    FRR_idregimen: 2110,
    FRR_fechafactura: "2026-06-30",
    FRR_fechactb: "2026-07-01",
  }, [{
    empresa_id: 1,
    proveedor_id: 17,
    ejercicio_erp: 25,
    tipo_factura: "OT",
    regimen_id: 2110,
    fecha_ctb_policy: "invoice_date",
    activo: true,
  }]);

  assertEquals(resolution.factura.FRR_ejercicio, 26);
  assertEquals(resolution.factura.FRR_fechactb, "2026-07-01");
  assertEquals(resolution.applied, {});
  assertEquals(resolution.issues.map((issue) => issue.field), ["FRR_ejercicio", "FRR_fechactb"]);
  assert(resolution.issues.every((issue) => issue.severity === "error"));
});

Deno.test("politica CTB manual no deduce fecha e ignora reglas inactivas", () => {
  const resolution = resolveFacturaERPAccountingRules({
    FRR_Idempresa: 1,
    FRR_idproveedor: 17,
    FRR_fechafactura: "2026-06-30",
  }, [
    {
      empresa_id: 1,
      proveedor_id: null,
      ejercicio_erp: 25,
      fecha_ctb_policy: "manual",
      activo: true,
    },
    {
      empresa_id: 1,
      proveedor_id: 17,
      ejercicio_erp: 99,
      fecha_ctb_policy: "invoice_date",
      activo: false,
    },
  ], "acreedor");

  assertEquals(resolution.factura.FRR_ejercicio, 25);
  assertEquals(resolution.factura.FRR_tipofactura, "OT");
  assertEquals(resolution.factura.FRR_fechactb, undefined);
  assertEquals(resolution.applied, {
    FRR_tipofactura: "OT",
    FRR_ejercicio: 25,
  });
  assertEquals(resolution.issues, []);
});

Deno.test("el circuito confirmado del proveedor materializa OT o GE cuando falta tipo factura", () => {
  const acreedor = resolveFacturaERPAccountingRules({
    FRR_idproveedor: 17,
  }, [], "acreedor");
  const agricultor = resolveFacturaERPAccountingRules({
    FRR_Idempresa: 1,
    FRR_idproveedor: 1957,
  }, [], "agricultor");

  assertEquals(acreedor.factura.FRR_tipofactura, "OT");
  assertEquals(acreedor.applied, { FRR_tipofactura: "OT" });
  assertEquals(acreedor.issues, []);
  assertEquals(agricultor.factura.FRR_tipofactura, "GE");
  assertEquals(agricultor.applied, { FRR_tipofactura: "GE" });
  assertEquals(agricultor.issues, []);
});

Deno.test("el circuito confirmado nunca sobrescribe un tipo factura explicito", () => {
  const resolution = resolveFacturaERPAccountingRules({
    FRR_Idempresa: 1,
    FRR_idproveedor: 17,
    FRR_tipofactura: "OT",
  }, [], "acreedor");

  assertEquals(resolution.factura.FRR_tipofactura, "OT");
  assertEquals(resolution.applied, {});
  assertEquals(resolution.issues, []);
});

Deno.test("reglas activas incompatibles conservan el circuito confirmado y reportan el conflicto", () => {
  const resolution = resolveFacturaERPAccountingRules({
    FRR_Idempresa: 1,
    FRR_idproveedor: 17,
  }, [
    { empresa_id: 1, proveedor_id: 17, tipo_factura: "OT", activo: true },
    { empresa_id: 1, proveedor_id: 17, tipo_factura: "MA", activo: true },
  ], "acreedor");

  assertEquals(resolution.factura.FRR_tipofactura, "OT");
  assertEquals(resolution.applied, { FRR_tipofactura: "OT" });
  assertEquals(resolution.issues.length, 1);
  assertEquals(resolution.issues[0].field, "FRR_tipofactura");
  assertEquals(resolution.issues[0].severity, "error");
});

Deno.test("una regla de acreedor no se aplica a un agricultor con el mismo id", () => {
  const rows = [
    {
      empresa_id: 1,
      proveedor_id: null,
      ejercicio_erp: 25,
      activo: true,
    },
    {
      empresa_id: 1,
      proveedor_id: 17,
      tipo_factura: "OT",
      regimen_id: 2110,
      activo: true,
    },
  ];
  const agricultorResolution = resolveFacturaERPAccountingRules({
    FRR_Idempresa: 1,
    FRR_idproveedor: 17,
    FRR_tipofactura: "GE",
  }, rows, "agricultor");
  const unknownResolution = resolveFacturaERPAccountingRules({
    FRR_Idempresa: 1,
    FRR_idproveedor: 17,
  }, rows);

  assertEquals(agricultorResolution.factura.FRR_ejercicio, 25);
  assertEquals(agricultorResolution.factura.FRR_tipofactura, "GE");
  assertEquals(agricultorResolution.factura.FRR_idregimen, undefined);
  assertEquals(unknownResolution.factura.FRR_ejercicio, 25);
  assertEquals(unknownResolution.factura.FRR_tipofactura, undefined);
  assertEquals(unknownResolution.factura.FRR_idregimen, undefined);
});

Deno.test("la cabecera confirmada gana al hint y una discrepancia queda bloqueada", () => {
  const resolution = resolveFacturaERPAccountingRules({
    FRR_Idempresa: 1,
    FRR_idproveedor: 17,
    FRR_tipofactura: "GE",
  }, [{
    empresa_id: 1,
    proveedor_id: 17,
    regimen_id: 2110,
    activo: true,
  }], "acreedor");

  assertEquals(resolution.factura.FRR_tipofactura, "GE");
  assertEquals(resolution.factura.FRR_idregimen, undefined);
  assertEquals(resolution.issues, [{
    field: "FRR_tipofactura",
    message:
      "El tipo de factura confirmado no coincide con el maestro de proveedor sugerido por la extraccion.",
    severity: "error",
  }]);
});

Deno.test("una regla tipo_factura incompatible con el circuito confirmado queda bloqueada", () => {
  const acreedor = resolveFacturaERPAccountingRules({
    FRR_Idempresa: 1,
    FRR_idproveedor: 17,
  }, [{
    empresa_id: 1,
    proveedor_id: null,
    tipo_factura: "ge",
    activo: true,
  }], "acreedor");
  const agricultor = resolveFacturaERPAccountingRules({
    FRR_Idempresa: 1,
    FRR_idproveedor: 1957,
  }, [{
    empresa_id: 1,
    proveedor_id: null,
    tipo_factura: "OT",
    activo: true,
  }], "agricultor");

  for (const [resolution, tipoFactura] of [
    [acreedor, "OT"],
    [agricultor, "GE"],
  ] as const) {
    assertEquals(resolution.factura.FRR_tipofactura, tipoFactura);
    assertEquals(resolution.applied, { FRR_tipofactura: tipoFactura });
    assertEquals(resolution.issues.length, 1);
    assertEquals(resolution.issues[0].field, "FRR_tipofactura");
    assertEquals(resolution.issues[0].severity, "error");
  }
});

Deno.test("el conflicto cabecera-match se conserva aunque falte empresa", () => {
  const resolution = resolveFacturaERPAccountingRules({
    FRR_tipofactura: "GE",
  }, [], "acreedor");

  assertEquals(resolution.factura.FRR_tipofactura, "GE");
  assertEquals(resolution.applied, {});
  assertEquals(resolution.issues.map((issue) => issue.field), ["FRR_tipofactura"]);
});

Deno.test("firma IVA usa solo tramos activos, ordena y colapsa tipos repetidos", () => {
  assertEquals(getFacturaActiveIvaSignature({
    FRR_base1: 100,
    FRR_iva1: 21,
    FRR_cuota1: 21,
    FRR_base2: 25,
    FRR_iva2: 10,
    FRR_cuota2: 2.5,
    FRR_base3: 5,
    FRR_iva3: 21,
    FRR_cuota3: 1.05,
    FRR_base4: 0,
    FRR_iva4: 4,
    FRR_cuota4: 0,
    FRR_base5: 0.001,
    FRR_iva5: 5,
    FRR_cuota5: 0,
  }), [10, 21]);

  assertEquals(getFacturaActiveIvaSignature({
    FRR_base1: 100,
    FRR_cuota1: 21,
  }), null);
});

Deno.test("consulta de regimen envia empresa, circuito y los tramos al endpoint permitido", () => {
  const built = buildFacturaERPRegimenSuggestionConsulta({
    FRR_Idempresa: 1,
    FRR_idproveedor: 17,
    FRR_base1: 100,
    FRR_iva1: 21,
    FRR_cuota1: 21,
  }, "acreedor");

  assert(built);
  assertEquals(built.signature, [21]);
  assert(built.consulta.includes("empresa_id=1"));
  assert(built.consulta.includes("proveedor_id=17"));
  assert(built.consulta.includes("proveedor_tipo=acreedor"));
  assert(built.consulta.includes("iva1=21"));
  assertEquals(isAllowedERPConsulta(built.consulta), true);
});

const regimenSuggestionPayload = ({
  topUses,
  alternativeUses,
  estado = "sugerido",
  empresaId = 1,
  proveedorId = 17,
  proveedorTipo = "acreedor",
}: {
  topUses: number;
  alternativeUses?: number;
  estado?: string;
  empresaId?: number;
  proveedorId?: number;
  proveedorTipo?: string;
}) => {
  const total = topUses + (alternativeUses ?? 0);
  const confidence = topUses / total;
  const recuentos = [
    { regimen_id: 2110, usos: topUses, confianza: confidence },
    ...(alternativeUses
      ? [{ regimen_id: 2210, usos: alternativeUses, confianza: alternativeUses / total }]
      : []),
  ];
  return {
    filtros: {
      empresa_id: empresaId,
      proveedor_id: proveedorId,
      proveedor_tipo: proveedorTipo,
    },
    firma_iva: [21],
    total_historicos_evaluados: total,
    total_historicos_coincidentes: total,
    estado,
    recuentos,
    sugerencia: estado === "sugerido"
      ? {
        regimen_id: 2110,
        usos: topUses,
        confianza: confidence,
        criterio: "historico_mismo_proveedor_empresa_circuito_y_firma_iva",
      }
      : null,
  };
};

const facturaRegimenTest = {
  FRR_Idempresa: 1,
  FRR_idproveedor: 17,
  FRR_base1: 100,
  FRR_iva1: 21,
  FRR_cuota1: 21,
};

Deno.test("historico 99 de 100 aplica el regimen con evidencia auditable", () => {
  const resolution = resolveFacturaERPRegimenFromHistory(
    facturaRegimenTest,
    "acreedor",
    regimenSuggestionPayload({ topUses: 99, alternativeUses: 1 }),
  );

  assertEquals(resolution.factura.FRR_idregimen, 2110);
  assertEquals(resolution.applied, { FRR_idregimen: 2110 });
  assertEquals(resolution.issues, []);
  assertEquals(resolution.evidence?.status, "applied");
  assertEquals(resolution.evidence?.confianza, 0.99);
});

Deno.test("historico por debajo del 98 por ciento no se autoaplica aunque el upstream lo sugiera", () => {
  const resolution = resolveFacturaERPRegimenFromHistory(
    facturaRegimenTest,
    "acreedor",
    regimenSuggestionPayload({ topUses: 97, alternativeUses: 3 }),
  );

  assertEquals(resolution.factura.FRR_idregimen, undefined);
  assertEquals(resolution.applied, {});
  assertEquals(resolution.evidence?.status, "rejected_inconsistent_response");
  assertEquals(resolution.issues[0]?.severity, "warning");
});

Deno.test("historico insuficiente o ambiguo deja el regimen para revision", () => {
  const resolution = resolveFacturaERPRegimenFromHistory(
    facturaRegimenTest,
    "acreedor",
    regimenSuggestionPayload({
      topUses: 2,
      estado: "sin_historial_suficiente",
    }),
  );

  assertEquals(resolution.factura.FRR_idregimen, undefined);
  assertEquals(resolution.applied, {});
  assertEquals(resolution.issues, []);
  assertEquals(resolution.evidence?.status, "sin_historial_suficiente");
});

Deno.test("respuesta historica de otro proveedor se rechaza y un regimen existente nunca se pisa", () => {
  const mismatched = resolveFacturaERPRegimenFromHistory(
    facturaRegimenTest,
    "acreedor",
    regimenSuggestionPayload({ topUses: 10, proveedorId: 18 }),
  );
  assertEquals(mismatched.factura.FRR_idregimen, undefined);
  assertEquals(mismatched.evidence?.status, "rejected_inconsistent_response");

  const existing = resolveFacturaERPRegimenFromHistory(
    { ...facturaRegimenTest, FRR_idregimen: 3110 },
    "acreedor",
    regimenSuggestionPayload({ topUses: 100 }),
  );
  assertEquals(existing.factura.FRR_idregimen, 3110);
  assertEquals(existing.applied, {});
  assertEquals(existing.evidence?.status, "skipped_existing_value");
});

Deno.test("la evidencia contable refleja la cabecera resuelta sin perder la auditoria original", () => {
  const originalEvidence = {
    api: { attempts: [{ path: "/acreedores", ok: true }] },
    proveedor: { matched: true, provider_id: 17, entity_type: "acreedor" },
    ejercicio: { source: "edge_rule", resolved: false, value: null, nota: "raw" },
    tipo_factura: { source: "edge_rule", resolved: false, value: null },
    regimen: {
      source: "edge_rule",
      resolved: false,
      value: null,
      ranking: [{ value: 2110, count: 130 }],
    },
    fecha_ctb: {
      source: "edge_rule_or_manual",
      policy: "manual",
      resolved: false,
      value: null,
      nota: "raw",
    },
    erp_rules: { source: "supabase_edge", required: true, resolved: false },
    erp_accounting: { source: "erp_history", status: "previous" },
  };
  const originalSnapshot = structuredClone(originalEvidence);
  const resolution = {
    factura: {
      FRR_fechafactura: "2026-05-15",
      FRR_fechactb: "2026-05-15",
      FRR_ejercicio: 25,
      FRR_tipofactura: "OT",
      FRR_idregimen: 2110,
    },
    applied: {
      FRR_fechactb: "2026-05-15",
      FRR_ejercicio: 25,
      FRR_tipofactura: "OT",
      FRR_idregimen: 2110,
    },
    issues: [],
    evidence: {
      source: "erp_history",
      status: "applied",
      regimen_id: 2110,
      total_historicos: 130,
    },
  };

  const synchronized = syncFacturaERPAccountingMatchEvidence(
    originalEvidence,
    resolution,
  );

  assertEquals(synchronized.api, originalEvidence.api);
  assertEquals(synchronized.proveedor, originalEvidence.proveedor);
  assertEquals(synchronized.ejercicio, {
    source: "supabase_edge_rule",
    resolved: true,
    value: 25,
    nota: "raw",
  });
  assertEquals(synchronized.tipo_factura, {
    source: "supabase_edge",
    resolved: true,
    value: "OT",
  });
  assertEquals(synchronized.regimen, {
    source: "erp_history",
    resolved: true,
    value: 2110,
    ranking: [{ value: 2110, count: 130 }],
  });
  assertEquals(synchronized.fecha_ctb, {
    source: "supabase_edge_rule",
    policy: "invoice_date",
    resolved: true,
    value: "2026-05-15",
    nota: "raw",
  });
  assertEquals(synchronized.erp_rules, {
    source: "supabase_edge",
    required: true,
    resolved: true,
    pending_fields: [],
  });
  assertEquals(synchronized.erp_accounting, resolution.evidence);
  assertEquals(originalEvidence, originalSnapshot);
});

Deno.test("la sincronizacion conserva erp_accounting previo y enumera solo campos pendientes", () => {
  const existingAccounting = {
    source: "erp_history",
    status: "applied",
    regimen_id: 2110,
  };
  const synchronized = syncFacturaERPAccountingMatchEvidence({
    ejercicio: { source: "edge_rule", resolved: false, value: null },
    tipo_factura: { source: "edge_rule", resolved: false, value: null },
    regimen: { source: "edge_rule", resolved: false, value: null, muestra: 2 },
    fecha_ctb: {
      source: "edge_rule_or_manual",
      policy: "manual",
      resolved: false,
      value: null,
    },
    erp_accounting: existingAccounting,
  }, {
    factura: {
      FRR_ejercicio: 25,
      FRR_fechafactura: "2026-07-29",
      FRR_fechactb: "2026-07-29",
    },
    applied: {},
    issues: [],
  });

  assertEquals(synchronized.ejercicio, {
    source: "edge_rule",
    resolved: true,
    value: 25,
  });
  assertEquals(synchronized.fecha_ctb, {
    source: "edge_rule_or_manual",
    policy: "manual",
    resolved: true,
    value: "2026-07-29",
  });
  assertEquals(synchronized.tipo_factura, {
    source: "edge_rule",
    resolved: false,
    value: null,
  });
  assertEquals(synchronized.regimen, {
    source: "edge_rule",
    resolved: false,
    value: null,
    muestra: 2,
  });
  assertEquals(synchronized.erp_rules, {
    source: "supabase_edge",
    resolved: false,
    pending_fields: ["FRR_tipofactura", "FRR_idregimen"],
  });
  assertEquals(synchronized.erp_accounting, existingAccounting);
});

Deno.test("la evidencia distingue el ejercicio verificado en factura ERP exacta", () => {
  const synchronized = syncFacturaERPAccountingMatchEvidence({
    ejercicio: { source: "edge_rule", resolved: false, value: null },
  }, {
    factura: {
      FRR_ejercicio: 25,
      FRR_tipofactura: "OT",
      FRR_idregimen: 2110,
      FRR_fechafactura: "2026-06-07",
      FRR_fechactb: "2026-06-07",
    },
    applied: {
      FRR_ejercicio: 25,
      FRR_tipofactura: "OT",
      FRR_idregimen: 2110,
      FRR_fechactb: "2026-06-07",
    },
    issues: [],
    evidence: {
      source: "erp_history",
      status: "applied",
      ejercicio: {
        source: "erp_exact_invoice",
        status: "applied",
        remote_frr_id: 49097,
        ejercicio: 25,
      },
    },
  });

  assertEquals(synchronized.ejercicio, {
    source: "erp_exact_invoice",
    resolved: true,
    value: 25,
  });
});
