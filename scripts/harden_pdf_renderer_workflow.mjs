import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const workflowPath = path.join(root, 'docs', 'n8n', 'api-pdf-imagen.json');
const workflow = JSON.parse(fs.readFileSync(workflowPath, 'utf8'));
const node = (name) => {
  const found = workflow.nodes.find((candidate) => candidate.name === name);
  if (!found) throw new Error(`Falta el nodo ${name}.`);
  return found;
};

node('Validar entrada').parameters = {
  mode: 'runOnceForEachItem',
  jsCode: String.raw`// CAMPOJOYMA_RENDER_INPUT_V2
const body = $json.body && typeof $json.body === 'object' ? $json.body : $json;
const fail = (error) => ({
  json: { contract_version: 2, valid: false, ok: false, error },
});
let nombreArchivo = typeof body.nombreArchivo === 'string'
  ? body.nombreArchivo.trim()
  : 'documento.pdf';
nombreArchivo = nombreArchivo
  .split(/[\\/]/)
  .pop()
  .replace(/[\r\n\u0000-\u001f\u007f"]/g, '_')
  .slice(0, 180);
if (!nombreArchivo) nombreArchivo = 'documento.pdf';
if (!/\.pdf$/i.test(nombreArchivo)) nombreArchivo += '.pdf';

const rawValue = typeof body.data === 'string' ? body.data.trim() : '';
const cleanBase64 = rawValue
  .replace(/^data:application\/pdf;base64,/i, '')
  .replace(/\s/g, '');
if (!cleanBase64) return fail('Falta el PDF en base64 dentro del campo data.');
if (!/^[A-Za-z0-9+/]*={0,2}$/.test(cleanBase64) || cleanBase64.length % 4 === 1) {
  return fail('El campo data no contiene un base64 valido.');
}

const MAX_PDF_BYTES = 20 * 1024 * 1024;
const maxEncodedLength = Math.ceil(MAX_PDF_BYTES / 3) * 4 + 4;
if (cleanBase64.length > maxEncodedLength) {
  return fail('El PDF supera el limite de 20 MB.');
}
const unpadded = cleanBase64.replace(/=+$/, '');
const padded = unpadded + '='.repeat((4 - (unpadded.length % 4)) % 4);
const pdfBuffer = Buffer.from(padded, 'base64');
const canonicalBase64 = pdfBuffer.toString('base64');
if (
  pdfBuffer.length === 0 ||
  pdfBuffer.length > MAX_PDF_BYTES ||
  canonicalBase64.replace(/=+$/, '') !== unpadded
) {
  return fail('El campo data no supera la validacion binaria.');
}
if (pdfBuffer.subarray(0, 5).toString('ascii') !== '%PDF-') {
  return fail('El archivo recibido no tiene una cabecera PDF valida.');
}
return {
  json: {
    contract_version: 2,
    valid: true,
    nombreArchivo,
    data: canonicalBase64,
    pdfSize: pdfBuffer.length,
  },
};`,
};

