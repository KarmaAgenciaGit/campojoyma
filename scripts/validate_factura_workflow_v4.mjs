import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const workflowPath = path.join(
  root,
  'docs',
  'n8n',
  'CAMPOJOYMA - Entrada segura de facturas recibidas v4.2 (webhook v2).json',
);
const workflow = JSON.parse(fs.readFileSync(workflowPath, 'utf8'));
const systemPrompt = workflow.nodes.find(
  (node) => node.name === 'AI Agent',
)?.parameters?.options?.systemMessage ?? '';
const userPrompt = workflow.nodes.find(
  (node) => node.name === 'AI Agent',
)?.parameters?.text ?? '';
assert.equal(
  workflow.name,
  'CAMPOJOYMA - Entrada segura de facturas recibidas v4.2 (webhook v2)',
  'El workflow debe identificar la revision con tools de lectura.',
);
assert.match(
  workflow.versionId ?? '',
  /agente-v4\.2-2026-07-29-read-tools$/,
  'La exportacion debe conservar un identificador verificable de prompt v4.2.',
);
assert.match(
  systemPrompt,
  /^PROMPT_VERSION: 4\.2\n/,
  'El mensaje de sistema debe declarar la revision v4.2.',
);
assert.doesNotMatch(
  systemPrompt,
  /^=/,
  'El mensaje de sistema es texto fijo y no debe depender del modo expresion.',
);
assert.match(
  userPrompt,
  /^=Analiza las \{\{ \$json\.pagesConverted \}\} imagenes adjuntas/,
  'La tarea debe recibir el numero de imagenes y ordenar las consultas GET.',
);
assert.doesNotMatch(
  userPrompt,
  /request_id|factura_id|archivo_pdf_id|pdf_nombre|email_from|email_subject|\bsource\b/,
  'El modelo no debe recibir identificadores tecnicos, origen ni metadatos de correo.',
);
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
const agentNode = workflow.nodes.find((node) => node.name === 'AI Agent');
assert.equal(agentNode?.retryOnFail, true);
assert.equal(agentNode?.maxTries, 2);
assert.equal(agentNode?.waitBetweenTries, 1000);
assert.equal(
  agentNode?.onError,
  'continueErrorOutput',
  'Tras agotar el unico reintento, el error debe seguir por la rama fail-closed.',
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
assert.match(
  systemPrompt,
  /POLITICA DE TOOLS[\s\S]*Buscar acreedores por NIF[\s\S]*Consultar detalle de acreedor/,
  'El agente debe resolver y confirmar el acreedor con tools GET.',
);
assert.match(
  systemPrompt,
  /Sugerir regimen IVA historico/,
  'El regimen debe proceder del historico ERP y no de concatenar tipos de IVA.',
);
assert.match(systemPrompt, /Nunca concatenes porcentajes/);
assert.match(
  systemPrompt,
  /Buscar albaran MA por referencia[\s\S]*Code posterior repite las consultas/,
  'La IA puede orquestar, pero el Code posterior debe ser la autoridad.',
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
const toolNodes = workflow.nodes.filter(
  (node) => node.type === 'n8n-nodes-base.httpRequestTool',
);
assert.equal(toolNodes.length, 5, 'El agente debe tener cinco tools GET acotadas.');
assert.deepEqual(
  new Set(toolNodes.map((node) => node.name)),
  new Set([
    'Buscar acreedores por NIF',
    'Buscar acreedores por nombre',
    'Consultar detalle de acreedor',
    'Sugerir regimen IVA historico',
    'Buscar albaran MA por referencia',
  ]),
);
for (const tool of toolNodes) {
  assert.equal(tool.parameters.method, 'GET', `${tool.name}: solo se permite GET`);
  assert.match(
    JSON.stringify(tool.parameters),
    /\$fromAI/,
    `${tool.name}: debe recibir parametros declarados del agente`,
  );
  assert.deepEqual(
    workflow.connections?.[tool.name]?.ai_tool?.[0],
    [{ node: 'AI Agent', type: 'ai_tool', index: 0 }],
    `${tool.name}: debe estar conectada por ai_tool`,
  );
}
assert.equal(
  toolNodes.find((node) => node.name === 'Sugerir regimen IVA historico')
    ?.parameters?.url,
  'http://172.19.0.1:18001/facturasrecibidas/regimen-sugerido',
);
const maTool = toolNodes.find(
  (node) => node.name === 'Buscar albaran MA por referencia',
);
assert.equal(
  maTool?.parameters?.url,
  'http://172.19.0.1:18001/albaranes-gastos/punteables',
);
const maToolParams = Object.fromEntries(
  (maTool?.parameters?.queryParameters?.parameters ?? []).map((item) => [
    item.name,
    item.value,
  ]),
);
assert.equal(maToolParams.source_table, 'albmaterial');
assert.equal(maToolParams.empresa_id, '1');
assert.equal(maToolParams.solo_pendientes, 'true');
assert.match(maToolParams.referencia ?? '', /\$fromAI/);
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
assert.match(
  enrichmentCode,
  /const documentedReferenceRows =[\s\S]*albaranes_referenciados[\s\S]*lineas\.referencia_albaran/,
  'Solo las referencias externas documentadas pueden iniciar un lookup MA.',
);
assert.match(
  enrichmentCode,
  /provisionalProviderWarningKeys[\s\S]*!provider \|\|[\s\S]*!provisionalProviderWarningKeys\.has/,
  'Solo los avisos exactos del lookup provisional pueden retirarse tras resolver proveedor.',
);
assert.match(
  enrichmentCode,
  /providerLegalForms[\s\S]*legal_suffix_family[\s\S]*possibleQueries/,
  'Las diferencias SL\/SLU o SA\/SAU deben resolverse solo mediante un nucleo empresarial exacto.',
);
assert.match(
  enrichmentCode,
  /const separatedNif =[\s\S]*nif\.slice\(0, 1\) \+ '-' \+ nif\.slice\(1\)/,
  'La busqueda debe probar una variante determinista del NIF con separador.',
);
assert.match(
  enrichmentCode,
  /normalizedName[\s\S]*possibleQueries[\s\S]*searchAcreedores\('nombre'/,
  'El fallback de nombre debe normalizar diacriticos y revalidarse en acreedores.',
);
assert.match(
  enrichmentCode,
  /nameComparison[\s\S]*if \(nif && normalizeNif\(candidate\.nif\) !== nif\)/,
  'Una equivalencia de forma juridica debe cerrarse si contradice un NIF visible.',
);
assert.match(
  enrichmentCode,
  /providerMatchBasis === 'nif'[\s\S]*normalizeNif\(detail\?\.nif\) === nif && \(!nombre \|\| detailName\.matched\)/,
  'Un match por NIF debe confirmar tambien el nombre visible en el detalle ERP.',
);
assert.match(
  enrichmentCode,
  /descuento_total: readNumber\(literal\.descuento_total\)/,
  'El descuento global literal debe llegar a la extraccion final.',
);
assert.match(
  enrichmentCode,
  /const ejercicio = 25;/,
  'El borrador del circuito acreedor debe usar el ejercicio ERP 25.',
);
assert.match(
  enrichmentCode,
  /\/facturasrecibidas\/regimen-sugerido[\s\S]*responseConsistent[\s\S]*regimenId = suggestedRegimen/,
  'El regimen solo puede aplicarse tras revalidar una sugerencia historica consistente.',
);
assert.match(
  enrichmentCode,
  /ACCOUNTING_DRAFT_POLICY[\s\S]*GASTO_ACCOUNT = '60200000001'[\s\S]*FRR_Contabilizar: 'S'/,
  'El borrador debe fijar la cuenta de gasto y contabilizar segun la politica aprobada.',
);
assert.match(
  enrichmentCode,
  /responseComplete[\s\S]*result\.total === 1[\s\S]*result\.exact_count === 1[\s\S]*punteoAutoSelectionSafe/,
  'Los albaranes solo se seleccionan si todas las referencias tienen un match exacto unico.',
);
assert.match(
  enrichmentCode,
  /mapExistingLinkedPunteo[\s\S]*S: false[\s\S]*\/facturasrecibidas\/' \+ existingInvoiceId \+ '\/punteos/,
  'Una factura ERP existente debe recuperar sus punteos reales como filas no seleccionadas.',
);
assert.match(
  enrichmentCode,
  /const MAX_DOCUMENTED_REFERENCES = 25;/,
  'n8n debe respetar el limite de 25 referencias admitido por Edge.',
);
assert.match(
  enrichmentCode,
  /amountsExplicitlyZero[\s\S]*base !== null[\s\S]*cuota !== null[\s\S]*percentageWithUnknownAmounts[\s\S]*!amountsExplicitlyZero/,
  'Un IVA preconfigurado 0\/10\/0 debe ser inactivo sin ocultar un null\/10\/null incompleto.',
);
assert.match(
  enrichmentCode,
  /active[\s\S]*complete[\s\S]*se conservan null y no se inventan importes/,
  'Un tramo IVA activo incompleto debe conservar null en lugar de inventar cero.',
);
assert.doesNotMatch(
  enrichmentCode,
  /line\?\.referencia(?:,|\])/,
  'El matching v4 no puede promover la referencia comercial genérica de una línea.',
);

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const errorBuilderCode = workflow.nodes.find(
  (node) => node.name === 'Construir error',
)?.parameters?.jsCode ?? '';
const parserFailureResult = await new AsyncFunction(
  '$json',
  errorBuilderCode,
)({
  request_id: 'parser-failure-regression',
  error: "Model output doesn't fit required format",
});
assert.equal(parserFailureResult?.json?.status_code, 502);
assert.equal(
  parserFailureResult?.json?.error_code,
  'UPSTREAM_INVALID_RESPONSE',
);
assert.equal(parserFailureResult?.json?.retryable, true);

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
assert.match(
  grossLineNormalizerResult.json.ai.metadata.warnings.join(' '),
  /No se encontro un acreedor por el NIF visible/i,
);
assert.deepEqual(
  grossLineNormalizerResult.json.ai.metadata.erp_lookup,
  {
    status: 'not_found',
    entity_type: null,
    matched_by: null,
    entity_id: null,
    codigo: null,
    nombre: null,
    nif: null,
    candidate_count: 0,
    candidates: [],
    warnings: ['No se encontro un acreedor por el NIF visible.'],
  },
  'El normalizador debe conservar el resultado ERP real sin promoverlo a autoridad.',
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

const uniqueLookupNormalizerResult = await new AsyncFunction(
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
      proveedor: { nombre: 'ONDUSPAN, S.A', nif: 'A04119293' },
      factura: {
        numero: 'FV-42',
        fecha: '2026-07-29',
        moneda: 'EUR',
        base_total: 100,
        descuento_total: null,
        total: 121,
        concepto: null,
        observaciones_visibles: null,
      },
      tramos_iva: [{ base: 100, porcentaje: 21, cuota: 21 }],
      retencion: { base: null, porcentaje: null, cuota: null },
      lineas: [],
      albaranes_referenciados: [],
      referencias: [],
      vencimientos: [],
      evidencias: [],
      erp_lookup: {
        status: 'unique',
        entity_type: 'acreedor',
        matched_by: 'nif',
        entity_id: 17,
        codigo: 17,
        nombre: 'ONDUSPAN, S.A',
        nif: 'A04119293',
        candidate_count: 1,
        candidates: [
          {
            entity_type: 'acreedor',
            id: 17,
            codigo: 17,
            nombre: 'ONDUSPAN, S.A',
            nif: 'A04119293',
          },
        ],
        warnings: [],
      },
      quality: {
        confidence: 0.99,
        requires_review: false,
        pages_analyzed: 1,
        warnings: [],
        summary: null,
      },
    }),
  },
  () => ({ item: { json: { security_warnings: [] } } }),
);
assert.deepEqual(
  uniqueLookupNormalizerResult.json.ai.metadata.erp_lookup,
  {
    status: 'unique',
    entity_type: 'acreedor',
    matched_by: 'nif',
    entity_id: 17,
    codigo: 17,
    nombre: 'ONDUSPAN, S.A',
    nif: 'A04119293',
    candidate_count: 1,
    candidates: [
      {
        entity_type: 'acreedor',
        id: 17,
        codigo: 17,
        nombre: 'ONDUSPAN, S.A',
        nif: 'A04119293',
      },
    ],
    warnings: [],
  },
  'El normalizador debe conservar un lookup unico internamente coherente.',
);

