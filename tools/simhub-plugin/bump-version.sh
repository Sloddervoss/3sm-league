#!/usr/bin/env bash
# 3SM EnduranceConnector — gecontroleerde versie-bump.
#
# Ontwikkeling: verhoogt de MINOR bij elke "versie bump": 0.1.0.0 -> 0.2.0.0 -> 0.3.0.0 ...
# Release:        zet versie op 1.0.0.0 (alleen als alles super is).
#
# Gebruik:
#   bump-version.sh            # minor +1 (bijv. 0.1.0.0 -> 0.2.0.0)
#   bump-version.sh --release  # zet uitdrukkelijk 1.0.0.0
#
# Deze bump is handmatig: alleen uitvoeren wanneer Vincent dat vraagt.
set -euo pipefail

ASSEMBLY="$(dirname "$0")/3SM.EnduranceConnector/AssemblyInfo.cs"

if [ ! -f "$ASSEMBLY" ]; then
  echo "Fout: AssemblyInfo.cs niet gevonden op $ASSEMBLY" >&2
  exit 1
fi

RELEASE=0
if [ "${1:-}" = "--release" ]; then RELEASE=1; fi

# Lees huidige versie uit AssemblyInfo.cs: [assembly: AssemblyVersion("x.y.z.w")]
CURRENT=$(grep -oE 'AssemblyVersion\("[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+"\)' "$ASSEMBLY" | head -1 | grep -oE '[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+')

IFS='.' read -r MAJOR MINOR PATCH BUILD <<< "$CURRENT"

if [ "$RELEASE" = "1" ]; then
  NEW="1.0.0.0"
elif [ "$MAJOR" = "0" ]; then
  # Ontwikkel-fase: minor ophogen, rest resets -> 0.2.0.0
  NEW="0.$((MINOR + 1)).0.0"
else
  # Al 1.x: patch ophogen -> 1.0.1.0
  NEW="1.$MINOR.$((PATCH + 1)).0"
fi

# Pas beide AssemblyVersion en AssemblyFileVersion aan.
sed -i "s/AssemblyVersion(\"[^\"]*\")/AssemblyVersion(\"$NEW\")/g; s/AssemblyFileVersion(\"[^\"]*\")/AssemblyFileVersion(\"$NEW\")/g" "$ASSEMBLY"

echo "Versie gebumpt: $CURRENT -> $NEW"
grep -E 'AssemblyVersion|AssemblyFileVersion' "$ASSEMBLY"