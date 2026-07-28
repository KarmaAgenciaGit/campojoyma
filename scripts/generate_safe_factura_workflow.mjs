import { hardenFacturaWorkflow } from './lib/harden_factura_workflow.mjs';

const sourcePath = process.argv[2] ?? null;

hardenFacturaWorkflow({
  root: process.cwd(),
  sourcePath,
});
