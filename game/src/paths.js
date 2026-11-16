// Where the game's model files live. On its own (this repo) they're served at
// /models; inside Soma the game sits under /game and so do its files.
export const MODELS = typeof location !== 'undefined' && location.pathname.startsWith('/game') ? '/game/models' : '/models';
