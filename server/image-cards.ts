import { readFileSync } from 'node:fs';
import { ApiError, reject, validate } from './contract.ts';
import type { JobHandler } from './jobs.ts';
import { content } from './image-card-content.ts';
const fixtures = JSON.parse(readFileSync(new URL('../docs/technical/mocks/fixtures.json', import.meta.url), 'utf8'));
/** Only generation is simulated. Fixtures never supply a job, owner or resource identity. */
export function imageCardsHandler(scenario = 'menu'): JobHandler {
  return {
    purpose: 'record',
    prepare(request, snapshot, asset) {
      const image = snapshot.snapshot.images.find((item: any) => item.imageId === request.target.imageId);
      if (!image || !image.assetId || image.assetId !== request.input.assetId || image.kind !== request.input.inputKind) reject(409, 'DEPENDENCY_MISSING');
      return [asset(image.assetId, image.imageId, image.kind)];
    },
    async generate({ request, snapshot, job }) {
      if (scenario === 'failure') throw new ApiError(503, 'TEMPORARY_FAILURE', true);
      const selected = ['unknown-price', 'no-cards'].includes(scenario) ? scenario : 'image-cards-ready';
      const template = fixtures.cases.find((item: any) => item.id === selected).response.body.output;
      const text = content[request.input.targetLanguage];
      const dish = request.input.inputKind === 'dish';
      return { cards: template.cards.map((card: any, index: number) => ({ ...card, id: `${job.jobId}:card:${index + 1}`,
        recordId: snapshot.recordId, sourceImageIds: [request.target.imageId], contentLanguage: request.input.targetLanguage,
        nameZh: dish ? null : card.nameZh, localizedName: dish ? null : scenario === 'unknown-price' ? text.marketName : text.name,
        price: dish ? { rawText: null, amount: null, currency: null, unit: null, variant: null } : card.price,
        summary: dish ? text.dishSummary : scenario === 'unknown-price' ? text.uncertainty[0] : text.summary, details: dish || scenario === 'unknown-price' ? text.dishDetails : text.details, uncertainty: text.uncertainty })) };

    },
    validateOutput(output, frozen) {
      validate('ImageCardsOutput', output);
      const sourceIds = new Set(frozen.snapshot.snapshot.images.filter((image: any) => image.assetId).map((image: any) => image.imageId));
      if (new Set(output.cards.map((card: any) => card.id)).size !== output.cards.length || output.cards.some((card: any) =>
        card.recordId !== frozen.snapshot.recordId || !card.sourceImageIds.includes(frozen.request.target.imageId) ||
        card.sourceImageIds.some((id: string) => !sourceIds.has(id)))) reject(409, 'DEPENDENCY_MISSING');
    }
  };
}
