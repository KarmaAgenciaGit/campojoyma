alter table if exists public.cambio_lineas
  alter column numero_palet type numeric(12,3)
  using numero_palet::numeric(12,3);

alter table public.pedido_linea
  alter column numero_palet type numeric(12,3)
  using numero_palet::numeric(12,3);

alter table public.pedido_linea_centro
  alter column numero_palets type numeric(12,3)
  using numero_palets::numeric(12,3);

alter table public.cambios_pedido_linea_centro
  alter column numero_palets type numeric(12,3)
  using numero_palets::numeric(12,3);

create or replace function public.register_cambio(
  p_source text,
  p_external_ref text,
  p_clienteid bigint,
  p_clienteid_envio bigint,
  p_sujetodomicilioid_destino bigint,
  p_sujetodomicilioid_envio bigint,
  p_fecha_carga date,
  p_fecha_pedido date,
  p_tipo_pedido text,
  p_serieid integer,
  p_referencia_cliente text,
  p_comercialid bigint,
  p_acreedorid_porte bigint,
  p_matricula_tractora text,
  p_matricula_remolque text,
  p_pedidoclienteid text,
  p_payload jsonb,
  p_payload_normalized jsonb,
  p_lines jsonb
) returns bigint
language plpgsql
security definer
as $$
declare
  v_cambio_id bigint;
  v_item jsonb;
  v_idx int := 0;
begin
  insert into public.cambios (
    source, external_ref, clienteid, clienteid_envio, sujetodomicilioid_destino, sujetodomicilioid_envio,
    fecha_carga, fecha_pedido, tipo_pedido, serieid, referencia_cliente, comercialid, acreedorid_porte,
    matricula_tractora, matricula_remolque, pedidoclienteid, payload, payload_normalized
  )
  values (
    p_source, p_external_ref, p_clienteid, p_clienteid_envio, p_sujetodomicilioid_destino, p_sujetodomicilioid_envio,
    p_fecha_carga, p_fecha_pedido, p_tipo_pedido, p_serieid, p_referencia_cliente, p_comercialid, p_acreedorid_porte,
    p_matricula_tractora, p_matricula_remolque, p_pedidoclienteid, p_payload, p_payload_normalized
  )
  returning id into v_cambio_id;

  if p_lines is not null then
    for v_item in select * from jsonb_array_elements(p_lines)
    loop
      v_idx := v_idx + 1;
      insert into public.cambio_lineas (
        cambio_id, line_number, match_key,
        confeccionpaletid, catalogoconfecid, confeccionsalidaid, grupoconfeccionid,
        generoid, tipocultivoid, origenid, calibreid,
        bultos, descripcion_salida, bultosxpalet, numero_palet, piezasxbulto, total_piezas,
        catconfecpiezaid, kilosxbulto, kilos_cliente, catconfeckilosbultoid,
        matched_pedidodetid, pedidoid, idpedidodet_orizon
      )
      values (
        v_cambio_id,
        coalesce((v_item->>'line_number')::int, v_idx),
        v_item->>'match_key',
        (v_item->>'confeccionpaletid')::int,
        (v_item->>'catalogoconfecid')::int,
        (v_item->>'confeccionsalidaid')::int,
        (v_item->>'grupoconfeccionid')::int,
        (v_item->>'generoid')::int,
        (v_item->>'tipocultivoid')::int,
        (v_item->>'origenid')::int,
        (v_item->>'calibreid')::int,
        (v_item->>'bultos')::int,
        v_item->>'descripcion_salida',
        (v_item->>'bultosxpalet')::int,
        (v_item->>'numero_palet')::numeric(12,3),
        (v_item->>'piezasxbulto')::int,
        (v_item->>'total_piezas')::int,
        (v_item->>'catconfecpiezaid')::int,
        case when v_item ? 'kilosxbulto' then (v_item->>'kilosxbulto')::numeric(12,3) end,
        case when v_item ? 'kilos_cliente' then (v_item->>'kilos_cliente')::numeric(14,3) end,
        (v_item->>'catconfeckilosbultoid')::int,
        (v_item->>'matched_pedidodetid')::bigint,
        (v_item->>'pedidoid')::bigint,
        (v_item->>'idpedidodet_orizon')::bigint
      );
    end loop;
  end if;

  return v_cambio_id;
end;
$$;

create or replace function public.register_cambio_pedido(p_payload jsonb) returns jsonb
language plpgsql
security definer
as $$
declare
  v_items jsonb;
  v_item jsonb;
  v_line jsonb;
  v_center jsonb;
  v_cambio_id bigint;
  v_line_id bigint;
  res jsonb := jsonb_build_object('cambios_created',0,'results',jsonb_build_array(),'errors',jsonb_build_array());
