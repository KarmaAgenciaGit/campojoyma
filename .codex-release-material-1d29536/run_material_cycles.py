from __future__ import annotations

import fcntl
import json
import os
import sqlite3
import sys
import urllib.error
import urllib.parse
import urllib.request
from copy import deepcopy
from decimal import Decimal
from pathlib import Path
from typing import Any

import pymysql
from pymysql.cursors import DictCursor


BASE_URL = "http://127.0.0.1:8001"
TARGET_ID = "netagro-test-write"
DATASET_EPOCH = "a67774b7-d9bf-4a8a-8a93-95b3e08a5f7c"
SCHEMA = "netagrocomer_test_write"
RELEASE = Path("/home/karma/releases/api-campojoyma-current")
EXPECTED_RELEASE = Path(
    "/home/karma/releases/"
    "api-campojoyma-v0.3.15-20260806T101234Z-material-writer-1d29536"
)
RUNTIME_ENV = Path("/home/karma/.config/netagro-api-v2/runtime.env")
MAINTENANCE_LOCK = Path("/home/karma/.config/netagro-api-v2/maintenance.lock")
IDEMPOTENCY_DB = Path(
    "/home/karma/.local/state/netagro-api/idempotency/"
    "a67774b7-d9bf-4a8a-8a93-95b3e08a5f7c.sqlite3"
)
REQUEST_A = "260806a0-0209-4001-8000-000000000001"
REQUEST_B = "260806b0-0017-4001-8000-000000000001"
REQUEST_NEGATIVE = "260806b0-0017-4001-8000-000000000099"
REQUEST_IDS = (REQUEST_A, REQUEST_B, REQUEST_NEGATIVE)


def fail(message: str) -> None:
    raise RuntimeError(message)


def emit(label: str, value: Any) -> None:
    print(f"{label}=" + json.dumps(value, ensure_ascii=False, sort_keys=True, default=str), flush=True)


