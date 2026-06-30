import { useState } from 'react';
import type { PedidoFilters } from '@/types/pedidos';

export const usePedidoFilters = (initialItemsPerPage: number = 10) => {
  const [filters, setFilters] = useState<PedidoFilters>({
    referencia: '',
    clienteId: undefined,
    domicilioDestinoId: undefined,
    fechaPedidoRango: {
      from: '',
      to: '',
    },
    fechaCargaDesde: '',
    fechaCargaHasta: '',
    fechaCargaRango: {
      from: '',
      to: '',
    },
    estado: undefined,
    ceoxStatus: 'all',
    tieneMatricula: false,
    tieneCambio: false,
    tienePrevision: false,
    sortBy: 'business_date',
    order: 'desc',
  });

  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPageState] = useState(initialItemsPerPage);

  const updateFilter = <K extends keyof PedidoFilters>(key: K, value: PedidoFilters[K]) => {
    setFilters((prev) => {
      const next = { ...prev, [key]: value };
      if (key === 'clienteId') {
        next.domicilioDestinoId = undefined;
      }
      return next;
    });
    setCurrentPage(1);
  };

  const clearFilters = () => {
    setFilters({
      referencia: '',
      clienteId: undefined,
      domicilioDestinoId: undefined,
      fechaPedidoRango: {
        from: '',
        to: '',
      },
      fechaCargaDesde: '',
      fechaCargaHasta: '',
      fechaCargaRango: {
        from: '',
        to: '',
      },
      estado: undefined,
      ceoxStatus: 'all',
      tieneMatricula: false,
      tieneCambio: false,
      tienePrevision: false,
      sortBy: 'business_date',
      order: 'desc',
    });
    setCurrentPage(1);
  };

  const setItemsPerPage = (value: number) => {
    setItemsPerPageState(value);
    setCurrentPage(1);
  };

  return {
    filters,
    updateFilter,
    clearFilters,
    currentPage,
    setCurrentPage,
    itemsPerPage,
    setItemsPerPage,
  };
};
