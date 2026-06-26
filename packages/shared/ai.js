// ═══ KRPS Shared: Bot AI (pure functions) ═══
import { R, P, S, CARDS, CTR, has, cnt, cnts, score, losses, first, estimateHuman } from "./cards.js";

export const STRATEGIES = [
  { id: "random",    name: "Random",    desc: "Completely unpredictable. Every card has equal chance." },
  { id: "counter",   name: "Counter",   desc: "Calculates best expected outcome against your estimated hand." },
  { id: "adaptive",  name: "Adaptive",  desc: "Learns your patterns from history, then predicts and counters." },
];

const BY_ID = Object.freeze(Object.fromEntries(STRATEGIES.map(s => [s.id, s])));

export const getStrategy = (id) => BY_ID[id] || BY_ID.random;

/** Predict human's next card from history */
export const predict = (handBits, history) => {
  const w = [0, 0, 0];
  for (let i = 0; i < history.length; i++) {
    const h = history[i];
    if (h.type !== "round" || !has(handBits, h.cards.A)) continue;
    w[h.cards.A] += i + 1;
  }
  for (let i = history.length - 1; i >= 0; i--) {
    const h = history[i];
    if (h.type === "round" && has(handBits, h.cards.A)) { w[h.cards.A] += 2; break; }
  }
  for (const c of CARDS) if (has(handBits, c)) w[c]++;
  return CARDS.reduce((best, c) => has(handBits, c) && w[c] > (best < 0 ? -Infinity : w[best]) ? c : best, -1);
};

/** Pick best card from hand using scoring function. Always returns a valid card. */
const bestOf = (handBits, fn) => {
  const res = CARDS.reduce((best, c) => (has(handBits, c) && (best < 0 || fn(c) > fn(best) || (fn(c) === fn(best) && c < best))) ? c : best, -1);
  return res >= 0 ? res : first(handBits);
};

/** Random card from hand. Always returns a valid card. */
const rndCard = (handBits) => {
  const t = cnt(handBits);
  if (!t) return first(handBits);
  let r = (Math.random() * t) | 0;
  for (const c of CARDS) if (has(handBits, c)) { if (r-- === 0) return c; }
  return first(handBits); // fallback (should not reach here)
};

/**
 * Pick a bot card using human-like estimation (not perfect knowledge).
 * @param {number} handBits - bot's hand
 * @param {number} poolBits - pool (both players can see this)
 * @param {Array} history - round history
 * @param {string} strategy - strategy ID
 * @param {number} roundCount - current round
 * @param {number} lossStreak - bot's consecutive losses
 */
export const botPick = (handBits, poolBits, history, strategy) => {
  // Dynamic import to avoid circular dependency
  const estimated = estimateHuman(history, handBits, poolBits);
  switch (strategy) {
    case "counter":
      return bestOf(handBits, c => score(c, estimated));
    case "adaptive": {
      const pr = predict(estimated, history);
      return (pr >= 0 && has(handBits, CTR[pr])) ? CTR[pr] : bestOf(handBits, c => score(c, estimated));
    }
    default: // random
      return rndCard(handBits);
  }
};

/** Pick card for bot tie-exchange (always the smallest) */
export const botExchangePick = (handBits) => first(handBits);
