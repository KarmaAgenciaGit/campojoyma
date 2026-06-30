import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { format } from 'date-fns';
import { Download, Loader2, Mail, MailSearch, RefreshCw } from 'lucide-react';

import MailListPagination from '@/components/MailListPagination';
import { canAccessPath, getFirstAllowedPath } from '@/config/accessControl';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import {
  buildMailHtmlSrcDoc,
  MAIL_IGNORED_ATTACHMENT_CLASS,
  MAIL_IGNORED_BADGE_CLASS,
  MAIL_IGNORED_META_CLASS,
  MAIL_PENDING_ATTACHMENT_CLASS,
  MAIL_PENDING_BADGE_CLASS,
  MAIL_PENDING_LIST_ITEM_CLASS,
  MAIL_PENDING_META_CLASS,
  MAIL_PENDING_SELECTED_LIST_ITEM_CLASS,
} from '@/utils/mailReviewUi';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

type FixedOrderMailSince = { since_imap: string; since_iso: string };
type OrderMailSortOrder = 'asc' | 'desc';

type OrderMailListFilters = {
  date_from: string;
  time_from: string;
  date_to: string;
  time_to: string;
  subject_contains: string;
  from_contains: string;
  sort_order: OrderMailSortOrder;
};

type OrderMailFilterPayload = {
  filter_start_iso: string;
  filter_end_iso: string;
  sort_order: OrderMailSortOrder;
  subject_contains?: string;
  from_contains?: string;
};

type OrderMailListItem = {
  uid: number;
  message_id: string | null;
  subject: string | null;
  from: string | null;
  email_date: string | null;
  seen: boolean;
  has_attachments: boolean;
  attachment_count: number;
  has_pdf_missing_in_db?: boolean;
  missing_pdf_count?: number;
  ignored_pdf_count?: number;
};

type OrderMailListResponse = {
  success: boolean;
  checked_at: string;
  timeframe: {
    since_imap: string;
    since_iso: string;
    timezone: string;
    mailbox: string;
  };
  pagination: {
    has_more: boolean;
    next_cursor_uid: number | null;
    current_page: number;
    total_pages: number;
    total_messages: number;
    page_size: number;
  };
  messages: OrderMailListItem[];
};

type OrderMailAttachment = {
  filename: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  download_base64: string | null;
  has_pdf_missing_in_db?: boolean;
  ignored_by_rule?: boolean;
};

type OrderMailDetail = {
  uid: number;
  subject: string | null;
  from: string | null;
  to: string | null;
  cc: string | null;
  date: string | null;
  seen: boolean;
  body_text: string | null;
  body_html: string | null;
  attachments: OrderMailAttachment[];
};

type OrderMailDetailResponse = {
  success: boolean;
  checked_at: string;
  message: OrderMailDetail;
};

type OrderMailSeenResponse = {
  success: boolean;
  checked_at: string;
  message: {
    uid: number;
    seen: boolean;
  };
};

const ORDER_MAIL_LOOKBACK_DAYS = 2;
const ORDER_MAIL_PAGE_SIZE = 10;

