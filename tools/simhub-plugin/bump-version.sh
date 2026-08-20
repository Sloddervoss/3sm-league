#!/usr/bin/env bash
# 3SM EnduranceConnector — gecontroleerde versie-bump.
set -euo pipefail

ASSEMBLY="$(dirname "$0")/3SM.EnduranceConnector/AssemblyInfo.cs"
if [ ! -f "$ASSEMBLY" ]; then echo "Fout: AssemblyInfo.cs niet gevonden."; exit 1; fi

CURRENT=$(grep -oE 'AssemblyVersion\("[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+"' "$ASSEMBLY" | grep -oE '[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+')
IFS='.' read -r MAJOR MINOR PATCH BUILD <<< "$CURRENT"

case "${1:-}" in
  --release) NEW="1.0.0.0" ;;
  --patch)   NEW="$MAJOR.$MINOR.$((PATCH + 1)).0" ;;
  *)         NEW="0.$((MINOR + 1)).0.0" ;;
esac

sed -i "s/AssemblyVersion(\"[^\"]*\")/AssemblyVersion(\"$NEW\")/g; s/AssemblyFileVersion(\"[^\"]*\")/AssemblyFileVersion(\"$NEW\")/g" "$ASSEMBLY"
echo "$CURRENT -> $NEW"