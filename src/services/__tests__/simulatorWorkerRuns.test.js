import { afterEach, describe, expect, it, vi } from "vitest";
import {
    DEDICATED_WORKER_SCOPE_ADVISOR,
    DEDICATED_WORKER_SCOPE_QUEUE,
    cancelDedicatedWorkerRuns,
    cancelSharedWorkerRun,
    createWorkerRunCancellationError,
    isWorkerRunCancelledError,
    runMultiSimulationPayloadWithDedicatedWorker,
    runSharedSingleSimulationPayload,
    runSingleSimulationPayloadWithDedicatedWorker,
    stopAdvisorWorkerRuns,
    stopQueueWorkerClients,
} from "../simulatorWorkerRuns.js";

class FakeWorkerClient {
    static instances = [];

    constructor() {
        this.handlers = {};
        this.stopSimulation = vi.fn();
        FakeWorkerClient.instances.push(this);
    }

    startSimulation(payload, handlers = {}) {
        this.payload = payload;
        this.handlers = handlers;
    }

    startMultiSimulation(payload, handlers = {}) {
        this.payload = payload;
        this.handlers = handlers;
    }

    emit(type, ...args) {
        this.handlers[type]?.(...args);
    }
}

afterEach(() => {
    FakeWorkerClient.instances = [];
    cancelDedicatedWorkerRuns();
    cancelSharedWorkerRun();
});

describe("simulatorWorkerRuns", () => {
    it("resolves dedicated single runs and stops the client exactly once", async () => {
        const promise = runSingleSimulationPayloadWithDedicatedWorker(
            { type: "start_simulation" },
            vi.fn(),
            {
                scope: DEDICATED_WORKER_SCOPE_QUEUE,
                WorkerClientCtor: FakeWorkerClient,
            }
        );
        const client = FakeWorkerClient.instances[0];

        client.emit("onProgress", { progress: 0.5 });
        client.emit("onResult", { encounters: 3 });
        client.emit("onResult", { encounters: 4 });

        await expect(promise).resolves.toEqual({ encounters: 3 });
        expect(client.stopSimulation).toHaveBeenCalledTimes(1);
    });

    it("returns normalized multi-run results while preserving item callbacks", async () => {
        const onItemResult = vi.fn();
        const promise = runMultiSimulationPayloadWithDedicatedWorker(
            { type: "start_simulation_all_zones" },
            vi.fn(),
            {
                scope: DEDICATED_WORKER_SCOPE_ADVISOR,
                onItemResult,
                WorkerClientCtor: FakeWorkerClient,
            }
        );
        const client = FakeWorkerClient.instances[0];
        const item = { index: 1, simResult: { encounters: 5 } };

        client.emit("onItemResult", item);
        client.emit("onBatchResult", [{ encounters: 5 }], "simulation_result_allZones");

        await expect(promise).resolves.toEqual({
            simResults: [{ encounters: 5 }],
            batchResultType: "simulation_result_allZones",
        });
        expect(onItemResult).toHaveBeenCalledWith(item);
        expect(client.stopSimulation).toHaveBeenCalledTimes(1);
    });

    it("cancels only dedicated runs matching the requested scope", async () => {
        const queuePromise = runSingleSimulationPayloadWithDedicatedWorker(
            { type: "queue" },
            vi.fn(),
            {
                scope: DEDICATED_WORKER_SCOPE_QUEUE,
                WorkerClientCtor: FakeWorkerClient,
            }
        );
        const advisorPromise = runSingleSimulationPayloadWithDedicatedWorker(
            { type: "advisor" },
            vi.fn(),
            {
                scope: DEDICATED_WORKER_SCOPE_ADVISOR,
                WorkerClientCtor: FakeWorkerClient,
            }
        );

        stopQueueWorkerClients();

        await expect(queuePromise).rejects.toMatchObject({
            code: "cancelled",
        });
        expect(isWorkerRunCancelledError(createWorkerRunCancellationError())).toBe(true);

        const advisorClient = FakeWorkerClient.instances[1];
        advisorClient.emit("onResult", { encounters: 2 });
        await expect(advisorPromise).resolves.toEqual({ encounters: 2 });
    });

    it("cancels advisor runs and shared runs with the existing cancellation code", async () => {
        const advisorPromise = runSingleSimulationPayloadWithDedicatedWorker(
            { type: "advisor" },
            vi.fn(),
            {
                scope: DEDICATED_WORKER_SCOPE_ADVISOR,
                WorkerClientCtor: FakeWorkerClient,
            }
        );
        stopAdvisorWorkerRuns();
        await expect(advisorPromise).rejects.toMatchObject({
            code: "cancelled",
        });

        const sharedClient = new FakeWorkerClient();
        const sharedPromise = runSharedSingleSimulationPayload(
            { type: "shared" },
            vi.fn(),
            { workerClient: sharedClient }
        );
        cancelSharedWorkerRun();

        await expect(sharedPromise).rejects.toMatchObject({
            code: "cancelled",
        });
        expect(sharedClient.stopSimulation).toHaveBeenCalledTimes(1);
    });

    it("rejects and cleans up when a progress callback throws", async () => {
        const progressError = new Error("progress failed");
        const promise = runSingleSimulationPayloadWithDedicatedWorker(
            {},
            () => {
                throw progressError;
            },
            {
                WorkerClientCtor: FakeWorkerClient,
            }
        );
        const client = FakeWorkerClient.instances[0];
        client.emit("onProgress", { progress: 0.25 });

        await expect(promise).rejects.toBe(progressError);
        expect(client.stopSimulation).toHaveBeenCalledTimes(1);
    });
});
