'use strict';
// Importing spending from messy CSV and Excel files (public/spending-import.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const S = require('../../public/spending-import.js');

const FIXTURES = path.join(__dirname, '..', 'fixtures');

async function importFile(name, options = {}) {
  const file = path.join(FIXTURES, name);
  const rows = name.endsWith('.xlsx') ? await S.readXLSX(fs.readFileSync(file)) : S.parseCSV(fs.readFileSync(file, 'utf8'));
  const a = S.analyse(rows, options);
  const result = S.buildEntries(a.data, a.columns, { dateOrder: a.dateOrder, spending: a.spending, existing: options.existing });
  return { a, ...result };
}

const summary = (entries) => entries.map((e) => [e.date, e.amount, e.category, e.note]);

test('amounts in the shapes banks and spreadsheets use', () => {
  const cases = {
    'R1 234,56': 1234.56,
    '-1,234.56': -1234.56,
    '(250.00)': -250,
    '250.00 DR': -250,
    '250.00DR': -250,
    '250.00 CR': 250,
    '250.00-': -250,
    '1.234,56 €': 1234.56,
    '-R50': -50,
    'R-50': -50,
    'ZAR 99.90': 99.9,
    '$1,000.00': 1000,
    '12,50': 12.5,
    '1,234': 1234,
    '1.234.567': 1234567,
    '+300': 300,
    '0': 0,
  };
  for (const [raw, want] of Object.entries(cases)) assert.equal(S.parseAmount(raw), want, raw);
  for (const raw of ['', 'Groceries', 'Shop123', '2026-11-13', '13/11/2026', '1,2,3', 'R', '--5']) {
    assert.equal(S.parseAmount(raw), null, raw);
  }
});

test('dates in many formats, with impossible dates rejected', () => {
  const cases = {
    '2026-11-13': '2026-11-13',
    '2026/11/13': '2026-11-13',
    '20261113': '2026-11-13',
    '13/11/2026': '2026-11-13',
    '13.11.2026': '2026-11-13',
    '13-11-26': '2026-11-13',
    '13 Nov 2026': '2026-11-13',
    '13-Nov-26': '2026-11-13',
    '13 November 2026': '2026-11-13',
    'Nov 13, 2026': '2026-11-13',
    'Fri, 13 Nov 2026': '2026-11-13',
    '13th Nov 2026': '2026-11-13',
    '2026-11-13T10:22:00Z': '2026-11-13',
    '13/11/2026 14:05': '2026-11-13',
  };
  for (const [raw, want] of Object.entries(cases)) assert.equal(S.parseDate(raw), want, raw);
  for (const raw of ['31/02/2026', '2026-13-01', 'hello', '', '13/13/2026']) assert.equal(S.parseDate(raw), null, raw);
  // Ambiguous: the order decides; a day over 12 settles it either way.
  assert.equal(S.parseDate('03/04/2026', 'dmy'), '2026-04-03');
  assert.equal(S.parseDate('03/04/2026', 'mdy'), '2026-03-04');
  assert.equal(S.parseDate('11/13/2026', 'dmy'), '2026-11-13');
});

test('date order is worked out from the column when possible', () => {
  assert.deepEqual(S.detectDateOrder(['03/04/2026', '25/04/2026']), { order: 'dmy', ambiguous: false });
  assert.deepEqual(S.detectDateOrder(['03/04/2026', '04/25/2026']), { order: 'mdy', ambiguous: false });
  assert.deepEqual(S.detectDateOrder(['03/04/2026', '05/06/2026'], 'dmy'), { order: 'dmy', ambiguous: true });
  assert.deepEqual(S.detectDateOrder(['2026-04-03']), { order: 'dmy', ambiguous: false });
});

test('CSV: quotes, separators, line breaks inside quotes, BOM', () => {
  assert.deepEqual(S.parseCSV('﻿a,b\r\n"x, y","say ""hi"""\n'), [['a', 'b'], ['x, y', 'say "hi"']]);
  assert.deepEqual(S.parseCSV('a;b;c\n1;2,5;3\n'), [['a', 'b', 'c'], ['1', '2,5', '3']]);
  assert.deepEqual(S.parseCSV('a\tb\n1\t2\n'), [['a', 'b'], ['1', '2']]);
  assert.deepEqual(S.parseCSV('note,amt\n"line one\nline two",5\n'), [['note', 'amt'], ['line one\nline two', '5']]);
  assert.deepEqual(S.parseCSV('\n\na,b\n\n1,2\n\n'), [['a', 'b'], ['1', '2']], 'blank lines are dropped');
});

