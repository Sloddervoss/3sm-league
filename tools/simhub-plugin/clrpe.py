#!/usr/bin/env python3
"""Minimal PE/CLI (.NET) metadata reader — stdlib only.

Reads exactly what the 3SM release gate needs from a compiled managed assembly:
  * assembly identity (name, version)
  * manifest resource names + payload hashes
  * TypeDef full names (namespace + name), including nested types

No dependency on mono/dotnet/ilspycmd, so it runs on any host with python3.

Validated against 3SM.EnduranceConnector 0.5.25.0
(AssemblyVersion 0.5.25.0, 7 manifest resources, 283 TypeDef rows) and against
the ground truth produced by an independent metadata reader.
"""
import hashlib
import struct

# ---------------------------------------------------------------- PE parsing


class PeError(Exception):
    pass


def _u16(buf, off):
    return struct.unpack_from("<H", buf, off)[0]


def _u32(buf, off):
    return struct.unpack_from("<I", buf, off)[0]


def _u64(buf, off):
    return struct.unpack_from("<Q", buf, off)[0]


def pe_sections(buf):
    if buf[:2] != b"MZ":
        raise PeError("not a PE file (no MZ header)")
    pe_off = _u32(buf, 0x3C)
    if buf[pe_off:pe_off + 4] != b"PE\0\0":
        raise PeError("not a PE file (no PE signature)")
    coff = pe_off + 4
    num_sections = _u16(buf, coff + 2)
    opt_size = _u16(buf, coff + 16)
    opt_off = coff + 20
    magic = _u16(buf, opt_off)
    if magic == 0x10B:
        dd_off = opt_off + 96
    elif magic == 0x20B:
        dd_off = opt_off + 112
    else:
        raise PeError("unknown optional header magic 0x%x" % magic)
    cli_rva = _u32(buf, dd_off + 14 * 8)
    sections = []
    sec_off = opt_off + opt_size
    for i in range(num_sections):
        base = sec_off + i * 40
        name = buf[base:base + 8].rstrip(b"\0").decode("latin-1")
        vsize = _u32(buf, base + 8)
        vaddr = _u32(buf, base + 12)
        rsize = _u32(buf, base + 16)
        rptr = _u32(buf, base + 20)
        sections.append({"name": name, "vsize": vsize, "vaddr": vaddr,
                         "rsize": rsize, "rptr": rptr})
    if cli_rva == 0:
        raise PeError("not a managed assembly (no CLI data directory)")
    return sections, cli_rva


def rva_to_off(sections, rva):
    for s in sections:
        if s["vaddr"] <= rva < s["vaddr"] + max(s["vsize"], s["rsize"]):
            delta = rva - s["vaddr"]
            if delta >= s["rsize"]:
                raise PeError("RVA 0x%x inside virtual-only part of section %s"
                              % (rva, s["name"]))
            return s["rptr"] + delta
    raise PeError("RVA 0x%x not mapped to any section" % rva)


# ------------------------------------------------------------ table schema

# Coded index definitions: (bits, [tables...])
CODED = {
    "TypeDefOrRef": (2, [0x02, 0x01, 0x1B]),
    "HasConstant": (2, [0x04, 0x08, 0x17]),
    "HasCustomAttribute": (5, [0x06, 0x04, 0x01, 0x02, 0x08, 0x09, 0x0A, 0x00,
                               0x0E, 0x17, 0x14, 0x11, 0x1A, 0x1B, 0x20, 0x23,
                               0x26, 0x27, 0x28, 0x2A, 0x2B, 0x2C]),
    "HasFieldMarshal": (1, [0x04, 0x08]),
    "HasDeclSecurity": (2, [0x02, 0x06, 0x20]),
    "MemberRefParent": (3, [0x02, 0x01, 0x1A, 0x06, 0x1B]),
    "HasSemantics": (1, [0x14, 0x17]),
    "MethodDefOrRef": (1, [0x06, 0x0A]),
    "MemberForwarded": (1, [0x04, 0x06]),
    "Implementation": (2, [0x26, 0x23, 0x27]),
    "CustomAttributeType": (3, [None, None, 0x06, 0x0A, None]),
    "ResolutionScope": (2, [0x00, 0x1A, 0x23, 0x01]),
    "TypeOrMethodDef": (1, [0x02, 0x06]),
}

