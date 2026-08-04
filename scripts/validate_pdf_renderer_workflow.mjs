import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const workflowPath = path.join(process.cwd(), 'docs', 'n8n', 'api-pdf-imagen.json');
const workflow = JSON.parse(fs.readFileSync(workflowPath, 'utf8'));
const node = (name) => workflow.nodes.find((candidate) => candidate.name === name);

assert.equal(workflow.name, 'API PDF a imagenes v2');
assert.equal(workflow.active, false);
assert.deepEqual(workflow.pinData, {});
assert.equal(node('Webhook PDF')?.parameters?.authentication, 'jwtAuth');
assert.equal(node('Webhook PDF')?.parameters?.httpMethod, 'POST');
assert.equal(node('Webhook PDF')?.parameters?.path, 'pdf-imagen');
assert.match(
  node('Validar entrada')?.parameters?.jsCode ?? '',
  /CAMPOJOYMA_RENDER_INPUT_V2[\s\S]*maxEncodedLength[\s\S]*Buffer\.from/,
);
assert.match(
  node('obtenerImagenes')?.parameters?.jsCode ?? '',
  /MAX_PAGES = 30[\s\S]*RENDER_BUDGET_MS = 20000[\s\S]*MAX_PAGES \+ 1[\s\S]*timeout: Math\.max[\s\S]*maxRedirects: 0[\s\S]*isJpeg/,
);
assert.match(
  node('Serializar respuesta')?.parameters?.jsCode ?? '',
  /CAMPOJOYMA_RENDER_RESPONSE_V2[\s\S]*contract_version: 2[\s\S]*ok: true/,
);
for (const codeNode of workflow.nodes.filter((candidate) =>
  candidate.type === 'n8n-nodes-base.code'
)) {
  new Function(`return (async function(){\n${codeNode.parameters.jsCode}\n});`);
}
const serialized = JSON.stringify(workflow);
assert.doesNotMatch(serialized, /Authorization|Bearer\s+[A-Za-z0-9._-]+/i);
assert.doesNotMatch(serialized, /timeout\\?"?:\s*120000/);
console.log(JSON.stringify({ ok: true, workflow: workflowPath, nodes: workflow.nodes.length }, null, 2));
