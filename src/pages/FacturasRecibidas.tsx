import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { format } from 'date-fns';
import {
  AlertTriangle,
  Ban,
  Calendar as CalendarIcon,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Copy,
  Eye,
  FileText,
  Filter,
  Loader2,
  Plus,
  RefreshCw,
  Save,
  Send,
  Trash2,
  X,
} from 'lucide-react';

import { AcreedorCombobox } from '@/components/AcreedorCombobox';
import { PdfViewer } from '@/components/PdfViewer';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Calendar as DateRangeCalendar } from '@/components/ui/calendar';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useFacturasRecibidas, useFacturaRecibida, useFacturaRecibidaMutations, useFacturaRecibidaPdf } from '@/hooks/useFacturasRecibidas';
import { useToast } from '@/hooks/use-toast';
import type { FacturaRecibida, FacturaRecibidaCtb, FacturaRecibidaEstado } from '@/types/facturasRecibidas';
import type { DateRange } from 'react-day-picker';
import {
  FACTURA_ESTADO_META,
  FACTURA_RECIBIDA_ESTADOS,
  formatFacturaCurrency,
  formatFacturaDate,
  nullableNumber,
  safeNumber,
} from '@/types/facturasRecibidas';

type DetailForm = {
  proveedor_nombre: string;
  proveedor_nif: string;
  FRR_idproveedor: string;
  FRR_idcuenta: string;
  FRR_numerofactura: string;
  FRR_fechafactura: string;
  FRR_fechactb: string;
  FRR_Idempresa: string;
  FRR_tipofactura: string;
  FRR_base1: string;
  FRR_iva1: string;
  FRR_cuota1: string;
  FRR_base2: string;
  FRR_iva2: string;
  FRR_cuota2: string;
  FRR_baseret: string;
  FRR_ret: string;
  FRR_cuotaret: string;
  FRR_totalfac: string;
  FRR_ImpSuplido: string;
  FRR_CuotaNoDeducible: string;
  FRR_Concepto: string;
  FRR_Observaciones: string;
};

type CtbFormLine = {
  key: string;
  FRC_Cuenta: string;
  FRC_Importe: string;
  FRC_IdActividad: string;
  FRC_Idseccion: string;
  FRC_Iddepartamento: string;
  FRC_Idsubdepartamento: string;
};

const PAGE_SIZE = 20;
const numberFormat = (value: number) => new Intl.NumberFormat('es-ES').format(value ?? 0);

