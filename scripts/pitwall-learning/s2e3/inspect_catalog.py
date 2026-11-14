#!/usr/bin/env python3
"""Small read-only inspector for the captured catalog JSON (no production access)."""
from __future__ import annotations

import json
import pathlib
import sys

ART = pathlib.Path("/home/hermes/artifacts/3sm/pitwall-learning-p2-readonly-clone-20261114")
data = json.loads((ART / "prod-catalog.json").read_text())

for section in sys.argv[1:]:
    print(f"=== {section}")
    rows = data[section]
    if section == "DEFAULT_ACLS":
        for r in rows:
            print(json.dumps(r))
    else:
        for r in rows:
            print(json.dumps(r))
