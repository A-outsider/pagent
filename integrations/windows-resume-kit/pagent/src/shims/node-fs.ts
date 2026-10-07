const unavailable = (): never => {
  throw new Error('node:fs is unavailable in the browser extension runtime');
};

export const promises = {
  readFile: unavailable,
  open: unavailable,
  rename: unavailable,
  unlink: async () => undefined,
};

export default { promises };
