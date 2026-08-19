// @vitest-environment jsdom

import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { defineComponent, isReadonly, watch } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import { createMemoryHistory, createRouter } from "vue-router";
import { initI18n } from "../i18n/i18n.js";
import HomeImportExportModal from "../components/home/HomeImportExportModal.vue";
import HomePage from "../pages/HomePage.vue";
import { useHomePlayerSnapshots } from "../composables/useHomePlayerSnapshots.js";
import { useHomeTriggerEditor } from "../composables/useHomeTriggerEditor.js";
import { useSimulatorStore } from "../../stores/simulatorStore.js";

let controller;
let snapshots;
let homePageTriggerController;

const Harness = defineComponent({
    setup() {
        controller = useHomeTriggerEditor();
        snapshots = useHomePlayerSnapshots(controller.blockPlayerConfigReplacement);
        return () => null;
    },
});

const HomeLoadoutPanelsStub = defineComponent({
    props: {
        triggerController: { type: Object, required: true },
    },
    setup(props) {
        homePageTriggerController = props.triggerController;
        return () => null;
    },
});

const RouterViewHost = defineComponent({
    template: "<router-view />",
});

beforeAll(async () => {
    localStorage.setItem("i18nextLng", "en");
    await initI18n();
});

beforeEach(() => {
    localStorage.clear();
    setActivePinia(createPinia());
    controller = null;
    snapshots = null;
    homePageTriggerController = null;
});

function mountHarness() {
    return mount(Harness);
}

function markDirty(target = controller, index = 0) {
    const simulator = useSimulatorStore();
    const foodHrid = String(simulator.options.food[0]?.hrid || "");
    if (!foodHrid) {
        throw new Error("A food option is required to create a trigger draft.");
    }
    simulator.activePlayer.food[index] = foodHrid;
    target.request("food", index);
    target.updateDraft([{ type: "always" }]);
    target.updateDirty("food", index, true);
}

function mountModal(blockPlayerConfigReplacement) {
    return mount(HomeImportExportModal, {
        props: { open: true, blockPlayerConfigReplacement },
        global: {
            stubs: {
                BaseModal: { props: ["open"], template: '<div v-if="open"><slot /></div>' },
                Select: { template: "<div><slot /></div>" },
                SelectContent: { template: "<div><slot /></div>" },
                SelectItem: { template: "<div><slot /></div>" },
                SelectTrigger: true,
            },
        },
    });
}

async function mountHomePage() {
    const router = createRouter({
        history: createMemoryHistory(),
        routes: [{ path: "/home", name: "home", component: HomePage }],
    });
    await router.push("/home");
    await router.isReady();
    return mount(RouterViewHost, {
        global: {
            plugins: [router],
            stubs: {
                HomeWorkspaceTabs: true,
                HomeSummaryPanel: true,
                HomeLevelsPanel: true,
                HomeSimulationPanel: true,
                HomeEquipmentPanel: true,
                HomeLoadoutPanels: HomeLoadoutPanelsStub,
                HomeCombatAttributesPanel: true,
                HomeHouseRoomsModal: true,
                HomeGuildBuffsModal: true,
                HomeCombatScrollsModal: true,
                HomeAchievementsModal: true,
                HomeImportExportModal: true,
                HomeExperimentalModal: true,
                HomePlayerSnapshotModal: true,
            },
        },
    });
}

function dispatchTampermonkeyImport(requestId, importTarget = "player") {
    window.dispatchEvent(
        new MessageEvent("message", {
            source: window,
            origin: window.location.origin,
            data: {
                channel: "mwi-tm-bridge",
                type: "mwi-tm-import",
                importTarget,
                requestId,
                payload: { imported: true },
            },
        }),
    );
}

