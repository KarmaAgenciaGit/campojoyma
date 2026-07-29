import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const workflowPath = path.join(
  root,
  'docs',
  'n8n',
  'campojoyma-factura-recibida-extraccion-segura-v2.json',
);
const workflow = JSON.parse(fs.readFileSync(workflowPath, 'utf8'));
const systemPrompt = workflow.nodes.find(
  (node) => node.name === 'AI Agent',
)?.parameters?.options?.systemMessage ?? '';
assert.equal(
  workflow.nodes.find((node) => node.name === '5.6 LUNA')?.parameters?.options
    ?.timeout,
  120000,
  'Las facturas multipagina deben disponer de tiempo para una segunda inspeccion.',
);
assert.equal(
  workflow.nodes.find((node) => node.name === '5.6 LUNA')?.parameters
    ?.responsesApiEnabled,
  true,
  'El modelo debe conservar Responses API para el razonamiento documental.',
);
assert.equal(
  workflow.nodes.find((node) => node.name === '5.6 LUNA')?.parameters?.options
    ?.textFormat?.textOptions?.type,
  'json_object',
  'Responses API debe garantizar JSON valido antes de validar el esquema.',
);
assert.equal(
  workflow.nodes.find((node) => node.name === '5.6 LUNA')?.parameters?.options
    ?.responseFormat,
  undefined,
  'No debe conservarse el parametro de Chat Completions cuando se usa Responses API.',
);
assert.match(
  systemPrompt,
  /Conserva cada fila fiscal visible[\s\S]*no las agregues/,
  'El agente debe conservar filas fiscales repetidas en lugar de agregarlas.',
);
assert.match(
  systemPrompt,
  /Cant\.Uni[\s\S]*no uses el numero de envases como cantidad/,
  'El agente debe extraer la cantidad facturable, no el numero de envases.',
);
assert.match(
  systemPrompt,
  /Prefijos como "01"[\s\S]*no son origen MA\/GE/,
  'Los prefijos documentales no pueden reinterpretarse como origen MA/GE.',
);
assert.match(
  systemPrompt,
  /factura\.descuento_total[\s\S]*magnitud positiva a restar/,
  'El agente debe separar los descuentos globales impresos del IVA y de las lineas.',
);
assert.match(
  systemPrompt,
  /Hoja n\/m[\s\S]*SUMA Y SIGUE[\s\S]*suma del array lineas/,
  'Las tablas multipagina deben reconciliarse con sus subtotales usando las filas extraidas.',
);
assert.match(
  systemPrompt,
  /texto vertical o rotado en los margenes[\s\S]*NIF fiscal del emisor/,
  'El agente debe revisar el texto legal marginal antes de declarar ausente el NIF.',
);
assert.match(
  systemPrompt,
  /identificador del proveedor rotulado "Albaran"[\s\S]*referencia_albaran[\s\S]*"475545 2"[\s\S]*solo "475545"/,
  'El albaran externo del proveedor debe mapearse a Ref sin incorporar la posicion de linea.',
);
assert.match(
  systemPrompt,
  /No concatenes el albaran, su posicion de linea y el codigo de articulo/,
  'Las tres identidades visibles de una linea no pueden mezclarse en una referencia generica.',
);
assert.match(
  systemPrompt,
  /"EUR \(1000 u\.\)"[\s\S]*cantidad es 1300 u\.[\s\S]*precio_unitario es 1,072/,
  'La escala por mil del precio no puede reducir la cantidad facturable.',
);
assert.match(
  systemPrompt,
  /referencia_albaran="475545"[\s\S]*lineas\.referencia="215039"/,
  'El codigo de producto independiente debe conservarse sin contaminar la referencia de albaran.',
);
const parserNode = workflow.nodes.find(
  (node) => node.name === 'Structured Output Parser',
);
const parserSchema = JSON.parse(parserNode?.parameters?.inputSchema ?? '{}');
assert.equal(
  parserNode?.parameters?.autoFix,
  false,
  'El parser debe rechazar una salida invalida sin pedir a otro paso IA que la reescriba.',
);
assert.equal(
  parserNode?.parameters?.customizeRetryPrompt,
  false,
  'El parser no debe conservar un reintento generativo.',
);
assert.equal(parserNode?.parameters?.prompt, undefined);
assert.deepEqual(
  workflow.connections?.['5.6 LUNA']?.ai_languageModel?.[0],
  [
    {
      node: 'AI Agent',
      type: 'ai_languageModel',
      index: 0,
    },
  ],
  'El modelo solo puede alimentar al agente documental.',
);
assert.equal(
  workflow.nodes.filter(
    (node) => node.type === 'n8n-nodes-base.httpRequestTool',
  ).length,
  0,
  'El PDF no puede controlar tools HTTP del agente.',
);
assert(
  Object.values(workflow.connections ?? {}).every(
    (outputs) => !Object.prototype.hasOwnProperty.call(outputs, 'ai_tool'),
  ),
  'No deben quedar conexiones ai_tool.',
);
const pdfRenderNode = workflow.nodes.find((node) => node.name === 'PDF a imagenes');
assert.equal(pdfRenderNode?.parameters?.authentication, 'genericCredentialType');
assert.equal(pdfRenderNode?.parameters?.genericAuthType, 'httpHeaderAuth');
assert.equal(pdfRenderNode?.parameters?.headerParameters, undefined);
assert.equal(
  pdfRenderNode?.credentials?.httpHeaderAuth?.name,
  'Campojoyma PDF renderer token',
  'La autorizacion del renderizador debe vivir en el almacen de credenciales de n8n.',
);
assert.deepEqual(
  parserSchema.properties?.lineas?.items?.required,
  ['pagina'],
  'Los campos contables no impresos de una linea deben ser opcionales en el parser.',
);
assert(
  parserSchema.properties?.factura?.required?.includes('descuento_total'),
  'El contrato debe devolver descuento_total de forma explicita, aunque sea null.',
);
const normalizerCode = workflow.nodes.find(
  (node) => node.name === 'Normalizar salida IA literal',
)?.parameters?.jsCode ?? '';
assert.match(
  normalizerCode,
  /descripcion: readString\(linea\?\.descripcion \?\? linea\?\.articulo\)/,
  'La columna visible Articulo debe poder alimentar la descripcion literal.',
);
assert.match(
  normalizerCode,
  /Se descarto el origen.*evidencia literal/s,
  'MA y GE no pueden conservarse sin evidencia literal impresa.',
);
assert.match(
  normalizerCode,
  /const computedLineTotal = visibleLineAmounts\.reduce/,
  'La suma de lineas debe comprobarse de forma determinista.',
);
assert.match(
  normalizerCode,
  /const matchesBase =[\s\S]*const matchesInvoiceTotal =[\s\S]*const matchesBaseAfterGlobalDiscount =[\s\S]*!matchesBaseAfterGlobalDiscount/,
  'Las lineas deben contrastarse con base, total y descuento global impreso.',
);
assert.match(
  normalizerCode,
  /amountAppearsInPrintedEvidence[\s\S]*Se descartaron[\s\S]*bases de linea no impresas/,
  'Las bases de linea calculadas y no impresas deben descartarse.',
);
assert.match(
  normalizerCode,
  /warnings\.splice\(index, 1\)/,
  'Los juicios aritmeticos no verificados del modelo deben descartarse.',
);
assert.match(
  normalizerCode,
  /isTautologicalAmountWarning/,
  'Las comparaciones monetarias tautologicas no deben llegar a revision.',
);
const enrichmentCode = workflow.nodes.find(
  (node) => node.name === 'Enriquecer por API Campojoyma',
)?.parameters?.jsCode;
assert.equal(typeof enrichmentCode, 'string');
assert.match(enrichmentCode, /const extractionSchemaVersion =/);
assert.match(
  enrichmentCode,
  /provisionalProviderWarningKeys[\s\S]*!provider \|\|[\s\S]*!provisionalProviderWarningKeys\.has/,
  'Solo los avisos exactos del lookup provisional pueden retirarse tras resolver proveedor.',
);
assert.match(
  enrichmentCode,
  /providerLegalForms[\s\S]*legal_suffix_family[\s\S]*coreNameQuery/,
  'Las diferencias SL\/SLU o SA\/SAU deben resolverse solo mediante un nucleo empresarial exacto.',
);
assert.match(
  enrichmentCode,
  /const separatedNif =[\s\S]*nif\.slice\(0, 1\) \+ '-' \+ nif\.slice\(1\)/,
  'La busqueda debe probar una variante determinista del NIF con separador.',
);
assert.match(
  enrichmentCode,
  /normalizeProviderSearchQuery[\s\S]*const distinctiveNameQuery =[\s\S]*await searchNameVariant\(distinctiveNameQuery\)/,
  'El fallback de nombre debe eliminar diacriticos y poder usar un fragmento distintivo.',
);
assert.match(
  enrichmentCode,
  /comparison\.mode === 'legal_suffix_family'[\s\S]*normalizeNif\(candidate\.nif\) !== nif/,
  'Una equivalencia de forma juridica debe cerrarse si contradice un NIF visible.',
);
assert.match(
  enrichmentCode,
  /descuento_total: readNumber\(literal\.descuento_total\)/,
  'El descuento global literal debe llegar a la extraccion final.',
);
assert.match(
  enrichmentCode,
  /let ejercicio = null;/,
  'El ejercicio debe empezar sin resolver y solo mutar con evidencia ERP segura.',
);
assert.match(
  enrichmentCode,
  /if \(existingCandidates\.length === 1\) \{[\s\S]*?ejercicio = readPositiveInteger\(firstValue\(exactExistingInvoice, \[[\s\S]*?'FRR_ejercicio',[\s\S]*?'ejercicio',[\s\S]*?\]\)\);/,
  'El ejercicio solo puede copiarse desde una factura ERP exacta y unica.',
);
assert.match(
  enrichmentCode,
  /evidence\.ejercicio = \{[\s\S]*?existing_erp_invoice_exact_unique[\s\S]*?resolved: ejercicio !== null,[\s\S]*?value: ejercicio/,
  'La evidencia debe distinguir el ejercicio recuperado de una factura ERP exacta.',
);
assert.doesNotMatch(
  enrichmentCode,
  /line\?\.referencia(?:,|\])/,
  'El matching v4 no puede promover la referencia comercial genérica de una línea.',
);

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const grossLineNormalizerResult = await new AsyncFunction(
  '$json',
  '$',
  normalizerCode,
)(
  {
    output: JSON.stringify({
      schema_version: 4,
      ok: true,
      document_kind: 'factura',
      receptor: {
        nombre: 'CAMPOJOYMA S.L.',
        nif: 'B04493482',
        es_campojoyma: true,
      },
      proveedor: {
        nombre: 'GONZALEZ CAÑABATE S.L.',
        nif: 'B04228060',
      },
      factura: {
        numero: '26 1226',
        fecha: '2026-02-13',
        moneda: 'EUR',
        base_total: 1498.22,
        total: 1812.85,
      },
      tramos_iva: [{ base: 1498.22, porcentaje: 21, cuota: 314.63 }],
      retencion: { base: null, porcentaje: null, cuota: null },
      lineas: [
        {
          descripcion: 'GASOLEO B',
          pagina: 1,
          base: 557.93,
          importe: 674.1,
        },
        {
          descripcion: 'GASOLEO A',
          pagina: 1,
          base: 940.29,
          importe: 1138.75,
        },
      ],
      evidencias: [
        {
          campo: 'lineas',
          pagina: 1,
          texto: 'GASOLEO B 674.10; GASOLEO A 1,138.75; PVP IVA incluido',
        },
        {
          campo: 'iva_total',
          pagina: 1,
          texto: 'Base 1,498.22 IVA 314.63 Total 1,812.85',
        },
      ],
      erp_lookup: {
        status: 'not_found',
        candidate_count: 0,
        candidates: [],
        warnings: [
          'No se encontro un acreedor por el NIF visible.',
        ],
      },
      quality: {
        confidence: 0.96,
        requires_review: true,
        pages_analyzed: 1,
        warnings: [
          'Las bases de linea se han desglosado proporcionalmente a partir de la base total.',
          'No hay coincidencia unica en el maestro ERP de acreedores.',
          'El proveedor no tiene coincidencia en el maestro de acreedores.',
          'La busqueda exacta del acreedor por NIF no devolvio coincidencias.',
          'El importe se lee como 2.144,61 € aunque el resumen muestra 2.144,61 €.',
        ],
      },
    }),
  },
  () => ({
    item: {
      json: {
        security_warnings: [],
      },
    },
  }),
);
assert.deepEqual(
  grossLineNormalizerResult.json.ai.extraction.lineas.map((line) => line.base),
  [null, null],
  'Las bases de linea no impresas no pueden sobrevivir al normalizador.',
);
assert.doesNotMatch(
  grossLineNormalizerResult.json.ai.metadata.warnings.join(' '),
  /no cuadra con la base/i,
);
assert.doesNotMatch(
  grossLineNormalizerResult.json.ai.metadata.warnings.join(' '),
  /2\.144,61/,
  'Un valor confirmado por el mismo valor no es un warning.',
);
assert.match(
  grossLineNormalizerResult.json.ai.metadata.warnings.join(' '),
  /bases de linea no impresas/i,
);
assert.doesNotMatch(
  grossLineNormalizerResult.json.ai.metadata.warnings.join(' '),
  /(?:maestro ERP|maestro) de acreedores/i,
);
assert.deepEqual(
  grossLineNormalizerResult.json.ai.metadata.erp_lookup,
  {
    status: 'not_consulted',
    entity_type: null,
    matched_by: null,
    entity_id: null,
    codigo: null,
    nombre: null,
    nif: null,
    candidate_count: 0,
    candidates: [],
    warnings: [],
  },
  'El normalizador debe ignorar cualquier match ERP propuesto por el modelo.',
);
const discountedInvoiceNormalizerResult = await new AsyncFunction(
  '$json',
  '$',
  normalizerCode,
)(
  {
    output: JSON.stringify({
      schema_version: 4,
      ok: true,
      document_kind: 'factura',
      receptor: {
        nombre: 'CAMPOJOYMA S.L.',
        nif: 'B04493482',
        es_campojoyma: true,
      },
      proveedor: {
        nombre: 'PETIT FUSTERIA I DECORACIO S.L.',
        nif: 'A08314577',
      },
      factura: {
        numero: 'A-00910888',
        fecha: '2026-05-31',
        moneda: 'EUR',
        base_total: 61040.41,
        descuento_total: 1887.85,
        total: 73858.9,
      },
      tramos_iva: [{ base: 61040.41, porcentaje: 21, cuota: 12818.49 }],
      retencion: { base: null, porcentaje: null, cuota: null },
      lineas: [
        {
          descripcion: 'Suministros facturados',
          pagina: 1,
          base: null,
          importe: 62928.26,
        },
      ],
      evidencias: [
        {
          campo: 'descuento_total',
          pagina: 4,
          texto: 'Suma 62.928,26; Descuento 1.887,85; Base 61.040,41',
        },
      ],
      erp_lookup: {
        status: 'not_found',
        candidate_count: 0,
        candidates: [],
        warnings: [],
      },
      quality: {
        confidence: 0.98,
        requires_review: false,
        pages_analyzed: 4,
        warnings: [
          'La suma de lineas no coincide con la base imponible.',
        ],
      },
    }),
  },
  () => ({
    item: {
      json: {
        security_warnings: [],
      },
    },
  }),
);
assert.equal(
  discountedInvoiceNormalizerResult.json.ai.extraction.descuento_total,
  1887.85,
);
assert.doesNotMatch(
  discountedInvoiceNormalizerResult.json.ai.metadata.warnings.join(' '),
  /suma determinista|suma de lineas|no cuadra con la base/i,
  'Un descuento global impreso no debe generar un falso descuadre de lineas.',
);
const acreedor = {
  id: 17,
  codigo: 17,
  nombre: 'ONDUSPAN, S.A',
  nif: 'A04119293',
  cuenta_id: '41000000017',
  cuenta_gasto: '60200000001',
  bloqueado: 'N',
  inactivo_rgpd: 'N',
};
const agricultor = {
  id: 1957,
  codigo: 1957,
  nombre: 'ALMERITERRA-BIO S.L.',
  nif: 'B13702956',
  cuenta_id: '40090001957',
  bloqueado: 'N',
  activo: 'S',
};
const repsol = {
  id: 3081,
  codigo: 3081,
  nombre: 'REPSOL COMERCIALIZADORA DE ELECTRICIDAD Y GAS S.L.',
  nif: 'B39540760',
  cuenta_id: '41000003081',
  cuenta_gasto: '62800000001',
  bloqueado: 'N',
  inactivo_rgpd: 'N',
};
const mendez = {
  id: 112,
  codigo: 112,
  nombre: 'MENDEZ GARCIA E HIJOS, S.A.',
  nif: 'A-04040473',
  cuenta_id: '41000000112',
  cuenta_gasto: '60200000001',
  bloqueado: 'N',
  inactivo_rgpd: 'N',
};

const defaultExtraction = (providerType) => {
  const provider = providerType === 'agricultor' ? agricultor : acreedor;
  return {
    document_kind: 'factura',
    proveedor_nombre: provider.nombre,
    proveedor_nif: provider.nif,
    numero_factura: 'TEST-1',
    fecha_factura: '2026-07-15',
    total: 100,
    base_total: 90,
    descuento_total: null,
    tramos_iva: [],
    retencion: {},
    lineas: [],
    referencias: [],
    albaranes_referenciados: [],
    evidencias: [],
    vencimientos: [],
  };
};

const runScenario = async ({
  name,
  providerType = 'acreedor',
  providerRecord = null,
  extraction: extractionOverrides = {},
  respond,
  expectProviderResolved = true,
  metadataWarnings = [],
  erpLookupWarnings = [],
  vars = {},
}) => {
  const provider = providerRecord ??
    (providerType === 'agricultor' ? agricultor : acreedor);
  const requests = [];
  const helpers = {
    httpRequest: async ({ url }) => {
      requests.push(url);
      const parsed = new URL(url);
      if (respond) {
        const response = await respond(parsed, requests);
        if (response !== undefined) return response;
      }
      if (parsed.pathname === '/acreedores') {
        return { items: providerType === 'acreedor' ? [acreedor] : [], total: providerType === 'acreedor' ? 1 : 0 };
      }
      if (parsed.pathname === '/agricultores') {
        return { items: providerType === 'agricultor' ? [agricultor] : [], total: providerType === 'agricultor' ? 1 : 0 };
      }
      if (parsed.pathname === '/acreedores/17' || parsed.pathname === '/agricultores/1957') {
        return provider;
      }
      if (parsed.pathname === '/empresas/1') return { id: 1 };
      if (parsed.pathname === '/facturasrecibidas/buscar') return { items: [], total: 0 };
      if (parsed.pathname === '/albaranes-gastos/punteables') return { items: [], total: 0 };
      if (parsed.pathname === '/albaranes/entrada') return { items: [], total: 0 };
      throw new Error(`Unexpected mock request in ${name}: ${url}`);
    },
  };
  const extraction = {
    ...defaultExtraction(providerType),
    ...extractionOverrides,
  };
  const input = {
    source: {
      request_id: `test-${name}`,
      pdf_base64: 'JVBERi0=',
      pdf_nombre: `${name}.pdf`,
    },
    ai: {
      ok: true,
      extraction,
      metadata: {
        schema_version: 4,
        warnings: metadataWarnings,
        erp_lookup: {
          status: 'unique',
          entity_type: providerType,
          warnings: erpLookupWarnings,
        },
      },
    },
  };
  const result = await new AsyncFunction('$json', '$vars', enrichmentCode).call(
    { helpers },
    input,
    vars,
  );
  const output = result.json.output;
  assert.equal(
    output.extraction.FRR_idproveedor,
    expectProviderResolved ? provider.id : null,
    name,
  );
  assert.equal(
    output.metadata.match_evidence.proveedor.entity_type,
    expectProviderResolved ? providerType : null,
    name,
  );
  for (const punteo of output.punteos) {
    assert.equal(punteo.S, false, `${name}: ningún candidato puede quedar seleccionado`);
    assert.deepEqual(punteo.source_lines, [], `${name}: no se persisten líneas completas`);
  }
  assert.deepEqual(result.json.ingest_payload.punteos, output.punteos, name);
  return { name, requests, output };
};

const repsolLegalSuffix = await runScenario({
  name: 'proveedor-forma-juridica-equivalente',
  providerRecord: repsol,
  extraction: {
    proveedor_nombre: 'Repsol Comercializadora de Electricidad y Gas, S.L.U.',
    proveedor_nif: null,
  },
  respond: (url) => {
    if (url.pathname === '/acreedores') {
      const query = url.searchParams.get('nombre');
      if (query === 'Repsol Comercializadora de Electricidad y Gas') {
        return { items: [repsol], total: 1 };
      }
      return { items: [], total: 0 };
    }
    if (url.pathname === '/agricultores') return { items: [], total: 0 };
    if (url.pathname === '/acreedores/3081') return repsol;
    return undefined;
  },
});
assert.equal(
  repsolLegalSuffix.output.metadata.match_evidence.proveedor.resolution,
  'equivalent_legal_suffix_name',
);
assert.equal(
  repsolLegalSuffix.output.metadata.match_evidence.proveedor.name_match_mode,
  'legal_suffix_family',
);
assert(
  repsolLegalSuffix.requests.some((url) =>
    new URL(url).searchParams.get('nombre') ===
      'Repsol Comercializadora de Electricidad y Gas'
  ),
  'La busqueda debe reintentarse con el nucleo empresarial completo.',
);

const mendezSeparatedNif = await runScenario({
  name: 'proveedor-nif-variante-con-separador',
  providerRecord: mendez,
  extraction: {
    proveedor_nombre: 'Méndez García e Hijos S.A.',
    proveedor_nif: 'A04040473',
  },
  respond: (url) => {
    if (url.pathname === '/acreedores') {
      const query = url.searchParams.get('nif');
      return query === 'A-04040473'
        ? { items: [mendez], total: 1 }
        : { items: [], total: 0 };
    }
    if (url.pathname === '/agricultores') return { items: [], total: 0 };
    if (url.pathname === '/acreedores/112') return mendez;
    return undefined;
  },
});
assert.equal(mendezSeparatedNif.output.extraction.FRR_idproveedor, 112);
assert.equal(
  mendezSeparatedNif.output.metadata.match_evidence.proveedor.resolution,
  'exact_nif',
);
assert(
  mendezSeparatedNif.requests.some((url) =>
    new URL(url).searchParams.get('nif') === 'A-04040473'
  ),
  'Debe consultarse la variante del NIF que conserva el separador del ERP.',
);

const mendezDistinctiveName = await runScenario({
  name: 'proveedor-nombre-normalizado-fragmento-distintivo',
  providerRecord: mendez,
  extraction: {
    proveedor_nombre: 'Méndez García e Hijos S.A.',
    proveedor_nif: 'A04040473',
  },
  respond: (url) => {
    if (url.pathname === '/acreedores') {
      if (url.searchParams.has('nif')) return { items: [], total: 0 };
      const query = url.searchParams.get('nombre');
      return query === 'MENDEZ'
        ? { items: [mendez], total: 1 }
        : { items: [], total: 0 };
    }
    if (url.pathname === '/agricultores') return { items: [], total: 0 };
    if (url.pathname === '/acreedores/112') return mendez;
    return undefined;
  },
});
assert.equal(mendezDistinctiveName.output.extraction.FRR_idproveedor, 112);
assert.equal(
  mendezDistinctiveName.output.metadata.match_evidence.proveedor.resolution,
  'exact_name',
);
assert(
  mendezDistinctiveName.requests.some((url) =>
    new URL(url).searchParams.get('nombre') === 'MENDEZ'
  ),
  'El fallback debe llegar al fragmento sin diacriticos MENDEZ.',
);

const mendezPartialAmbiguous = await runScenario({
  name: 'proveedor-fragmento-parcial-ambiguo-no-resuelve',
  providerRecord: mendez,
  expectProviderResolved: false,
  extraction: {
    proveedor_nombre: 'Méndez García e Hijos S.A.',
    proveedor_nif: 'A04040473',
  },
  respond: (url) => {
    if (url.pathname === '/acreedores') {
      if (url.searchParams.has('nif')) return { items: [], total: 0 };
      if (url.searchParams.get('nombre') === 'MENDEZ') {
        return {
          items: [
            {
              ...mendez,
              id: 991,
              codigo: 991,
              nombre: 'MENDEZ TRANSPORTES S.A.',
              nif: 'A04999991',
            },
            {
              ...mendez,
              id: 992,
              codigo: 992,
              nombre: 'MENDEZ SUMINISTROS S.A.',
              nif: 'A04999992',
            },
          ],
          total: 2,
        };
      }
      return { items: [], total: 0 };
    }
    if (url.pathname === '/agricultores') return { items: [], total: 0 };
    return undefined;
  },
});
assert.equal(mendezPartialAmbiguous.output.extraction.FRR_idproveedor, null);
assert.equal(
  mendezPartialAmbiguous.output.metadata.match_evidence.proveedor.matched,
  false,
);

const repsolLegalSuffixAmbiguous = await runScenario({
  name: 'proveedor-forma-juridica-ambigua',
  providerRecord: repsol,
  expectProviderResolved: false,
  extraction: {
    proveedor_nombre: 'Repsol Comercializadora de Electricidad y Gas, S.L.U.',
    proveedor_nif: null,
  },
  respond: (url) => {
    if (url.pathname === '/acreedores') {
      const query = url.searchParams.get('nombre');
      if (query === 'Repsol Comercializadora de Electricidad y Gas') {
        return {
          items: [
            repsol,
            {
              ...repsol,
              id: 3999,
              codigo: 3999,
              nombre: 'REPSOL COMERCIALIZADORA DE ELECTRICIDAD Y GAS S.L.U.',
            },
          ],
          total: 2,
        };
      }
      return { items: [], total: 0 };
    }
    if (url.pathname === '/agricultores') return { items: [], total: 0 };
    return undefined;
  },
});
assert.equal(
  repsolLegalSuffixAmbiguous.output.metadata.match_evidence.proveedor.resolution,
  'ambiguous_cross_master',
);

const repsolLegalSuffixNifConflict = await runScenario({
  name: 'proveedor-forma-juridica-nif-contradictorio',
  providerRecord: repsol,
  expectProviderResolved: false,
  extraction: {
    proveedor_nombre: 'Repsol Comercializadora de Electricidad y Gas, S.L.U.',
    proveedor_nif: 'B00000000',
  },
  respond: (url) => {
    if (url.pathname === '/acreedores') {
      const query = url.searchParams.get('nombre');
      if (query === 'Repsol Comercializadora de Electricidad y Gas') {
        return { items: [repsol], total: 1 };
      }
      return { items: [], total: 0 };
    }
    if (url.pathname === '/agricultores') return { items: [], total: 0 };
    return undefined;
  },
});
assert.equal(
  repsolLegalSuffixNifConflict.output.metadata.match_evidence.proveedor.resolution,
  'nif_and_name_not_found',
);

const maExact = await runScenario({
  name: 'ma-exacto-tipado',
  extraction: {
    albaranes_referenciados: [
      {
        origen_impreso: 'MA',
        campana: '25',
        serie: 'A26',
        numero: '2108',
        referencia: '479628',
        fecha: '2026-06-29',
      },
    ],
  },
  respond: (url) => {
    if (url.pathname !== '/albaranes-gastos/punteables') return undefined;
    return {
      items: [
        {
          id_interno_estable: 'AMA:23210',
          source_table: 'albmaterial',
          source_id: 23210,
          albaran_id: 23210,
          Origen: 'MA',
          Campa: '25',
          Serie: 'A26',
          Albaran: 2108,
          Ref: '479628',
          Fecha: '2026-06-29',
          'Importe P': 0,
          Importe: 87.4,
          empresa: 1,
          acreedor_id: 17,
          line_count: 1,
        },
      ],
      total: 1,
    };
  },
});
assert.equal(maExact.output.punteos.length, 1);
assert.equal(maExact.output.punteos[0].source_table, 'albmaterial');

const geExact = await runScenario({
  name: 'ge-exacto-tipado',
  providerType: 'agricultor',
  extraction: {
    albaranes_referenciados: [
      {
        origen_impreso: 'GE',
        campana: '25',
        serie: 'A26',
        numero: '8187',
        referencia: '129',
        fecha: '2026-07-03',
      },
    ],
  },
  respond: (url) => {
    if (url.pathname === '/albaranes/entrada') {
      return {
        items: [
          {
            id: 82285,
            campa: '25',
            serie: 'A26',
            numero: 8187,
            fecha: '2026-07-03',
            agricultor_id: 1957,
            referencia: '129',
          },
        ],
        total: 1,
      };
    }
    if (url.pathname === '/albaranes/entrada/82285/lineas') {
      return { items: [{ id: 1 }, { id: 2 }] };
    }
    return undefined;
  },
});
assert.equal(geExact.output.punteos.length, 1);
assert.equal(geExact.output.punteos[0].source_table, 'albentrada');
assert.equal(geExact.output.punteos[0].line_count, 2);

const genericReference = await runScenario({
  name: 'referencia-comercial-no-es-albaran',
  extraction: {
    referencias: ['479628'],
    lineas: [{ referencia: '479628', descripcion: 'Referencia comercial' }],
  },
});
assert.equal(genericReference.output.punteos.length, 0);
assert.equal(
  genericReference.requests.some((url) => new URL(url).pathname === '/albaranes-gastos/punteables'),
  false,
);

const nifOcrFallback = await runScenario({
  name: 'nif-ocr-fallback-nombre-exacto',
  extraction: {
    proveedor_nif: 'A0411929X',
    proveedor_nombre: acreedor.nombre,
  },
});
assert.equal(nifOcrFallback.output.extraction.FRR_idproveedor, acreedor.id);
assert.equal(
  nifOcrFallback.output.metadata.match_evidence.proveedor.resolution,
  'exact_name',
);
assert(
  nifOcrFallback.requests.some((url) => {
    const parsed = new URL(url);
    return parsed.pathname === '/acreedores' &&
      parsed.searchParams.get('nombre') === acreedor.nombre;
  }),
);

const provisionalProviderWarning =
  'No hay coincidencia unica en el maestro ERP de acreedores.';
const resolvedProviderWarning = await runScenario({
  name: 'aviso-provisional-proveedor-superado',
  metadataWarnings: ['NIF parcialmente borroso en el documento.'],
  erpLookupWarnings: [provisionalProviderWarning],
});
assert.doesNotMatch(
  resolvedProviderWarning.output.metadata.warnings.join(' '),
  /no hay coincidencia unica/i,
);
assert.match(
  resolvedProviderWarning.output.metadata.warnings.join(' '),
  /NIF parcialmente borroso/i,
);

const crossMasterUnavailable = await runScenario({
  name: 'maestro-alternativo-incompleto',
  expectProviderResolved: false,
  erpLookupWarnings: [provisionalProviderWarning],
  respond: (url) => {
    if (url.pathname === '/agricultores') {
      throw new Error('catalog unavailable');
    }
    return undefined;
  },
});
assert.equal(
  crossMasterUnavailable.output.metadata.match_evidence.proveedor.resolution,
  'cross_master_catalog_incomplete',
);
assert.match(
  crossMasterUnavailable.output.metadata.warnings.join(' '),
  /maestro alternativo/i,
);
assert.match(
  crossMasterUnavailable.output.metadata.warnings.join(' '),
  /no hay coincidencia unica/i,
);

const normalizedNifVariantUnavailable = await runScenario({
  name: 'variante-nif-normalizada-incompleta',
  extraction: {
    proveedor_nif: 'A-04119293',
  },
  expectProviderResolved: false,
  respond: (url) => {
    if (
      url.pathname === '/agricultores' &&
      url.searchParams.get('nif') === 'A04119293'
    ) {
      throw new Error('normalized catalog lookup unavailable');
    }
    return undefined;
  },
});
assert.equal(
  normalizedNifVariantUnavailable.output.metadata.match_evidence.proveedor.resolution,
  'cross_master_catalog_incomplete',
);

const inconsistentProviderTotal = await runScenario({
  name: 'total-proveedor-incoherente',
  expectProviderResolved: false,
  respond: (url) => {
    if (url.pathname === '/acreedores') {
      return { items: [acreedor], total: 0 };
    }
    return undefined;
  },
});
assert(
  inconsistentProviderTotal.output.metadata.match_evidence.proveedor.attempts
    .some((attempt) => attempt.entity_type === 'acreedor' && attempt.complete === false),
);

const wrongSeries = await runScenario({
  name: 'serie-ma-distinta',
  extraction: {
    albaranes_referenciados: [
      { origen_impreso: 'MA', serie: 'A26', numero: '2108', referencia: '479628' },
    ],
  },
  respond: (url) => {
    if (url.pathname !== '/albaranes-gastos/punteables') return undefined;
    return {
      items: [
        {
          source_table: 'albmaterial',
          source_id: 23210,
          empresa: 1,
          acreedor_id: 17,
          Serie: 'A25',
          Albaran: 2108,
          Ref: '479628',
        },
      ],
      total: 1,
    };
  },
});
assert.equal(wrongSeries.output.punteos.length, 0);

const geIdentityCannotMatchMa = await runScenario({
  name: 'origen-ge-no-coincide-con-ma',
  extraction: {
    albaranes_referenciados: [
      {
        origen_impreso: 'GE',
        serie: 'A26',
        numero: '2108',
        referencia: '479628',
      },
    ],
  },
  respond: (url) => {
    if (url.pathname !== '/albaranes-gastos/punteables') return undefined;
    return {
      items: [
        {
          source_table: 'albmaterial',
          source_id: 23210,
          empresa: 1,
          acreedor_id: 17,
          Origen: 'MA',
          Serie: 'A26',
          Albaran: 2108,
          Ref: '479628',
        },
      ],
      total: 1,
    };
  },
});
assert.equal(geIdentityCannotMatchMa.output.punteos.length, 0);

const maIdentityCannotMatchGe = await runScenario({
  name: 'origen-ma-no-se-consulta-como-ge',
  providerType: 'agricultor',
  extraction: {
    albaranes_referenciados: [
      {
        origen_impreso: 'MA',
        serie: 'A26',
        numero: '8187',
        referencia: '129',
      },
    ],
  },
});
assert.equal(maIdentityCannotMatchGe.output.punteos.length, 0);
assert.equal(
  maIdentityCannotMatchGe.requests.some(
    (url) => new URL(url).pathname === '/albaranes/entrada',
  ),
  false,
);

const bareNumber = await runScenario({
  name: 'numero-sin-discriminador',
  extraction: {
    albaranes_referenciados: [{ origen_impreso: 'MA', numero: '2108' }],
  },
  respond: (url) => {
    if (url.pathname !== '/albaranes-gastos/punteables') return undefined;
    return {
      items: [
        {
          source_table: 'albmaterial',
          source_id: 23210,
          empresa: 1,
          acreedor_id: 17,
          Albaran: 2108,
        },
      ],
      total: 1,
    };
  },
});
assert.equal(bareNumber.output.punteos.length, 0);

const geAmbiguous = await runScenario({
  name: 'ge-campana-ambigua',
  providerType: 'agricultor',
  extraction: {
    albaranes_referenciados: [{ origen_impreso: 'GE', serie: 'A26', numero: '8187' }],
  },
  respond: (url) => {
    if (url.pathname !== '/albaranes/entrada') return undefined;
    return {
      items: [
        { id: 82285, campa: '25', serie: 'A26', numero: 8187, agricultor_id: 1957 },
        { id: 92285, campa: '24', serie: 'A26', numero: 8187, agricultor_id: 1957 },
      ],
      total: 2,
    };
  },
});
assert.equal(geAmbiguous.output.punteos.length, 0);
assert.match(
  geAmbiguous.output.metadata.warnings.join(' '),
  /varias campanas/i,
);

const geFirstPage = Array.from({ length: 200 }, (_, index) => ({
  id: 82000 + index,
  campa: '25',
  serie: 'A26',
  numero: 8187,
  agricultor_id: 1957,
  referencia: index === 0 ? '129' : `NO-${index}`,
}));
const gePaginatedAmbiguous = await runScenario({
  name: 'ge-ambiguedad-en-segunda-pagina',
  providerType: 'agricultor',
  extraction: {
    albaranes_referenciados: [
      { origen_impreso: 'GE', serie: 'A26', numero: '8187', referencia: '129' },
    ],
  },
  respond: (url) => {
    if (url.pathname !== '/albaranes/entrada') return undefined;
    if (url.searchParams.get('offset') === '0') {
      return { items: geFirstPage };
    }
    return {
      items: [
        {
          id: 92285,
          campa: '24',
          serie: 'A26',
          numero: 8187,
          agricultor_id: 1957,
          referencia: '129',
        },
      ],
    };
  },
});
assert.equal(gePaginatedAmbiguous.output.punteos.length, 0);
assert(
  gePaginatedAmbiguous.requests.some((url) => {
    const parsed = new URL(url);
    return parsed.pathname === '/albaranes/entrada' &&
      parsed.searchParams.get('offset') === '200';
  }),
);
assert.match(
  gePaginatedAmbiguous.output.metadata.warnings.join(' '),
  /varias campanas/i,
);

const linkedHistorical = await runScenario({
  name: 'factura-erp-existente',
  extraction: {
    numero_factura: 'A-00748886',
    fecha_factura: '2026-06-30',
  },
  respond: (url) => {
    if (url.pathname === '/facturasrecibidas/buscar') {
      return {
        items: [
          {
            FRR_id: 49305,
            FRR_Idempresa: 1,
            FRR_idproveedor: 17,
            FRR_ejercicio: 25,
            FRR_numerofactura: 'A-00748886',
            FRR_fechafactura: '2026-06-30',
            FRR_tipofactura: 'OT',
            proveedor_nif: 'A04119293',
          },
        ],
        total: 1,
      };
    }
    if (url.pathname === '/facturasrecibidas/49305/punteos') {
      return {
        items: [
          {
            remote_id: 'AEH:82285',
            source_table: 'albentrada_his',
            source_id: 82285,
            albaran_id: 8187,
            Origen: 'GE',
            Serie: 'A26',
            Albaran: 8187,
            Ref: '129',
            Fecha: '2026-07-03',
            Importe: 136,
            importe_factura: 129.2,
            line_count: 2,
          },
        ],
        total: 1,
      };
    }
    return undefined;
  },
});
assert.equal(linkedHistorical.output.punteos.length, 1);
assert.equal(linkedHistorical.output.punteos[0].source_table, 'albentrada_his');
assert.equal(linkedHistorical.output.punteos[0].importe_factura, 129.2);
assert.equal(linkedHistorical.output.extraction.FRR_ejercicio, 25);
const linkedHistoricalSearch = linkedHistorical.requests
  .map((url) => new URL(url))
  .find((url) => url.pathname === '/facturasrecibidas/buscar');
assert(linkedHistoricalSearch, 'Debe usarse el endpoint de busqueda exacta.');
assert.equal(linkedHistoricalSearch.searchParams.get('empresa_id'), '1');
assert.equal(linkedHistoricalSearch.searchParams.get('proveedor_id'), '17');
assert.equal(
  linkedHistoricalSearch.searchParams.get('numero_factura'),
  'A-00748886',
);
assert.equal(
  linkedHistoricalSearch.searchParams.get('fecha_factura'),
  '2026-06-30',
);
assert.equal(linkedHistoricalSearch.searchParams.get('tipo_factura'), 'OT');
assert.deepEqual(linkedHistorical.output.metadata.match_evidence.ejercicio, {
  source: 'existing_erp_invoice_exact_unique',
  resolved: true,
  value: 25,
});
assert.match(
  linkedHistorical.output.metadata.warnings.join(' '),
  /ya existe en el ERP/i,
);
assert.doesNotMatch(
  linkedHistorical.output.metadata.warnings.join(' '),
  /identidad exacta de albaran/i,
  'Una factura ya enlazada no debe mostrar tambien el aviso de candidatos documentales.',
);

const missingExistingInvoiceEnvelope = await runScenario({
  name: 'factura-erp-sin-empresa-ni-fecha-no-es-exacta',
  extraction: {
    numero_factura: 'INCOMPLETE-ENVELOPE',
    fecha_factura: '2026-06-30',
  },
  respond: (url) => {
    if (url.pathname !== '/facturasrecibidas/buscar') return undefined;
    return {
      items: [
        {
          FRR_id: 49309,
          FRR_idproveedor: 17,
          FRR_ejercicio: 25,
          FRR_numerofactura: 'INCOMPLETE-ENVELOPE',
          FRR_tipofactura: 'OT',
          proveedor_nif: 'A04119293',
        },
      ],
      total: 1,
    };
  },
});
assert.equal(missingExistingInvoiceEnvelope.output.extraction.FRR_ejercicio, null);
assert.equal(
  missingExistingInvoiceEnvelope.output.metadata.match_evidence.punteos
    .existing_invoice_found,
  false,
);
assert.equal(
  missingExistingInvoiceEnvelope.requests.some(
    (url) => new URL(url).pathname === '/facturasrecibidas/49309/punteos',
  ),
  false,
);

const contradictoryExistingInvoiceNif = await runScenario({
  name: 'factura-erp-nif-contradictorio-no-es-exacta',
  extraction: {
    numero_factura: 'WRONG-NIF',
    fecha_factura: '2026-06-30',
  },
  respond: (url) => {
    if (url.pathname !== '/facturasrecibidas/buscar') return undefined;
    return {
      items: [
        {
          FRR_id: 49310,
          FRR_Idempresa: 1,
          FRR_idproveedor: 17,
          FRR_ejercicio: 25,
          FRR_numerofactura: 'WRONG-NIF',
          FRR_fechafactura: '2026-06-30',
          FRR_tipofactura: 'OT',
          proveedor_nif: 'B00000000',
        },
      ],
      total: 1,
    };
  },
});
assert.equal(contradictoryExistingInvoiceNif.output.extraction.FRR_ejercicio, null);
assert.equal(
  contradictoryExistingInvoiceNif.output.metadata.match_evidence.punteos
    .existing_invoice_found,
  false,
);

const ambiguousExistingInvoiceExercise = await runScenario({
  name: 'factura-erp-existente-ambigua-no-propaga-ejercicio',
  extraction: {
    numero_factura: 'AMBIGUOUS-EXERCISE',
    fecha_factura: '2026-06-30',
  },
  respond: (url) => {
    if (url.pathname !== '/facturasrecibidas/buscar') return undefined;
    return {
      items: [
        {
          FRR_id: 49307,
          FRR_Idempresa: 1,
          FRR_idproveedor: 17,
          FRR_ejercicio: 24,
          FRR_numerofactura: 'AMBIGUOUS-EXERCISE',
          FRR_fechafactura: '2026-06-30',
          FRR_tipofactura: 'OT',
          proveedor_nif: 'A04119293',
        },
        {
          FRR_id: 49308,
          FRR_Idempresa: 1,
          FRR_idproveedor: 17,
          FRR_ejercicio: 25,
          FRR_numerofactura: 'AMBIGUOUS-EXERCISE',
          FRR_fechafactura: '2026-06-30',
          FRR_tipofactura: 'OT',
          proveedor_nif: 'A04119293',
        },
      ],
      total: 2,
    };
  },
});
assert.equal(ambiguousExistingInvoiceExercise.output.extraction.FRR_ejercicio, null);
assert.deepEqual(
  ambiguousExistingInvoiceExercise.output.metadata.match_evidence.ejercicio,
  {
    source: 'edge_rule',
    resolved: false,
    value: null,
  },
);
assert.match(
  ambiguousExistingInvoiceExercise.output.metadata.warnings.join(' '),
  /varias facturas ERP con la misma identidad visible/i,
);

const incompleteExistingSearch = await runScenario({
  name: 'factura-erp-busqueda-incompleta',
  extraction: {
    numero_factura: 'PAGED-1',
    fecha_factura: '2026-06-30',
  },
  respond: (url) => {
    if (url.pathname !== '/facturasrecibidas/buscar') return undefined;
    if (url.searchParams.get('offset') === '0') {
      return {
        items: [
          {
            FRR_id: 49305,
            FRR_Idempresa: 1,
            FRR_idproveedor: 17,
            FRR_numerofactura: 'PAGED-1',
            FRR_fechafactura: '2026-06-30',
            FRR_tipofactura: 'OT',
          },
        ],
        total: 2,
      };
    }
    return { items: [], total: 2 };
  },
});
assert.equal(incompleteExistingSearch.output.punteos.length, 0);
assert.equal(
  incompleteExistingSearch.output.metadata.match_evidence.punteos.catalog_complete,
  false,
);
assert.equal(
  incompleteExistingSearch.requests.some(
    (url) => new URL(url).pathname === '/facturasrecibidas/49305/punteos',
  ),
  false,
);
assert.match(
  incompleteExistingSearch.output.metadata.warnings.join(' '),
  /antes de recuperar todos los resultados/i,
);

const incompleteLinkedPunteos = await runScenario({
  name: 'factura-erp-punteos-incompletos',
  extraction: {
    numero_factura: 'LINKED-PAGED-1',
    fecha_factura: '2026-06-30',
  },
  respond: (url) => {
    if (url.pathname === '/facturasrecibidas/buscar') {
      return {
        items: [
          {
            FRR_id: 49306,
            FRR_Idempresa: 1,
            FRR_idproveedor: 17,
            FRR_numerofactura: 'LINKED-PAGED-1',
            FRR_fechafactura: '2026-06-30',
            FRR_tipofactura: 'OT',
          },
        ],
        total: 1,
      };
    }
    if (url.pathname === '/facturasrecibidas/49306/punteos') {
      if (url.searchParams.get('offset') === '0') {
        return {
          items: [
            {
              source_table: 'albmaterial',
              source_id: 23210,
              albaran_id: 23210,
              Origen: 'MA',
              Serie: 'A26',
              Albaran: 2108,
              Ref: '479628',
            },
          ],
          total: 2,
        };
      }
      return { items: [], total: 2 };
    }
    return undefined;
  },
});
assert.equal(incompleteLinkedPunteos.output.punteos.length, 0);
assert.equal(
  incompleteLinkedPunteos.output.metadata.match_evidence.punteos.catalog_complete,
  false,
);
assert.match(
  incompleteLinkedPunteos.output.metadata.warnings.join(' '),
  /no se muestran porque la recuperacion quedo incompleta/i,
);

const incompleteMaCatalog = await runScenario({
  name: 'catalogo-ma-incompleto-sin-candidatos-parciales',
  extraction: {
    albaranes_referenciados: [
      {
        origen_impreso: 'MA',
        serie: 'A26',
        numero: '2108',
        referencia: '479628',
      },
    ],
  },
  respond: (url) => {
    if (url.pathname !== '/albaranes-gastos/punteables') return undefined;
    if (url.searchParams.get('offset') === '0') {
      return {
        items: [
          {
            source_table: 'albmaterial',
            source_id: 23210,
            empresa: 1,
            acreedor_id: 17,
            Origen: 'MA',
            Serie: 'A26',
            Albaran: 2108,
            Ref: '479628',
          },
        ],
        total: 2,
      };
    }
    throw new Error('second page unavailable');
  },
});
assert.equal(incompleteMaCatalog.output.punteos.length, 0);
assert.equal(
  incompleteMaCatalog.output.metadata.match_evidence.punteos.catalog_complete,
  false,
);
assert.equal(
  incompleteMaCatalog.output.metadata.match_evidence.punteos.status,
  'partial',
);
assert.match(
  incompleteMaCatalog.output.metadata.warnings.join(' '),
  /no se muestran candidatos MA/i,
);

const manyExactPunteos = Array.from({ length: 201 }, (_, index) => ({
  source_table: 'albmaterial',
  source_id: 30000 + index,
  albaran_id: 30000 + index,
  Origen: 'MA',
  Serie: 'A26',
  Albaran: 2108,
  Ref: '479628',
  empresa: 1,
  acreedor_id: 17,
}));
const limitedExactPunteos = await runScenario({
  name: 'punteos-exactos-limitados-explicitamente',
  extraction: {
    albaranes_referenciados: [
      { origen_impreso: 'MA', serie: 'A26', numero: '2108', referencia: '479628' },
    ],
  },
  respond: (url) => {
    if (url.pathname !== '/albaranes-gastos/punteables') return undefined;
    const offset = Number(url.searchParams.get('offset') ?? 0);
    return {
      items: manyExactPunteos.slice(offset, offset + 200),
      total: manyExactPunteos.length,
    };
  },
});
assert.equal(limitedExactPunteos.output.punteos.length, 200);
assert.equal(
  limitedExactPunteos.output.metadata.match_evidence.punteos.catalog_complete,
  false,
);
assert.match(
  limitedExactPunteos.output.metadata.warnings.join(' '),
  /mas de 200 punteos exactos/i,
);

console.log(JSON.stringify({
  ok: true,
  scenarios: [
    repsolLegalSuffix,
    mendezSeparatedNif,
    mendezDistinctiveName,
    mendezPartialAmbiguous,
    repsolLegalSuffixAmbiguous,
    repsolLegalSuffixNifConflict,
    maExact,
    geExact,
    genericReference,
    nifOcrFallback,
    crossMasterUnavailable,
    normalizedNifVariantUnavailable,
    inconsistentProviderTotal,
    wrongSeries,
    geIdentityCannotMatchMa,
    maIdentityCannotMatchGe,
    bareNumber,
    geAmbiguous,
    gePaginatedAmbiguous,
    linkedHistorical,
    missingExistingInvoiceEnvelope,
    contradictoryExistingInvoiceNif,
    ambiguousExistingInvoiceExercise,
    incompleteExistingSearch,
    incompleteLinkedPunteos,
    incompleteMaCatalog,
    limitedExactPunteos,
  ].map(({ name, requests, output }) => ({
    name,
    requests: requests.length,
    punteos: output.punteos.length,
  })),
}, null, 2));
