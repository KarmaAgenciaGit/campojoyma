import { useCallback, useRef, useState, type ReactNode } from 'react';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

/**
 * Confirmacion en AlertDialog con la misma ergonomia que `window.confirm`.
 *
 * Motivo del cambio: `window.confirm` es sincrono pero el navegador puede ofrecer
 * "impedir que esta pagina cree mas dialogos". A partir de ese momento devuelve
 * `false` en silencio, y un `false` interpretado como "cancelar" deja al usuario sin
 * poder completar la accion y sin ningun aviso. Con un dialogo propio eso no ocurre.
 *
 * Uso:
 *
 * ```tsx
 * const { confirmar, dialogo } = useConfirmacion();
 * // ...
 * if (!(await confirmar({ titulo: '...', descripcion: '...' }))) return;
 * // y renderizar {dialogo} una vez en el arbol
 * ```
 */

export type ConfirmacionOpciones = {
  titulo: string;
  descripcion: ReactNode;
  /** Texto del boton que confirma. */
  aceptar?: string;
  /** Texto del boton que cancela. */
  cancelar?: string;
  /** Marca en rojo la accion cuando es destructiva. */
  destructivo?: boolean;
};

type EstadoConfirmacion = ConfirmacionOpciones & { abierto: boolean };

const ESTADO_INICIAL: EstadoConfirmacion = {
  abierto: false,
  titulo: '',
  descripcion: null,
};

export const useConfirmacion = () => {
  const [estado, setEstado] = useState<EstadoConfirmacion>(ESTADO_INICIAL);
  // Se resuelve al pulsar un boton o al cerrar el dialogo por fuera.
  const resolverRef = useRef<((valor: boolean) => void) | null>(null);

  const cerrar = useCallback((valor: boolean) => {
    setEstado((current) => ({ ...current, abierto: false }));
    const resolver = resolverRef.current;
    resolverRef.current = null;
    resolver?.(valor);
  }, []);

  const confirmar = useCallback((opciones: ConfirmacionOpciones) => {
    // Si quedaba una confirmacion abierta se cancela para no dejar promesas colgadas.
    resolverRef.current?.(false);
    resolverRef.current = null;
    setEstado({ ...opciones, abierto: true });
    return new Promise<boolean>((resolve) => {
      resolverRef.current = resolve;
    });
  }, []);

  const dialogo = (
    <AlertDialog
      open={estado.abierto}
      onOpenChange={(abierto) => {
        if (!abierto) cerrar(false);
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{estado.titulo}</AlertDialogTitle>
          <AlertDialogDescription>{estado.descripcion}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => cerrar(false)}>
            {estado.cancelar ?? 'Cancelar'}
          </AlertDialogCancel>
          <AlertDialogAction
            className={
              estado.destructivo
                ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90'
                : undefined
            }
            onClick={() => cerrar(true)}
          >
            {estado.aceptar ?? 'Aceptar'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  return { confirmar, dialogo };
};