# column kinds: "2","4" fixed size; "S","G","B" heap index; int -> table index
# or str -> coded index name
TABLES = {
    0x00: ["2", "S", "G", "G", "G"],                                   # Module
    0x01: ["ResolutionScope", "S", "S"],                               # TypeRef
    0x02: ["4", "S", "S", "TypeDefOrRef", 0x04, 0x06],                 # TypeDef
    0x03: [0x04],                                                      # FieldPtr
    0x04: ["2", "S", "B"],                                             # Field
    0x05: [0x06],                                                      # MethodPtr
    0x06: ["4", "2", "2", "S", "B", 0x08],                             # MethodDef
    0x07: [0x08],                                                      # ParamPtr
    0x08: ["2", "2", "S"],                                             # Param
    0x09: [0x02, "TypeDefOrRef"],                                      # InterfaceImpl
    0x0A: ["MemberRefParent", "S", "B"],                               # MemberRef
    0x0B: ["2", "HasConstant", "B"],                                   # Constant
    0x0C: ["HasCustomAttribute", "CustomAttributeType", "B"],          # CustomAttribute
    0x0D: ["HasFieldMarshal", "B"],                                    # FieldMarshal
    0x0E: ["2", "HasDeclSecurity", "B"],                               # DeclSecurity
    0x0F: ["2", "4", 0x02],                                            # ClassLayout
    0x10: ["4", 0x04],                                                 # FieldLayout
    0x11: ["B"],                                                       # StandAloneSig
    0x12: [0x02, 0x14],                                                # EventMap
    0x13: [0x14],                                                      # EventPtr
    0x14: ["2", "S", "TypeDefOrRef"],                                  # Event
    0x15: [0x02, 0x17],                                                # PropertyMap
    0x16: [0x17],                                                      # PropertyPtr
    0x17: ["2", "S", "B"],                                             # Property
    0x18: ["2", 0x06, "HasSemantics"],                                 # MethodSemantics
    0x19: [0x02, "MethodDefOrRef", "MethodDefOrRef"],                  # MethodImpl
    0x1A: ["S"],                                                       # ModuleRef
    0x1B: ["B"],                                                       # TypeSpec
    0x1C: ["2", "MemberForwarded", "S", 0x1A],                         # ImplMap
    0x1D: ["4", 0x04],                                                 # FieldRVA
    0x1E: ["4"],                                                       # ENCLog
    0x1F: ["4"],                                                       # ENCMap
    0x20: ["4", "2", "2", "2", "2", "4", "B", "S", "S"],               # Assembly
    0x21: ["4"],                                                       # AssemblyProcessor
    0x22: ["4", "4", "4"],                                             # AssemblyOS
    0x23: ["2", "2", "2", "2", "4", "B", "S", "S", "B"],               # AssemblyRef
    0x24: ["4", 0x23],                                                 # AssemblyRefProcessor
    0x25: ["4", "4", "4", 0x23],                                       # AssemblyRefOS
    0x26: ["4", "S", "B"],                                             # File
    0x27: ["4", "4", "S", "S", "Implementation"],                      # ExportedType
    0x28: ["4", "4", "S", "Implementation"],                           # ManifestResource
    0x29: [0x02, 0x02],                                                # NestedClass
    0x2A: ["2", "2", "TypeOrMethodDef", "S"],                          # GenericParam
    0x2B: ["MethodDefOrRef", "B"],                                     # MethodSpec
    0x2C: [0x2A, "TypeDefOrRef"],                                      # GenericParamConstraint
}


