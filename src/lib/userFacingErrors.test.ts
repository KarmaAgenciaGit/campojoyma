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
});
