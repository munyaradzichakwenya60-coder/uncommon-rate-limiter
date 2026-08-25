export interface KeyRecord {
  timestamps: number[];
  lastAccessed: number;
}

export interface RateLimiterStore {
  get(key: string): number[] | undefined;
  set(key: string, timestamps: number[], now: number): void;
  delete(key: string): boolean;
  has(key: string): boolean;
  cleanup(maxIdleMs: number, currentTime: number): number;
  size(): number;
  clear(): void;
}

export class InMemoryStore implements RateLimiterStore {
  private records = new Map<string, KeyRecord>();

  get(key: string): number[] | undefined {
    return this.records.get(key)?.timestamps;
  }

  set(key: string, timestamps: number[], now: number): void {
    this.records.set(key, {
      timestamps,
      lastAccessed: now,
    });
  }

  delete(key: string): boolean {
    return this.records.delete(key);
  }

  has(key: string): boolean {
    return this.records.has(key);
  }

  cleanup(maxIdleMs: number, currentTime: number): number {
    let purged = 0;
    for (const [key, record] of this.records.entries()) {
      if (currentTime - record.lastAccessed > maxIdleMs) {
        this.records.delete(key);
        purged++;
      }
    }
    return purged;
  }

  size(): number {
    return this.records.size;
  }

  clear(): void {
    this.records.clear();
  }
}
