// One refresh at a time per connector: a rotated refresh token makes a second
// concurrent refresh present a token the server has already burned.
const tails = new Map<string, Promise<unknown>>();

export async function withConnectorLock<T>(connectorId: string, fn: () => Promise<T>): Promise<T> {
  const previous = tails.get(connectorId) ?? Promise.resolve();
  const run = previous.catch(() => undefined).then(fn);
  tails.set(connectorId, run);
  try {
    return await run;
  } finally {
    if (tails.get(connectorId) === run) tails.delete(connectorId);
  }
}
