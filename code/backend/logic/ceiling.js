// The hidden group ceiling. Everything here is SERVER-ONLY:
// never send the ceiling, or anything derived from these fields, to a client.
//
// ceiling = lowest + min(10% of (highest - lowest), 10% of lowest)
//
// Stretch consent: anyone whose budget is below that ceiling must agree to go
// slightly above their number. If they haven't answered yet (null) or said no
// (false), the ceiling drops to their budget.

/**
 * @param {Array<{userId: string, groupBudgetBase: number, acceptsStretch: boolean|null}>} members
 *        groupBudgetBase is the member's group budget converted to the base currency, minor units.
 * @returns {{
 *   ceiling: number,          // what feasibility uses
 *   stretchCeiling: number,   // the ceiling if everyone below it agreed
 *   pendingConsent: string[], // members below the stretch ceiling who haven't answered
 *   limitingUserIds: string[] // members whose budget is the ceiling (for private prompts only)
 * }}
 */
function computeCeiling(members) {
  if (!members.length) throw new Error('No members');
  const budgets = members.map((m) => m.groupBudgetBase);
  const lowest = Math.min(...budgets);
  const highest = Math.max(...budgets);
  const stretch = Math.min(Math.floor(0.1 * (highest - lowest)), Math.floor(0.1 * lowest));
  const stretchCeiling = lowest + stretch;

  const below = members.filter((m) => m.groupBudgetBase < stretchCeiling);
  let ceiling = stretchCeiling;
  for (const m of below) {
    if (m.acceptsStretch !== true) ceiling = Math.min(ceiling, m.groupBudgetBase);
  }

  return {
    ceiling,
    stretchCeiling,
    pendingConsent: below.filter((m) => m.acceptsStretch == null).map((m) => m.userId),
    limitingUserIds: members.filter((m) => m.groupBudgetBase <= ceiling).map((m) => m.userId),
  };
}

module.exports = { computeCeiling };
