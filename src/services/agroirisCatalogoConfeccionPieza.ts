import { agroirisAuth } from './agroirisAuth';
import { normalizeApiNumber } from '@/utils/number';

export interface CatalogoConfeccionPiezaOption {
  catalogoconfeccionpiezaid: number;
  catalogoconfecid: number;
  nro_piezas: number | null;
}

interface CatalogoConfeccionPiezaRaw extends CatalogoConfeccionPiezaOption {
  activo?: boolean | string | number;
}

const isActiveFlag = (value: CatalogoConfeccionPiezaRaw['activo']): boolean => {
  if (value === undefined || value === null) return true;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  const normalized = String(value).toLowerCase();
  return normalized === 'true' || normalized === '1' || normalized === 'si';
};

class AgroirisCatalogoConfeccionPiezaService {
  private cache = new Map<number, CatalogoConfeccionPiezaOption[]>();

  private normalizeResponse(
    data: CatalogoConfeccionPiezaRaw | CatalogoConfeccionPiezaRaw[] | null
  ): CatalogoConfeccionPiezaOption[] {
    const list = Array.isArray(data) ? data : data ? [data] : [];
    return list
      .filter((item) => isActiveFlag(item.activo))
      .map((item) => ({
        catalogoconfeccionpiezaid: item.catalogoconfeccionpiezaid,
        catalogoconfecid: item.catalogoconfecid,
        nro_piezas: normalizeApiNumber(item.nro_piezas),
      }))
      .sort((a, b) => {
        const aValue = a.nro_piezas ?? Number.MAX_SAFE_INTEGER;
        const bValue = b.nro_piezas ?? Number.MAX_SAFE_INTEGER;
        return aValue - bValue;
      });
  }

  async getByCatalogo(catalogoconfecid: number): Promise<CatalogoConfeccionPiezaOption[]> {
    if (this.cache.has(catalogoconfecid)) {
      return this.cache.get(catalogoconfecid)!;
    }

    try {
      const response = await agroirisAuth.authenticatedFetch<
        CatalogoConfeccionPiezaRaw | CatalogoConfeccionPiezaRaw[] | null
      >(`/catalogoconfeccionpieza/catalogoconfecid/${catalogoconfecid}`);

      const normalized = this.normalizeResponse(response);
      this.cache.set(catalogoconfecid, normalized);
      return normalized;
    } catch (error) {
      console.error(
        `Error obteniendo catalogoconfeccionpieza para catálogo ${catalogoconfecid}:`,
        error
      );
      this.cache.set(catalogoconfecid, []);
      return [];
    }
  }

  clearCache() {
    this.cache.clear();
  }
}

export const agroirisCatalogoConfeccionPieza =
  new AgroirisCatalogoConfeccionPiezaService();
