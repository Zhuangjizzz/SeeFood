const page = require('./page');
function presentAssessment(assessment, copy) {
  return assessment ? { ...assessment, stateLabel: copy[assessment.state], concernLabel: assessment.state === 'current' ? copy[assessment.concern] : '' } : null;
}
function getDietary(id, cardId) {
  const state = page.services().dietaryReview.getState(id);
  return { ...state, assessment: presentAssessment(state.assessments[cardId], state.copy),
    assessments: Object.fromEntries(Object.entries(state.assessments).map(([key, value]) => [key, presentAssessment(value, state.copy)])),
    offline: !page.services().network.getState().online };
}
function refresh(id) {
  const services = page.services(); const state = services.dietaryReview.getState(id);
  if (state.canStart && services.preferences.getState().isSet) return services.dietaryReview.startRecord(id);
  return services.dietaryReview.refreshRecord(id);
}
function act(id, action) { return page.services().dietaryReview[action](id); }
module.exports = { getDietary, refresh, act };