const emptyToNull = (value: string) => {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const numberInputValue = (value: unknown) => (value === null || value === undefined ? '' : String(value));

const buildForm = (factura: FacturaRecibida): DetailForm => ({
  proveedor_nombre: factura.proveedor_nombre ?? '',
  proveedor_nif: factura.proveedor_nif ?? '',
  FRR_idproveedor: numberInputValue(factura.FRR_idproveedor),
  FRR_idcuenta: factura.FRR_idcuenta ?? '',
  FRR_numerofactura: factura.FRR_numerofactura ?? '',
  FRR_fechafactura: factura.FRR_fechafactura ?? '',
  FRR_fechactb: factura.FRR_fechactb ?? factura.FRR_fechafactura ?? '',
  FRR_Idempresa: numberInputValue(factura.FRR_Idempresa ?? 1),
  FRR_tipofactura: factura.FRR_tipofactura ?? '1',
  FRR_base1: numberInputValue(factura.FRR_base1),
  FRR_iva1: numberInputValue(factura.FRR_iva1),
  FRR_cuota1: numberInputValue(factura.FRR_cuota1),
  FRR_base2: numberInputValue(factura.FRR_base2),
  FRR_iva2: numberInputValue(factura.FRR_iva2),
  FRR_cuota2: numberInputValue(factura.FRR_cuota2),
  FRR_baseret: numberInputValue(factura.FRR_baseret),
  FRR_ret: numberInputValue(factura.FRR_ret),
  FRR_cuotaret: numberInputValue(factura.FRR_cuotaret),
  FRR_totalfac: numberInputValue(factura.FRR_totalfac),
  FRR_ImpSuplido: numberInputValue(factura.FRR_ImpSuplido),
  FRR_CuotaNoDeducible: numberInputValue(factura.FRR_CuotaNoDeducible),
  FRR_Concepto: factura.FRR_Concepto ?? '',
  FRR_Observaciones: factura.FRR_Observaciones ?? '',
});

const buildCtbLine = (line?: FacturaRecibidaCtb, index = 0): CtbFormLine => ({
  key: line?.id ?? `line-${Date.now()}-${index}`,
  FRC_Cuenta: line?.FRC_Cuenta ?? '',
  FRC_Importe: numberInputValue(line?.FRC_Importe),
  FRC_IdActividad: numberInputValue(line?.FRC_IdActividad),
  FRC_Idseccion: numberInputValue(line?.FRC_Idseccion),
  FRC_Iddepartamento: numberInputValue(line?.FRC_Iddepartamento),
  FRC_Idsubdepartamento: numberInputValue(line?.FRC_Idsubdepartamento),
});

const buildFacturaPayload = (form: DetailForm) => ({
  FRR_idproveedor: nullableNumber(form.FRR_idproveedor),
  FRR_idcuenta: emptyToNull(form.FRR_idcuenta),
  FRR_numerofactura: emptyToNull(form.FRR_numerofactura),
  FRR_fechafactura: emptyToNull(form.FRR_fechafactura),
  FRR_fechactb: emptyToNull(form.FRR_fechactb),
  FRR_Idempresa: nullableNumber(form.FRR_Idempresa) ?? 1,
  FRR_tipofactura: emptyToNull(form.FRR_tipofactura) ?? '1',
  FRR_base1: nullableNumber(form.FRR_base1) ?? 0,
  FRR_iva1: nullableNumber(form.FRR_iva1) ?? 0,
  FRR_cuota1: nullableNumber(form.FRR_cuota1) ?? 0,
  FRR_base2: nullableNumber(form.FRR_base2) ?? 0,
  FRR_iva2: nullableNumber(form.FRR_iva2) ?? 0,
  FRR_cuota2: nullableNumber(form.FRR_cuota2) ?? 0,
  FRR_baseret: nullableNumber(form.FRR_baseret) ?? 0,
  FRR_ret: nullableNumber(form.FRR_ret) ?? 0,
  FRR_cuotaret: nullableNumber(form.FRR_cuotaret) ?? 0,
  FRR_totalfac: nullableNumber(form.FRR_totalfac),
  FRR_ImpSuplido: nullableNumber(form.FRR_ImpSuplido) ?? 0,
  FRR_CuotaNoDeducible: nullableNumber(form.FRR_CuotaNoDeducible) ?? 0,
  FRR_Concepto: emptyToNull(form.FRR_Concepto),
  FRR_Observaciones: emptyToNull(form.FRR_Observaciones),
});

const buildCtbPayload = (lines: CtbFormLine[]) =>
  lines.map((line) => ({
    FRC_Cuenta: emptyToNull(line.FRC_Cuenta),
    FRC_Importe: nullableNumber(line.FRC_Importe) ?? 0,
    FRC_IdActividad: nullableNumber(line.FRC_IdActividad),
    FRC_Idseccion: nullableNumber(line.FRC_Idseccion),
    FRC_Iddepartamento: nullableNumber(line.FRC_Iddepartamento),
    FRC_Idsubdepartamento: nullableNumber(line.FRC_Idsubdepartamento),
  }));

const dateFromInputValue = (value: string) => (value ? new Date(`${value}T00:00:00`) : undefined);

const formatDateRangeLabel = (range: DateRange | undefined) => {
  if (range?.from && range?.to) {
    return `${format(range.from, 'dd/MM/yyyy')} - ${format(range.to, 'dd/MM/yyyy')}`;
  }
  if (range?.from) {
    return `Desde ${format(range.from, 'dd/MM/yyyy')}`;
  }
  if (range?.to) {
    return `Hasta ${format(range.to, 'dd/MM/yyyy')}`;
  }
  return 'Selecciona un rango';
};

const EstadoBadge = ({ estado }: { estado: FacturaRecibidaEstado }) => {
  const meta = FACTURA_ESTADO_META[estado];
  return <Badge className={`${meta.className} rounded-md border font-medium shadow-none`}>{meta.label}</Badge>;
};

const Field = ({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) => (
  <div className="space-y-1.5">
    <Label className="text-xs font-semibold text-slate-600">{label}</Label>
    {children}
  </div>
);

const FacturaDetailModal = ({ facturaId, onClose }: { facturaId: string; onClose: () => void }) => {
  const { toast } = useToast();
  const { data: factura, isLoading, error } = useFacturaRecibida(facturaId);
  const { update, send, remove } = useFacturaRecibidaMutations();
  const { data: pdfData, isLoading: pdfLoading } = useFacturaRecibidaPdf(factura?.archivo_pdf_id);
  const [form, setForm] = useState<DetailForm | null>(null);
  const [lines, setLines] = useState<CtbFormLine[]>([]);

  useEffect(() => {
    if (!factura) return;
    setForm(buildForm(factura));
    setLines(factura.ctb.length > 0 ? factura.ctb.map(buildCtbLine) : [buildCtbLine(undefined, 0)]);
  }, [factura]);

  const pdfUrl = pdfData?.base64 ? `data:application/pdf;base64,${pdfData.base64}` : '';
  const isBusy = update.isPending || send.isPending || remove.isPending;
  const isSent = factura?.estado === 'enviada_netagro';
  const blockingErrors = factura?.validation_errors.filter((item) => item.severity === 'error') ?? [];
  const warnings = factura?.validation_errors.filter((item) => item.severity === 'warning') ?? [];

  const setField = <K extends keyof DetailForm>(field: K, value: DetailForm[K]) => {
    setForm((current) => (current ? { ...current, [field]: value } : current));
  };

  const setLineField = (index: number, field: keyof CtbFormLine, value: string) => {
    setLines((current) =>
      current.map((line, lineIndex) => (lineIndex === index ? { ...line, [field]: value } : line)),
    );
  };

  const saveWithEstado = async (estado?: FacturaRecibidaEstado) => {
    if (!factura || !form) return;
    const payload = {
      factura_id: factura.id,
      estado,
      proveedor_nombre: emptyToNull(form.proveedor_nombre),
      proveedor_nif: emptyToNull(form.proveedor_nif),
      factura: buildFacturaPayload(form),
      ctb: buildCtbPayload(lines),
    };
    await update.mutateAsync(payload);
  };

  const handleSave = async (event?: FormEvent) => {
    event?.preventDefault();
    try {
      await saveWithEstado();
      toast({ title: 'Factura guardada', description: 'Se han recalculado las validaciones.' });
    } catch (err: any) {
      toast({
        title: 'No se pudo guardar',
        description: err?.message ?? 'Revisa los datos e intenta de nuevo.',
        variant: 'destructive',
      });
    }
  };

  const handleSend = async () => {
    if (!factura || !form) return;
    try {
      await saveWithEstado();
      await send.mutateAsync(factura.id);
      toast({ title: 'Enviada a Netagro', description: 'La factura recibida queda registrada como enviada.' });
    } catch (err: any) {
      toast({
        title: 'Netagro ha rechazado la factura',
        description: err?.message ?? 'Consulta el mensaje de error en el detalle.',
        variant: 'destructive',
      });
    }
  };

  const handleMark = async (estado: FacturaRecibidaEstado, title: string) => {
    try {
      await saveWithEstado(estado);
      toast({ title });
    } catch (err: any) {
      toast({
        title: 'No se pudo actualizar el estado',
        description: err?.message ?? 'Intenta de nuevo.',
        variant: 'destructive',
      });
    }
  };

  const handleDelete = async () => {
    if (!factura) return;
    if (!window.confirm('Borrar esta factura recibida de la plataforma?')) return;
    try {
      await remove.mutateAsync(factura.id);
      toast({ title: 'Factura borrada' });
      onClose();
    } catch (err: any) {
      toast({
        title: 'No se pudo borrar',
        description: err?.message ?? 'La factura puede estar ya enviada a Netagro.',
        variant: 'destructive',
      });
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/55 p-0 lg:items-center lg:p-6" onClick={onClose}>
      <section
        role="dialog"
        aria-modal="true"
        className="flex h-[100dvh] w-full max-w-[1500px] flex-col overflow-hidden rounded-none border border-slate-200 bg-white shadow-2xl lg:h-[92vh] lg:rounded-lg"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-slate-200 px-4 py-4 md:px-6">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <FileText className="h-5 w-5 text-[#2f7df1]" />
              <h2 className="truncate text-lg font-semibold text-slate-950">
                {factura?.FRR_numerofactura || factura?.source_pdf_name || 'Factura recibida'}
              </h2>
              {factura ? <EstadoBadge estado={factura.estado} /> : null}
            </div>
            <p className="mt-1 text-sm text-slate-500">
              {factura?.proveedor_nombre || 'Proveedor pendiente'} · {formatFacturaCurrency(factura?.FRR_totalfac)}
            </p>
          </div>
          <Button type="button" variant="outline" className="h-10 w-10 p-0" onClick={onClose} disabled={isBusy}>
            <X className="h-4 w-4" />
          </Button>
        </header>

        {isLoading ? (
          <div className="flex flex-1 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-[#2f7df1]" />
          </div>
        ) : error || !factura || !form ? (
          <div className="flex flex-1 items-center justify-center px-6 text-center text-sm text-slate-500">
            No se pudo cargar la factura.
          </div>
        ) : (
          <form onSubmit={handleSave} className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(420px,0.95fr)_minmax(520px,1.05fr)]">
            <div className="min-h-[42vh] border-b border-slate-200 bg-[#262626] lg:min-h-0 lg:border-b-0 lg:border-r">
              {pdfUrl ? (
                <PdfViewer
                  url={pdfUrl}
                  fileName={pdfData?.fileName ?? factura.source_pdf_name ?? 'factura-recibida.pdf'}
                  className="h-full min-h-[42vh] lg:min-h-0"
                  showControls
                />
              ) : (
                <div className="flex h-full min-h-[42vh] items-center justify-center bg-slate-100 px-6 text-center text-sm text-slate-500 lg:min-h-0">
                  {pdfLoading ? 'Cargando PDF...' : 'Esta factura no tiene PDF asociado.'}
                </div>
              )}
            </div>

            <div className="min-h-0 overflow-y-auto bg-slate-50/70">
              <div className="space-y-5 px-4 py-4 md:px-6">
                {factura.netagro_error ? (
                  <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
                    {factura.netagro_error}
                  </div>
                ) : null}

                {blockingErrors.length || warnings.length ? (
                  <section className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
                    <div className="flex items-center gap-2 text-sm font-semibold text-amber-900">
                      <AlertTriangle className="h-4 w-4" />
                      Validaciones
                    </div>
                    <ul className="mt-2 space-y-1 text-sm text-amber-900">
                      {[...blockingErrors, ...warnings].map((item, index) => (
                        <li key={`${item.field}-${index}`}>{item.message}</li>
                      ))}
                    </ul>
                  </section>
                ) : (
                  <section className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">
                    <CheckCircle2 className="h-4 w-4" />
                    Sin errores de validacion locales.
                  </section>
                )}

                <section className="rounded-lg border border-slate-200 bg-white p-4">
                  <h3 className="text-sm font-semibold text-slate-950">Proveedor y factura</h3>
                  <div className="mt-4 grid gap-4 md:grid-cols-2">
                    <Field label="Proveedor Netagro">
                      <AcreedorCombobox
                        value={nullableNumber(form.FRR_idproveedor)}
                        onChange={(value) => setField('FRR_idproveedor', value ? String(value) : '')}
                        disabled={isBusy || isSent}
                      />
                    </Field>
                    <Field label="Cuenta proveedor">
                      <Input value={form.FRR_idcuenta} onChange={(event) => setField('FRR_idcuenta', event.target.value)} disabled={isBusy || isSent} />
                    </Field>
                    <Field label="Nombre detectado">
                      <Input value={form.proveedor_nombre} onChange={(event) => setField('proveedor_nombre', event.target.value)} disabled={isBusy || isSent} />
                    </Field>
                    <Field label="NIF detectado">
                      <Input value={form.proveedor_nif} onChange={(event) => setField('proveedor_nif', event.target.value)} disabled={isBusy || isSent} />
                    </Field>
                    <Field label="Numero factura">
                      <Input value={form.FRR_numerofactura} onChange={(event) => setField('FRR_numerofactura', event.target.value)} disabled={isBusy || isSent} />
                    </Field>
                    <Field label="Empresa">
                      <Input type="number" value={form.FRR_Idempresa} onChange={(event) => setField('FRR_Idempresa', event.target.value)} disabled={isBusy || isSent} />
                    </Field>
                    <Field label="Fecha factura">
                      <Input type="date" value={form.FRR_fechafactura} onChange={(event) => setField('FRR_fechafactura', event.target.value)} disabled={isBusy || isSent} />
                    </Field>
                    <Field label="Fecha contable">
                      <Input type="date" value={form.FRR_fechactb} onChange={(event) => setField('FRR_fechactb', event.target.value)} disabled={isBusy || isSent} />
                    </Field>
                  </div>
                </section>

                <section className="rounded-lg border border-slate-200 bg-white p-4">
                  <h3 className="text-sm font-semibold text-slate-950">Importes</h3>
                  <div className="mt-4 grid gap-4 md:grid-cols-3">
                    <Field label="Base 1">
                      <Input type="number" step="0.01" value={form.FRR_base1} onChange={(event) => setField('FRR_base1', event.target.value)} disabled={isBusy || isSent} />
                    </Field>
                    <Field label="% IVA 1">
                      <Input type="number" step="0.01" value={form.FRR_iva1} onChange={(event) => setField('FRR_iva1', event.target.value)} disabled={isBusy || isSent} />
                    </Field>
                    <Field label="Cuota IVA 1">
                      <Input type="number" step="0.01" value={form.FRR_cuota1} onChange={(event) => setField('FRR_cuota1', event.target.value)} disabled={isBusy || isSent} />
                    </Field>
                    <Field label="Base 2">
                      <Input type="number" step="0.01" value={form.FRR_base2} onChange={(event) => setField('FRR_base2', event.target.value)} disabled={isBusy || isSent} />
                    </Field>
                    <Field label="% IVA 2">
                      <Input type="number" step="0.01" value={form.FRR_iva2} onChange={(event) => setField('FRR_iva2', event.target.value)} disabled={isBusy || isSent} />
                    </Field>
                    <Field label="Cuota IVA 2">
                      <Input type="number" step="0.01" value={form.FRR_cuota2} onChange={(event) => setField('FRR_cuota2', event.target.value)} disabled={isBusy || isSent} />
                    </Field>
                    <Field label="Base retencion">
                      <Input type="number" step="0.01" value={form.FRR_baseret} onChange={(event) => setField('FRR_baseret', event.target.value)} disabled={isBusy || isSent} />
                    </Field>
                    <Field label="% Retencion">
                      <Input type="number" step="0.01" value={form.FRR_ret} onChange={(event) => setField('FRR_ret', event.target.value)} disabled={isBusy || isSent} />
                    </Field>
                    <Field label="Cuota retencion">
                      <Input type="number" step="0.01" value={form.FRR_cuotaret} onChange={(event) => setField('FRR_cuotaret', event.target.value)} disabled={isBusy || isSent} />
                    </Field>
                    <Field label="Suplido">
                      <Input type="number" step="0.01" value={form.FRR_ImpSuplido} onChange={(event) => setField('FRR_ImpSuplido', event.target.value)} disabled={isBusy || isSent} />
                    </Field>
                    <Field label="Cuota no deducible">
                      <Input type="number" step="0.01" value={form.FRR_CuotaNoDeducible} onChange={(event) => setField('FRR_CuotaNoDeducible', event.target.value)} disabled={isBusy || isSent} />
                    </Field>
                    <Field label="Total factura">
                      <Input type="number" step="0.01" value={form.FRR_totalfac} onChange={(event) => setField('FRR_totalfac', event.target.value)} disabled={isBusy || isSent} />
                    </Field>
                  </div>
                </section>

                <section className="rounded-lg border border-slate-200 bg-white p-4">
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="text-sm font-semibold text-slate-950">Desglose contable</h3>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="gap-2"
                      disabled={isBusy || isSent}
                      onClick={() => setLines((current) => [...current, buildCtbLine(undefined, current.length)])}
                    >
                      <Plus className="h-4 w-4" />
                      Linea
                    </Button>
                  </div>
                  <div className="mt-4 space-y-3">
                    {lines.map((line, index) => (
                      <div key={line.key} className="grid gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3 md:grid-cols-[1.3fr_0.8fr_0.7fr_0.7fr_0.7fr_0.7fr_auto]">
                        <Field label="Cuenta">
                          <Input value={line.FRC_Cuenta} onChange={(event) => setLineField(index, 'FRC_Cuenta', event.target.value)} disabled={isBusy || isSent} />
                        </Field>
                        <Field label="Importe">
                          <Input type="number" step="0.01" value={line.FRC_Importe} onChange={(event) => setLineField(index, 'FRC_Importe', event.target.value)} disabled={isBusy || isSent} />
                        </Field>
                        <Field label="Actividad">
                          <Input type="number" value={line.FRC_IdActividad} onChange={(event) => setLineField(index, 'FRC_IdActividad', event.target.value)} disabled={isBusy || isSent} />
                        </Field>
                        <Field label="Seccion">
                          <Input type="number" value={line.FRC_Idseccion} onChange={(event) => setLineField(index, 'FRC_Idseccion', event.target.value)} disabled={isBusy || isSent} />
                        </Field>
                        <Field label="Depto.">
                          <Input type="number" value={line.FRC_Iddepartamento} onChange={(event) => setLineField(index, 'FRC_Iddepartamento', event.target.value)} disabled={isBusy || isSent} />
                        </Field>
                        <Field label="Subdepto.">
                          <Input type="number" value={line.FRC_Idsubdepartamento} onChange={(event) => setLineField(index, 'FRC_Idsubdepartamento', event.target.value)} disabled={isBusy || isSent} />
                        </Field>
                        <div className="flex items-end">
                          <Button
                            type="button"
                            variant="outline"
                            className="h-10 w-10 p-0"
                            disabled={isBusy || isSent || lines.length <= 1}
                            onClick={() => setLines((current) => current.filter((_, lineIndex) => lineIndex !== index))}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>

                <section className="rounded-lg border border-slate-200 bg-white p-4">
                  <h3 className="text-sm font-semibold text-slate-950">Concepto y observaciones</h3>
                  <div className="mt-4 grid gap-4">
                    <Field label="Concepto">
                      <Input value={form.FRR_Concepto} onChange={(event) => setField('FRR_Concepto', event.target.value)} disabled={isBusy || isSent} />
                    </Field>
                    <Field label="Observaciones">
                      <Textarea value={form.FRR_Observaciones} onChange={(event) => setField('FRR_Observaciones', event.target.value)} disabled={isBusy || isSent} />
                    </Field>
                  </div>
                </section>
              </div>

              <footer className="sticky bottom-0 flex flex-col gap-3 border-t border-slate-200 bg-white px-4 py-4 shadow-[0_-8px_30px_rgba(15,23,42,0.06)] md:flex-row md:items-center md:justify-between md:px-6">
                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="outline" className="gap-2" disabled={isBusy || isSent} onClick={() => handleMark('duplicada', 'Factura marcada como duplicada')}>
                    <Copy className="h-4 w-4" />
                    Duplicada
                  </Button>
                  <Button type="button" variant="outline" className="gap-2" disabled={isBusy || isSent} onClick={() => handleMark('descartada', 'Factura descartada')}>
                    <Ban className="h-4 w-4" />
                    Descartar
                  </Button>
                  <Button type="button" variant="outline" className="gap-2 border-rose-200 text-rose-700 hover:bg-rose-50 hover:text-rose-800" disabled={isBusy || isSent} onClick={handleDelete}>
                    <Trash2 className="h-4 w-4" />
                    Borrar
                  </Button>
                </div>
                <div className="flex flex-col-reverse gap-2 sm:flex-row">
                  <Button type="button" variant="outline" onClick={onClose} disabled={isBusy}>
                    Cerrar
                  </Button>
                  <Button type="submit" variant="outline" className="gap-2" disabled={isBusy || isSent}>
                    {update.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                    Guardar
                  </Button>
                  <Button type="button" className="gap-2 bg-[#2f7df1] hover:bg-[#276ee0]" disabled={isBusy || isSent} onClick={handleSend}>
                    {send.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                    Enviar a Netagro
                  </Button>
                </div>
              </footer>
            </div>
          </form>
        )}
      </section>
    </div>
  );
};

const FacturasRecibidas = () => {
  const [page, setPage] = useState(1);
  const [estado, setEstado] = useState<FacturaRecibidaEstado | 'all'>('all');
  const [proveedor, setProveedor] = useState('');
  const [nif, setNif] = useState('');
  const [numero, setNumero] = useState('');
  const [fechaFrom, setFechaFrom] = useState('');
  const [fechaTo, setFechaTo] = useState('');
  const [totalFrom, setTotalFrom] = useState('');
  const [totalTo, setTotalTo] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(true);

  const filters = useMemo(
    () => ({
      page,
      pageSize: PAGE_SIZE,
      estado,
      proveedor,
      nif,
      numero,
      fechaFrom,
      fechaTo,
      totalFrom: totalFrom.trim() ? safeNumber(totalFrom) : null,
      totalTo: totalTo.trim() ? safeNumber(totalTo) : null,
    }),
    [estado, fechaFrom, fechaTo, nif, numero, page, proveedor, totalFrom, totalTo],
  );

  const { data, isLoading, isFetching, error, refetch } = useFacturasRecibidas(filters);
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const pageStart = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const pageEnd = Math.min(total, page * PAGE_SIZE);

  const fechaRango = useMemo<DateRange | undefined>(() => {
    const from = dateFromInputValue(fechaFrom);
    const to = dateFromInputValue(fechaTo);
    return from || to ? { from, to } : undefined;
  }, [fechaFrom, fechaTo]);

  const fechaRangoLabel = useMemo(() => formatDateRangeLabel(fechaRango), [fechaRango]);

  const activeFiltersCount = [
    estado !== 'all',
    proveedor.trim().length > 0,
    nif.trim().length > 0,
    numero.trim().length > 0,
    Boolean(fechaFrom || fechaTo),
    totalFrom.trim().length > 0,
    totalTo.trim().length > 0,
  ].filter(Boolean).length;

  useEffect(() => {
    setPage(1);
  }, [estado, proveedor, nif, numero, fechaFrom, fechaTo, totalFrom, totalTo]);

  const groups = useMemo(() => {
    const byPdf = new Map<string, { key: string; title: string; archivoPdfId: number | null; items: FacturaRecibida[] }>();
    for (const item of data?.items ?? []) {
      const key = item.archivo_pdf_id ? `pdf-${item.archivo_pdf_id}` : `factura-${item.id}`;
      const current = byPdf.get(key);
      if (current) {
        current.items.push(item);
      } else {
        byPdf.set(key, {
          key,
          title: item.source_pdf_name || (item.archivo_pdf_id ? `PDF ${item.archivo_pdf_id}` : 'Sin PDF'),
          archivoPdfId: item.archivo_pdf_id,
          items: [item],
        });
      }
    }
    return Array.from(byPdf.values());
  }, [data?.items]);

  const resetFilters = () => {
    setEstado('all');
    setProveedor('');
    setNif('');
    setNumero('');
    setFechaFrom('');
    setFechaTo('');
    setTotalFrom('');
    setTotalTo('');
  };

  const handleFechaRangoChange = (range: DateRange | undefined) => {
    setFechaFrom(range?.from ? format(range.from, 'yyyy-MM-dd') : '');
    setFechaTo(range?.to ? format(range.to, 'yyyy-MM-dd') : '');
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50/30 to-slate-100 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950">
      <div className="container mx-auto p-6 space-y-6">
        <Card className="relative overflow-hidden border-none bg-gradient-to-br from-primary to-primary/80 text-primary-foreground shadow-xl">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(255,255,255,0.25),_transparent_55%)]" />
          <CardHeader className="relative space-y-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="space-y-1">
                <p className="text-sm font-semibold uppercase tracking-wide text-white/70">
                  Facturas recibidas
                </p>
                <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-white">
                  Consola de facturas
                </h1>
                <p className="text-sm text-white/80">
                  {numberFormat(total)} facturas totales
                </p>
              </div>
            </div>
          </CardHeader>
        </Card>

        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => void refetch()}
              disabled={isFetching}
              className="flex items-center gap-2"
            >
              {isFetching ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Refrescando
                </>
              ) : (
                <>
                  <RefreshCw className="h-4 w-4" />
                  Refrescar
                </>
              )}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowFilters((prev) => !prev)}
              className={`flex items-center gap-2 border-primary/50 text-primary hover:bg-primary/10 hover:text-primary dark:border-blue-400/70 dark:text-blue-200 dark:hover:bg-blue-400/10 ${showFilters ? 'bg-primary text-primary-foreground dark:bg-blue-500 dark:text-slate-50 border-transparent' : 'bg-background'}`}
            >
              <Filter className="h-4 w-4" />
              Filtros
              {activeFiltersCount > 0 && (
                <Badge variant="secondary" className="ml-1 h-5 w-5 p-0 flex items-center justify-center text-[11px]">
                  {activeFiltersCount}
                </Badge>
              )}
            </Button>
          </div>
        </div>

        {showFilters && (
          <Card>
            <CardHeader className="flex flex-row items-center justify-between py-4">
              <CardTitle className="text-base">Filtros de búsqueda</CardTitle>
              {activeFiltersCount > 0 && (
                <Button variant="ghost" size="sm" className="gap-2" onClick={resetFilters}>
                  <X className="h-4 w-4" />
                  Limpiar filtros
                </Button>
              )}
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="factura-filter-numero">Buscar</Label>
                  <Input
                    id="factura-filter-numero"
                    placeholder="Buscar número de factura..."
                    value={numero}
                    onChange={(event) => setNumero(event.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="factura-filter-proveedor">Proveedor</Label>
                  <Input
                    id="factura-filter-proveedor"
                    placeholder="Nombre o ID"
                    value={proveedor}
                    onChange={(event) => setProveedor(event.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Estado en Netagro</Label>
                  <Select value={estado} onValueChange={(value) => setEstado(value as FacturaRecibidaEstado | 'all')}>
                    <SelectTrigger>
                      <SelectValue placeholder="Estado en Netagro" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todos</SelectItem>
                      {FACTURA_RECIBIDA_ESTADOS.map((item) => (
                        <SelectItem key={item} value={item}>
                          {FACTURA_ESTADO_META[item].label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Fecha factura</Label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        className={`w-full justify-start text-left font-normal ${
                          !(fechaRango?.from || fechaRango?.to) ? 'text-muted-foreground' : ''
                        }`}
                      >
                        <CalendarIcon className="mr-2 h-4 w-4" />
                        <span>{fechaRangoLabel}</span>
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <DateRangeCalendar
                        initialFocus
                        mode="range"
                        selected={fechaRango}
                        onSelect={handleFechaRangoChange}
                        numberOfMonths={2}
                      />
                    </PopoverContent>
                  </Popover>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="factura-filter-nif">NIF</Label>
                  <Input
                    id="factura-filter-nif"
                    value={nif}
                    onChange={(event) => setNif(event.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="factura-filter-total-from">Total desde</Label>
                  <Input
                    id="factura-filter-total-from"
                    type="number"
                    step="0.01"
                    value={totalFrom}
                    onChange={(event) => setTotalFrom(event.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="factura-filter-total-to">Total hasta</Label>
                  <Input
                    id="factura-filter-total-to"
                    type="number"
                    step="0.01"
                    value={totalTo}
                    onChange={(event) => setTotalTo(event.target.value)}
                  />
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        <Card className="border border-border/60 shadow-sm">
          <CardHeader className="space-y-1 px-6 pt-6 pb-4">
            <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <CardTitle className="text-lg font-semibold">Listado de facturas recibidas</CardTitle>
                <p className="text-sm text-muted-foreground">
                  {numberFormat(total)} facturas filtradas
                </p>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-6">
          {error ? (
            <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
              No se pudieron cargar las facturas recibidas.
            </div>
          ) : isLoading ? (
            <div className="flex h-80 items-center justify-center rounded-lg border border-border bg-background">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          ) : groups.length === 0 ? (
            <div className="flex h-80 flex-col items-center justify-center rounded-lg border border-dashed p-8 text-center">
              <FileText className="h-10 w-10 text-muted-foreground/60" />
              <p className="mt-2 text-sm font-medium">No hay facturas recibidas con estos filtros</p>
              <p className="text-xs text-muted-foreground">Ajusta la búsqueda o cambia los filtros de estado</p>
              <Button className="mt-4" variant="outline" onClick={() => void refetch()}>
                <RefreshCw className="h-4 w-4 mr-2" />
                Refrescar
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              {groups.map((group) => (
                <article key={group.key} className="w-full overflow-hidden rounded-lg border border-border/70 bg-card shadow-sm">
                  <div className="flex flex-col gap-2 border-b border-border/70 bg-muted/35 px-5 py-4 md:flex-row md:items-center md:justify-between">
                    <div className="min-w-0">
                      <div className="flex min-w-0 items-center gap-2">
                        <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                        <h2 className="truncate text-sm font-semibold">{group.title}</h2>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {group.archivoPdfId ? `PDF ${group.archivoPdfId}` : 'Sin PDF'} · {group.items.length} {group.items.length === 1 ? 'registro' : 'registros'}
                      </p>
                    </div>
                  </div>

                  <div className="divide-y divide-border/60">
                    {group.items.map((factura) => (
                      <button
                        key={factura.id}
                        type="button"
                        onClick={() => setSelectedId(factura.id)}
                        className="grid w-full gap-3 px-5 py-4 text-left transition-colors hover:bg-primary/5 md:grid-cols-[1.3fr_1fr_0.8fr_0.8fr_0.8fr_auto]"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold">
                            {factura.proveedor_nombre || `Proveedor ${factura.FRR_idproveedor ?? 'pendiente'}`}
                          </p>
                          <p className="mt-1 truncate text-xs text-muted-foreground">{factura.proveedor_nif || 'NIF pendiente'}</p>
                        </div>
                        <div>
                          <p className="text-xs font-medium uppercase text-muted-foreground">Factura</p>
                          <p className="mt-1 truncate text-sm">{factura.FRR_numerofactura || '-'}</p>
                        </div>
                        <div>
                          <p className="text-xs font-medium uppercase text-muted-foreground">Fecha</p>
                          <p className="mt-1 text-sm">{formatFacturaDate(factura.FRR_fechafactura)}</p>
                        </div>
                        <div>
                          <p className="text-xs font-medium uppercase text-muted-foreground">Total</p>
                          <p className="mt-1 text-sm font-semibold">{formatFacturaCurrency(factura.FRR_totalfac)}</p>
                        </div>
                        <div className="flex items-center">
                          <EstadoBadge estado={factura.estado} />
                        </div>
                        <div className="flex items-center justify-end">
                          <span className="inline-flex h-9 w-9 items-center justify-center rounded-md border bg-background text-muted-foreground">
                            <Eye className="h-4 w-4" />
                          </span>
                        </div>
                      </button>
                    ))}
                  </div>
                </article>
              ))}
            </div>
          )}
            {!error && !isLoading && (
              <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-4 mt-4 border-t">
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-muted-foreground">Mostrar</span>
                  <span className="inline-flex h-8 items-center rounded-md border bg-background px-2 text-sm">
                    {PAGE_SIZE}
                  </span>
                  <span className="text-muted-foreground">facturas de {numberFormat(total)}</span>
                  <span className="text-xs text-muted-foreground/70">
                    ({numberFormat(pageStart)}-{numberFormat(pageEnd)})
                  </span>
                  {isFetching && (
                    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      Cargando...
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-1">
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => setPage(1)}
                    disabled={isFetching || page <= 1}
                    className="h-8 w-8"
                    aria-label="Primera página"
                  >
                    <ChevronsLeft className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => setPage((current) => Math.max(1, current - 1))}
                    disabled={isFetching || page <= 1}
                    className="h-8 w-8"
                    aria-label="Página anterior"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>

                  <div className="flex items-center gap-1 px-2">
                    <span className="text-sm font-medium">{page}</span>
                    <span className="text-sm text-muted-foreground">/</span>
                    <span className="text-sm text-muted-foreground">{totalPages}</span>
                  </div>

                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
                    disabled={isFetching || page >= totalPages}
                    className="h-8 w-8"
                    aria-label="Página siguiente"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => setPage(totalPages)}
                    disabled={isFetching || page >= totalPages}
                    className="h-8 w-8"
                    aria-label="Última página"
                  >
                    <ChevronsRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {selectedId ? <FacturaDetailModal facturaId={selectedId} onClose={() => setSelectedId(null)} /> : null}
    </div>
  );
};

export default FacturasRecibidas;
