'use strict';
function isCurrentComplete(item) {
  // The member badge is statusText; strategy authority is in the rendered hero.
  const hero = String((item.candidateTexts || [])[0] || '');
  return /display TODAY_(?:ZERO_RESULT_)?COMPLETE\b/.test(hero) && !/preserve previous good|today-authority blocked|PREVIOUS_GOOD_DEGRADED/i.test(hero);
}
module.exports = { isCurrentComplete };
