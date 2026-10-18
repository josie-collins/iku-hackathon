// Expense splitting, balances, settle-up and private pacing.
// Pure functions on integer minor units: no network, no database.

/**
 * Split an amount evenly. The leftover minor units (from integer division) go
 * one each to the first people listed, so the shares always add up exactly.
 * @returns {Array<{userId: string, shareMinor: number}>}
 */
function splitEvenly(totalMinor, userIds) {
  if (!userIds.length) throw new Error('Nobody to split between');
  const base = Math.floor(totalMinor / userIds.length);
  const remainder = totalMinor - base * userIds.length;
  return userIds.map((userId, i) => ({ userId, shareMinor: base + (i < remainder ? 1 : 0) }));
}

/**
 * Split an amount in proportion to weights (e.g. each person's receipt items).
 * Leftover minor units go to the largest remainders, then to the first listed,
 * so the shares always add up exactly. People with weight 0 are left out.
 * @param {Array<{userId: string, weight: number}>} weights
 * @returns {Array<{userId: string, shareMinor: number}>}
 */
function splitByWeights(totalMinor, weights) {
  const people = weights.filter((w) => w.weight > 0);
  const sum = people.reduce((s, w) => s + w.weight, 0);
  if (!sum) throw new Error('Nobody to split between');
  const exact = people.map((w, i) => ({ i, userId: w.userId, raw: (totalMinor * w.weight) / sum }));
  const shares = exact.map((e) => ({ userId: e.userId, shareMinor: Math.floor(e.raw) }));
  let leftover = totalMinor - shares.reduce((s, x) => s + x.shareMinor, 0);
  const order = [...exact].sort((a, b) => (b.raw % 1) - (a.raw % 1) || a.i - b.i);
  for (const e of order) {
    if (!leftover) break;
    shares[e.i].shareMinor += 1;
    leftover -= 1;
  }
  return shares;
}

/**
 * Receipt items -> each person's weight. An item shared by several people is
 * split evenly between them.
 * @param {Array<{amountMinor: number, userIds: string[]}>} items
 * @param {string[]} order  everyone's ids, so the result keeps a stable order
 * @returns {Array<{userId: string, weight: number}>}
 */
function weightsFromItems(items, order) {
  const totals = Object.fromEntries(order.map((id) => [id, 0]));
  for (const item of items) {
    for (const s of splitEvenly(item.amountMinor, item.userIds)) totals[s.userId] += s.shareMinor;
  }
  return order.map((userId) => ({ userId, weight: totals[userId] }));
}

/**
 * What each person is owed (positive) or owes (negative), in the base currency.
 * @param {string[]} userIds  everyone in the trip, so people with no expenses show 0
 * @param {Array<{payerId: string, amountBaseMinor: number, participants: Array<{userId: string, shareBaseMinor: number}>}>} expenses
 * @returns {Object<string, number>}
 */
function computeBalances(userIds, expenses) {
  const balances = Object.fromEntries(userIds.map((id) => [id, 0]));
  for (const e of expenses) {
    balances[e.payerId] = (balances[e.payerId] || 0) + e.amountBaseMinor;
    for (const p of e.participants) {
      balances[p.userId] = (balances[p.userId] || 0) - p.shareBaseMinor;
    }
  }
  return balances;
}

/**
 * Who pays whom. Repeatedly matches the biggest debtor with the biggest
 * creditor, which needs at most (people - 1) payments.
 * @returns {Array<{from: string, to: string, amountMinor: number}>}
 */
function settleUp(balances) {
  const byAmount = (a, b) => b.amount - a.amount || (a.id < b.id ? -1 : 1);
  const creditors = Object.entries(balances).filter(([, v]) => v > 0).map(([id, amount]) => ({ id, amount }));
  const debtors = Object.entries(balances).filter(([, v]) => v < 0).map(([id, v]) => ({ id, amount: -v }));

  const transfers = [];
  while (creditors.length && debtors.length) {
    creditors.sort(byAmount);
    debtors.sort(byAmount);
    const to = creditors[0];
    const from = debtors[0];
    const amount = Math.min(to.amount, from.amount);
    transfers.push({ from: from.id, to: to.id, amountMinor: amount });
    to.amount -= amount;
    from.amount -= amount;
    if (!to.amount) creditors.shift();
    if (!from.amount) debtors.shift();
  }
  return transfers;
}

/**
 * Does this expense count against someone's private daily budget?
 * The private budget covers food, optional extras and personal spending.
 * Shared stays, transport and core activities come out of the group budget.
 */
function countsTowardsPace(expense) {
  return expense.type !== 'shared' || ['food', 'extras'].includes(expense.category);
}

/**
 * Private pacing for ONE member. Only ever send this to that member.
 * @param {object} p
 * @param {number} p.dailyBudgetMinor  their private daily budget
 * @param {number} p.spentMinor        their share of pace-counted expenses, same currency
 * @param {number} p.days              days of the trip so far (including today)
 * @returns {{ days: number, allowanceMinor: number, spentMinor: number, underMinor: number }}
 *          underMinor > 0 means under pace, < 0 means over
 */
function pace({ dailyBudgetMinor, spentMinor, days }) {
  const allowanceMinor = dailyBudgetMinor * days;
  return { days, allowanceMinor, spentMinor, underMinor: allowanceMinor - spentMinor };
}

module.exports = { splitEvenly, splitByWeights, weightsFromItems, computeBalances, settleUp, countsTowardsPace, pace };
