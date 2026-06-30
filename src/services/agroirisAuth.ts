/**
 * AgroIris API Authentication Service
 * Gestiona la autenticación y renovación automática de tokens
 */

interface LoginResponse {
  token: string;
}

interface TokenData {
  token: string;
  expiresAt: number;
}

const TOKEN_BUFFER_TIME = 5 * 60 * 1000; // 5 minutos antes de expirar

type AgroirisAuthConfig = {
  apiUrlEnvKey: string;
  tokenStorageKey: string;
  loginUrlEnvKey: string;
  loginEnvKey: string;
  passwordEnvKey: string;
};

const DEFAULT_AUTH_CONFIG: AgroirisAuthConfig = {
  apiUrlEnvKey: 'VITE_AGROIRIS_API_URL',
  tokenStorageKey: 'agroiris_token',
  loginUrlEnvKey: 'VITE_AGROIRIS_LOGIN_URL',
  loginEnvKey: 'VITE_AGROIRIS_LOGIN',
  passwordEnvKey: 'VITE_AGROIRIS_PASSWORD',
};

class AgroIrisAuthService {
  private tokenPromise: Promise<string> | null = null;
  private config: AgroirisAuthConfig;

  constructor(config: Partial<AgroirisAuthConfig> = {}) {
    this.config = { ...DEFAULT_AUTH_CONFIG, ...config };
  }

  private getEnvValue(key: string): string | undefined {
    const env = import.meta.env as Record<string, string | undefined>;
    return env[key];
  }

  /**
   * Obtiene el token almacenado en localStorage
   */
  private getStoredToken(): TokenData | null {
    const stored = localStorage.getItem(this.config.tokenStorageKey);
    if (!stored) return null;

    try {
      return JSON.parse(stored);
    } catch {
      return null;
    }
  }

  /**
   * Guarda el token en localStorage
   */
  private saveToken(token: string): void {
    const payload = this.parseJwtPayload(token);
    const expiresAt = payload?.exp ? payload.exp * 1000 : Date.now() + 60 * 60 * 1000; // 1 hora por defecto

    const tokenData: TokenData = {
      token,
      expiresAt,
    };

    localStorage.setItem(this.config.tokenStorageKey, JSON.stringify(tokenData));
  }

  /**
   * Parsea el payload de un JWT
   */
  private parseJwtPayload(token: string): any {
    try {
      const base64Url = token.split('.')[1];
      const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
      const jsonPayload = decodeURIComponent(
        atob(base64)
          .split('')
          .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
          .join('')
      );
      return JSON.parse(jsonPayload);
    } catch {
      return null;
    }
  }

  /**
   * Verifica si el token es válido y no ha expirado
   */
  private isTokenValid(tokenData: TokenData | null): boolean {
    if (!tokenData) return false;
    return Date.now() < tokenData.expiresAt - TOKEN_BUFFER_TIME;
  }

  /**
   * Realiza el login en la API de AgroIris
   */
  private async performLogin(): Promise<string> {
    const loginUrl = this.getEnvValue(this.config.loginUrlEnvKey);
    const login = this.getEnvValue(this.config.loginEnvKey);
    const password = this.getEnvValue(this.config.passwordEnvKey);

    if (!loginUrl || !login || !password) {
      throw new Error('Configuración de AgroIris API no encontrada en variables de entorno');
    }

    const response = await fetch(loginUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'accept': 'application/json',
      },
      body: JSON.stringify({
        login: login,
        password: password,
      }),
    });

    if (!response.ok) {
      throw new Error(`Error en login: ${response.status} ${response.statusText}`);
    }

    const data: LoginResponse = await response.json();

    if (!data.token) {
      throw new Error('No se recibió token en la respuesta');
    }

    this.saveToken(data.token);
    return data.token;
  }

  /**
   * Obtiene un token válido (reutiliza si existe, o hace login si es necesario)
   */
  async getToken(): Promise<string> {
    // Si ya hay un login en progreso, esperar a que termine
    if (this.tokenPromise) {
      return this.tokenPromise;
    }

    const storedToken = this.getStoredToken();

    // Si el token almacenado es válido, usarlo
    if (this.isTokenValid(storedToken)) {
      return storedToken!.token;
    }

    // Si no hay token válido, hacer login
    this.tokenPromise = this.performLogin()
      .finally(() => {
        this.tokenPromise = null;
      });

    return this.tokenPromise;
  }

  /**
   * Invalida el token actual y fuerza un nuevo login
   */
  invalidateToken(): void {
    localStorage.removeItem(this.config.tokenStorageKey);
    this.tokenPromise = null;
  }

  /**
   * Realiza una petición autenticada a la API de AgroIris
   */
  async authenticatedFetch<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const token = await this.getToken();
    const baseUrl = this.getEnvValue(this.config.apiUrlEnvKey);

    const url = endpoint.startsWith('http') ? endpoint : `${baseUrl}${endpoint}`;

    const response = await fetch(url, {
      ...options,
      headers: {
        'accept': 'text/plain',
        'Authorization': `Bearer ${token}`,
        ...options.headers,
      },
    });

    // Si el token expiró, invalidarlo y reintentar una vez
    if (response.status === 401) {
      this.invalidateToken();
      const newToken = await this.getToken();

      const retryResponse = await fetch(url, {
        ...options,
        headers: {
          'accept': 'text/plain',
          'Authorization': `Bearer ${newToken}`,
          ...options.headers,
        },
      });

      if (!retryResponse.ok) {
        const error: any = new Error(`Error en petición: ${retryResponse.status} ${retryResponse.statusText}`);
        error.status = retryResponse.status;
        throw error;
      }

      const text = await retryResponse.text();
      return text ? JSON.parse(text) : null;
    }

    if (!response.ok) {
      const error: any = new Error(`Error en petición: ${response.status} ${response.statusText}`);
      error.status = response.status;
      throw error;
    }

    const text = await response.text();
    return text ? JSON.parse(text) : null;
  }
}

// Exportar instancia singleton
export const agroirisAuth = new AgroIrisAuthService();

// Instancia separada para cuentas de venta (puertos de pruebas)
export const agroirisCuentaVentaAuth = new AgroIrisAuthService({
  apiUrlEnvKey: 'VITE_AGROIRIS_CUENTAVENTA_API_URL',
  tokenStorageKey: 'agroiris_token_cuentaventa',
  loginUrlEnvKey: 'VITE_AGROIRIS_CUENTAVENTA_LOGIN_URL',
});