const incoherentLookupInput = {
  output: JSON.stringify({
    schema_version: 4,
    ok: true,
    document_kind: 'factura',
    receptor: {
      nombre: 'CAMPOJOYMA S.L.',
      nif: 'B04493482',
      es_campojoyma: true,
    },
    proveedor: { nombre: 'ONDUSPAN, S.A', nif: 'A04119293' },
    factura: {
      numero: 'FV-43',
      fecha: '2026-07-29',
      moneda: 'EUR',
      base_total: 100,
      descuento_total: null,
      total: 121,
      concepto: null,
      observaciones_visibles: null,
    },
    tramos_iva: [{ base: 100, porcentaje: 21, cuota: 21 }],
    retencion: { base: null, porcentaje: null, cuota: null },
    lineas: [],
    albaranes_referenciados: [],
    referencias: [],
    vencimientos: [],
    evidencias: [],
    erp_lookup: {
      ...uniqueLookupNormalizerResult.json.ai.metadata.erp_lookup,
      candidate_count: 2,
    },
    quality: {
      confidence: 0.99,
      requires_review: false,
      pages_analyzed: 1,
      warnings: [],
      summary: null,
    },
  }),
};
const incoherentLookupResult = await new AsyncFunction(
  '$json',
  '$',
  normalizerCode,
)(
  incoherentLookupInput,
  () => ({ item: { json: { security_warnings: [] } } }),
);
assert.equal(incoherentLookupResult.json.ai.metadata.erp_lookup.status, 'ambiguous');
assert.equal(incoherentLookupResult.json.ai.metadata.erp_lookup.entity_id, null);

