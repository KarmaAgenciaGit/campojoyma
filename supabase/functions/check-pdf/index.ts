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
    const base64 = (body?.b64_pdf ?? body?.B64_Pedido ?? body?.pdf_base64 ?? body?.pdf ?? "").toString().trim();

    if (!base64) {
      return new Response(
        JSON.stringify({ error: "Invalid request: b64_pdf (base64) is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Calcular hash SHA-256 del contenido base64 (misma lógica que create-pedidos)
    const encoder = new TextEncoder();
    const pdfData = encoder.encode(base64);
    const hashBuffer = await crypto.subtle.digest("SHA-256", pdfData);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const pdfHash = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");

    // Buscar PDF existente por hash
    const { data: existingPdf, error: searchError } = await supabase
      .from("archivos_pdf")
      .select("id, hash_sha256, nombre_archivo, tamanio_bytes, mime_type")
      .eq("hash_sha256", pdfHash)
      .maybeSingle();

    if (searchError && searchError.code !== "PGRST116") {
      return new Response(
        JSON.stringify({ error: `Failed to search PDF hash: ${searchError.message}` }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const exists = Boolean(existingPdf);

    return new Response(
      JSON.stringify({
        success: true,
        exists,
        hash_sha256: pdfHash,
        pdf: exists
          ? {
              id: existingPdf!.id,
              nombre_archivo: existingPdf!.nombre_archivo,
              tamanio_bytes: existingPdf!.tamanio_bytes,
              mime_type: existingPdf!.mime_type,
            }
          : null,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ error: (error as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