def load_env(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    for number, original in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        line = original.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[7:].lstrip()
        key, separator, raw = line.partition("=")
        if not separator:
            fail(f"invalid runtime assignment at line {number}")
        key = key.strip()
        raw = raw.strip()
        if len(raw) >= 2 and raw[0] == raw[-1] and raw[0] in {"'", '"'}:
            quote = raw[0]
            raw = raw[1:-1]
            if quote == '"':
                raw = raw.replace(r'\"', '"').replace(r"\\", "\\")
        if key in values:
            fail(f"duplicate runtime key: {key}")
        values[key] = raw
    return values


ENV = load_env(RUNTIME_ENV)
API_SECRET = ENV.get("NETAGRO_API_SHARED_SECRET", "")
if not API_SECRET:
    fail("API shared secret is absent")


def api_json(method: str, path: str, body: bytes | None = None) -> dict[str, Any]:
    headers = {
        "Accept": "application/json",
        "X-Netagro-Api-Key": API_SECRET,
    }
    if body is not None:
        headers["Content-Type"] = "application/json"
    request = urllib.request.Request(
        BASE_URL + path,
        data=body,
        headers=headers,
        method=method,
    )
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            if response.status != 200:
                fail(f"unexpected HTTP status {response.status} for {method} {path}")
            parsed = json.load(response)
    except urllib.error.HTTPError as error:
        try:
            detail = json.loads(error.read().decode("utf-8"))
        except Exception:
            detail = {"detail": "non-JSON API error"}
        fail(f"HTTP {error.code} for {method} {path}: {json.dumps(detail, ensure_ascii=False)}")
    if not isinstance(parsed, dict):
        fail(f"non-object response for {method} {path}")
    return parsed


def assert_gate() -> dict[str, Any]:
    health = api_json("GET", "/health")
    meta = api_json("GET", "/meta/runtime")
    if health.get("status") != "ok":
        fail("health is not ok")
    if health.get("writes_enabled") is not True:
        fail("management write gate changed")
    if health.get("accounting_writes_enabled") is not True:
        fail("accounting write gate changed")
    if health.get("albmaterial_create_enabled") is not True:
        fail("material create gate changed")
    if meta.get("target_id") != TARGET_ID or meta.get("dataset_epoch") != DATASET_EPOCH:
        fail("runtime target identity changed")
    if meta.get("write_schema") != SCHEMA:
        fail("runtime write schema changed")
    if meta.get("material_ready_for_commit") is not True:
        fail("material runtime is no longer ready")
    if meta.get("capabilities", {}).get("material_commit") is not True:
        fail("material commit capability is no longer ready")
    return meta


def reader_connection():
    return pymysql.connect(
        host="127.0.0.1",
        port=3307,
        user=ENV["DB_WRITE_READ_USER"],
        password=ENV["DB_WRITE_READ_PASSWORD"],
        charset="utf8mb4",
        cursorclass=DictCursor,
        connect_timeout=10,
        read_timeout=30,
        autocommit=True,
    )


COUNTER_KEYS = (
    ("albMaterial", ""),
    ("albMaterial", "A26"),
    ("albmateriallineas", ""),
    ("ValeEnvases", ""),
    ("ValeEnvases_Lineas", ""),
)


def business_snapshot() -> dict[str, Any]:
    with reader_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                f"""
                SELECT
                  (SELECT COUNT(*) FROM {SCHEMA}.albmaterial) AS albmaterial,
                  (SELECT COUNT(*) FROM {SCHEMA}.albmateriallineas) AS albmateriallineas,
                  (SELECT COUNT(*) FROM {SCHEMA}.valeenvases) AS valeenvases,
                  (SELECT COUNT(*) FROM {SCHEMA}.valeenvases_lineas) AS valeenvases_lineas,
                  (SELECT COUNT(*) FROM {SCHEMA}.facturasrecibidas) AS facturasrecibidas
                """
            )
            counts = {key: int(value) for key, value in cursor.fetchone().items()}
            conditions = " OR ".join(
                "(CON_NombreTabla=%s AND COALESCE(CON_TipoContador, '')=%s)"
                for _ in COUNTER_KEYS
            )
            params = tuple(value for pair in COUNTER_KEYS for value in pair)
            cursor.execute(
                f"""
                SELECT CON_NombreTabla, COALESCE(CON_TipoContador, '') AS counter_type,
                       CON_UltimoNumero, CON_IdUsuario
                FROM {SCHEMA}.contadores
                WHERE {conditions}
                ORDER BY CON_NombreTabla, counter_type
                """,
                params,
            )
            rows = cursor.fetchall()
            counters = {
                f"{row['CON_NombreTabla']}|{row['counter_type']}": {
                    "value": int(row["CON_UltimoNumero"]),
                    "user": int(row["CON_IdUsuario"]),
                }
                for row in rows
            }
            if len(counters) != 5:
                fail(f"expected five material counters, got {len(counters)}")
            cursor.execute(
                f"""
                SELECT VEV_Observaciones2 AS marker, COUNT(*) AS row_count
                FROM {SCHEMA}.valeenvases
                WHERE VEV_Observaciones2 IN (%s, %s, %s)
                GROUP BY VEV_Observaciones2
                ORDER BY VEV_Observaciones2
                """,
                tuple(f"NETAGRO-MA:{request_id}" for request_id in REQUEST_IDS),
            )
            markers = {
                str(row["marker"]): int(row["row_count"]) for row in cursor.fetchall()
            }
            cursor.execute(
                f"""
                SELECT AMA_referencia AS reference, COUNT(*) AS row_count
                FROM {SCHEMA}.albmaterial
                WHERE AMA_referencia IN (%s, %s)
                GROUP BY AMA_referencia
                ORDER BY AMA_referencia
                """,
                ("T260806-MA-209-A", "T260806-MA-017-B"),
            )
            references = {
                str(row["reference"]): int(row["row_count"]) for row in cursor.fetchall()
            }
    return {"counts": counts, "counters": counters, "markers": markers, "references": references}


def idempotency_snapshot() -> dict[str, Any]:
    connection = sqlite3.connect(f"{IDEMPOTENCY_DB.resolve().as_uri()}?mode=ro", uri=True, timeout=10)
    connection.row_factory = sqlite3.Row
    try:
        total = int(connection.execute("SELECT COUNT(*) FROM factura_requests").fetchone()[0])
        placeholders = ",".join("?" for _ in REQUEST_IDS)
        rows = connection.execute(
            f"""
            SELECT request_id, payload_hash, target_id, dataset_epoch, circuit,
                   phase, status, created_at, updated_at
            FROM factura_requests
            WHERE request_id IN ({placeholders})
            ORDER BY request_id
            """,
            REQUEST_IDS,
        ).fetchall()
    finally:
        connection.close()
    return {"total": total, "rows": [dict(row) for row in rows]}


