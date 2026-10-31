#!/usr/bin/env python3
"""Statische controle op de bedrading van de meetlaag in de SimHub-plugin.

De plugin (`3SM.EnduranceConnector`) compileert alleen op een machine met SimHub,
dus op Linux is er geen compiler die "dit lid bestaat niet" kan zeggen. Dit script
doet die controle wel, op de bron:

  1. elk .cs-bestand in de pluginmap staat in 3SM.EnduranceConnector.csproj;
  2. elk SimHub-vrij meetlaagbestand is gelinkt in de DiagnosticsTests-csproj;
  3. elke aanroep op de vier meetlaagvelden bestaat echt in de bijbehorende klasse;
  4. elk veld dat de plugin op een `TelemetrySample` zet, bestaat op dat type;
  5. de envelope draagt `schemaRevision` en `capabilities` als DataMember, en de
     plugin vult ze ook daadwerkelijk.

Exitcode 0 = alles PASS, 1 = minstens één FAIL. Alleen lezen, niets schrijven.
"""

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
PLUGIN = ROOT / "3SM.EnduranceConnector"
TESTS = ROOT / "3SM.EnduranceConnector.DiagnosticsTests"

# veld in de plugin -> bronbestand met de klasse waarvan de leden tellen
FIELD_SOURCES = {
    "_measurementOutbox": ("MeasurementOutbox.cs", "MeasurementOutbox"),
    "_measurementPipeline": ("MeasurementPipeline.cs", "MeasurementPipeline"),
    "_measurementSender": ("MeasurementFrame.cs", "MeasurementSender"),
    "_controlClient": ("ConnectorControlClient.cs", "ConnectorControlClient"),
    "_sessionTime": ("SessionTelemetryReader.cs", "SessionTelemetryReader"),
}

# SimHub-vrije bestanden die de meetlaag en de tests delen
MEASUREMENT_FILES = [
    "MeasurementIds.cs",
    "MeasurementEvent.cs",
    "TelemetrySampler.cs",
    "LapAccumulator.cs",
    "PitServiceTracker.cs",
    "TyreAnchorTracker.cs",
    "MeasurementOutbox.cs",
    "MeasurementFrame.cs",
    "ConnectorControlContracts.cs",
    "ConnectorControlClient.cs",
    "MeasurementPipeline.cs",
    "TelemetryContractsV3.cs",
    "RawChannelReader.cs",
    "TyreZoneReader.cs",
    "CaptureValueRules.cs",
    "IrSdkChannels.cs",
    "IrSdkMemoryReader.cs",
]

passed = 0
failed = 0


def check(name, ok, evidence):
    global passed, failed
    if ok:
        passed += 1
        print("PASS " + name + " " + evidence)
    else:
        failed += 1
        print("FAIL " + name + " " + evidence)


def read(path):
    return path.read_text(encoding="utf-8")


def strip_comments(text):
    """Commentaar weg, zodat een lidnaam in een toelichting geen schijn-PASS geeft."""
    text = re.sub(r"/\*.*?\*/", "", text, flags=re.S)
    return re.sub(r"//[^\n]*", "", text)


def class_body(text, class_name):
    """De tekst tussen de accolades van `class <naam>` (ruwe benadering, genoeg voor leden)."""
    match = re.search(r"\bclass\s+" + re.escape(class_name) + r"\b[^{]*\{", text)
    if not match:
        return None
    depth = 0
    for index in range(match.end() - 1, len(text)):
        if text[index] == "{":
            depth += 1
        elif text[index] == "}":
            depth -= 1
            if depth == 0:
                return text[match.end():index]
    return None


MEMBER_RE = re.compile(
    r"public\s+(?:static\s+|sealed\s+|override\s+|readonly\s+)*"
    r"[A-Za-z_][\w<>\[\],\.\? ]*?\s+([A-Za-z_]\w*)\s*[\(\{;=]"
)


def members_of(body):
    found = set()
    for match in MEMBER_RE.finditer(body):
        found.add(match.group(1))
    # properties met een expression body: `public int X => ...;`
    for match in re.finditer(r"public\s+[\w<>\[\],\.\? ]+\s+([A-Za-z_]\w*)\s*=>", body):
        found.add(match.group(1))
    return found


