// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { PdfViewer } from './PdfViewer';

const { destroyLoadingTaskMock, getDocumentMock, getSessionMock } = vi.hoisted(() => ({
  destroyLoadingTaskMock: vi.fn(),
  getDocumentMock: vi.fn(),
  getSessionMock: vi.fn(),
}));

vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?worker&url', () => ({
  default: 'mock-pdf-worker.js',
}));

vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: {
    workerSrc: '',
  },
  getDocument: getDocumentMock,
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    auth: {
      getSession: getSessionMock,
    },
  },
}));

const originalCreateObjectUrl = URL.createObjectURL;
const originalRevokeObjectUrl = URL.revokeObjectURL;
const originalWindowOpen = window.open;

const createObjectUrlMock = vi.fn();
const revokeObjectUrlMock = vi.fn();
const windowOpenMock = vi.fn();

beforeAll(() => {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };

  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    value: createObjectUrlMock,
  });
  Object.defineProperty(URL, 'revokeObjectURL', {
    configurable: true,
    value: revokeObjectUrlMock,
  });
  Object.defineProperty(window, 'open', {
    configurable: true,
    value: windowOpenMock,
  });
});

afterAll(() => {
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    value: originalCreateObjectUrl,
  });
  Object.defineProperty(URL, 'revokeObjectURL', {
    configurable: true,
    value: originalRevokeObjectUrl,
  });
  Object.defineProperty(window, 'open', {
    configurable: true,
    value: originalWindowOpen,
  });
});

describe('PdfViewer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createObjectUrlMock.mockReturnValue('blob:factura-original');
    destroyLoadingTaskMock.mockResolvedValue(undefined);
    getSessionMock.mockResolvedValue({ data: { session: null } });
    getDocumentMock.mockImplementation(() => ({
      destroyed: false,
      destroy: destroyLoadingTaskMock,
      promise: Promise.reject(new Error('PDF dañado para pdf.js')),
    }));

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        blob: async () => ({
          arrayBuffer: async () => new Uint8Array([37, 80, 68, 70, 45, 49, 46, 55]).buffer,
        }),
      }),
    );
  });

  it('mantiene abrir y descargar disponibles si pdf.js no puede renderizar el archivo', async () => {
    const onError = vi.fn();
    const { unmount } = render(
      <PdfViewer
        url="https://storage.example/factura.pdf"
        fileName="factura-proveedor"
        appearance="purchase-invoice"
        showControls
        onError={onError}
      />,
    );

    expect(
      await screen.findByText(
        'No se pudo cargar la vista previa. Usa el botón de abrir PDF para ver el documento original.',
      ),
    ).toBeInTheDocument();

    const openButton = screen.getByRole('button', { name: 'Abrir PDF en pestaña nueva' });
    const downloadButton = screen.getByRole('button', { name: 'Descargar PDF' });
    expect(openButton).toBeEnabled();
    expect(downloadButton).toBeEnabled();

    fireEvent.click(openButton);
    expect(windowOpenMock).toHaveBeenCalledWith('blob:factura-original', '_blank', 'noopener,noreferrer');
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'PDF dañado para pdf.js' }));
    await waitFor(() => expect(destroyLoadingTaskMock).toHaveBeenCalledTimes(1));
    expect(revokeObjectUrlMock).not.toHaveBeenCalled();

    unmount();
    expect(revokeObjectUrlMock).toHaveBeenCalledOnce();
    expect(revokeObjectUrlMock).toHaveBeenCalledWith('blob:factura-original');
  });

  it('permite abrir el PDF validado aunque pdf.js siga cargando', async () => {
    getDocumentMock.mockImplementationOnce(() => ({
      destroyed: false,
      destroy: destroyLoadingTaskMock,
      promise: new Promise(() => undefined),
    }));

    const { unmount } = render(
      <PdfViewer
        url="https://storage.example/factura-lenta.pdf"
        appearance="purchase-invoice"
        showControls
      />,
    );

    const openButton = await screen.findByRole('button', {
      name: 'Abrir PDF en pestaña nueva',
    });
    await waitFor(() => expect(openButton).toBeEnabled());
    expect(screen.getByText('Cargando PDF...')).toBeInTheDocument();

    unmount();
    await waitFor(() => expect(destroyLoadingTaskMock).toHaveBeenCalledTimes(1));
  });

  it('rechaza una respuesta HTTP 200 que no contiene un PDF', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      blob: async () => ({
        arrayBuffer: async () =>
          new TextEncoder().encode('<html>sesion caducada</html>').buffer,
      }),
    } as Response);
    const onError = vi.fn();

    render(
      <PdfViewer
        url="https://storage.example/no-es-pdf"
        appearance="purchase-invoice"
        showControls
        onError={onError}
      />,
    );

    expect(
      await screen.findByText(
        'No se pudo cargar la vista previa. Usa el botón de abrir PDF para ver el documento original.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Abrir PDF en pestaña nueva' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Descargar PDF' })).toBeDisabled();
    expect(createObjectUrlMock).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'El archivo recibido no tiene una cabecera PDF valida.' }),
    );
  });
});