begin
  if jsonb_typeof(p_payload) = 'array' then
    v_items := p_payload;
  elsif jsonb_typeof(p_payload) = 'object' and p_payload ? 'pedidos' then
    v_items := p_payload->'pedidos';
  else
    return jsonb_build_object('error','Invalid payload: expected array or object with pedidos');
  end if;

  if jsonb_array_length(v_items) = 0 then
    return jsonb_build_object('error','Invalid payload: empty pedidos');
  end if;

  for v_item in select * from jsonb_array_elements(v_items)
  loop
    begin
      insert into public.cambios_pedidos (
        serieid, tipo_pedido, fecha_pedido, fecha_carga, clienteid, clienteid_envio, divisa_cliente,
        sujetodomicilioid_destino, sujetodomicilioid_envio, referencia_cliente, comercialid, acreedorid_porte,
        matricula_tractora, matricula_remolque, archivo_pdf_id, pedidoclienteid, idpedido_orizon, needs_sync, enviado
      ) values (
        cast_int_or_null(v_item,'serieid'),
        v_item->>'tipo_pedido',
        (v_item->>'fecha_pedido')::date,
        (v_item->>'fecha_carga')::date,
        cast_int_or_null(v_item,'clienteid'),
        cast_int_or_null(v_item,'clienteid_envio'),
        cast_int_or_null(v_item,'divisa_cliente'),
        cast_int_or_null(v_item,'sujetodomicilioid_destino'),
        cast_int_or_null(v_item,'sujetodomicilioid_envio'),
        v_item->>'referencia_cliente',
        cast_int_or_null(v_item,'comercialid'),
        cast_int_or_null(v_item,'acreedorid_porte'),
        v_item->>'matricula_tractora',
        v_item->>'matricula_remolque',
        cast_int_or_null(v_item,'archivo_pdf_id'),
        v_item->>'pedidoclienteid',
        cast_int_or_null(v_item,'idpedido_orizon'),
        coalesce((v_item->>'needs_sync')::boolean, false),
        coalesce((v_item->>'enviado')::boolean, false)
      ) returning id into v_cambio_id;

      if v_item ? 'lineas' then
        for v_line in select * from jsonb_array_elements(v_item->'lineas')
        loop
          insert into public.cambios_pedido_linea (
            pedidoid, confeccionpaletid, catalogoconfecid, confeccionsalidaid, grupoconfeccionid,
            generoid, tipocultivoid, origenid, calibreid, bultos, descripcion_salida, bultosxpalet,
            numero_palet, piezasxbulto, total_piezas, catconfecpiezaid, kilosxbulto, kilos_cliente,
            catconfeckilosbultoid, idpedidodet_orizon, accion, cancel_reason
          ) values (
            v_cambio_id,
            cast_int_or_null(v_line,'confeccionpaletid'),
            cast_int_or_null(v_line,'catalogoconfecid'),
            cast_int_or_null(v_line,'confeccionsalidaid'),
            cast_int_or_null(v_line,'grupoconfeccionid'),
            cast_int_or_null(v_line,'generoid'),
            cast_int_or_null(v_line,'tipocultivoid'),
            cast_int_or_null(v_line,'origenid'),
            cast_int_or_null(v_line,'calibreid'),
            cast_int_or_null(v_line,'bultos'),
            v_line->>'descripcion_salida',
            cast_int_or_null(v_line,'bultosxpalet'),
            cast_numeric_or_null(v_line,'numero_palet',3),
            cast_int_or_null(v_line,'piezasxbulto'),
            cast_int_or_null(v_line,'total_piezas'),
            cast_int_or_null(v_line,'catconfecpiezaid'),
            cast_numeric_or_null(v_line,'kilosxbulto',3),
            cast_numeric_or_null(v_line,'kilos_cliente',3),
            cast_int_or_null(v_line,'catconfeckilosbultoid'),
            (v_line->>'idpedidodet_orizon')::bigint,
            coalesce(nullif(v_line->>'accion',''), 'upsert')::change_line_action,
            nullif(v_line->>'cancel_reason','')
          ) returning pedidodetid into v_line_id;

          if v_line ? 'centros' then
            for v_center in select * from jsonb_array_elements(v_line->'centros')
            loop
              insert into public.cambios_pedido_linea_centro (
                pedidodetid, asignacion, numero_palets, subprov, pedidocentroid_orizon
              ) values (
                v_line_id,
                v_center->>'asignacion',
                cast_numeric_or_null(v_center,'numero_palets',3),
                cast_int_or_null(v_center,'subprov'),
                cast_int_or_null(v_center,'pedidocentroid_orizon')
              );
            end loop;
          end if;

        end loop;
      end if;

      res := res || jsonb_build_object(
        'cambios_created', (res->>'cambios_created')::int + 1,
        'results', (res->'results') || jsonb_build_array(jsonb_build_object(
          'cambio_id', v_cambio_id,
          'referencia_cliente', v_item->>'referencia_cliente'
        ))
      );

    exception when others then
      res := res || jsonb_build_object(
        'errors', (res->'errors') || jsonb_build_array(jsonb_build_object(
          'referencia_cliente', coalesce(v_item->>'referencia_cliente','unknown'),
          'message', sqlerrm
        ))
      );
    end;
  end loop;

  return res;
end;
$$;
