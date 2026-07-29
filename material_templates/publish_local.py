#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
本機教材發布：讀 Excel（含 _Config / _Schema / _Publish）→ 產出 .meta.json / .script.txt
不上傳 Drive、不轉 Google Sheets。

用法：
  ./publish_local.sh /path/to/workbook.xlsx
  ./publish_local.sh /path/to/workbook.xlsx --out /path/to/output_dir
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

try:
    import openpyxl
except ImportError:
    print(
        "缺少 openpyxl。請在本目錄執行：\n"
        "  python3 -m venv .venv && .venv/bin/pip install -r requirements-publish.txt\n"
        "  .venv/bin/python publish_local.py <你的.xlsx>",
        file=sys.stderr,
    )
    sys.exit(1)


def col_letter_to_index(col: str) -> int:
    s = (col or "").strip().upper()
    if not s:
        return -1
    n = 0
    for ch in s:
        if not ("A" <= ch <= "Z"):
            return -1
        n = n * 26 + (ord(ch) - 64)
    return n - 1


def is_truthy_yn(val) -> bool:
    s = str(val if val is not None else "").strip().upper()
    return s in ("Y", "YES", "1", "是")


def is_empty(v) -> bool:
    return v is None or (isinstance(v, str) and v.strip() == "")


def sheet_as_maps(wb, sheet_name: str) -> list[dict]:
    if sheet_name not in wb.sheetnames:
        raise SystemExit(f"找不到活頁：{sheet_name}")
    ws = wb[sheet_name]
    rows_iter = ws.iter_rows(values_only=True)
    try:
        headers_raw = next(rows_iter)
    except StopIteration:
        return []
    headers = [str(h or "").strip().lower() for h in headers_raw]
    out = []
    for row in rows_iter:
        obj = {}
        empty = True
        for i, key in enumerate(headers):
            if not key:
                continue
            v = row[i] if i < len(row) else None
            if not is_empty(v):
                empty = False
            obj[key] = v
        if not empty:
            out.append(obj)
    return out


def read_config(wb) -> dict:
    cfg = {"material_folder": "GEPT-2_vocab", "last_row_column": "A"}
    for r in sheet_as_maps(wb, "_Config"):
        k = str(r.get("key") or "").strip()
        v = r.get("value")
        if k == "material_folder" and not is_empty(v):
            cfg["material_folder"] = str(v).strip()
        if k == "last_row_column" and not is_empty(v):
            cfg["last_row_column"] = str(v).strip()
    return cfg


def read_schemas(wb) -> dict:
    by_schema: dict[str, list] = {}
    for r in sheet_as_maps(wb, "_Schema"):
        sid = str(r.get("schema_id") or "").strip()
        if not sid:
            continue
        by_schema.setdefault(sid, []).append(
            {
                "semantic_key": str(r.get("semantic_key") or "").strip(),
                "excel_col": str(r.get("excel_col") or "").strip(),
                "send_to_ai": is_truthy_yn(r.get("send_to_ai")),
                "display": is_truthy_yn(r.get("display")),
            }
        )
    return by_schema


def read_publish_rules(wb) -> list[dict]:
    return [r for r in sheet_as_maps(wb, "_Publish") if is_truthy_yn(r.get("enabled"))]


def load_sheet_matrix(ws) -> list[tuple]:
    """一次讀完整張表（values_only），比逐格 ws.cell 快很多。"""
    return list(ws.iter_rows(values_only=True))


def get_last_data_row_from_matrix(matrix: list[tuple], col_letter: str) -> int:
    col = col_letter_to_index(col_letter)
    if col < 0:
        col = 0
    for r in range(len(matrix), 0, -1):
        row = matrix[r - 1]
        v = row[col] if col < len(row) else None
        if not is_empty(v):
            return r
    return 1


def build_rows_from_matrix(
    matrix: list[tuple],
    sheet_name: str,
    rule: dict,
    schema_fields: list,
    cfg: dict,
) -> list[dict]:
    try:
        start_row = int(rule.get("row_start") or 2)
    except (TypeError, ValueError):
        start_row = 2
    if start_row < 1:
        start_row = 2

    end_raw = str(rule.get("row_end") or "LAST").strip().upper()
    if end_raw == "LAST":
        end_row = get_last_data_row_from_matrix(matrix, cfg["last_row_column"])
    else:
        try:
            end_row = int(end_raw)
        except ValueError as e:
            raise SystemExit(f"列範圍無效：{sheet_name} ({start_row}-{end_raw})") from e

    if end_row < start_row:
        raise SystemExit(f"列範圍無效：{sheet_name} ({start_row}-{end_raw})")

    has_script = any(f.get("semantic_key") == "script" and f.get("excel_col") for f in schema_fields)
    if not has_script:
        raise SystemExit(f"schema 缺少 script 欄位映射（schema_id={rule.get('schema_id')}）")

    field_map = []
    for f in schema_fields:
        key = f.get("semantic_key") or ""
        col_letter = f.get("excel_col") or ""
        if not key or not col_letter:
            continue
        ci = col_letter_to_index(col_letter)
        if ci < 0:
            continue
        field_map.append((key, ci))

    out = []
    formula_warned = False
    end_row = min(end_row, len(matrix))
    for r in range(start_row, end_row + 1):
        row = matrix[r - 1]
        row_obj = {"_source_row": r}
        has_script_val = False
        for key, ci in field_map:
            raw = row[ci] if ci < len(row) else None
            if isinstance(raw, str) and raw.startswith("="):
                if not formula_warned:
                    print(
                        "警告：偵測到尚未快取結果的公式。請用 Excel 開啟存檔一次後再跑。",
                        file=sys.stderr,
                    )
                    formula_warned = True
                continue
            if is_empty(raw):
                continue
            row_obj[key] = raw
            if key == "script":
                has_script_val = True
        if has_script_val:
            out.append(row_obj)
    return out