def snapshot() -> dict[str, Any]:
    return {"business": business_snapshot(), "idempotency": idempotency_snapshot()}


def table_delta(before: dict[str, Any], after: dict[str, Any]) -> dict[str, int]:
    return {
        key: after["counts"][key] - before["counts"][key]
        for key in before["counts"]
    }


def counter_values(state: dict[str, Any]) -> dict[str, int]:
    return {key: int(value["value"]) for key, value in state["counters"].items()}


def counter_delta(before: dict[str, Any], after: dict[str, Any]) -> dict[str, int]:
    old = counter_values(before)
    new = counter_values(after)
    return {key: new[key] - old[key] for key in old}


def assert_one_commit_delta(before: dict[str, Any], after: dict[str, Any]) -> None:
    expected_tables = {
        "albmaterial": 1,
        "albmateriallineas": 1,
        "valeenvases": 1,
        "valeenvases_lineas": 1,
        "facturasrecibidas": 0,
    }
    observed_tables = table_delta(before, after)
    if observed_tables != expected_tables:
        fail(f"unexpected business row delta: {observed_tables}")
    observed_counters = counter_delta(before, after)
    if set(observed_counters.values()) != {1}:
        fail(f"unexpected counter delta: {observed_counters}")


def decimal_value(value: Any) -> Decimal:
    return Decimal(str(value))


def assert_validate(response: dict[str, Any], expected_total: str) -> None:
    if response.get("operation") != "validate" or response.get("dry_run") is not True:
        fail("validate response has the wrong operation")
    if response.get("ok") is not True or response.get("would_create") is not True:
        fail("validate response is not eligible")
    if response.get("validations", {}).get("errors") != []:
        fail("validate response contains errors")
    if response.get("capabilities", {}).get("material_commit") is not True:
        fail("validate response does not expose material commit")
    header = response.get("albaran") or {}
    if decimal_value(header.get("importe_calculado")) != Decimal(expected_total):
        fail("validate calculated total is not exact")
    if decimal_value(header.get("importe_esperado")) != Decimal(expected_total):
        fail("validate expected total is not exact")


def assert_commit(response: dict[str, Any], expected_total: str) -> None:
    if response.get("operation") != "commit" or response.get("dry_run") is not False:
        fail("commit response has the wrong operation")
    if response.get("ok") is not True or response.get("would_create") is not True:
        fail("commit response is not ok")
    if response.get("readback_confirmed") is not True:
        fail("commit readback was not confirmed")
    if response.get("validations", {}).get("errors") != []:
        fail("commit response contains validation errors")
    if decimal_value((response.get("albaran") or {}).get("AMA_importe")) != Decimal(expected_total):
        fail("committed material total is not exact")
    if len(response.get("lineas") or []) != 1:
        fail("commit did not create exactly one material line")
    if not response.get("vale_envases") or len(response.get("vale_envases_lineas") or []) != 1:
        fail("commit did not create the exact vale relationship")


def summary(response: dict[str, Any]) -> dict[str, Any]:
    header = response["albaran"]
    line = response["lineas"][0]
    vale = response["vale_envases"]
    vale_line = response["vale_envases_lineas"][0]
    return {
        "request_id": response["request_id"],
        "payload_hash": response["payload_hash"],
        "albaran_id": int(header["AMA_idalb"]),
        "serie": header["AMA_serie"],
        "numero": int(header["AMA_numero"]),
        "proveedor_id": int(header["AMA_idacreedor"]),
        "importe": str(header["AMA_importe"]),
        "linea_id": int(line["AML_idlinea"]),
        "material_id": int(line["AML_idmaterial"]),
        "vale_id": int(vale["VEV_idvale"]),
        "vale_linea_id": int(vale_line["VEL_id"]),
        "marker": vale["VEV_Observaciones2"],
        "readback_confirmed": response["readback_confirmed"],
    }


