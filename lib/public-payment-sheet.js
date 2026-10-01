const DEFAULT_SHEET_ID = '1ZZxYqGN3YMqc6JFpC5bWW3qFBm_P9nxbwp4dwczBhTc';
const DEFAULT_SHEET_GID = '1000275049';

const sheetId = () => process.env.PAYMENT_SHEET_ID || DEFAULT_SHEET_ID;
const sheetGid = () => process.env.PAYMENT_SHEET_GID || DEFAULT_SHEET_GID;

export function paymentSheetConfigured() {
  return Boolean(sheetId() && sheetGid());
}

export function parseCsv(text) {
  text = text.replace(/^\uFEFF/, '');
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (char === '"') quoted = false;
      else cell += char;
      continue;
    }
    if (char === '"' && cell === '') quoted = true;
    else if (char === ',') { row.push(cell); cell = ''; }
    else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += char;
  }
  if (cell.length || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(values => values.some(value => value.trim() !== ''));
}

export async function readPaymentSheet() {
  if (!paymentSheetConfigured()) throw new Error('Payment sheet access is not configured.');
  const url = `https://docs.google.com/spreadsheets/d/${encodeURIComponent(sheetId())}/gviz/tq?tqx=out:csv&gid=${encodeURIComponent(sheetGid())}`;
  const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error('Could not read the payment sheet.');
  const text = await response.text();
  if (/^\s*</.test(text)) throw new Error('The payment sheet must allow public read access.');
  return parseCsv(text);
}
