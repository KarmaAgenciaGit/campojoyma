import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const workflowPath = path.join(
  root,
  'docs',
  'n8n',
  'CAMPOJOYMA - Entrada segura de facturas recibidas v4.3 (webhook v2).json',
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
  'CAMPOJOYMA - Entrada segura de facturas recibidas v4.3 (webhook v2)',
  'El workflow debe identificar la revision documental sin tools ERP.',
);
assert.match(
  workflow.versionId ?? '',
  /agente-v4\.3-2026-08-04-expense-history$/,
  'La exportacion debe conservar un identificador verificable de prompt v4.3.',
);
assert.match(
  systemPrompt,
  /^PROMPT_VERSION: 4\.3\n/,
  'El mensaje de sistema debe declarar la revision v4.3.',
);
assert.doesNotMatch(
  systemPrompt,
  /^=/,
  'El mensaje de sistema es texto fijo y no debe depender del modo expresion.',
);
assert.match(
  userPrompt,
  /^=Analiza exclusivamente las \{\{ \$json\.pagesConverted \}\} imagenes adjuntas/,
  'La tarea debe recibir solo las imagenes y mantener el lookup ERP fuera del modelo.',
);
assert.doesNotMatch(
  userPrompt,
  /request_id|factura_id|archivo_pdf_id|pdf_nombre|email_from|email_subject|\bsource\b/,
  'El modelo no debe recibir identificadores tecnicos, origen ni metadatos de correo.',
);
assert.equal(
  workflow.nodes.find((node) => node.name === '5.6 LUNA')?.parameters?.options
    ?.timeout,
  55000,
  'El modelo debe respetar el presupuesto global del webhook Edge.',
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
assert.equal(agentNode?.maxTries, 1);
assert.equal(agentNode?.waitBetweenTries, 1000);
const emailIngestNode = workflow.nodes.find(
  (node) => node.name === 'Enviar email a Edge ingest',
);
assert.equal(emailIngestNode?.retryOnFail, true);
assert.equal(emailIngestNode?.maxTries, 3);
assert.equal(emailIngestNode?.waitBetweenTries, 2000);
assert.equal(
  agentNode?.onError,
  'continueErrorOutput',
  'El unico intento debe seguir por la rama fail-closed si falla.',
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
  /POLITICA SIN TOOLS[\s\S]*No resuelvas proveedor, regimen, gasto ni albaranes/,
  'Toda consulta ERP debe quedar fuera del modelo documental.',
);
assert.doesNotMatch(
  systemPrompt,
  /Sugerir regimen IVA historico/,
  'El modelo no puede controlar la consulta historica de regimen.',
);
assert.match(systemPrompt, /Nunca concatenes porcentajes/);
assert.doesNotMatch(
  systemPrompt,
  /Buscar albaran MA por referencia/,
  'El PDF no puede inducir consultas de albaranes a traves de la IA.',
);
assert.match(
  systemPrompt,
  /observaciones read-only[\s\S]*Supabase\/Edge es la unica autoridad/,
  'Las decisiones ERP deben quedar fuera del modelo y de n8n.',
);
assert.doesNotMatch(
  systemPrompt,
  /gasto 60200000001/,
  'El prompt no puede conservar una cuenta de gasto global fija.',
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
assert.equal(toolNodes.length, 0, 'El agente documental no puede tener tools ERP.');
const pdfRenderNode = workflow.nodes.find((node) => node.name === 'PDF a imagenes');
assert.equal(pdfRenderNode?.parameters?.authentication, 'genericCredentialType');
assert.equal(pdfRenderNode?.parameters?.genericAuthType, 'httpHeaderAuth');
assert.equal(pdfRenderNode?.parameters?.headerParameters, undefined);
assert.equal(pdfRenderNode?.parameters?.options?.timeout, 25000);
assert.equal(
  pdfRenderNode?.credentials?.httpHeaderAuth?.name,
  'Campojoyma PDF renderer token',
  'La autorizacion del renderizador debe vivir en el almacen de credenciales de n8n.',
);
const inputNormalizerCode = workflow.nodes.find(
  (node) => node.name === 'Normalizar entrada',
)?.parameters?.jsCode ?? '';
assert.match(
  inputNormalizerCode,
  /CAMPOJOYMA_PDF_PREDECODE_LIMIT_V1[\s\S]*maxEncodedPdfLength[\s\S]*Buffer\.from/,
  'El PDF debe limitarse antes de reservar el Buffer.',
);
const emailPdfCode = workflow.nodes.find(
  (node) => node.name === 'Extraer PDF del email',
)?.parameters?.jsCode ?? '';
assert.match(
  emailPdfCode,
  /CAMPOJOYMA_EMAIL_PDF_LIMIT_V1[\s\S]*declaredBinarySize[\s\S]*getBinaryDataBuffer[\s\S]*buffer\.length > maxPdfBytes/,
  'Los adjuntos de correo deben limitarse antes y despues de leer el binario.',
);
const renderedImagesCode = workflow.nodes.find(
  (node) => node.name === 'Reconstruir imagenes binarias',
)?.parameters?.jsCode ?? '';
assert.match(
  renderedImagesCode,
  /CAMPOJOYMA_IMAGE_MAGIC_V1[\s\S]*contract_version\) !== 2[\s\S]*maxImageBytes[\s\S]*maxTotalImageBytes[\s\S]*identifyImage[\s\S]*image\/webp/,
  'Las paginas renderizadas deben limitar tamano total y validar su firma real.',
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
  /const extractionOk = isV4 && declaredOk/,
  'Un schema anterior nunca puede autorizar la extraccion aunque declare ok=true.',
);
assert.match(
  normalizerCode,
  /const lookupSource = \{[\s\S]*status: 'not_consulted'/,
  'Cualquier lookup ERP inventado por el modelo debe ignorarse.',
);
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
  /const shouldIngest = ai\.ok === true/,
  'Solo un ok=true explicito y normalizado puede llegar a ingesta.',
);
assert.match(
  enrichmentCode,
  /erpReadDeadlineAt[\s\S]*remainingBudgetMs[\s\S]*Math\.min\([\s\S]*remainingBudgetMs/,
  'Todas las lecturas ERP deben compartir un deadline global.',
);
assert.match(
  enrichmentCode,
  /referenceLookupConcurrency = 5[\s\S]*Promise\.all/,
  'Las referencias MA deben resolverse con concurrencia acotada.',
);
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
  /const ejercicio = null;/,
  'n8n no debe fijar el ejercicio ERP.',
);
assert.match(
  enrichmentCode,
  /\/facturasrecibidas\/regimen-sugerido[\s\S]*responseConsistent[\s\S]*regimenId = suggestedRegimen/,
  'n8n solo puede observar una sugerencia historica consistente.',
);
assert.match(
  enrichmentCode,
  /ACCOUNTING_DRAFT_POLICY = 'edge_authoritative_v3'[\s\S]*EXPENSE_HISTORY_MIN_INVOICES = 3[\s\S]*EXPENSE_HISTORY_MIN_CONFIDENCE = 0\.98[\s\S]*\/facturasrecibidas\/cuentas-gasto-historicas[\s\S]*source: 'n8n_erp_history_observation'[\s\S]*authoritative: false[\s\S]*proposed_account: leaderSafe \? leader\.cuenta : null/,
  'n8n debe observar el historico con el mismo criterio sin convertirse en autoridad contable.',
);
assert.doesNotMatch(
  enrichmentCode,
  /GASTO_ACCOUNT|FRR_ctagasto1:\s*expenseBase === null \? null : ['"]60200000001['"]/,
  'La cuenta de gasto no puede quedar hardcodeada en n8n.',
);
assert.match(
  enrichmentCode,
  /FRR_fechactb: null,[\s\S]*FRR_ejercicio: null,[\s\S]*FRR_idregimen: null,[\s\S]*FRR_tipofactura: null,[\s\S]*FRR_igasto1: null,[\s\S]*FRR_ctagasto1: null,[\s\S]*FRR_Contabilizar: null[\s\S]*evidence\.cuenta_gasto_proposal = expenseHistoryProposal/,
  'La propuesta n8n debe quedar fuera de la cabecera y en un namespace informativo.',
);
assert.doesNotMatch(
  enrichmentCode,
  /expenseHistoryEvidence\.resolved|evidence\.cuenta_gasto\s*=/,
  'La observacion de n8n no puede suplantar la evidencia autoritativa de Edge.',
);
assert.match(
  enrichmentCode,
  /numero_factura: numeroFactura,[\s\S]*tipo_factura: tipoFactura,[\s\S]*fecha_factura: readString\(literal\.fecha_factura\)/,
  'La comprobacion de duplicados debe quedar acotada por circuito y fecha.',
);
assert.doesNotMatch(
  enrichmentCode,
  /empresa_id: empresaId,\s*ejercicio,/,
  'La consulta exacta debe usar fecha y circuito sin depender de un ejercicio fijo.',
);
assert.match(
  enrichmentCode,
  /const isStrictIsoDate =[\s\S]*Array\.isArray\(response\.items\)[\s\S]*bloqueoFacturas === 'N'[\s\S]*bloqueoFacturas === 'S'/,
  'La observacion de gasto debe validar envelope, fechas y estado de bloqueo.',
);
assert(
  enrichmentCode.includes('/^\\d{11}$/.test(cuenta)'),
  'La cuenta propuesta debe tener exactamente 11 digitos.',
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
assert.doesNotMatch(
  grossLineNormalizerResult.json.ai.metadata.warnings.join(' '),
  /No se encontro un acreedor por el NIF visible/i,
  'Los avisos de un lookup ERP inventado por el modelo deben descartarse.',
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
  'El normalizador debe descartar cualquier lookup ERP atribuido al modelo.',
);
const legacySchemaNormalizerResult = await new AsyncFunction(
  '$json',
  '$',
  normalizerCode,
)(
  {
    output: JSON.stringify({
      schema_version: 3,
      ok: true,
      document_kind: 'factura',
      receptor: { es_campojoyma: true },
      proveedor: { nombre: 'PROVEEDOR LEGACY', nif: 'B12345678' },
      factura: {
        numero: 'LEGACY-1',
        fecha: '2026-08-04',
        moneda: 'EUR',
        base_total: 100,
        total: 121,
      },
      tramos_iva: [{ base: 100, porcentaje: 21, cuota: 21 }],
      retencion: { base: null, porcentaje: null, cuota: null },
      lineas: [],
      albaranes_referenciados: [],
      referencias: [],
      vencimientos: [],
      evidencias: [],
      erp_lookup: { status: 'unique', entity_id: 17 },
      quality: {
        confidence: 1,
        requires_review: false,
        pages_analyzed: 1,
        warnings: [],
      },
    }),
  },
  () => ({ item: { json: { security_warnings: [] } } }),
);
assert.equal(
  legacySchemaNormalizerResult.json.ai.ok,
  false,
  'Un payload schema_version 3 debe fallar cerrado aunque declare ok=true.',
);
assert.equal(
  legacySchemaNormalizerResult.json.ai.metadata.erp_lookup.status,
  'not_consulted',
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
  'El normalizador debe ignorar incluso un lookup unico inventado por el modelo.',
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
assert.equal(incoherentLookupResult.json.ai.metadata.erp_lookup.status, 'not_consulted');
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
const expenseHistory602 = {
  filtros: {
    empresa_id: 1,
    proveedor_id: 17,
    proveedor_tipo: 'acreedor',
    fecha_desde: null,
    fecha_hasta: null,
  },
  total_facturas_con_gasto: 130,
  items: [
    {
      cuenta: '60200000001',
      descripcion: 'COMPRAS ENVASES Y EMBALAJES',
      usos_facturas: 130,
      usos_lineas: 130,
      porcentaje_facturas: 1,
      importe_neto_total: '100000.00',
      importe_absoluto_total: '100000.00',
      primera_fecha_uso: '2025-01-01',
      ultima_fecha_uso: '2026-06-30',
      existe_en_catalogo: true,
      bloqueo_facturas: 'N',
    },
  ],
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
  expenseHistoryResponse = expenseHistory602,
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
      if (
        parsed.pathname ===
        '/facturasrecibidas/cuentas-gasto-historicas'
      ) {
        return expenseHistoryResponse;
      }
      if (parsed.pathname === '/albaranes-gastos/punteables') {
        return maResponse;
      }
      throw new Error(`Peticion inesperada en validator v4.3: ${url}`);
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
assert.equal(exactFrr.FRR_ejercicio, null);
assert.equal(exactFrr.FRR_fechactb, null);
assert.equal(exactFrr.FRR_tipofactura, null);
assert.equal(exactFrr.FRR_idregimen, null);
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
assert.equal(exactFrr.FRR_CuotaNoDeducible, null);
assert.equal(exactFrr.FRR_ctagasto1, null);
assert.equal(exactFrr.FRR_igasto1, null);
assert.equal(exactFrr.FRR_Concepto, null);
assert.equal(exactFrr.FRR_ObservacionesAEAT, null);
assert.equal(exactFrr.FRR_Contabilizar, null);
assert.deepEqual(exactFrr.vencimientos, []);
assert.deepEqual(exactV42.output.ctb, []);
assert.deepEqual(exactV42.output.gastos, []);
assert.equal(exactV42.output.punteos.length, 1);
assert.equal(exactV42.output.punteos[0].S, true);
assert.deepEqual(exactV42.output.punteos[0].source_lines, []);
assert.equal(exactV42.output.metadata.ready_for_edge_enrichment, true);
assert.equal(exactV42.output.metadata.ready_for_erp, false);
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
const expenseHistoryRequest = exactV42.requests
  .map((url) => new URL(url))
  .find(
    (url) =>
      url.pathname === '/facturasrecibidas/cuentas-gasto-historicas',
  );
assert(
  expenseHistoryRequest,
  'Debe consultarse el historico de gasto tras confirmar el acreedor.',
);
assert.equal(expenseHistoryRequest.searchParams.get('empresa_id'), '1');
assert.equal(expenseHistoryRequest.searchParams.get('proveedor_id'), '17');
assert.equal(
  expenseHistoryRequest.searchParams.get('proveedor_tipo'),
  'acreedor',
);
assert.equal(expenseHistoryRequest.searchParams.get('limit'), '10');
assert.equal(
  exactV42.output.metadata.match_evidence.cuenta_gasto_proposal
    .proposed_account,
  '60200000001',
);
assert.equal(
  exactV42.output.metadata.match_evidence.cuenta_gasto_proposal.eligible,
  true,
);
assert.equal(
  exactV42.output.metadata.match_evidence.cuenta_gasto_proposal.authoritative,
  false,
);
const duplicateRequest = exactV42.requests
  .map((url) => new URL(url))
  .find((url) => url.pathname === '/facturasrecibidas/buscar');
assert(duplicateRequest, 'Debe comprobarse el duplicado exacto.');
assert.equal(duplicateRequest.searchParams.get('tipo_factura'), 'OT');
assert.equal(duplicateRequest.searchParams.has('ejercicio'), false);
assert.equal(
  duplicateRequest.searchParams.get('fecha_factura'),
  '2026-06-30',
);
const maRequest = exactV42.requests
  .map((url) => new URL(url))
  .find((url) => url.pathname === '/albaranes-gastos/punteables');
assert(maRequest, 'Debe buscarse cada referencia MA por el endpoint filtrado.');
assert.equal(maRequest.searchParams.get('source_table'), 'albmaterial');
assert.equal(maRequest.searchParams.get('proveedor_id'), '17');
assert.equal(maRequest.searchParams.get('empresa_id'), '1');
assert.equal(maRequest.searchParams.get('referencia'), '479628');
assert.equal(maRequest.searchParams.get('solo_pendientes'), 'true');

const dynamicExpenseAccountV43 = await runV42Enrichment({
  expenseHistoryResponse: {
    ...expenseHistory602,
    items: [
      {
        ...expenseHistory602.items[0],
        cuenta: '60700000001',
        descripcion: 'TRABAJOS EXTERIORES',
      },
    ],
  },
});
assert.equal(
  dynamicExpenseAccountV43.output.extraction.FRR_ctagasto1,
  null,
  'n8n nunca debe escribir la cuenta observada en la cabecera.',
);
assert.equal(
  dynamicExpenseAccountV43.output.metadata.match_evidence
    .cuenta_gasto_proposal.proposed_account,
  '60700000001',
);
assert.deepEqual(dynamicExpenseAccountV43.output.gastos, []);

const insufficientExpenseHistoryV43 = await runV42Enrichment({
  expenseHistoryResponse: {
    ...expenseHistory602,
    total_facturas_con_gasto: 2,
    items: [
      {
        ...expenseHistory602.items[0],
        usos_facturas: 2,
        usos_lineas: 2,
        porcentaje_facturas: 1,
      },
    ],
  },
});
assert.equal(insufficientExpenseHistoryV43.output.extraction.FRR_ctagasto1, null);
assert.deepEqual(insufficientExpenseHistoryV43.output.gastos, []);
assert.equal(
  insufficientExpenseHistoryV43.output.metadata.match_evidence
    .cuenta_gasto_proposal.status,
  'insufficient_dominance',
);
assert.equal(insufficientExpenseHistoryV43.output.metadata.ready_for_erp, false);

const tiedExpenseHistoryV43 = await runV42Enrichment({
  expenseHistoryResponse: {
    ...expenseHistory602,
    total_facturas_con_gasto: 10,
    items: [
      {
        ...expenseHistory602.items[0],
        usos_facturas: 5,
        usos_lineas: 5,
        porcentaje_facturas: 0.5,
      },
      {
        ...expenseHistory602.items[0],
        cuenta: '60700000001',
        descripcion: 'TRABAJOS EXTERIORES',
        usos_facturas: 5,
        usos_lineas: 5,
        porcentaje_facturas: 0.5,
        primera_fecha_uso: '2025-01-01',
        ultima_fecha_uso: '2026-05-30',
      },
    ],
  },
});
assert.equal(tiedExpenseHistoryV43.output.extraction.FRR_ctagasto1, null);
assert.equal(
  tiedExpenseHistoryV43.output.metadata.match_evidence.cuenta_gasto_proposal
    .eligible,
  false,
);

const wrongExpenseContextV43 = await runV42Enrichment({
  expenseHistoryResponse: {
    ...expenseHistory602,
    filtros: {
      ...expenseHistory602.filtros,
      proveedor_id: 18,
    },
  },
});
assert.equal(wrongExpenseContextV43.output.extraction.FRR_ctagasto1, null);
assert.equal(
  wrongExpenseContextV43.output.metadata.match_evidence.cuenta_gasto_proposal
    .status,
  'invalid_response',
);

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
assert.equal(configuredZeroVatV42.output.extraction.FRR_idregimen, null);
assert.equal(
  configuredZeroVatV42.output.metadata.match_evidence.regimen_proposal.value,
  2110,
  'La sugerencia puede observarse, pero solo Edge puede aplicarla.',
);
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
  'schema-v3-ok-true-falla-cerrado',
  'normalizador-elimina-bases-prorrateadas',
  'normalizador-respeta-descuento-global',
  'normalizador-descarta-lookup-modelo-coherente',
  'normalizador-descarta-lookup-modelo-incoherente',
  'agente-sin-tools-erp',
  'borrador-acreedor-y-ma-exacto',
  'cuenta-gasto-historica-dinamica',
  'cuenta-gasto-historico-insuficiente',
  'cuenta-gasto-historico-empatado',
  'cuenta-gasto-historico-contexto-incorrecto',
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