const acreedorV42 = {
  id: 17,
  codigo: 17,
  nombre: 'ONDUSPAN, S.A',
  nif: 'A04119293',
  cuenta_id: '41000000017',
  cuenta_gasto: '99999999999',
  bloqueado: 'N',
  inactivo_rgpd: 'N',
};
const regimenSuggestion2110 = {
  filtros: {
    empresa_id: 1,
    proveedor_id: 17,
    proveedor_tipo: 'acreedor',
  },
  criterio: {
    min_historicos: 3,
    min_confianza: 0.98,
    requiere_ganador_unico: true,
    circuito_erp: 'no_GE',
    firma: 'tipos_iva_activos_ordenados_sin_duplicados',
  },
  estado: 'sugerido',
  firma_iva: ['21'],
  recuentos: [{ regimen_id: 2110, usos: 50, confianza: 1 }],
  sugerencia: {
    regimen_id: 2110,
    usos: 50,
    confianza: 1,
    criterio: 'historico_mismo_proveedor_empresa_circuito_y_firma_iva',
  },
  total_historicos_coincidentes: 50,
  total_historicos_evaluados: 50,
};
const exactMaCandidate = {
  source_table: 'albmaterial',
  source_id: 2108,
  albaran_id: 2108,
  id_interno_estable: 'albmaterial:2108',
  empresa: 1,
  acreedor_id: 17,
  Origen: 'MA',
  Serie: 'A26',
  Albaran: 2108,
  Ref: '479628',
  Fecha: '2026-06-29',
  Importe: 87.4,
};
const defaultV42Extraction = {
  document_kind: 'factura',
  receptor: {
    nombre: 'CAMPOJOYMA S.L.',
    nif: 'B04493482',
    es_campojoyma: true,
  },
  proveedor_nombre: 'ONDUSPAN, S.A',
  proveedor_nif: 'A04119293',
  numero_factura: 'FV-42',
  fecha_factura: '2026-06-30',
  moneda: 'EUR',
  base_total: 100,
  descuento_total: null,
  total: 121,
  tramos_iva: [
    { base: 100, porcentaje: 21, cuota: 21 },
    { base: null, porcentaje: null, cuota: null },
  ],
  retencion: { base: null, porcentaje: null, cuota: null },
  lineas: [],
  referencias: ['479628'],
  albaranes_referenciados: [
    {
      origen_impreso: null,
      campana: null,
      serie: null,
      numero: null,
      referencia: '479628',
      fecha: null,
      importe: null,
      pagina: 1,
    },
  ],
  vencimientos: [{ fecha: '2026-08-30', importe: 121 }],
  evidencias: [],
};

