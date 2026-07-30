const INTERNAL_AUTOMATION_NAME = ['n', '8', 'n'].join('');
const INTERNAL_AUTOMATION_URL_PATTERN = new RegExp(
  `\\bhttps?:\\/\\/[^\\s"'<>]*${INTERNAL_AUTOMATION_NAME}[^\\s"'<>]*`,
  'gi',
);
const INTERNAL_AUTOMATION_NAME_PATTERN = new RegExp(
  `\\b${INTERNAL_AUTOMATION_NAME}\\b`,
  'gi',
);
const UNREGISTERED_WEBHOOK_PATTERN =
  /(?:requested\s+webhook|webhook).*(?:not\s+registered|no\s+est[aá]\s+registrad[oa])/i;
const INTERNAL_WEBHOOK_PATTERN = /\bwebhooks?\b/i;
const TECHNICAL_DETAILS_PATTERN = /\btechnical[_\s-]?details\b/i;
const GENERIC_ERP_SERVICE_ERROR =
  'El servicio de envío al ERP no está disponible temporalmente.';

/**
 * Evita que los detalles de infraestructura aparezcan en mensajes de interfaz.
 * El error original puede seguir registrándose en consola o en el backend.
 */
export const sanitizeUserFacingErrorMessage = (value: string): string => {
  const trimmed = value.trim();
  if (
    UNREGISTERED_WEBHOOK_PATTERN.test(trimmed) ||
    TECHNICAL_DETAILS_PATTERN.test(trimmed)
  ) {
    return GENERIC_ERP_SERVICE_ERROR;
  }
  const withoutInternalUrls = trimmed.replace(
    INTERNAL_AUTOMATION_URL_PATTERN,
    'servicio de xFuego',
  );
  if (INTERNAL_WEBHOOK_PATTERN.test(withoutInternalUrls)) {
    return GENERIC_ERP_SERVICE_ERROR;
  }
  return withoutInternalUrls
    .replace(INTERNAL_AUTOMATION_NAME_PATTERN, 'xFuego');
};
