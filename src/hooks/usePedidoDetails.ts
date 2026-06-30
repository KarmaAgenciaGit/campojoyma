import { useState, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import type { PedidoWithDetails, PedidoLinea, PedidoLineaCentro, TipoPedido } from '@/types/pedidos';
import { agroirisClients } from '@/services/agroirisClients';
import { agroirisDivisas } from '@/services/agroirisDivisas';
import { agroirisSeries } from '@/services/agroirisSeries';
import { agroirisComerciales } from '@/services/agroirisComerciales';
import { agroirisAcreedores } from '@/services/agroirisAcreedores';
import { agroirisDomicilios } from '@/services/agroirisDomicilios';
import { agroirisGeneros } from '@/services/agroirisGeneros';
import { agroirisCalibre } from '@/services/agroirisCalibre';
import { agroirisOrigenes } from '@/services/agroirisOrigenes';
import { agroirisTipoCultivo } from '@/services/agroirisTipoCultivo';
import { agroirisCatalogoConfec } from '@/services/agroirisCatalogoConfec';
import { agroirisGrupoConfeccion } from '@/services/agroirisGrupoConfeccion';
import { agroirisConfeccionPalet } from '@/services/agroirisConfeccionPalet';
import { agroirisConfeccionSalida } from '@/services/agroirisConfeccionSalida';
import { getClienteBehaviorRule } from '@/services/clienteBehaviorRules';
import { normalizeApiNumber } from '@/utils/number';
import { buildPedidoOrizonPayload } from '@/services/agroirisPedidos';

export const usePedidoDetails = () => {
  const { toast } = useToast();
  const [selectedPedido, setSelectedPedido] = useState<PedidoWithDetails | null>(null);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [loadingPedidoId, setLoadingPedidoId] = useState<number | null>(null);
  const loadingMapRef = useRef<Set<number>>(new Set());
  
  // Estados para nombres
  const [clienteNombre, setClienteNombre] = useState<string>('');
  const [clienteEnvioNombre, setClienteEnvioNombre] = useState<string>('');
  const [divisaNombre, setDivisaNombre] = useState<string>('');
  const [clienteDivisaId, setClienteDivisaId] = useState<number | null>(null);
  const [clienteDivisaNombre, setClienteDivisaNombre] = useState<string>('');
  const [serieDescripcion, setSerieDescripcion] = useState<string>('');
  const [comercialNombre, setComercialNombre] = useState<string>('');
  const [acreedorNombre, setAcreedorNombre] = useState<string>('');
  const [domicilioDestinoNombre, setDomicilioDestinoNombre] = useState<string>('');
  const [domicilioEnvioNombre, setDomicilioEnvioNombre] = useState<string>('');
  const [generoNombres, setGeneroNombres] = useState<Record<number, string>>({});
  const [calibreNombres, setCalibreNombres] = useState<Record<number, string>>({});
  const [origenNombres, setOrigenNombres] = useState<Record<number, string>>({});
  const [tipoCultivoNombres, setTipoCultivoNombres] = useState<Record<number, string>>({});
  const [catalogoConfecNombres, setCatalogoConfecNombres] = useState<Record<number, string>>({});
  const [grupoConfeccionNombres, setGrupoConfeccionNombres] = useState<Record<number, string>>({});
  const [confeccionPaletNombres, setConfeccionPaletNombres] = useState<Record<number, string>>({});
  const [confeccionSalidaNombres, setConfeccionSalidaNombres] = useState<Record<number, string>>({});
  const [pdfBase64, setPdfBase64] = useState<string>('');
  const [pdfCompartidoCount, setPdfCompartidoCount] = useState<number>(0);

  const fetchPedidoDetails = useCallback(async (pedidoId: number) => {
    // Evitar disparar múltiples veces para el mismo ID mientras se está cargando
    if (loadingMapRef.current.has(pedidoId)) return;

    try {
      setLoadingDetails(true);
      setLoadingPedidoId(pedidoId);
      loadingMapRef.current.add(pedidoId);

      // Obtener pedido
      const { data: pedidoData, error: pedidoError } = await supabase
        .from('pedidos')
        .select('*')
        .eq('id', pedidoId)
        .single();

      if (pedidoError) {
        // Si el pedido no existe, mostrar mensaje específico
        if (pedidoError.code === 'PGRST116') {
          toast({
            title: 'Pedido no encontrado',
            description: `El pedido #${pedidoId} no existe en la base de datos.`,
            variant: 'destructive',
          });
          return;
        }
        throw pedidoError;
      }

      // Obtener líneas
      const { data: lineasData, error: lineasError } = await supabase
        .from('pedido_linea')
        .select('*')
        .eq('pedidoid', pedidoId);

      if (lineasError) throw lineasError;

      // Obtener centros para cada línea
      const normalizePedidoLinea = (linea: PedidoLinea): PedidoLinea => ({
        ...linea,
        bultos: normalizeApiNumber(linea.bultos) ?? linea.bultos,
        bultosxpalet: normalizeApiNumber(linea.bultosxpalet) ?? linea.bultosxpalet,
        numero_palet: normalizeApiNumber(linea.numero_palet) ?? linea.numero_palet,
        piezasxbulto: normalizeApiNumber(linea.piezasxbulto),
        total_piezas: normalizeApiNumber(linea.total_piezas),
        kilosxbulto: normalizeApiNumber((linea as any)?.kilosxbulto),
        kilos_cliente: normalizeApiNumber((linea as any)?.kilos_cliente),
      });
      const normalizePedidoCentro = (centro: PedidoLineaCentro): PedidoLineaCentro => ({
        ...centro,
        numero_palets: normalizeApiNumber((centro as any)?.numero_palets) ?? (centro as any)?.numero_palets,
      });
      const lineasConCentros: (PedidoLinea & { centros?: PedidoLineaCentro[] })[] = [];
      
      for (const linea of lineasData || []) {
        const { data: centrosData } = await supabase
          .from('pedido_linea_centro')
          .select('*')
          .eq('pedidodetid', linea.pedidodetid);

        lineasConCentros.push({
          ...normalizePedidoLinea(linea),
          centros: (centrosData || []).map((centro) => normalizePedidoCentro(centro as PedidoLineaCentro)),
        });
      }

      const pedidoCompleto: PedidoWithDetails = {
        ...pedidoData,
        lineas: lineasConCentros,
      };

      setSelectedPedido(pedidoCompleto);

      try {
        const clienteBehaviorRule = await getClienteBehaviorRule(pedidoCompleto.clienteid);
        const { payload } = buildPedidoOrizonPayload({
          pedido: pedidoCompleto,
          tipoPedido: (pedidoCompleto.tipo_pedido ?? 'P220') as TipoPedido,
          lineas: pedidoCompleto.lineas ?? [],
          clienteBehaviorRule,
        });
        console.log('[Orizon] Payload preview (detalles)', JSON.stringify(payload, null, 2));
      } catch (previewError) {
        console.warn('[Orizon] No se pudo generar el payload de vista previa', previewError);
      }

      // Cargar nombres relacionados
      await loadRelatedNames(pedidoCompleto);

    } catch (error: any) {
      console.error('Error fetching pedido details:', error);
      toast({
        title: 'Error',
        description: `No se pudieron cargar los detalles: ${error.message}`,
        variant: 'destructive',
      });
    } finally {
      setLoadingDetails(false);
      setLoadingPedidoId(null);
      loadingMapRef.current.delete(pedidoId);
    }
  }, [toast]);

  const loadRelatedNames = async (pedido: PedidoWithDetails) => {
    try {
      // Cargar PDF si existe
      if (pedido.archivo_pdf_id) {
        try {
          const { data: pdfData } = await supabase
            .from('archivos_pdf')
            .select('b64_contenido')
            .eq('id', pedido.archivo_pdf_id)
            .single();
          
          if (pdfData) {
            setPdfBase64(pdfData.b64_contenido || '');
          }

          // Contar cuántos pedidos comparten este PDF
          const { count } = await supabase
            .from('pedidos')
            .select('id', { count: 'exact', head: true })
            .eq('archivo_pdf_id', pedido.archivo_pdf_id);
          
          setPdfCompartidoCount(count || 0);
        } catch (error) {
          console.error('Error loading PDF:', error);
        }
      }

      // Cargar nombres del pedido principal
      if (pedido.clienteid) {
        try {
          const cliente = await agroirisClients.getClientById(pedido.clienteid);
          setClienteNombre(cliente?.nombre_sujeto || `Cliente #${pedido.clienteid}`);
          setClienteDivisaId(cliente?.divisaid || null);
          
          // Cargar divisa del cliente si existe
          if (cliente?.divisaid) {
            const divisaCliente = await agroirisDivisas.getDivisaById(cliente.divisaid);
            setClienteDivisaNombre(divisaCliente?.nombre_divisa || `Divisa #${cliente.divisaid}`);
          }
        } catch (error) {
          console.error('Error loading cliente:', error);
          setClienteNombre(`Cliente #${pedido.clienteid}`);
        }
      }

      if (pedido.clienteid_envio) {
        try {
          const clienteEnvio = await agroirisClients.getClientById(pedido.clienteid_envio);
          setClienteEnvioNombre(clienteEnvio?.nombre_sujeto || `Cliente #${pedido.clienteid_envio}`);
        } catch (error) {
          console.error('Error loading cliente envio:', error);
          setClienteEnvioNombre(`Cliente #${pedido.clienteid_envio}`);
        }
      }

      if (pedido.divisa_cliente) {
        try {
          const divisa = await agroirisDivisas.getDivisaById(pedido.divisa_cliente);
          setDivisaNombre(divisa?.nombre_divisa || `Divisa #${pedido.divisa_cliente}`);
        } catch (error) {
          console.error('Error loading divisa:', error);
          setDivisaNombre(`Divisa #${pedido.divisa_cliente}`);
        }
      }

      if (pedido.serieid) {
        try {
          const serie = await agroirisSeries.getSerieById(pedido.serieid);
          setSerieDescripcion(serie?.descripcion || `Serie #${pedido.serieid}`);
        } catch (error) {
          console.error('Error loading serie:', error);
          setSerieDescripcion(`Serie #${pedido.serieid}`);
        }
      }

      if (pedido.comercialid) {
        try {
          const comercial = await agroirisComerciales.getComercialById(pedido.comercialid);
          setComercialNombre(comercial?.nombre_comercial || `Comercial #${pedido.comercialid}`);
        } catch (error) {
          console.error('Error loading comercial:', error);
          setComercialNombre(`Comercial #${pedido.comercialid}`);
        }
      } else {
        setComercialNombre('Sin comercial');
      }

      if (pedido.acreedorid_porte) {
        try {
          const acreedor = await agroirisAcreedores.getAcreedorById(pedido.acreedorid_porte);
          setAcreedorNombre(acreedor?.nombre_sujeto || `Acreedor #${pedido.acreedorid_porte}`);
        } catch (error) {
          console.error('Error loading acreedor:', error);
          setAcreedorNombre(`Acreedor #${pedido.acreedorid_porte}`);
        }
      }

      if (pedido.sujetodomicilioid_destino) {
        try {
          const domicilio = await agroirisDomicilios.getDomicilioById(pedido.sujetodomicilioid_destino);
          setDomicilioDestinoNombre(
            domicilio?.nombre_identificador_domicilio_sujeto || 
            domicilio?.domicilio_sujeto || 
            `Domicilio #${pedido.sujetodomicilioid_destino}`
          );
        } catch (error) {
          console.error('Error loading domicilio destino:', error);
          setDomicilioDestinoNombre(`Domicilio #${pedido.sujetodomicilioid_destino}`);
        }
      }

      if (pedido.sujetodomicilioid_envio) {
        try {
          const domicilio = await agroirisDomicilios.getDomicilioById(pedido.sujetodomicilioid_envio);
          setDomicilioEnvioNombre(
            domicilio?.nombre_identificador_domicilio_sujeto || 
            domicilio?.domicilio_sujeto || 
            `Domicilio #${pedido.sujetodomicilioid_envio}`
          );
        } catch (error) {
          console.error('Error loading domicilio envio:', error);
          setDomicilioEnvioNombre(`Domicilio #${pedido.sujetodomicilioid_envio}`);
        }
      }

      // Cargar nombres de las líneas
      const generosMap: Record<number, string> = {};
      const calibresMap: Record<number, string> = {};
      const origenesMap: Record<number, string> = {};
      const tipoCultivosMap: Record<number, string> = {};
      const catalogosMap: Record<number, string> = {};
      const gruposMap: Record<number, string> = {};
      const paletsMap: Record<number, string> = {};
      const salidasMap: Record<number, string> = {};

      for (const linea of pedido.lineas || []) {
        // Género
        if (linea.generoid && !generosMap[linea.generoid]) {
          try {
            const genero = await agroirisGeneros.getGeneroById(linea.generoid);
            generosMap[linea.generoid] = genero?.nombre_genero || `Género #${linea.generoid}`;
          } catch (error) {
            generosMap[linea.generoid] = `Género #${linea.generoid}`;
          }
        }

        // Calibre
        if (linea.calibreid && !calibresMap[linea.calibreid]) {
          try {
            const calibre = await agroirisCalibre.getCalibreById(linea.calibreid);
            calibresMap[linea.calibreid] = calibre?.nombre_calibre || `Calibre #${linea.calibreid}`;
          } catch (error) {
            calibresMap[linea.calibreid] = `Calibre #${linea.calibreid}`;
          }
        }

        // Origen
        if (linea.origenid && !origenesMap[linea.origenid]) {
          try {
            const origen = await agroirisOrigenes.getOrigenById(linea.origenid);
            origenesMap[linea.origenid] = origen?.nombre_origen || `Origen #${linea.origenid}`;
          } catch (error) {
            origenesMap[linea.origenid] = `Origen #${linea.origenid}`;
          }
        }

        // Tipo Cultivo
        if (linea.tipocultivoid && !tipoCultivosMap[linea.tipocultivoid]) {
          try {
            const tipo = await agroirisTipoCultivo.getTipoCultivoById(linea.tipocultivoid);
            tipoCultivosMap[linea.tipocultivoid] = tipo?.nombre_tipocultivo || `Tipo #${linea.tipocultivoid}`;
          } catch (error) {
            tipoCultivosMap[linea.tipocultivoid] = `Tipo #${linea.tipocultivoid}`;
          }
        }

        // Catálogo Confección
        if (linea.catalogoconfecid && !catalogosMap[linea.catalogoconfecid]) {
          try {
            const catalogo = await agroirisCatalogoConfec.getCatalogoById(linea.catalogoconfecid);
            catalogosMap[linea.catalogoconfecid] = catalogo?.nombre_catalogoconfeccion || `Catálogo #${linea.catalogoconfecid}`;
          } catch (error) {
            catalogosMap[linea.catalogoconfecid] = `Catálogo #${linea.catalogoconfecid}`;
          }
        }

        // Grupo Confección
        if (linea.grupoconfeccionid && !gruposMap[linea.grupoconfeccionid]) {
          try {
            const grupo = await agroirisGrupoConfeccion.getGrupoById(linea.grupoconfeccionid);
            gruposMap[linea.grupoconfeccionid] = grupo?.nombre_grupo_confeccion || `Grupo #${linea.grupoconfeccionid}`;
          } catch (error) {
            gruposMap[linea.grupoconfeccionid] = `Grupo #${linea.grupoconfeccionid}`;
          }
        }

        // Confección Palet
        if (linea.confeccionpaletid && !paletsMap[linea.confeccionpaletid]) {
          try {
            const palet = await agroirisConfeccionPalet.getConfeccionById(linea.confeccionpaletid);
            paletsMap[linea.confeccionpaletid] = palet?.nombre_confeccionpalet || `Palet #${linea.confeccionpaletid}`;
          } catch (error) {
            paletsMap[linea.confeccionpaletid] = `Palet #${linea.confeccionpaletid}`;
          }
        }

        // Confección Salida
        if (linea.confeccionsalidaid && !salidasMap[linea.confeccionsalidaid]) {
          try {
            const salida = await agroirisConfeccionSalida.getConfeccionById(linea.confeccionsalidaid);
            salidasMap[linea.confeccionsalidaid] = salida?.nombre_confeccionsalida || `Salida #${linea.confeccionsalidaid}`;
          } catch (error) {
            salidasMap[linea.confeccionsalidaid] = `Salida #${linea.confeccionsalidaid}`;
          }
        }
      }

      setGeneroNombres(generosMap);
      setCalibreNombres(calibresMap);
      setOrigenNombres(origenesMap);
      setTipoCultivoNombres(tipoCultivosMap);
      setCatalogoConfecNombres(catalogosMap);
      setGrupoConfeccionNombres(gruposMap);
      setConfeccionPaletNombres(paletsMap);
      setConfeccionSalidaNombres(salidasMap);

    } catch (error) {
      console.error('Error loading related names:', error);
    }
  };

  const clearDetails = () => {
    setSelectedPedido(null);
    setClienteNombre('');
    setClienteEnvioNombre('');
    setDivisaNombre('');
    setClienteDivisaId(null);
    setClienteDivisaNombre('');
    setSerieDescripcion('');
    setComercialNombre('');
    setAcreedorNombre('');
    setDomicilioDestinoNombre('');
    setDomicilioEnvioNombre('');
    setGeneroNombres({});
    setCalibreNombres({});
    setOrigenNombres({});
    setTipoCultivoNombres({});
    setCatalogoConfecNombres({});
    setGrupoConfeccionNombres({});
    setConfeccionPaletNombres({});
    setConfeccionSalidaNombres({});
    setPdfBase64('');
    setPdfCompartidoCount(0);
  };

  return {
    selectedPedido,
    setSelectedPedido,
    loadingDetails,
    loadingPedidoId,
    fetchPedidoDetails,
    clearDetails,
    // Nombres relacionados
    clienteNombre,
    clienteEnvioNombre,
    divisaNombre,
    clienteDivisaId,
    clienteDivisaNombre,
    serieDescripcion,
    comercialNombre,
    acreedorNombre,
    domicilioDestinoNombre,
    domicilioEnvioNombre,
    generoNombres,
    calibreNombres,
    origenNombres,
    tipoCultivoNombres,
    catalogoConfecNombres,
    grupoConfeccionNombres,
    confeccionPaletNombres,
    confeccionSalidaNombres,
    pdfBase64,
    pdfCompartidoCount,
  };
};
