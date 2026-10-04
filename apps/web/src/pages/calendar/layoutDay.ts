export interface Span {
  startMin: number;
  endMin: number;
}

export type Placed<T> = T & { lane: number; lanes: number };

/** "08:30" -> 510 (minutes since midnight). Wall-clock arithmetic only: no timezone is involved. */
export const minutesOf = (time: string): number => {
  const [h, m] = time.split(':').map(Number) as [number, number];
  return h * 60 + m;
};

/**
 * Side-by-side layout for the blocks of ONE day. Blocks that overlap (even through a chain of other
 * blocks) form a cluster and share its width in columns ("lanes"); a block that only touches another
 * (10:00 / 10:00) is not an overlap and keeps the full width.
 */
export function layoutDay<T extends Span>(items: T[]): Placed<T>[] {
  const sorted = [...items].sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin);
  const placed: Placed<T>[] = [];

  let cluster: Placed<T>[] = [];
  let clusterEnd = -1;
  const laneEnds: number[] = [];

  const closeCluster = () => {
    for (const p of cluster) p.lanes = laneEnds.length;
    placed.push(...cluster);
    cluster = [];
    laneEnds.length = 0;
  };

  for (const item of sorted) {
    if (cluster.length > 0 && item.startMin >= clusterEnd) closeCluster();

    let lane = laneEnds.findIndex((end) => end <= item.startMin);
    if (lane === -1) lane = laneEnds.length;
    laneEnds[lane] = item.endMin;

    cluster.push({ ...item, lane, lanes: 1 });
    clusterEnd = Math.max(clusterEnd, item.endMin);
  }
  closeCluster();
  return placed;
}
