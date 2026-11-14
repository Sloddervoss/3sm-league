#!/usr/bin/env python3
"""Show the shape of selected tables from the captured production catalog."""
from __future__ import annotations

import json
import pathlib
import sys

ART = pathlib.Path("/home/hermes/artifacts/3sm/pitwall-learning-p2-readonly-clone-20261114")
data = json.loads((ART / "prod-catalog.json").read_text())

tables = sys.argv[1:]
for row in data["COLUMNS"]:
    if f"{row[0]}.{row[1]}" in tables:
        optional = "NOT NULL" if row[5] else "null"
        print(f"{row[1]:<28} {row[3]:<24} {row[4]:<28} {optional:<8} {row[8] or ''}")
