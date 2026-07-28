import { createHmac, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const parseEnv = (content) =>
  Object.fromEntries(
    content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#') && line.includes('='))
      .map((line) => {
        const separator = line.indexOf('=');
        return [
          line.slice(0, separator).trim(),
          line
            .slice(separator + 1)
            .trim()
            .replace(/^"(.*)"$/, '$1'),
        ];
      }),
  );

const base64Url = (value) => Buffer.from(value).toString('base64url');

const signJwt = (secret) => {
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = base64Url(
    JSON.stringify({
      sub: 'agroiris-edge',
      iat: now,
      exp: now + 300,
      jti: randomUUID(),
    }),
  );
  const unsigned = `${header}.${payload}`;
  return `${unsigned}.${createHmac('sha256', secret)
    .update(unsigned)
    .digest('base64url')}`;
};

const unwrapItems = (value) => {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== 'object') return [];
  for (const key of ['items', 'data', 'datos', 'punteos']) {
    if (Array.isArray(value[key])) return value[key];
  }
  return [];
};

const asInteger = (value) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

const pick = (object, keys) =>
  Object.fromEntries(keys.map((key) => [key, object?.[key] ?? null]));

const normalizeText = (value) =>
  String(value ?? '')
    .toLocaleLowerCase('es-ES')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const textTokens = (value) =>
  new Set(
    normalizeText(value)
      .split(/\s+/)
      .filter((token) => token.length >= 3 && !['fra', 'factura'].includes(token)),
  );

const nameMatchesConcept = (name, concept) => {
  const nameSet = textTokens(name);
  const conceptSet = textTokens(concept);
  if (nameSet.size === 0 || conceptSet.size === 0) return false;
  const matched = [...nameSet].filter((token) => conceptSet.has(token)).length;
  return matched >= Math.min(2, nameSet.size) && matched / nameSet.size >= 0.5;
};

const mapConcurrent = async (items, concurrency, mapper) => {
  const output = new Array(items.length);
  let cursor = 0;
  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (cursor < items.length) {
        const index = cursor;
        cursor += 1;
        output[index] = await mapper(items[index], index);
      }
    },
  );
  await Promise.all(workers);
  return output;
};

const env = parseEnv(await readFile(new URL('../.env', import.meta.url), 'utf8'));
const webhookUrl = env.N8N_CAMPOJOYMA_READ_WEBHOOK_URL;
const jwtSecret = env.N8N_CAMPOJOYMA_WEBHOOK_JWT_SECRET;
if (!webhookUrl || !jwtSecret) {
  throw new Error(
    'Faltan N8N_CAMPOJOYMA_READ_WEBHOOK_URL o N8N_CAMPOJOYMA_WEBHOOK_JWT_SECRET.',
  );
}

