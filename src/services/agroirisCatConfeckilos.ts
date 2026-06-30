import { agroirisAuth } from './agroirisAuth';
import { normalizeApiNumber } from '@/utils/number';

export interface CatConfeckilosOption {
  catconfeckilosbultoid: number;
  catalogoconfecid: number;
  kilosxbulto: number | null;
}

interface CatConfeckilosRaw extends CatConfeckilosOption {
  activo?: boolean | string | number;
}

const isActiveFlag = (value: CatConfeckilosRaw['activo']): boolean => {
  if (value === undefined || value === null) return true;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  const normalized = String(value).toLowerCase();
  return normalized === 'true' || normalized === '1' || normalized === 'si';
};

class AgroirisCatConfeckilosService {
  private cache = new Map<number, CatConfeckilosOption[]>();

  private normalizeResponse(
    data: CatConfeckilosRaw | CatConfeckilosRaw[] | null
  ): CatConfeckilosOption[] {
    const list = Array.isArray(data) ? data : data ? [data] : [];
    return list
      .filter((item) => isActiveFlag(item.activo))
      .map((item) => ({
        catconfeckilosbultoid: item.catconfeckilosbultoid,
        catalogoconfecid: item.catalogoconfecid,
        kilosxbulto: normalizeApiNumber(item.kilosxbulto),
      }))
      .sort((a, b) => {
        const aValue = a.kilosxbulto ?? Number.MAX_SAFE_INTEGER;
        const bValue = b.kilosxbulto ?? Number.MAX_SAFE_INTEGER;
        return aValue - bValue;
      });
  }

  async getByCatalogo(catalogoconfecid: number): Promise<CatConfeckilosOption[]> {
    if (this.cache.has(catalogoconfecid)) {
      return this.cache.get(catalogoconfecid)!;
    }

    try {
      const response = await agroirisAuth.authenticatedFetch<
        CatConfeckilosRaw | CatConfeckilosRaw[] | null
      >(`/catconfeckilosbulto/catalogoconfecid/${catalogoconfecid}`);

      const normalized = this.normalizeResponse(response);
      this.cache.set(catalogoconfecid, normalized);
      return normalized;
    } catch (error) {
      console.error(
        `Error obteniendo catconfeckilosbulto para catálogo ${catalogoconfecid}:`,
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

export const agroirisCatConfeckilos = new AgroirisCatConfeckilosService();
