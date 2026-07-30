import { describe, expect, it } from 'vitest';

import { sanitizeUserFacingErrorMessage } from '@/lib/userFacingErrors';

describe('sanitizeUserFacingErrorMessage', () => {
  it('sustituye el nombre interno por la marca visible', () => {
    const internalName = ['n', '8', 'n'].join('');
    expect(sanitizeUserFacingErrorMessage(`${internalName} no pudo extraer la factura`)).toBe(
      'xFuego no pudo extraer la factura',
    );
  });

  it('oculta URLs internas completas', () => {
    const internalName = ['n', '8', 'n'].join('');
    expect(
      sanitizeUserFacingErrorMessage(
        `Falló https://${internalName}.example.test/webhook/facturas durante el análisis.`,
      ),
    ).toBe('Falló servicio de xFuego durante el análisis.');
  });

  it('conserva los mensajes que ya son operativos', () => {
    expect(sanitizeUserFacingErrorMessage('No se pudo analizar la factura.')).toBe(
      'No se pudo analizar la factura.',
    );
  });

  it('no muestra nombres de webhooks ni rutas internas', () => {
    const message =
      'The requested webhook "POST apiCampojoyma-facturas-write-v2" is not registered.';
    const sanitized = sanitizeUserFacingErrorMessage(message);

    expect(sanitized).toBe(
      'El servicio de envío al ERP no está disponible temporalmente.',
    );
    expect(sanitized.toLowerCase()).not.toContain('webhook');
    expect(sanitized).not.toContain('apiCampojoyma');
  });

  it('no muestra technical_details aunque lleguen serializados como texto', () => {
    const sanitized = sanitizeUserFacingErrorMessage(
      '{"technical_details":{"endpoint":"POST /internal/write","stack":"secret"}}',
    );

    expect(sanitized).toBe(
      'El servicio de envío al ERP no está disponible temporalmente.',
    );
    expect(sanitized).not.toContain('technical_details');
    expect(sanitized).not.toContain('/internal/write');
  });

  it('oculta cualquier referencia a un webhook aunque cambie el texto del proveedor', () => {
    const sanitized = sanitizeUserFacingErrorMessage(
      'Webhook POST /facturasrecibidas devolvió 404.',
    );

    expect(sanitized).toBe(
      'El servicio de envío al ERP no está disponible temporalmente.',
    );
    expect(sanitized.toLowerCase()).not.toContain('webhook');
  });
});
