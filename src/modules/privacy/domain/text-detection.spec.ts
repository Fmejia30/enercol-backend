import { describe, expect, it } from '@jest/globals';
import { findProtectedSpans } from './text-detection.js';

const DEMAND_FINDING =
  'La demanda máxima medida es 267.250 kW y el umbral contractual es 250.000 kW. La diferencia es 17.250 kW (6.900 %).';
const CONSUMPTION_FINDING =
  'El consumo del periodo es 124800.000 kWh. El promedio de los meses históricos anteriores es 99583.583 kWh. La diferencia es 25216.417 kWh (25.322 %). El consumo del periodo es mayor que ese promedio. Es una observación numérica y no confirma una anomalía técnica.';

describe('protected text detection', () => {
  it('detects each supported category in free text', () => {
    const text = [
      'Ana María López',
      'señor juan pérez',
      'Textiles del Altiplano S.A.S.',
      'ada@example.com',
      '+57 301 555 0199',
      '301 555 0199',
      'Calle 26 # 92-32',
      'DPI 1234 56789 0101',
      'NIT personal 800.111.222-3',
      'NIT 900.123.456-7',
      'CLI-A05-001',
      'contrato número CTR-2026-014',
      'Planta no es el nombre',
      'MED-FTB-014',
      'PV-A05-001',
      'PV-000001',
      'referencia externa SAP-7781',
      '11111111-1111-4111-8111-111111111111',
    ].join('. ');

    const categories = new Set(
      findProtectedSpans(text).map((span) => span.category),
    );

    expect(categories).toEqual(
      new Set([
        'person',
        'customer',
        'email',
        'phone',
        'address',
        'personal-id',
        'personal-nit',
        'tax-id',
        'customer-account',
        'contract',
        'meter',
        'ticket',
        'external-reference',
      ]),
    );
    expect(
      findProtectedSpans(text).some((span) => span.value === 'Planta'),
    ).toBe(false);
  });

  it('leaves technical measurements, units, and timestamps unchanged', () => {
    const technical = [
      DEMAND_FINDING,
      CONSUMPTION_FINDING,
      '267.250',
      '250.000',
      '17.250',
      '6.900',
      '124800.000',
      '99583.583',
      'kW',
      'kWh',
      '2026-09-03T15:30:00.000Z',
      '2026-09-01',
      'Lectura de demanda',
      'Conjunto técnico controlado Act-05',
      'local-controlled-dataset',
      'confirmed-observation',
      'requires-interpretation',
      'DEMAND_EXCEEDANCE',
    ];

    for (const value of technical) {
      expect(findProtectedSpans(value)).toEqual([]);
    }
  });

  it('does not treat a single capitalized word as a person', () => {
    expect(findProtectedSpans('Septiembre quedó dentro del periodo.')).toEqual(
      [],
    );
  });

  it('detects Guatemalan and other international phone numbers exactly', () => {
    const samples = [
      '5555 1234',
      '4210-8891',
      '22223333',
      '+502 5555 1234',
      '+50255551234',
      '+502 2222-3333',
      '+57 301 555 0199',
      '+44 20 7946 0958',
    ];

    for (const sample of samples) {
      const phones = findProtectedSpans(`Contacto ${sample}.`).filter(
        (span) => span.category === 'phone',
      );
      expect(phones.map((span) => span.value)).toEqual([sample]);
    }
  });

  it('rejects invalid phone numbers and keeps technical numbers unchanged', () => {
    const unchanged = [
      '5555123',
      '555512345',
      '12345678',
      '05551234',
      '+502 555 1234',
      '+502 55551 23456',
      '20260903',
      '2026-09-03',
      '2026-09-03T15:30:00.000Z',
      '267.250',
      '250.000',
      '17.250',
      '6.900 %',
      '124800.000 kWh',
      '99583.583',
      DEMAND_FINDING,
      CONSUMPTION_FINDING,
    ];

    for (const value of unchanged) {
      expect(
        findProtectedSpans(value).map((span) => span.category),
      ).not.toContain('phone');
    }
  });
});
