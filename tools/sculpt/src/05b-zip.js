/*
 * SculptFree — reading zip archives.
 *
 * Models arrive zipped. A pack downloaded from a model site, a folder shared
 * from a computer, an export that wrote an .obj next to its .mtl: all of them
 * turn up as one .zip, and telling someone to go and unzip it first is no
 * answer on a phone, where there often is no unzip.
 *
 * So this is a zip reader: the central directory, stored and deflated
 * entries, CRCs checked, and a DEFLATE decoder written out in full because
 * the whole app is one file with no dependencies and no network. It sits
 * between the mesh modules and the importer, which is the only thing that
 * uses it.
 *
 * It is deliberately small and deliberately defensive: everything here comes
 * out of a file someone downloaded, so every count is capped by the bytes
 * actually present and a damaged archive gives up with a reason rather than
 * throwing something cryptic.
 */
(function (root) {
  'use strict';

  var S = root.SCULPT;
  var Zip = S.Zip = {};

  /* ================================================================ *
   * DEFLATE (RFC 1951)
   * ================================================================ */

  /* extra bits and base values for the length and distance codes */
  var LEN_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59,
                  67, 83, 99, 115, 131, 163, 195, 227, 258];
  var LEN_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3,
                   4, 4, 4, 4, 5, 5, 5, 5, 0];
  var DIST_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513,
                   769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
  var DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8,
                    9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
  /* the order code lengths themselves are stored in, for a dynamic block */
  var CLEN_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

  /**
   * A canonical Huffman table, as counts per bit length plus the symbols in
   * code order. Decoding then walks the lengths, which needs no table of
   * 2^15 entries and is easy to read — the shape zlib's own reference
   * decoder (puff.c) uses.
   */
  function huffman(lengths, n) {
    var counts = new Int32Array(16), offsets = new Int32Array(16);
    var symbols = new Int32Array(n);
    var i, len;
    for (i = 0; i < n; i++) counts[lengths[i]]++;
    counts[0] = 0;
    for (len = 1; len < 15; len++) offsets[len + 1] = offsets[len] + counts[len];
    for (i = 0; i < n; i++) if (lengths[i]) symbols[offsets[lengths[i]]++] = i;
    return { counts: counts, symbols: symbols };
  }

  var FIXED_LIT = null, FIXED_DIST = null;
  function fixedTables() {
    if (FIXED_LIT) return;
    var lengths = new Uint8Array(288), i;
    for (i = 0; i < 144; i++) lengths[i] = 8;
    for (; i < 256; i++) lengths[i] = 9;
    for (; i < 280; i++) lengths[i] = 7;
    for (; i < 288; i++) lengths[i] = 8;
    FIXED_LIT = huffman(lengths, 288);
    var dist = new Uint8Array(30);
    for (i = 0; i < 30; i++) dist[i] = 5;
    FIXED_DIST = huffman(dist, 30);
  }

  /**
   * Inflate a raw DEFLATE stream.
   *
   * `expected` is the size the archive claims the result will be; it is used
   * as the first guess at how much room to allocate and nothing more, since a
   * file is free to lie about it (see `IO.fileCount`). The output grows as
   * needed and is handed back trimmed to what was actually written.
   */
  Zip.inflateRaw = function (src, expected) {
    var out = new Uint8Array(Math.max(64, Math.min(expected > 0 ? expected : 0, 1 << 28) || src.length * 4));
    var len = 0;
    var pos = 0, bitBuf = 0, bitCnt = 0;

    function bit() {
      if (bitCnt === 0) {
        if (pos >= src.length) throw new Error('the compressed data ends in the middle of a block');
        bitBuf = src[pos++];
        bitCnt = 8;
      }
      var b = bitBuf & 1;
      bitBuf >>= 1;
      bitCnt--;
      return b;
    }
    function bits(n) {
      var v = 0;
      for (var i = 0; i < n; i++) v |= bit() << i;
      return v;
    }
    function grow(need) {
      if (len + need <= out.length) return;
      var size = out.length;
      while (size < len + need) size *= 2;
      var bigger = new Uint8Array(size);
      bigger.set(out.subarray(0, len));
      out = bigger;
    }
    function decode(table) {
      var code = 0, first = 0, index = 0;
      for (var l = 1; l <= 15; l++) {
        code |= bit();
        var count = table.counts[l];
        if (code - first < count) return table.symbols[index + (code - first)];
        index += count;
        first = (first + count) << 1;
        code <<= 1;
      }
      throw new Error('the compressed data is damaged (no such code)');
    }

    fixedTables();
    for (;;) {
      var last = bit();
      var type = bits(2);
      if (type === 0) {                            // stored
        bitBuf = 0; bitCnt = 0;                    // the rest of this byte is padding
        if (pos + 4 > src.length) throw new Error('a stored block ends early');
        var n = src[pos] | (src[pos + 1] << 8);
        pos += 4;                                  // length, then its complement
        if (pos + n > src.length) throw new Error('a stored block claims more bytes than there are');
        grow(n);
        out.set(src.subarray(pos, pos + n), len);
        len += n; pos += n;
      } else if (type === 1 || type === 2) {
        var lit = FIXED_LIT, dist = FIXED_DIST;
        if (type === 2) {                           // dynamic: the tables come first
          var nlen = bits(5) + 257, ndist = bits(5) + 1, ncode = bits(4) + 4;
          if (nlen > 286 || ndist > 30) throw new Error('the compressed data is damaged (too many codes)');
          var clens = new Uint8Array(19), i;
          for (i = 0; i < ncode; i++) clens[CLEN_ORDER[i]] = bits(3);
          var clenTable = huffman(clens, 19);
          var lengths = new Uint8Array(nlen + ndist);
          i = 0;
          while (i < lengths.length) {
            var sym = decode(clenTable);
            if (sym < 16) {
              lengths[i++] = sym;
            } else if (sym === 16) {
              if (!i) throw new Error('the compressed data is damaged (nothing to repeat)');
              var prev = lengths[i - 1], rep = 3 + bits(2);
              while (rep-- && i < lengths.length) lengths[i++] = prev;
            } else if (sym === 17) {
              var rep0 = 3 + bits(3);
              while (rep0-- && i < lengths.length) lengths[i++] = 0;
            } else {
              var rep1 = 11 + bits(7);
              while (rep1-- && i < lengths.length) lengths[i++] = 0;
            }
          }
          lit = huffman(lengths.subarray(0, nlen), nlen);
          dist = huffman(lengths.subarray(nlen), ndist);
        }
        for (;;) {
          var s = decode(lit);
          if (s < 256) {
            grow(1);
            out[len++] = s;
          } else if (s === 256) {
            break;                                  // end of block
          } else {
            s -= 257;
            if (s >= LEN_BASE.length) throw new Error('the compressed data is damaged (bad length code)');
            var copyLen = LEN_BASE[s] + bits(LEN_EXTRA[s]);
            var d = decode(dist);
            if (d >= DIST_BASE.length) throw new Error('the compressed data is damaged (bad distance code)');
            var back = DIST_BASE[d] + bits(DIST_EXTRA[d]);
            if (back > len) throw new Error('the compressed data is damaged (a copy reaches before the start)');
            grow(copyLen);
            var from = len - back;
            for (var k = 0; k < copyLen; k++) out[len++] = out[from + k];
          }
        }
      } else {
        throw new Error('the compressed data is damaged (unknown block type)');
      }
      if (last) break;
    }
    return out.subarray(0, len);
  };

  /* ================================================================ *
   * CRC-32, so a damaged entry can be named as damaged
   * ================================================================ */

  var CRC_TABLE = null;
  function crcTable() {
    if (CRC_TABLE) return CRC_TABLE;
    CRC_TABLE = new Int32Array(256);
    for (var i = 0; i < 256; i++) {
      var c = i;
      for (var k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
      CRC_TABLE[i] = c;
    }
    return CRC_TABLE;
  }

  Zip.crc32 = function (bytes) {
    var t = crcTable(), c = -1;
    for (var i = 0; i < bytes.length; i++) c = t[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ -1) >>> 0;
  };

  /* ================================================================ *
   * the archive itself
   * ================================================================ */

  var SIG_LOCAL = 0x04034b50;
  var SIG_CENTRAL = 0x02014b50;
  var SIG_EOCD = 0x06054b50;

  /** A zip starts with the signature of its first local entry. */
  Zip.looksLikeZip = function (buffer) {
    if (!buffer || buffer.byteLength < 4) return false;
    var b = new Uint8Array(buffer, 0, 4);
    return b[0] === 0x50 && b[1] === 0x4b && (b[2] === 3 || b[2] === 5 || b[2] === 7);
  };

  function utf8(bytes) {
    return S.IO && S.IO.decode ? S.IO.decode(bytes) : String.fromCharCode.apply(null, bytes);
  }

  /** ZIP64 puts the real sizes in an extra field once a 32-bit one overflows. */
  function zip64Sizes(dv, at, extraLen, entry) {
    var end = at + extraLen;
    while (at + 4 <= end) {
      var id = dv.getUint16(at, true), size = dv.getUint16(at + 2, true);
      var body = at + 4;
      if (id === 0x0001) {
        var p = body;
        if (entry.size === 0xffffffff && p + 8 <= end) { entry.size = Number(dv.getBigUint64(p, true)); p += 8; }
        if (entry.compressed === 0xffffffff && p + 8 <= end) { entry.compressed = Number(dv.getBigUint64(p, true)); p += 8; }
        if (entry.offset === 0xffffffff && p + 8 <= end) { entry.offset = Number(dv.getBigUint64(p, true)); p += 8; }
        return;
      }
      at = body + size;
    }
  }

  /**
   * List what is in the archive, without decompressing anything.
   *
   * Reads the central directory at the end of the file, which is where a zip
   * says authoritatively what it holds. A file whose end is missing (a
   * download that stopped, a zip inside a zip stream) falls back to walking
   * the local headers from the front.
   */
  Zip.list = function (buffer) {
    var u8 = new Uint8Array(buffer);
    var dv = new DataView(buffer);
    var entries = [];
    var warnings = [];

    /* find the end-of-central-directory record, searching back from the end */
    var eocd = -1;
    var from = Math.max(0, u8.length - 65557 - 22);
    for (var i = u8.length - 22; i >= from; i--) {
      if (u8[i] === 0x50 && dv.getUint32(i, true) === SIG_EOCD) { eocd = i; break; }
    }

    if (eocd >= 0) {
      var count = dv.getUint16(eocd + 10, true);
      var dirOffset = dv.getUint32(eocd + 16, true);
      /* ZIP64: the 32-bit fields saturate and the real ones live in their own record */
      if (dirOffset === 0xffffffff || count === 0xffff) {
        var loc = eocd - 20;
        if (loc >= 0 && dv.getUint32(loc, true) === 0x07064b50) {
          var z64 = Number(dv.getBigUint64(loc + 8, true));
          if (z64 >= 0 && z64 + 48 <= u8.length && dv.getUint32(z64, true) === 0x06064b50) {
            count = Number(dv.getBigUint64(z64 + 32, true));
            dirOffset = Number(dv.getBigUint64(z64 + 48, true));
          }
        }
      }
      var at = dirOffset;
      for (var e = 0; e < count && at + 46 <= u8.length; e++) {
        if (dv.getUint32(at, true) !== SIG_CENTRAL) break;
        var nameLen = dv.getUint16(at + 28, true);
        var extraLen = dv.getUint16(at + 30, true);
        var commentLen = dv.getUint16(at + 32, true);
        var entry = {
          name: utf8(u8.subarray(at + 46, at + 46 + nameLen)),
          flags: dv.getUint16(at + 8, true),
          method: dv.getUint16(at + 10, true),
          crc: dv.getUint32(at + 16, true),
          compressed: dv.getUint32(at + 20, true),
          size: dv.getUint32(at + 24, true),
          offset: dv.getUint32(at + 42, true)
        };
        zip64Sizes(dv, at + 46 + nameLen, extraLen, entry);
        entries.push(entry);
        at += 46 + nameLen + extraLen + commentLen;
      }
      if (entries.length < count) {
        warnings.push('The archive lists ' + count + ' files but only ' + entries.length +
          ' could be found in it, so it looks cut short.');
      }
    }

    if (!entries.length) {
      /* no usable directory: walk the local headers instead */
      var walk = 0;
      while (walk + 30 <= u8.length && dv.getUint32(walk, true) === SIG_LOCAL) {
        var nLen = dv.getUint16(walk + 26, true);
        var xLen = dv.getUint16(walk + 28, true);
        var size = dv.getUint32(walk + 22, true);
        var comp = dv.getUint32(walk + 18, true);
        var start = walk + 30 + nLen + xLen;
        var flags = dv.getUint16(walk + 6, true);
        if ((flags & 8) && !comp) {
          /* a streamed entry keeps its sizes in a trailer, and without the
             index at the end of the file there is no way to find them */
          warnings.push('The archive has no index and its entries do not say how long they are, ' +
            'so nothing could be read out of it.');
          break;
        }
        entries.push({
          name: utf8(u8.subarray(walk + 30, walk + 30 + nLen)),
          flags: flags,
          method: dv.getUint16(walk + 8, true),
          crc: dv.getUint32(walk + 14, true),
          compressed: comp,
          size: size,
          offset: walk,
          dataAt: start
        });
        walk = start + comp;
      }
      if (entries.length) warnings.push('The archive has no index, so it was read from the front.');
    }

    return { entries: entries, warnings: warnings };
  };

  /**
   * Read one entry out, decompressing it.
   *
   * Returns null when the entry cannot be read, rather than throwing, so one
   * bad file in an archive does not lose the others; `why` says what happened.
   */
  Zip.read = function (buffer, entry) {
    var u8 = new Uint8Array(buffer);
    var dv = new DataView(buffer);
    var at = entry.dataAt;
    if (at === undefined) {
      var head = entry.offset;
      if (head + 30 > u8.length || dv.getUint32(head, true) !== SIG_LOCAL) {
        return { data: null, why: 'its place in the archive is wrong' };
      }
      at = head + 30 + dv.getUint16(head + 26, true) + dv.getUint16(head + 28, true);
    }
    var avail = Math.max(0, u8.length - at);
    var take = Math.min(entry.compressed || avail, avail);
    if (!take && entry.size) return { data: null, why: 'it is not in the file' };
    if (entry.flags & 1) return { data: null, why: 'it is password-protected' };
    var raw = u8.subarray(at, at + take);
    var data;
    try {
      if (entry.method === 0) data = raw.slice(0, Math.min(entry.size || raw.length, raw.length));
      else if (entry.method === 8) data = Zip.inflateRaw(raw, entry.size);
      else return { data: null, why: 'it uses compression this app cannot read (method ' + entry.method + ')' };
    } catch (err) {
      return { data: null, why: (err && err.message) || 'it could not be unpacked' };
    }
    if (entry.crc && data.length) {
      if (Zip.crc32(data) !== entry.crc) return { data: data, why: 'does not match its checksum, so it is damaged' };
    }
    return { data: data, why: null };
  };

  /**
   * Everything in the archive, as { name, data } — the one call the importer
   * needs. `opts.accept(name)` keeps an entry from being unpacked at all, and
   * `opts.budget` caps how many bytes in total will be unpacked, because an
   * archive is free to claim a terabyte inside a kilobyte (a "zip bomb").
   */
  Zip.unpack = function (buffer, opts) {
    opts = opts || {};
    var budget = opts.budget || (192 * 1024 * 1024);
    var listed = Zip.list(buffer);
    var files = [];
    var warnings = listed.warnings.slice();
    var skipped = [];
    for (var i = 0; i < listed.entries.length; i++) {
      var entry = listed.entries[i];
      var name = entry.name;
      /* folders, the junk a Mac puts in a zip, and anything the caller passes over */
      if (!name || name.charAt(name.length - 1) === '/') continue;
      var base = name.replace(/^.*\//, '');
      if (!base || base.charAt(0) === '.' || name.indexOf('__MACOSX') >= 0) continue;
      if (opts.accept && !opts.accept(name, entry)) { skipped.push(name); continue; }
      if (entry.size > budget) {
        warnings.push('"' + name + '" is too big to unpack here (' +
          Math.round(entry.size / (1024 * 1024)) + ' MB).');
        continue;
      }
      var got = Zip.read(buffer, entry);
      if (!got.data) {
        warnings.push('"' + name + '" could not be unpacked — ' + got.why + '.');
        continue;
      }
      if (got.why) warnings.push('"' + name + '" ' + got.why + ', so what came out may be wrong.');
      budget -= got.data.length;
      files.push({ name: name, data: got.data });
      if (budget <= 0) {
        warnings.push('The archive holds more than this app will unpack at once; the rest was left.');
        break;
      }
    }
    return { files: files, warnings: warnings, skipped: skipped, count: listed.entries.length };
  };

})(typeof globalThis !== 'undefined' ? globalThis : this);
