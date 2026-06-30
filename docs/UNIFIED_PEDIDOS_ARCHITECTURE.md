# Arquitectura Integrada: Pedidos y Previsiones

## 📋 Resumen

Se ha realizado una refactorización profesional del código de **Pedidos** y **Previsiones**, eliminando duplicación y creando una arquitectura modular, escalable y mantenible.

---

## 🏗️ Estructura de Archivos

### **Tipos Compartidos**
- **`src/types/pedidos.ts`**
  - Tipos centralizados: `Pedido`, `PedidoLinea`, `PedidoLineaCentro`, `PedidoWithDetails`
  - Interfaces para filtros, nombres y estado de edición
  - Type-safe con TypeScript

### **Hooks Personalizados**

#### **`src/hooks/usePedidosData.ts`**
- **Responsabilidad:** Gestión de datos de pedidos/previsiones
- **Funciones:**
  - `fetchPedidos()`: Carga pedidos desde Supabase
  - `deletePedido()`: Elimina pedido con líneas y centros asociados
  - Cálculo de PDFs compartidos
  - Detección de datos incompletos

#### **`src/hooks/usePedidoDetails.ts`**
- **Responsabilidad:** Detalles individuales de un pedido
- **Funciones:**
  - `fetchPedidoDetails()`: Carga pedido con líneas y centros
  - `loadRelatedNames()`: Carga nombres de clientes, comerciales, etc.
  - Gestión de PDF base64
  - Contador de pedidos compartiendo PDF

#### **`src/hooks/usePedidoFilters.ts`**
- **Responsabilidad:** Sistema de filtrado y paginación
- **Funciones:**
  - Filtros por: referencia, cliente, comercial, fechas
  - Paginación configurable (10, 20, 50, 100 items)
  - Cálculo automático de páginas totales
  - Reset de filtros

### **Componentes**

#### **`src/components/UnifiedPedidosView.tsx`** ⭐
- **Componente principal unificado**
- **Props:**
  - `tipoPedido`: `'P220'` (Pedidos) o `'P22E'` (Previsiones)
  - `title`: Título de la vista
  - `emptyMessage`: Mensaje cuando no hay datos
- **Características:**
  - UI responsiva con diseño profesional
  - Sistema de filtros desplegable
  - Lista paginada de pedidos
  - Indicadores visuales (datos incompletos, PDFs compartidos, matrículas)
  - Dialog simplificado de detalles
  - Botón de envío (solo para pedidos P220)

### **Páginas Simplificadas**

#### **`src/pages/Orders_NEW.tsx`**
```tsx
<UnifiedPedidosView
  tipoPedido="P220"
  title="Pedidos"
  emptyMessage="No hay pedidos registrados"
/>
```

#### **`src/pages/Previsiones_NEW.tsx`**
```tsx
<UnifiedPedidosView
  tipoPedido="P22E"
  title="Previsiones"
  emptyMessage="No hay previsiones registradas"
/>
```

---

## 🎯 Ventajas de la Nueva Arquitectura

### ✅ **Eliminación de Duplicación**
- **Antes:** 1494 líneas en `Orders.tsx` + 1495 en `Previsiones.tsx` = **2989 líneas**
- **Ahora:** ~500 líneas totales (hooks + componente + páginas)
- **Reducción:** ~83% menos código

### ✅ **Separación de Responsabilidades**
- **Hooks:** Lógica de negocio y gestión de estado
- **Componentes:** Presentación y UI
- **Páginas:** Configuración mínima

### ✅ **Reutilización de Código**
- Un solo componente para 2 funcionalidades
- Hooks reutilizables en otros contextos
- Tipos compartidos garantizan consistencia

### ✅ **Mantenibilidad**
- Cambios en un solo lugar
- Testing más sencillo (cada hook es testeab independently)
- Código más legible y documentado

### ✅ **Escalabilidad**
- Fácil añadir nuevos tipos de pedidos (P22X, etc.)
- Hooks pueden extenderse sin afectar UI
- Sistema de filtros extensible

---

## 🔄 Flujo de Datos

```
┌─────────────────┐
│  Orders/        │
│  Previsiones    │
│  (Páginas)      │
└────────┬────────┘
         │ props
         ▼
┌─────────────────────┐
│ UnifiedPedidosView  │
│  (Componente UI)    │
└──┬──────┬──────┬───┘
   │      │      │
   │      │      └──────────┐
   │      │                 │
   ▼      ▼                 ▼
┌──────┐ ┌──────┐  ┌──────────┐
│ Data │ │Detail│  │ Filters  │
│ Hook │ │ Hook │  │  Hook    │
└──┬───┘ └──┬───┘  └────┬─────┘
   │        │            │
   └────────┴────────────┘
            │
            ▼
      ┌──────────┐
      │ Supabase │
      └──────────┘
```

---

## 🚀 Próximos Pasos

### **Mejoras Recomendadas**
1. **Integrar servicios AgroIris** en `usePedidoDetails` para cargar nombres reales
2. **Implementar edición inline** de pedidos/previsiones
3. **Añadir sistema de notificaciones** para cambios en tiempo real
4. **Crear tests unitarios** para hooks y componentes
5. **Añadir exportación** a Excel/PDF de listados filtrados

### **Optimizaciones**
- Cacheo de datos de nomencladores (clientes, comerciales)
- Lazy loading de PDFs grandes
- Virtualización de listas largas (react-virtual)
- React Query para mejor gestión de cache

---

## 📝 Notas Técnicas

### **Decisiones de Diseño**
- **Dialog simplificado:** Por ahora usa un dialog básico. El componente `PedidoDetailsDialog` existente requiere muchas props de estado de edición que no se usan en la vista simplificada.
- **Tipos flexibles:** Los tipos permiten tanto `Pedido` como `Prevision` (aunque usan la misma tabla en Supabase).
- **Paginación del lado del cliente:** Para datasets pequeños-medianos. Si crece mucho, migrar a paginación server-side.

### **Compatibilidad**
- Los archivos `Orders.tsx` y `Previsiones.tsx` originales se mantienen intactos
- `Orders_NEW.tsx` y `Previsiones_NEW.tsx` son las versiones refactorizadas
- Migración gradual: actualizar rutas cuando se valide el nuevo código

---

## 📦 Dependencias

- React 18+
- TypeScript
- Supabase Client
- date-fns
- Shadcn/ui components
- Lucide icons

---

## 👨‍💻 Uso

```tsx
// Ejemplo básico
import { UnifiedPedidosView } from '@/components/UnifiedPedidosView';

<UnifiedPedidosView
  tipoPedido="P220"  // o "P22E"
  title="Mis Pedidos"
  emptyMessage="No hay pedidos"
/>

// Los hooks también pueden usarse independientemente
import { usePedidosData } from '@/hooks/usePedidosData';

const { pedidos, loading, deletePedido } = usePedidosData({ tipoPedido: 'P220' });
```

---

## 🎨 Características Visuales

- ✨ Degradados modernos en fondos
- 🎯 Indicadores de estado (amarillo: datos incompletos, azul: con matrículas)
- 📄 Badge para PDFs compartidos
- 🔍 Sistema de filtros desplegable
- 📱 Totalmente responsivo
- 🌙 Soporte de tema oscuro

---

**Última actualización:** Noviembre 10, 2025
**Versión:** 1.0.0
**Autor:** Sistema de Refactorización Profesional
