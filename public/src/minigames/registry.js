// Mini-game registry. Each entry lazy-imports its module so the client only
// fetches a game's code when launched. Add new games here (see new-minigame skill).
export const MINIGAMES = {
  chess: () => import("./chess/index.js"),
};

export async function loadMinigame(id) {
  const importer = MINIGAMES[id];
  if (!importer) throw new Error(`unknown mini-game: ${id}`);
  return importer();
}
