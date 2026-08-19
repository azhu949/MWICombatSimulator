// @vitest-environment jsdom

import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { defineComponent } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import { createMemoryHistory, createRouter } from "vue-router";
import HomePage from "../pages/HomePage.vue";
import { initI18n } from "../i18n/i18n.js";
import { useSimulatorStore } from "../../stores/simulatorStore.js";
import { houseRoomDetailIndex } from "../../shared/gameDataIndex.js";

const passthroughStub = defineComponent({
    template: "<div><slot /></div>",
});

const baseModalStub = defineComponent({
    props: {
        open: { type: Boolean, default: false },
        title: { type: String, default: "" },
    },
    template: '<div v-if="open"><h2>{{ title }}</h2><slot /></div>',
});

const routerViewHost = defineComponent({
    template: "<router-view />",
});

function createTestRouter() {
    return createRouter({
        history: createMemoryHistory(),
        routes: [{ path: "/home", name: "home", component: HomePage }],
    });
}

function mountHomePage(router) {
    return mount(routerViewHost, {
        global: {
            plugins: [router],
            stubs: {
                BaseModal: baseModalStub,
                DisclosurePanel: passthroughStub,
                HomeSummaryPanel: passthroughStub,
                HomeWorkspaceTabs: passthroughStub,
                InlineTriggerEditor: passthroughStub,
                SearchCombobox: passthroughStub,
                Select: passthroughStub,
                SelectContent: passthroughStub,
                SelectItem: passthroughStub,
                SelectTrigger: passthroughStub,
                Table: passthroughStub,
                TableBody: passthroughStub,
                TableCell: passthroughStub,
                TableHead: passthroughStub,
                TableHeader: passthroughStub,
                TableRow: passthroughStub,
            },
        },
    });
}

function findUpgradeableRoom() {
    return (
        Object.values(houseRoomDetailIndex).find((room) => {
            const costs = room?.upgradeCostsMap?.["1"];
            return Array.isArray(costs) && costs.length > 0;
        }) ?? null
    );
}

function findRoomInput(wrapper, room) {
    const roomLabel = wrapper.findAll("label").find((label) => label.text().includes(room.name));
    expect(roomLabel).toBeTruthy();
    return roomLabel.find('input[type="number"]');
}

async function openHouseRoomsModal(wrapper) {
    const button = wrapper.findAll("button").find((candidate) => /House Rooms/.test(candidate.text()));
    expect(button).toBeTruthy();
    await button.trigger("click");
    await flushPromises();
}

describe("HomePage house room upgrade baseline", () => {
    let router;
    let simulator;

    beforeAll(async () => {
        localStorage.setItem("i18nextLng", "en");
        await initI18n();
    });

    beforeEach(async () => {
        localStorage.clear();
        setActivePinia(createPinia());
        simulator = useSimulatorStore();
        router = createTestRouter();
        await router.push("/home");
        await router.isReady();
    });

    afterEach(() => {
        document.body.innerHTML = "";
        localStorage.clear();
    });

    it("does not normalize sparse advanced state when closed modals mount", async () => {
        const room = findUpgradeableRoom();
        expect(room).toBeTruthy();
        simulator.activePlayer.houseRooms = { [room.hrid]: 2 };
        simulator.activePlayer.guildBuffs = {};
        simulator.activePlayer.achievements = {};
        const beforeMount = JSON.parse(
            JSON.stringify({
                houseRooms: simulator.activePlayer.houseRooms,
                guildBuffs: simulator.activePlayer.guildBuffs,
                achievements: simulator.activePlayer.achievements,
            }),
        );

        const wrapper = mountHomePage(router);
        await flushPromises();

        expect({
            houseRooms: simulator.activePlayer.houseRooms,
            guildBuffs: simulator.activePlayer.guildBuffs,
            achievements: simulator.activePlayer.achievements,
        }).toEqual(beforeMount);
        wrapper.unmount();
    });

    it("keeps the first player's upgrade summary when switching players while the modal is open", async () => {
        const room = findUpgradeableRoom();
        expect(room).toBeTruthy();
        const playerA = simulator.players[0];
        const playerB = simulator.players.find((player) => String(player.id) !== String(playerA.id));
        expect(playerB).toBeTruthy();
        playerA.houseRooms[room.hrid] = 3;

        const wrapper = mountHomePage(router);
        await flushPromises();
        await openHouseRoomsModal(wrapper);

        // 玩家 A：基线 Lv3，升到 Lv5 → 摘要显示 Lv 3 → Lv 5
        await findRoomInput(wrapper, room).setValue("5");
        expect(simulator.activePlayer.houseRooms[room.hrid]).toBe(5);
        expect(wrapper.text()).toMatch(/Lv 3 → Lv 5/);

        // 切到玩家 B：摘要立即回到 B 的无变化状态，不再显示 A 的升级
        simulator.setActivePlayer(playerB.id);
        await flushPromises();
        expect(wrapper.text()).not.toMatch(/Lv 3 → Lv 5/);
        expect(wrapper.text()).toMatch(/No room upgrades selected yet|尚未选择/);

        // 切回玩家 A：基线保留，Lv 3 → Lv 5 摘要恢复
        simulator.setActivePlayer(playerA.id);
        await flushPromises();
        expect(simulator.activePlayer.id).toBe(playerA.id);
        expect(simulator.activePlayer.houseRooms[room.hrid]).toBe(5);
        expect(wrapper.text()).toMatch(/Lv 3 → Lv 5/);
        wrapper.unmount();
    });

    it("captures an independent baseline per player without cross-contamination", async () => {
        const room = findUpgradeableRoom();
        expect(room).toBeTruthy();
        const playerA = simulator.players[0];
        const playerB = simulator.players.find((player) => String(player.id) !== String(playerA.id));
        expect(playerB).toBeTruthy();
        playerA.houseRooms[room.hrid] = 3;
        playerB.houseRooms[room.hrid] = 2;

        const wrapper = mountHomePage(router);
        await flushPromises();
        await openHouseRoomsModal(wrapper);

        // A: 3 -> 5
        await findRoomInput(wrapper, room).setValue("5");
        expect(wrapper.text()).toMatch(/Lv 3 → Lv 5/);

        // B 首次查看：基线捕获为 B 的 Lv2，摘要无变化；随后 B 自己升到 4 → Lv2 -> Lv4
        simulator.setActivePlayer(playerB.id);
        await flushPromises();
        expect(wrapper.text()).not.toMatch(/Lv 3 → Lv 5/);
        await findRoomInput(wrapper, room).setValue("4");
        expect(simulator.activePlayer.houseRooms[room.hrid]).toBe(4);
        expect(wrapper.text()).toMatch(/Lv 2 → Lv 4/);

        // 切回 A：A 的摘要仍然完整，不受 B 的会话影响
        simulator.setActivePlayer(playerA.id);
        await flushPromises();
        expect(wrapper.text()).toMatch(/Lv 3 → Lv 5/);
        expect(wrapper.text()).not.toMatch(/Lv 2 → Lv 4/);
        expect(simulator.activePlayer.houseRooms[room.hrid]).toBe(5);
        wrapper.unmount();
    });
});
