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
  code: 'importe_total_no_cuadra',
  field: 'FRR_totalfac',
  message: 'El total de la factura no coincide con sus desgloses.',
  severity: 'error',
  details: null,
};

const duplicateIssue: FacturaValidationIssue = {
  code: 'duplicate_invoice',
  field: 'erp_duplicate',
  message: 'La factura ya existe en ERP como entrada 49305 (número ERP 5052).',
  severity: 'error',
  details: { candidates: [{ FRR_id: 49305, FRR_numero: 5052 }] },
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
    expect(screen.getByText(blockingIssue.message)).toBeInTheDocument();
    expect(screen.queryByText(/webhook/i)).not.toBeInTheDocument();
    expect(screen.getByText(/servicio de envío al ERP/i)).toBeInTheDocument();
  });

  it('nunca presenta una factura ya registrada como alerta roja', () => {
    const { container, rerender } = render(
      <FacturaIssuesOverlay errors={[duplicateIssue]} warnings={[]} />,
    );

    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    rerender(
      <FacturaIssuesOverlay
        errors={[duplicateIssue, blockingIssue]}
        warnings={[]}
      />,
    );

    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(screen.getByText(blockingIssue.message)).toBeInTheDocument();
    expect(screen.queryByText(/factura ya registrada/i)).not.toBeInTheDocument();
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
