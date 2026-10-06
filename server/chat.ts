import { ApiError, reject, validate } from './contract.ts';
import type { JobHandler } from './jobs.ts';
import { createRequire } from 'node:module';
import { chatContent, twoPortions } from './chat-content.ts';
import { assessDietaryCard } from './dietary-review.ts';
const { getChatCopy } = createRequire(import.meta.url)('../miniprogram/core/chat-copy.js');

/** The generated prose is fixed for local integration; record identities remain real. */
export function chatHandler(scenario = 'complete', partialDelayMs = 350): JobHandler {
  return {
    purpose: 'record',
    prepare(request, snapshot, asset) {
      const { userMessageId, assistantMessageId } = request.target;
      const { cards, images, messages } = snapshot.snapshot;
      const imageIds = new Set(images.map((image: any) => image.imageId));
      const cardIds = new Set(cards.map((card: any) => card.id));
      if (request.input.dishCardId && !cardIds.has(request.input.dishCardId)) reject(409, 'DEPENDENCY_MISSING');
      if (userMessageId === assistantMessageId || messages.some((message: any) => [userMessageId, assistantMessageId].includes(message.id)) ||
          cardIds.size !== cards.length || cards.some((card: any) => card.recordId !== snapshot.recordId || card.sourceImageIds.some((id: string) => !imageIds.has(id))) ||
          new Set(messages.map((message: any) => message.id)).size !== messages.length || messages.some((message: any, index: number) =>
            (message.role === 'user' && message.inReplyTo !== null) || (message.role === 'assistant' && !messages.slice(0, index).some((prior: any) => prior.id === message.inReplyTo && prior.role === 'user')) ||
            message.attachments.some((attachment: any) => attachment.type === 'dish_reference' && !cardIds.has(attachment.cardId)))) reject(409, 'DEPENDENCY_MISSING');
      return images.filter((image: any) => image.assetId !== null).map((image: any) => asset(image.assetId, image.imageId, image.kind));
    },
    async generate({ request, snapshot, job, publishPartial }) {
      if (scenario === 'chat-failure') throw new ApiError(503, 'TEMPORARY_FAILURE', true);
      const language = request.input.targetLanguage; const text = chatContent[language];
      const kind = request.input.dishCardId ? 'communicate' : getChatCopy(language).questions.find((question: any) => question.text === request.input.text)?.id || 'explain';
      const preferences = snapshot.snapshot.preferences;
      const card = request.input.dishCardId ? snapshot.snapshot.cards.find((value: any) => value.id === request.input.dishCardId) :
        kind === 'recommend' ? snapshot.snapshot.cards.find((value: any) => assessDietaryCard(value, preferences, scenario).concern !== 'conflict') : snapshot.snapshot.cards[0];
      if (!card && kind === 'recommend' && snapshot.snapshot.cards.length) return { text: text.noRecommendations, contentLanguage: language, complete: true, attachments: [] };
      if (!card) return { text: text.empty, contentLanguage: language, complete: true, attachments: [] };
      const dish = card.nameZh || card.localizedName || text.uncertain;
      const attachments: any[] = [{ type: 'dish_reference', cardId: card.id }];
      let body = `${dish}\n${text[kind]}`;
      if (kind === 'recommend') {
        if (!preferences.allergies.length && !preferences.restrictions.length && !preferences.tastes.length && !preferences.notes) body += `\n${text.unpersonalized}`;
        body += `\n${assessDietaryCard({ ...card, contentLanguage: language }, preferences, scenario).warnings.join('\n')}`;
      }
      if (kind === 'price') body += card.price.amount !== null && card.price.currency ?
        `\n2 × ${card.price.currency} ${card.price.amount} = ${card.price.currency} ${twoPortions(card.price.amount)}` : `\n${text.unknownPrice}`;
      if (kind === 'communicate') attachments.push({ type: 'communication_card', card: {
        title: text.title.replace('{dish}', dish), category: 'service', textZh: chatContent['zh-CN'].question.replace('{dish}', dish),
        pairedLanguage: language, pairedText: language === 'zh-CN' ? null : text.question.replace('{dish}', dish) } });
      if (scenario === 'chat-partial-failure' && job.attempt === 1) {
        publishPartial({ text: body.slice(0, Math.max(dish.length + 1, Math.floor(body.length / 2))), contentLanguage: language, complete: false, attachments: [] });
        await new Promise((resolve) => setTimeout(resolve, Math.max(10, partialDelayMs)));
        throw new ApiError(503, 'TEMPORARY_FAILURE', true);
      }
      return { text: body, contentLanguage: language, complete: true, attachments };
    },
    validateOutput(output, frozen, phase = 'complete') {
      validate('ChatOutput', output);
      const isRecommendation = !frozen.request.input.dishCardId && getChatCopy(frozen.request.input.targetLanguage).questions
        .some((question: any) => question.id === 'recommend' && question.text === frozen.request.input.text);
      if (output.complete !== (phase === 'complete') || output.contentLanguage !== frozen.request.input.targetLanguage || output.attachments.some((attachment: any) =>
        attachment.type === 'dish_reference' && (!frozen.snapshot.snapshot.cards.some((card: any) => card.id === attachment.cardId && card.recordId === frozen.snapshot.recordId) ||
          frozen.request.input.dishCardId && attachment.cardId !== frozen.request.input.dishCardId))) reject(409, 'DEPENDENCY_MISSING');
      if (isRecommendation && output.attachments.some((attachment: any) => attachment.type === 'dish_reference' &&
          assessDietaryCard(frozen.snapshot.snapshot.cards.find((card: any) => card.id === attachment.cardId), frozen.snapshot.snapshot.preferences, scenario).concern === 'conflict')) reject(409, 'DEPENDENCY_MISSING');
    }
  };
}
