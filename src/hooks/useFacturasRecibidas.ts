import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { facturasRecibidas, type FacturaRecibidaUpdatePayload } from '@/services/facturasRecibidas';
import type { FacturaRecibidaListFilters } from '@/types/facturasRecibidas';

export const FACTURAS_RECIBIDAS_QUERY_KEY = 'facturas-recibidas';

export const useFacturasRecibidas = (filters: FacturaRecibidaListFilters) =>
  useQuery({
    queryKey: [FACTURAS_RECIBIDAS_QUERY_KEY, 'list', filters],
    queryFn: () => facturasRecibidas.list(filters),
    staleTime: 60 * 1000,
  });

export const useFacturaRecibida = (facturaId: string | null) =>
  useQuery({
    queryKey: [FACTURAS_RECIBIDAS_QUERY_KEY, 'detail', facturaId],
    queryFn: async () => {
      if (!facturaId) return null;
      return facturasRecibidas.getById(facturaId);
    },
    enabled: Boolean(facturaId),
    staleTime: 30 * 1000,
  });

export const useFacturaRecibidaPdf = (archivoPdfId?: number | null) =>
  useQuery({
    queryKey: [FACTURAS_RECIBIDAS_QUERY_KEY, 'pdf', archivoPdfId],
    queryFn: async () => {
      if (!archivoPdfId) return null;
      return facturasRecibidas.getPdfBase64(archivoPdfId);
    },
    enabled: Boolean(archivoPdfId),
    staleTime: 10 * 60 * 1000,
  });

export const useFacturaRecibidaMutations = () => {
  const queryClient = useQueryClient();

  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: [FACTURAS_RECIBIDAS_QUERY_KEY] });
  };

  const update = useMutation({
    mutationFn: (payload: FacturaRecibidaUpdatePayload) => facturasRecibidas.update(payload),
    onSuccess: invalidate,
  });

  const validateERP = useMutation({
    mutationFn: (facturaId: string) => facturasRecibidas.validateERP(facturaId),
    onSuccess: invalidate,
  });

  const commitERP = useMutation({
    mutationFn: (facturaId: string) => facturasRecibidas.commitERP(facturaId),
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: (facturaId: string) => facturasRecibidas.delete(facturaId),
    onSuccess: invalidate,
  });

  return { update, validateERP, commitERP, remove };
};