describe("Home trigger replacement guard", () => {
    it("restores the previous player when a dirty draft attempts to switch players", async () => {
        const wrapper = mountHarness();
        const simulator = useSimulatorStore();
        const previousPlayerId = simulator.activePlayerId;
        const nextPlayerId = simulator.players.find((player) => String(player.id) !== String(previousPlayerId)).id;
        markDirty();

        simulator.setActivePlayer(nextPlayerId);
        await flushPromises();

        expect(String(simulator.activePlayerId)).toBe(String(previousPlayerId));
        expect(controller.isActive("food", 0)).toBe(true);
        expect(controller.canLeave()).toBe(false);
        expect(controller.blockedMessage.value).toContain("Save or cancel");
        wrapper.unmount();
    });

    it("keeps blocking on rapid consecutive switches while the draft is dirty", async () => {
        const wrapper = mountHarness();
        const simulator = useSimulatorStore();
        const firstPlayerId = simulator.activePlayerId;
        const otherPlayerIds = simulator.players
            .filter((player) => String(player.id) !== String(firstPlayerId))
            .map((player) => player.id);
        markDirty();

        // 同一同步栈内连续两次切换（批处理路径）：最终仍回滚到原 player 且草稿保留。
        simulator.setActivePlayer(otherPlayerIds[0]);
        simulator.setActivePlayer(otherPlayerIds[1]);
        await flushPromises();
        expect(String(simulator.activePlayerId)).toBe(String(firstPlayerId));
        expect(controller.isActive("food", 0)).toBe(true);
        expect(controller.canLeave()).toBe(false);
        expect(controller.blockedMessage.value).toContain("Save or cancel");

        // 回显完成后再次切换（用户快速连点路径）：守卫依旧生效。
        simulator.setActivePlayer(otherPlayerIds[0]);
        await flushPromises();
        expect(String(simulator.activePlayerId)).toBe(String(firstPlayerId));
        expect(controller.isActive("food", 0)).toBe(true);
        expect(controller.canLeave()).toBe(false);
        expect(controller.blockedMessage.value).toContain("Save or cancel");
        wrapper.unmount();
    });

    it("restores the draft owner when another process changes the rollback transition", async () => {
        const wrapper = mountHarness();
        const simulator = useSimulatorStore();
        const draftPlayerId = String(simulator.activePlayerId);
        const otherPlayerIds = simulator.players
            .map((player) => String(player.id))
            .filter((playerId) => playerId !== draftPlayerId);
        const attemptedPlayerId = otherPlayerIds[0];
        const interferingPlayerId = otherPlayerIds[1];
        markDirty();

        let shouldInterfere = true;
        const stopInterferingProcess = watch(
            () => simulator.activePlayerId,
            (nextPlayerId, previousPlayerId) => {
                if (
                    shouldInterfere &&
                    String(nextPlayerId) === draftPlayerId &&
                    String(previousPlayerId) === attemptedPlayerId
                ) {
                    shouldInterfere = false;
                    simulator.setActivePlayer(interferingPlayerId);
                }
            },
            { flush: "sync" },
        );

        simulator.setActivePlayer(attemptedPlayerId);
        await flushPromises();

        expect(String(simulator.activePlayerId)).toBe(draftPlayerId);
        expect(controller.isActive("food", 0)).toBe(true);
        expect(controller.canLeave()).toBe(false);
        stopInterferingProcess();
        wrapper.unmount();
    });

    it("blocks navigation until the current draft is saved or cancelled", () => {
        const wrapper = mountHarness();
        markDirty();

        expect(controller.canLeave()).toBe(false);
        controller.cancel();
        expect(controller.canLeave()).toBe(true);
        wrapper.unmount();
    });

    it("ignores draft updates when no trigger editor is active", () => {
        const wrapper = mountHarness();

        controller.updateDraft([{ type: "always" }]);

        expect(controller).not.toHaveProperty("state");
        expect(controller.activeDraft.value).toEqual([]);
        expect(isReadonly(controller.activeDraft.value)).toBe(true);
        expect(controller.canLeave()).toBe(true);
        wrapper.unmount();
    });

    it("cancels by resetting the complete editor state", () => {
        const wrapper = mountHarness();
        markDirty(controller, 1);
        controller.blockPlayerConfigReplacement();

        expect(controller.isActive("food", 1)).toBe(true);
        expect(controller.activeDraft.value).toEqual([{ type: "always" }]);
        expect(controller.blockedMessage.value).toContain("Save or cancel");

        controller.cancel();

        expect(controller.isActive("food", 1)).toBe(false);
        expect(controller.activeDraft.value).toEqual([]);
        expect(controller.blockedMessage.value).toBe("");
        expect(controller.canLeave()).toBe(true);
        wrapper.unmount();
    });

    it("does not call snapshot restore while a trigger draft is dirty", () => {
        const wrapper = mountHarness();
        const simulator = useSimulatorStore();
        const loadSnapshot = vi.spyOn(simulator, "loadPlayerDataSnapshot");
        markDirty();

        snapshots.load();

        expect(loadSnapshot).not.toHaveBeenCalled();
        expect(snapshots.status.value.tone).toBe("warning");
        expect(controller.blockedMessage.value).toContain("Save or cancel");
        wrapper.unmount();
    });

    it("restores a snapshot when no trigger draft blocks replacement", () => {
        const wrapper = mountHarness();
        const simulator = useSimulatorStore();
        const loadSnapshot = vi.spyOn(simulator, "loadPlayerDataSnapshot").mockReturnValue({
            ok: true,
            savedAt: 0,
            messageKey: "common:settingsPage.playerLoadSuccess",
        });

        snapshots.load();

        expect(loadSnapshot).toHaveBeenCalledOnce();
        expect(snapshots.status.value.tone).toBe("success");
        expect(snapshots.statusText.value).toContain("Player configs restored");
        wrapper.unmount();
    });

    it("shows a readable fallback when the snapshot store returns an unknown message key", () => {
        const wrapper = mountHarness();
        const simulator = useSimulatorStore();
        vi.spyOn(simulator, "savePlayerDataSnapshot").mockReturnValue({
            ok: false,
            messageKey: "common:settingsPage.missingSnapshotMessage",
        });

        snapshots.save();

        expect(snapshots.statusText.value).toBe("Player config operation failed.");
        expect(snapshots.statusText.value).not.toContain("missingSnapshotMessage");
        wrapper.unmount();
    });

    const importCases = [
        {
            kind: "group",
            buttonLabel: "Import Group",
            textareaIndex: 0,
            importMethod: "importGroupConfig",
            successText: "Group import success",
        },
        {
            kind: "solo",
            buttonLabel: "Import To Player",
            textareaIndex: 1,
            importMethod: "importSoloConfig",
            successText: "Solo import success",
        },
    ];

    it.each(importCases)(
        "blocks $kind import when the guard reports a dirty draft",
        async ({ buttonLabel, importMethod }) => {
            const blockPlayerConfigReplacement = vi.fn(() => true);
            const wrapper = mountModal(blockPlayerConfigReplacement);
            const simulator = useSimulatorStore();
            const importSpy = vi.spyOn(simulator, importMethod);
            const importButton = wrapper.findAll("button").find((button) => button.text() === buttonLabel);

            await importButton.trigger("click");

            expect(blockPlayerConfigReplacement).toHaveBeenCalledOnce();
            expect(importSpy).not.toHaveBeenCalled();
            expect(wrapper.text()).toContain("Save or cancel");
            wrapper.unmount();
        },
    );

    it.each(importCases)(
        "runs $kind import when the guard passes",
        async ({ buttonLabel, textareaIndex, importMethod, successText }) => {
            const payload = '{"payload":true}';
            const blockPlayerConfigReplacement = vi.fn(() => false);
            const wrapper = mountModal(blockPlayerConfigReplacement);
            const simulator = useSimulatorStore();
            const importSpy = vi.spyOn(simulator, importMethod).mockReturnValue({ detectedFormat: "modern" });

            await wrapper.findAll("textarea")[textareaIndex].setValue(payload);
            await wrapper
                .findAll("button")
                .find((button) => button.text() === buttonLabel)
                .trigger("click");

            expect(blockPlayerConfigReplacement).toHaveBeenCalledOnce();
            expect(importSpy).toHaveBeenCalledOnce();
            if (importMethod === "importSoloConfig") {
                expect(importSpy).toHaveBeenCalledWith(payload, String(simulator.activePlayerId));
            } else {
                expect(importSpy).toHaveBeenCalledWith(payload);
            }
            expect(wrapper.text()).toContain(successText);
            wrapper.unmount();
        },
    );

    const exportCases = [
        {
            kind: "group",
            buttonLabel: "Export Group",
            textareaIndex: 0,
            exportMethod: "exportGroupConfig",
            exportedText: '{"kind":"group"}',
        },
        {
            kind: "solo",
            buttonLabel: "Export Solo",
            textareaIndex: 1,
            exportMethod: "exportSoloConfig",
            exportedText: '{"kind":"solo"}',
        },
    ];

    it.each(exportCases)(
        "writes the $kind export into its textarea and shows success",
        async ({ buttonLabel, textareaIndex, exportMethod, exportedText }) => {
            const wrapper = mountModal(vi.fn(() => false));
            const simulator = useSimulatorStore();
            const exportSpy = vi.spyOn(simulator, exportMethod).mockReturnValue(exportedText);

            await wrapper
                .findAll("button")
                .find((button) => button.text() === buttonLabel)
                .trigger("click");

            if (exportMethod === "exportSoloConfig") {
                expect(exportSpy).toHaveBeenCalledWith(String(simulator.activePlayerId));
            } else {
                expect(exportSpy).toHaveBeenCalledOnce();
            }
            expect(wrapper.findAll("textarea")[textareaIndex].element.value).toBe(exportedText);
            expect(wrapper.text()).toMatch(/exported in modern format/i);
            wrapper.unmount();
        },
    );

    it("blocks a Tampermonkey import while a trigger draft is dirty", async () => {
        const wrapper = await mountHomePage();
        const simulator = useSimulatorStore();
        const importSpy = vi.spyOn(simulator, "importSoloConfig");
        const postMessageSpy = vi.spyOn(window, "postMessage").mockImplementation(() => {});
        markDirty(homePageTriggerController);

        dispatchTampermonkeyImport("dirty-request");
        await flushPromises();

        expect(importSpy).not.toHaveBeenCalled();
        expect(postMessageSpy).toHaveBeenCalledWith(
            expect.objectContaining({
                requestId: "dirty-request",
                ok: false,
                message: expect.stringContaining("Save or cancel"),
            }),
            window.location.origin,
        );
        postMessageSpy.mockRestore();
        wrapper.unmount();
    });

    it("runs a Tampermonkey import when no trigger draft blocks replacement", async () => {
        const wrapper = await mountHomePage();
        const simulator = useSimulatorStore();
        const importSpy = vi.spyOn(simulator, "importSoloConfig").mockReturnValue({ detectedFormat: "main-site" });
        const postMessageSpy = vi.spyOn(window, "postMessage").mockImplementation(() => {});

        dispatchTampermonkeyImport("clean-request");
        await flushPromises();

        expect(importSpy).toHaveBeenCalledWith(JSON.stringify({ imported: true }), String(simulator.activePlayerId));
        expect(postMessageSpy).toHaveBeenCalledWith(
            expect.objectContaining({
                requestId: "clean-request",
                ok: true,
                detectedFormat: "main-site",
            }),
            window.location.origin,
        );
        postMessageSpy.mockRestore();
        wrapper.unmount();
    });

    it("ignores Tampermonkey imports targeted at another page", async () => {
        const wrapper = await mountHomePage();
        const simulator = useSimulatorStore();
        const importSpy = vi.spyOn(simulator, "importSoloConfig");
        const postMessageSpy = vi.spyOn(window, "postMessage").mockImplementation(() => {});

        dispatchTampermonkeyImport("enhancement-request", "enhancement");
        await flushPromises();

        expect(importSpy).not.toHaveBeenCalled();
        expect(postMessageSpy).not.toHaveBeenCalled();
        postMessageSpy.mockRestore();
        wrapper.unmount();
    });

    it("shows failure status when group import throws", async () => {
        const wrapper = mountModal(vi.fn(() => false));
        const simulator = useSimulatorStore();
        vi.spyOn(simulator, "importGroupConfig").mockImplementation(() => {
            throw new Error("boom");
        });

        await wrapper.findAll("textarea")[0].setValue("{}");
        await wrapper
            .findAll("button")
            .find((button) => button.text() === "Import Group")
            .trigger("click");

        expect(wrapper.text()).toContain("Group import failed");
        wrapper.unmount();
    });
});