const runV42Enrichment = async ({
  extraction = {},
  acreedor = acreedorV42,
  duplicateResponse = { items: [], total: 0 },
  linkedPunteosResponse = null,
  regimenResponse = regimenSuggestion2110,
  maResponse = { items: [exactMaCandidate], total: 1 },
}) => {
  const requests = [];
  const helpers = {
    httpRequest: async ({ url }) => {
      requests.push(url);
      const parsed = new URL(url);
      if (parsed.pathname === '/acreedores') {
        return { items: [acreedor], total: 1 };
      }
      if (parsed.pathname === `/acreedores/${acreedor.id}`) return acreedor;
      if (parsed.pathname === '/empresas/1') return { id: 1 };
      if (parsed.pathname === '/facturasrecibidas/buscar') {
        return duplicateResponse;
      }
      if (/^\/facturasrecibidas\/\d+\/punteos$/.test(parsed.pathname)) {
        if (linkedPunteosResponse === null) {
          throw new Error(
            `No se configuro respuesta de punteos existentes para ${url}`,
          );
        }
        return linkedPunteosResponse;
      }
      if (parsed.pathname === '/facturasrecibidas/regimen-sugerido') {
        return regimenResponse;
      }
      if (parsed.pathname === '/albaranes-gastos/punteables') {
        return maResponse;
      }
      throw new Error(`Peticion inesperada en validator v4.2: ${url}`);
    },
  };
  const input = {
    source: {
      request_id: 'test-v42',
      pdf_base64: 'JVBERi0=',
      pdf_nombre: 'test-v42.pdf',
      pdf_mime_type: 'application/pdf',
      pdf_size: 8,
    },
    ai: {
      ok: true,
      extraction: { ...defaultV42Extraction, ...extraction },
      metadata: {
        schema_version: 4,
        confidence: 0.99,
        warnings: [],
        erp_lookup: {
          status: 'unique',
          entity_type: 'acreedor',
          matched_by: 'nif',
          entity_id: acreedor.id,
          codigo: acreedor.codigo,
          nombre: acreedor.nombre,
          nif: acreedor.nif,
          candidate_count: 1,
          candidates: [],
          warnings: [],
        },
      },
    },
  };
  const result = await new AsyncFunction(
    '$json',
    '$vars',
    enrichmentCode,
  ).call({ helpers }, input, {});
  return { result, output: result.json.output, requests };
};

