import { describe, expect, it } from 'vitest';

import {
  facturaERPRegistrationLabels,
  getFacturaERPRegistrationState,
  invalidateFacturaERPValidation,
  isFacturaERPConfirmed,
  isFacturaERPLegacyUnscopedError,
  normalizeFacturaERPReferenceStatus,
  requireFacturaERPCommitRequestId,
} from '@/lib/facturasErpStatus';

describe('estado independiente del registro ERP', () => {
  it('marca la referencia 49681 como caducada aunque conserve identidad remota', () => {
    const factura = {
      estado: 'enviada_erp',
      sync_status: 'stale',
      erp_reference_status: 'stale',
      erp_target_id: 'netagro-test-write',
      erp_dataset_epoch: 'epoch-anterior',
      erp_verified_at: '2026-07-20T10:00:00Z',
      remote_frr_id: 49681,
      erp_sent_at: '2026-07-20T10:00:00Z',
    };

    expect(getFacturaERPRegistrationState(factura)).toBe('stale_reference');
    expect(isFacturaERPConfirmed(factura)).toBe(false);
    expect(facturaERPRegistrationLabels.stale_reference).toBe(
      'Referencia caducada',
    );
  });

  it('no presenta una referencia legacy como confirmada', () => {
    const factura = {
      estado: 'enviada_erp',
      sync_status: 'sent',
      erp_reference_status: 'legacy_unverified',
      erp_validation_status: 'valid',
      erp_target_id: null,
      erp_dataset_epoch: null,
      erp_verified_at: null,
      remote_frr_id: 49305,
      erp_sent_at: '2026-07-20T10:00:00Z',
    };

    expect(getFacturaERPRegistrationState(factura)).toBe('not_validated');
    expect(isFacturaERPConfirmed(factura)).toBe(false);
  });

  it('presenta como registrada una referencia legacy con readback exacto', () => {
    const factura = {
      estado: 'enviada_erp',
      sync_status: 'sent',
      erp_reference_status: 'legacy_unverified',
      erp_target_id: null,
      erp_dataset_epoch: null,
      erp_verified_at: null,
      remote_frr_id: 49305,
      erp_last_read_at: '2026-08-03T09:40:06Z',
      erp_readback_matches_remote: true,
    };

    expect(getFacturaERPRegistrationState(factura)).toBe('registered');
    expect(isFacturaERPConfirmed(factura)).toBe(false);
    expect(facturaERPRegistrationLabels.registered).toBe('Registrada');
  });

  it('no confunde un readback sin identidad coincidente con una factura registrada', () => {
    expect(
      getFacturaERPRegistrationState({
        estado: 'enviada_erp',
        sync_status: 'sent',
        erp_reference_status: 'legacy_unverified',
        remote_frr_id: 49305,
        erp_last_read_at: '2026-08-03T09:40:06Z',
        erp_readback_matches_remote: false,
      }),
    ).toBe('not_validated');
  });

  it('solo confirma una referencia válida con target, epoch e identidad', () => {
    const factura = {
      estado: 'enviada_erp',
      sync_status: 'sent',
      erp_reference_status: 'valid',
      erp_target_id: 'netagro-test-write',
      erp_dataset_epoch: 'epoch-actual',
      erp_verified_at: '2026-07-30T10:00:01Z',
      remote_frr_id: 49305,
      erp_sent_at: '2026-07-30T10:00:00Z',
    };

    expect(getFacturaERPRegistrationState(factura)).toBe('confirmed');
    expect(isFacturaERPConfirmed(factura)).toBe(true);
  });

  it('no confirma sin readback verificado aunque target y epoch coincidan', () => {
    expect(
      getFacturaERPRegistrationState({
        estado: 'enviada_erp',
        sync_status: 'sent',
        erp_reference_status: 'valid',
        erp_target_id: 'netagro-test-write',
        erp_dataset_epoch: 'epoch-actual',
        erp_verified_at: null,
        remote_frr_id: 49305,
      }),
    ).toBe('not_validated');
  });

  it.each([
    [{ erp_validation_status: null }, 'not_validated'],
    [{ erp_validation_status: 'valid' }, 'validated'],
    [{ sync_status: 'sending' }, 'sending'],
    [{ sync_status: 'unknown' }, 'uncertain'],
    [{ sync_status: 'reconciling' }, 'uncertain'],
    [{ estado: 'error_erp' }, 'error'],
  ] as const)('distingue %o como %s', (factura, expected) => {
    expect(getFacturaERPRegistrationState(factura)).toBe(expected);
  });

  it('no presenta como fallo actual un intento legacy sin entorno ni alta ERP', () => {
    const factura = {
      estado: 'error_erp',
      sync_status: 'error',
      erp_error: 'El webhook antiguo no está registrado.',
      erp_target_id: null,
      erp_dataset_epoch: null,
      erp_verified_at: null,
      remote_frr_id: null,
      erp_sent_at: null,
    };

    expect(isFacturaERPLegacyUnscopedError(factura)).toBe(true);
    expect(getFacturaERPRegistrationState(factura)).toBe('not_validated');
  });

  it('mantiene visible un error ligado al entorno ERP actual', () => {
    const factura = {
      estado: 'error_erp',
      sync_status: 'error',
      erp_error: 'Netagro rechazó la validación.',
      erp_target_id: 'netagro-test-write',
      erp_dataset_epoch: 'epoch-actual',
    };

    expect(isFacturaERPLegacyUnscopedError(factura)).toBe(false);
    expect(getFacturaERPRegistrationState(factura)).toBe('error');
  });

  it('degrada valid sin entorno y solo infiere valid en un readback actual completo', () => {
    expect(
      normalizeFacturaERPReferenceStatus('valid', {
        hasRemoteIdentity: true,
      }),
    ).toBe('unverified');
    expect(
      normalizeFacturaERPReferenceStatus(null, {
        hasRemoteIdentity: true,
        verifiedByCurrentReadback: true,
        targetId: 'netagro-test-write',
        datasetEpoch: 'epoch-actual',
      }),
    ).toBe('valid');
  });

  it('una edición invalida validate sin marcar como caducada la referencia', () => {
    expect(
      invalidateFacturaERPValidation({
        erp_validation_status: 'valid',
        erp_validation_request_id: 'request-anterior',
        erp_validated_at: '2026-07-30T12:00:00Z',
        erp_payload_hash: 'a'.repeat(64),
        erp_business_fingerprint: 'b'.repeat(64),
        erp_reference_status: 'unverified',
      }),
    ).toEqual({
      erp_validation_status: 'not_validated',
      erp_validation_request_id: null,
      erp_validated_at: null,
      erp_payload_hash: null,
      erp_business_fingerprint: null,
      erp_reference_status: 'unverified',
    });
  });

  it('solo permite confirmar con el mismo request_id que validó la factura', () => {
    const requestId = '857a3a94-35ca-4d23-a52c-822f22b450ab';

    expect(
      requireFacturaERPCommitRequestId(
        {
          erp_validation_status: 'valid',
          erp_validation_request_id: requestId,
        },
        requestId,
      ),
    ).toBe(requestId);
  });

  it.each([
    {
      erp_validation_status: 'not_validated',
      erp_validation_request_id: 'request-id',
    },
    {
      erp_validation_status: 'valid',
      erp_validation_request_id: null,
    },
    {
      erp_validation_status: 'valid',
      erp_validation_request_id: 'otro-request-id',
    },
  ])('cierra el envío si la revisión ERP no coincide: %o', (factura) => {
    expect(() =>
      requireFacturaERPCommitRequestId(factura, 'request-id'),
    ).toThrow('No se ha enviado la factura.');
  });
});
