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
const enrichmentCode = workflow.nodes.find(
  (node) => node.name === 'Enriquecer por API Campojoyma',
)?.parameters?.jsCode;
assert.equal(typeof enrichmentCode, 'string');
assert.match(enrichmentCode, /const extractionSchemaVersion =/);
assert.doesNotMatch(
  enrichmentCode,
  /line\?\.referencia(?:,|\])/,
  'El matching v4 no puede promover la referencia comercial genérica de una línea.',
);

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
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
  extraction: extractionOverrides = {},
  respond,
}) => {
  const provider = providerType === 'agricultor' ? agricultor : acreedor;
  const requests = [];
  const helpers = {
    httpRequest: async ({ url }) => {
      requests.push(url);
      const parsed = new URL(url);
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
      if (respond) {
        const response = await respond(parsed, requests);
        if (response !== undefined) return response;
      }
      if (parsed.pathname === '/facturasrecibidas') return { items: [], total: 0 };
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
        warnings: [],
        erp_lookup: { status: 'unique', entity_type: providerType },
      },
    },
  };
  const result = await new AsyncFunction('$json', '$vars', enrichmentCode).call(
    { helpers },
    input,
    {},
  );
  const output = result.json.output;
  assert.equal(output.extraction.FRR_idproveedor, provider.id, name);
  assert.equal(output.metadata.match_evidence.proveedor.entity_type, providerType, name);
  for (const punteo of output.punteos) {
    assert.equal(punteo.S, false, `${name}: ningún candidato puede quedar seleccionado`);
    assert.deepEqual(punteo.source_lines, [], `${name}: no se persisten líneas completas`);
  }
  assert.deepEqual(result.json.ingest_payload.punteos, output.punteos, name);
  return { name, requests, output };
};

const maExact = await runScenario({
  name: 'ma-exacto-tipado',
  extraction: {
    albaranes_referenciados: [
      {
        origen: 'MA',
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
        origen: 'GE',
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

const wrongSeries = await runScenario({
  name: 'serie-ma-distinta',
  extraction: {
    albaranes_referenciados: [
      { origen: 'MA', serie: 'A26', numero: '2108', referencia: '479628' },
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

const bareNumber = await runScenario({
  name: 'numero-sin-discriminador',
  extraction: {
    albaranes_referenciados: [{ origen: 'MA', numero: '2108' }],
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
    albaranes_referenciados: [{ origen: 'GE', serie: 'A26', numero: '8187' }],
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

const linkedHistorical = await runScenario({
  name: 'factura-erp-existente',
  extraction: {
    numero_factura: 'A-00748886',
    fecha_factura: '2026-06-30',
  },
  respond: (url) => {
    if (url.pathname === '/facturasrecibidas') {
      return {
        items: [
          {
            FRR_id: 49305,
            FRR_Idempresa: 1,
            FRR_idproveedor: 17,
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
assert.match(
  linkedHistorical.output.metadata.warnings.join(' '),
  /ya existe en el ERP/i,
);

console.log(JSON.stringify({
  ok: true,
  scenarios: [
    maExact,
    geExact,
    genericReference,
    nifOcrFallback,
    wrongSeries,
    bareNumber,
    geAmbiguous,
    linkedHistorical,
  ].map(({ name, requests, output }) => ({
    name,
    requests: requests.length,
    punteos: output.punteos.length,
  })),
}, null, 2));