test('sorting into needs, wants and savings', () => {
  const cases = {
    'POS PURCHASE CHECKERS HYPER': 'needs',
    'DEBIT ORDER RENT': 'needs',
    'ENGEN GARAGE': 'needs',
    'Uber trip': 'needs',
    'MONTHLY ACCOUNT FEE': 'needs',
    'NETFLIX.COM': 'wants',
    'UBER EATS': 'wants',
    'Takealot order': 'wants',
    'TRANSFER TO SAVINGS': 'savings',
    'Credit card payment': 'savings',
    'Home loan': 'savings',
  };
  for (const [text, want] of Object.entries(cases)) assert.equal(S.guessCategory(text).category, want, text);
  assert.deepEqual(S.guessCategory('current affairs magazine'), { category: 'needs', guessed: true }, '"rent" inside "current" is not rent');
  assert.equal(S.guessCategory('anything', 'Want').category, 'wants', "the file's own category column wins");
});

test('bank statement: preamble lines, signed amounts, balance column ignored', async () => {
  const { a, entries, skipped } = await importFile('bank-statement.csv');
  assert.equal(a.headerRow, 3, 'the header is found below three lines of account details');
  assert.deepEqual(a.columns, { date: 0, time: -1, amount: 1, debit: -1, credit: -1, description: 3, category: -1 });
  assert.equal(a.spending, 'negative');
  assert.equal(skipped.income, 1, 'the salary is money in, not spending');
  assert.deepEqual(summary(entries), [
    ['2026-11-11', 89.99, 'needs', 'SOMETHING UNUSUAL'],
    ['2026-11-10', 310.75, 'needs', 'ENGEN GARAGE N1'],
    ['2026-11-09', 55, 'needs', 'MONTHLY ACCOUNT FEE'],
    ['2026-11-08', 245, 'wants', 'UBER EATS'],
    ['2026-11-06', 1000, 'savings', 'TRANSFER TO SAVINGS'],
    ['2026-11-05', 199, 'wants', 'NETFLIX.COM'],
    ['2026-11-03', 860.5, 'needs', 'POS PURCHASE CHECKERS HYPER, CAPE TOWN'],
    ['2026-11-01', 4200, 'needs', 'DEBIT ORDER RENT NOVEMBER'],
  ]);
  assert.equal(entries[0].guessed, true, 'the one it could not place is flagged');
});

test('semicolons, decimal commas, money in/out columns, date column last', async () => {
  const { a, entries, skipped } = await importFile('money-in-out.csv');
  assert.deepEqual(a.columns, { date: 4, time: -1, amount: -1, debit: 2, credit: 1, description: 0, category: -1 });
  assert.deepEqual(summary(entries), [
    ['2026-11-13', 1234.56, 'needs', 'Woolworths Food'],
    ['2026-11-10', 99, 'wants', 'Showmax subscription'],
    ['2026-11-09', 150, 'needs', 'Vodacom airtime'],
  ]);
  assert.equal(skipped.income, 1, 'the refund is money in');
  assert.equal(skipped.unreadable, 1, 'the opening balance line has no date or spending');
});

test('no header row at all', async () => {
  const { a, entries } = await importFile('no-header.csv');
  assert.equal(a.headerRow, -1);
  assert.deepEqual(summary(entries).map((e) => e.slice(0, 2)), [
    ['2026-11-13', 450.2],
    ['2026-11-12', 59.99],
    ['2026-11-04', 612.4],
  ]);
  assert.match(a.labels[1], /Column 2 \(e\.g\. Woolworths Food\)/, 'unnamed columns get a helpful label');
});

test('Excel: title row, real date cells, own category column, extra sheet', async () => {
  const { a, entries } = await importFile('budget.xlsx');
  assert.deepEqual(a.columns, { date: 3, time: -1, amount: 2, debit: -1, credit: -1, description: 0, category: 1 });
  assert.deepEqual(summary(entries), [
    ['2026-11-07', 650.5, 'wants', 'Dinner out & drinks'],
    ['2026-11-03', 900, 'needs', 'Electricity'],
    ['2026-11-02', 1000, 'savings', 'Emergency fund'],
    ['2026-11-01', 4200, 'needs', 'Rent'],
  ]);
});

