/**
 * =====================================================
 * Servicio: Gestión de Archivos PDF con Deduplicación
 * =====================================================
 * 
 * Propósito: Gestionar archivos PDF de pedidos con deduplicación automática
 * Beneficios:
 * - Evita duplicación de PDFs idénticos
 * - Ahorra espacio de almacenamiento
 * - Permite agrupar pedidos por documento
 * - Mejora performance de consultas
 * 
 * @author AgroIris Team
 * @date 2025-01-05
 */

import { supabase } from '@/integrations/supabase/client';
import type { Tables } from '@/integrations/supabase/types';

// =====================================================
// Interfaces
// =====================================================

export type ArchivoPdf = Tables<'archivos_pdf'>;

export interface PdfUploadResult {
  archivo_id: number;
  is_new: boolean;
  hash: string;
  pedidos_compartiendo: number;
}

export interface PedidoPdfInfo {
  pedido_id: number;
  referencia_cliente: string | null;
  referencia2_cliente?: string | null;
  fecha: string;
  fecha_carga?: string | null;
  tipo_pedido?: string | null;
  clienteid: number | null;
  sujetodomicilioid_destino: number | null;
}

export interface PdfStats {
  total_archivos: number;
  total_pedidos_vinculados: number;
  espacio_total_kb: number;
  espacio_ahorrado_kb: number;
  porcentaje_deduplicacion: number;
  archivos_compartidos: number;
}

// =====================================================
// Clase de Servicio
// =====================================================

/**
 * Calcula el hash SHA-256 de un string (base64)
 * Usa Web Crypto API nativa del navegador
 */
async function calculateSHA256(content: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(content);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
  return hashHex;
}

/**
 * Calcula un hash "scoped" al cliente para evitar compartir PDFs entre clientes diferentes.
 * Si no se conoce el cliente, se usa la palabra 'anon' para mantener la unicidad del hash.
 */
async function calculateScopedPdfHash(base64Content: string, clienteId?: number | null): Promise<string> {
  const scope = clienteId ? `cliente:${clienteId}` : 'anon';
  return calculateSHA256(`${scope}:${base64Content}`);
}

class AgroirisPdfFilesService {
  
  /**
   * Sube un PDF con deduplicación automática
   * Si el PDF ya existe (mismo hash), retorna el existente
   * Si es nuevo, lo crea en la base de datos
   * 
   * @param base64Content - Contenido del PDF en base64
   * @param nombreArchivo - Nombre opcional del archivo
   * @returns Información del archivo (nuevo o existente)
   */
  async uploadPdf(base64Content: string, nombreArchivo?: string, clienteId?: number | null): Promise<PdfUploadResult> {
    try {
      // 1. Calcular hash SHA-256 del contenido scoped al cliente para evitar compartir PDFs entre clientes
      const hash = await calculateScopedPdfHash(base64Content, clienteId);
      
      // 2. Buscar si ya existe un archivo con este hash scoped
      const { data: existingFile, error: searchError } = await supabase
        .from('archivos_pdf')
        .select('id')
        .eq('hash_sha256', hash)
        .single();
      
      if (searchError && searchError.code !== 'PGRST116') {
        throw searchError;
      }
      
      // 3. Si existe, contar pedidos compartiendo
      if (existingFile) {
        const { count } = await supabase
          .from('pedidos')
          .select('*', { count: 'exact', head: true })
          .eq('archivo_pdf_id', existingFile.id);
        
        return {
          archivo_id: existingFile.id,
          is_new: false,
          hash,
          pedidos_compartiendo: count || 0
        };
      }
      
      // 4. Si no existe, crear nuevo archivo
      const tamanioBytes = Math.floor((base64Content.length * 3) / 4);
      
      const { data: newFile, error: insertError } = await supabase
        .from('archivos_pdf')
        .insert({
          hash_sha256: hash,
          b64_contenido: base64Content,
          nombre_archivo: nombreArchivo || null,
          tamanio_bytes: tamanioBytes,
          mime_type: 'application/pdf'
        })
        .select('id')
        .single();
      
      if (insertError) throw insertError;
      if (!newFile) throw new Error('No se pudo crear el archivo PDF');
      
      return {
        archivo_id: newFile.id,
        is_new: true,
        hash,
        pedidos_compartiendo: 0
      };
      
    } catch (error) {
      console.error('Error subiendo PDF:', error);
      throw error;
    }
  }
  
  /**
   * Obtiene un archivo PDF por su ID
   * 
   * @param id - ID del archivo
   * @returns Datos del archivo PDF
   */
  async getPdfById(id: number): Promise<ArchivoPdf | null> {
    try {
      const { data, error } = await supabase
        .from('archivos_pdf')
        .select('*')
        .eq('id', id)
        .single();
      
      if (error) throw error;
      return data;
      
    } catch (error) {
      console.error(`Error obteniendo PDF con ID ${id}:`, error);
      return null;
    }
  }
  
  /**
   * Obtiene un archivo PDF por su hash SHA-256
   * Útil para verificar si un PDF ya existe antes de subirlo
   * 
   * @param hash - Hash SHA-256 del contenido
   * @returns Datos del archivo PDF o null si no existe
   */
  async getPdfByHash(hash: string): Promise<ArchivoPdf | null> {
    try {
      const { data, error } = await supabase
        .from('archivos_pdf')
        .select('*')
        .eq('hash_sha256', hash)
        .single();
      
      if (error && error.code !== 'PGRST116') throw error;
      return data || null;
      
    } catch (error) {
      console.error(`Error obteniendo PDF por hash:`, error);
      return null;
    }
  }
  
