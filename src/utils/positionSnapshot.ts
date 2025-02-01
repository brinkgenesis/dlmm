interface Snapshot {
  timestamp: number;
  value: number;
}

export class PositionSnapshotService {
  private snapshots: Map<string, Snapshot[]> = new Map();

  public async recordSnapshot(poolAddress: string, value: number) {
    const now = Date.now();
    const poolSnapshots = this.snapshots.get(poolAddress) || [];
    
    // Keep only last 7 days of snapshots (672 = 4*24*7)
    const filtered = poolSnapshots
      .filter(s => now - s.timestamp < 604800000)
      .slice(-672);
    
    this.snapshots.set(poolAddress, [
      ...filtered,
      { timestamp: now, value }
    ]);
  }

  public async getPeakValue(poolAddress: string): Promise<number> {
    const snapshots = this.snapshots.get(poolAddress) || [];
    return Math.max(...snapshots.map(s => s.value), 0);
  }
} 