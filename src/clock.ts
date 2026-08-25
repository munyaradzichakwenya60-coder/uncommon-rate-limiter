export interface Clock {
  now(): number;
}

export class SystemClock implements Clock {
  now(): number {
    return Date.now();
  }
}

export class MockClock implements Clock {
  private currentTime: number;

  constructor(initialTime: number = 0) {
    this.currentTime = initialTime;
  }

  now(): number {
    return this.currentTime;
  }

  advance(ms: number): void {
    if (ms < 0) {
      throw new Error('Cannot advance clock backwards');
    }
    this.currentTime += ms;
  }

  advanceSeconds(seconds: number): void {
    this.advance(seconds * 1000);
  }

  setTime(timestamp: number): void {
    this.currentTime = timestamp;
  }
}
