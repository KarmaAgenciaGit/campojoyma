import type { FacturaValidationIssue } from '@/services/apiContracts';
import type { FacturaERPRegistrationState } from '@/lib/facturasErpStatus';

type DuplicateCandidateSource = {
  frrId?: number | string | null;
  numero?: number | string | null;
};

export type FacturaERPAlreadyRegisteredNotice = {
  entryId: number | null;
  visibleNumber: number | null;
  text: string;
};

export type FacturaERPListPresentation = {
  registrationState: FacturaERPRegistrationState;
  alreadyRegisteredNotice: FacturaERPAlreadyRegisteredNotice | null;
  operationalIssues: FacturaValidationIssue[];
};

const positiveInteger = (value: unknown): number | null => {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

const normalizeToken = (value: unknown) =>
  String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();

export const isFacturaERPDuplicateIssue = (
  issue: FacturaValidationIssue,
): boolean => {
  const code = normalizeToken(issue.code);
  const field = normalizeToken(issue.field);
  const message = normalizeToken(issue.message);

  return (
    code === 'duplicate_invoice' ||
    code === 'factura_duplicada_erp' ||
    field === 'erp_duplicate' ||
    message.includes('la factura ya existe en erp') ||
    message.includes('ya existe la factura en erp')
  );
};

const candidateNumbers = (
  value: unknown,
): { entryId: number | null; visibleNumber: number | null } => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { entryId: null, visibleNumber: null };
  }

  const candidate = value as Record<string, unknown>;
  return {
    entryId: positiveInteger(
      candidate.FRR_id ?? candidate.frr_id ?? candidate.frrId,
    ),
    visibleNumber: positiveInteger(
      candidate.FRR_numero ?? candidate.frr_numero ?? candidate.numero,
    ),
  };
};

export const getFacturaERPAlreadyRegisteredNotice = (
  issues: FacturaValidationIssue[],
  duplicateCandidate: DuplicateCandidateSource | null = null,
): FacturaERPAlreadyRegisteredNotice | null => {
  const issue = issues.find(isFacturaERPDuplicateIssue);
  if (!issue) return null;

  const detailCandidates = Array.isArray(issue.details?.candidates)
    ? issue.details.candidates
    : [];
  const sources = [
    ...detailCandidates,
    issue.details,
    duplicateCandidate
      ? {
          FRR_id: duplicateCandidate.frrId,
          FRR_numero: duplicateCandidate.numero,
        }
      : null,
  ];

  let entryId: number | null = null;
  let visibleNumber: number | null = null;
  for (const source of sources) {
    const candidate = candidateNumbers(source);
    entryId ??= candidate.entryId;
    visibleNumber ??= candidate.visibleNumber;
  }

  entryId ??= positiveInteger(
    issue.message.match(/(?:entrada|frr[_\s-]?id)\s+(\d+)/i)?.[1],
  );
  visibleNumber ??= positiveInteger(
    issue.message.match(/n[uú]mero\s+erp\s+(\d+)/i)?.[1],
  );

  const details = [
    entryId ? `entrada ${entryId}` : null,
    visibleNumber ? `n.º ERP ${visibleNumber}` : null,
  ].filter(Boolean);

  return {
    entryId,
    visibleNumber,
    text: ['Ya registrada en ERP', ...details].join(' · '),
  };
};

export const getFacturaERPListPresentation = (
  registrationState: FacturaERPRegistrationState,
  issues: FacturaValidationIssue[],
): FacturaERPListPresentation => {
  const alreadyRegisteredNotice = getFacturaERPAlreadyRegisteredNotice(issues);

  return {
    registrationState: alreadyRegisteredNotice ? 'registered' : registrationState,
    alreadyRegisteredNotice,
    operationalIssues: issues.filter((issue) => !isFacturaERPDuplicateIssue(issue)),
  };
};