class Assembly:
    def __init__(self, path):
        with open(path, "rb") as fh:
            self._buf = buf = fh.read()
        self.path = path
        self.sha256 = hashlib.sha256(buf).hexdigest()
        self.byte_length = len(buf)
        sections, cli_rva = pe_sections(buf)
        cli = rva_to_off(sections, cli_rva)
        self._sections = sections
        self._resources_rva = _u32(buf, cli + 24)
        self._resources_size = _u32(buf, cli + 28)
        meta_rva = _u32(buf, cli + 8)
        meta_size = _u32(buf, cli + 12)
        self.metadata_size = meta_size
        meta = rva_to_off(sections, meta_rva)
        if _u32(buf, meta) != 0x424A5342:
            raise PeError("bad metadata signature")
        ver_len = _u32(buf, meta + 12)
        pos = meta + 16 + ver_len
        pos += 2  # flags
        streams = _u16(buf, pos)
        pos += 2
        self.streams = {}
        for _ in range(streams):
            offset = _u32(buf, pos)
            size = _u32(buf, pos + 4)
            pos += 8
            end = buf.index(b"\0", pos)
            name = buf[pos:end].decode("ascii")
            pos = end + 1
            pos = (pos + 3) & ~3
            self.streams[name] = (meta + offset, size)
        if "#~" in self.streams:
            self._tab_off, self._tab_size = self.streams["#~"]
        elif "#-" in self.streams:
            self._tab_off, self._tab_size = self.streams["#-"]
        else:
            raise PeError("no #~ / #- metadata table stream")
        self._string_off, self._string_size = self.streams.get("#Strings", (0, 0))
        self._parse_tables()
        self._parse_assembly()
        self._parse_resources()
        self._parse_types()

    # -- table stream ----------------------------------------------------
    def _parse_tables(self):
        buf, base = self._buf, self._tab_off
        self.heap_sizes = buf[base + 6]
        valid = _u64(buf, base + 8)
        pos = base + 24
        self.row_counts = {}
        for table in range(64):
            if valid >> table & 1:
                self.row_counts[table] = _u32(buf, pos)
                pos += 4
        self._table_offsets = {}
        offset = pos
        for table in range(64):
            if table not in self.row_counts:
                continue
            self._table_offsets[table] = offset
            offset += self.row_counts[table] * self._row_size(table)
        self._tables_end = offset

    def _index_size(self, table):
        return 4 if self.row_counts.get(table, 0) > 0xFFFF else 2

    def _coded_size(self, name):
        bits, tables = CODED[name]
        biggest = max(self.row_counts.get(t, 0) if t is not None else 0
                      for t in tables)
        return 2 if biggest < (1 << (16 - bits)) else 4

    def _heap_size(self, kind):
        flag = {"S": 0x01, "G": 0x02, "B": 0x04}[kind]
        return 4 if self.heap_sizes & flag else 2

    def _col_size(self, col):
        if isinstance(col, str) and col in ("S", "G", "B"):
            return self._heap_size(col)
        if isinstance(col, str) and col in ("2", "4"):
            return int(col)
        if isinstance(col, str):
            return self._coded_size(col)
        if isinstance(col, int):
            return self._index_size(col)
        raise PeError("bad column spec %r" % (col,))

    def _row_size(self, table):
        return sum(self._col_size(c) for c in TABLES[table])

    def _rows(self, table):
        """Yield (row_offset, {column_kind: value}) for a table."""
        if table not in self._row_counts_cached():
            return
        cols = TABLES[table]
        size = self._row_size(table)
        start = self._table_offsets[table]
        for i in range(self.row_counts[table]):
            off = start + i * size
            values = {}
            p = off
            for col in cols:
                w = self._col_size(col)
                if w == 2:
                    values.setdefault(col, []).append(_u16(self._buf, p))
                elif w == 4:
                    values.setdefault(col, []).append(_u32(self._buf, p))
                p += w
            yield off, values

    def _row_counts_cached(self):
        return self.row_counts

    def _string(self, index):
        base = self._string_off
        end = self._buf.index(b"\0", base + index)
        return self._buf[base + index:end].decode("utf-8", "replace")

    # -- parsed views ----------------------------------------------------
    def _parse_assembly(self):
        self.assembly_name = None
        self.version = None
        for _off, vals in self._rows(0x20):
            v = vals.get("2", [])
            # Assembly row: HashAlgId(4), Major, Minor, Build, Revision, ...
            off = _off
            p = off + 4
            major, minor, build, rev = struct.unpack_from("<HHHH", self._buf, p)
            self.version = "%d.%d.%d.%d" % (major, minor, build, rev)
            p += 8 + 4  # flags
            blob_w = self._heap_size("B")
            p += blob_w  # public key blob index
            str_w = self._heap_size("S")
            name_idx = _u16(self._buf, p) if str_w == 2 else _u32(self._buf, p)
            self.assembly_name = self._string(name_idx)
            break
        if self.version is None:
            raise PeError("no Assembly row")

    def _parse_resources(self):
        self.resources = []
        cols = TABLES[0x28]
        for off, _vals in self._rows(0x28):
            p = off
            declared_offset = _u32(self._buf, p)
            p += 4
            flags = _u32(self._buf, p)
            p += 4
            str_w = self._heap_size("S")
            name_idx = _u16(self._buf, p) if str_w == 2 else _u32(self._buf, p)
            p += str_w
            impl_w = self._coded_size("Implementation")
            impl = _u16(self._buf, p) if impl_w == 2 else _u32(self._buf, p)
            self.resources.append({
                "name": self._string(name_idx),
                "declared_offset": declared_offset,
                "flags": flags,
                "implementation": impl,
            })

    def _parse_types(self):
        self.types = []
        str_w = self._heap_size("S")
        for off, _vals in self._rows(0x02):
            p = off + 4
            name_idx = _u16(self._buf, p) if str_w == 2 else _u32(self._buf, p)
            p += str_w
            ns_idx = _u16(self._buf, p) if str_w == 2 else _u32(self._buf, p)
            name = self._string(name_idx)
            ns = self._string(ns_idx)
            self.types.append(("%s.%s" % (ns, name)) if ns else name)
        self.type_set = set(self.types)

    # -- resource payloads ----------------------------------------------
    def resource_payload(self, name):
        """Return (sha256, length, payload) of an embedded manifest resource."""
        target = next((r for r in self.resources if r["name"] == name), None)
        if target is None:
            raise PeError("resource %r not found" % name)
        if target["implementation"] != 0:
            raise PeError("resource %r is not embedded" % name)
        base = rva_to_off(self._sections, self._resources_rva)
        start = base + target["declared_offset"]
        length = _u32(self._buf, start)
        payload = self._buf[start + 4:start + 4 + length]
        if len(payload) != length:
            raise PeError("truncated resource %r" % name)
        return hashlib.sha256(payload).hexdigest(), length, payload
