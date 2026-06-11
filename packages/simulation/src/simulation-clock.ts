/**
 * @agentos/simulation — Virtual Clock
 * Deterministic time progression for simulation.
 * Allows speeding up/slowing down/pausing simulation time.
 */

export class SimulationClock {
  private startTime: number;
  private elapsed: number = 0;
  private speedMultiplier: number;
  private paused: boolean = false;
  private lastTickTime: number;
  private eventCounter: number = 0;

  constructor(speedMultiplier: number = 1) {
    this.startTime = Date.now();
    this.speedMultiplier = speedMultiplier;
    this.lastTickTime = this.startTime;
  }

  /**
   * Advance the clock by a given number of real milliseconds.
   * The simulation time advances by realMs * speedMultiplier.
   */
  tick(realMs: number): number {
    if (this.paused) return this.elapsed;
    const simMs = realMs * this.speedMultiplier;
    this.elapsed += simMs;
    this.lastTickTime += realMs;
    return this.elapsed;
  }

  /**
   * Get the current simulation time as an ISO8601 string.
   */
  now(): string {
    return new Date(this.startTime + this.elapsed).toISOString();
  }

  /**
   * Get the simulation time in milliseconds since epoch.
   */
  nowMs(): number {
    return this.startTime + this.elapsed;
  }

  /**
   * Get elapsed simulation time in milliseconds.
   */
  getElapsed(): number {
    return this.elapsed;
  }

  /**
   * Set the clock speed multiplier.
   */
  setSpeed(multiplier: number): void {
    this.speedMultiplier = multiplier;
  }

  /**
   * Get the current speed multiplier.
   */
  getSpeed(): number {
    return this.speedMultiplier;
  }

  /**
   * Pause the clock.
   */
  pause(): void {
    this.paused = true;
  }

  /**
   * Resume the clock.
   */
  resume(): void {
    this.paused = false;
  }

  /**
   * Check if the clock is paused.
   */
  isPaused(): boolean {
    return this.paused;
  }

  /**
   * Generate a unique event ID for this simulation.
   */
  nextEventId(): number {
    return ++this.eventCounter;
  }

  /**
   * Reset the clock to the start.
   */
  reset(): void {
    this.elapsed = 0;
    this.eventCounter = 0;
    this.paused = false;
    this.startTime = Date.now();
    this.lastTickTime = this.startTime;
  }
}