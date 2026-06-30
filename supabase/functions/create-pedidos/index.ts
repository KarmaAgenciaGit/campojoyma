import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'jsr:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const supabase = createClient(supabaseUrl, supabaseKey);

    const body = await req.json();
    const pedidosArray = Array.isArray(body) ? body : (body.pedidos || []);

    if (!pedidosArray || pedidosArray.length === 0) {
      return new Response(
        JSON.stringify({ error: 'Invalid request: pedidos array is required and must not be empty' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const results = [];
    const errors = [];

    const normalizeDate = (value: unknown) => {
      if (value === null || value === undefined) return null;
      if (typeof value === 'string') {
        const trimmed = value.trim();
        return trimmed ? trimmed : null;
      }
      return value;
    };

    const normalizeTimestamp = (value: unknown) => {
      const normalized = normalizeDate(value);
      if (normalized === null) return null;

      const parsed =
        normalized instanceof Date ? normalized : new Date(String(normalized));

      return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
    };

    const normalizeText = (value: unknown) => {
      if (value === null || value === undefined) return null;
      const trimmed = String(value).trim();
      return trimmed ? trimmed : null;
    };

    const normalizeEan = (value: unknown) => {
      const normalized = normalizeText(value);
      return normalized === '0' ? null : normalized;
    };

    const normalizeNumber = (value: unknown) => {
      if (value === null || value === undefined || value === '') return null;
      if (typeof value === 'number') {
        return Number.isFinite(value) ? value : null;
      }
      if (typeof value === 'string') {
        const trimmed = value.trim();
        if (!trimmed) return null;
        const normalized = trimmed.includes(',')
          ? trimmed.replace(/\./g, '').replace(',', '.')
          : trimmed;
        const parsed = Number(normalized);
        return Number.isFinite(parsed) ? parsed : null;
      }
      return null;
    };

    const clienteRuleCache = new Map<
      string,
      { allowDuplicateReference: boolean; blockDuplicateReferenceSamePdf: boolean }
    >();

    const getClienteDuplicateRule = async (clienteid: unknown) => {
      const clienteKey = String(clienteid ?? '').trim();
      if (!clienteKey) {
        return {
          allowDuplicateReference: false,
          blockDuplicateReferenceSamePdf: false,
        };
      }

      const cached = clienteRuleCache.get(clienteKey);
      if (cached) return cached;

      const { data, error } = await supabase
        .from('cliente_behavior_rules')
        .select('allow_duplicate_reference, block_duplicate_reference_same_pdf')
        .eq('clienteid', clienteKey)
        .maybeSingle();

      if (error) {
        throw new Error(`No se pudo leer regla de cliente (${clienteKey}): ${error.message}`);
      }

      const normalizedRule = {
        allowDuplicateReference: Boolean(data?.allow_duplicate_reference),
        blockDuplicateReferenceSamePdf: Boolean(data?.block_duplicate_reference_same_pdf),
      };

      clienteRuleCache.set(clienteKey, normalizedRule);
      return normalizedRule;
    };

    for (const pedido of pedidosArray) {
      let referenciaCliente = '';
      let referencia2Cliente = '';
      let pedidoRef = 'unknown';
      let pdfNameRef: string | number = Date.now();
      try {
        referenciaCliente =
          typeof pedido.referencia_cliente === 'string' ? pedido.referencia_cliente.trim() : '';
        referencia2Cliente =
          typeof pedido.referencia2_cliente === 'string' ? pedido.referencia2_cliente.trim() : '';
        pedidoRef = referenciaCliente || referencia2Cliente || 'unknown';
        pdfNameRef = referenciaCliente || referencia2Cliente || Date.now();

        const fechaPedido = normalizeDate(pedido.fecha_pedido);
        const fechaCarga = normalizeDate(pedido.fecha_carga);
        const llegadaCorreo = normalizeTimestamp(pedido.llegada_correo);

        // Validar campos requeridos
        if (!pedido.serieid || !pedido.tipo_pedido || !fechaPedido || 
            !pedido.clienteid || !pedido.clienteid_envio || 
            !pedido.divisa_cliente || !pedido.sujetodomicilioid_destino || 
            !pedido.sujetodomicilioid_envio) {
          errors.push({
            pedido_ref: pedidoRef,
            error: 'Missing required fields in pedido'
          });
          continue;
        }
        if (pedido.tipo_pedido === 'P22E' && !fechaCarga) {
          errors.push({
            pedido_ref: pedidoRef,
            error: 'Missing required fields in pedido (fecha_carga requerida para P22E)'
          });
          continue;
        }

        // ========================================
        // 🔥 SISTEMA DE DEDUPLICACIÓN DE PDFs
        // ========================================
        let archivoPdfId = null;
        let pdfReutilizado = false;

        if (pedido.B64_Pedido && pedido.B64_Pedido.trim()) {
          const pdfContent = pedido.B64_Pedido.trim();
          
          // Calcular hash SHA-256 del PDF
          const encoder = new TextEncoder();
          const pdfData = encoder.encode(pdfContent);
          const hashBuffer = await crypto.subtle.digest('SHA-256', pdfData);
          const hashArray = Array.from(new Uint8Array(hashBuffer));
          const pdfHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
          
          console.log('PDF hash calculated:', pdfHash);
          
          // 1️⃣ Buscar si ya existe un archivo con este hash
          const { data: existingPdf, error: searchError } = await supabase
            .from('archivos_pdf')
            .select('id')
            .eq('hash_sha256', pdfHash)
            .single();
          
          if (searchError && searchError.code !== 'PGRST116') {
            console.error('Error searching PDF hash:', searchError);
            errors.push({
              pedido_ref: pedidoRef,
              error: `Failed to search PDF hash: ${searchError.message}`
            });
            continue;
          }
          
          if (existingPdf) {
            // ✅ PDF ya existe, reutilizar
            archivoPdfId = existingPdf.id;
            pdfReutilizado = true;
            console.log('Reusing existing PDF file:', archivoPdfId);
          } else {
            // 2️⃣ PDF nuevo, crear registro
            const pdfSize = Math.floor((pdfContent.length * 3) / 4);
            
            const { data: newPdf, error: insertPdfError } = await supabase
              .from('archivos_pdf')
              .insert({
                hash_sha256: pdfHash,
                b64_contenido: pdfContent,
                nombre_archivo: `pedido_${pdfNameRef}.pdf`,
                tamanio_bytes: pdfSize,
                mime_type: 'application/pdf'
              })
              .select('id')
              .single();
            
            if (insertPdfError || !newPdf) {
              console.error('Error inserting PDF:', insertPdfError);
              errors.push({
                pedido_ref: pedidoRef,
                error: `Failed to store PDF file: ${insertPdfError?.message}`
              });
              continue;
            }
            
            archivoPdfId = newPdf.id;
            pdfReutilizado = false;
            console.log('Created new PDF file:', archivoPdfId);
          }
        }

        // Previsiones (P22E): evitar duplicados por cliente + domicilio + fecha_carga
        if (pedido.tipo_pedido === 'P22E' && fechaCarga) {
          const { data: dupPrev, error: dupPrevError } = await supabase
            .from('pedidos')
            .select('id, archivo_pdf_id')
            .eq('tipo_pedido', 'P22E')
            .eq('fecha_carga', fechaCarga)
            .eq('clienteid', pedido.clienteid)
            .eq('sujetodomicilioid_destino', pedido.sujetodomicilioid_destino)
            .limit(1)
            .single();

          if (dupPrevError && dupPrevError.code !== 'PGRST116') {
            console.error('Error checking duplicate previsiones:', dupPrevError);
            errors.push({
              pedido_ref: pedidoRef,
              error: `Failed to verify previsiones duplicates: ${dupPrevError.message}`,
            });
            continue;
          }

          if (dupPrev) {
            const duplicatePdfId = typeof dupPrev.archivo_pdf_id === 'number' ? dupPrev.archivo_pdf_id : null;
            const samePdf =
              typeof archivoPdfId === 'number' &&
              duplicatePdfId !== null &&
              duplicatePdfId === archivoPdfId;
            errors.push({
              pedido_ref: pedidoRef,
              error: samePdf
                ? 'No se permiten previsiones duplicadas para el mismo cliente, domicilio y fecha de carga (mismo PDF)'
                : 'No se permiten previsiones duplicadas para el mismo cliente, domicilio y fecha de carga',
            });
            continue;
          }
        }

        // Evitar duplicados por referencia/tipo/serie
        const duplicateRule = await getClienteDuplicateRule(pedido.clienteid);
        const permitirReferenciaDuplicada = duplicateRule.allowDuplicateReference;

        if (pedido.referencia_cliente) {
          if (!permitirReferenciaDuplicada) {
            const { data: dup, error: dupError } = await supabase
              .from('pedidos')
              .select('id')
              .eq('referencia_cliente', pedido.referencia_cliente)
              .eq('tipo_pedido', pedido.tipo_pedido)
              .eq('serieid', pedido.serieid)
              .limit(1)
              .single();

            if (dupError && dupError.code !== 'PGRST116') {
              console.error('Error checking duplicate pedido:', dupError);
              errors.push({
                pedido_ref: pedidoRef,
                error: `Failed to verify duplicates: ${dupError.message}`,
              });
              continue;
            }

            if (dup) {
              errors.push({
                pedido_ref: pedidoRef,
                error: 'Pedido ya existe (referencia/tipo/serie)',
              });
              continue;
            }
          } else if (duplicateRule.blockDuplicateReferenceSamePdf && archivoPdfId) {
            const { data: dup, error: dupError } = await supabase
              .from('pedidos')
              .select('id')
              .eq('referencia_cliente', pedido.referencia_cliente)
              .eq('tipo_pedido', pedido.tipo_pedido)
              .eq('serieid', pedido.serieid)
              .eq('archivo_pdf_id', archivoPdfId)
              .limit(1)
              .single();

            if (dupError && dupError.code !== 'PGRST116') {
              console.error('Error checking duplicate pedido:', dupError);
              errors.push({
                pedido_ref: pedidoRef,
                error: `Failed to verify duplicates: ${dupError.message}`,
              });
              continue;
            }

            if (dup) {
              errors.push({
                pedido_ref: pedidoRef,
                error: `No se permiten referencias duplicadas para el mismo PDF en el cliente ${pedido.clienteid} (regla "Bloq. dup. mismo PDF" activa)`,
              });
              continue;
            }
          }
        }

        // Insertar pedido con archivo_pdf_id (NO b64_pedido)
        const { data: pedidoData, error: pedidoError } = await supabase
          .from('pedidos')
          .insert({
            serieid: pedido.serieid,
            tipo_pedido: pedido.tipo_pedido,
            fecha_pedido: fechaPedido,
            fecha_carga: fechaCarga,
            clienteid: pedido.clienteid,
            clienteid_envio: pedido.clienteid_envio,
            divisa_cliente: pedido.divisa_cliente,
            comercialid: pedido.comercialid,
            sujetodomicilioid_destino: pedido.sujetodomicilioid_destino,
            sujetodomicilioid_envio: pedido.sujetodomicilioid_envio,
            referencia_cliente: pedido.referencia_cliente,
            referencia2_cliente: pedido.referencia2_cliente ?? null,
            acreedorid_porte: pedido.acreedorid_porte,
            llegada_correo: llegadaCorreo,
            matricula_tractora: pedido.matricula_tractora || '',
            matricula_remolque: pedido.matricula_remolque || '',
            archivo_pdf_id: archivoPdfId  // ✅ Usar sistema de deduplicación
            // b64_pedido: NO incluir, está deprecado
          })
          .select('id')
          .single();

        if (pedidoError) {
          errors.push({
            pedido_ref: pedidoRef,
            error: `Failed to create pedido: ${pedidoError.message}`
          });
          continue;
        }

        const pedidoId = pedidoData.id;
        const lineasCreated = [];
        const centrosCreated = [];

        // Insertar líneas de pedido con sus centros asociados
        const lineas = Array.isArray(pedido.listLineaPed)
          ? pedido.listLineaPed
          : Array.isArray(pedido.lineas)
            ? pedido.lineas
            : [];
        if (lineas.length > 0) {
          for (const linea of lineas) {
            const piezasxbulto = linea.piezasxbulto ?? null;
            const total_piezas = linea.total_piezas ?? null;
            const catconfecpiezaid = linea.catconfecpiezaid ?? null;
            const kilosxbulto = linea.kilosxbulto ?? null;
            const kilos_cliente = linea.kilos_cliente ?? null;
            const catconfeckilosbultoid = linea.catconfeckilosbultoid ?? null;
            const eanBulto = normalizeEan(linea.ean_pieza ?? linea.ean_bulto ?? linea.ean);
            const eanCaja = normalizeEan(linea.ean_caja);
            const precioVenta = normalizeNumber(linea.precio_venta);

            const { data: lineaData, error: lineaError } = await supabase
              .from('pedido_linea')
              .insert({
                pedidoid: pedidoId,
                confeccionpaletid: normalizeNumber(linea.confeccionpaletid) ?? 0,
                catalogoconfecid: linea.catalogoconfecid,
                confeccionsalidaid: linea.confeccionsalidaid,
                grupoconfeccionid: linea.grupoconfeccionid,
                generoid: linea.generoid,
                tipocultivoid: linea.tipocultivoid,
                origenid: linea.origenid,
                calibreid: linea.calibreid,
                bultos: linea.bultos,
                descripcion_salida: linea.descripcion_salida || '',
                bultosxpalet: linea.bultosxpalet,
                numero_palet: linea.numero_palet,
                piezasxbulto,
                total_piezas,
                catconfecpiezaid,
                kilosxbulto,
                kilos_cliente,
                catconfeckilosbultoid,
                ean: eanBulto,
                ean_caja: eanCaja,
                nlote_cliente: normalizeText(linea.nlote_cliente),
                precio_venta: precioVenta,
              })
              .select('pedidodetid')
              .single();

            if (lineaError) {
              errors.push({
                pedido_ref: pedidoRef,
                pedido_id: pedidoId,
                error: `Failed to create line: ${lineaError.message}`
              });
              continue; // No procesar centros si la línea falló
            }
            
            lineasCreated.push(lineaData.pedidodetid);
            
            // Insertar centros asociados a ESTA línea específica
            if (linea.listPedidoCentro && Array.isArray(linea.listPedidoCentro) && linea.listPedidoCentro.length > 0) {
              for (const centro of linea.listPedidoCentro) {
                // numero_palets puede ser negativo; solo validar que venga informado
                if (centro.numero_palets === null || centro.numero_palets === undefined) {
                  console.warn(`Skipping centro with missing numero_palets for pedido ${pedidoRef}`);
                  continue; // Saltar este centro, no es un error
                }
                
                const { data: centroData, error: centroError } = await supabase
                  .from('pedido_linea_centro')
                  .insert({
                    pedidodetid: lineaData.pedidodetid, // ✅ Usar el ID de ESTA línea
                    asignacion: centro.asignacion,
                    numero_palets: centro.numero_palets,
                    subprov: centro.subprov
                  })
                  .select('pedcentroid')
                  .single();

                if (centroError) {
                  errors.push({
                    pedido_ref: pedidoRef,
                    pedido_id: pedidoId,
                    linea_id: lineaData.pedidodetid,
                    error: `Failed to create centro: ${centroError.message}`
                  });
                } else {
                  centrosCreated.push(centroData.pedcentroid);
                }
              }
            }
          }
        }

        results.push({
          pedido_id: pedidoId,
          referencia_cliente: pedido.referencia_cliente,
          referencia2_cliente: pedido.referencia2_cliente ?? null,
          archivo_pdf_id: archivoPdfId,
          pdf_reutilizado: pdfReutilizado,
          lineas_created: lineasCreated.length,
          linea_ids: lineasCreated,
          centros_created: centrosCreated.length,
          centro_ids: centrosCreated
        });

      } catch (err) {
        errors.push({
          pedido_ref: pedidoRef,
          error: err.message
        });
      }
    }

    const hasErrors = errors.length > 0;
    const statusCode = hasErrors ? (results.length ? 207 : 409) : 200;

    return new Response(
      JSON.stringify({
        success: !hasErrors,
        pedidos_created: results.length,
        results,
        errors: hasErrors ? errors : undefined
      }),
      {
        status: statusCode,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );

  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }
});
