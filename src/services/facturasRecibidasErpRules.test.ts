// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';

import {
  resolveFacturaRecibidaErpRuleValues,
  type FacturaRecibidaErpRule,
} from './facturasRecibidasErpRules';

const buildRule = (overrides: Partial<FacturaRecibidaErpRule>): FacturaRecibidaErpRule => ({
  id: 'rule-default',
  empresa_id: 1,
  proveedor_id: null,
  ejercicio_erp: null,
  tipo_factura: null,
  regimen_id: null,
  fecha_ctb_policy: 'manual',
  activo: true,
  approval_note: null,
  created_at: '2026-07-22T00:00:00.000Z',
  updated_at: '2026-07-22T00:00:00.000Z',
  ...overrides,
});

describe('resolveFacturaRecibidaErpRuleValues', () => {
  it('aplica por campo la regla de proveedor antes que la general de empresa', () => {
    const rules = [
      buildRule({ id: 'company', ejercicio_erp: 25, tipo_factura: 'GE', regimen_id: 2100 }),
      buildRule({ id: 'supplier', proveedor_id: 17, tipo_factura: 'OT', regimen_id: 2110 }),
    ];

    const resolved = resolveFacturaRecibidaErpRuleValues(rules, { empresa_id: 1, proveedor_id: 17 });

    expect(resolved).toMatchObject({
      ejercicio_erp: 25,
      tipo_factura: 'OT',
      regimen_id: 2110,
      fecha_ctb_policy: 'manual',
      empresa_rule_id: 'company',
      proveedor_rule_id: 'supplier',
    });
  });

  it('no sobrescribe valores no vac\u00edos aportados por la factura', () => {
    const rules = [
      buildRule({ id: 'company', ejercicio_erp: 25, tipo_factura: 'OT', regimen_id: 2110 }),
    ];

    const resolved = resolveFacturaRecibidaErpRuleValues(
      rules,
      { empresa_id: 1 },
      { ejercicio_erp: 24, tipo_factura: 'GE', regimen_id: 2000, fecha_ctb_policy: 'invoice_date' },
    );

    expect(resolved).toMatchObject({
      ejercicio_erp: 24,
      tipo_factura: 'GE',
      regimen_id: 2000,
      fecha_ctb_policy: 'invoice_date',
    });
  });

  it('mantiene revisi\u00f3n manual cuando no existe una regla aprobada', () => {
    const resolved = resolveFacturaRecibidaErpRuleValues([], { empresa_id: 1, proveedor_id: 17 });

    expect(resolved).toMatchObject({
      ejercicio_erp: null,
      tipo_factura: null,
      regimen_id: null,
      fecha_ctb_policy: 'manual',
      empresa_rule_id: null,
      proveedor_rule_id: null,
    });
  });
});