def safe_filename(name: str) -> str:
    name = str(name or "").strip()
    name = re.sub(r'[\\/:*?"<>|]', "_", name)
    return name or "output"


def json_safe(v):
    if hasattr(v, "isoformat"):
        return v.isoformat()
    return v


def publish(xlsx_path: Path, out_root: Path | None) -> Path:
    print(f"讀取：{xlsx_path}")
    wb = openpyxl.load_workbook(xlsx_path, data_only=True, read_only=True)

    cfg = read_config(wb)
    schemas = read_schemas(wb)
    rules = read_publish_rules(wb)
    if not rules:
        raise SystemExit("_Publish 沒有 enabled=Y 的規則（請把要發布的列改成 Y）")

    out_dir = out_root or (xlsx_path.parent / "published" / cfg["material_folder"])
    out_dir.mkdir(parents=True, exist_ok=True)
    print(f"輸出目錄：{out_dir.resolve()}")
    print(f"共 {len(rules)} 條 enabled=Y 規則\n")

    outputs = []
    now = datetime.now(timezone.utc).isoformat()
    matrix_cache: dict[str, list] = {}

    for i, rule in enumerate(rules, 1):
        sid = str(rule.get("schema_id") or "").strip()
        fields = schemas.get(sid)
        if not fields:
            raise SystemExit(f"找不到 schema_id：{sid}")

        sheet_name = str(rule.get("source_sheet") or "").strip()
        if not sheet_name:
            raise SystemExit("_Publish 缺少 source_sheet")
        if sheet_name not in wb.sheetnames:
            raise SystemExit(f"找不到來源活頁：{sheet_name}")

        print(f"[{i}/{len(rules)}] 處理活頁 {sheet_name} …", flush=True)
        if sheet_name not in matrix_cache:
            matrix_cache[sheet_name] = load_sheet_matrix(wb[sheet_name])
        rows = build_rows_from_matrix(matrix_cache[sheet_name], sheet_name, rule, fields, cfg)
        if not rows:
            print(f"  警告：{sheet_name} 沒有含 script 的列（請檢查 _Schema 欄位與公式快取）", file=sys.stderr)

        clean_rows = []
        for row in rows:
            copy = {k: json_safe(v) for k, v in row.items() if not str(k).startswith("_")}
            clean_rows.append(copy)

        meta_name = str(rule.get("output_meta") or "").strip()
        txt_name = str(rule.get("output_txt") or "").strip()
        src_label = sheet_name or "sheet"
        if not meta_name:
            meta_name = f"{src_label}.meta.json"
        meta_name = safe_filename(meta_name)
        if txt_name:
            txt_name = safe_filename(txt_name)

        meta_path = out_dir / meta_name
        meta_path.write_text(
            json.dumps(clean_rows, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        print(f"  ✓ {meta_name}（{len(clean_rows)} 列）", flush=True)

        if txt_name:
            lines = [str(row.get("script") or "").strip() for row in rows]
            lines = [ln for ln in lines if ln]
            (out_dir / txt_name).write_text(
                "\n".join(lines) + ("\n" if lines else ""),
                encoding="utf-8",
            )
            print(f"  ✓ {txt_name}（{len(lines)} 行）", flush=True)

        outputs.append(
            {
                "source_sheet": sheet_name,
                "meta": meta_name,
                "txt": txt_name or None,
                "rowCount": len(clean_rows),
                "schema_id": sid,
            }
        )

    manifest = {
        "published_at": now,
        "source_file": str(xlsx_path.name),
        "material_folder": cfg["material_folder"],
        "root_kind": "local",
        "outputs": outputs,
    }
    (out_dir / "_manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"\n✓ _manifest.json")
    print(f"完成：{out_dir.resolve()}")
    wb.close()
    return out_dir


def main():
    parser = argparse.ArgumentParser(description="本機發布 Excel → meta.json / script.txt")
    parser.add_argument("xlsx", type=Path, help="本機 Excel 檔路徑（.xlsx）")
    parser.add_argument(
        "--out",
        type=Path,
        default=None,
        help="輸出目錄（預設：xlsx 同層 published/<material_folder>/）",
    )
    args = parser.parse_args()
    xlsx = args.xlsx.expanduser().resolve()
    if not xlsx.is_file():
        raise SystemExit(f"找不到檔案：{xlsx}")
    if xlsx.suffix.lower() not in (".xlsx", ".xlsm"):
        raise SystemExit("請使用 .xlsx（不支援舊版 .xls）")
    publish(xlsx, args.out.expanduser().resolve() if args.out else None)


if __name__ == "__main__":
    main()