const buildFixedOrderMailSince = (): FixedOrderMailSince => {
  const fixedDate = new Date(Date.now() - ORDER_MAIL_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  const year = fixedDate.getFullYear();
  const month = fixedDate.getMonth();
  const day = fixedDate.getDate();
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  return {
    since_imap: `${day}-${months[month]}-${year}`,
    since_iso: new Date(Date.UTC(year, month, day, 0, 0, 0, 0)).toISOString(),
  };
};

const formatDateTime = (value: string | null | undefined) => {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return format(date, 'dd/MM/yyyy HH:mm');
};

const formatDate = (value: string | null | undefined) => {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return format(date, 'dd/MM/yyyy');
};

const formatDateInputValue = (value: Date) => {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const formatBytes = (bytes: number | null | undefined) => {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const safeBytes = Number(bytes);
  if (safeBytes < 1024) return `${safeBytes} B`;
  if (safeBytes < 1024 * 1024) return `${(safeBytes / 1024).toFixed(1)} KB`;
  return `${(safeBytes / (1024 * 1024)).toFixed(2)} MB`;
};

const getReadStateBadgeClass = (seen: boolean) =>
  seen
    ? 'border-slate-300 bg-slate-100 text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-800'
    : 'border-slate-700 bg-slate-700 text-slate-100 hover:bg-slate-700 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100 dark:hover:bg-slate-700';

const getReadStateDotClass = (seen: boolean) => (seen ? 'bg-slate-500 dark:bg-slate-400' : 'bg-slate-200');

const decodeBase64ToUint8Array = (base64: string) => {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
};

const dedupeOrderMailItems = (items: OrderMailListItem[]) => {
  const seen = new Set<number>();
  return items.filter((item) => {
    if (seen.has(item.uid)) return false;
    seen.add(item.uid);
    return true;
  });
};

const normalizeComparableText = (value: string | null | undefined) => {
  if (!value) return '';
  return value.trim().toLowerCase();
};

const truncateListSubject = (subject: string | null | undefined, maxLength = 34) => {
  const cleanSubject = subject?.trim() || 'Sin asunto';
  if (cleanSubject.length <= maxLength) return cleanSubject;
  return `${cleanSubject.slice(0, Math.max(1, maxLength - 3)).trimEnd()}...`;
};

const resolveFunctionErrorMessage = async (error: unknown, fallback: string) => {
  let message = error instanceof Error ? error.message : fallback;
  const maybeContext = (error as { context?: unknown } | null)?.context;
  if (!(maybeContext instanceof Response)) return message;

  try {
    const payload = (await maybeContext.clone().json()) as { error?: unknown; details?: unknown };
    const apiError = typeof payload?.error === 'string' ? payload.error : '';
    const apiDetails = typeof payload?.details === 'string' ? payload.details : '';
    if (apiError || apiDetails) message = [apiError, apiDetails].filter(Boolean).join(' · ');
  } catch {
    try {
      const rawText = (await maybeContext.clone().text()).trim();
      if (rawText) message = rawText;
    } catch {
      // keep original message
    }
  }
  return message;
};

const buildDefaultOrderMailFilters = (fixedSince: FixedOrderMailSince): OrderMailListFilters => ({
  date_from: formatDateInputValue(new Date(fixedSince.since_iso)),
  time_from: '',
  date_to: formatDateInputValue(new Date()),
  time_to: '',
  subject_contains: '',
  from_contains: '',
  sort_order: 'desc',
});

const buildDateTimeFilterIso = (dateValue: string, timeValue: string, boundary: 'start' | 'end') => {
  if (!dateValue.trim()) return null;
  const normalizedTime = timeValue.trim() || (boundary === 'start' ? '00:00' : '23:59');
  const parsed = new Date(`${dateValue}T${normalizedTime}:00`);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
};

const buildOrderMailFilterPayload = (filters: OrderMailListFilters): OrderMailFilterPayload | null => {
  const filterStartIso = buildDateTimeFilterIso(filters.date_from, filters.time_from, 'start');
  const filterEndIso = buildDateTimeFilterIso(filters.date_to, filters.time_to, 'end');
  if (!filterStartIso || !filterEndIso) return null;

  const subjectContains = filters.subject_contains.trim();
  const fromContains = filters.from_contains.trim();
  return {
    filter_start_iso: filterStartIso,
    filter_end_iso: filterEndIso,
    sort_order: filters.sort_order,
    ...(subjectContains ? { subject_contains: subjectContains } : {}),
    ...(fromContains ? { from_contains: fromContains } : {}),
  };
};

const validateOrderMailFilters = (filters: OrderMailListFilters, fixedSince: FixedOrderMailSince) => {
  const minDate = formatDateInputValue(new Date(fixedSince.since_iso));
  const maxDate = formatDateInputValue(new Date());
  if (!filters.date_from || !filters.date_to) return { error: 'Debes indicar fecha inicial y final.' };
  if (filters.date_from < minDate || filters.date_from > maxDate) {
    return { error: `La fecha inicial debe estar entre ${formatDate(fixedSince.since_iso)} y ${formatDate(new Date().toISOString())}.` };
  }
  if (filters.date_to < minDate || filters.date_to > maxDate) {
    return { error: `La fecha final debe estar entre ${formatDate(fixedSince.since_iso)} y ${formatDate(new Date().toISOString())}.` };
  }
  const payload = buildOrderMailFilterPayload(filters);
  if (!payload) return { error: 'El rango de fecha y hora no es válido.' };
  if (new Date(payload.filter_start_iso) > new Date(payload.filter_end_iso)) {
    return { error: 'La fecha/hora final no puede ser anterior a la inicial.' };
  }
  return { payload };
};

const buildOrderMailFiltersSummary = (filters: OrderMailListFilters, defaults: OrderMailListFilters) => {
  const parts: string[] = [];
  const hasCustomRange =
    filters.date_from !== defaults.date_from ||
    filters.time_from !== defaults.time_from ||
    filters.date_to !== defaults.date_to ||
    filters.time_to !== defaults.time_to;

  if (hasCustomRange) {
    parts.push(
      `Rango ${filters.date_from}${filters.time_from ? ` ${filters.time_from}` : ''} -> ${filters.date_to}${filters.time_to ? ` ${filters.time_to}` : ''}`,
    );
  }
  if (filters.subject_contains.trim()) parts.push(`Asunto: ${filters.subject_contains.trim()}`);
  if (filters.from_contains.trim()) parts.push(`Remitente: ${filters.from_contains.trim()}`);
  if (filters.sort_order !== defaults.sort_order) {
    parts.push(filters.sort_order === 'asc' ? 'Orden: más antiguos primero' : 'Orden: más recientes primero');
  }
  return parts.join(' · ');
};

const AdminOrderEmails = () => {
  const { role, allowedRoutes } = useAuth();
  const { toast } = useToast();
  const fixedSince = useMemo(() => buildFixedOrderMailSince(), []);
  const defaultFilters = useMemo(() => buildDefaultOrderMailFilters(fixedSince), [fixedSince]);

  const [loadingList, setLoadingList] = useState(false);
  const [messages, setMessages] = useState<OrderMailListItem[]>([]);
  const [selectedUid, setSelectedUid] = useState<number | null>(null);
  const [detailsByUid, setDetailsByUid] = useState<Record<number, OrderMailDetail>>({});
  const [detailErrorsByUid, setDetailErrorsByUid] = useState<Record<number, string>>({});
  const [loadingDetailUid, setLoadingDetailUid] = useState<number | null>(null);
  const [updatingSeenUid, setUpdatingSeenUid] = useState<number | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalMessages, setTotalMessages] = useState(0);
  const [checkedAt, setCheckedAt] = useState<string | null>(null);
  const [timeframe, setTimeframe] = useState<{ since_iso: string; mailbox: string } | null>(null);
  const [draftFilters, setDraftFilters] = useState<OrderMailListFilters>(defaultFilters);
  const [appliedFilters, setAppliedFilters] = useState<OrderMailListFilters>(defaultFilters);
  const messagesRef = useRef<OrderMailListItem[]>([]);
  const listRequestInFlightRef = useRef(false);
  const appliedFiltersRef = useRef<OrderMailListFilters>(defaultFilters);

  const selectedDetail = selectedUid ? detailsByUid[selectedUid] ?? null : null;
  const selectedDetailError = selectedUid ? detailErrorsByUid[selectedUid] ?? null : null;
  const selectedMessage = selectedUid ? messages.find((item) => item.uid === selectedUid) ?? null : null;
  const listRange = useMemo(() => {
    const start = totalMessages > 0 ? (currentPage - 1) * ORDER_MAIL_PAGE_SIZE + 1 : 0;
    const end = totalMessages > 0 ? Math.min(totalMessages, start + messages.length - 1) : 0;
    return { start, end };
  }, [currentPage, messages.length, totalMessages]);
  const access = { role, allowedRoutes };
  const hasAccess = canAccessPath('/admin/correo-pedidos', access);
  const fallbackPath = hasAccess ? null : getFirstAllowedPath(access) ?? '/';

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    appliedFiltersRef.current = appliedFilters;
  }, [appliedFilters]);

  const fetchList = useCallback(
    async (
      page: number,
      preferredSelectedUid: number | null = null,
      filtersOverride?: OrderMailListFilters,
    ): Promise<OrderMailListItem[] | null> => {
      if (listRequestInFlightRef.current) return null;
      setLoadingList(true);
      listRequestInFlightRef.current = true;

      try {
        const effectiveFilters = filtersOverride ?? appliedFiltersRef.current;
        const validation = validateOrderMailFilters(effectiveFilters, fixedSince);
        if (!('payload' in validation)) throw new Error(validation.error);
        const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
        const payload = {
          action: 'list',
          since_imap: fixedSince.since_imap,
          since_iso: fixedSince.since_iso,
          timezone,
          mailbox: 'INBOX',
          page,
          page_size: ORDER_MAIL_PAGE_SIZE,
          ...validation.payload,
        };

        const { data, error } = await supabase.functions.invoke('review-imap-order-mails', { body: payload });
        if (error) {
          const payloadError = data as { error?: unknown; details?: unknown } | null;
          const apiError = typeof payloadError?.error === 'string' ? payloadError.error : '';
          const apiDetails = typeof payloadError?.details === 'string' ? payloadError.details : '';
          if (apiError || apiDetails) throw new Error([apiError, apiDetails].filter(Boolean).join(' · '));
          throw error;
        }

        const parsed = data as OrderMailListResponse | { error?: unknown; details?: unknown } | null;
        if (!parsed || typeof parsed !== 'object' || !('success' in parsed) || parsed.success !== true) {
          const message =
            parsed && typeof parsed === 'object' && 'error' in parsed && parsed.error
              ? String(parsed.error)
              : 'Respuesta inválida del servidor.';
          throw new Error(message);
        }

        const response = parsed as OrderMailListResponse;
        const safeMessages = dedupeOrderMailItems(Array.isArray(response.messages) ? response.messages : []);
        const rawCurrentPage = Number(response.pagination?.current_page);
        const rawTotalPages = Number(response.pagination?.total_pages);
        const rawTotalMessages = Number(response.pagination?.total_messages);

        setMessages(safeMessages);
        setCurrentPage(Number.isFinite(rawCurrentPage) && rawCurrentPage > 0 ? Math.trunc(rawCurrentPage) : page);
        setTotalPages(Number.isFinite(rawTotalPages) && rawTotalPages > 0 ? Math.trunc(rawTotalPages) : 1);
        setTotalMessages(
          Number.isFinite(rawTotalMessages) && rawTotalMessages >= 0 ? Math.trunc(rawTotalMessages) : safeMessages.length,
        );
        setCheckedAt(response.checked_at ?? null);
        setTimeframe({
          since_iso: response.timeframe?.since_iso ?? fixedSince.since_iso,
          mailbox: response.timeframe?.mailbox ?? 'INBOX',
        });

        setSelectedUid((prev) => {
          const candidateUid = preferredSelectedUid ?? prev;
          if (candidateUid && safeMessages.some((item) => item.uid === candidateUid)) return candidateUid;
          return safeMessages[0]?.uid ?? null;
        });
        if (safeMessages.length === 0) {
          setDetailsByUid({});
          setDetailErrorsByUid({});
        }
        return safeMessages;
      } catch (error: unknown) {
        const description = await resolveFunctionErrorMessage(error, 'No se pudieron cargar los correos de pedidos.');
        console.error('Error loading order mails list', error);
        toast({
          title: 'Error cargando correo de pedidos',
          description,
          variant: 'destructive',
        });
        return null;
      } finally {
        listRequestInFlightRef.current = false;
        setLoadingList(false);
      }
    },
    [fixedSince.since_imap, fixedSince.since_iso, toast],
  );

  const fetchDetail = useCallback(
    async (uid: number, messageId: string | null = null, hasRetried = false) => {
      if (!Number.isFinite(uid) || uid <= 0) return;
      if (detailsByUid[uid]) return;

      setLoadingDetailUid(uid);
      setDetailErrorsByUid((prev) => {
        if (!prev[uid]) return prev;
        const next = { ...prev };
        delete next[uid];
        return next;
      });

      try {
        const { data, error } = await supabase.functions.invoke('review-imap-order-mails', {
          body: {
            action: 'detail',
            uid,
            mailbox: 'INBOX',
            ...(messageId ? { message_id: messageId } : {}),
          },
        });
        if (error) {
          const payloadError = data as { error?: unknown; details?: unknown } | null;
          const apiError = typeof payloadError?.error === 'string' ? payloadError.error : '';
          const apiDetails = typeof payloadError?.details === 'string' ? payloadError.details : '';
          if (apiError || apiDetails) throw new Error([apiError, apiDetails].filter(Boolean).join(' · '));
          throw error;
        }

        const parsed = data as OrderMailDetailResponse | { error?: unknown; details?: unknown } | null;
        if (!parsed || typeof parsed !== 'object' || !('success' in parsed) || parsed.success !== true) {
          const message =
            parsed && typeof parsed === 'object' && 'error' in parsed && parsed.error
              ? String(parsed.error)
              : 'Respuesta inválida del servidor.';
          throw new Error(message);
        }

        const detailResponse = parsed as OrderMailDetailResponse;
        setDetailsByUid((prev) => ({ ...prev, [uid]: detailResponse.message }));
      } catch (error: unknown) {
        const description = await resolveFunctionErrorMessage(error, 'No se pudo cargar el detalle del correo.');
        console.error(`Error loading detail for UID ${uid}`, error);

        const isUidNotFound = description.toLowerCase().includes('no se encontró el correo con uid');
        const isTransientRuntimeFailure =
          description.toLowerCase().includes('non-2xx') ||
          description.toLowerCase().includes('network request failed') ||
          description.toLowerCase().includes('failed to fetch') ||
          description.toLowerCase().includes('timeout');

        if (isTransientRuntimeFailure && !hasRetried) {
          await new Promise((resolve) => setTimeout(resolve, 350));
          await fetchDetail(uid, messageId, true);
          return;
        }

        if (isUidNotFound && !hasRetried) {
          const currentItem = messagesRef.current.find((item) => item.uid === uid) ?? null;
          const refreshedMessages = await fetchList(currentPage, uid);
          let refreshedMatch =
            messageId && refreshedMessages
              ? refreshedMessages.find((item) => item.message_id && item.message_id === messageId) ?? null
              : null;

          if (!refreshedMatch && currentItem && refreshedMessages) {
            const currentSubject = normalizeComparableText(currentItem.subject);
            const currentFrom = normalizeComparableText(currentItem.from);
            const currentDate = currentItem.email_date ?? null;

            refreshedMatch =
              refreshedMessages.find((item) => {
                const hasComparableInfo = Boolean(currentSubject || currentFrom || currentDate);
                if (!hasComparableInfo) return false;
                if (currentDate && item.email_date !== currentDate) return false;
                if (currentSubject && normalizeComparableText(item.subject) !== currentSubject) return false;
                if (currentFrom && normalizeComparableText(item.from) !== currentFrom) return false;
                return true;
              }) ?? null;
          }

          if (refreshedMatch) {
            setSelectedUid(refreshedMatch.uid);
            await fetchDetail(refreshedMatch.uid, refreshedMatch.message_id, true);
            return;
          }
        }

        setDetailErrorsByUid((prev) => ({ ...prev, [uid]: description }));
        toast({
          title: 'Error cargando detalle',
          description,
          variant: 'destructive',
        });
      } finally {
        setLoadingDetailUid((current) => (current === uid ? null : current));
      }
    },
    [currentPage, detailsByUid, fetchList, toast],
  );

  useEffect(() => {
    if (!hasAccess) return;
    void fetchList(1);
  }, [fetchList, hasAccess]);

  useEffect(() => {
    if (!selectedUid) return;
    if (loadingDetailUid === selectedUid) return;
    if (detailsByUid[selectedUid] || detailErrorsByUid[selectedUid]) return;
    const selectedMessage = messages.find((item) => item.uid === selectedUid);
    if (!selectedMessage) return;
    void fetchDetail(selectedUid, selectedMessage.message_id);
  }, [selectedUid, loadingDetailUid, detailsByUid, detailErrorsByUid, messages, fetchDetail]);

  const handleRefresh = () => {
    void fetchList(currentPage, selectedUid);
  };

  const handleApplyFilters = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextFilters: OrderMailListFilters = {
      ...draftFilters,
      subject_contains: draftFilters.subject_contains.trim(),
      from_contains: draftFilters.from_contains.trim(),
    };
    const validation = validateOrderMailFilters(nextFilters, fixedSince);
    if (!('payload' in validation)) {
      toast({
        title: 'Filtros inválidos',
        description: validation.error,
        variant: 'destructive',
      });
      return;
    }
    setDraftFilters(nextFilters);
    setAppliedFilters(nextFilters);
    void fetchList(1, null, nextFilters);
  };

  const handleClearFilters = () => {
    setDraftFilters(defaultFilters);
    setAppliedFilters(defaultFilters);
    void fetchList(1, null, defaultFilters);
  };

  const handlePageChange = (page: number) => {
    if (page === currentPage) return;
    void fetchList(page);
  };

  const syncSeenState = useCallback((uid: number, seen: boolean) => {
    setMessages((prev) => prev.map((item) => (item.uid === uid ? { ...item, seen } : item)));
    setDetailsByUid((prev) => {
      const current = prev[uid];
      if (!current) return prev;
      return {
        ...prev,
        [uid]: {
          ...current,
          seen,
        },
      };
    });
  }, []);

  const handleSetSeen = useCallback(
    async (uid: number, seen: boolean, messageId: string | null = null) => {
      if (!Number.isFinite(uid) || uid <= 0) return;

      setUpdatingSeenUid(uid);
      try {
        const { data, error } = await supabase.functions.invoke('review-imap-order-mails', {
          body: {
            action: 'set_seen',
            uid,
            seen,
            mailbox: 'INBOX',
            ...(messageId ? { message_id: messageId } : {}),
          },
        });

        if (error) {
          const payloadError = data as { error?: unknown; details?: unknown } | null;
          const apiError = typeof payloadError?.error === 'string' ? payloadError.error : '';
          const apiDetails = typeof payloadError?.details === 'string' ? payloadError.details : '';
          if (apiError || apiDetails) throw new Error([apiError, apiDetails].filter(Boolean).join(' · '));
          throw error;
        }

        const parsed = data as OrderMailSeenResponse | { error?: unknown; details?: unknown } | null;
        if (!parsed || typeof parsed !== 'object' || !('success' in parsed) || parsed.success !== true) {
          const message =
            parsed && typeof parsed === 'object' && 'error' in parsed && parsed.error
              ? String(parsed.error)
              : 'Respuesta inválida del servidor.';
          throw new Error(message);
        }

        const response = parsed as OrderMailSeenResponse;
        const resolvedUid = response.message?.uid;
        const resolvedSeen = response.message?.seen;

        if (typeof resolvedUid !== 'number' || typeof resolvedSeen !== 'boolean') {
          throw new Error('Respuesta inválida actualizando el estado del correo.');
        }

        syncSeenState(uid, resolvedSeen);
        if (resolvedUid !== uid) {
          setSelectedUid(resolvedUid);
          void fetchList(currentPage, resolvedUid);
        } else {
          setCheckedAt(response.checked_at ?? null);
        }
      } catch (error: unknown) {
        const description = await resolveFunctionErrorMessage(error, 'No se pudo actualizar el estado del correo.');
        console.error(`Error updating seen state for UID ${uid}`, error);
        toast({
          title: 'Error actualizando estado',
          description,
          variant: 'destructive',
        });
      } finally {
        setUpdatingSeenUid((current) => (current === uid ? null : current));
      }
    },
    [currentPage, fetchList, syncSeenState, toast],
  );

  const handleDownloadAttachment = useCallback(
    (attachment: OrderMailAttachment, index: number) => {
      if (!attachment.download_base64) {
        toast({
          title: 'Adjunto no descargable',
          description: 'Este adjunto no está disponible para descarga directa.',
          variant: 'destructive',
        });
        return;
      }

      try {
        const bytes = decodeBase64ToUint8Array(attachment.download_base64);
        const mimeType = attachment.mime_type || 'application/octet-stream';
        const filename = attachment.filename?.trim() || `adjunto-${index + 1}`;
        const blob = new Blob([bytes], { type: mimeType });
        const objectUrl = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = objectUrl;
        anchor.download = filename;
        document.body.appendChild(anchor);
        anchor.click();
        document.body.removeChild(anchor);
        URL.revokeObjectURL(objectUrl);
      } catch (error) {
        console.error('Error downloading mail attachment', error);
        toast({
          title: 'Error descargando adjunto',
          description: 'No se pudo descargar el adjunto del correo.',
          variant: 'destructive',
        });
      }
    },
    [toast],
  );

  const selectedHasHtml = Boolean(selectedDetail?.body_html?.trim());
  const displayedMailbox = (timeframe?.mailbox || 'INBOX').trim() || 'INBOX';
  const activeFiltersSummary = useMemo(
    () => buildOrderMailFiltersSummary(appliedFilters, defaultFilters),
    [appliedFilters, defaultFilters],
  );
  const listDescription =
    appliedFilters.sort_order === 'asc'
      ? 'Más antiguos primero. Selecciona un correo para abrir el detalle.'
      : 'Más recientes primero. Selecciona un correo para abrir el detalle.';

  if (!hasAccess && fallbackPath) {
    return <Navigate to={fallbackPath} replace />;
  }

  return (
    <div className="min-h-screen bg-muted/20">
      <main className="mx-auto flex max-w-7xl flex-col gap-6 px-3 py-8">
        <Card className="relative overflow-hidden border-none bg-gradient-to-br from-primary to-primary/80 text-primary-foreground shadow-xl">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(255,255,255,0.25),_transparent_55%)]" />
          <CardHeader className="relative space-y-4">
            <div className="space-y-1">
              <p className="text-sm font-semibold uppercase tracking-wide text-white/70">Administración</p>
              <h1 className="text-2xl font-semibold tracking-tight text-white sm:text-3xl">Correo de pedidos</h1>
              <p className="text-sm text-white/80">
                Consulta IMAP con cambio de estado de lectura. Ventana fija: últimos 2 días.
              </p>
            </div>
          </CardHeader>
        </Card>

        <Card className="border border-border/60">
          <CardHeader className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 text-lg">
                <MailSearch className="h-4 w-4 text-primary" />
                Correo de pedidos
              </CardTitle>
              <CardDescription>
                Carga automática al entrar. Permite marcar mensajes como leídos o no leídos, sin acciones de envío o respuesta.
              </CardDescription>
            </div>
            <div className="grid w-full gap-3 md:grid-cols-[170px_200px_auto] md:items-end lg:w-auto">
              <div className="space-y-1">
                <Label htmlFor="order-mails-since" className="text-xs font-medium text-muted-foreground">
                  Revisar desde
                </Label>
                <Input id="order-mails-since" value={formatDate(fixedSince.since_iso)} readOnly className="h-10 bg-muted/30" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="order-mails-mailbox" className="text-xs font-medium text-muted-foreground">
                  Carpeta
                </Label>
                <Input
                  id="order-mails-mailbox"
                  value="INBOX"
                  readOnly
                  className="h-10 bg-muted/30"
                />
              </div>
              <div className="md:self-end">
                <Button onClick={handleRefresh} disabled={loadingList} className="h-10 w-full gap-2 px-5 sm:w-auto">
                  {loadingList ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                  Refrescar
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            <p className="text-xs text-muted-foreground">
              Última revisión: <strong>{checkedAt ? formatDateTime(checkedAt) : '—'}</strong> · Correos encontrados:{' '}
              <strong>{totalMessages}</strong>
              {totalMessages > 0 ? (
                <>
                  {' '}
                  · Página <strong>{currentPage}</strong> de <strong>{totalPages}</strong> · Mostrando{' '}
                  <strong>{listRange.start}</strong> a <strong>{listRange.end}</strong>
                </>
              ) : null}
              {timeframe?.since_iso ? (
                <>
                  {' '}
                  · Filtro fecha desde <code>{formatDate(timeframe.since_iso)}</code>
                </>
              ) : null}
              {activeFiltersSummary ? (
                <>
                  {' '}
                  · Filtros activos: <code>{activeFiltersSummary}</code>
                </>
              ) : null}
            </p>

            <div className="mt-4 rounded-lg border bg-muted/20 p-4">
              <form className="space-y-3" onSubmit={handleApplyFilters}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium">Filtros del listado</p>
                    <p className="text-xs text-muted-foreground">
                      Acota por fecha y hora dentro de los últimos 2 días, y además por asunto o remitente.
                    </p>
                  </div>
                </div>

                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-7">
                  <div className="space-y-1">
                    <Label htmlFor="order-mails-date-from" className="text-xs font-medium text-muted-foreground">
                      Fecha desde
                    </Label>
                    <Input
                      id="order-mails-date-from"
                      type="date"
                      min={defaultFilters.date_from}
                      max={defaultFilters.date_to}
                      value={draftFilters.date_from}
                      onChange={(event) => setDraftFilters((prev) => ({ ...prev, date_from: event.target.value }))}
                      className="h-10 bg-background"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="order-mails-time-from" className="text-xs font-medium text-muted-foreground">
                      Hora desde
                    </Label>
                    <Input
                      id="order-mails-time-from"
                      type="time"
                      value={draftFilters.time_from}
                      onChange={(event) => setDraftFilters((prev) => ({ ...prev, time_from: event.target.value }))}
                      className="h-10 bg-background"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="order-mails-date-to" className="text-xs font-medium text-muted-foreground">
                      Fecha hasta
                    </Label>
                    <Input
                      id="order-mails-date-to"
                      type="date"
                      min={defaultFilters.date_from}
                      max={defaultFilters.date_to}
                      value={draftFilters.date_to}
                      onChange={(event) => setDraftFilters((prev) => ({ ...prev, date_to: event.target.value }))}
                      className="h-10 bg-background"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="order-mails-time-to" className="text-xs font-medium text-muted-foreground">
                      Hora hasta
                    </Label>
                    <Input
                      id="order-mails-time-to"
                      type="time"
                      value={draftFilters.time_to}
                      onChange={(event) => setDraftFilters((prev) => ({ ...prev, time_to: event.target.value }))}
                      className="h-10 bg-background"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="order-mails-subject-filter" className="text-xs font-medium text-muted-foreground">
                      Asunto contiene
                    </Label>
                    <Input
                      id="order-mails-subject-filter"
                      value={draftFilters.subject_contains}
                      onChange={(event) => setDraftFilters((prev) => ({ ...prev, subject_contains: event.target.value }))}
                      placeholder="Ej. previsiones"
                      className="h-10 bg-background"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="order-mails-from-filter" className="text-xs font-medium text-muted-foreground">
                      Remitente contiene
                    </Label>
                    <Input
                      id="order-mails-from-filter"
                      value={draftFilters.from_contains}
                      onChange={(event) => setDraftFilters((prev) => ({ ...prev, from_contains: event.target.value }))}
                      placeholder="Ej. greenyard o correo@dominio"
                      className="h-10 bg-background"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="order-mails-sort-order" className="text-xs font-medium text-muted-foreground">
                      Orden
                    </Label>
                    <Select
                      value={draftFilters.sort_order}
                      onValueChange={(value) =>
                        setDraftFilters((prev) => ({ ...prev, sort_order: (value as OrderMailSortOrder) || 'desc' }))
                      }
                    >
                      <SelectTrigger id="order-mails-sort-order" className="h-10 bg-background">
                        <SelectValue placeholder="Orden del listado" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="desc">Más recientes primero</SelectItem>
                        <SelectItem value="asc">Más antiguos primero</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs text-muted-foreground">
                    Ventana fija base desde <code>{formatDate(fixedSince.since_iso)}</code> hasta hoy.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" variant="outline" onClick={handleClearFilters} disabled={loadingList}>
                      Limpiar filtros
                    </Button>
                    <Button type="submit" disabled={loadingList}>
                      Aplicar filtros
                    </Button>
                  </div>
                </div>
              </form>
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-6 lg:grid-cols-[380px_1fr]">
          <Card className="border border-border/60">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Mail className="h-4 w-4 text-primary" />
                Listado de correos
              </CardTitle>
              <CardDescription>{listDescription}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {loadingList && messages.length === 0 ? (
                <Alert>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <AlertTitle>Cargando correos</AlertTitle>
                  <AlertDescription>
                    Consultando <code>{displayedMailbox}</code> para los últimos 2 días...
                  </AlertDescription>
                </Alert>
              ) : null}

              {!loadingList && messages.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No hay correos de pedidos en <code>{displayedMailbox}</code> desde <code>{formatDate(fixedSince.since_iso)}</code>.
                </p>
              ) : null}

              {loadingList && messages.length > 0 ? <p className="text-xs text-muted-foreground">Cargando página...</p> : null}

              {messages.length > 0 ? (
                <div className="max-h-[66vh] space-y-2 overflow-auto pr-1">
                  {messages.map((message) => {
                    const isSelected = selectedUid === message.uid;
                    const hasMissingPdf = Boolean(message.has_pdf_missing_in_db);
                    const missingPdfCount = typeof message.missing_pdf_count === 'number' ? message.missing_pdf_count : 0;
                    const secondaryTextClassName = hasMissingPdf ? MAIL_PENDING_META_CLASS : 'text-muted-foreground';
                    return (
                      <button
                        key={message.uid}
                        type="button"
                        onClick={() => {
                          setSelectedUid(message.uid);
                          if (loadingDetailUid === message.uid) return;
                          if (!detailsByUid[message.uid] || detailErrorsByUid[message.uid]) {
                            void fetchDetail(message.uid, message.message_id);
                          }
                        }}
                        className={`w-full rounded-md border p-3 text-left transition-colors ${
                          isSelected
                            ? hasMissingPdf
                              ? MAIL_PENDING_SELECTED_LIST_ITEM_CLASS
                              : 'border-primary bg-primary/5 dark:border-primary/60 dark:bg-primary/10'
                            : hasMissingPdf
                              ? MAIL_PENDING_LIST_ITEM_CLASS
                              : 'hover:bg-muted/40 dark:hover:bg-white/[0.04]'
                        }`}
                      >
                        <div className="mb-1 flex items-start justify-between gap-2">
                          <p className="min-w-0 flex-1 truncate pr-1 text-sm font-semibold">
                            {truncateListSubject(message.subject)}
                          </p>
                          <div className="flex shrink-0 items-center gap-1">
                            {hasMissingPdf ? (
                              <Badge
                                variant="outline"
                                className={MAIL_PENDING_BADGE_CLASS}
                                title={`${missingPdfCount} PDF${missingPdfCount === 1 ? '' : 's'} no insertado${missingPdfCount === 1 ? '' : 's'}`}
                              >
                                {missingPdfCount > 1 ? `${missingPdfCount} PDFs` : 'PDF'}
                              </Badge>
                            ) : null}
                            <Badge
                              variant="outline"
                              className={`inline-flex min-w-[76px] shrink-0 items-center justify-center gap-1 whitespace-nowrap [word-break:keep-all] rounded-md border px-1.5 py-0.5 text-[10px] font-semibold leading-none sm:min-w-[82px] sm:text-[11px] ${getReadStateBadgeClass(message.seen)}`}
                            >
                              <span className={`h-1.5 w-1.5 rounded-full ${getReadStateDotClass(message.seen)}`} />
                              {message.seen ? 'Leído' : 'No leído'}
                            </Badge>
                          </div>
                        </div>
                        <p className={`line-clamp-1 text-xs ${secondaryTextClassName}`}>{message.from || 'Remitente no disponible'}</p>
                        <div className={`mt-2 flex items-center justify-between gap-2 text-xs ${secondaryTextClassName}`}>
                          <span>{formatDateTime(message.email_date)}</span>
                          {message.has_attachments ? (
                            <span>Adjuntos: {message.attachment_count}</span>
                          ) : (
                            <span>Sin adjuntos</span>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              ) : null}

              {messages.length > 0 ? (
                <MailListPagination
                  currentPage={currentPage}
                  totalPages={totalPages}
                  totalMessages={totalMessages}
                  currentCount={messages.length}
                  pageSize={ORDER_MAIL_PAGE_SIZE}
                  disabled={loadingList}
                  onPageChange={handlePageChange}
                />
              ) : null}
            </CardContent>
          </Card>

          <Card className="border border-border/60">
            <CardHeader>
              <CardTitle className="text-base">Detalle del correo</CardTitle>
              <CardDescription>Cabeceras y contenido del mensaje. Desde aquí puedes cambiar su estado de lectura.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {!selectedUid && messages.length > 0 ? (
                <p className="text-sm text-muted-foreground">Selecciona un correo del listado para ver el detalle.</p>
              ) : null}

              {!selectedUid && messages.length === 0 && !loadingList ? (
                <p className="text-sm text-muted-foreground">No hay correos para mostrar detalle.</p>
              ) : null}

              {selectedUid && loadingDetailUid === selectedUid && !selectedDetail ? (
                <Alert>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <AlertTitle>Cargando detalle</AlertTitle>
                  <AlertDescription>Obteniendo contenido del correo seleccionado...</AlertDescription>
                </Alert>
              ) : null}

              {selectedUid && selectedDetailError ? (
                <Alert variant="destructive">
                  <AlertTitle>No se pudo cargar el correo</AlertTitle>
                  <AlertDescription>{selectedDetailError}</AlertDescription>
                </Alert>
              ) : null}

              {selectedDetail ? (
                <div className="space-y-4">
                  <div className="space-y-3 rounded-md border bg-muted/20 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <p className="text-base font-semibold">{selectedDetail.subject?.trim() || 'Sin asunto'}</p>
                      <div className="flex shrink-0 items-center gap-2">
                        <Badge
                          variant="outline"
                          className={`inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md border px-2 py-1 text-xs font-semibold leading-none ${getReadStateBadgeClass(selectedDetail.seen)}`}
                        >
                          <span className={`h-1.5 w-1.5 rounded-full ${getReadStateDotClass(selectedDetail.seen)}`} />
                          {selectedDetail.seen ? 'Leído' : 'No leído'}
                        </Badge>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-8 gap-2 text-xs"
                          onClick={() => handleSetSeen(selectedDetail.uid, !selectedDetail.seen, selectedMessage?.message_id ?? null)}
                          disabled={updatingSeenUid === selectedDetail.uid}
                        >
                          {updatingSeenUid === selectedDetail.uid ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                          {selectedDetail.seen ? 'Marcar no leído' : 'Marcar leído'}
                        </Button>
                      </div>
                    </div>
                    <div className="grid gap-2 text-sm sm:grid-cols-2">
                      <p>
                        <span className="font-medium text-muted-foreground">Fecha:</span> {formatDateTime(selectedDetail.date)}
                      </p>
                      <p className="sm:col-span-2">
                        <span className="font-medium text-muted-foreground">De:</span> {selectedDetail.from || '—'}
                      </p>
                      <p className="sm:col-span-2">
                        <span className="font-medium text-muted-foreground">Para:</span> {selectedDetail.to || '—'}
                      </p>
                      <p className="sm:col-span-2">
                        <span className="font-medium text-muted-foreground">CC:</span> {selectedDetail.cc || '—'}
                      </p>
                    </div>
                  </div>

                  <div className="space-y-2 rounded-md border bg-muted/20 p-3">
                    <p className="text-sm font-semibold">Adjuntos ({selectedDetail.attachments.length})</p>
                    {selectedDetail.attachments.length === 0 ? (
                      <p className="text-sm text-muted-foreground">Este correo no tiene adjuntos.</p>
                    ) : (
                      <div className="max-h-44 overflow-auto">
                        <ul className="space-y-1 text-sm">
                          {selectedDetail.attachments.map((attachment, index) => {
                            const attachmentContainerClassName = attachment.ignored_by_rule
                              ? MAIL_IGNORED_ATTACHMENT_CLASS
                              : attachment.has_pdf_missing_in_db
                              ? MAIL_PENDING_ATTACHMENT_CLASS
                              : 'bg-background';
                            const attachmentMetaClassName = attachment.ignored_by_rule
                              ? MAIL_IGNORED_META_CLASS
                              : attachment.has_pdf_missing_in_db
                              ? MAIL_PENDING_META_CLASS
                              : 'text-muted-foreground';

                            return (
                              <li
                                key={`${attachment.filename ?? 'adjunto'}-${index}`}
                                className={`rounded border px-2 py-1.5 ${attachmentContainerClassName}`}
                              >
                                <div className="flex items-center justify-between gap-2">
                                  <div className="min-w-0">
                                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                                      <span className="font-medium">{attachment.filename || 'Sin nombre'}</span>
                                      {attachment.ignored_by_rule ? (
                                        <Badge
                                          variant="outline"
                                          className={MAIL_IGNORED_BADGE_CLASS}
                                        >
                                          Ignorado
                                        </Badge>
                                      ) : null}
                                      {attachment.has_pdf_missing_in_db ? (
                                        <Badge
                                          variant="outline"
                                          className={MAIL_PENDING_BADGE_CLASS}
                                        >
                                          PDF pendiente
                                        </Badge>
                                      ) : null}
                                    </div>
                                    <span className={attachmentMetaClassName}>
                                      {attachment.mime_type || 'mime desconocido'} · {formatBytes(attachment.size_bytes)}
                                    </span>
                                  </div>
                                  {attachment.download_base64 ? (
                                    <Button
                                      type="button"
                                      variant="outline"
                                      size="sm"
                                      className="h-7 shrink-0 gap-1 px-2 text-xs"
                                      onClick={() => handleDownloadAttachment(attachment, index)}
                                    >
                                      <Download className="h-3.5 w-3.5" />
                                      Descargar
                                    </Button>
                                  ) : (
                                    <span className={`shrink-0 text-xs ${attachmentMetaClassName}`}>No descargable</span>
                                  )}
                                </div>
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    )}
                  </div>

                  <div className="space-y-2 rounded-md border bg-muted/20 p-3">
                    <p className="text-sm font-semibold">HTML</p>
                    {selectedHasHtml ? (
                      <iframe
                        title={`mail-html-${selectedDetail.uid}`}
                        sandbox=""
                        srcDoc={buildMailHtmlSrcDoc(selectedDetail.body_html)}
                        className="min-h-[420px] w-full rounded border bg-white"
                      />
                    ) : (
                      <p className="text-sm text-muted-foreground">Este correo no contiene cuerpo HTML.</p>
                    )}
                  </div>
                </div>
              ) : null}
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
};

export default AdminOrderEmails;
