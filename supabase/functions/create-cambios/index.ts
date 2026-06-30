import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const supabase = createClient(supabaseUrl, supabaseKey);

    const body = await req.json();
    const pedidosArray = Array.isArray(body) ? body : (body.pedidos || []);

    if (!pedidosArray || pedidosArray.length === 0) {
      return new Response(
        JSON.stringify({
          error: "Invalid request: pedidos array is required and must not be empty",
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const results: Record<string, unknown>[] = [];
    const errors: Record<string, unknown>[] = [];

    const normalizeDate = (value: unknown) => {
      if (value === null || value === undefined) return null;
      if (typeof value === "string") {
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
      return normalized === "0" ? null : normalized;
    };

    const normalizeNumber = (value: unknown) => {
      if (value === null || value === undefined || value === "") return null;
      if (typeof value === "number") {
        return Number.isFinite(value) ? value : null;
      }
      if (typeof value === "string") {
        const trimmed = value.trim();
        if (!trimmed) return null;
        const normalized = trimmed.includes(",")
          ? trimmed.replace(/\./g, "").replace(",", ".")
          : trimmed;
        const parsed = Number(normalized);
        return Number.isFinite(parsed) ? parsed : null;
      }
      return null;
    };

    for (const pedido of pedidosArray) {
      let referenciaCliente = "";
      let referencia2Cliente = "";
      let pedidoRef = "unknown";
      let pdfNameRef: string | number = Date.now();
      try {
        referenciaCliente =
          typeof pedido.referencia_cliente === "string" ? pedido.referencia_cliente.trim() : "";
        referencia2Cliente =
          typeof pedido.referencia2_cliente === "string" ? pedido.referencia2_cliente.trim() : "";
        pedidoRef = referenciaCliente || referencia2Cliente || "unknown";
        pdfNameRef = referenciaCliente || referencia2Cliente || Date.now();
        const fechaPedido = normalizeDate(pedido.fecha_pedido);
        const fechaCarga = normalizeDate(pedido.fecha_carga);
        const llegadaCorreo = normalizeTimestamp(pedido.llegada_correo);

        // Validación básica (mismos obligatorios que create-pedidos)
        if (
          !pedido.serieid || !pedido.tipo_pedido || !fechaPedido ||
          !pedido.clienteid || !pedido.clienteid_envio ||
          !pedido.divisa_cliente || !pedido.sujetodomicilioid_destino ||
          !pedido.sujetodomicilioid_envio
        ) {
          errors.push({
            pedido_ref: pedidoRef,
            error: "Missing required fields in pedido",
          });
          continue;
        }
        if (pedido.tipo_pedido === "P22E" && !fechaCarga) {
          errors.push({
            pedido_ref: pedidoRef,
            error: "Missing required fields in pedido (fecha_carga requerida para P22E)",
          });
          continue;
        }

        // Deduplicación de PDF (opcional)
        let archivoPdfId: number | null = null;
        let pdfReutilizado = false;

        if (pedido.B64_Pedido && pedido.B64_Pedido.trim()) {
          const pdfContent: string = pedido.B64_Pedido.trim();

          const encoder = new TextEncoder();
          const pdfData = encoder.encode(pdfContent);
          const hashBuffer = await crypto.subtle.digest("SHA-256", pdfData);
          const hashArray = Array.from(new Uint8Array(hashBuffer));
          const pdfHash = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");

          const { data: existingPdf } = await supabase
            .from("archivos_pdf")
            .select("id")
            .eq("hash_sha256", pdfHash)
            .single();

          if (existingPdf) {
            archivoPdfId = existingPdf.id;
            pdfReutilizado = true;
          } else {
            const pdfSize = Math.floor((pdfContent.length * 3) / 4);
            const { data: newPdf, error: insertPdfError } = await supabase
              .from("archivos_pdf")
              .insert({
                hash_sha256: pdfHash,
                b64_contenido: pdfContent,
                nombre_archivo: `pedido_${pdfNameRef}.pdf`,
                tamanio_bytes: pdfSize,
                mime_type: "application/pdf",
              })
              .select("id")
              .single();

            if (insertPdfError || !newPdf) {
              errors.push({
                pedido_ref: pedidoRef,
                error: `Failed to store PDF file: ${insertPdfError?.message}`,
              });
              continue;
            }
            archivoPdfId = newPdf.id;
            pdfReutilizado = false;
          }
        }

        const headerChangeMeta =
          pedido.change_meta ?? (pedido._change ? { _change: pedido._change } : null);

        // Insertar cabecera en cambios_pedidos
        const { data: cambioHeader, error: headerError } = await supabase
          .from("cambios_pedidos")
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
            referencia2_cliente: referencia2Cliente,
            acreedorid_porte: pedido.acreedorid_porte,
            llegada_correo: llegadaCorreo,
            matricula_tractora: pedido.matricula_tractora,
            matricula_remolque: pedido.matricula_remolque,
            archivo_pdf_id: archivoPdfId,
            pedidoclienteid: pedido.pedidoclienteid,
            idpedido_orizon: pedido.idpedido_orizon,
            needs_sync: pedido.needs_sync ?? false,
            enviado: pedido.enviado ?? false,
            revisado: false,
            change_meta: headerChangeMeta,
          })
          .select("id")
          .single();

        if (headerError || !cambioHeader) {
          errors.push({
            pedido_ref: pedidoRef,
            error: `Failed to insert cambio header: ${headerError?.message}`,
          });
          continue;
        }

        const cambioId = cambioHeader.id;
        const lineasCreated: number[] = [];
        const centrosCreated: number[] = [];

        // Procesar líneas
        const lineas = pedido.lineas || pedido.listLineaPed || [];
        for (const linea of lineas) {
          const accion =
            linea.accion ??
            (linea._change?.action === "cancel" ? "cancel" : "upsert");
          const cancelReason =
            linea.cancel_reason ??
            linea._change?.cancel_reason ??
            (accion === "cancel" ? "highlight_orange" : null);
          const lineaChangeMeta =
            linea.change_meta ?? (linea._change ? { _change: linea._change } : null);
          const eanBulto = normalizeEan(linea.ean_pieza ?? linea.ean_bulto ?? linea.ean);
          const eanCaja = normalizeEan(linea.ean_caja);
          const precioVenta = normalizeNumber(linea.precio_venta);
          const { data: lineaData, error: lineaError } = await supabase
            .from("cambios_pedido_linea")
            .insert({
              pedidoid: cambioId,
              accion,
              cancel_reason: cancelReason,
              confeccionpaletid: linea.confeccionpaletid,
              catalogoconfecid: linea.catalogoconfecid,
              confeccionsalidaid: linea.confeccionsalidaid,
              grupoconfeccionid: linea.grupoconfeccionid,
              generoid: linea.generoid,
              tipocultivoid: linea.tipocultivoid,
              origenid: linea.origenid,
              calibreid: linea.calibreid,
              bultos: linea.bultos,
              descripcion_salida: linea.descripcion_salida,
              bultosxpalet: linea.bultosxpalet,
              numero_palet: linea.numero_palet,
              piezasxbulto: linea.piezasxbulto,
              total_piezas: linea.total_piezas,
              catconfecpiezaid: linea.catconfecpiezaid,
              kilosxbulto: linea.kilosxbulto,
              kilos_cliente: linea.kilos_cliente,
              catconfeckilosbultoid: linea.catconfeckilosbultoid,
              idpedidodet_orizon: linea.idpedidodet_orizon,
              matched_pedidodetid: linea.matched_pedidodetid,
              ean: eanBulto,
              ean_caja: eanCaja,
              nlote_cliente: normalizeText(linea.nlote_cliente),
              precio_venta: precioVenta,
              change_meta: lineaChangeMeta,
            })
            .select("pedidodetid")
            .single();

          if (lineaError || !lineaData) {
            errors.push({
              pedido_ref: pedidoRef,
              error: `Failed to insert cambio line: ${lineaError?.message}`,
            });
            continue;
          }

          const lineId = lineaData.pedidodetid;
          lineasCreated.push(lineId);

          const centros = linea.centros || linea.listPedidoCentro || [];
          for (const centro of centros) {
            const { data: centroData, error: centroError } = await supabase
              .from("cambios_pedido_linea_centro")
              .insert({
                pedidodetid: lineId,
                asignacion: centro.asignacion,
                numero_palets: centro.numero_palets,
                subprov: centro.subprov,
                pedidocentroid_orizon: centro.pedidocentroid_orizon,
              })
              .select("pedcentroid")
              .single();

            if (centroError || !centroData) {
              errors.push({
                pedido_ref: pedidoRef,
                error: `Failed to insert cambio centro: ${centroError?.message}`,
              });
            } else {
              centrosCreated.push(centroData.pedcentroid);
            }
          }
        }

        results.push({
          cambio_id: cambioId,
          referencia_cliente: pedido.referencia_cliente,
          referencia2_cliente: pedido.referencia2_cliente ?? null,
          archivo_pdf_id: archivoPdfId,
          pdf_reutilizado: pdfReutilizado,
          lineas_created: lineasCreated.length,
          linea_ids: lineasCreated,
          centros_created: centrosCreated.length,
          centro_ids: centrosCreated,
        });
      } catch (err) {
        errors.push({
          pedido_ref: pedidoRef,
          error: (err as Error).message,
        });
      }
    }

    return new Response(
      JSON.stringify({
        success: errors.length === 0,
        cambios_created: results.length,
        results,
        errors: errors.length > 0 ? errors : undefined,
      }),
      {
        status: errors.length > 0 ? 207 : 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ error: (error as Error).message }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