const exactV42 = await runV42Enrichment({});
const exactFrr = exactV42.output.extraction;
assert.equal(exactFrr.FRR_idproveedor, 17);
assert.equal(exactFrr.FRR_Idempresa, 1);
assert.equal(exactFrr.FRR_ejercicio, 25);
assert.equal(exactFrr.FRR_fechactb, '2026-06-30');
assert.equal(exactFrr.FRR_tipofactura, 'OT');
assert.equal(exactFrr.FRR_idregimen, 2110);
assert.deepEqual(
  [exactFrr.FRR_base1, exactFrr.FRR_iva1, exactFrr.FRR_cuota1],
  [100, 21, 21],
);
for (let slot = 2; slot <= 5; slot += 1) {
  assert.deepEqual(
    [
      exactFrr[`FRR_base${slot}`],
      exactFrr[`FRR_iva${slot}`],
      exactFrr[`FRR_cuota${slot}`],
    ],
    [0, 0, 0],
    `El slot IVA inactivo ${slot} debe quedar a cero.`,
  );
}
assert.deepEqual(
  [exactFrr.FRR_baseret, exactFrr.FRR_ret, exactFrr.FRR_cuotaret],
  [0, 0, 0],
);
assert.equal(exactFrr.FRR_CuotaNoDeducible, 0);
assert.equal(exactFrr.FRR_ctagasto1, '60200000001');
assert.equal(exactFrr.FRR_igasto1, 100);
assert.equal(exactFrr.FRR_Concepto, 'FRA. ONDUSPAN, S.A');
assert.equal(exactFrr.FRR_ObservacionesAEAT, exactFrr.FRR_Concepto);
assert.equal(exactFrr.FRR_Contabilizar, 'S');
assert.deepEqual(exactFrr.vencimientos, []);
assert.deepEqual(exactV42.output.ctb, []);
assert.deepEqual(exactV42.output.gastos, [
  {
    posicion: 1,
    descripcion: '60200000001',
    cuenta_gasto: '60200000001',
    importe: 100,
  },
]);
assert.equal(exactV42.output.punteos.length, 1);
assert.equal(exactV42.output.punteos[0].S, true);
assert.deepEqual(exactV42.output.punteos[0].source_lines, []);
assert.equal(exactV42.output.metadata.ready_for_erp, true);
assert.deepEqual(exactV42.result.json.ingest_payload.gastos, exactV42.output.gastos);
assert.deepEqual(exactV42.result.json.ingest_payload.punteos, exactV42.output.punteos);

