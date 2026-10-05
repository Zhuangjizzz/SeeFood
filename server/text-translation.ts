import { ApiError, reject } from './contract.ts';
import type { JobHandler } from './jobs.ts';

// Fixed generation fixtures only. Persistence, acceptance and recovery are real.
const text: Record<string, string> = {
  en: 'Please do not add peanuts. Thank you.',
  ja: 'ピーナッツを入れないでください。ありがとうございます。',
  ko: '땅콩을 넣지 말아 주세요. 감사합니다.',
  es: 'Por favor, no añada cacahuetes. Gracias.',
  'zh-CN': '请不要放花生，谢谢。'
};

export function textTranslationHandler(scenario?: string): JobHandler {
  return {
    purpose: 'communication',
    prepare(request, snapshot) {
      for (const key of ['text', 'sourceLanguage', 'targetLanguage', 'inputVersion']) {
        if (request.input[key] !== snapshot.snapshot[key]) reject(409, 'DEPENDENCY_MISSING');
      }
      return [];
    },
    async generate({ request }) {
      if (scenario === 'failure' || scenario === 'text-failure') throw new ApiError(503, 'TEMPORARY_FAILURE', true);
      return { text: text[request.input.targetLanguage], contentLanguage: request.input.targetLanguage, inputVersion: request.input.inputVersion };
    },
    validateOutput(output, { request }) {
      if (output.contentLanguage !== request.input.targetLanguage || output.inputVersion !== request.input.inputVersion) reject(409, 'DEPENDENCY_MISSING');
    }
  };
}
