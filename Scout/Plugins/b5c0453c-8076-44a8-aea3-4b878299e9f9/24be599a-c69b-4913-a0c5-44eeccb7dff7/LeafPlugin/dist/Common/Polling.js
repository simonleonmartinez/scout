/**
 * Timer-based polling helpers. Pending setTimeout handles are rooted in an
 * instance-level set because the plugin runtime garbage-collects timers that
 * nothing references, silently dropping the callback.
 */
class Poller {
    constructor() {
        this.pendingTimers = new Set();
    }
    /**
     * Resolve after `delayMs`, with the timer rooted against garbage collection.
     */
    sleep(delayMs) {
        return new Promise((resolve) => this.scheduleRooted(resolve, delayMs));
    }
    /**
     * Poll `probe` every `intervalMs` until its value satisfies `isDone` or
     * `timeoutMs` elapses, resolving with the last probed value either way.
     *
     * The probe MUST be synchronous: in the plugin runtime an `await` inside the
     * tick has been observed to never resume, silently stopping the poll after one
     * tick. A throwing probe counts as "not done" so a transient failure keeps the
     * poll alive; if the final probe before the timeout threw, the promise rejects.
     *
     * @param probe - Synchronous function producing the value to test.
     * @param isDone - Returns true when `probe`'s value is acceptable.
     * @param intervalMs - Delay between probes.
     * @param timeoutMs - Stop polling once this much time has elapsed.
     * @returns The last probed value, or rejects with the final probe's error.
     */
    pollUntil(probe, isDone, intervalMs, timeoutMs) {
        return new Promise((resolve, reject) => {
            let elapsedMs = 0;
            const tick = () => {
                let result;
                try {
                    result = { ok: true, value: probe() };
                }
                catch (error) {
                    result = { ok: false, error: error !== null && error !== void 0 ? error : new Error("pollUntil probe failed, unknown error") };
                }
                const done = result.ok && isDone(result.value);
                if (done || elapsedMs >= timeoutMs) {
                    if (result.ok) {
                        resolve(result.value);
                    }
                    else {
                        reject(result.error);
                    }
                    return;
                }
                elapsedMs += intervalMs;
                this.scheduleRooted(tick, intervalMs);
            };
            tick();
        });
    }
    /**
     * Run `tick` every `intervalMs`, starting one interval from now.
     * @returns A function that stops the loop.
     */
    repeatEvery(tick, intervalMs) {
        let timer = undefined;
        let stopped = false;
        const schedule = () => {
            if (stopped)
                return;
            timer = setTimeout(() => {
                timer = undefined;
                tick();
                schedule();
            }, intervalMs);
        };
        schedule();
        return () => {
            stopped = true;
            if (timer) {
                clearTimeout(timer);
                timer = undefined;
            }
        };
    }
    scheduleRooted(callback, delayMs) {
        const timer = setTimeout(() => {
            this.pendingTimers.delete(timer);
            callback();
        }, delayMs);
        this.pendingTimers.add(timer);
    }
}
/** Shared polling helpers; the single instance owns the rooted-timer set. */
export const poller = new Poller();
