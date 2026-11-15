import type { SensitiveCategory } from './sensitive-category.js';

export interface ProtectedSpan {
  readonly start: number;
  readonly end: number;
  readonly value: string;
  readonly category: SensitiveCategory;
}

const EMAIL_RE = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
const LOCAL_PHONE_RE =
  /(?<!\d)\+?57[\s.-]?(?:\(\d{3}\)|\d{3})[\s.-]?\d{3}[\s.-]?\d{4}(?!\d)|(?<!\d)(?:\(\d{3}\)|\d{3})[\s.-]?\d{3}[\s.-]?\d{4}(?!\d)/g;
const GUATEMALA_LOCAL_PHONE_RE =
  /(?<![\d+])[2-7]\d{3}(?:[\s-]\d{4}|\d{4})(?!\d)/g;
const INTERNATIONAL_SEPARATORS = new Set([' ', '\t', '.', '-', '(', ')']);
const DPI_LABELED_RE =
  /(?:DPI|CUI|c[eé]dula|documento de identidad)\s*[:#]?\s*(?:\d{4}\s\d{5}\s\d{4}|\d{13})/gi;
const DPI_GROUPED_RE = /(?<!\d)\d{4}\s\d{5}\s\d{4}(?!\d)/g;
const NIT_LABELED_RE =
  /\bNIT\s*[:#]?\s*\d{3}\.?\d{3}\.?\d{3}\s*-?\s*\d(?!\d)/gi;
const NIT_DOTTED_RE = /(?<!\d)\d{3}\.\d{3}\.\d{3}-\d(?!\d)/g;
const ADDRESS_RE =
  /\b(?:Calle|Carrera|Avenida|Diagonal|Transversal|Km|Cl|Cra|Kr|Av|Dg|Tv)\.?\s+\d+[A-Za-z]?(?:\s*(?:#|No\.?|Nro\.?)\s*\d+[A-Za-z]?(?:\s*-\s*\d+)?)?(?:\s+[A-Za-zÁÉÍÓÚÜÑáéíóúüñ][A-Za-zÁÉÍÓÚÜÑáéíóúüñ.]*){0,6}/g;
const CONTRACT_RE =
  /\b(?:contrato|contract)\s+(?:n[úu]mero|no\.?|nro\.?|#|:)\s*[A-Z][A-Z0-9-]{3,}/gi;
const EXTERNAL_LABELED_RE =
  /\b(?:referencia externa|external reference|id externo)\s*[:#]?\s*[A-Z0-9-]{4,}/gi;
const UUID_RE =
  /(?<![A-Za-z0-9])[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?![A-Za-z0-9])/gi;
const ACCOUNT_RE = /\bCLI-[A-Z0-9]+(?:-[A-Z0-9]+)*\b/g;
const METER_RE = /\bMED-[A-Z0-9]+(?:-[A-Z0-9]+)*\b/g;
const TICKET_RE = /\bPV-[A-Z0-9]+(?:-[A-Z0-9]+)*\b/g;
const LEGAL_SUFFIX = /^\s+(?:S\.A\.S\.?|S\.A\.|Ltda\.?|SAS)(?!\w)/;
const WORD_RE = /[A-Za-zÁÉÍÓÚÜÑáéíóúüñ][A-Za-zÁÉÍÓÚÜÑáéíóúüñ'’-]*/g;

const HONORIFICS = new Set([
  'senor',
  'senora',
  'sr',
  'sra',
  'don',
  'dona',
  'ing',
  'ingeniero',
  'ingeniera',
  'dr',
  'dra',
  'lic',
]);

const STOP_WORDS = new Set([
  'el',
  'la',
  'los',
  'las',
  'un',
  'una',
  'de',
  'del',
  'y',
  'o',
  'en',
  'por',
  'para',
  'con',
  'sin',
  'sobre',
  'entre',
  'que',
  'es',
  'son',
  'no',
  'si',
  'al',
  'lo',
  'su',
  'sus',
  'se',
  'ha',
  'han',
  'fue',
  'como',
  'mas',
  'muy',
  'ya',
  'este',
  'esta',
  'estos',
  'estas',
  'ese',
  'esa',
  'demanda',
  'consumo',
  'umbral',
  'lectura',
  'periodo',
  'contractual',
  'observacion',
  'anomalia',
  'historico',
  'historicos',
  'promedio',
  'diferencia',
  'variacion',
  'medicion',
  'analisis',
  'tecnico',
  'tecnica',
  'conjunto',
  'controlado',
  'potencia',
  'factor',
  'calidad',
  'energia',
  'cliente',
  'instalacion',
  'medidor',
  'solicitud',
  'informe',
  'hallazgo',
  'evidencia',
  'confirmada',
  'interpretacion',
  'maxima',
  'maximo',
  'medida',
  'medido',
  'meses',
  'anteriores',
  'numerica',
  'confirma',
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
  'planta',
  'complejo',
  'bodega',
  'sede',
  'subestacion',
  'kw',
  'kwh',
  'kva',
  'act',
]);

const PARTICLES = new Set(['de', 'del', 'la', 'las', 'los', 'y']);

interface WordToken {
  value: string;
  start: number;
  end: number;
}

interface NameSequence {
  start: number;
  end: number;
  nextIndex: number;
}

export function findProtectedSpans(text: string): ProtectedSpan[] {
  const spans: ProtectedSpan[] = [];
  collectPattern(text, EMAIL_RE, 'email', spans, 320);
  collectInternationalPhones(text, spans);
  collectLocalPhones(text, spans);
  collectGuatemalaLocalPhones(text, spans);
  collectPattern(text, DPI_LABELED_RE, 'personal-id', spans, 80);
  collectPattern(text, DPI_GROUPED_RE, 'personal-id', spans, 20);
  collectNits(text, spans);
  collectPattern(text, ADDRESS_RE, 'address', spans, 120);
  collectPattern(text, CONTRACT_RE, 'contract', spans, 80);
  collectPattern(text, UUID_RE, 'external-reference', spans, 36);
  collectPattern(text, EXTERNAL_LABELED_RE, 'external-reference', spans, 80);
  collectPattern(text, ACCOUNT_RE, 'customer-account', spans, 40);
  collectPattern(text, METER_RE, 'meter', spans, 40);
  collectPattern(text, TICKET_RE, 'ticket', spans, 40);
  collectNames(text, spans);
  return spans.sort((left, right) => left.start - right.start);
}

function collectPattern(
  text: string,
  pattern: RegExp,
  category: SensitiveCategory,
  spans: ProtectedSpan[],
  maxLength: number,
): void {
  for (const match of text.matchAll(
    new RegExp(pattern.source, pattern.flags),
  )) {
    if (match[0].length > maxLength) {
      continue;
    }
    pushSpan(spans, match.index, match[0], category);
  }
}

function collectInternationalPhones(
  text: string,
  spans: ProtectedSpan[],
): void {
  for (const match of text.matchAll(/(?<![\w+])\+/g)) {
    const phone = readInternationalPhone(text, match.index);
    if (!phone || touchesTechnicalQuantity(text, phone.start, phone.end)) {
      continue;
    }
    pushSpan(spans, phone.start, phone.value, 'phone');
  }
}

function collectLocalPhones(text: string, spans: ProtectedSpan[]): void {
  for (const match of text.matchAll(new RegExp(LOCAL_PHONE_RE.source, 'g'))) {
    const end = match.index + match[0].length;
    if (
      touchesTechnicalQuantity(text, match.index, end) ||
      followsInternationalPrefix(text, match.index)
    ) {
      continue;
    }
    pushSpan(spans, match.index, match[0], 'phone');
  }
}

function collectGuatemalaLocalPhones(
  text: string,
  spans: ProtectedSpan[],
): void {
  for (const match of text.matchAll(
    new RegExp(GUATEMALA_LOCAL_PHONE_RE.source, 'g'),
  )) {
    const end = match.index + match[0].length;
    const digits = match[0].replace(/\D/g, '');
    if (
      touchesTechnicalQuantity(text, match.index, end) ||
      isCalendarDate(digits) ||
      followsInternationalPrefix(text, match.index)
    ) {
      continue;
    }
    pushSpan(spans, match.index, match[0], 'phone');
  }
}

function collectNits(text: string, spans: ProtectedSpan[]): void {
  for (const pattern of [NIT_LABELED_RE, NIT_DOTTED_RE]) {
    for (const match of text.matchAll(
      new RegExp(pattern.source, pattern.flags),
    )) {
      const around = text.slice(
        Math.max(0, match.index - 16),
        match.index + match[0].length + 16,
      );
      const category: SensitiveCategory = /personal/i.test(around)
        ? 'personal-nit'
        : 'tax-id';
      pushSpan(spans, match.index, match[0], category);
    }
  }
}

function collectNames(text: string, spans: ProtectedSpan[]): void {
  const tokens = wordTokens(text);
  let index = 0;
  while (index < tokens.length) {
    const token = tokens[index];
    if (!token || overlaps(spans, token.start, token.end)) {
      index += 1;
      continue;
    }
    if (isHonorific(token.value)) {
      const sequence = readSequence(text, tokens, index + 1, false, true);
      if (sequence) {
        pushName(text, spans, sequence);
        index = sequence.nextIndex;
        continue;
      }
    }
    const capitalized = readSequence(text, tokens, index, true, false);
    if (capitalized) {
      pushName(text, spans, capitalized);
      index = capitalized.nextIndex;
      continue;
    }
    index += 1;
  }
}

function pushName(
  text: string,
  spans: ProtectedSpan[],
  sequence: NameSequence,
): void {
  const suffix = LEGAL_SUFFIX.exec(text.slice(sequence.end));
  const end = suffix ? sequence.end + suffix[0].length : sequence.end;
  if (overlaps(spans, sequence.start, end)) {
    return;
  }
  spans.push({
    start: sequence.start,
    end,
    value: text.slice(sequence.start, end),
    category: suffix ? 'customer' : 'person',
  });
}

function readSequence(
  text: string,
  tokens: readonly WordToken[],
  start: number,
  requireCapital: boolean,
  anchored: boolean,
): NameSequence | null {
  const first = tokens[start];
  if (!first) {
    return null;
  }
  if (anchored) {
    const previous = tokens[start - 1];
    if (!previous || !isHonorificGap(text, previous, first)) {
      return null;
    }
  }
  const nameWords: WordToken[] = [];
  let cursor = start;
  while (cursor < tokens.length && nameWords.length < 4) {
    const token = tokens[cursor];
    const previous = nameWords.at(-1) ?? tokens[start - 1] ?? token;
    if (
      !token ||
      (nameWords.length > 0 && !isPlainGap(text, previous, token))
    ) {
      break;
    }
    if (nameWords.length > 0 && PARTICLES.has(fold(token.value))) {
      const run = particleRun(text, tokens, cursor);
      const following = tokens[run.next];
      const lastParticle = tokens[run.next - 1];
      if (
        !following ||
        !lastParticle ||
        !isPlainGap(text, lastParticle, following) ||
        !acceptsName(following.value, requireCapital)
      ) {
        break;
      }
      nameWords.push(following);
      cursor = run.next + 1;
      continue;
    }
    if (!acceptsName(token.value, requireCapital)) {
      break;
    }
    nameWords.push(token);
    cursor += 1;
  }
  const last = nameWords.at(-1);
  const minimum = requireCapital ? 2 : 1;
  if (!last || nameWords.length < minimum) {
    return null;
  }
  return { start: first.start, end: last.end, nextIndex: cursor };
}

function particleRun(
  text: string,
  tokens: readonly WordToken[],
  start: number,
): { next: number } {
  let cursor = start;
  while (cursor < tokens.length && cursor - start < 3) {
    const token = tokens[cursor];
    const previous = tokens[cursor - 1];
    if (
      !token ||
      !previous ||
      !PARTICLES.has(fold(token.value)) ||
      !isPlainGap(text, previous, token)
    ) {
      break;
    }
    cursor += 1;
  }
  return { next: cursor };
}

function readInternationalPhone(
  text: string,
  start: number,
): { start: number; end: number; value: string } | null {
  let index = start + 1;
  let digits = '';
  let lastDigit = -1;
  while (index < text.length) {
    const character = text[index] ?? '';
    if (character >= '0' && character <= '9') {
      if ((digits.length === 0 && character === '0') || digits.length === 15) {
        return null;
      }
      digits += character;
      lastDigit = index;
      index += 1;
      continue;
    }
    if (INTERNATIONAL_SEPARATORS.has(character)) {
      index += 1;
      continue;
    }
    break;
  }
  if (lastDigit < 0 || !isAcceptableInternational(digits)) {
    return null;
  }
  return {
    start,
    end: lastDigit + 1,
    value: text.slice(start, lastDigit + 1),
  };
}

function wordTokens(text: string): WordToken[] {
  return [...text.matchAll(WORD_RE)].map((match) => ({
    value: match[0],
    start: match.index,
    end: match.index + match[0].length,
  }));
}

function pushSpan(
  spans: ProtectedSpan[],
  start: number,
  value: string,
  category: SensitiveCategory,
): void {
  const end = start + value.length;
  if (overlaps(spans, start, end) || value.trim().length === 0) {
    return;
  }
  spans.push({ start, end, value, category });
}

function overlaps(
  spans: readonly ProtectedSpan[],
  start: number,
  end: number,
): boolean {
  return spans.some((span) => start < span.end && end > span.start);
}

function isAcceptableInternational(digits: string): boolean {
  if (digits.startsWith('502')) {
    return digits.length === 11;
  }
  return digits.length >= 8 && digits.length <= 15;
}

function followsInternationalPrefix(text: string, start: number): boolean {
  let index = start - 1;
  while (index >= 0) {
    const character = text[index] ?? '';
    if (character >= '0' && character <= '9') {
      index -= 1;
      continue;
    }
    if (INTERNATIONAL_SEPARATORS.has(character)) {
      index -= 1;
      continue;
    }
    return character === '+';
  }
  return false;
}

function isCalendarDate(digits: string): boolean {
  if (digits.length !== 8) {
    return false;
  }
  const year = Number(digits.slice(0, 4));
  const month = Number(digits.slice(4, 6));
  const day = Number(digits.slice(6, 8));
  if (year < 1900 || year > 2099 || month < 1 || month > 12) {
    return false;
  }
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function touchesTechnicalQuantity(
  text: string,
  start: number,
  end: number,
): boolean {
  const windowStart = Math.max(0, start - 16);
  const window = text.slice(windowStart, Math.min(text.length, end + 8));
  const relativeStart = start - windowStart;
  const relativeEnd = end - windowStart;
  for (const match of window.matchAll(/\d+\.\d{3}/g)) {
    const matchStart = match.index;
    const matchEnd = matchStart + match[0].length;
    if (relativeStart < matchEnd && relativeEnd > matchStart) {
      return true;
    }
  }
  return /^\s*(?:kW|kWh|kVA|MW|V|A|%)\b/.test(text.slice(end, end + 8));
}

function isPlainGap(text: string, left: WordToken, right: WordToken): boolean {
  return /^[ \t]+$/.test(text.slice(left.end, right.start));
}

function isHonorificGap(
  text: string,
  left: WordToken,
  right: WordToken,
): boolean {
  return /^[ \t]*\.?[ \t]+$/.test(text.slice(left.end, right.start));
}

function acceptsName(value: string, requireCapital: boolean): boolean {
  return isNameWord(value) && (!requireCapital || isCapitalized(value));
}

function isHonorific(value: string): boolean {
  return HONORIFICS.has(fold(value).replace(/\.+$/g, ''));
}

function isNameWord(value: string): boolean {
  const folded = fold(value);
  return (
    folded.length >= 2 && !STOP_WORDS.has(folded) && !PARTICLES.has(folded)
  );
}

function isCapitalized(value: string): boolean {
  const first = value[0];
  return (
    first !== undefined &&
    first === first.toLocaleUpperCase('es') &&
    first !== first.toLocaleLowerCase('es')
  );
}

function fold(value: string): string {
  return value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}
