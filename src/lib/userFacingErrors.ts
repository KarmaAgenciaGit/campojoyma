const INTERNAL_AUTOMATION_NAME = ['n', '8', 'n'].join('');
const INTERNAL_AUTOMATION_URL_PATTERN = new RegExp(
  `\\bhttps?:\\/\\/[^\\s"'<>]*${INTERNAL_AUTOMATION_NAME}[^\\s"'<>]*`,
  'gi',
);
const INTERNAL_AUTOMATION_NAME_PATTERN = new RegExp(
  `\\b${INTERNAL_AUTOMATION_NAME}\\b`,
  'gi',
);

/**
 * Evita que los detalles de infraestructura aparezcan en mensajes de interfaz.
 * El error original puede seguir registrándose en consola o en el backend.
 */
export const sanitizeUserFacingErrorMessage = (value: string): string =>
  value
    .trim()
    .replace(INTERNAL_AUTOMATION_URL_PATTERN, 'servicio de xFuego')
    .replace(INTERNAL_AUTOMATION_NAME_PATTERN, 'xFuego');
