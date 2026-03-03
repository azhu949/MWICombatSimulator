import { beforeEach, describe, expect, it, vi } from "vitest";
import { WorkerClient } from "../workerClient.js";

class FakeWorker {
    static instances = [];

    constructor(url, options) {
        this.url = url;
        this.options = options;
        this.postMessage = vi.fn();
        this.terminate = vi.fn();
        this.onmessage = null;
        this.onerror = null;
        FakeWorker.instances.push(this);
    }

    emit(data) {
        this.onmessage?.({ data });
    }
}

describe("workerClient", () => {
    beforeEach(() => {
        FakeWorker.instances = [];
        global.Worker = FakeWorker;
    });

    it("routes single simulation messages", () => {
        const client = new WorkerClient();
        const onProgress = vi.fn();
        const onResult = vi.fn();

        client.startSimulation(
            {
                type: "start_simulation",
                workerId: "w1",
                players: [],
                zone: { zoneHrid: "/actions/combat/fly", difficultyTier: 0 },
                labyrinth: null,
                simulationTimeLimit: 100,
                extra: { mooPass: false, comExp: 0, comDrop: 0, enableHpMpVisualization: true },
            },
            { onProgress, onResult }
        );

        expect(FakeWorker.instances).toHaveLength(1);
        expect(FakeWorker.instances[0].postMessage).toHaveBeenCalledTimes(1);

        FakeWorker.instances[0].emit({ type: "simulation_progress", progress: 0.5 });
        FakeWorker.instances[0].emit({ type: "simulation_result", simResult: { encounters: 1 } });

        expect(onProgress).toHaveBeenCalled();
        expect(onResult).toHaveBeenCalledWith({ encounters: 1 });
    });

    it("routes multi simulation messages", () => {
        const client = new WorkerClient();
        const onBatchResult = vi.fn();

        client.startMultiSimulation(
            {
                type: "start_simulation_all_zones",
                players: [],
                zones: [{ zoneHrid: "/actions/combat/fly", difficultyTier: 0 }],
                simulationTimeLimit: 100,
                extra: { mooPass: false, comExp: 0, comDrop: 0, enableHpMpVisualization: false },
            },
            { onBatchResult }
        );

        expect(FakeWorker.instances).toHaveLength(1);

        FakeWorker.instances[0].emit({ type: "simulation_result_allZones", simResults: [{ encounters: 2 }] });

        expect(onBatchResult).toHaveBeenCalledWith([{ encounters: 2 }], "simulation_result_allZones");
    });
});
