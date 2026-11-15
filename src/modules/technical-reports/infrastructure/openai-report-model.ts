import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OpenAI } from 'openai';
import type { ResponseCreateParams } from 'openai/resources/responses/responses';
import type {
  ReportGenerationResult,
  ReportLanguageModel,
} from '../application/report-language-model.js';
import { TECHNICAL_REPORT_JSON_SCHEMA } from '../domain/report-schema.js';
import {
  ReportContentInvalidError,
  ReportProviderUnavailableError,
} from '../domain/report-error.js';
import { openAiSettings, type OpenAiSettings } from './openai-settings.js';

const OPENAI_TIMEOUT_MS = 75_000;

const INSTRUCTIONS = [
  'Redacta un borrador de informe técnico en español usando solo el JSON recibido.',
  'El análisis determinístico de ese JSON es la única fuente de mediciones, umbrales, diferencias, porcentajes, unidades, periodos y marcas de tiempo.',
  'Copia esos valores de forma literal en technicalFindings y en evidence. No los recalcules, no los redondees y no agregues evidencia.',
  'No inventes costos, tarifas, penalizaciones, ahorros, probabilidades, mediciones, límites contractuales ni porcentajes de confianza.',
  'financialImpact.status debe ser "unavailable". Explica que el conjunto no trae tarifas, costos ni penalizaciones.',
  'Las causas posibles van solo en hypotheses y deben leerse como hipótesis. No uses "causa confirmada" ni "causa verificada".',
  'Si historicalConsumption está vacío y evaluationConsumption es null, historicalAnalysis debe ser null. En cualquier otro caso, redacta el histórico solo con números presentes en el JSON.',
  'Si falta información, dilo de forma explícita.',
  'Conserva sin alterar cualquier token entre corchetes.',
  'schemaVersion debe ser 1 y draftStatus debe ser "DRAFT".',
  'No uses herramientas ni fuentes externas.',
].join(' ');

interface OpenAiResponse {
  status?: string;
  error?: unknown;
  incomplete_details?: unknown;
  output_text?: string;
  output?: ReadonlyArray<{
    type?: string;
    content?: ReadonlyArray<{ type?: string; refusal?: string }>;
  }>;
  usage?: { input_tokens?: number; output_tokens?: number } | null;
  model?: string;
}

export interface OpenAiResponsesClient {
  create(body: ResponseCreateParams): Promise<OpenAiResponse>;
}

@Injectable()
export class OpenAiReportModel implements ReportLanguageModel {
  private responses?: OpenAiResponsesClient;

  constructor(private readonly config: ConfigService) {}

  useClient(client: OpenAiResponsesClient): void {
    this.responses = client;
  }

  async generate(payload: unknown): Promise<ReportGenerationResult> {
    const settings = openAiSettings(this.config);
    let response: OpenAiResponse;
    try {
      response = await this.client(settings).create(requestBody(settings, payload));
    } catch {
      throw new ReportProviderUnavailableError();
    }
    return readResponse(response, settings);
  }

  private client(settings: OpenAiSettings): OpenAiResponsesClient {
    if (this.responses) {
      return this.responses;
    }
    if (!settings.apiKey) {
      throw new ReportProviderUnavailableError();
    }
    const sdk = new OpenAI({
      apiKey: settings.apiKey,
      timeout: OPENAI_TIMEOUT_MS,
      maxRetries: 0,
    });
    return {
      create: (body) =>
        sdk.responses.create(body) as Promise<OpenAiResponse>,
    };
  }
}

function requestBody(
  settings: OpenAiSettings,
  payload: unknown,
): ResponseCreateParams {
  return {
    model: settings.model,
    instructions: INSTRUCTIONS,
    input: JSON.stringify(payload),
    reasoning: { effort: settings.reasoningEffort },
    max_output_tokens: settings.maxOutputTokens,
    store: false,
    stream: false,
    text: {
      format: {
        type: 'json_schema',
        name: 'technical_report_v1',
        strict: true,
        schema: TECHNICAL_REPORT_JSON_SCHEMA,
      },
    },
  };
}

function readResponse(
  response: OpenAiResponse,
  settings: OpenAiSettings,
): ReportGenerationResult {
  if (response.error || response.status === 'failed') {
    throw new ReportProviderUnavailableError();
  }
  if (
    response.status === 'incomplete' ||
    response.incomplete_details ||
    response.status === 'cancelled' ||
    response.status === 'queued' ||
    response.status === 'in_progress' ||
    hasRefusal(response)
  ) {
    throw new ReportContentInvalidError();
  }
  if (response.status && response.status !== 'completed') {
    throw new ReportProviderUnavailableError();
  }
  const text = response.output_text?.trim() ?? '';
  let content: unknown;
  try {
    content = JSON.parse(text) as unknown;
  } catch {
    throw new ReportContentInvalidError();
  }
  return {
    content,
    model: reportedModel(response.model, settings.model),
    reasoningEffort: settings.reasoningEffort,
    inputTokens: tokenCount(response.usage?.input_tokens),
    outputTokens: tokenCount(response.usage?.output_tokens),
  };
}

function hasRefusal(response: OpenAiResponse): boolean {
  return (response.output ?? []).some(
    (item) =>
      item.type === 'refusal' ||
      (item.content ?? []).some(
        (part) =>
          part.type === 'refusal' ||
          (typeof part.refusal === 'string' && part.refusal.length > 0),
      ),
  );
}

function reportedModel(reported: string | undefined, configured: string): string {
  return reported && /^[A-Za-z0-9._-]{1,64}$/.test(reported)
    ? reported
    : configured;
}

function tokenCount(value: number | undefined): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
    ? value
    : null;
}
