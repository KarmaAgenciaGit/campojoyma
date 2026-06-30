/**
 * Ejemplos de uso del sistema de autenticación AgroIris
 */

import { agroirisAuth } from '@/services/agroirisAuth';
import { agroirisClients } from '@/services/agroirisClients';

// ============================================
// EJEMPLO 1: Obtener token
// ============================================
async function ejemploObtenerToken() {
  try {
    const token = await agroirisAuth.getToken();
    console.log('Token obtenido:', token);
  } catch (error) {
    console.error('Error obteniendo token:', error);
  }
}

// ============================================
// EJEMPLO 2: Hacer petición autenticada
// ============================================
async function ejemploPeticionAutenticada() {
  try {
    // Obtener lista de clientes
    const clientes = await agroirisAuth.authenticatedFetch('/cliente/');
    console.log('Clientes:', clientes);

    // Petición a cualquier otro endpoint
    const otrosDatos = await agroirisAuth.authenticatedFetch('/otro-endpoint');
    console.log('Otros datos:', otrosDatos);
  } catch (error) {
    console.error('Error en petición:', error);
  }
}

// ============================================
// EJEMPLO 3: Obtener clientes con caché
// ============================================
async function ejemploObtenerClientes() {
  try {
    // Primera llamada: hace petición a la API
    const clientes1 = await agroirisClients.getClients();
    console.log('Primera llamada (API):', clientes1.length, 'clientes');

    // Segunda llamada: usa caché
    const clientes2 = await agroirisClients.getClients();
    console.log('Segunda llamada (caché):', clientes2.length, 'clientes');

    // Forzar actualización
    const clientes3 = await agroirisClients.getClients(true);
    console.log('Tercera llamada (forzar refresh):', clientes3.length, 'clientes');
  } catch (error) {
    console.error('Error obteniendo clientes:', error);
  }
}

// ============================================
// EJEMPLO 4: Buscar cliente por ID
// ============================================
async function ejemploBuscarClientePorId(clienteId: number) {
  try {
    const cliente = await agroirisClients.getClientById(clienteId);
    
    if (cliente) {
      console.log('Cliente encontrado:', {
        id: cliente.clienteid,
        nombre: cliente.nombre_sujeto,
        nif: cliente.identificador_fiscal,
        activo: cliente.activo_cliente,
      });
    } else {
      console.log('Cliente no encontrado');
    }
  } catch (error) {
    console.error('Error buscando cliente:', error);
  }
}

// ============================================
// EJEMPLO 5: Buscar clientes por texto
// ============================================
async function ejemploBuscarClientes(query: string) {
  try {
    const resultados = await agroirisClients.searchClients(query);
    
    console.log(`Encontrados ${resultados.length} clientes para "${query}":`);
    resultados.forEach(resultado => {
      console.log(`- ${resultado.label}`);
    });
  } catch (error) {
    console.error('Error en búsqueda:', error);
  }
}

// ============================================
// EJEMPLO 6: Formatear clientes para select
// ============================================
async function ejemploFormatearClientes() {
  try {
    const clientes = await agroirisClients.getClients();
    const opciones = agroirisClients.formatClientsForSelect(clientes);
    
    console.log('Opciones formateadas para select:');
    opciones.slice(0, 5).forEach(opcion => {
      console.log({
        value: opcion.value,
        label: opcion.label,
        searchText: opcion.searchText,
      });
    });
  } catch (error) {
    console.error('Error formateando clientes:', error);
  }
}

// ============================================
// EJEMPLO 7: Invalidar caché manualmente
// ============================================
function ejemploInvalidarCache() {
  // Invalidar token (forzará nuevo login en próxima petición)
  agroirisAuth.invalidateToken();
  console.log('Token invalidado');

  // Invalidar caché de clientes
  agroirisClients.invalidateCache();
  console.log('Caché de clientes invalidado');
}

// ============================================
// EJEMPLO 8: Uso en componente React
// ============================================
/*
import { ClientCombobox } from '@/components/ClientCombobox';

function MiComponente() {
  const [clienteId, setClienteId] = useState<number | null>(null);

  return (
    <div>
      <Label>Seleccionar cliente</Label>
      <ClientCombobox
        value={clienteId}
        onChange={setClienteId}
        placeholder="Buscar cliente..."
      />
      
      {clienteId && <p>Cliente seleccionado: {clienteId}</p>}
    </div>
  );
}
*/

// ============================================
// EJEMPLO 9: Manejo de errores completo
// ============================================
async function ejemploManejoErrores() {
  try {
    const clientes = await agroirisClients.getClients();
    console.log('Éxito:', clientes.length, 'clientes');
  } catch (error) {
    if (error instanceof Error) {
      // Errores comunes
      if (error.message.includes('401')) {
        console.error('Error de autenticación - credenciales incorrectas');
      } else if (error.message.includes('404')) {
        console.error('Endpoint no encontrado');
      } else if (error.message.includes('500')) {
        console.error('Error del servidor');
      } else if (error.message.includes('Network')) {
        console.error('Error de red - servidor no disponible');
      } else {
        console.error('Error desconocido:', error.message);
      }
    }
  }
}

// ============================================
// EXPORTAR EJEMPLOS
// ============================================
export {
  ejemploObtenerToken,
  ejemploPeticionAutenticada,
  ejemploObtenerClientes,
  ejemploBuscarClientePorId,
  ejemploBuscarClientes,
  ejemploFormatearClientes,
  ejemploInvalidarCache,
  ejemploManejoErrores,
};
