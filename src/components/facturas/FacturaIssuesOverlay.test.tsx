// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { FacturaValidationIssue } from '@/services/apiContracts';

import { FacturaIssuesOverlay } from './FacturaIssuesOverlay';

afterEach(() => {
  cleanup();
});

const blockingIssue: FacturaValidationIssue = {
  code: null,
  field: 'erp_duplicate',
  message: 'La factura ya existe en ERP como entrada 49305 (número ERP 5052); este borrador no puede enviarse de nuevo.',
  severity: 'error',
  details: {
    total: 1,
    candidates: [{ FRR_id: 49305, FRR_numero: 5052 }],
  },
};

const warningIssue: FacturaValidationIssue = {
  code: 'review_note',
  field: 'observaciones',
  message: 'Revisa la anotación manuscrita.',
  severity: 'warning',
};

describe('FacturaIssuesOverlay', () => {
  it('no ocupa espacio cuando no hay incidencias', () => {
    const { container } = render(<FacturaIssuesOverlay errors={[]} warnings={[]} />);

    expect(container).toBeEmptyDOMElement();
  });

  it('muestra los errores abajo a la derecha y los anima desde la derecha', () => {
    render(
      <FacturaIssuesOverlay
        actionError="No se pudo guardar la factura."
        erpError={'The requested webhook "POST internal-write" is not registered.'}
        errors={[blockingIssue]}
        warnings={[warningIssue]}
        duplicateCandidate={{
          frrId: 49305,
          empresaId: 1,
          ejercicio: 25,
          proveedorId: 17,
          numeroFactura: 'A-00748886',
          numero: 5052,
          proveedor: 'ONDUSPAN, S.A',
          fecha: '2026-06-30',
          total: 51_233.24,
        }}
      />,
    );

    const overlay = screen.getByTestId('factura-issues-overlay');
    expect(overlay).toHaveClass('fixed', 'z-30', 'overflow-y-auto');
    expect(overlay.className).toContain('bottom-[max(0.75rem,env(safe-area-inset-bottom))]');
    expect(overlay.className).toContain('sm:right-[max(1.25rem,env(safe-area-inset-right))]');
    expect(overlay).toHaveAttribute('tabindex', '0');

    expect(screen.getAllByRole('alert')).toHaveLength(3);
    expect(screen.getByText('No se pudo completar la acción')).toBeInTheDocument();
    expect(screen.getByText('Error').closest('section')).toHaveClass(
      'slide-in-from-right-full',
      'motion-reduce:animate-none',
    );
    expect(screen.getByText('Avisos de revisión')).toBeInTheDocument();
    expect(screen.getByText('Factura ya registrada (5052)')).toBeInTheDocument();
    expect(screen.getByText('Factura ya registrada (5052)').tagName).toBe('P');
    expect(screen.getByText('Factura ya registrada (5052)').closest('li')).toBeNull();
    expect(screen.queryByText(/este borrador no puede enviarse de nuevo/i)).not.toBeInTheDocument();
    expect(screen.getByText(/FRR_id 49305/)).toBeInTheDocument();
    expect(screen.queryByText(/webhook/i)).not.toBeInTheDocument();
    expect(screen.getByText(/servicio de envío al ERP/i)).toBeInTheDocument();
  });

  it('mantiene el reintento de catálogos dentro del aviso flotante', () => {
    const onRetryCatalog = vi.fn();
    const { rerender } = render(
      <FacturaIssuesOverlay
        errors={[]}
        warnings={[]}
        catalogError="La consulta a Netagro ha tardado demasiado."
        catalogErrorTitle="Catálogos ERP no disponibles"
        onRetryCatalog={onRetryCatalog}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(onRetryCatalog).toHaveBeenCalledTimes(1);

    rerender(
      <FacturaIssuesOverlay
        errors={[]}
        warnings={[]}
        catalogError="La consulta a Netagro ha tardado demasiado."
        catalogLoading
        onRetryCatalog={onRetryCatalog}
      />,
    );

    expect(screen.getByRole('button', { name: 'Reintentando...' })).toBeDisabled();
  });
});
