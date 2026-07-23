-- Concilia exclusivamente los punteos seleccionados y usa su identidad ERP
-- estable. CREATE OR REPLACE conserva owner y ACL de la firma existente.
--
-- Invariantes de cierre:
--   * cabecera y detalles se comparan con el request_payload dry-run bloqueado;
--   * los candidatos con S=false no participan ni se modifican;
--   * source_table + source_id debe ser no nulo y unico en ambos lados;
--   * el conjunto leido debe coincidir exactamente con el seleccionado;
--   * ninguna fila se asigna por posicion u ordinalidad.
--   * reference_only nunca confirma un asiento; created exige status y flag.

create or replace function public.finalize_factura_recibida_sync_v2(
  p_factura_id uuid,
  p_request_id uuid,
  p_write_response jsonb,
  p_readback jsonb,
  p_actor uuid default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_current public.facturasrecibidas%rowtype;
  v_authoritative_factura public.facturasrecibidas%rowtype;
  v_dry_run_attempt public.facturasrecibidas_sync_attempts%rowtype;
  v_authoritative_payload jsonb;
  v_authoritative_header jsonb;
  v_authoritative_ctb jsonb;
  v_authoritative_punteos jsonb;
  v_header jsonb := coalesce(p_readback->'factura', '{}'::jsonb);
  v_accounting jsonb := coalesce(
    p_readback->'accounting',
    p_readback->'asiento',
    '{}'::jsonb
  );
  v_readback_ctb jsonb := coalesce(p_readback->'ctb', '[]'::jsonb);
  v_readback_punteos jsonb := coalesce(p_readback->'punteos', '[]'::jsonb);
  v_lines jsonb;
  v_remote_text text;
  v_readback_text text;
  v_remote_id bigint;
  v_readback_id bigint;
  v_technical_text text;
  v_technical_id bigint;
  v_visible_number text;
  v_accounting_date date;
  v_accounting_status text;
  v_accounting_reported_status text;
  v_accounting_reported_created boolean := false;
  v_total_debit numeric(18,2) := 0;
  v_total_credit numeric(18,2) := 0;
  v_line_count integer := 0;
  v_balanced boolean := false;
  v_asiento_id uuid;
  v_snapshot jsonb;
  v_local_ctb_count integer;
  v_local_punteos_count integer;
  v_expected_ctb_count integer;
  v_expected_punteos_count integer;
  v_updated_ctb_count integer;
  v_updated_punteos_count integer;
  v_mismatch_field text;
begin
  if p_write_response is null or jsonb_typeof(p_write_response) <> 'object' then
    raise exception 'INVALID_WRITE_RESPONSE: respuesta de escritura ausente';
  end if;
  if p_readback is null or jsonb_typeof(p_readback) <> 'object' then
    raise exception 'INVALID_READBACK: lectura ERP ausente';
  end if;
  if p_write_response->'contract_version' is distinct from '2'::jsonb then
    raise exception 'INVALID_WRITE_RESPONSE: contract_version=2 explicito requerido';
  end if;
  if p_write_response->'request_id' is distinct from to_jsonb(p_request_id::text) then
    raise exception 'INVALID_WRITE_RESPONSE: request_id no coincide con el envio activo';
  end if;
  if p_write_response->'ok' is distinct from 'true'::jsonb then
    raise exception 'INVALID_WRITE_RESPONSE: ok=true explicito requerido';
  end if;
  if p_write_response->'dry_run' is distinct from 'false'::jsonb then
    raise exception 'INVALID_WRITE_RESPONSE: dry_run=false explicito requerido';
  end if;

  v_remote_text := coalesce(
    nullif(p_write_response->>'FRR_id', ''),
    nullif(p_write_response#>>'{factura,FRR_id}', ''),
    nullif(p_write_response#>>'{data,FRR_id}', ''),
    nullif(p_write_response#>>'{result,FRR_id}', '')
  );
  if v_remote_text !~ '^[0-9]+$' then
    raise exception 'INVALID_WRITE_RESPONSE: FRR_id remoto positivo requerido';
  end if;
  v_remote_id := v_remote_text::bigint;
  if v_remote_id <= 0 then
    raise exception 'INVALID_WRITE_RESPONSE: FRR_id remoto positivo requerido';
  end if;

  v_readback_text := coalesce(
    nullif(v_header->>'FRR_id', ''),
    nullif(v_header->>'id', ''),
    nullif(p_readback->>'FRR_id', '')
  );
  if v_readback_text !~ '^[0-9]+$' then
    raise exception 'INVALID_READBACK: no se pudo confirmar FRR_id en ERP';
  end if;
  v_readback_id := v_readback_text::bigint;
  if v_readback_id <> v_remote_id then
    raise exception 'INVALID_READBACK: FRR_id escrito (%) y leido (%) no coinciden',
      v_remote_id,
      v_readback_id;
  end if;

  select *
  into v_current
  from public.facturasrecibidas
  where id = p_factura_id
  for update;

  if not found then
    raise exception 'NOT_FOUND: factura no encontrada';
  end if;
  if v_current.last_request_id is distinct from p_request_id then
    raise exception 'IDEMPOTENCY_CONFLICT: request_id no coincide con el envio activo';
  end if;
  if v_current."FRR_id" is not null and v_current."FRR_id" <> v_remote_id then
    raise exception 'REMOTE_ID_CONFLICT: la factura ya tiene otro FRR_id';
  end if;

  -- El payload dry-run queda fijado antes de abrir el writer y es la unica
  -- autoridad para saber que cabecera y detalles se enviaron realmente. Se
  -- bloquea la fila para que commit y reconcile compartan el mismo snapshot.
  select *
  into v_dry_run_attempt
  from public.facturasrecibidas_sync_attempts
  where factura_id = p_factura_id
    and request_id = p_request_id
    and phase = 'dry_run'
  for update;

  if not found then
    raise exception 'INVALID_SYNC_ATTEMPT: falta el payload dry_run original';
  end if;
  if v_dry_run_attempt.contract_version <> 2
    or v_dry_run_attempt.dry_run is distinct from true
    or v_dry_run_attempt.status <> 'succeeded'
  then
    raise exception 'INVALID_SYNC_ATTEMPT: el intento dry_run no confirma contrato v2 completado';
  end if;

  v_authoritative_payload := v_dry_run_attempt.request_payload;
  if v_authoritative_payload is null
    or jsonb_typeof(v_authoritative_payload) <> 'object'
  then
    raise exception 'INVALID_SYNC_ATTEMPT: request_payload debe ser un objeto';
  end if;
  if v_authoritative_payload->'contract_version' is distinct from '2'::jsonb then
    raise exception 'INVALID_SYNC_ATTEMPT: request_payload exige contract_version=2';
  end if;
  if v_authoritative_payload->'request_id' is distinct from to_jsonb(p_request_id::text) then
    raise exception 'INVALID_SYNC_ATTEMPT: request_payload no corresponde al request_id activo';
  end if;
  if v_authoritative_payload->'dry_run' is distinct from 'true'::jsonb then
    raise exception 'INVALID_SYNC_ATTEMPT: request_payload debe conservar dry_run=true';
  end if;
  if jsonb_typeof(v_authoritative_payload->'cabecera') is distinct from 'object'
    or jsonb_typeof(v_authoritative_payload->'ctb') is distinct from 'array'
    or jsonb_typeof(v_authoritative_payload->'punteos') is distinct from 'array'
  then
    raise exception 'INVALID_SYNC_ATTEMPT: cabecera, ctb y punteos no respetan el contrato v2';
  end if;

  v_authoritative_header := v_authoritative_payload->'cabecera';
  v_authoritative_ctb := v_authoritative_payload->'ctb';
  v_authoritative_punteos := v_authoritative_payload->'punteos';

  select *
  into v_authoritative_factura
  from jsonb_populate_record(
    null::public.facturasrecibidas,
    v_authoritative_header
  );

  if jsonb_typeof(v_header) <> 'object' then
    raise exception 'INVALID_READBACK: factura debe ser un objeto';
  end if;

  -- La cabecera leida debe conservar las claves de negocio y todos los
  -- importes autoritativos enviados. Los opcionales solo se exigen cuando
  -- estaban informados; ningun default del ERP puede sustituirlos en silencio.
  select expected_field.field_name
  into v_mismatch_field
  from (
    values
      ('FRR_Idempresa'::text, v_authoritative_factura."FRR_Idempresa"::numeric, 0::numeric, true),
      ('FRR_ejercicio', v_authoritative_factura."FRR_ejercicio"::numeric, 0::numeric, true),
      ('FRR_idproveedor', v_authoritative_factura."FRR_idproveedor"::numeric, 0::numeric, true),
      ('FRR_totalfac', v_authoritative_factura."FRR_totalfac"::numeric, 0.01::numeric, true),
      ('FRR_idregimen', v_authoritative_factura."FRR_idregimen"::numeric, 0::numeric, true),
      ('FRR_igasto1', v_authoritative_factura."FRR_igasto1"::numeric, 0.01::numeric, false),
      ('FRR_igasto2', v_authoritative_factura."FRR_igasto2"::numeric, 0.01::numeric, false),
      ('FRR_igasto3', v_authoritative_factura."FRR_igasto3"::numeric, 0.01::numeric, false),
      ('FRR_igasto4', v_authoritative_factura."FRR_igasto4"::numeric, 0.01::numeric, false),
      ('ImporteVto', v_authoritative_factura."ImporteVto"::numeric, 0.01::numeric, false),
      ('FRR_ImporteVto1', v_authoritative_factura."FRR_ImporteVto1"::numeric, 0.01::numeric, false),
      ('FRR_ImporteVto2', v_authoritative_factura."FRR_ImporteVto2"::numeric, 0.01::numeric, false),
      ('FRR_ImporteVto3', v_authoritative_factura."FRR_ImporteVto3"::numeric, 0.01::numeric, false)
  ) as expected_field(field_name, expected_value, tolerance, is_required)
  cross join lateral (
    select case
      when coalesce(v_header->>expected_field.field_name, '') ~ '^-?[0-9]+([.][0-9]+)?$'
        then (v_header->>expected_field.field_name)::numeric
      else null
    end as actual_value
  ) as incoming
  where (
      expected_field.is_required
      and expected_field.expected_value is null
    )
    or (
      expected_field.expected_value is not null
      and (
        incoming.actual_value is null
        or abs(incoming.actual_value - expected_field.expected_value) > expected_field.tolerance
      )
    )
  order by expected_field.field_name
  limit 1;

  if found then
    raise exception 'INVALID_READBACK: la cabecera no coincide en %', v_mismatch_field;
  end if;

  select expected_field.field_name
  into v_mismatch_field
  from (
    values
      (
        'FRR_numerofactura'::text,
        nullif(btrim(v_authoritative_factura."FRR_numerofactura"), ''),
        true
      ),
      ('FRR_idcuenta', nullif(btrim(v_authoritative_factura."FRR_idcuenta"), ''), false),
      ('FRR_tipofactura', nullif(btrim(v_authoritative_factura."FRR_tipofactura"), ''), true),
      ('FRR_ctagasto1', nullif(btrim(v_authoritative_factura."FRR_ctagasto1"), ''), false),
      ('FRR_ctagasto2', nullif(btrim(v_authoritative_factura."FRR_ctagasto2"), ''), false),
      ('FRR_ctagasto3', nullif(btrim(v_authoritative_factura."FRR_ctagasto3"), ''), false),
      ('FRR_ctagasto4', nullif(btrim(v_authoritative_factura."FRR_ctagasto4"), ''), false)
  ) as expected_field(field_name, expected_value, is_required)
  cross join lateral (
    select nullif(btrim(v_header->>expected_field.field_name), '') as actual_value
  ) as incoming
  where (
      expected_field.is_required
      and expected_field.expected_value is null
    )
    or (
      expected_field.expected_value is not null
      and incoming.actual_value is distinct from expected_field.expected_value
    )
  order by expected_field.field_name
  limit 1;

  if found then
    raise exception 'INVALID_READBACK: la cabecera no coincide en %', v_mismatch_field;
  end if;

  select expected_field.field_name
  into v_mismatch_field
  from (
    values
      ('FRR_fechactb'::text, v_authoritative_factura."FRR_fechactb"::text, true),
      ('FechaVto', v_authoritative_factura."FechaVto"::text, false),
      ('FRR_FechaVto1', v_authoritative_factura."FRR_FechaVto1"::text, false),
      ('FRR_FechaVto2', v_authoritative_factura."FRR_FechaVto2"::text, false),
      ('FRR_FechaVto3', v_authoritative_factura."FRR_FechaVto3"::text, false)
  ) as expected_field(field_name, expected_value, is_required)
  cross join lateral (
    select nullif(btrim(v_header->>expected_field.field_name), '') as actual_value
  ) as incoming
  where (
      expected_field.is_required
      and expected_field.expected_value is null
    )
    or (
      expected_field.expected_value is not null
      and incoming.actual_value is distinct from expected_field.expected_value
    )
  order by expected_field.field_name
  limit 1;

  if found then
    raise exception 'INVALID_READBACK: la cabecera no coincide en %', v_mismatch_field;
  end if;

  if jsonb_typeof(p_readback->'ctb') is distinct from 'array'
    or jsonb_typeof(p_readback->'punteos') is distinct from 'array'
  then
    raise exception 'INVALID_READBACK: ctb y punteos deben ser arrays';
  end if;

  -- Mantiene estable el detalle CTB durante validacion y conciliacion.
  perform 1
  from public.facturasrecibidas_ctb
  where factura_id = p_factura_id
  for update;

  select count(*)::integer
  into v_local_ctb_count
  from public.facturasrecibidas_ctb
  where factura_id = p_factura_id;

  v_expected_ctb_count := jsonb_array_length(v_authoritative_ctb);

  -- Mantiene estable la seleccion y sus identidades durante toda la conciliacion.
  perform 1
  from public.facturasrecibidas_punteos
  where factura_id = p_factura_id
  for update;

  select count(*)::integer
  into v_local_punteos_count
  from public.facturasrecibidas_punteos
  where factura_id = p_factura_id
    and "S" is true;

  v_expected_punteos_count := jsonb_array_length(v_authoritative_punteos);

  if v_local_ctb_count <> v_expected_ctb_count then
    raise exception 'INVALID_SYNC_ATTEMPT: CTB local (%) no coincide con el payload inmutable (%)',
      v_local_ctb_count,
      v_expected_ctb_count;
  end if;
  if v_local_punteos_count <> v_expected_punteos_count then
    raise exception 'INVALID_SYNC_ATTEMPT: seleccion local de punteos (%) no coincide con el payload inmutable (%)',
      v_local_punteos_count,
      v_expected_punteos_count;
  end if;

  if exists (
    with local_positions as (
      select posicion
      from public.facturasrecibidas_ctb
      where factura_id = p_factura_id
    ),
    payload_positions as (
      select item.ordinality::integer as posicion
      from jsonb_array_elements(v_authoritative_ctb) with ordinality as item(value, ordinality)
    )
    select 1
    from local_positions
    full join payload_positions using (posicion)
    where local_positions.posicion is null
      or payload_positions.posicion is null
  ) then
    raise exception 'INVALID_SYNC_ATTEMPT: las posiciones CTB locales no coinciden con el payload inmutable';
  end if;

  if jsonb_array_length(v_readback_ctb) <> v_expected_ctb_count then
    raise exception 'INVALID_READBACK: CTB escrito (%) y leido (%) no coincide',
      v_expected_ctb_count,
      jsonb_array_length(v_readback_ctb);
  end if;
  if jsonb_array_length(v_readback_punteos) <> v_expected_punteos_count then
    raise exception 'INVALID_READBACK: punteos seleccionados escritos (%) y leidos (%) no coinciden',
      v_expected_punteos_count,
      jsonb_array_length(v_readback_punteos);
  end if;

  if exists (
    select 1
    from jsonb_array_elements(v_authoritative_ctb) as item(value)
    where jsonb_typeof(item.value) <> 'object'
  ) then
    raise exception 'INVALID_SYNC_ATTEMPT: cada linea CTB del payload debe ser un objeto';
  end if;

  -- CTB sigue siendo posicional por contrato. La comparacion se hace contra el
  -- snapshot enviado, no contra valores locales anteriores a resolver reglas.
  if exists (
    with expected as (
      select
        item.ordinality::integer as posicion,
        nullif(btrim(row_value."FRC_Cuenta"), '') as cuenta,
        row_value."FRC_Importe" as importe,
        row_value."FRC_IdActividad" as actividad,
        row_value."FRC_Idseccion" as seccion,
        row_value."FRC_Iddepartamento" as departamento,
        row_value."FRC_Idsubdepartamento" as subdepartamento
      from jsonb_array_elements(v_authoritative_ctb) with ordinality as item(value, ordinality)
      cross join lateral jsonb_populate_record(
        null::public.facturasrecibidas_ctb,
        item.value
      ) as row_value
    ),
    incoming as (
      select
        item.ordinality::integer as posicion,
        nullif(btrim(item.value->>'FRC_Cuenta'), '') as cuenta,
        case
          when coalesce(item.value->>'FRC_Importe', '') ~ '^-?[0-9]+([.][0-9]+)?$'
            then (item.value->>'FRC_Importe')::numeric
          else null
        end as importe,
        item.value ? 'FRC_IdActividad' as has_actividad,
        case
          when coalesce(item.value->>'FRC_IdActividad', '') ~ '^-?[0-9]+$'
            then (item.value->>'FRC_IdActividad')::numeric
          else null
        end as actividad,
        item.value ? 'FRC_Idseccion' as has_seccion,
        case
          when coalesce(item.value->>'FRC_Idseccion', '') ~ '^-?[0-9]+$'
            then (item.value->>'FRC_Idseccion')::numeric
          else null
        end as seccion,
        item.value ? 'FRC_Iddepartamento' as has_departamento,
        case
          when coalesce(item.value->>'FRC_Iddepartamento', '') ~ '^-?[0-9]+$'
            then (item.value->>'FRC_Iddepartamento')::numeric
          else null
        end as departamento,
        item.value ? 'FRC_Idsubdepartamento' as has_subdepartamento,
        case
          when coalesce(item.value->>'FRC_Idsubdepartamento', '') ~ '^-?[0-9]+$'
            then (item.value->>'FRC_Idsubdepartamento')::numeric
          else null
        end as subdepartamento
      from jsonb_array_elements(v_readback_ctb) with ordinality as item(value, ordinality)
    )
    select 1
    from expected
    full join incoming using (posicion)
    where expected.posicion is null
      or incoming.posicion is null
      or incoming.cuenta is distinct from expected.cuenta
      or expected.importe is null
      or incoming.importe is null
      or abs(incoming.importe - expected.importe) > 0.01
      or (
        expected.actividad is not null
        and (
          not incoming.has_actividad
          or incoming.actividad is distinct from expected.actividad::numeric
        )
      )
      or (
        expected.seccion is not null
        and (
          not incoming.has_seccion
          or incoming.seccion is distinct from expected.seccion::numeric
        )
      )
      or (
        expected.departamento is not null
        and (
          not incoming.has_departamento
          or incoming.departamento is distinct from expected.departamento::numeric
        )
      )
      or (
        expected.subdepartamento is not null
        and (
          not incoming.has_subdepartamento
          or incoming.subdepartamento is distinct from expected.subdepartamento::numeric
        )
      )
  ) then
    raise exception 'INVALID_READBACK: las lineas CTB no coinciden por posicion, cuenta, importe o analitica';
  end if;

  if exists (
    select 1
    from public.facturasrecibidas_punteos selected
    where selected.factura_id = p_factura_id
      and selected."S" is true
      and (
        nullif(btrim(selected.source_table), '') is null
        or selected.source_id is null
        or selected.source_id <= 0
      )
  ) then
    raise exception 'INVALID_PUNTEOS: todo punteo seleccionado requiere source_table y source_id positivo';
  end if;

  if exists (
    select 1
    from public.facturasrecibidas_punteos selected
    where selected.factura_id = p_factura_id
      and selected."S" is true
    group by lower(btrim(selected.source_table)), selected.source_id
    having count(*) <> 1
  ) then
    raise exception 'INVALID_PUNTEOS: identidad source_table + source_id duplicada entre seleccionados';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(v_authoritative_punteos) as item(value)
    where jsonb_typeof(item.value) <> 'object'
      or nullif(btrim(item.value->>'source_table'), '') is null
      or case
        when coalesce(item.value->>'source_id', '') ~ '^[0-9]+$'
          then (item.value->>'source_id')::numeric <= 0
        else true
      end
  ) then
    raise exception 'INVALID_SYNC_ATTEMPT: todo punteo del payload requiere identidad ERP valida';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(v_authoritative_punteos) as item(value)
    group by lower(btrim(item.value->>'source_table')), (item.value->>'source_id')::numeric
    having count(*) <> 1
  ) then
    raise exception 'INVALID_SYNC_ATTEMPT: identidad de punteo duplicada en el payload inmutable';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(v_authoritative_punteos) as item(value)
    where item.value ? 'importe_factura'
      and coalesce(item.value->>'importe_factura', '') !~ '^-?[0-9]+([.][0-9]+)?$'
  ) then
    raise exception 'INVALID_SYNC_ATTEMPT: importe_factura explicito debe ser numerico';
  end if;

  if exists (
    with selected as (
      select
        lower(btrim(source_table)) as source_table_key,
        source_id::numeric as source_id_key
      from public.facturasrecibidas_punteos
      where factura_id = p_factura_id
        and "S" is true
    ),
    expected as (
      select
        lower(btrim(item.value->>'source_table')) as source_table_key,
        (item.value->>'source_id')::numeric as source_id_key
      from jsonb_array_elements(v_authoritative_punteos) as item(value)
    )
    select 1
    from selected
    full join expected using (source_table_key, source_id_key)
    where selected.source_table_key is null
      or expected.source_table_key is null
  ) then
    raise exception 'INVALID_SYNC_ATTEMPT: los punteos locales no coinciden con el payload inmutable';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(v_readback_punteos) as item(value)
    where nullif(btrim(item.value->>'source_table'), '') is null
      or case
        when coalesce(item.value->>'source_id', '') ~ '^[0-9]+$'
          then (item.value->>'source_id')::numeric <= 0
        else true
      end
  ) then
    raise exception 'INVALID_READBACK: todo punteo leido requiere source_table y source_id positivo';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(v_readback_punteos) as item(value)
    group by lower(btrim(item.value->>'source_table')), (item.value->>'source_id')::numeric
    having count(*) <> 1
  ) then
    raise exception 'INVALID_READBACK: identidad source_table + source_id duplicada en punteos leidos';
  end if;

  if exists (
    with expected as (
      select
        lower(btrim(item.value->>'source_table')) as source_table_key,
        (item.value->>'source_id')::numeric as source_id_key
      from jsonb_array_elements(v_authoritative_punteos) as item(value)
    ),
    incoming as (
      select
        lower(btrim(item.value->>'source_table')) as source_table_key,
        (item.value->>'source_id')::numeric as source_id_key
      from jsonb_array_elements(v_readback_punteos) as item(value)
    )
    select 1
    from expected
    full join incoming using (source_table_key, source_id_key)
    where expected.source_table_key is null
      or incoming.source_table_key is null
  ) then
    raise exception 'INVALID_READBACK: los punteos leidos no coinciden con el payload inmutable';
  end if;

  if exists (
    with expected as (
      select
        lower(btrim(item.value->>'source_table')) as source_table_key,
        (item.value->>'source_id')::numeric as source_id_key,
        item.value ? 'importe_factura' as has_importe_factura,
        case
          when coalesce(item.value->>'importe_factura', '') ~ '^-?[0-9]+([.][0-9]+)?$'
            then (item.value->>'importe_factura')::numeric
          else null
        end as importe_factura
      from jsonb_array_elements(v_authoritative_punteos) as item(value)
    ),
    incoming as (
      select
        lower(btrim(item.value->>'source_table')) as source_table_key,
        (item.value->>'source_id')::numeric as source_id_key,
        item.value ? 'importe_factura' as has_importe_factura,
        case
          when coalesce(item.value->>'importe_factura', '') ~ '^-?[0-9]+([.][0-9]+)?$'
            then (item.value->>'importe_factura')::numeric
          else null
        end as importe_factura
      from jsonb_array_elements(v_readback_punteos) as item(value)
    )
    select 1
    from expected
    join incoming
      using (source_table_key, source_id_key)
    where expected.has_importe_factura
      and (
        not incoming.has_importe_factura
        or incoming.importe_factura is null
        or abs(incoming.importe_factura - expected.importe_factura) > 0.01
      )
  ) then
    raise exception 'INVALID_READBACK: importe_factura no coincide con el payload inmutable';
  end if;

  update public.facturasrecibidas_ctb existing
  set "FRC_id" = coalesce(incoming."FRC_id", existing."FRC_id"),
      "FRC_idfacturarecibida" = v_remote_id,
      "FRC_Importe" = coalesce(incoming."FRC_Importe", existing."FRC_Importe"),
      "FRC_Cuenta" = coalesce(incoming."FRC_Cuenta", existing."FRC_Cuenta"),
      "FRC_IdActividad" = coalesce(incoming."FRC_IdActividad", existing."FRC_IdActividad"),
      "FRC_Idseccion" = coalesce(incoming."FRC_Idseccion", existing."FRC_Idseccion"),
      "FRC_Iddepartamento" = coalesce(incoming."FRC_Iddepartamento", existing."FRC_Iddepartamento"),
      "FRC_Idsubdepartamento" = coalesce(incoming."FRC_Idsubdepartamento", existing."FRC_Idsubdepartamento"),
      "FRC_IdUsuarioLog" = incoming."FRC_IdUsuarioLog",
      "FRC_FechaLog" = incoming."FRC_FechaLog",
      "FRC_HoraLog" = incoming."FRC_HoraLog",
      updated_at = now()
  from (
    select
      item.ordinality::integer as incoming_position,
      row_value."FRC_id",
      row_value."FRC_Importe",
      row_value."FRC_Cuenta",
      row_value."FRC_IdActividad",
      row_value."FRC_Idseccion",
      row_value."FRC_Iddepartamento",
      row_value."FRC_Idsubdepartamento",
      row_value."FRC_IdUsuarioLog",
      row_value."FRC_FechaLog",
      row_value."FRC_HoraLog"
    from jsonb_array_elements(v_readback_ctb) with ordinality as item(value, ordinality)
    cross join lateral jsonb_populate_record(
      null::public.facturasrecibidas_ctb,
      item.value
    ) as row_value
  ) incoming
  where existing.factura_id = p_factura_id
    and existing.posicion = incoming.incoming_position;

  get diagnostics v_updated_ctb_count = row_count;
  if v_updated_ctb_count <> v_expected_ctb_count then
    raise exception 'INVALID_READBACK: se conciliaron % lineas CTB y se esperaban %',
      v_updated_ctb_count,
      v_expected_ctb_count;
  end if;

  update public.facturasrecibidas_punteos existing
  set remote_id = coalesce(incoming.remote_id, existing.remote_id),
      "Origen" = coalesce(incoming."Origen", existing."Origen"),
      "Serie" = coalesce(incoming."Serie", existing."Serie"),
      "Albaran" = coalesce(incoming."Albaran", existing."Albaran"),
      "Ref" = coalesce(incoming."Ref", existing."Ref"),
      "Fecha" = coalesce(incoming."Fecha", existing."Fecha"),
      "Importe P" = coalesce(incoming."Importe P", existing."Importe P"),
      "Importe" = coalesce(incoming."Importe", existing."Importe"),
      "Ver" = coalesce(incoming."Ver", existing."Ver"),
      empresa_id = coalesce(incoming.empresa_id, existing.empresa_id),
      proveedor_id = coalesce(incoming.proveedor_id, existing.proveedor_id),
      cuenta_gasto = coalesce(incoming.cuenta_gasto, existing.cuenta_gasto),
      raw = coalesce(incoming.raw, incoming.raw_value, existing.raw),
      importe_factura = coalesce(incoming.importe_factura, existing.importe_factura),
      line_count = coalesce(incoming.line_count, existing.line_count),
      source_lines = coalesce(incoming.source_lines, existing.source_lines),
      updated_at = now()
  from (
    select
      item.value as raw_value,
      lower(btrim(row_value.source_table)) as source_table_key,
      row_value.source_id as source_id_key,
      row_value.remote_id,
      row_value."Origen",
      row_value."Serie",
      row_value."Albaran",
      row_value."Ref",
      row_value."Fecha",
      row_value."Importe P",
      row_value."Importe",
      row_value."Ver",
      row_value.empresa_id,
      row_value.proveedor_id,
      row_value.cuenta_gasto,
      row_value.raw,
      row_value.importe_factura,
      row_value.line_count,
      row_value.source_lines
    from jsonb_array_elements(v_readback_punteos) as item(value)
    cross join lateral jsonb_populate_record(
      null::public.facturasrecibidas_punteos,
      item.value
    ) as row_value
  ) incoming
  where existing.factura_id = p_factura_id
    and existing."S" is true
    and lower(btrim(existing.source_table)) = incoming.source_table_key
    and existing.source_id = incoming.source_id_key;

  get diagnostics v_updated_punteos_count = row_count;
  if v_updated_punteos_count <> v_expected_punteos_count then
    raise exception 'INVALID_READBACK: se conciliaron % punteos y se esperaban % seleccionados',
      v_updated_punteos_count,
      v_expected_punteos_count;
  end if;

  v_technical_text := coalesce(
    nullif(v_accounting->>'technical_id', ''),
    nullif(v_accounting->>'FRR_IdAsientoNet', ''),
    nullif(v_header->>'FRR_IdAsientoNet', '')
  );
  if v_technical_text ~ '^[0-9]+$' then
    v_technical_id := v_technical_text::bigint;
  end if;

  v_visible_number := coalesce(
    nullif(v_accounting->>'visible_number', ''),
    nullif(v_accounting->>'numero', ''),
    nullif(v_accounting->>'asiento', '')
  );

  begin
    v_accounting_date := coalesce(
      nullif(v_accounting->>'date', '')::date,
      nullif(v_accounting->>'fecha', '')::date,
      nullif(v_header->>'FRR_fechactb', '')::date
    );
  exception when invalid_datetime_format then
    v_accounting_date := null;
  end;

  v_lines := coalesce(
    v_accounting->'lines',
    v_accounting->'apuntes',
    p_readback->'apuntes',
    '[]'::jsonb
  );
  if jsonb_typeof(v_lines) <> 'array' then
    v_lines := '[]'::jsonb;
  end if;

  select
    count(*)::integer,
    coalesce(sum(
      case
        when coalesce(line.value->>'debe', line.value->>'debit', '') ~ '^[0-9]+([.][0-9]+)?$'
          then coalesce(line.value->>'debe', line.value->>'debit')::numeric
        when lower(coalesce(line.value->>'side', line.value->>'lado', '')) = 'debe'
          and coalesce(line.value->>'amount', line.value->>'importe', '') ~ '^[0-9]+([.][0-9]+)?$'
          then coalesce(line.value->>'amount', line.value->>'importe')::numeric
        else 0
      end
    ), 0),
    coalesce(sum(
      case
        when coalesce(line.value->>'haber', line.value->>'credit', '') ~ '^[0-9]+([.][0-9]+)?$'
          then coalesce(line.value->>'haber', line.value->>'credit')::numeric
        when lower(coalesce(line.value->>'side', line.value->>'lado', '')) = 'haber'
          and coalesce(line.value->>'amount', line.value->>'importe', '') ~ '^[0-9]+([.][0-9]+)?$'
          then coalesce(line.value->>'amount', line.value->>'importe')::numeric
        else 0
      end
    ), 0)
  into v_line_count, v_total_debit, v_total_credit
  from jsonb_array_elements(v_lines) as line(value);

  v_balanced :=
    v_line_count > 0
    and v_total_debit > 0
    and v_total_credit > 0
    and abs(v_total_debit - v_total_credit) <= 0.01;

  v_accounting_reported_status := lower(btrim(coalesce(v_accounting->>'status', '')));
  v_accounting_reported_created := coalesce(v_accounting->'created' = 'true'::jsonb, false);

  if v_accounting_reported_status = 'reference_only' then
    raise exception 'INVALID_READBACK: accounting.status=reference_only no confirma la creacion de un asiento';
  end if;

  v_accounting_status := case
    when v_accounting_reported_status = 'error' then 'error'
    when v_accounting_reported_status = 'unknown' then 'unknown'
    when v_accounting_reported_status = 'created'
      and v_accounting_reported_created
      and coalesce(v_technical_id, 0) > 0
      and nullif(btrim(v_visible_number), '') is not null
      and v_balanced
      then 'created'
    when coalesce(v_technical_id, 0) > 0 or v_visible_number is not null then 'pending'
    when coalesce(v_current."FRR_Contabilizar", 'N') = 'S' then 'pending'
    else 'not_requested'
  end;

  if coalesce(v_current."FRR_Contabilizar", 'N') = 'S'
    and (
      v_accounting_status <> 'created'
      or coalesce(v_technical_id, 0) <= 0
      or v_visible_number is null
      or v_line_count <= 0
      or not v_balanced
    )
  then
    raise exception 'INVALID_READBACK: contabilizacion solicitada exige asiento creado, numero visible e importes Debe/Haber cuadrados';
  end if;

  if coalesce(v_current."FRR_Contabilizar", 'N') = 'S'
    and jsonb_typeof(v_accounting) = 'object'
    and (v_accounting <> '{}'::jsonb or v_line_count > 0)
  then
    insert into public.facturasrecibidas_asientos (
      factura_id,
      request_id,
      technical_id,
      visible_number,
      accounting_date,
      concept,
      status,
      total_debit,
      total_credit,
      balanced,
      raw
    ) values (
      p_factura_id,
      p_request_id,
      v_technical_id,
      v_visible_number,
      v_accounting_date,
      coalesce(
        nullif(v_accounting->>'concept', ''),
        nullif(v_accounting->>'concepto', ''),
        nullif(v_header->>'FRR_Concepto', '')
      ),
      case when v_accounting_status = 'not_requested' then 'pending' else v_accounting_status end,
      v_total_debit,
      v_total_credit,
      v_balanced,
      v_accounting
    )
    on conflict (factura_id, request_id) do nothing
    returning id into v_asiento_id;

    if v_asiento_id is null then
      select id
      into v_asiento_id
      from public.facturasrecibidas_asientos
      where factura_id = p_factura_id
        and request_id = p_request_id;
    end if;

    insert into public.facturasrecibidas_asiento_apuntes (
      asiento_id,
      posicion,
      cuenta,
      descripcion,
      debe,
      haber,
      analytic,
      raw
    )
    select
      v_asiento_id,
      line.ordinality::integer,
      coalesce(
        nullif(line.value->>'cuenta', ''),
        nullif(line.value->>'account', ''),
        nullif(line.value->>'account_code', '')
      ),
      coalesce(
        nullif(line.value->>'descripcion', ''),
        nullif(line.value->>'concepto', ''),
        nullif(line.value->>'description', '')
      ),
      case
        when coalesce(line.value->>'debe', line.value->>'debit', '') ~ '^[0-9]+([.][0-9]+)?$'
          then coalesce(line.value->>'debe', line.value->>'debit')::numeric
        when lower(coalesce(line.value->>'side', line.value->>'lado', '')) = 'debe'
          and coalesce(line.value->>'amount', line.value->>'importe', '') ~ '^[0-9]+([.][0-9]+)?$'
          then coalesce(line.value->>'amount', line.value->>'importe')::numeric
        else 0
      end,
      case
        when coalesce(line.value->>'haber', line.value->>'credit', '') ~ '^[0-9]+([.][0-9]+)?$'
          then coalesce(line.value->>'haber', line.value->>'credit')::numeric
        when lower(coalesce(line.value->>'side', line.value->>'lado', '')) = 'haber'
          and coalesce(line.value->>'amount', line.value->>'importe', '') ~ '^[0-9]+([.][0-9]+)?$'
          then coalesce(line.value->>'amount', line.value->>'importe')::numeric
        else 0
      end,
      coalesce(line.value->'analytic', line.value->'analitica', '{}'::jsonb),
      line.value
    from jsonb_array_elements(v_lines) with ordinality as line(value, ordinality)
    on conflict (asiento_id, posicion) do nothing;
  end if;

  update public.facturasrecibidas
  set estado = 'enviada_erp',
      sync_status = 'sent',
      accounting_status = v_accounting_status,
      accounting_visible_number = v_visible_number,
      accounting_date = v_accounting_date,
      "FRR_ejercicio" = v_authoritative_factura."FRR_ejercicio",
      "FRR_tipofactura" = v_authoritative_factura."FRR_tipofactura",
      "FRR_idregimen" = v_authoritative_factura."FRR_idregimen",
      "FRR_fechactb" = v_authoritative_factura."FRR_fechactb",
      "FRR_id" = v_remote_id,
      remote_frr_id = v_remote_id,
      "FRR_numero" = case
        when coalesce(v_header->>'FRR_numero', p_write_response->>'FRR_numero', '') ~ '^[0-9]+$'
          then coalesce(v_header->>'FRR_numero', p_write_response->>'FRR_numero')::bigint
        else "FRR_numero"
      end,
      "FRR_IdAsientoNet" = coalesce(v_technical_id, "FRR_IdAsientoNet"),
      erp_sent_at = coalesce(erp_sent_at, now()),
      erp_sent_by = coalesce(erp_sent_by, p_actor),
      erp_response = p_write_response,
      erp_error = null,
      erp_last_read_at = now(),
      erp_last_read_payload = p_readback,
      row_version = row_version + 1,
      updated_by = p_actor,
      updated_at = now()
  where id = p_factura_id
  returning * into v_current;

  insert into public.facturasrecibidas_sync_attempts (
    factura_id,
    request_id,
    phase,
    dry_run,
    status,
    response_payload,
    completed_at,
    created_by
  ) values (
    p_factura_id,
    p_request_id,
    'readback',
    false,
    'succeeded',
    p_readback,
    now(),
    p_actor
  )
  on conflict (request_id, phase) do update
    set status = 'succeeded',
        response_payload = excluded.response_payload,
        error = null,
        completed_at = now(),
        updated_at = now();

  v_snapshot := public.factura_recibida_snapshot_v2(p_factura_id);
  insert into public.facturasrecibidas_revisions (
    factura_id,
    revision_number,
    request_id,
    change_type,
    change_source,
    changed_by,
    snapshot
  ) values (
    p_factura_id,
    v_current.row_version,
    p_request_id,
    'sync_finalize',
    'edge_readback',
    p_actor,
    v_snapshot
  );

  return jsonb_build_object(
    'factura', to_jsonb(v_current),
    'version', v_current.row_version,
    'request_id', p_request_id,
    'accounting', case when v_asiento_id is null then jsonb_build_object(
      'status', v_accounting_status,
      'technical_id', v_technical_id,
      'visible_number', v_visible_number,
      'date', v_accounting_date
    ) else (
      select to_jsonb(a) || jsonb_build_object(
        'lines',
        coalesce((
          select jsonb_agg(to_jsonb(l) order by l.posicion)
          from public.facturasrecibidas_asiento_apuntes l
          where l.asiento_id = a.id
        ), '[]'::jsonb)
      )
      from public.facturasrecibidas_asientos a
      where a.id = v_asiento_id
    ) end
  );
end;
$$;

comment on function public.finalize_factura_recibida_sync_v2(uuid, uuid, jsonb, jsonb, uuid) is
  'Finaliza contra el request_payload dry-run inmutable: valida cabecera, CTB y punteos S=true; un asiento solo se crea con status=created y created=true.';

-- Corrige exclusivamente el envio manual ya confirmado que quedo sin el alias
-- local remote_frr_id. Las referencias ERP importadas quedan fuera de alcance.
update public.facturasrecibidas
set remote_frr_id = "FRR_id"
where estado = 'enviada_erp'
  and sync_status = 'sent'
  and source_kind = 'manual_draft'
  and is_readonly_reference is false
  and remote_frr_id is null
  and "FRR_id" > 0;
