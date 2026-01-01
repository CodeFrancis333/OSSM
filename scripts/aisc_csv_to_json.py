import csv
import json
from pathlib import Path


def excel_col_to_num(col):
    num = 0
    for ch in col.upper():
        num = num * 26 + (ord(ch) - 64)
    return num


def parse_float(value):
    if value is None:
        return None
    text = str(value).strip()
    if not text or text == "-":
        return None
    try:
        return float(text.replace(",", ""))
    except ValueError:
        return None


def build_records(rows, headers, start_idx, units_label, type_idx=None):
    header_map = {}
    for i, name in enumerate(headers):
        if name not in header_map:
            header_map[name] = i
    def idx(name):
        if name not in header_map:
            return None
        return start_idx + header_map[name]

    records = []
    for row in rows:
        if len(row) <= start_idx:
            continue
        if type_idx is None:
            shape_type = row[start_idx].strip() if row[start_idx] else ""
        else:
            shape_type = row[type_idx].strip() if row[type_idx] else ""
        label_idx = idx("AISC_Manual_Label")
        std_idx = idx("EDI_Std_Nomenclature")
        label = row[label_idx].strip() if label_idx is not None and row[label_idx] else ""
        if not label:
            continue
        record = {
            "type": shape_type,
            "label": label,
            "std": row[std_idx].strip() if std_idx is not None and row[std_idx] else "",
            "units": units_label,
        }
        dims = {}
        for key in ("d", "bf", "tf", "tw", "b", "h", "OD", "ID", "t", "kdes", "k1", "Ht", "B"):
            col_idx = idx(key)
            if col_idx is None or col_idx >= len(row):
                continue
            val = parse_float(row[col_idx])
            if val is not None:
                dims[key] = val
        if dims:
            record["dims"] = dims
        for key in ("W", "A"):
            col_idx = idx(key)
            if col_idx is None or col_idx >= len(row):
                continue
            val = parse_float(row[col_idx])
            if val is not None:
                record[key] = val
        records.append(record)
    return records


def main():
    repo_root = Path(__file__).resolve().parents[1]
    src = repo_root / "backend" / "data" / "aisc" / "aisc_v16.csv"
    out_dir = repo_root / "backend" / "data" / "aisc"
    out_dir.mkdir(parents=True, exist_ok=True)

    try:
        with src.open("r", encoding="utf-8-sig", newline="") as f:
            reader = csv.reader(f)
            rows = list(reader)
    except UnicodeDecodeError:
        with src.open("r", encoding="cp1252", newline="") as f:
            reader = csv.reader(f)
            rows = list(reader)

    if not rows:
        raise SystemExit("CSV is empty.")

    header = rows[0]
    data_rows = rows[1:]

    b_col = excel_col_to_num("B")
    cf_col = excel_col_to_num("CF")
    cg_col = excel_col_to_num("CG")
    fk_col = excel_col_to_num("FK")

    start_idx = b_col - b_col  # B is first column in this CSV
    imperial_end = cf_col - b_col
    metric_start = cg_col - b_col
    metric_end = fk_col - b_col

    imperial_headers = header[start_idx : imperial_end + 1]
    metric_headers = header[metric_start : metric_end + 1]

    imperial = build_records(data_rows, imperial_headers, start_idx, "imperial")
    metric = build_records(data_rows, metric_headers, metric_start, "metric", type_idx=start_idx)

    (out_dir / "aisc_v16_imperial.json").write_text(
        json.dumps({"source": "AISC v16", "units": "imperial", "shapes": imperial}, indent=2),
        encoding="utf-8",
    )
    (out_dir / "aisc_v16_metric.json").write_text(
        json.dumps({"source": "AISC v16", "units": "metric", "shapes": metric}, indent=2),
        encoding="utf-8",
    )

    print(f"imperial: {len(imperial)} shapes")
    print(f"metric: {len(metric)} shapes")


if __name__ == "__main__":
    main()