const regimenRequest = exactV42.requests
  .map((url) => new URL(url))
  .find((url) => url.pathname === '/facturasrecibidas/regimen-sugerido');
assert(regimenRequest, 'Debe repetirse la consulta determinista de regimen.');
assert.equal(regimenRequest.searchParams.get('proveedor_tipo'), 'acreedor');
assert.equal(regimenRequest.searchParams.get('empresa_id'), '1');
assert.equal(regimenRequest.searchParams.get('base2'), '0');
assert.equal(regimenRequest.searchParams.get('iva2'), '0');
assert.equal(regimenRequest.searchParams.get('cuota2'), '0');
const maRequest = exactV42.requests
  .map((url) => new URL(url))
  .find((url) => url.pathname === '/albaranes-gastos/punteables');
assert(maRequest, 'Debe buscarse cada referencia MA por el endpoint filtrado.');
assert.equal(maRequest.searchParams.get('source_table'), 'albmaterial');
assert.equal(maRequest.searchParams.get('proveedor_id'), '17');
assert.equal(maRequest.searchParams.get('empresa_id'), '1');
assert.equal(maRequest.searchParams.get('referencia'), '479628');
assert.equal(maRequest.searchParams.get('solo_pendientes'), 'true');

const equivalentLegalNameV42 = await runV42Enrichment({
  extraction: {
    proveedor_nombre: 'ONDUSPAN S.A.',
  },
  acreedor: {
    ...acreedorV42,
    nombre: 'ONDUSPAN, S.A.U.',
  },
});
assert.equal(equivalentLegalNameV42.output.extraction.FRR_idproveedor, 17);
assert.equal(
  equivalentLegalNameV42.output.metadata.match_evidence.proveedor.name_match_mode,
  'legal_suffix_family',
  'SA y SAU deben considerarse equivalentes solo con el mismo nucleo exacto.',
);

const equivalentLimitedNameV42 = await runV42Enrichment({
  extraction: {
    proveedor_nombre: 'ALIMENTOS CAMPO S.L.',
  },
  acreedor: {
    ...acreedorV42,
    nombre: 'ALIMENTOS CAMPO, S.L.U.',
  },
});
assert.equal(equivalentLimitedNameV42.output.extraction.FRR_idproveedor, 17);
assert.equal(
  equivalentLimitedNameV42.output.metadata.match_evidence.proveedor.name_match_mode,
  'legal_suffix_family',
  'SL y SLU deben considerarse equivalentes solo con el mismo nucleo exacto.',
);

const contradictoryVisibleNameV42 = await runV42Enrichment({
  extraction: {
    proveedor_nombre: 'PROVEEDOR TOTALMENTE DISTINTO, S.L.',
  },
});
assert.equal(contradictoryVisibleNameV42.output.extraction.FRR_idproveedor, null);
assert.equal(
  contradictoryVisibleNameV42.output.metadata.match_evidence.proveedor.resolution,
  'detail_not_confirmed',
);
assert.equal(contradictoryVisibleNameV42.output.metadata.ready_for_erp, false);
assert.equal(
  contradictoryVisibleNameV42.requests.some(
    (url) => new URL(url).pathname === '/facturasrecibidas/regimen-sugerido',
  ),
  false,
  'Un NIF con nombre visible contradictorio no puede avanzar a regimen.',
);

const ambiguousMaV42 = await runV42Enrichment({
  maResponse: {
    items: [
      exactMaCandidate,
      { ...exactMaCandidate, source_id: 2208, albaran_id: 2208 },
    ],
    total: 2,
  },
});
assert.equal(
  ambiguousMaV42.output.punteos.some((punteo) => punteo.S === true),
  false,
);
assert.equal(ambiguousMaV42.output.metadata.ready_for_erp, false);

const incompleteMaV42 = await runV42Enrichment({
  maResponse: { items: [exactMaCandidate], total: 2 },
});
assert.equal(incompleteMaV42.output.punteos.length, 0);
assert.equal(
  incompleteMaV42.output.metadata.match_evidence.punteos.catalog_complete,
  false,
);
assert.equal(incompleteMaV42.output.metadata.ready_for_erp, false);