test('Excel: debit and credit columns, dates as text', async () => {
  const { a, entries, skipped } = await importFile('debit-credit.xlsx');
  assert.equal(a.columns.debit, 2);
  assert.equal(a.columns.credit, 3);
  assert.deepEqual(summary(entries), [
    ['2026-11-13', 320.1, 'needs', 'SPAR GROCERIES'],
    ['2026-11-11', 549, 'wants', 'VIRGIN ACTIVE'],
  ]);
  assert.equal(skipped.income, 1);
});

test('entries already logged are marked as duplicates', async () => {
  const existing = [{ date: '2026-11-05', amount: 199, note: 'netflix.com' }];
  const { entries } = await importFile('bank-statement.csv', { existing });
  assert.deepEqual(entries.filter((e) => e.duplicate).map((e) => e.note), ['NETFLIX.COM']);
});

test('old .xls and broken files give a clear message', async () => {
  const xls = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0, 0, 0, 0]);
  await assert.rejects(() => S.readXLSX(xls.buffer), /old Excel file \(\.xls\)/);
  await assert.rejects(() => S.readXLSX(new Uint8Array([1, 2, 3, 4]).buffer), /isn't a readable Excel workbook/);
});

test('excel serial dates', () => {
  assert.equal(S.excelSerialToISO(46339), '2026-11-13');
  assert.equal(S.excelSerialToISO(44877, true), '2026-11-13', '1904 date system');
});

test('times: on their own, at the end of a date, or as an Excel fraction', () => {
  const cases = {
    '14:05': '14:05',
    '2:05 pm': '14:05',
    '12:30 AM': '00:30',
    '14h05': '14:05',
    '13/11/2026 14:05': '14:05',
    '2026-11-13T10:22:00Z': '10:22',
    '0.5': '12:00',
  };
  for (const [raw, want] of Object.entries(cases)) assert.equal(S.parseTime(raw), want, raw);
  for (const raw of ['13/11/2026', '25:00', '13:00 pm', 'hello', '']) assert.equal(S.parseTime(raw), null, raw);
});

test('a separate time column is used, and blank times stay blank', async () => {
  const { a, entries } = await importFile('with-times.csv');
  assert.equal(a.columns.time, 1);
  assert.deepEqual(entries.map((e) => [e.date, e.time, e.note]), [
    ['2026-11-13', '14:05', 'Woolworths Food'],
    ['2026-11-13', '09:15', 'Vida e Caffe'],
    ['2026-11-12', null, 'Spotify'],
  ], 'newest first, by time within a day');
});

test('Excel date-time cells keep the time; midnight means no time', async () => {
  const { entries } = await importFile('datetimes.xlsx');
  assert.deepEqual(entries.map((e) => [e.date, e.time, e.note]), [
    ['2026-11-13', '14:05', 'Checkers'],
    ['2026-11-12', null, 'Rent'],
  ]);
});

test('a time inside the date cell is picked up too', () => {
  const rows = S.parseCSV('Date,Description,Amount\n13/11/2026 18:45,Uber Eats,-120\n');
  const a = S.analyse(rows);
  const { entries } = S.buildEntries(a.data, a.columns, { dateOrder: a.dateOrder, spending: a.spending });
  assert.deepEqual([entries[0].date, entries[0].time], ['2026-11-13', '18:45']);
});

test('one name per place, whatever the bank wrapped around it', () => {
  const cases = {
    'POS PURCHASE CHECKERS HYPER, CAPE TOWN': 'Checkers Hyper',
    'Checkers Hyper': 'Checkers Hyper',
    'CARD PURCHASE ENGEN GARAGE N1 4412********1234': 'Engen Garage N1',
    'DEBIT ORDER RENT NOVEMBER': 'Rent',
    'Payment to John Smith - ref 1234': 'John Smith',
    'EFT PAYMENT TO BODY CORPORATE 13/11': 'Body Corporate',
    'NETFLIX.COM': 'Netflix.com',
    'Woolworths Food': 'Woolworths Food',
  };
  for (const [raw, want] of Object.entries(cases)) assert.equal(S.merchantName(raw), want, raw);
});
