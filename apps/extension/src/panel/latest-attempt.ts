export function createLatestAttemptGate() {
  let generation = 0;
  return {
    begin: () => ++generation,
    invalidate: () => {
      generation += 1;
    },
    isLatest: (attempt: number) => attempt === generation
  };
}
