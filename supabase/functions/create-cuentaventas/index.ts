import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
type CuentaPayload = Record<string, JsonValue>;
type ResolvedInput =
  | {
      kind: "cuenta";
      cuenta: CuentaPayload;
      pdfContent: string | null;
    }
  | {
      kind: "error";
      error: { codigo: string; mensaje: string; numeroPagina: number | null };
      pdfContent: string | null;
    };

const pickPdfFromPayload = (cuenta: CuentaPayload) => {
  const candidates = [
    cuenta.B64_CuentaVenta,
    cuenta.B64_Cuenta,
    cuenta.B64_PDF,
    cuenta.B64_Pedido,
    cuenta.b64_pdf,
  ];
  const found = candidates.find((v) => typeof v === "string" && v.trim().length > 0);
  return typeof found === "string" ? found.trim() : null;
};

const sha256Base64 = async (base64: string) => {
  const buffer = new TextEncoder().encode(base64);
  const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
};

const normalizeTipoPrecio = (value: unknown) => {
  const raw = (value ?? "K").toString().toUpperCase();
  if (raw === "U") return "P";
  if (raw === "K" || raw === "B" || raw === "P") return raw;
  return "K";
};

const parseNumeric = (value: unknown, fallback = 0) => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const normalized = value.trim().replace(",", ".");
    const parsed = Number(normalized);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
};

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

const resolveWrappedInput = (payload: CuentaPayload): ResolvedInput => {
  const wrapper = payload as Record<string, unknown>;
  const okValue = typeof wrapper.ok === "boolean" ? wrapper.ok : null;
  const wrapperPdf = pickPdfFromPayload(payload);

  if (okValue === false) {
    const errorRaw = wrapper.error && typeof wrapper.error === "object" ? (wrapper.error as Record<string, unknown>) : {};
    const codigo = typeof errorRaw.codigo === "string" ? errorRaw.codigo : "OTRO_ERROR";
    const mensaje = typeof errorRaw.mensaje === "string" ? errorRaw.mensaje : "Error no especificado";
    const numeroPaginaRaw =
      errorRaw.numeroPagina ??
      errorRaw.numero_pagina ??
      (wrapper.numeroPagina as number | undefined) ??
      (wrapper.numero_pagina as number | undefined);
    const numeroPagina =
      typeof numeroPaginaRaw === "number" && Number.isFinite(numeroPaginaRaw) ? numeroPaginaRaw : null;

    return {
      kind: "error",
      error: { codigo, mensaje, numeroPagina },
      pdfContent: wrapperPdf,
    };
  }

  let cuenta: CuentaPayload = payload;
  if (okValue === true && wrapper.cuentaventa && typeof wrapper.cuentaventa === "object") {
    cuenta = wrapper.cuentaventa as CuentaPayload;
  }

  const pdfContent = wrapperPdf || pickPdfFromPayload(cuenta);

  return { kind: "cuenta", cuenta, pdfContent };
};

const ensureArchivoPdf = async (
  supabase: ReturnType<typeof createClient>,
  pdfContent: string | null,
  reference: string,
) => {
  if (!pdfContent) {
    return { archivoPdfId: null as number | null, pdfReutilizado: false };
  }

  const pdfHash = await sha256Base64(pdfContent);
  const { data: existingPdf, error: searchError } = await supabase
    .from("archivos_pdf")
    .select("id")
    .eq("hash_sha256", pdfHash)
    .single();

  if (searchError && searchError.code !== "PGRST116") {
    return { error: searchError };
  }

  if (existingPdf) {
    return { archivoPdfId: existingPdf.id as number, pdfReutilizado: true };
  }

  const pdfSize = Math.floor((pdfContent.length * 3) / 4);
  const { data: newPdf, error: insertPdfError } = await supabase
    .from("archivos_pdf")
    .insert({
      hash_sha256: pdfHash,
      b64_contenido: pdfContent,
      nombre_archivo: `cuentaventa_${reference || Date.now()}.pdf`,
      tamanio_bytes: pdfSize,
      mime_type: "application/pdf",
    })
    .select("id")
    .single();

  if (insertPdfError || !newPdf) {
    return { error: insertPdfError ?? new Error("Failed to store PDF file") };
  }

  return { archivoPdfId: newPdf.id as number, pdfReutilizado: false };
};