node('obtenerImagenes').parameters = {
  mode: 'runOnceForAllItems',
  jsCode: String.raw`// CAMPOJOYMA_RENDER_BUDGET_V2
const items = $input.all();
if (items.length !== 1) throw new Error('La API admite exactamente un PDF.');
const item = items[0];
if (!item.binary?.data) throw new Error('No se encontro el PDF en binary.data.');

const MAX_PAGES = 30;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_TOTAL_IMAGE_BYTES = 60 * 1024 * 1024;
const RENDER_BUDGET_MS = 20000;
const deadlineAt = Date.now() + RENDER_BUDGET_MS;
const pdfBuffer = await this.helpers.getBinaryDataBuffer(0, 'data');
if (pdfBuffer.length === 0 || pdfBuffer.length > 20 * 1024 * 1024) {
  throw new Error('El PDF esta vacio o supera el limite permitido.');
}
if (pdfBuffer.subarray(0, 5).toString('ascii') !== '%PDF-') {
  throw new Error('El binario no tiene una cabecera PDF valida.');
}
const binaryMeta = item.binary.data || {};
const pdfFileName = binaryMeta.fileName || item.json?.nombreArchivo || 'documento.pdf';
const baseName = (pdfFileName.replace(/\.pdf$/i, '') || 'documento').trim();
const aggregatedBinary = {};
let pagesConverted = 0;
let totalImageBytes = 0;

for (let page = 1; page <= MAX_PAGES + 1; page += 1) {
  const remainingMs = deadlineAt - Date.now();
  if (remainingMs < 1000) {
    throw new Error('Se agoto el tiempo de renderizado del PDF.');
  }
  const boundary = '----n8nFormBoundary' + Math.random().toString(16).slice(2);
  const CRLF = '\r\n';
  const fields = [
    ['format', 'jpg'],
    ['width', '1920'],
    ['height', '2096'],
    ['page', String(page)],
  ].map(([name, value]) =>
    '--' + boundary + CRLF +
    'Content-Disposition: form-data; name="' + name + '"' + CRLF + CRLF +
    value + CRLF
  ).join('');
  const fileHeader =
    '--' + boundary + CRLF +
    'Content-Disposition: form-data; name="file"; filename="' + pdfFileName + '"' + CRLF +
    'Content-Type: application/pdf' + CRLF + CRLF;
  const closing = CRLF + '--' + boundary + '--' + CRLF;
  const requestBody = Buffer.concat([
    Buffer.from(fields + fileHeader, 'utf8'),
    pdfBuffer,
    Buffer.from(closing, 'utf8'),
  ]);

  let response;
  try {
    response = await this.helpers.httpRequest({
      method: 'POST',
      url: 'http://pdf2img-pdf2img-1:3000/convert',
      headers: { 'Content-Type': 'multipart/form-data; boundary=' + boundary },
      body: requestBody,
      json: false,
      encoding: 'arraybuffer',
      timeout: Math.max(1000, Math.min(5000, remainingMs)),
      maxRedirects: 0,
      followRedirect: false,
    });
  } catch (error) {
    const status = error.response?.status || error.httpCode ||
      error.statusCode || error.status;
    if (page > 1 && Number(status) === 400) break;
    throw error;
  }

  if (page > MAX_PAGES) {
    throw new Error('El PDF supera el limite de 30 paginas.');
  }
  const imageBuffer = Buffer.isBuffer(response) ? response : Buffer.from(response);
  const isJpeg = imageBuffer.length >= 3 &&
    imageBuffer[0] === 0xff && imageBuffer[1] === 0xd8 && imageBuffer[2] === 0xff;
  if (!isJpeg || imageBuffer.length > MAX_IMAGE_BYTES) {
    throw new Error('La pagina ' + page + ' no es un JPEG valido o supera el limite.');
  }
  totalImageBytes += imageBuffer.length;
  if (totalImageBytes > MAX_TOTAL_IMAGE_BYTES) {
    throw new Error('Las paginas renderizadas superan el limite total.');
  }
  const key = 'page_' + page;
  aggregatedBinary[key] = {
    data: imageBuffer.toString('base64'),
    mimeType: 'image/jpeg',
    fileName: baseName + '_page_' + page + '.jpg',
    fileExtension: 'jpg',
  };
  pagesConverted += 1;
}

if (pagesConverted === 0) throw new Error('El PDF no produjo ninguna imagen.');
return [{
  json: {
    contract_version: 2,
    sourceFileName: pdfFileName,
    originalItemIndex: 0,
    pagesConverted,
    totalImageBytes,
    binaryKeys: Object.keys(aggregatedBinary),
  },
  binary: aggregatedBinary,
}];`,
};

node('Serializar respuesta').parameters = {
  mode: 'runOnceForAllItems',
  jsCode: String.raw`// CAMPOJOYMA_RENDER_RESPONSE_V2
const items = $input.all();
if (items.length !== 1) throw new Error('La API esperaba exactamente un PDF procesado.');
const item = items[0];
const keys = Array.isArray(item.json?.binaryKeys)
  ? item.json.binaryKeys
  : Object.keys(item.binary || {});
if (keys.length === 0 || keys.length > 30) {
  throw new Error('La respuesta contiene un numero de paginas no valido.');
}
const binary = {};
let totalImageBytes = 0;
for (const key of keys) {
  if (typeof key !== 'string' || !/^page_[1-9][0-9]?$/.test(key)) {
    throw new Error('La respuesta contiene una clave de pagina no valida.');
  }
  const buffer = await this.helpers.getBinaryDataBuffer(0, key);
  const isJpeg = buffer.length >= 3 &&
    buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  if (!isJpeg || buffer.length > 10 * 1024 * 1024) {
    throw new Error('La pagina ' + key + ' no supera la validacion JPEG.');
  }
  totalImageBytes += buffer.length;
  if (totalImageBytes > 60 * 1024 * 1024) {
    throw new Error('La respuesta supera el limite total de imagenes.');
  }
  binary[key] = {
    data: buffer.toString('base64'),
    mimeType: 'image/jpeg',
    fileName: key + '.jpg',
    fileExtension: 'jpg',
  };
}
return {
  json: {
    contract_version: 2,
    ok: true,
    sourceFileName: item.json?.sourceFileName || null,
    originalItemIndex: 0,
    pagesConverted: keys.length,
    totalImageBytes,
    binaryKeys: keys,
    binary,
  },
};`,
};

node('Responder 400').parameters.responseBody =
  '={{ { contract_version: 2, ok: false, error: $json.error } }}';
workflow.name = 'API PDF a imagenes v2';
workflow.active = false;
workflow.pinData = {};
workflow.settings = {
  executionOrder: 'v1',
  saveDataErrorExecution: 'none',
  saveDataSuccessExecution: 'none',
  saveManualExecutions: false,
  saveExecutionProgress: false,
};
workflow.versionId = '82d7e59e-873f-4c74-bdad-c0f92d0ee243';

fs.writeFileSync(workflowPath, `${JSON.stringify(workflow, null, 2)}\n`, 'utf8');
console.log(workflowPath);
