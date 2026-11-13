// Reads spending from a CSV or Excel (.xlsx) file, such as a bank statement
// export, and turns it into spending entries. Real files are messy, so nothing
// here assumes a layout:
//
//  - the header row is found wherever it is (bank preamble lines above it are
//    skipped), or the file may have no header at all;
//  - columns are matched by their names and by what is in them, so they can be
//    in any order, with extra columns (balance, reference...) ignored;
//  - dates and amounts are read in the many shapes banks and spreadsheets use;
//  - each entry is sorted into needs / wants / savings from its description.
//
// Everything runs in the browser; the file is never uploaded. Used by app.js
// as window.SpendingImport, and by the tests through require().
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SpendingImport = api;
})(this, function () {
  'use strict';

  const MAX_ROWS = 20000;
  const MONTHS = {
    jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
    january: 1, february: 2, march: 3, april: 4, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
  };

  // ---------- CSV ----------
  // Picks the separator that splits the first lines most consistently.
  function detectDelimiter(text) {
    const lines = text.split(/\r\n|\n|\r/).filter((l) => l.trim()).slice(0, 25);
    let best = ',';
    let bestScore = -1;
    for (const d of [',', ';', '\t', '|']) {
      const counts = lines.map((l) => splitLine(l, d).length - 1).filter((n) => n > 0);
      if (!counts.length) continue;
      const common = mode(counts);
      const agree = counts.filter((n) => n === common).length;
      const score = agree * 10 + common;
      if (score > bestScore) {
        bestScore = score;
        best = d;
      }
    }
    return best;
  }

  function mode(nums) {
    const tally = new Map();
    nums.forEach((n) => tally.set(n, (tally.get(n) || 0) + 1));
    return [...tally.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0][0];
  }

  // One line, quotes respected (used only for guessing the separator).
  function splitLine(line, d) {
    const out = [];
    let cur = '';
    let quoted = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') quoted = !quoted;
      else if (ch === d && !quoted) {
        out.push(cur);
        cur = '';
      } else cur += ch;
    }
    out.push(cur);
    return out;
  }

  // RFC 4180 CSV: quoted fields, "" inside quotes, line breaks inside quotes.
  function parseCSV(text, delimiter) {
    text = String(text).replace(/^﻿/, '');
    const d = delimiter || detectDelimiter(text);
    const rows = [];
    let row = [];
    let cell = '';
    let quoted = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (quoted) {
        if (ch === '"') {
          if (text[i + 1] === '"') {
            cell += '"';
            i++;
          } else quoted = false;
        } else cell += ch;
      } else if (ch === '"' && cell.trim() === '') {
        quoted = true;
        cell = '';
      } else if (ch === d) {
        row.push(cell);
        cell = '';
      } else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        row.push(cell);
        rows.push(row);
        row = [];
        cell = '';
        if (rows.length > MAX_ROWS) break;
      } else cell += ch;
    }
    if (cell !== '' || row.length) {
      row.push(cell);
      rows.push(row);
    }
    return rows.map((r) => r.map((c) => c.trim())).filter((r) => r.some((c) => c !== ''));
  }

  // ---------- XLSX (a zip of XML files) ----------
  // A small reader for the first worksheet with data: enough for statements
  // and budgets, with no library to download. Old .xls files are not zips.
  async function readXLSX(buffer) {
    const bytes = new Uint8Array(buffer);
    if (bytes[0] === 0xd0 && bytes[1] === 0xcf) {
      throw new Error('That is an old Excel file (.xls). In Excel choose File → Save As → Excel Workbook (.xlsx) or CSV, then import that.');
    }
    if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) throw new Error("That file isn't a readable Excel workbook.");
    const files = await unzip(bytes);
    const text = (name) => (files[name] ? new TextDecoder().decode(files[name]) : '');

    const shared = [];
    const sst = text('xl/sharedStrings.xml');
    for (const m of sst.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)) shared.push(xmlText(m[1]));

    const dateStyles = dateStyleIndexes(text('xl/styles.xml'));
    const date1904 = /date1904="(1|true)"/.test(text('xl/workbook.xml'));

    const sheets = Object.keys(files).filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n));
    sheets.sort((a, b) => Number(a.match(/(\d+)\.xml$/)[1]) - Number(b.match(/(\d+)\.xml$/)[1]));
    let best = [];
    for (const name of sheets) {
      const rows = sheetRows(text(name), shared, dateStyles, date1904);
      if (rows.length > best.length) best = rows;
    }
    return best;
  }

  function sheetRows(xml, shared, dateStyles, date1904) {
    const rows = [];
    for (const rm of xml.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)) {
      const cells = [];
      let next = 0;
      for (const cm of rm[2].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const attrs = cm[1];
        const body = cm[2] || '';
        const ref = /\br="([A-Z]+)\d+"/.exec(attrs);
        const col = ref ? colIndex(ref[1]) : next;
        next = col + 1;
        const type = (/\bt="(\w+)"/.exec(attrs) || [])[1];
        const style = Number((/\bs="(\d+)"/.exec(attrs) || [])[1] || 0);
        const v = /<v>([\s\S]*?)<\/v>/.exec(body);
        let value = '';
        if (type === 's') value = shared[Number(v && v[1])] || '';
        else if (type === 'inlineStr') value = xmlText(body);
        else if (type === 'b') value = v && v[1] === '1' ? 'TRUE' : 'FALSE';
        else if (v) {
          value = xmlDecode(v[1]);
          if ((!type || type === 'n') && dateStyles.has(style) && /^-?\d+(\.\d+)?$/.test(value)) {
            value = excelSerialToISO(Number(value), date1904) || value;
          }
        }
        cells[col] = value.trim();
      }
      for (let i = 0; i < cells.length; i++) if (cells[i] === undefined) cells[i] = '';
      if (cells.some((c) => c !== '')) rows.push(cells);
      if (rows.length > MAX_ROWS) break;
    }
    return rows;
  }

  function colIndex(letters) {
    let n = 0;
    for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
    return n - 1;
  }

  // Style indexes whose number format is a date (built-in or custom).
  function dateStyleIndexes(stylesXml) {
    const custom = new Map();
    for (const m of stylesXml.matchAll(/<numFmt\b[^>]*numFmtId="(\d+)"[^>]*formatCode="([^"]*)"/g)) custom.set(Number(m[1]), xmlDecode(m[2]));
    const isDateFmt = (id) => {
      if ((id >= 14 && id <= 22) || (id >= 45 && id <= 47) || (id >= 27 && id <= 36) || (id >= 50 && id <= 58)) return true;
      const code = custom.get(id);
      if (!code) return false;
      const plain = code.replace(/"[^"]*"|\[[^\]]*\]|\\./g, '');
      return /[dy]/i.test(plain) || /m{3,}/i.test(plain);
    };
    const out = new Set();
    const xfs = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(stylesXml);
    if (!xfs) return out;
    let i = 0;
    for (const m of xfs[1].matchAll(/<xf\b([^>]*?)(?:\/>|>)/g)) {
      const id = Number((/numFmtId="(\d+)"/.exec(m[1]) || [])[1] || 0);
      if (isDateFmt(id)) out.add(i);
      i++;
    }
    return out;
  }

  function excelSerialToISO(serial, date1904) {
    if (!(serial > 0) || serial > 2958465) return null;
    const base = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30);
    const d = new Date(base + Math.floor(serial) * 86400000);
    return d.toISOString().slice(0, 10);
  }

  const xmlDecode = (s) =>
    s
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
      .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
      .replace(/&amp;/g, '&');

  // All <t> text inside a string item (rich text has several), phonetic runs left out.
  function xmlText(xml) {
    const noPhonetic = xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '');
    let out = '';
    for (const m of noPhonetic.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)) out += xmlDecode(m[1]);
    return out;
  }

  // Zip: read the central directory, then inflate each entry.
  async function unzip(bytes) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let eocd = -1;
    for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
      if (view.getUint32(i, true) === 0x06054b50) {
        eocd = i;
        break;
      }
    }
    if (eocd < 0) throw new Error("That file isn't a readable Excel workbook.");
    const count = view.getUint16(eocd + 10, true);
    let p = view.getUint32(eocd + 16, true);
    const files = {};
    for (let n = 0; n < count; n++) {
      if (view.getUint32(p, true) !== 0x02014b50) break;
      const method = view.getUint16(p + 10, true);
      const flags = view.getUint16(p + 8, true);
      const compSize = view.getUint32(p + 20, true);
      const nameLen = view.getUint16(p + 28, true);
      const extraLen = view.getUint16(p + 30, true);
      const commentLen = view.getUint16(p + 32, true);
      const local = view.getUint32(p + 42, true);
      const name = new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + nameLen));
      p += 46 + nameLen + extraLen + commentLen;
      if (!/^xl\/(sharedStrings|styles|workbook|worksheets\/sheet\d+)\.xml$/.test(name)) continue;
      if (flags & 1) throw new Error('That workbook is password-protected. Save an unprotected copy and import that.');
      const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
      const data = bytes.subarray(start, start + compSize);
      if (method === 0) files[name] = data;
      else if (method === 8) files[name] = await inflateRaw(data);
      else throw new Error("That workbook uses a compression this app can't read. Save it as CSV and import that.");
    }
    return files;
  }

  async function inflateRaw(data) {
    if (typeof DecompressionStream === 'undefined') {
      throw new Error("This browser can't open Excel files. Save the sheet as CSV and import that.");
    }
    const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  // ---------- Reading values ----------
  // A signed number from text like "R1 234,56", "-1,234.56", "(250.00)",
  // "250.00 DR", "1.234,56 €". Returns null when it isn't a number.
  function parseAmount(raw) {
    if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
    let s = String(raw || '').trim();
    if (!s) return null;
    let sign = 1;
    if (/^\(.*\)$/.test(s)) {
      sign = -1; // accounting style: (250.00)
      s = s.slice(1, -1).trim();
    }
    if (/(?<=[\d\s.])(dr|debit)\.?$/i.test(s)) {
      sign = -sign;
      s = s.replace(/(dr|debit)\.?$/i, '');
    } else s = s.replace(/(?<=[\d\s.])(cr|credit)\.?$/i, '');
    s = s.replace(/[\s  ']/g, '');
    // Only real currency marks come off: R, ZAR, US$, $, €, £... never other letters.
    const CUR = '(?:zar|usd|eur|gbp|aud|cad|nzd|us\\$|r|\\$|€|£|¥|₹)';
    s = s.replace(new RegExp(`^([-+]?)${CUR}`, 'i'), '$1').replace(new RegExp(`${CUR}$`, 'i'), '');
    if (s.endsWith('-')) {
      sign = -sign; // trailing minus: 250.00-
      s = s.slice(0, -1);
    }
    if (s.startsWith('-')) {
      sign = -sign;
      s = s.slice(1);
    } else if (s.startsWith('+')) s = s.slice(1);
    s = s.replace(new RegExp(`^${CUR}`, 'i'), ''); // -R250
    if (!/^\d[\d.,]*$/.test(s) && !/^[.,]\d+$/.test(s)) return null;
    const lastDot = s.lastIndexOf('.');
    const lastComma = s.lastIndexOf(',');
    if (lastDot >= 0 && lastComma >= 0) {
      // Both: whichever comes last is the decimal point.
      s = lastComma > lastDot ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
    } else if (lastComma >= 0) {
      // Only commas: "1,234" / "1,234,567" are thousands; "12,50" is a decimal comma.
      if (/^\d{1,3}(,\d{3})+$/.test(s)) s = s.replace(/,/g, '');
      else if ((s.match(/,/g) || []).length === 1) s = s.replace(',', '.');
      else return null;
    } else if ((s.match(/\./g) || []).length > 1) {
      if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, ''); // "1.234.567"
      else return null;
    }
    const n = Number(s);
    return Number.isFinite(n) ? sign * n : null;
  }

  function validISO(y, m, d) {
    if (y < 1900 || y > 2200 || m < 1 || m > 12 || d < 1) return null;
    const dt = new Date(Date.UTC(y, m - 1, d));
    if (dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
    return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }

  const fullYear = (y) => (y < 100 ? (y < 70 ? 2000 + y : 1900 + y) : y);

  // 'YYYY-MM-DD' from the many ways a date gets written, or null.
  // `order` settles "03/04/2026": 'dmy' (3 April) or 'mdy' (March 4).
  function parseDate(raw, order = 'dmy') {
    let s = String(raw || '').trim().toLowerCase();
    if (!s) return null;
    s = s.replace(/^(mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)[a-z]*,?\s+/, '');
    s = s.replace(/[t\s]\d{1,2}:\d{2}(:\d{2})?(\.\d+)?\s*(am|pm)?\s*(z|[+-]\d{2}:?\d{2})?$/, '').trim();
    let m;
    if ((m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(s))) return validISO(+m[1], +m[2], +m[3]);
    if ((m = /^(\d{4})(\d{2})(\d{2})$/.exec(s))) return validISO(+m[1], +m[2], +m[3]);
    if ((m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/.exec(s))) {
      const a = +m[1];
      const b = +m[2];
      const y = fullYear(+m[3]);
      if (a > 12) return validISO(y, b, a);
      if (b > 12) return validISO(y, a, b);
      return order === 'mdy' ? validISO(y, a, b) : validISO(y, b, a);
    }
    if ((m = /^(\d{1,2})(?:st|nd|rd|th)?[\s\-/.]+([a-z]{3,9})\.?,?[\s\-/.]+(\d{2}|\d{4})$/.exec(s)) && MONTHS[m[2]]) {
      return validISO(fullYear(+m[3]), MONTHS[m[2]], +m[1]);
    }
    if ((m = /^([a-z]{3,9})\.?[\s\-/.]+(\d{1,2})(?:st|nd|rd|th)?,?[\s\-/.]+(\d{2}|\d{4})$/.exec(s)) && MONTHS[m[1]]) {
      return validISO(fullYear(+m[3]), MONTHS[m[1]], +m[2]);
    }
    return null;
  }

  // For a column of dates like 03/04/2026: does any value prove the order?
  function detectDateOrder(values, fallback = 'dmy') {
    let dmy = 0;
    let mdy = 0;
    for (const v of values) {
      const m = /^\s*(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})\b/.exec(String(v || ''));
      if (!m) continue;
      if (+m[1] > 12) dmy++;
      else if (+m[2] > 12) mdy++;
    }
    if (dmy || mdy) return { order: dmy >= mdy ? 'dmy' : 'mdy', ambiguous: false };
    const any = values.some((v) => /^\s*\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}\b/.test(String(v || '')));
    return { order: fallback, ambiguous: any };
  }

  // ---------- Finding the columns ----------
  const HEADER_PATTERNS = {
    date: /\b(date|datum|posted|posting|transaction date|trans date|day|when)\b/i,
    debit: /\b(debit|debits|withdrawal|withdrawals|money out|paid out|spent|outgoing|expense|expenses|out)\b/i,
    credit: /\b(credit|credits|deposit|deposits|money in|paid in|incoming|income|in)\b/i,
    amount: /\b(amount|amt|value|sum|total|price|cost|bedrag|zar|rand|charge)\b/i,
    balance: /\b(balance|saldo|running)\b/i,
    description: /\b(desc|description|details?|narrative|narration|merchant|payee|reference|memo|particulars|transaction|item|name|note|notes|what|vendor|store|shop)\b/i,
    category: /\b(categor(y|ies)|type|budget|group|class|tag)\b/i,
  };

  function headerScore(row) {
    return row.filter((c) => c && Object.values(HEADER_PATTERNS).some((re) => re.test(c)) && parseAmount(c) === null && !parseDate(c)).length;
  }

  // The header row (or -1 when there isn't one) and where the data starts.
  function findHeader(rows) {
    let best = -1;
    let bestScore = 1;
    for (let i = 0; i < Math.min(rows.length, 40); i++) {
      const score = headerScore(rows[i]);
      if (score > bestScore) {
        best = i;
        bestScore = score;
      }
    }
    if (best >= 0) return { header: best, start: best + 1 };
    // No header: data starts at the first row holding both a date and a number.
    for (let i = 0; i < Math.min(rows.length, 40); i++) {
      const r = rows[i];
      if (r.some((c) => parseDate(c)) && r.some((c) => !parseDate(c) && parseAmount(c) !== null)) return { header: -1, start: i };
    }
    return { header: -1, start: 0 };
  }

  function columnStats(rows, col) {
    let filled = 0;
    let dates = 0;
    let numbers = 0;
    let neg = 0;
    let textLen = 0;
    for (const r of rows) {
      const v = r[col];
      if (v === undefined || v === '') continue;
      filled++;
      if (parseDate(v)) dates++;
      else {
        const n = parseAmount(v);
        if (n !== null) {
          numbers++;
          if (n < 0) neg++;
        } else textLen += v.length;
      }
    }
    const f = filled || 1;
    return { filled, dateRatio: dates / f, numberRatio: numbers / f, negatives: neg, textRatio: (filled - dates - numbers) / f, avgText: textLen / f };
  }

  // Guesses { date, amount, debit, credit, description, category } as column
  // indexes (or -1), from header names first, then from the contents.
  function guessColumns(header, data) {
    const width = Math.max(header.length, ...data.slice(0, 200).map((r) => r.length), 0);
    const sample = data.slice(0, 300);
    const stats = Array.from({ length: width }, (_, c) => columnStats(sample, c));
    const map = { date: -1, amount: -1, debit: -1, credit: -1, description: -1, category: -1 };
    const used = new Set();
    const take = (key, col) => {
      if (col >= 0 && !used.has(col)) {
        map[key] = col;
        used.add(col);
      }
    };
    const named = (re, test = () => true) => header.findIndex((h, c) => h && re.test(h) && !used.has(c) && test(c));
    const numeric = (c) => stats[c] && stats[c].numberRatio >= 0.5;

    // By name. Balance columns are set aside so they are never taken for amounts.
    header.forEach((h, c) => {
      if (h && HEADER_PATTERNS.balance.test(h)) used.add(c);
    });
    take('date', named(HEADER_PATTERNS.date, (c) => stats[c] && stats[c].dateRatio >= 0.5));
    take('debit', named(HEADER_PATTERNS.debit, numeric));
    take('credit', named(HEADER_PATTERNS.credit, numeric));
    if (map.debit < 0 || map.credit < 0) {
      // A lone "money out" or "money in" column is just the amount.
      if (map.debit >= 0) {
        map.amount = map.debit;
        map.debit = -1;
      } else if (map.credit >= 0) {
        used.delete(map.credit);
        map.credit = -1;
      }
    }
    if (map.amount < 0 && map.debit < 0) take('amount', named(HEADER_PATTERNS.amount, numeric));
    take('category', named(HEADER_PATTERNS.category, (c) => stats[c] && stats[c].textRatio >= 0.5));
    take('description', named(HEADER_PATTERNS.description, (c) => stats[c] && stats[c].textRatio >= 0.5));

    // By content, for whatever is still missing.
    const free = () => stats.map((s, c) => ({ ...s, c })).filter((s) => !used.has(s.c) && s.filled);
    if (map.date < 0) {
      const best = free().filter((s) => s.dateRatio >= 0.6).sort((a, b) => b.dateRatio - a.dateRatio)[0];
      if (best) take('date', best.c);
    }
    if (map.amount < 0 && map.debit < 0) {
      const nums = free().filter((s) => s.numberRatio >= 0.6);
      // Two half-empty number columns that never overlap: money out / money in.
      const pair = nums.length >= 2 && nums[0].filled + nums[1].filled <= sample.length + 1 && !sample.some((r) => r[nums[0].c] && r[nums[1].c]);
      if (pair) {
        take('debit', nums[0].c);
        take('credit', nums[1].c);
      } else if (nums.length) {
        take('amount', nums.sort((a, b) => b.filled - a.filled || b.negatives - a.negatives)[0].c);
      }
    }
    if (map.description < 0) {
      const best = free().filter((s) => s.textRatio >= 0.5).sort((a, b) => b.avgText - a.avgText)[0];
      if (best) take('description', best.c);
    }
    return map;
  }

  // ---------- Sorting into the budget ----------
  const CATEGORY_WORDS = {
    savings: [
      'saving', 'savings', 'invest', 'investment', 'unit trust', 'tfsa', 'tax free', 'retirement', 'annuity', 'pension',
      'provident', 'easyequities', 'satrix', 'etf', 'shares', 'crypto', 'emergency fund', 'loan', 'repayment',
      'credit card payment', 'card repayment', 'debt', 'bond payment', 'home loan', 'vehicle finance', 'car finance',
      'student loan', 'transfer to savings', 'to savings',
    ],
    wants: [
      'netflix', 'showmax', 'dstv', 'spotify', 'apple music', 'youtube', 'disney', 'prime video', 'playstation', 'xbox', 'steam',
      'uber eats', 'mr d', 'mrd', 'takealot', 'amazon', 'shein', 'superbalist', 'restaurant', 'cafe', 'coffee', 'starbucks',
      'mugg', 'vida', 'kfc', 'mcdonald', 'nando', 'steers', 'wimpy', 'spur', 'debonairs', 'domino', 'pizza', 'burger', 'sushi',
      'bar', 'pub', 'liquor', 'tops', 'cinema', 'ster-kinekor', 'nu metro', 'movie', 'concert', 'ticket', 'computicket',
      'holiday', 'hotel', 'airbnb', 'booking.com', 'flight', 'gaming', 'hobby', 'gym', 'virgin active', 'planet fitness',
      'clothing', 'clothes', 'fashion', 'mr price', 'edgars', 'woolworths fashion', 'gift', 'entertainment', 'eating out',
      'takeaway', 'take away', 'beauty', 'salon', 'spa', 'want', 'wants', 'fun', 'shopping', 'hobbies',
    ],
    needs: [
      'rent', 'levy', 'levies', 'rates', 'municipal', 'electricity', 'eskom', 'prepaid elec', 'water', 'utilities',
      'checkers', 'pick n pay', 'pnp', 'shoprite', 'spar', 'woolworths', 'food lover', 'makro', 'game stores', 'grocer',
      'groceries', 'supermarket', 'fuel', 'petrol', 'diesel', 'engen', 'shell', 'sasol', 'bp', 'caltex', 'total energies',
      'uber', 'bolt', 'taxi', 'transport', 'gautrain', 'bus', 'train', 'parking', 'toll', 'e-toll', 'insurance', 'medical aid',
      'discovery', 'momentum', 'bonitas', 'doctor', 'dentist', 'pharmacy', 'clicks', 'dis-chem', 'dischem', 'hospital',
      'school', 'tuition', 'fees', 'childcare', 'creche', 'vodacom', 'mtn', 'cell c', 'telkom', 'rain', 'airtime', 'data',
      'internet', 'fibre', 'wifi', 'fee', 'fees', 'bank fee', 'bank charge', 'service fee', 'monthly fee', 'tax', 'sars', 'need', 'needs',
      'housing', 'mortgage', 'bills',
    ],
  };

  // needs / wants / savings from a category label (if the file has one) or the
  // description. Savings words are checked first ("credit card payment" isn't
  // a want), then wants ("uber eats" before "uber").
  // Short words must match whole ("bar", not "barber"); longer ones may start a
  // word ("invest" in "investment") but not sit inside one ("rent" in "current").
  const escapeRe = (w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const CATEGORY_RES = Object.fromEntries(
    Object.entries(CATEGORY_WORDS).map(([cat, words]) => [
      cat,
      words.map((w) => new RegExp(`(^|[^a-z0-9])${escapeRe(w)}${w.length <= 4 ? '($|[^a-z0-9])' : ''}`, 'i')),
    ])
  );

  function guessCategory(description, label = '') {
    const pick = (text) => {
      const t = String(text || '').toLowerCase();
      if (!t.trim()) return null;
      for (const cat of ['savings', 'wants', 'needs']) {
        if (CATEGORY_RES[cat].some((re) => re.test(t))) return cat;
      }
      return null;
    };
    const found = pick(label) || pick(description);
    return { category: found || 'needs', guessed: !found };
  }

  // ---------- Putting it together ----------
  // Reads a File (CSV or .xlsx) into rows.
  async function readFile(file) {
    const name = (file.name || '').toLowerCase();
    if (/\.(xlsx|xlsm)$/.test(name)) return readXLSX(await file.arrayBuffer());
    if (/\.xls$/.test(name)) return readXLSX(await file.arrayBuffer()); // explains .xls
    const buf = await file.arrayBuffer();
    const head = new Uint8Array(buf.slice(0, 4));
    if (head[0] === 0x50 && head[1] === 0x4b) return readXLSX(buf); // an .xlsx with another name
    if (head[0] === 0xd0 && head[1] === 0xcf) return readXLSX(buf);
    let text = new TextDecoder('utf-8').decode(buf);
    if (text.includes('�')) text = new TextDecoder('windows-1252').decode(buf); // older Excel CSV exports
    return parseCSV(text);
  }

  // Everything the import screen needs from the rows: header, guessed columns,
  // date order, and which amounts are spending.
  function analyse(rows, { locale = 'en-ZA' } = {}) {
    const { header: h, start } = findHeader(rows);
    const header = h >= 0 ? rows[h] : [];
    const data = rows.slice(start);
    const columns = guessColumns(header, data);
    const dateValues = columns.date >= 0 ? data.map((r) => r[columns.date]) : [];
    const fallback = /^en-(US|PH)$|^en-us/i.test(locale) ? 'mdy' : 'dmy';
    const { order, ambiguous } = detectDateOrder(dateValues, fallback);
    let spending = 'all';
    if (columns.amount >= 0) {
      const amounts = data.map((r) => parseAmount(r[columns.amount])).filter((n) => n !== null);
      const negatives = amounts.filter((n) => n < 0).length;
      // Bank exports show money out as negative; a sheet of only positive numbers is all spending.
      if (negatives > 0 && negatives < amounts.length) spending = 'negative';
      else if (negatives === amounts.length && amounts.length) spending = 'all';
    }
    const width = Math.max(header.length, ...data.slice(0, 200).map((r) => r.length), 0);
    const labels = Array.from({ length: width }, (_, c) => {
      const name = header[c] && header[c].trim();
      const example = (data.find((r) => r[c]) || [])[c] || '';
      return name || `Column ${c + 1}${example ? ` (e.g. ${example.slice(0, 24)})` : ''}`;
    });
    return { header, headerRow: h, data, start, columns, dateOrder: order, dateAmbiguous: ambiguous, spending, labels };
  }

  const dupKey = (e) => `${e.date}|${Math.round(e.amount * 100)}|${String(e.note || '').trim().toLowerCase()}`;

  // Turns rows into entries with the chosen columns and options. Every row
  // ends up either as an entry or in `skipped` with a reason.
  function buildEntries(data, columns, { dateOrder = 'dmy', spending = 'all', existing = [] } = {}) {
    const seen = new Set(existing.map(dupKey));
    const entries = [];
    const skipped = { income: 0, unreadable: 0, zero: 0 };
    data.forEach((row, index) => {
      const date = columns.date >= 0 ? parseDate(row[columns.date], dateOrder) : null;
      let amount = null;
      if (columns.debit >= 0) {
        const out = parseAmount(row[columns.debit]);
        const into = columns.credit >= 0 ? parseAmount(row[columns.credit]) : null;
        if (out !== null && out !== 0) amount = Math.abs(out);
        else if (into !== null && into !== 0) {
          skipped.income++;
          return;
        }
      } else if (columns.amount >= 0) {
        const n = parseAmount(row[columns.amount]);
        if (n !== null) {
          if ((spending === 'negative' && n > 0) || (spending === 'positive' && n < 0)) {
            skipped.income++;
            return;
          }
          amount = Math.abs(n);
        }
      }
      if (!date || amount === null) {
        skipped.unreadable++;
        return;
      }
      if (amount === 0) {
        skipped.zero++;
        return;
      }
      const note = (columns.description >= 0 ? row[columns.description] || '' : '').replace(/\s+/g, ' ').trim().slice(0, 80);
      const label = columns.category >= 0 ? row[columns.category] || '' : '';
      const { category, guessed } = guessCategory(note, label);
      const entry = { row: index, date, amount: Math.round(amount * 100) / 100, note, category, guessed };
      entry.duplicate = seen.has(dupKey(entry));
      seen.add(dupKey(entry));
      entries.push(entry);
    });
    entries.sort((a, b) => b.date.localeCompare(a.date) || a.row - b.row);
    return { entries, skipped };
  }

  return {
    parseCSV,
    detectDelimiter,
    readXLSX,
    readFile,
    parseAmount,
    parseDate,
    detectDateOrder,
    findHeader,
    guessColumns,
    guessCategory,
    analyse,
    buildEntries,
    excelSerialToISO,
  };
});
