interface Snapshot {
  value: number;
  timestamp: number;
}

export class PositionSnapshotService {
  private snapshots: Map<string, Snapshot[]> = new Map();

  async recordSnapshot(poolKey: string, snapshot: Snapshot) {
    const existing = this.snapshots.get(poolKey) || [];
    this.snapshots.set(poolKey, [...existing, snapshot]);
  }

  async getPeakValue(poolKey: string, since?: number): Promise<number> {
    const all = this.snapshots.get(poolKey) || [];
    const relevant = since ? all.filter(s => s.timestamp >= since) : all;
    return Math.max(...relevant.map(s => s.value), 0);
  }
} 