def main():
    csproj = read(PLUGIN / "3SM.EnduranceConnector.csproj")
    tests_csproj = read(TESTS / "3SM.EnduranceConnector.DiagnosticsTests.csproj")
    plugin_source = strip_comments(read(PLUGIN / "EnduranceConnectorPlugin.cs"))

    # 1. Elk bronbestand van de plugin staat in de csproj.
    sources = sorted(
        path.name
        for path in PLUGIN.glob("*.cs")
        if path.is_file()
    )
    missing = [name for name in sources if ('Include="' + name + '"') not in csproj]
    check("W01", not missing,
          "alle " + str(len(sources)) + " .cs-bestanden staan in de plugin-csproj"
          + ("" if not missing else " — ontbreekt: " + ", ".join(missing)))

    # 2. De meetlaag is in de test-csproj gelinkt (anders test Beest iets anders dan de plugin).
    unlinked = [name for name in MEASUREMENT_FILES if ('\\' + name + '"') not in tests_csproj]
    check("W02", not unlinked,
          "alle " + str(len(MEASUREMENT_FILES)) + " meetlaagbestanden zijn gelinkt in DiagnosticsTests"
          + ("" if not unlinked else " — ontbreekt: " + ", ".join(unlinked)))

    # 3. Elke aanroep op een meetlaagveld bestaat in de klasse erachter. Het veld wordt
    #    rechtstreeks gebruikt (geen `var x = _veld;`-kopie): een kopie zou deze controle
    #    leeg maken en dan bewijst hij niets.
    for field, (file_name, class_name) in FIELD_SOURCES.items():
        source = strip_comments(read(PLUGIN / file_name))
        body = class_body(source, class_name)
        if body is None:
            check("W03-" + field, False, "klasse " + class_name + " niet gevonden in " + file_name)
            continue
        declared = members_of(body)
        used = sorted(set(re.findall(re.escape(field) + r"\s*\.\s*([A-Za-z_]\w*)", plugin_source)))
        unknown = [name for name in used if name not in declared]
        copied = re.findall(r"=\s*" + re.escape(field) + r"\s*;", plugin_source)
        check("W03-" + field, not unknown and len(used) > 0 and not copied,
              class_name + ": " + (", ".join(used) if used else "geen aanroepen")
              + ("" if not unknown else " — bestaat niet: " + ", ".join(unknown))
              + ("" if not copied else " — veld wordt gekopieerd in een lokaal ("
                 + str(len(copied)) + "x); de controle kan dat niet volgen"))

    # 4. Elk veld dat de plugin op een TelemetrySample zet, bestaat op dat type.
    sample_source = strip_comments(read(PLUGIN / "LapAccumulator.cs"))
    sample_body = class_body(sample_source, "TelemetrySample") or ""
    sample_members = members_of(sample_body)
    initializer = re.search(r"new\s+TelemetrySample\s*\{(.*?)\n\s*\};", plugin_source, flags=re.S)
    if initializer is None:
        check("W04", False, "geen `new TelemetrySample { … }` in de plugin gevonden")
    else:
        assigned = sorted(set(re.findall(r"^\s*([A-Za-z_]\w*)\s*=(?![=>])[^\n]*,$", initializer.group(1), flags=re.M)))
        unknown = [name for name in assigned if name not in sample_members]
        check("W04", not unknown,
              "TelemetrySample-velden: " + ", ".join(assigned)
              + ("" if not unknown else " — bestaat niet: " + ", ".join(unknown)))

    # 5. De envelope draagt de meetserie, en de plugin vult hem.
    contracts = read(PLUGIN / "TelemetryContractsV3.cs")
    envelope = class_body(contracts, "TelemetryEnvelopeV3") or ""
    has_members = ('[DataMember(Name = "schemaRevision"' in envelope
                   and '[DataMember(Name = "capabilities"' in envelope)
    filled = ("SchemaRevision = MeasurementContract.SchemaRevision" in plugin_source
              and "Capabilities = V3Capabilities.From(ConnectorCapabilities.Implemented())" in plugin_source)
    check("W05", has_members and filled,
          "schemaRevision en capabilities staan als additief lid in de envelope en worden gevuld")

    # 6. De meetserie gaat mee in de POST, en het ACK alleen na een geslaagde response.
    sends = (".BuildBody(" in plugin_source
             and "MeasurementAckParser.Parse(responseBody, plan.Batch)" in plugin_source
             and "response.Content.ReadAsStringAsync()" in plugin_source)
    check("W06", sends, "BuildBody in SendV3Async, ACK uit de gelezen response-body")

    # 7. Observeren gebeurt vóór de pairing- en intervalpoort.
    try:
        observe_at = plugin_source.index("ObserveMeasurements(pluginManager, data, running, isInCar);")
        gate_at = plugin_source.index("if (central && !IsPaired)")
    except ValueError:
        observe_at = gate_at = -1
    check("W07", observe_at > 0 and gate_at > observe_at,
          "het monster wordt vóór de pairing-poort aangeboden (teken " + str(observe_at) + " < " + str(gate_at) + ")")

    print("SUMMARY PASS=" + str(passed) + " FAIL=" + str(failed))
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
