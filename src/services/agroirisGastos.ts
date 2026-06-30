import { agroirisAuth } from './agroirisAuth';

export interface AgroirisGasto {
  gastoid: number;
  nombre_gasto: string;
  tags_gasto?: string;
  porcentajeajid?: number;
  valor_gasto?: number;
  [key: string]: any;
}

const CACHE_KEY = 'agroiris_gasto_cache';
const CACHE_DURATION = 30 * 60 * 1000; // 30 min

interface GastoCache {
  data: Record<number, AgroirisGasto>;
  timestamp: number;
  /**
   * Indica si `data` proviene de `listGastos()` (lista completa) y no de cargas parciales por ID.
   * Evita que un `getGasto()` previo "congele" una cache parcial (o con placeholders) impidiendo cargar la lista real.
   */
  listLoaded: boolean;
}

class AgroirisGastosService {
  private cache: GastoCache = { data: {}, timestamp: 0, listLoaded: false };
  private listPromise: Promise<Record<number, AgroirisGasto>> | null = null;

  private loadCache() {
    if (this.cache.timestamp && Date.now() - this.cache.timestamp < CACHE_DURATION) return;
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as Partial<GastoCache>;
      const timestamp = typeof parsed.timestamp === 'number' ? parsed.timestamp : 0;
      if (timestamp && Date.now() - timestamp < CACHE_DURATION) {
        this.cache = {
          data: (parsed.data as Record<number, AgroirisGasto>) ?? {},
          timestamp,
          listLoaded: parsed.listLoaded ?? false,
        };
      } else {
        localStorage.removeItem(CACHE_KEY);
      }
    } catch {
      localStorage.removeItem(CACHE_KEY);
    }
  }

  private saveCache() {
    this.cache.timestamp = Date.now();
    localStorage.setItem(CACHE_KEY, JSON.stringify(this.cache));
  }

  private isPlaceholderGasto(gasto: AgroirisGasto | undefined, gastoid: number) {
    if (!gasto) return true;
    const name = (gasto.nombre_gasto || '').trim();
    if (!name) return true;
    return name.toLowerCase() === `gasto ${gastoid}`.toLowerCase();
  }

  invalidateCache() {
    this.cache = { data: {}, timestamp: 0, listLoaded: false };
    this.listPromise = null;
    localStorage.removeItem(CACHE_KEY);
  }

  async listGastos(force = false): Promise<Record<number, AgroirisGasto>> {
    this.loadCache();
    if (!force && this.cache.listLoaded && this.cache.timestamp && Object.keys(this.cache.data).length) return this.cache.data;
    if (this.listPromise) return this.listPromise;

    this.listPromise = (async () => {
      // Usa la base VITE_AGROIRIS_API_URL; el proxy ya añade /agroiris-api en local, no lo dupliques aquí
      const data = await agroirisAuth.authenticatedFetch<AgroirisGasto[]>(`/gasto`);
      const map: Record<number, AgroirisGasto> = {};
      (data || []).forEach((g) => {
        map[g.gastoid] = g;
      });
      this.cache.data = map;
      this.cache.listLoaded = true;
      this.saveCache();
      this.listPromise = null;
      return map;
    })();

    try {
      return await this.listPromise;
    } catch (error) {
      this.listPromise = null;
      console.error('Error listando gastos', error);
      return this.cache.data;
    }
  }

  async getGasto(gastoid: number): Promise<AgroirisGasto | null> {
    this.loadCache();
    const cached = this.cache.data[gastoid];
    // Si lo que hay en cache es un placeholder ("Gasto {id}") reintenta para resolver el nombre real.
    if (cached && !this.isPlaceholderGasto(cached, gastoid)) return cached;

    try {
      const data = await agroirisAuth.authenticatedFetch<AgroirisGasto>(`/gasto/${gastoid}`);
      if (data) {
        this.cache.data[gastoid] = data;
        this.saveCache();
        return data;
      }
    } catch (error) {
      console.error('Error fetching gasto', gastoid, error);
    }

    // Cache vacío para evitar reintentos constantes
    if (!cached) {
      this.cache.data[gastoid] = { gastoid, nombre_gasto: `Gasto ${gastoid}` };
      this.saveCache();
    }
    return cached ?? null;
  }
}

export const agroirisGastos = new AgroirisGastosService();
