import { useEffect, useMemo, useRef, useState } from 'react';

import {
  fetchFacturaCuentasGastoHistoricas,
  type FacturaCuentaGastoHistorica,
  type FacturaProveedorERPKind,
} from '@/services/facturas';

type UseFacturaCuentasGastoHistoricasOptions = {
  empresaId: number | null | undefined;
  proveedorId: number | null | undefined;
  proveedorTipo: FacturaProveedorERPKind | null | undefined;
  enabled?: boolean;
  limit?: number;
};

type HistoricalAccountsState = {
  scope: string;
  items: FacturaCuentaGastoHistorica[];
  loading: boolean;
};

const positiveInteger = (value: number | null | undefined) => {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
};

export const useFacturaCuentasGastoHistoricas = ({
  empresaId,
  proveedorId,
  proveedorTipo,
  enabled = true,
  limit = 10,
}: UseFacturaCuentasGastoHistoricasOptions) => {
  const normalizedEmpresaId = positiveInteger(empresaId);
  const normalizedProveedorId = positiveInteger(proveedorId);
  const normalizedProveedorTipo =
    proveedorTipo === 'acreedor' || proveedorTipo === 'agricultor'
      ? proveedorTipo
      : null;
  const normalizedLimit = Math.min(Math.max(1, Math.trunc(limit)), 20);
  const requestRef = useRef(0);
  const scope = useMemo(
    () =>
      enabled &&
      normalizedEmpresaId &&
      normalizedProveedorId &&
      normalizedProveedorTipo
        ? [
            normalizedEmpresaId,
            normalizedProveedorId,
            normalizedProveedorTipo,
          ].join(':')
        : '',
    [
      enabled,
      normalizedEmpresaId,
      normalizedProveedorId,
      normalizedProveedorTipo,
    ],
  );
  const [state, setState] = useState<HistoricalAccountsState>({
    scope: '',
    items: [],
    loading: false,
  });

  useEffect(() => {
    const requestId = requestRef.current + 1;
    requestRef.current = requestId;
    let active = true;

    if (
      !scope ||
      !normalizedEmpresaId ||
      !normalizedProveedorId ||
      !normalizedProveedorTipo
    ) {
      setState({ scope, items: [], loading: false });
      return () => {
        active = false;
      };
    }

    setState({ scope, items: [], loading: true });
    void fetchFacturaCuentasGastoHistoricas({
      empresaId: normalizedEmpresaId,
      proveedorId: normalizedProveedorId,
      proveedorTipo: normalizedProveedorTipo,
      limit: normalizedLimit,
    })
      .then((items) => {
        if (!active || requestRef.current !== requestId) return;
        setState({ scope, items, loading: false });
      })
      .catch(() => {
        if (!active || requestRef.current !== requestId) return;
        // Es una ayuda opcional. Si el histórico falla, el buscador general de
        // cuentas sigue disponible y no se presenta como un error bloqueante.
        setState({ scope, items: [], loading: false });
      });

    return () => {
      active = false;
    };
  }, [
    normalizedEmpresaId,
    normalizedLimit,
    normalizedProveedorId,
    normalizedProveedorTipo,
    scope,
  ]);

  return {
    items: state.scope === scope ? state.items : [],
    loading: state.scope === scope && state.loading,
  };
};