def assert_delivery(response: dict[str, Any], *, provider: int, reference: str, total: str, request_id: str) -> None:
    header = response["albaran"]
    line = response["lineas"][0]
    vale = response["vale_envases"]
    vale_line = response["vale_envases_lineas"][0]
    if int(header["AMA_idacreedor"]) != provider or header["AMA_referencia"] != reference:
        fail("committed header identity mismatch")
    if decimal_value(header["AMA_importe"]) != Decimal(total):
        fail("committed header total mismatch")
    if int(header["AMA_idvaleenvase"]) != int(vale["VEV_idvale"]):
        fail("header-to-vale relationship mismatch")
    if int(line["AML_idalb"]) != int(header["AMA_idalb"]):
        fail("line-to-header relationship mismatch")
    if int(vale_line["VEL_idvale"]) != int(vale["VEV_idvale"]):
        fail("vale-line relationship mismatch")
    if int(line["AML_idmaterial"]) != 905 or int(vale_line["VEL_idenvase"]) != 905:
        fail("material relationship mismatch")
    if vale["VEV_Observaciones2"] != f"NETAGRO-MA:{request_id}":
        fail("request marker mismatch")


def assert_target_get(response: dict[str, Any], committed: dict[str, Any]) -> None:
    for key in ("albaran", "lineas", "vale_envases", "vale_envases_lineas"):
        if response.get(key) != committed.get(key):
            fail(f"target-aware GET mismatch in {key}")


def post_bytes(payload: dict[str, Any]) -> bytes:
    return json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")


def run_cycle(
    label: str,
    payload: dict[str, Any],
    expected_total: str,
    *,
    replay_commit: bool,
) -> tuple[dict[str, Any], dict[str, Any]]:
    assert_gate()
    before_validate = snapshot()
    validate_bytes = post_bytes(payload)
    validated = api_json("POST", "/albaranes/material", validate_bytes)
    assert_validate(validated, expected_total)
    after_validate = snapshot()
    if after_validate["business"] != before_validate["business"]:
        fail(f"{label} validate changed business rows/counters")
    idem_rows = {row["request_id"]: row for row in after_validate["idempotency"]["rows"]}
    idem_row = idem_rows.get(payload["request_id"])
    if not idem_row or idem_row["status"] != "validated" or idem_row["phase"] != "validate":
        fail(f"{label} validate idempotency state is not validated")
    emit(f"{label}_VALIDATE", {
        "ok": True,
        "would_create": True,
        "total": expected_total,
        "payload_hash": validated["payload_hash"],
        "business_unchanged": True,
    })

    assert_gate()
    commit_payload = deepcopy(payload)
    commit_payload["operation"] = "commit"
    commit_bytes = post_bytes(commit_payload)
    committed = api_json("POST", "/albaranes/material", commit_bytes)
    assert_commit(committed, expected_total)
    if committed["payload_hash"] != validated["payload_hash"]:
        fail(f"{label} validate/commit payload hashes differ")
    assert_delivery(
        committed,
        provider=int(payload["cabecera"]["acreedor_id"]),
        reference=str(payload["cabecera"]["referencia"]),
        total=expected_total,
        request_id=str(payload["request_id"]),
    )
    after_commit = snapshot()
    assert_one_commit_delta(before_validate["business"], after_commit["business"])
    idem_rows = {row["request_id"]: row for row in after_commit["idempotency"]["rows"]}
    idem_row = idem_rows.get(payload["request_id"])
    if not idem_row or idem_row["status"] != "completed" or idem_row["phase"] != "commit":
        fail(f"{label} commit idempotency state is not completed")
    emit(f"{label}_COMMIT", summary(committed))

    after_replay = after_commit
    if replay_commit:
        assert_gate()
        replayed = api_json("POST", "/albaranes/material", commit_bytes)
        if replayed != committed:
            fail(f"{label} exact commit replay response changed")
        after_replay = snapshot()
        if after_replay != after_commit:
            fail(f"{label} exact commit replay changed rows, counters or idempotency")
        emit(f"{label}_REPLAY", {
            "same_response": True,
            "same_ids": summary(replayed),
            "table_delta": table_delta(after_commit["business"], after_replay["business"]),
            "counter_delta": counter_delta(after_commit["business"], after_replay["business"]),
            "idempotency_unchanged": True,
        })

    material_id = int(committed["albaran"]["AMA_idalb"])
    query = urllib.parse.urlencode({"target_id": TARGET_ID, "dataset_epoch": DATASET_EPOCH})
    target_get = api_json("GET", f"/albaranes/material/{material_id}?{query}")
    line_get = api_json("GET", f"/albaranes/material/{material_id}/lineas?{query}")
    assert_target_get(target_get, committed)
    items = line_get.get("items") or []
    if (
        len(items) != 1
        or int(items[0].get("line_id") or 0)
        != int(committed["lineas"][0]["AML_idlinea"])
        or int(items[0].get("article_id") or 0)
        != int(committed["lineas"][0]["AML_idmaterial"])
    ):
        fail(f"{label} target-aware line GET mismatch")
    emit(f"{label}_GET", {
        "header_and_four_tables_match": True,
        "line_summary_count": 1,
        "albaran_id": material_id,
        "vale_id": int(committed["vale_envases"]["VEV_idvale"]),
        "provider_id": int(committed["albaran"]["AMA_idacreedor"]),
        "total": str(committed["albaran"]["AMA_importe"]),
        "marker": committed["vale_envases"]["VEV_Observaciones2"],
    })
    return committed, after_replay


