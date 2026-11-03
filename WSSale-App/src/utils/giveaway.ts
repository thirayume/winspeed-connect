/** Pieces on a giveaway line: a saved line keeps them in qtyBag (qtyTon 0); the bill editor keeps them in qtyTon. */
export function giveawayPieces(line: { qtyBag?: number | null; qtyTon?: number | null }) {
  return Number(line.qtyBag) || Number(line.qtyTon) || 0;
}