const existingInvoiceV42 = await runV42Enrichment({
  duplicateResponse: {
    items: [
      {
        FRR_id: 9001,
        FRR_numero: 8001,
        FRR_numerofactura: 'FV-42',
      },
    ],
    total: 1,
  },
  linkedPunteosResponse: {
    items: [
      {
        ...exactMaCandidate,
        factura_recibida_id: 9001,
        'Importe P': 87.4,
        S: 'S',
        Ver: 'S',
      },
    ],
    total: 1,
  },
});
assert.equal(existingInvoiceV42.output.punteos.length, 1);
assert.equal(existingInvoiceV42.output.punteos[0].source_table, 'albmaterial');
assert.equal(existingInvoiceV42.output.punteos[0].source_id, 2108);
assert.equal(
  existingInvoiceV42.output.punteos.some((punteo) => punteo.S === true),
  false,
);
assert.equal(existingInvoiceV42.output.punteos[0].S, false);
assert.equal(
  existingInvoiceV42.output.metadata.match_evidence.punteos.existing_links_complete,
  true,
);
const existingPunteosRequest = existingInvoiceV42.requests
  .map((url) => new URL(url))
  .find((url) => url.pathname === '/facturasrecibidas/9001/punteos');
assert(existingPunteosRequest, 'Debe recuperarse el punteo real de la factura ERP.');
assert.equal(existingPunteosRequest.searchParams.get('include_lines'), 'false');
assert.equal(
  existingInvoiceV42.requests.some(
    (url) => new URL(url).pathname === '/albaranes-gastos/punteables',
  ),
  false,
  'Una factura existente no debe sustituir sus enlaces reales por candidatos MA.',
);
assert.equal(existingInvoiceV42.output.metadata.ready_for_erp, false);

const incompleteExistingLinksV42 = await runV42Enrichment({
  duplicateResponse: {
    items: [
      {
        FRR_id: 9001,
        FRR_numero: 8001,
        FRR_numerofactura: 'FV-42',
      },
    ],
    total: 1,
  },
  linkedPunteosResponse: {
    items: [
      {
        ...exactMaCandidate,
        factura_recibida_id: 9001,
      },
    ],
    total: 2,
  },
});
assert.equal(incompleteExistingLinksV42.output.punteos.length, 0);
assert.equal(
  incompleteExistingLinksV42.output.metadata.match_evidence.punteos.existing_links_complete,
  false,
);
assert.equal(
  incompleteExistingLinksV42.output.punteos.some((punteo) => punteo.S === true),
  false,
);
assert.equal(incompleteExistingLinksV42.output.metadata.ready_for_erp, false);

const incompleteVatV42 = await runV42Enrichment({
  extraction: {
    albaranes_referenciados: [],
    referencias: [],
    tramos_iva: [{ base: 100, porcentaje: null, cuota: 21 }],
  },
});
assert.equal(incompleteVatV42.output.extraction.FRR_base1, 100);
assert.equal(incompleteVatV42.output.extraction.FRR_iva1, null);
assert.equal(incompleteVatV42.output.extraction.FRR_cuota1, 21);
assert.equal(incompleteVatV42.output.extraction.FRR_idregimen, null);
assert.equal(incompleteVatV42.output.metadata.ready_for_erp, false);
assert.match(
  incompleteVatV42.output.metadata.warnings.join(' '),
  /tramo IVA activo 1 esta incompleto/i,
);
assert.equal(
  incompleteVatV42.requests.some(
    (url) => new URL(url).pathname === '/facturasrecibidas/regimen-sugerido',
  ),
  false,
  'No se consulta regimen con una firma IVA activa incompleta.',
);

const percentageOnlyVatV42 = await runV42Enrichment({
  extraction: {
    albaranes_referenciados: [],
    referencias: [],
    tramos_iva: [{ base: null, porcentaje: 21, cuota: null }],
  },
});
assert.equal(percentageOnlyVatV42.output.extraction.FRR_base1, null);
assert.equal(percentageOnlyVatV42.output.extraction.FRR_iva1, 21);
assert.equal(percentageOnlyVatV42.output.extraction.FRR_cuota1, null);
assert.equal(percentageOnlyVatV42.output.extraction.FRR_idregimen, null);
assert.equal(percentageOnlyVatV42.output.metadata.ready_for_erp, false);
assert.match(
  percentageOnlyVatV42.output.metadata.warnings.join(' '),
  /tramo IVA activo 1 esta incompleto/i,
);

