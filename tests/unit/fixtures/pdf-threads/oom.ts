// Simulates a PDF that makes the parser allocate without bound.
const hoard: number[][] = [];
for (;;) hoard.push(new Array<number>(1_000_000).fill(Math.random()));
