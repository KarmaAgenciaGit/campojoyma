import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronsUpDown, FileText, Loader2, Send, Trash2, Upload } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { ClientCombobox } from '@/components/ClientCombobox';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { agroirisClients, type AgroIrisClient } from '@/services/agroirisClients';
import { agroirisDomicilios, type SujetoDomicilio } from '@/services/agroirisDomicilios';
import { agroirisClientePlataformas } from '@/services/agroirisClientePlataformas';
import {
  ManualPedidoWebhookError,
  getManualPedidoMaxPdfBytes,
  sendManualPedidoToWebhook,
  validatePdfFile,
} from '@/services/manualPedidoWebhook';

interface ManualPedidoDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void | Promise<void>;
  allowedClientIds?: Iterable<number> | null;
}

type DomicilioOption = SujetoDomicilio & {
  plataformaLabel: string;
};

const formatFileSize = (bytes: number) => {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
};

const buildClientDisplay = (client: AgroIrisClient | null) => {
  if (!client) return '';
  const nombre = client.nombre_sujeto?.trim() || client.nombre_comercial?.trim() || 'Cliente';
  return `${nombre} (${client.clienteid})`;
};

const buildDomicilioDisplay = (domicilio: DomicilioOption | null) => {
  if (!domicilio) return '';
  const nombre = domicilio.nombre_identificador_domicilio_sujeto?.trim() || `Domicilio #${domicilio.sujetodomicilioid}`;
  const poblacion = domicilio.poblacion_domicilio_sujeto?.trim();
  return poblacion ? `${nombre} · ${poblacion}` : nombre;
};