const configuredZeroVatV42 = await runV42Enrichment({
  extraction: {
    albaranes_referenciados: [],
    referencias: [],
    tramos_iva: [
      { base: 100, porcentaje: 21, cuota: 21 },
      { base: 0, porcentaje: 10, cuota: 0 },
    ],
  },
});
assert.deepEqual(
  [
    configuredZeroVatV42.output.extraction.FRR_base2,
    configuredZeroVatV42.output.extraction.FRR_iva2,
    configuredZeroVatV42.output.extraction.FRR_cuota2,
  ],
  [0, 0, 0],
  'Un slot ERP preconfigurado como 0/10/0 esta inactivo y debe limpiarse a 0/0/0.',
);
assert.equal(configuredZeroVatV42.output.extraction.FRR_idregimen, 2110);
assert.doesNotMatch(
  configuredZeroVatV42.output.metadata.warnings.join(' '),
  /tramo IVA activo 2 esta incompleto/i,
);

const partiallyUnknownConfiguredVatV42 = await runV42Enrichment({
  extraction: {
    albaranes_referenciados: [],
    referencias: [],
    tramos_iva: [
      { base: 100, porcentaje: 21, cuota: 21 },
      { base: 0, porcentaje: 10, cuota: null },
    ],
  },
});
assert.deepEqual(
  [
    partiallyUnknownConfiguredVatV42.output.extraction.FRR_base2,
    partiallyUnknownConfiguredVatV42.output.extraction.FRR_iva2,
    partiallyUnknownConfiguredVatV42.output.extraction.FRR_cuota2,
  ],
  [0, 10, null],
);
assert.equal(partiallyUnknownConfiguredVatV42.output.extraction.FRR_idregimen, null);
assert.equal(partiallyUnknownConfiguredVatV42.output.metadata.ready_for_erp, false);
assert.match(
  partiallyUnknownConfiguredVatV42.output.metadata.warnings.join(' '),
  /tramo IVA activo 2 esta incompleto/i,
);

const referencesOverEdgeLimit = Array.from({ length: 26 }, (_, index) => ({
  origen_impreso: null,
  campana: null,
  serie: null,
  numero: null,
  referencia: `REF-${String(index + 1).padStart(2, '0')}`,
  fecha: null,
  importe: null,
  pagina: 1,
}));
const overReferenceLimitV42 = await runV42Enrichment({
  extraction: {
    referencias: referencesOverEdgeLimit.map((item) => item.referencia),
    albaranes_referenciados: referencesOverEdgeLimit,
  },
});
assert.equal(
  overReferenceLimitV42.requests.filter(
    (url) => new URL(url).pathname === '/albaranes-gastos/punteables',
  ).length,
  25,
  'n8n no debe consultar mas de las 25 referencias que acepta Edge.',
);
assert.equal(
  overReferenceLimitV42.output.metadata.match_evidence.punteos.safe_reference_limit,
  25,
);
assert.equal(
  overReferenceLimitV42.output.punteos.some((punteo) => punteo.S === true),
  false,
);
assert.equal(overReferenceLimitV42.output.metadata.ready_for_erp, false);

const executedRegressionNames = [
  'parser-esquema-invalido-reintentable',
  'normalizador-elimina-bases-prorrateadas',
  'normalizador-respeta-descuento-global',
  'normalizador-conserva-lookup-unico-coherente',
  'normalizador-degrada-lookup-unico-incoherente',
  'borrador-acreedor-y-ma-exacto',
  'nombre-equivalente-sa-sau',
  'nombre-equivalente-sl-slu',
  'nif-exacto-con-nombre-contradictorio',
  'ma-ambiguo-sin-autoseleccion',
  'catalogo-ma-incompleto',
  'factura-existente-recupera-punteos-reales',
  'factura-existente-punteos-incompletos',
  'iva-activo-incompleto',
  'iva-solo-porcentaje-con-importes-desconocidos',
  'iva-preconfigurado-cero-diez-cero',
  'iva-preconfigurado-parcial-cero-diez-null',
  'limite-edge-veinticinco-referencias',
];

console.log(
  JSON.stringify(
    {
      ok: true,
      workflow: path.relative(root, workflowPath),
      nodes: workflow.nodes.length,
      tools: toolNodes.length,
      schema_version: parserSchema.properties?.schema_version?.const,
      contract_version: 2,
      scenarios: executedRegressionNames.length,
      scenario_names: executedRegressionNames,
    },
    null,
    2,
  ),
);
