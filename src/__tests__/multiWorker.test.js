import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleMultiSimulationMessage } from "../multiWorker.js";

class FakeChildWorker {
    static instances = [];
    static behaviors = [];

    constructor(url, options) {
        this.url = url;
        this.options = options;
        this.onmessage = null;
        this.onerror = null;
        this.behavior = FakeChildWorker.behaviors.shift() || (() => {});
        this.postMessage = vi.fn((payload) => {
            this.behavior(this, payload);
        });
        this.terminate = vi.fn();
        FakeChildWorker.instances.push(this);
    }

    emit(data) {
        this.onmessage?.({ data });
    }

    fail(error) {
        this.onerror?.(error);
    }
}

describe("multiWorker", () => {
    let originalWorker;
    let originalNavigatorDescriptor;

    beforeEach(() => {
        FakeChildWorker.instances = [];
        FakeChildWorker.behaviors = [];
        originalWorker = globalThis.Worker;
        originalNavigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");

        globalThis.Worker = FakeChildWorker;
        Object.defineProperty(globalThis, "navigator", {
            configurable: true,
            value: { hardwareConcurrency: 2 },
        });
    });

    afterEach(() => {
        if (typeof originalWorker === "undefined") {
            delete globalThis.Worker;
        } else {
            globalThis.Worker = originalWorker;
        }

        if (originalNavigatorDescriptor) {
            Object.defineProperty(globalThis, "navigator", originalNavigatorDescriptor);
        } else {
            delete globalThis.navigator;
        }

        vi.restoreAllMocks();
    });

    it("terminates sibling child workers when one multi-run task fails", async () => {
        FakeChildWorker.behaviors = [
            (worker) => {
                setTimeout(() => {
                    worker.emit({ type: "simulation_error", error: "forced failure" });
                }, 0);
            },
            () => {},
        ];

        const workerScope = {
            postMessage: vi.fn(),
            close: vi.fn(),
        };

        await handleMultiSimulationMessage(
            {
                type: "start_simulation_all_zones",
                players: [],
                zones: [
                    { zoneHrid: "/actions/combat/fly", difficultyTier: 0 },
                    { zoneHrid: "/actions/combat/slime", difficultyTier: 0 },
                ],
                simulationTimeLimit: 100,
                extra: { mooPass: false, comExp: 0, comDrop: 0, enableHpMpVisualization: false },
            },
            workerScope
        );

        expect(FakeChildWorker.instances).toHaveLength(2);
        expect(FakeChildWorker.instances[0].terminate).toHaveBeenCalled();
        expect(FakeChildWorker.instances[1].terminate).toHaveBeenCalled();
        expect(workerScope.postMessage).toHaveBeenCalledWith({
            type: "simulation_error",
            error: "forced failure",
        });
        expect(workerScope.close).toHaveBeenCalledTimes(1);
    });
});
