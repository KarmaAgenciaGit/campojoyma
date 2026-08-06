import { describe, expect, it } from 'vitest';

import {
  getFacturaERPAlreadyRegisteredNotice,
  getFacturaERPListPresentation,
  isFacturaERPDuplicateIssue,
} from '@/lib/facturasDuplicate';
import type { FacturaValidationIssue } from '@/services/apiContracts';

const edgeDuplicate: FacturaValidationIssue = {
  code: 'duplicate_invoice',
  field: 'erp_duplicate',
  message:
    'La factura ya existe en ERP como entrada 48865 (número ERP 4614); este borrador no puede enviarse de nuevo.',
  severity: 'error',
  details: {
    candidates: [{ FRR_id: 48865, FRR_numero: 4614 }],
  },
};

describe('duplicado ERP presentado como estado informativo', () => {
  it('extrae la entrada y el número visible devueltos por el ERP', () => {
    expect(getFacturaERPAlreadyRegisteredNotice([edgeDuplicate])).toEqual({
      entryId: 48865,
      visibleNumber: 4614,
      text: 'Ya registrada en ERP · entrada 48865 · n.º ERP 4614',
    });
  });

  it('reconoce también el duplicado detectado por el preflight del navegador', () => {
    const preflightDuplicate: FacturaValidationIssue = {
      code: 'factura_duplicada_erp',
      field: 'FRR_numerofactura',
      message: 'Ya existe la factura en ERP con FRR_id 48865.',
      severity: 'error',
      details: { FRR_id: 48865 },
    };

    expect(isFacturaERPDuplicateIssue(preflightDuplicate)).toBe(true);
    expect(
      getFacturaERPAlreadyRegisteredNotice([preflightDuplicate], {
        frrId: 48865,
        numero: 4614,
      })?.text,
    ).toBe('Ya registrada en ERP · entrada 48865 · n.º ERP 4614');
  });

  it('mantiene un texto claro aunque el ERP no devuelva identificadores', () => {
    expect(
      getFacturaERPAlreadyRegisteredNotice([
        {
          code: 'duplicate_invoice',
          field: 'erp_duplicate',
          message: 'La factura ya existe en ERP.',
          severity: 'error',
          details: null,
        },
      ])?.text,
    ).toBe('Ya registrada en ERP');
  });

  it('presenta el duplicado confirmado como registrado y no como error operativo', () => {
    const blockingIssue: FacturaValidationIssue = {
      code: 'importe_incorrecto',
      field: 'FRR_totalfac',
      message: 'El total no cuadra.',
      severity: 'error',
      details: null,
    };

    const duplicateOnly = getFacturaERPListPresentation('not_validated', [
      edgeDuplicate,
    ]);
    expect(duplicateOnly.registrationState).toBe('registered');
    expect(duplicateOnly.alreadyRegisteredNotice?.entryId).toBe(48865);
    expect(duplicateOnly.operationalIssues).toEqual([]);

    const withBlockingError = getFacturaERPListPresentation('not_validated', [
      edgeDuplicate,
      blockingIssue,
    ]);
    expect(withBlockingError.registrationState).toBe('registered');
    expect(withBlockingError.operationalIssues).toEqual([blockingIssue]);
  });
});
