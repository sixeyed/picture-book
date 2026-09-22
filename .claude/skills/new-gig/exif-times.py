#!/usr/bin/env python3
"""Print EXIF DateTimeOriginal (the camera's local clock) for every JPEG in a folder.

Usage: python3 exif-times.py originals/<slug>

Why not mdls/Finder: those report UTC, an hour out under BST. No dependencies.
"""
import glob
import struct
import sys


def exif_datetime_original(path):
    data = open(path, "rb").read(256_000)
    i = data.find(b"Exif\x00\x00")
    if i < 0:
        return None
    t = data[i + 6 :]
    le = t[:2] == b"II"
    u16 = lambda o: struct.unpack("<H" if le else ">H", t[o : o + 2])[0]
    u32 = lambda o: struct.unpack("<I" if le else ">I", t[o : o + 4])[0]

    def ifd(off):
        out = {}
        for k in range(u16(off)):
            e = off + 2 + k * 12
            tag, cnt, vo = u16(e), u32(e + 4), e + 8
            if tag == 0x8769:  # pointer to the EXIF sub-IFD
                out["exif"] = u32(vo)
            elif tag == 0x9003:  # DateTimeOriginal
                off2 = u32(vo) if cnt > 4 else vo
                out["dto"] = t[off2 : off2 + cnt].rstrip(b"\x00").decode("latin1")
        return out

    r = ifd(u32(4))
    if "exif" in r:
        r.update(ifd(r["exif"]))
    return r.get("dto")


if len(sys.argv) != 2:
    sys.exit(__doc__)
for f in sorted(glob.glob(f"{sys.argv[1]}/*.[jJ][pP][gG]")):
    print(f"{f.split('/')[-1]:16s} {exif_datetime_original(f) or '(no EXIF)'}")