export function ManualPedidoDialog({
  open,
  onOpenChange,
  onSuccess,
  allowedClientIds = null,
}: ManualPedidoDialogProps) {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const maxPdfBytes = getManualPedidoMaxPdfBytes();
  const maxPdfMb = Math.ceil(maxPdfBytes / (1024 * 1024));

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [draggingFile, setDraggingFile] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [selectedClientId, setSelectedClientId] = useState<number | null>(null);
  const [selectedClient, setSelectedClient] = useState<AgroIrisClient | null>(null);
  const [clientLoading, setClientLoading] = useState(false);

  const [domiciliosLoading, setDomiciliosLoading] = useState(false);
  const [domicilioOptions, setDomicilioOptions] = useState<DomicilioOption[]>([]);
  const [selectedDomicilioId, setSelectedDomicilioId] = useState<number | null>(null);
  const [domicilioPopoverOpen, setDomicilioPopoverOpen] = useState(false);
  const [domicilioSearch, setDomicilioSearch] = useState('');

  const selectedDomicilio = useMemo(
    () => domicilioOptions.find((dom) => dom.sujetodomicilioid === selectedDomicilioId) ?? null,
    [domicilioOptions, selectedDomicilioId],
  );

  const selectedClientDisplay = useMemo(() => buildClientDisplay(selectedClient), [selectedClient]);
  const selectedDomicilioDisplay = useMemo(
    () => buildDomicilioDisplay(selectedDomicilio),
    [selectedDomicilio],
  );
  const allowedClientCount = useMemo(() => {
    if (!allowedClientIds) return null;
    return allowedClientIds instanceof Set ? allowedClientIds.size : Array.from(allowedClientIds).length;
  }, [allowedClientIds]);

  const filteredDomicilios = useMemo(() => {
    if (!domicilioSearch.trim()) return domicilioOptions;
    const search = domicilioSearch.toLowerCase().trim();
    return domicilioOptions.filter((domicilio) => {
      const text = [
        domicilio.nombre_identificador_domicilio_sujeto,
        domicilio.poblacion_domicilio_sujeto,
        domicilio.provincia_domicilio_sujeto,
        domicilio.domicilio_sujeto,
        domicilio.plataformaLabel,
        String(domicilio.sujetodomicilioid),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return text.includes(search);
    });
  }, [domicilioOptions, domicilioSearch]);

  const resetForm = useCallback(() => {
    setSelectedFile(null);
    setDraggingFile(false);
    setSelectedClientId(null);
    setSelectedClient(null);
    setClientLoading(false);
    setDomiciliosLoading(false);
    setDomicilioOptions([]);
    setSelectedDomicilioId(null);
    setDomicilioPopoverOpen(false);
    setDomicilioSearch('');
  }, []);

  useEffect(() => {
    if (!open) resetForm();
  }, [open, resetForm]);

  useEffect(() => {
    let cancelled = false;

    const loadClient = async () => {
      if (!selectedClientId) {
        setSelectedClient(null);
        setDomicilioOptions([]);
        setSelectedDomicilioId(null);
        return;
      }

      try {
        setClientLoading(true);
        const client = await agroirisClients.getClientById(selectedClientId);
        if (!cancelled) {
          setSelectedClient(client);
          setSelectedDomicilioId(null);
        }
      } catch (error) {
        console.error('Error cargando cliente del envio manual:', error);
        if (!cancelled) {
          setSelectedClient(null);
          setSelectedDomicilioId(null);
          toast({
            title: 'No se pudo cargar el cliente',
            description: 'Inténtalo nuevamente.',
            variant: 'destructive',
          });
        }
      } finally {
        if (!cancelled) setClientLoading(false);
      }
    };

    void loadClient();
    return () => {
      cancelled = true;
    };
  }, [selectedClientId, toast]);

  useEffect(() => {
    let cancelled = false;

    const loadDomicilios = async () => {
      if (!selectedClient?.sujetoid) {
        setDomicilioOptions([]);
        setSelectedDomicilioId(null);
        return;
      }

      try {
        setDomiciliosLoading(true);
        setDomicilioOptions([]);
        const domicilios = await agroirisDomicilios.getDomiciliosBySujetoId(selectedClient.sujetoid);

        const plataformaIds = Array.from(
          new Set(
            domicilios
              .map((domicilio) => domicilio.clienteplataformaid)
              .filter((id) => Number.isFinite(id) && id > 0),
          ),
        );

        const plataformas = await Promise.all(
          plataformaIds.map(async (plataformaId) => {
            const plataforma = await agroirisClientePlataformas.getPlataformaById(plataformaId);
            return [plataformaId, plataforma] as const;
          }),
        );

        const plataformasMap = new Map(plataformas);
        const mapped: DomicilioOption[] = domicilios.map((domicilio) => {
          const plataforma = plataformasMap.get(domicilio.clienteplataformaid);
          const plataformaLabel =
            plataforma?.nombre_plataforma?.trim() ||
            plataforma?.descripcion?.trim() ||
            'Sin plataforma';
          return {
            ...domicilio,
            plataformaLabel,
          };
        });

        if (!cancelled) {
          setDomicilioOptions(mapped);
        }
      } catch (error) {
        console.error('Error cargando domicilios para envio manual:', error);
        if (!cancelled) {
          setDomicilioOptions([]);
          setSelectedDomicilioId(null);
          toast({
            title: 'No se pudieron cargar los domicilios',
            description: 'Inténtalo nuevamente.',
            variant: 'destructive',
          });
        }
      } finally {
        if (!cancelled) setDomiciliosLoading(false);
      }
    };

    void loadDomicilios();
    return () => {
      cancelled = true;
    };
  }, [selectedClient, toast]);

  const handleSelectFile = (file: File | null) => {
    if (!file) return;
    try {
      validatePdfFile(file);
      setSelectedFile(file);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudo cargar el PDF.';
      toast({
        title: 'Archivo no válido',
        description: message,
        variant: 'destructive',
      });
    }
  };

  const handleFileInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    handleSelectFile(file);
    if (event.currentTarget) {
      event.currentTarget.value = '';
    }
  };

  const handleClientChange = (value: number | null) => {
    setSelectedClientId(value);
    setSelectedClient(null);
    setDomicilioOptions([]);
    setSelectedDomicilioId(null);
    setDomicilioSearch('');
  };

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setDraggingFile(false);
    const file = event.dataTransfer.files?.[0] ?? null;
    handleSelectFile(file);
  };

  const canSubmit = Boolean(selectedFile && selectedClient && selectedDomicilio) && !submitting;

  const handleSubmit = async () => {
    if (!selectedFile || !selectedClient || !selectedDomicilio) {
      toast({
        title: 'Faltan datos obligatorios',
        description: 'Debes seleccionar PDF, cliente y domicilio.',
        variant: 'destructive',
      });
      return;
    }

    try {
      setSubmitting(true);
      await sendManualPedidoToWebhook({
        file: selectedFile,
        client: selectedClient,
        domicilio: selectedDomicilio,
      });

      toast({
        title: 'Pedido enviado',
        description: 'El pedido manual se envió correctamente al webhook.',
      });

      await onSuccess?.();
      onOpenChange(false);
    } catch (error) {
      const webhookError = error as ManualPedidoWebhookError;
      const status = webhookError?.status;

      let description = webhookError?.message || 'No se pudo enviar el pedido.';
      if (status === 401) description = 'Token inválido o sesión expirada.';
      if (status === 403) description = 'No autorizado para enviar pedidos.';
      if (status === 422) description = 'El payload enviado no es válido.';
      if (status === 500) description = 'Error interno del servidor al procesar el pedido.';

      toast({
        title: 'Error al enviar pedido',
        description,
        variant: 'destructive',
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Send className="h-4 w-4" />
            Enviar pedido
          </DialogTitle>
          <DialogDescription>
            Sube un PDF y selecciona el cliente y el domicilio de destino para enviarlo al flujo AGROIRIS.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>PDF</Label>
              <Badge variant="outline">Obligatorio · Máx {maxPdfMb}MB</Badge>
            </div>

            <Card
              className={cn(
                'border-dashed transition-colors',
                draggingFile ? 'border-primary bg-primary/5' : 'border-border',
              )}
            >
              <CardContent
                className="p-5"
                onDragEnter={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  setDraggingFile(true);
                }}
                onDragOver={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  setDraggingFile(true);
                }}
                onDragLeave={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  setDraggingFile(false);
                }}
                onDrop={handleDrop}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  className="hidden"
                  accept="application/pdf,.pdf"
                  onChange={handleFileInputChange}
                />

                {!selectedFile ? (
                  <div className="text-center space-y-3">
                    <Upload className="mx-auto h-8 w-8 text-muted-foreground" />
                    <div className="space-y-1">
                      <p className="text-sm font-medium">Arrastra aquí el PDF o selecciónalo</p>
                      <p className="text-xs text-muted-foreground">Solo archivos PDF</p>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={submitting}
                    >
                      Seleccionar PDF
                    </Button>
                  </div>
                ) : (
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0 flex items-center gap-3">
                      <FileText className="h-8 w-8 text-primary" />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{selectedFile.name}</p>
                        <p className="text-xs text-muted-foreground">{formatFileSize(selectedFile.size)}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={submitting}
                      >
                        Cambiar
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setSelectedFile(null)}
                        disabled={submitting}
                      >
                        <Trash2 className="h-4 w-4 mr-1" />
                        Eliminar
                      </Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <div className="space-y-2">
            <Label>Cliente</Label>
            <ClientCombobox
              value={selectedClientId}
              onChange={handleClientChange}
              allowedClientIds={allowedClientIds}
              className="h-10"
              disabled={submitting || allowedClientCount === 0}
              placeholder="Selecciona un cliente"
            />
            {allowedClientCount === 0 && (
              <p className="text-xs text-muted-foreground">
                No hay clientes habilitados para inserción manual. Configúralos en Administración.
              </p>
            )}
            {clientLoading && (
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Cargando cliente...
              </p>
            )}
            {selectedClientDisplay && (
              <p className="text-xs text-muted-foreground">{selectedClientDisplay}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label>Domicilio</Label>
            <Popover open={domicilioPopoverOpen} onOpenChange={setDomicilioPopoverOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  role="combobox"
                  aria-expanded={domicilioPopoverOpen}
                  disabled={submitting || !selectedClientId || domiciliosLoading}
                  className="h-10 w-full justify-between"
                >
                  {domiciliosLoading ? (
                    <span className="inline-flex items-center gap-2 text-sm">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Cargando domicilios...
                    </span>
                  ) : selectedDomicilio ? (
                    <span className="truncate text-left">{selectedDomicilioDisplay}</span>
                  ) : selectedClientId ? (
                    <span className="text-muted-foreground">Selecciona un domicilio</span>
                  ) : (
                    <span className="text-muted-foreground">Selecciona un cliente primero</span>
                  )}
                  <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[min(460px,calc(100vw-3rem))] p-0" align="start">
                <Command shouldFilter={false}>
                  <CommandInput
                    value={domicilioSearch}
                    onValueChange={setDomicilioSearch}
                    placeholder="Buscar por nombre, población o plataforma..."
                  />
                  <CommandList>
                    {filteredDomicilios.length === 0 ? (
                      <CommandEmpty>No se encontraron domicilios.</CommandEmpty>
                    ) : (
                      <CommandGroup>
                        {filteredDomicilios.map((domicilio) => {
                          const selected = domicilio.sujetodomicilioid === selectedDomicilioId;
                          return (
                            <CommandItem
                              key={domicilio.sujetodomicilioid}
                              value={String(domicilio.sujetodomicilioid)}
                              onSelect={() => {
                                setSelectedDomicilioId(domicilio.sujetodomicilioid);
                                setDomicilioPopoverOpen(false);
                                setDomicilioSearch('');
                              }}
                            >
                              <Check className={cn('mr-2 h-4 w-4', selected ? 'opacity-100' : 'opacity-0')} />
                              <div className="flex min-w-0 flex-1 items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <p className="truncate text-sm font-medium">
                                    {domicilio.nombre_identificador_domicilio_sujeto || `Domicilio #${domicilio.sujetodomicilioid}`}
                                  </p>
                                  <p className="truncate text-xs text-muted-foreground">
                                    {domicilio.poblacion_domicilio_sujeto || 'Sin población'} · ID {domicilio.sujetodomicilioid}
                                  </p>
                                </div>
                                <Badge variant="secondary" className="shrink-0">
                                  {domicilio.plataformaLabel}
                                </Badge>
                              </div>
                            </CommandItem>
                          );
                        })}
                      </CommandGroup>
                    )}
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
            {selectedDomicilio && (
              <p className="text-xs text-muted-foreground">
                {selectedDomicilio.domicilio_sujeto || 'Sin dirección'} · {selectedDomicilio.cp_domicilio_sujeto || 'Sin CP'}
              </p>
            )}
          </div>

          <div className="flex items-center justify-end gap-3 pt-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
              Cancelar
            </Button>
            <Button type="button" onClick={handleSubmit} disabled={!canSubmit}>
              {submitting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Enviando...
                </>
              ) : (
                <>
                  <Send className="h-4 w-4 mr-2" />
                  Enviar pedido
                </>
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
