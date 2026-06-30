import { useEffect, useState } from 'react';
import { ExternalLink, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { salesAccounts, type SalesAccountPdfInfo } from '@/services/salesAccounts';
import { agroirisPdfFiles } from '@/services/agroirisPdfFiles';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { cn } from '@/lib/utils';

interface SalesAccountPdfSharedInfoProps {
  archivoPdfId: number;
  currentAccountId: number;
  currentClienteId: number | null;
  onAccountClick?: (accountId: number) => void;
  className?: string;
}

const formatAccountDate = (account: SalesAccountPdfInfo) => {
  const value = account.fechavaloracion || account.created_at;
  if (!value) return '—';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '—';
  return format(parsed, "dd 'de' MMMM, yyyy", { locale: es });
};

const currencyFormat = (value: number) =>
  new Intl.NumberFormat('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value ?? 0);

export function SalesAccountPdfSharedInfo({
  archivoPdfId,
  currentAccountId,
  currentClienteId,
  onAccountClick,
  className,
}: SalesAccountPdfSharedInfoProps) {
  const [relatedAccounts, setRelatedAccounts] = useState<SalesAccountPdfInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [tamanioKB, setTamanioKB] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;

    const loadData = async () => {
      try {
        setLoading(true);

        const [accounts, archivo] = await Promise.all([
          salesAccounts.getAccountsByPdfId(archivoPdfId, currentClienteId),
          agroirisPdfFiles.getPdfById(archivoPdfId),
        ]);

        if (cancelled) return;

        const others = accounts.filter((account) => account.account_id !== currentAccountId);
        setRelatedAccounts(others);
        setTamanioKB(
          archivo && typeof archivo.tamanio_bytes === 'number'
            ? Math.round(archivo.tamanio_bytes / 1024)
            : null,
        );
      } catch (error) {
        console.error('Error cargando cuentas relacionadas por PDF:', error);
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void loadData();

    return () => {
      cancelled = true;
    };
  }, [archivoPdfId, currentAccountId, currentClienteId]);

  const totalAccounts = relatedAccounts.length + 1;
  if (totalAccounts === 1) return null;

  return (
    <Card className={cn('flex flex-col overflow-hidden border-primary/20 bg-background', className)}>
      <CardHeader className="shrink-0 pb-3">
        <div className="flex items-center gap-2">
          <Users className="h-5 w-5 text-primary" />
          <CardTitle className="text-base">PDF Compartido</CardTitle>
        </div>
        <CardDescription className="text-xs">
          Este PDF está vinculado a {totalAccounts} cuentas.
          {tamanioKB !== null && ` Tamaño: ${tamanioKB} KB`}
        </CardDescription>
      </CardHeader>

      {!loading && relatedAccounts.length > 0 && (
        <>
          <Separator className="shrink-0" />
          <CardContent className="mx-1 mb-1 min-h-0 flex-1 overflow-y-auto overscroll-contain rounded-b-md px-5 pb-5 pt-4">
            <div className="space-y-2">
              <p className="text-sm font-medium text-muted-foreground mb-2">Otras cuentas con este PDF:</p>
              <div className="space-y-2">
                {relatedAccounts.map((account) => {
                  const accountLabel = account.numero_cuentaventa?.trim() || `#${account.account_id}`;
                  return (
                    <div
                      key={account.account_id}
                      className="flex items-center justify-between p-2 rounded-md border bg-card hover:bg-accent transition-colors"
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{accountLabel}</p>
                        <p className="text-xs text-muted-foreground">{formatAccountDate(account)}</p>
                        <p className="text-xs text-muted-foreground">Total: {currencyFormat(account.total_cuentaventa)} €</p>
                        {account.idcuentaventa_orizon && (
                          <p className="text-xs text-muted-foreground">Orizon: {account.idcuentaventa_orizon}</p>
                        )}
                      </div>
                      {onAccountClick && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => onAccountClick(account.account_id)}
                          className="ml-2"
                        >
                          <ExternalLink className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </CardContent>
        </>
      )}

      {loading && (
        <CardContent className="pt-4">
          <div className="flex items-center justify-center py-4">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary" />
          </div>
        </CardContent>
      )}
    </Card>
  );
}
