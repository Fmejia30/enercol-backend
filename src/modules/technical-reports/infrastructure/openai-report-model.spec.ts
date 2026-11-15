import { describe, expect, it } from '@jest/globals';
import { ConfigService } from '@nestjs/config';
import type { ResponseCreateParams } from 'openai/resources/responses/responses';
import { TECHNICAL_REPORT_JSON_SCHEMA } from '../domain/report-schema.js';
import { ReportContentInvalidError } from '../domain/report-error.js';
import {
  OpenAiReportModel,
  type OpenAiResponsesClient,
} from './openai-report-model.js';
import {
  DEFAULT_OPENAI_MAX_OUTPUT_TOKENS,
  DEFAULT_OPENAI_MODEL,
  DEFAULT_OPENAI_REASONING_EFFORT,
  openAiSettings,
} from './openai-settings.js';

describe('OpenAI report model', () => {
  it('reads the model, reasoning effort, and output limit from configuration', () => {
    expect(openAiSettings(config({}))).toMatchObject({
      apiKey: null,
      model: DEFAULT_OPENAI_MODEL,
      reasoningEffort: DEFAULT_OPENAI_REASONING_EFFORT,
      maxOutputTokens: DEFAULT_OPENAI_MAX_OUTPUT_TOKENS,
    });
    expect(DEFAULT_OPENAI_MODEL).toBe('gpt-6-luna');
    expect(
      openAiSettings(
        config({
          openaiModel: 'gpt-6-luna-preview',
          openaiReasoningEffort: 'none',
          openaiMaxOutputTokens: 1200,
        }),
      ),
    ).toMatchObject({
      model: 'gpt-6-luna-preview',
      reasoningEffort: 'none',
      maxOutputTokens: 1200,
    });
  });

  it('sends a strict schema to the Responses API and records token usage', async () => {
    let body: ResponseCreateParams | undefined;
    const client: OpenAiResponsesClient = {
      async create(input) {
        body = input;
        return {
          status: 'completed',
          model: 'gpt-6-luna',
          output_text: '{"schemaVersion":1}',
          usage: { input_tokens: 11, output_tokens: 22 },
        };
      },
    };
    const model = new OpenAiReportModel(
      config({
        openaiApiKey: 'sk-test-key',
        openaiModel: 'gpt-6-luna-preview',
        openaiReasoningEffort: 'low',
        openaiMaxOutputTokens: 6000,
      }),
    );
    model.useClient(client);
    const result = await model.generate({ measuredValue: '267.250' });

    expect(body?.model).toBe('gpt-6-luna-preview');
    expect(body?.reasoning).toEqual({ effort: 'low' });
    expect(body?.max_output_tokens).toBe(6000);
    expect(body?.store).toBe(false);
    expect(body).not.toHaveProperty('tools');
    expect(body?.text?.format).toMatchObject({
      type: 'json_schema',
      name: 'technical_report_v1',
      strict: true,
      schema: TECHNICAL_REPORT_JSON_SCHEMA,
    });
    expect(result).toEqual({
      content: { schemaVersion: 1 },
      model: 'gpt-6-luna',
      reasoningEffort: 'low',
      inputTokens: 11,
      outputTokens: 22,
    });
  });

  it('fails closed without a key, and hides provider, timeout, refusal, and incomplete failures', async () => {
    const secret = 'sk-live-should-not-leak';
    await expect(
      new OpenAiReportModel(config({})).generate({ customerName: 'Textiles' }),
    ).rejects.toThrow(/^No fue posible generar el informe$/);

    const failing: OpenAiResponsesClient = {
      async create() {
        throw new Error(`timeout ${secret} Textiles del Altiplano`);
      },
    };
    const model = new OpenAiReportModel(config({ openaiApiKey: secret }));
    model.useClient(failing);
    await expect(
      model.generate({
        customerName: 'Textiles del Altiplano',
      }),
    ).rejects.toThrow(/^No fue posible generar el informe$/);

    await expect(
      modelReturning({
        status: 'failed',
        error: { message: secret },
        output_text: '',
      }),
    ).rejects.toThrow(/^No fue posible generar el informe$/);
    await expect(
      modelReturning({
        status: 'incomplete',
        incomplete_details: { reason: 'max_output_tokens' },
        output_text: '{"schemaVersion":1}',
      }),
    ).rejects.toBeInstanceOf(ReportContentInvalidError);
    await expect(
      modelReturning({
        status: 'completed',
        output_text: '',
        output: [{ type: 'message', content: [{ type: 'refusal', refusal: secret }] }],
      }),
    ).rejects.toBeInstanceOf(ReportContentInvalidError);
    await expect(
      modelReturning({ status: 'completed', output_text: 'not-json' }),
    ).rejects.toBeInstanceOf(ReportContentInvalidError);
  });
});

function modelReturning(response: Awaited<ReturnType<OpenAiResponsesClient['create']>>) {
  const client: OpenAiResponsesClient = {
    async create() {
      return response;
    },
  };
  const model = new OpenAiReportModel(config({ openaiApiKey: 'sk-test-key' }));
  model.useClient(client);
  return model.generate({});
}

function config(values: Record<string, unknown>): ConfigService {
  return { get: (key: string) => values[key] } as ConfigService;
}
