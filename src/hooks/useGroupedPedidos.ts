import { useMemo } from 'react';
import type { Pedido } from '@/types/pedidos';
import type { PedidoSortBy } from '@/types/pedidos';

export interface PedidoGroup {
  archivoPdfId: number | null;
  pedidos: Pedido[];
  totalPedidos: number;
  fechaMasReciente: string | null;
  clientesUnicos: Set<number>;
}

export const useGroupedPedidos = (
  pedidos: Pedido[],
  order: 'asc' | 'desc' = 'desc',
  sortBy: PedidoSortBy = 'business_date',
) => {
  const groupedPedidos = useMemo(() => {
    const getEmailArrivalValue = (p: Pedido) => {
      const candidates = [p.llegada_correo, p.created_at, p.fecha_carga, p.fecha_pedido, p.fecha];
      for (const c of candidates) {
        if (!c) continue;
        const t = Date.parse(c);
        if (!Number.isNaN(t)) return t;
      }
      return 0;
    };

    const getBusinessDateValue = (p: Pedido) => {
      const candidates = [p.fecha_carga, p.fecha_pedido, p.fecha, p.created_at];
      for (const c of candidates) {
        if (!c) continue;
        const t = Date.parse(c);
        if (!Number.isNaN(t)) return t;
      }
      return 0;
    };

    const getDateValue = (p: Pedido) => {
      return sortBy === 'email_arrival' ? getEmailArrivalValue(p) : getBusinessDateValue(p);
    };

    const getGroupReferenceDate = (p?: Pedido) => {
      if (!p) return null;
      return sortBy === 'email_arrival'
        ? p.llegada_correo ?? p.created_at ?? null
        : p.fecha_carga ?? p.fecha_pedido ?? p.fecha ?? null;
    };

    const getReferenceValue = (p: Pedido) =>
      (p.referencia_cliente ?? '').trim() || (p.referencia2_cliente ?? '').trim() || '';

    const compareByReference = (a: Pedido, b: Pedido) => {
      const refA = getReferenceValue(a);
      const refB = getReferenceValue(b);
      const cmp = refA.localeCompare(refB, 'es', {
        numeric: true,
        sensitivity: 'base',
      });
      if (cmp !== 0) return order === 'asc' ? cmp : -cmp;

      // Desempate final estable para evitar orden aleatorio visual.
      const idCmp = (a.id ?? 0) - (b.id ?? 0);
      return order === 'asc' ? idCmp : -idCmp;
    };

    // Agrupar por archivo_pdf_id
    const groups = new Map<number | null, Pedido[]>();
    
    pedidos.forEach((pedido) => {
      const key = pedido.archivo_pdf_id;
      if (!groups.has(key)) {
        groups.set(key, []);
      }
      groups.get(key)!.push(pedido);
    });

    // Convertir a array de grupos con metadata
    const groupsArray: PedidoGroup[] = Array.from(groups.entries()).map(([archivoPdfId, pedidosGrupo]) => {
      // Ordenar pedidos por fecha de carga primero.
      // En caso de empates o ausencia, usar fecha de pedido/creación como respaldo.
      const pedidosOrdenados = [...pedidosGrupo].sort((a, b) => {
        const ta = getDateValue(a);
        const tb = getDateValue(b);
        const cmp = ta - tb;
        if (cmp !== 0) return order === 'asc' ? cmp : -cmp;
        return compareByReference(a, b);
      });

      // Tomar la fecha de carga (o pedido, o creación) del primer elemento como referencia del grupo.
      const fechaMasReciente = getGroupReferenceDate(pedidosOrdenados[0]);

      // Obtener clientes únicos
      const clientesUnicos = new Set(pedidosOrdenados.map(p => p.clienteid).filter(Boolean));

      return {
        archivoPdfId,
        pedidos: pedidosOrdenados,
        totalPedidos: pedidosOrdenados.length,
        fechaMasReciente,
        clientesUnicos,
      };
    });

    // Ordenar grupos: primero los que tienen PDF (por fecha más reciente), luego los sin PDF
    return groupsArray.sort((a, b) => {
      // Grupos sin PDF van al final
      if (a.archivoPdfId === null && b.archivoPdfId !== null) return 1;
      if (a.archivoPdfId !== null && b.archivoPdfId === null) return -1;
      
      // Ordenar por fecha (prioriza fecha_carga en el primer pedido del grupo).
      const fechaA = getDateValue(a.pedidos[0] || ({} as Pedido));
      const fechaB = getDateValue(b.pedidos[0] || ({} as Pedido));
      const cmp = fechaA - fechaB;
      if (cmp !== 0) return order === 'asc' ? cmp : -cmp;
      return compareByReference(a.pedidos[0] || ({} as Pedido), b.pedidos[0] || ({} as Pedido));
    });
  }, [pedidos, order, sortBy]);

  const totalGroups = groupedPedidos.length;
  const totalPedidos = pedidos.length;
  const groupsWithPdf = groupedPedidos.filter(g => g.archivoPdfId !== null).length;
  const groupsWithoutPdf = groupedPedidos.filter(g => g.archivoPdfId === null).length;

  return {
    groupedPedidos,
    totalGroups,
    totalPedidos,
    groupsWithPdf,
    groupsWithoutPdf,
  };
};
