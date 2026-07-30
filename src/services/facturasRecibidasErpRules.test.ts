// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';

import {
  normalizeFacturaRecibidaErpRuleInput,
  resolveFacturaRecibidaErpRuleValues,
  saveFacturaRecibidaErpRule,
  type FacturaRecibidaErpRule,
} from './facturasRecibidasErpRules';

const buildRule = (overrides: Partial<FacturaRecibidaErpRule>): FacturaRecibidaErpRule => ({
  id: 'rule-default',
  empresa_id: 1,
  proveedor_id: null,
  ejercicio_erp: null,
  tipo_factura: null,
  regimen_id: null,
  fecha_ctb_policy: null,
  cuenta_gasto_default: null,
  concepto_template: null,
  contabilizar_default: null,
  punteo_difference_policy: null,
  activo: true,
  approval_note: null,
  created_at: '2026-07-22T00:00:00.000Z',
  updated_at: '2026-07-22T00:00:00.000Z',
  ...overrides,
});

describe('resolveFacturaRecibidaErpRuleValues', () => {
  it('aplica por campo la regla de proveedor antes que la general de empresa', () => {
    const rules = [
      buildRule({
        id: 'company',
        ejercicio_erp: 25,
        tipo_factura: 'GE',
        regimen_id: 2100,
        fecha_ctb_policy: 'invoice_date',
        cuenta_gasto_default: '60200000001',
        concepto_template: 'FRA. {proveedor}',
        contabilizar_default: 'S',
        punteo_difference_policy: 'block',
      }),
      buildRule({
        id: 'supplier',
        proveedor_id: 17,
        tipo_factura: 'OT',
        regimen_id: 2110,
        concepto_template: 'FRA. {proveedor} / OT',
      }),
    ];

    const resolved = resolveFacturaRecibidaErpRuleValues(rules, { empresa_id: 1, proveedor_id: 17 });

    expect(resolved).toMatchObject({
      ejercicio_erp: 25,
      tipo_factura: 'OT',
      regimen_id: 2110,
      fecha_ctb_policy: 'invoice_date',
      cuenta_gasto_default: '60200000001',
      concepto_template: 'FRA. {proveedor} / OT',
      contabilizar_default: 'S',
      punteo_difference_policy: 'block',
      empresa_rule_id: 'company',
      proveedor_rule_id: 'supplier',
    });
  });

  it('hereda la fecha CTB general cuando la regla de proveedor solo configura otro campo', () => {
    const rules = [
      buildRule({
        id: 'company',
        fecha_ctb_policy: 'invoice_date',
      }),
      buildRule({
        id: 'supplier',
        proveedor_id: 17,
        concepto_template: 'FRA. {proveedor} / OT',
        fecha_ctb_policy: null,
      }),
    ];

    const resolved = resolveFacturaRecibidaErpRuleValues(
      rules,
      { empresa_id: 1, proveedor_id: 17 },
    );

    expect(resolved.fecha_ctb_policy).toBe('invoice_date');
  });

  it('permite que una regla de proveedor fuerce revision manual de forma explicita', () => {
    const rules = [
      buildRule({
        id: 'company',
        fecha_ctb_policy: 'invoice_date',
      }),
      buildRule({
        id: 'supplier',
        proveedor_id: 17,
        fecha_ctb_policy: 'manual',
      }),
    ];

    const resolved = resolveFacturaRecibidaErpRuleValues(
      rules,
      { empresa_id: 1, proveedor_id: 17 },
    );

    expect(resolved.fecha_ctb_policy).toBe('manual');
  });

  it('no sobrescribe valores no vac\u00edos aportados por la factura', () => {
    const rules = [
      buildRule({ id: 'company', ejercicio_erp: 25, tipo_factura: 'OT', regimen_id: 2110 }),
    ];

    const resolved = resolveFacturaRecibidaErpRuleValues(
      rules,
      { empresa_id: 1 },
      {
        ejercicio_erp: 24,
        tipo_factura: 'GE',
        regimen_id: 2000,
        fecha_ctb_policy: 'invoice_date',
        cuenta_gasto_default: '60000000001',
        concepto_template: 'FRA. {proveedor} MANUAL',
        contabilizar_default: 'N',
      },
    );

    expect(resolved).toMatchObject({
      ejercicio_erp: 24,
      tipo_factura: 'GE',
      regimen_id: 2000,
      fecha_ctb_policy: 'invoice_date',
      cuenta_gasto_default: '60000000001',
      concepto_template: 'FRA. {proveedor} MANUAL',
      contabilizar_default: 'N',
    });
  });

  it('mantiene revisi\u00f3n manual cuando no existe una regla aprobada', () => {
    const resolved = resolveFacturaRecibidaErpRuleValues([], { empresa_id: 1, proveedor_id: 17 });

    expect(resolved).toMatchObject({
      ejercicio_erp: null,
      tipo_factura: null,
      regimen_id: null,
      fecha_ctb_policy: 'manual',
      cuenta_gasto_default: null,
      concepto_template: null,
      contabilizar_default: null,
      punteo_difference_policy: 'warning',
      empresa_rule_id: null,
      proveedor_rule_id: null,
    });
  });
});

describe('saveFacturaRecibidaErpRule', () => {
  it('guarda null para heredar CTB al crear una regla especifica de proveedor', () => {
    const payload = normalizeFacturaRecibidaErpRuleInput({
      empresa_id: 1,
      proveedor_id: 17,
      fecha_ctb_policy: null,
      concepto_template: 'FRA. {proveedor} / OT',
      approval_note: 'Concepto aprobado para este acreedor.',
    });

    expect(payload).toMatchObject({
      empresa_id: 1,
      proveedor_id: 17,
      fecha_ctb_policy: null,
      concepto_template: 'FRA. {proveedor} / OT',
    });
  });

  it('rechaza cuentas de gasto que no tengan 11 d\u00edgitos', async () => {
    await expect(
      saveFacturaRecibidaErpRule({
        empresa_id: 1,
        cuenta_gasto_default: '6020',
        approval_note: 'Aprobado para la prueba.',
      }),
    ).rejects.toThrow('La cuenta de gasto debe tener exactamente 11 d\u00edgitos.');
  });

  it('rechaza plantillas de concepto sin el marcador de proveedor', async () => {
    await expect(
      saveFacturaRecibidaErpRule({
        empresa_id: 1,
        concepto_template: 'FRA. PROVEEDOR',
        approval_note: 'Aprobado para la prueba.',
      }),
    ).rejects.toThrow('La plantilla de concepto debe incluir {proveedor}.');
  });

  it('exige evidencia al configurar un valor contable por defecto', async () => {
    await expect(
      saveFacturaRecibidaErpRule({
        empresa_id: 1,
        contabilizar_default: 'S',
      }),
    ).rejects.toThrow('A\u00f1ade una nota o evidencia de aprobaci\u00f3n');
  });
});
