/**
 * Coalesces reset bursts until no event arrives for `windowMs` milliseconds.
 * Continuous resets keep the window open and suppress manual resets too.
 */
export class ResetSuppression {
    /** @param windowMs - How long after {@link arm} (or a suppressed event) events stay suppressed. */
    constructor(windowMs) {
        this.windowMs = windowMs;
        this.suppressUntil = 0;
    }
    /** Start or extend suppression to `windowMs` milliseconds after `now`. */
    arm(now) {
        this.suppressUntil = now + this.windowMs;
    }
    /**
     * Return true for a reset already covered by the window, then extend it.
     * An uncovered event returns false to request one manual-reset recreation.
     */
    checkAndExtend(now) {
        const suppressed = now < this.suppressUntil;
        this.arm(now);
        return suppressed;
    }
}