  /**
   * Obtiene todos los pedidos que comparten un archivo PDF
   * 
   * @param pdfId - ID del archivo PDF
   * @returns Lista de pedidos vinculados
   */
  async getPedidosByPdfId(pdfId: number, clienteId?: number | null): Promise<PedidoPdfInfo[]> {
    try {
      let query = supabase
        .from('pedidos')
        .select('id, referencia_cliente, referencia2_cliente, fecha, fecha_carga, tipo_pedido, clienteid, sujetodomicilioid_destino')
        .eq('archivo_pdf_id', pdfId)
        .order('fecha', { ascending: false });

      if (clienteId) {
        query = query.eq('clienteid', clienteId);
      }

      const { data, error } = await query;
      
      if (error) throw error;
      
      return data.map((p) => ({
        pedido_id: p.id,
        referencia_cliente: p.referencia_cliente,
        referencia2_cliente: p.referencia2_cliente ?? null,
        fecha: p.fecha,
        fecha_carga: p.fecha_carga ?? null,
        tipo_pedido: p.tipo_pedido ?? null,
        clienteid: p.clienteid,
        sujetodomicilioid_destino: p.sujetodomicilioid_destino ?? null,
      }));
      
    } catch (error) {
      console.error(`Error obteniendo pedidos para PDF ${pdfId}:`, error);
      return [];
    }
  }
  
  /**
   * Obtiene el contenido base64 de un PDF
   * Sin incluir metadatos innecesarios
   * 
   * @param pdfId - ID del archivo PDF
   * @returns Contenido base64 o null
   */
  async getPdfContent(pdfId: number): Promise<string | null> {
    try {
      const { data, error } = await supabase
        .from('archivos_pdf')
        .select('b64_contenido')
        .eq('id', pdfId)
        .single();
      
      if (error) throw error;
      return data?.b64_contenido || null;
      
    } catch (error) {
      console.error(`Error obteniendo contenido de PDF ${pdfId}:`, error);
      return null;
    }
  }
  
  /**
   * Obtiene estadísticas globales de archivos PDF
   * Útil para dashboard de administración
   * 
   * @returns Estadísticas de uso y ahorro
   */
  async getPdfStats(): Promise<PdfStats> {
    try {
      // Contar archivos únicos
      const { count: totalArchivos } = await supabase
        .from('archivos_pdf')
        .select('*', { count: 'exact', head: true });
      
      // Contar pedidos con PDF
      const { count: totalPedidos } = await supabase
        .from('pedidos')
        .select('*', { count: 'exact', head: true })
        .not('archivo_pdf_id', 'is', null);
      
      // Calcular espacio total y archivos compartidos
      const { data: archivos } = await supabase
        .from('archivos_pdf')
        .select('id, tamanio_bytes');
      
      let espacioTotalBytes = 0;
      let archivosCompartidos = 0;
      
      if (archivos) {
        for (const archivo of archivos) {
          espacioTotalBytes += archivo.tamanio_bytes;
          
          // Contar cuántos pedidos usan este archivo
          const { count } = await supabase
            .from('pedidos')
            .select('*', { count: 'exact', head: true })
            .eq('archivo_pdf_id', archivo.id);
          
          if (count && count > 1) {
            archivosCompartidos++;
          }
        }
      }
      
      // Calcular ahorro
      const espacioSinDeduplicacion = espacioTotalBytes * (totalPedidos || 1);
      const espacioAhorrado = espacioSinDeduplicacion - espacioTotalBytes;
      const porcentajeDeduplicacion = totalPedidos 
        ? Math.round((1 - (totalArchivos || 0) / totalPedidos) * 100)
        : 0;
      
      return {
        total_archivos: totalArchivos || 0,
        total_pedidos_vinculados: totalPedidos || 0,
        espacio_total_kb: Math.round(espacioTotalBytes / 1024),
        espacio_ahorrado_kb: Math.round(espacioAhorrado / 1024),
        porcentaje_deduplicacion: porcentajeDeduplicacion,
        archivos_compartidos: archivosCompartidos
      };
      
    } catch (error) {
      console.error('Error obteniendo estadísticas de PDFs:', error);
      return {
        total_archivos: 0,
        total_pedidos_vinculados: 0,
        espacio_total_kb: 0,
        espacio_ahorrado_kb: 0,
        porcentaje_deduplicacion: 0,
        archivos_compartidos: 0
      };
    }
  }
  
  /**
   * Vincula un pedido con un archivo PDF
   * 
   * @param pedidoId - ID del pedido
   * @param archivoPdfId - ID del archivo PDF
   * @returns true si se vinculó correctamente
   */
  async vincularPdfAPedido(pedidoId: number, archivoPdfId: number): Promise<boolean> {
    try {
      const { error } = await supabase
        .from('pedidos')
        .update({ archivo_pdf_id: archivoPdfId })
        .eq('id', pedidoId);
      
      if (error) throw error;
      return true;
      
    } catch (error) {
      console.error(`Error vinculando PDF ${archivoPdfId} a pedido ${pedidoId}:`, error);
      return false;
    }
  }
  
  /**
   * Elimina la vinculación de un PDF de un pedido
   * El archivo PDF no se elimina, solo la relación
   * 
   * @param pedidoId - ID del pedido
   * @returns true si se desvinculó correctamente
   */
  async desvincularPdfDePedido(pedidoId: number): Promise<boolean> {
    try {
      const { error } = await supabase
        .from('pedidos')
        .update({ archivo_pdf_id: null })
        .eq('id', pedidoId);
      
      if (error) throw error;
      return true;
      
    } catch (error) {
      console.error(`Error desvinculando PDF de pedido ${pedidoId}:`, error);
      return false;
    }
  }
}

// =====================================================
// Exportar instancia única (Singleton)
// =====================================================

export const agroirisPdfFiles = new AgroirisPdfFilesService();
