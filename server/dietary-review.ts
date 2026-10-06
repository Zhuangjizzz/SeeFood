import { ApiError, canonical, reject, validate } from './contract.ts';
import type { JobHandler } from './jobs.ts';
const COPY: Record<string, any> = {
  en: { egg: 'The fixed example is egg fried rice and conflicts with the saved egg allergy or vegan restriction.', possible: 'The example may contain ingredients that conflict with your preferences. Confirm every ingredient and shared equipment with staff.', unknown: 'The available information cannot confirm suitability for your saved preferences.', caution: 'No detected allergen is not a safety guarantee. Ask staff about ingredients and cross-contact.', religious: 'A name or photo cannot verify halal or kosher certification, ingredients or preparation. Confirm these with staff.' },
  ja: { egg: '固定例は卵炒飯で、保存した卵アレルギーまたは完全菜食の制限に抵触します。', possible: '希望に合わない食材が含まれる可能性があります。全食材と共用器具について店員に確認してください。', unknown: '現時点の情報では、保存した食事条件に合うか確認できません。', caution: 'アレルゲンの検出がなくても安全とは限りません。食材と交差接触を店員に確認してください。', religious: '料理名や写真ではハラール・コーシャ認証、食材、調理条件は確認できません。店員に確認してください。' },
  ko: { egg: '고정 예시는 계란 볶음밥으로, 저장한 계란 알레르기 또는 비건 제한과 충돌합니다.', possible: '식사 조건에 맞지 않는 재료가 포함될 수 있어요. 모든 재료와 공용 조리 도구를 직원에게 확인하세요.', unknown: '현재 정보로는 저장한 식사 조건에 맞는지 확인할 수 없어요.', caution: '알레르기 유발 물질을 찾지 못해도 안전을 보장하지 않아요. 재료와 교차 접촉을 직원에게 확인하세요.', religious: '이름이나 사진만으로 할랄·코셔 인증, 재료, 조리 조건을 확인할 수 없어요. 직원에게 확인하세요.' },
  es: { egg: 'El ejemplo fijo es arroz frito con huevo y entra en conflicto con la alergia al huevo o la restricción vegana guardada.', possible: 'El ejemplo puede contener ingredientes incompatibles con tus preferencias. Confirma todos los ingredientes y el equipo compartido con el personal.', unknown: 'La información disponible no permite confirmar si cumple tus preferencias guardadas.', caution: 'No detectar alérgenos no garantiza seguridad. Confirma ingredientes y contacto cruzado con el personal.', religious: 'El nombre o la foto no verifica certificación halal o kosher, ingredientes ni preparación. Consúltalo con el personal.' },
  'zh-CN': { egg: '固定样例为蛋炒饭，与已保存的蛋过敏或纯素限制明确冲突。', possible: '样例可能含有不符合偏好的食材，请向店员核实全部配料与共用器具。', unknown: '现有信息不足以确认是否符合已保存的饮食偏好。', caution: '未识别到过敏原不等于可以放心食用，请向店员核实配料与交叉接触情况。', religious: '菜名或照片不能证明清真或犹太洁食认证、配料与制作条件，请向店员核实。' }
};
/** Fixed generation only; classification is restricted to the documented egg-rice example. */
export function assessDietaryCard(card: any, preferences: any, scenario = '') {
  const copy = COPY[card.contentLanguage] || COPY.en;
  const conflict = (scenario === 'dietary-conflict' || card.nameZh === '蛋炒饭') && (preferences.allergies.includes('egg') || preferences.restrictions.includes('vegan'));
  const possible = preferences.allergies.length || preferences.restrictions.length || preferences.tastes.length || preferences.notes;
  const concern = conflict ? 'conflict' : possible ? 'possible_conflict' : 'unknown';
  const warnings = [copy[conflict ? 'egg' : possible ? 'possible' : 'unknown'], copy.caution];
  if (preferences.restrictions.some((value: string) => ['halal', 'kosher'].includes(value))) warnings.push(copy.religious);
  return { concern, warnings };
}
export function dietaryReviewHandler(scenario = ''): JobHandler {
  return {
    purpose: 'record',
    prepare(request, snapshot) {
      const ids = request.target.cardIds; const cards = request.input.cards;
      if (request.target.preferencesVersion !== request.input.preferences.version || canonical(request.input.preferences) !== canonical(snapshot.snapshot.preferences) ||
          new Set(cards.map((card: any) => card.id)).size !== cards.length || ids.length !== cards.length || cards.some((card: any) =>
            !ids.includes(card.id) || card.recordId !== snapshot.recordId || canonical(card) !== canonical(snapshot.snapshot.cards.find((item: any) => item.id === card.id)))) reject(409, 'DEPENDENCY_MISSING');
      return [];
    },
    async generate({ request }) {
      if (scenario === 'dietary-failure') throw new ApiError(503, 'TEMPORARY_FAILURE', true);
      return { assessments: request.input.cards.map((card: any) => ({ cardId: card.id, preferencesVersion: request.input.preferences.version,
        state: 'current', ...assessDietaryCard(card, request.input.preferences, scenario), checkedAt: new Date().toISOString() })) };
    },
    validateOutput(output, frozen) {
      validate('DietaryReviewOutput', output);
      const ids = frozen.request.target.cardIds;
      if (output.assessments.length !== ids.length || new Set(output.assessments.map((item: any) => item.cardId)).size !== ids.length ||
          output.assessments.some((item: any) => !ids.includes(item.cardId) || item.preferencesVersion !== frozen.request.target.preferencesVersion)) reject(409, 'DEPENDENCY_MISSING');
    }
  };
}