const jwt = signJwt(jwtSecret);
const apiGet = async (consulta) => {
  const url = new URL(webhookUrl);
  url.searchParams.set('consulta', consulta);
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${jwt}`,
    },
    signal: AbortSignal.timeout(45_000),
  });
  const raw = await response.text();
  if (!response.ok) {
    throw new Error(`${consulta}: HTTP ${response.status} ${raw.slice(0, 200)}`);
  }
  return raw.trim() ? JSON.parse(raw) : {};
};

const cases = [
  {
    label: 'ALMERITERRA-BIO',
    proveedorId: 1957,
    numeroFactura: 'FTV26/217',
    albaranEntrada: {
      serie: 'A26',
      numero: 8187,
    },
  },
  {
    label: 'MONTAJES Y MATERIAL AUXILIAR',
    proveedorId: 209,
    numeroFactura: '2603367',
  },
];

const inspectedCases = [];
for (const item of cases) {
  const search = await apiGet(
    `facturasrecibidas?proveedor_id=${item.proveedorId}` +
      `&numero_factura=${encodeURIComponent(item.numeroFactura)}&limit=10`,
  );
  const matches = unwrapItems(search);
  for (const match of matches) {
    const facturaId = asInteger(match.id ?? match.frr_id ?? match.FRR_id);
    if (!facturaId) continue;
    const [
      detail,
      punteosPayload,
      acreedorResult,
      agricultorResult,
      albaranEntradaResult,
    ] = await Promise.all([
      apiGet(`facturasrecibidas/${facturaId}`),
      apiGet(`facturasrecibidas/${facturaId}/punteos?include_lines=true`),
      apiGet(`acreedores/${item.proveedorId}`).catch((error) => ({
        error: error instanceof Error ? error.message : String(error),
      })),
      apiGet(`agricultores/${item.proveedorId}`).catch((error) => ({
        error: error instanceof Error ? error.message : String(error),
      })),
      item.albaranEntrada
        ? apiGet(
          `albaranes/entrada?agricultor_id=${item.proveedorId}` +
            `&serie=${encodeURIComponent(item.albaranEntrada.serie)}` +
            `&numero=${item.albaranEntrada.numero}&limit=10`,
        ).catch((error) => ({
          error: error instanceof Error ? error.message : String(error),
        }))
        : Promise.resolve(null),
    ]);
    const punteos = unwrapItems(punteosPayload);
    const albaranesEntrada = unwrapItems(albaranEntradaResult);
    const albaranesEntradaDetalle = [];
    for (const albaran of albaranesEntrada) {
      const albaranId = asInteger(albaran.id ?? albaran.AEN_idalbaran);
      if (!albaranId) continue;
      const albaranDetail = await apiGet(`albaranes/entrada/${albaranId}`);
      albaranesEntradaDetalle.push(
        pick(albaranDetail, [
          'AEN_idalbaran',
          'AEN_serie',
          'AEN_albaran',
          'AEN_fecha',
          'AEN_idagricultor',
          'AEN_IdEmpresaAgricultor',
          'AEN_idAgriPrincipal',
          'AEN_referencia',
          'AEN_tipoentrada',
          'AEN_tipofcs',
        ]),
      );
    }
    inspectedCases.push({
      label: item.label,
      list: pick(match, [
        'id',
        'numero',
        'fecha_factura',
        'numero_factura',
        'proveedor_id',
        'proveedor_nombre',
        'tipo_factura',
        'regimen_id',
        'total_factura',
      ]),
      detail: pick(detail, [
        'FRR_id',
        'FRR_numero',
        'FRR_fechafactura',
        'FRR_numerofactura',
        'FRR_idproveedor',
        'FRR_idcuenta',
        'FRR_tipofactura',
        'FRR_idregimen',
        'FRR_IdfacturaRec',
        'FRR_igasto1',
        'FRR_ctagasto1',
        'FRR_totalfac',
        'ACR_Nombre',
        'ACR_Nif',
      ]),
      identity_candidates: {
        acreedor: pick(acreedorResult, [
          'id',
          'codigo',
          'nombre',
          'nif',
          'cuenta_id',
          'cuenta_gasto',
          'bloqueado',
          'inactivo_rgpd',
          'error',
        ]),
        agricultor: pick(agricultorResult, [
          'id',
          'codigo',
          'nombre',
          'nif',
          'cuenta_id',
          'tipo_id',
          'empresa_id',
          'bloqueado',
          'activo',
          'error',
        ]),
      },
      albaranes_entrada: {
        list: albaranesEntrada,
        detail: albaranesEntradaDetalle,
      },
      punteos: punteos.map((punteo) =>
        pick(punteo, [
          'source_table',
          'source_id',
          'Origen',
          'Serie',
          'Albaran',
          'Ref',
          'Fecha',
          'Importe',
          'agricultor_id',
          'acreedor_id',
          'line_count',
        ]),
      ),
    });
  }
}

const typeCatalog = await apiGet('facturasrecibidas/tipos');
const typeProfiles = [];
for (const catalogItem of unwrapItems(typeCatalog)) {
  const tipo = catalogItem.tipo_factura;
  if (!tipo) continue;
  const profilePayload = await apiGet(
    `facturasrecibidas?tipo_factura=${encodeURIComponent(tipo)}&limit=50&offset=0`,
  );
  const invoices = unwrapItems(profilePayload);
  const accountPrefixes = {};
  const regimes = {};
  for (const invoice of invoices) {
    const prefix = String(invoice.cuenta_id ?? '').slice(0, 3) || 'VACIO';
    accountPrefixes[prefix] = (accountPrefixes[prefix] ?? 0) + 1;
    const regime = String(invoice.regimen_id ?? 'VACIO');
    regimes[regime] = (regimes[regime] ?? 0) + 1;
  }

  const providerExamples = [];
  const uniqueProviderIds = [
    ...new Set(
      invoices
        .map((invoice) => asInteger(invoice.proveedor_id))
        .filter(Boolean),
    ),
  ].slice(0, 5);
  const identities = await mapConcurrent(
    uniqueProviderIds,
    4,
    async (providerId) => {
      const [acreedor, agricultor] = await Promise.all([
        apiGet(`acreedores/${providerId}`).catch(() => null),
        apiGet(`agricultores/${providerId}`).catch(() => null),
      ]);
      const representative = invoices.find(
        (invoice) => asInteger(invoice.proveedor_id) === providerId,
      );
      return {
        provider_id: providerId,
        cuenta_id: representative?.cuenta_id ?? null,
        concepto: representative?.concepto ?? null,
        api_join_name: representative?.proveedor_nombre ?? null,
        acreedor: acreedor
          ? pick(acreedor, ['nombre', 'nif', 'cuenta_id'])
          : null,
        agricultor: agricultor
          ? pick(agricultor, ['nombre', 'nif', 'cuenta_id'])
          : null,
        concept_matches_acreedor: acreedor
          ? nameMatchesConcept(acreedor.nombre, representative?.concepto)
          : false,
        concept_matches_agricultor: agricultor
          ? nameMatchesConcept(agricultor.nombre, representative?.concepto)
          : false,
      };
    },
  );
  providerExamples.push(...identities);

  const originMap = new Map();
  const punteoSample = await mapConcurrent(
    invoices.slice(0, 20),
    5,
    async (invoice) => {
      const facturaId = asInteger(invoice.id ?? invoice.frr_id);
      if (!facturaId) return [];
      return unwrapItems(
        await apiGet(
          `facturasrecibidas/${facturaId}/punteos?include_lines=false`,
        ).catch(() => ({})),
      );
    },
  );
  for (const punteos of punteoSample) {
    for (const punteo of punteos) {
      const origin = String(punteo.Origen ?? punteo.origen ?? 'VACIO');
      const source = String(punteo.source_table ?? 'VACIO');
      const key = `${origin}|${source}`;
      originMap.set(key, (originMap.get(key) ?? 0) + 1);
    }
  }

  typeProfiles.push({
    tipo_factura: tipo,
    historical_total: catalogItem.total,
    fecha_min: catalogItem.fecha_min,
    fecha_max: catalogItem.fecha_max,
    sample_size: invoices.length,
    account_prefixes: accountPrefixes,
    regimenes: regimes,
    punteo_origins_first_20: Object.fromEntries(
      [...originMap.entries()].sort((left, right) =>
        left[0].localeCompare(right[0]),
      ),
    ),
    provider_examples: providerExamples,
  });
}

const samplePayload = await apiGet(
  'facturasrecibidas?fecha_desde=2026-06-01&fecha_hasta=2026-07-31&limit=100&offset=0',
);
const sampleInvoices = unwrapItems(samplePayload);
const sampleWithPunteos = await mapConcurrent(
  sampleInvoices,
  6,
  async (invoice) => {
    const facturaId = asInteger(invoice.id ?? invoice.frr_id ?? invoice.FRR_id);
    if (!facturaId) return { invoice, punteos: [], error: 'missing_id' };
    try {
      const payload = await apiGet(
        `facturasrecibidas/${facturaId}/punteos?include_lines=false`,
      );
      return { invoice, punteos: unwrapItems(payload), error: null };
    } catch (error) {
      return {
        invoice,
        punteos: [],
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
);

const patternMap = new Map();
const typeDistribution = new Map();
let invoicesWithPunteos = 0;
let punteoRows = 0;
let lookupErrors = 0;

for (const { invoice, punteos, error } of sampleWithPunteos) {
  const tipoFactura = String(
    invoice.tipo_factura ?? invoice.FRR_tipofactura ?? 'VACIO',
  );
  typeDistribution.set(
    tipoFactura,
    (typeDistribution.get(tipoFactura) ?? 0) + 1,
  );
  if (error) lookupErrors += 1;
  if (punteos.length > 0) invoicesWithPunteos += 1;
  const seenInvoicePatterns = new Set();
  for (const punteo of punteos) {
    punteoRows += 1;
    const origin = String(punteo.Origen ?? punteo.origen ?? 'VACIO');
    const sourceTable = String(
      punteo.source_table ?? punteo.tabla_origen ?? 'VACIO',
    );
    const key = `${tipoFactura}\u0000${origin}\u0000${sourceTable}`;
    if (!patternMap.has(key)) {
      patternMap.set(key, {
        tipo_factura: tipoFactura,
        origen_punteo: origin,
        source_table: sourceTable,
        facturas: 0,
        punteos: 0,
        ejemplos: [],
      });
    }
    const pattern = patternMap.get(key);
    pattern.punteos += 1;
    if (!seenInvoicePatterns.has(key)) {
      pattern.facturas += 1;
      seenInvoicePatterns.add(key);
    }
    const exampleId = asInteger(invoice.id ?? invoice.frr_id ?? invoice.FRR_id);
    if (exampleId && pattern.ejemplos.length < 5 && !pattern.ejemplos.includes(exampleId)) {
      pattern.ejemplos.push(exampleId);
    }
  }
}

console.log(
  JSON.stringify(
    {
      inspected_cases: inspectedCases,
      type_catalog: typeCatalog,
      type_profiles: typeProfiles,
      sample: {
        requested: 100,
        received: sampleInvoices.length,
        total_available: samplePayload?.total ?? null,
        invoices_with_punteos: invoicesWithPunteos,
        punteo_rows: punteoRows,
        lookup_errors: lookupErrors,
        tipo_factura_distribution: Object.fromEntries(
          [...typeDistribution.entries()].sort((left, right) =>
            left[0].localeCompare(right[0]),
          ),
        ),
        tipo_factura_vs_origen: [...patternMap.values()].sort(
          (left, right) =>
            left.tipo_factura.localeCompare(right.tipo_factura) ||
            left.origen_punteo.localeCompare(right.origen_punteo) ||
            left.source_table.localeCompare(right.source_table),
        ),
      },
    },
    null,
    2,
  ),
);