def main() -> int:
    preflight_only = sys.argv[1:] == ["--preflight-only"]
    if sys.argv[1:] and not preflight_only:
        fail("only --preflight-only is supported")
    if Path(os.path.realpath(RELEASE)) != EXPECTED_RELEASE:
        fail("active release changed")
    expected_env = {
        "NETAGRO_ENVIRONMENT": "test",
        "NETAGRO_TARGET_ID": TARGET_ID,
        "NETAGRO_DATASET_EPOCH": DATASET_EPOCH,
        "DB_WRITE_HOST": "127.0.0.1",
        "DB_WRITE_PORT": "3307",
        "DB_WRITE_DEFAULT_SCHEMA": SCHEMA,
        "DB_WRITE_ALLOWED_SCHEMAS": SCHEMA,
        "DB_WRITES_ENABLED": "true",
        "ACCOUNTING_WRITES_ENABLED": "true",
        "ALBMATERIAL_CREATE_ENABLED": "true",
    }
    for key, value in expected_env.items():
        if ENV.get(key, "").casefold() != value.casefold():
            fail(f"runtime precondition changed: {key}")
    lock = MAINTENANCE_LOCK.open("a", encoding="utf-8")
    try:
        fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError as error:
        fail("another Netagro maintenance operation is active")

    initial = snapshot()
    if initial["business"]["markers"] or initial["business"]["references"]:
        fail("one of the controlled references/markers already exists")
    if initial["idempotency"]["rows"]:
        fail("one of the controlled request_ids already exists")
    assert_gate()
    emit("PREFLIGHT", {
        "target_id": TARGET_ID,
        "dataset_epoch": DATASET_EPOCH,
        "gate": True,
        "table_counts": initial["business"]["counts"],
        "counter_values": counter_values(initial["business"]),
        "idempotency_total": initial["idempotency"]["total"],
        "controlled_requests_absent": True,
    })
    if preflight_only:
        return 0

    payload_a = {
        "contract_version": 3,
        "operation": "validate",
        "request_id": REQUEST_A,
        "target_id": TARGET_ID,
        "dataset_epoch": DATASET_EPOCH,
        "cabecera": {
            "empresa_id": 1,
            "campana": 25,
            "serie": "A26",
            "fecha": "2026-08-06",
            "acreedor_id": 209,
            "referencia": "T260806-MA-209-A",
            "observaciones": "TEST CICLO A MATERIAL 905",
            "centro_id": 1,
            "punto_venta_id": 1,
            "almacen_id": 1,
            "tipo_cp": "P",
            "matricula": "",
            "importe_esperado": "7.99",
            "duplicado_confirmado_distinto": False,
            "duplicados_revisados_ids": [],
        },
        "lineas": [{
            "material_id": 905,
            "marca_id": 0,
            "cantidad": "1.0000",
            "precio": "7.990000",
            "descuento": "0.00",
            "referencia": "T260806-MA-209-A",
            "observaciones": "TEST A",
        }],
    }
    committed_a, state_after_a = run_cycle(
        "A", payload_a, "7.99", replay_commit=True
    )

    payload_b = {
        "contract_version": 3,
        "operation": "validate",
        "request_id": REQUEST_B,
        "target_id": TARGET_ID,
        "dataset_epoch": DATASET_EPOCH,
        "cabecera": {
            "empresa_id": 1,
            "campana": 25,
            "serie": "A26",
            "fecha": "2026-08-06",
            "acreedor_id": 17,
            "referencia": "T260806-MA-017-B",
            "observaciones": "TEST CICLO B MATERIAL 905",
            "centro_id": 1,
            "punto_venta_id": 1,
            "almacen_id": 1,
            "tipo_cp": "P",
            "matricula": "",
            "importe_esperado": "79.90",
            "duplicado_confirmado_distinto": False,
            "duplicados_revisados_ids": [],
        },
        "lineas": [{
            "material_id": 905,
            "marca_id": 0,
            "cantidad": "10.0000",
            "precio": "7.990000",
            "descuento": "0.00",
            "referencia": "T260806-MA-017-B",
            "observaciones": "TEST B",
        }],
    }
    committed_b, state_after_b = run_cycle(
        "B", payload_b, "79.90", replay_commit=False
    )

    if table_delta(initial["business"], state_after_b["business"]) != {
        "albmaterial": 2,
        "albmateriallineas": 2,
        "valeenvases": 2,
        "valeenvases_lineas": 2,
        "facturasrecibidas": 0,
    }:
        fail("combined A+B table delta is not exact")
    if set(counter_delta(initial["business"], state_after_b["business"]).values()) != {2}:
        fail("combined A+B counter delta is not exact")

    assert_gate()
    negative_payload = deepcopy(payload_b)
    negative_payload["request_id"] = REQUEST_NEGATIVE
    negative_payload["cabecera"]["importe_esperado"] = "79.91"
    before_negative = snapshot()
    negative = api_json("POST", "/albaranes/material", post_bytes(negative_payload))
    errors = negative.get("validations", {}).get("errors") or []
    if negative.get("operation") != "validate":
        fail("negative operation changed")
    if negative.get("ok") is not False or negative.get("would_create") is not False:
        fail("negative validate unexpectedly passed")
    if len(errors) != 1:
        fail(f"negative validate returned unexpected errors: {errors}")
    error = errors[0]
    if error.get("field") != "cabecera.importe_esperado":
        fail("negative validate failed on the wrong field")
    if decimal_value(error.get("expected")) != Decimal("79.90"):
        fail("negative validate expected total mismatch")
    if decimal_value(error.get("received")) != Decimal("79.91"):
        fail("negative validate received total mismatch")
    after_negative = snapshot()
    if after_negative != before_negative:
        fail("negative validate changed rows, counters or idempotency")
    emit("NEGATIVE_VALIDATE", {
        "ok": False,
        "would_create": False,
        "request_id": REQUEST_NEGATIVE,
        "error": error,
        "business_unchanged": True,
        "counters_unchanged": True,
        "idempotency_unchanged": True,
    })

    final = snapshot()
    rows_by_request = {row["request_id"]: row for row in final["idempotency"]["rows"]}
    if set(rows_by_request) != {REQUEST_A, REQUEST_B}:
        fail("final idempotency request set is not exact")
    if any(row["status"] != "completed" for row in rows_by_request.values()):
        fail("one final idempotency record is not completed")
    result = {
        "target_id": TARGET_ID,
        "dataset_epoch": DATASET_EPOCH,
        "cycle_a": summary(committed_a),
        "cycle_b": summary(committed_b),
        "table_counts_before": initial["business"]["counts"],
        "table_counts_after": final["business"]["counts"],
        "table_delta": table_delta(initial["business"], final["business"]),
        "counter_values_before": counter_values(initial["business"]),
        "counter_values_after": counter_values(final["business"]),
        "counter_delta": counter_delta(initial["business"], final["business"]),
        "idempotency_total_before": initial["idempotency"]["total"],
        "idempotency_total_after": final["idempotency"]["total"],
        "idempotency_rows": final["idempotency"]["rows"],
        "negative": {
            "request_id": REQUEST_NEGATIVE,
            "would_create": False,
            "expected": "79.90",
            "received": "79.91",
            "no_state_change": True,
        },
        "supabase_touched": False,
        "facturas_touched": False,
    }
    emit("FINAL_RESULT", result)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(f"OPERATOR_ERROR={type(error).__name__}: {error}", file=sys.stderr, flush=True)
        raise