const rollbackCuentaVenta = async ({
  supabase,
  cuentaventaId,
  gastoIds,
  detalleIds,
  archivoPdfId,
  pdfReutilizado,
}: {
  supabase: ReturnType<typeof createClient>;
  cuentaventaId: number;
  gastoIds: number[];
  detalleIds: number[];
  archivoPdfId: number | null;
  pdfReutilizado: boolean;
}) => {
  try {
    if (detalleIds.length) {
      await supabase
        .from("cuentaventa_detalle_valor")
        .delete()
        .in("cuentaventa_detalle_id", detalleIds);
    }
  } catch (_) {
    // best-effort rollback
  }

  try {
    if (detalleIds.length) {
      await supabase.from("cuentaventa_detalle").delete().in("id", detalleIds);
    }
  } catch (_) {
    // best-effort rollback
  }

  try {
    if (gastoIds.length) {
      await supabase.from("cuentaventa_gastos").delete().in("id", gastoIds);
    }
  } catch (_) {
    // best-effort rollback
  }

  try {
    await supabase.from("cuentaventas").delete().eq("id", cuentaventaId);
  } catch (_) {
    // best-effort rollback
  }

  if (archivoPdfId && !pdfReutilizado) {
    try {
      const [{ count: countCv }, { count: countPedidos }, { count: countCambios }] = await Promise.all([
        supabase.from("cuentaventas").select("*", { count: "exact", head: true }).eq("archivo_pdf_id", archivoPdfId),
        supabase.from("pedidos").select("*", { count: "exact", head: true }).eq("archivo_pdf_id", archivoPdfId),
        supabase.from("cambios_pedidos").select("*", { count: "exact", head: true }).eq("archivo_pdf_id", archivoPdfId),
      ]);

      if ((countCv || 0) + (countPedidos || 0) + (countCambios || 0) === 0) {
        await supabase.from("archivos_pdf").delete().eq("id", archivoPdfId);
      }
    } catch (_) {
      // best-effort rollback
    }
  }
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
    const cuentasArray: CuentaPayload[] = Array.isArray(body)
      ? body
      : (body.cuentaventas || body.cuentas || []);

    if (!cuentasArray || cuentasArray.length === 0) {
      return new Response(
        JSON.stringify({ error: "Invalid request: cuentaventas array is required and must not be empty" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const results: Record<string, unknown>[] = [];
    const errors: Record<string, unknown>[] = [];
    const storedErrors: Record<string, unknown>[] = [];

    for (const payload of cuentasArray) {
      let cuentaRef = "unknown";
      try {
        const resolved = resolveWrappedInput(payload);

        if (resolved.kind === "error") {
          cuentaRef = `error_${resolved.error.codigo}`;
          const reference = `error_${Date.now()}`;
          const pdfResult = await ensureArchivoPdf(supabase, resolved.pdfContent, reference);
          if ("error" in pdfResult) {
            errors.push({
              error: `Failed to store PDF file for error: ${pdfResult.error?.message ?? pdfResult.error}`,
              codigo: resolved.error.codigo,
            });
            continue;
          }

          const rawPayload = {
            ok: false,
            error: {
              codigo: resolved.error.codigo,
              mensaje: resolved.error.mensaje,
              ...(resolved.error.numeroPagina !== null ? { numeroPagina: resolved.error.numeroPagina } : {}),
            },
          };

          const { data: errorRow, error: insertError } = await supabase
            .from("cuentaventa_errores")
            .insert({
              archivo_pdf_id: pdfResult.archivoPdfId,
              codigo: resolved.error.codigo,
              mensaje: resolved.error.mensaje,
              numero_pagina: resolved.error.numeroPagina,
              raw_payload: rawPayload,
            })
            .select("id")
            .single();

          if (insertError || !errorRow) {
            errors.push({
              error: `Failed to store cuentaventa error: ${insertError?.message}`,
              codigo: resolved.error.codigo,
            });
            continue;
          }

          storedErrors.push({
            error_id: errorRow.id,
            archivo_pdf_id: pdfResult.archivoPdfId,
            codigo: resolved.error.codigo,
          });
          continue;
        }

        const cuenta = resolved.cuenta;
        cuentaRef = (cuenta.numero_cuentaventa as string) || (cuenta.cuentaventaid as string) || "unknown";

        // Validar campos mínimos (permitir 0 como valor válido)
        const hasSerie = cuenta.serieid !== undefined && cuenta.serieid !== null;
        const hasFecha = !!cuenta.fechavaloracion;
        const hasCliente = cuenta.clienteid !== undefined && cuenta.clienteid !== null;

        if (!hasSerie || !hasFecha || !hasCliente) {
          errors.push({
            cuentaventa_ref: cuenta.numero_cuentaventa || cuenta.cuentaventaid || "unknown",
            error: "Missing required fields (serieid, fechavaloracion, clienteid)",
          });
          continue;
        }

        const reference = `${cuenta.numero_cuentaventa || cuenta.cuentaventaid || Date.now()}`;
        const pdfResult = await ensureArchivoPdf(supabase, resolved.pdfContent, reference);
        if ("error" in pdfResult) {
          errors.push({
            cuentaventa_ref: cuenta.numero_cuentaventa || cuenta.cuentaventaid || "unknown",
            error: `Failed to store PDF file: ${pdfResult.error?.message ?? pdfResult.error}`,
          });
          continue;
        }

        const { archivoPdfId, pdfReutilizado } = pdfResult;

        // Comprobar duplicados por externo_id o (serie + numero)
        if (cuenta.cuentaventaid && cuenta.cuentaventaid !== 0) {
          const { data: dup, error: dupError } = await supabase
            .from("cuentaventas")
            .select("id")
            .eq("externo_id", cuenta.cuentaventaid)
            .limit(1)
            .single();

          if (dupError && dupError.code !== "PGRST116") {
            errors.push({
              cuentaventa_ref: cuenta.numero_cuentaventa || cuenta.cuentaventaid || "unknown",
              error: `Failed to verify duplicates: ${dupError.message}`,
            });
            continue;
          }

          if (dup) {
            errors.push({
              cuentaventa_ref: cuenta.numero_cuentaventa || cuenta.cuentaventaid || "unknown",
              error: "Cuenta de venta ya existe (externo_id)",
            });
            continue;
          }
        }

        if (cuenta.numero_cuentaventa && `${cuenta.numero_cuentaventa}`.trim() !== "") {
          const { data: dupNum, error: dupNumError } = await supabase
            .from("cuentaventas")
            .select("id")
            .eq("numero_cuentaventa", cuenta.numero_cuentaventa)
            .limit(1)
            .single();

          if (dupNumError && dupNumError.code !== "PGRST116") {
            errors.push({
              cuentaventa_ref: cuenta.numero_cuentaventa || cuenta.cuentaventaid || "unknown",
              error: `Failed to verify duplicates (numero_cuentaventa): ${dupNumError.message}`,
            });
            continue;
          }

          if (dupNum) {
            errors.push({
              cuentaventa_ref: cuenta.numero_cuentaventa || cuenta.cuentaventaid || "unknown",
              error: "Cuenta de venta ya existe (numero_cuentaventa)",
            });
            continue;
          }
        }

        // Insertar cabecera
        const totalCuentaVenta = parseNumeric(
          cuenta.total_cuentaventa ??
            cuenta.totalCuentaVenta ??
            cuenta.total_cuenta ??
            cuenta.total ??
            cuenta.total_importe,
          0,
        );
        const llegadaCorreo = normalizeTimestamp(cuenta.llegada_correo);
        const codigoCuentaVenta = 0;
        const { data: header, error: headerError } = await supabase
          .from("cuentaventas")
          .insert({
            externo_id: cuenta.cuentaventaid && cuenta.cuentaventaid !== 0 ? cuenta.cuentaventaid : null,
            serieid: cuenta.serieid,
            codigo_cuentaventa: codigoCuentaVenta,
            numero_cuentaventa: (cuenta.numero_cuentaventa as string) || null,
            fechavaloracion: cuenta.fechavaloracion,
            observaciones_valoracion: (cuenta.observaciones_valoracion as string) || null,
            clienteid: cuenta.clienteid,
            needs_sync: (cuenta.needs_sync as boolean) ?? false,
            enviado: (cuenta.enviado as boolean) ?? false,
            archivo_pdf_id: archivoPdfId,
            idcuentaventa_orizon: cuenta.idcuentaventa_orizon ?? null,
            llegada_correo: llegadaCorreo,
            total_cuentaventa: totalCuentaVenta,
          })
          .select("id")
          .single();

        if (headerError || !header) {
          errors.push({
            cuentaventa_ref: cuenta.numero_cuentaventa || cuenta.cuentaventaid || "unknown",
            error: `Failed to create cuentaventa: ${headerError?.message}`,
          });
          continue;
        }

        const cuentaventaId = header.id as number;
        const gastoIds: number[] = [];
        const detalleIds: number[] = [];
        const valorIds: number[] = [];
        const accountErrors: Record<string, unknown>[] = [];
        let accountFailed = false;

        // Insertar gastos
        const gastos = Array.isArray(cuenta.listGastos) ? cuenta.listGastos : [];
        for (const gasto of gastos as CuentaPayload[]) {
          if (accountFailed) break;
          const { data: gastoData, error: gastoError } = await supabase
            .from("cuentaventa_gastos")
            .insert({
              cuentaventa_id: cuentaventaId,
              gastoid: gasto.gastoid,
              valor_gasto: gasto.valor_gasto ?? 0,
              acreedorid: gasto.acreedorid ?? null,
            })
            .select("id")
            .single();

          if (gastoError || !gastoData) {
            accountErrors.push({
              cuentaventa_id: cuentaventaId,
              error: `Failed to insert gasto: ${gastoError?.message}`,
            });
            accountFailed = true;
          } else {
            gastoIds.push(gastoData.id);
          }
        }

        // Insertar detalles y sus valores
        const detalles = Array.isArray(cuenta.listDetalle) ? cuenta.listDetalle : [];
        for (const detalle of detalles as CuentaPayload[]) {
          if (accountFailed) break;
          const { data: detalleData, error: detalleError } = await supabase
            .from("cuentaventa_detalle")
            .insert({
              cuentaventa_id: cuentaventaId,
              salidadetalleid: detalle.salidadetalleid,
              externo_detalle_id: detalle.cuentaventadetalleid && detalle.cuentaventadetalleid !== 0
                ? detalle.cuentaventadetalleid
                : null,
              idcuentaventadet_orizon: detalle.idcuentaventadet_orizon ?? null,
            })
            .select("id")
            .single();

          if (detalleError || !detalleData) {
            accountErrors.push({
              cuentaventa_id: cuentaventaId,
              error: `Failed to insert detalle: ${detalleError?.message}`,
            });
            accountFailed = true;
            continue;
          }

          const detalleId = detalleData.id as number;
          detalleIds.push(detalleId);

          const valores = Array.isArray(detalle.listaSalidaValor) ? detalle.listaSalidaValor : [];
          for (const valor of valores as CuentaPayload[]) {
            if (accountFailed) break;
            const tipoPrecio = normalizeTipoPrecio(valor.tipo_precio);

            const { data: valorData, error: valorError } = await supabase
              .from("cuentaventa_detalle_valor")
              .insert({
                cuentaventa_detalle_id: detalleId,
                total_kilosbrutos: valor.total_kilosbrutos ?? 0,
                total_kiloscliente: valor.total_kiloscliente ?? 0,
                total_kilosnetos: valor.total_kilosnetos ?? 0,
                total_piezas: valor.total_piezas ?? 0,
                total_bultos: valor.total_bultos ?? 0,
                nro_palets: valor.nro_palets ?? 0,
                divisaid: valor.divisaid,
                precio: valor.precio ?? 0,
                tipo_precio: tipoPrecio,
              })
              .select("id")
              .single();

            if (valorError || !valorData) {
              accountErrors.push({
                cuentaventa_id: cuentaventaId,
                detalle_id: detalleId,
                error: `Failed to insert detalle_valor: ${valorError?.message}`,
              });
              accountFailed = true;
            } else {
              valorIds.push(valorData.id);
            }
          }
        }

        if (accountErrors.length > 0) {
          await rollbackCuentaVenta({
            supabase,
            cuentaventaId,
            gastoIds,
            detalleIds,
            archivoPdfId,
            pdfReutilizado,
          });

          errors.push({
            cuentaventa_ref: cuenta.numero_cuentaventa || cuenta.cuentaventaid || "unknown",
            cuentaventa_id: cuentaventaId,
            error: "Cuenta revertida por errores al crear detalles/valores.",
            detail_errors: accountErrors,
          });
          continue;
        }

        results.push({
          cuentaventa_id: cuentaventaId,
          externo_id: cuenta.cuentaventaid || null,
          numero_cuentaventa: cuenta.numero_cuentaventa,
          archivo_pdf_id: archivoPdfId,
          pdf_reutilizado: pdfReutilizado,
          total_cuentaventa: totalCuentaVenta,
          gastos_created: gastoIds.length,
          detalle_created: detalleIds.length,
          valores_created: valorIds.length,
          gasto_ids: gastoIds,
          detalle_ids: detalleIds,
          valor_ids: valorIds,
        });
      } catch (err) {
        errors.push({
          cuentaventa_ref: cuentaRef,
          error: (err as Error).message,
        });
      }
    }

    const hasErrors = errors.length > 0;
    const statusCode = hasErrors ? (results.length || storedErrors.length ? 207 : 409) : 200;

    return new Response(
      JSON.stringify({
        success: !hasErrors,
        cuentaventas_created: results.length,
        cuentaventa_errores_created: storedErrors.length,
        results,
        errores_registrados: storedErrors.length ? storedErrors : undefined,
        errors: hasErrors ? errors : undefined,
      }),
      { status: statusCode, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ error: (error as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
