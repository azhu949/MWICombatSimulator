// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createRouter, createMemoryHistory } from "vue-router";
import { defineComponent } from "vue";
import AppSidebar from "../components/AppSidebar.vue";
import CombatCommandBar from "../components/CombatCommandBar.vue";
import { Sidebar, SidebarProvider, SidebarTrigger } from "../components/ui/sidebar/index.js";

const EmptyPage = { template: "<div />" };

function createTestRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/home", name: "home", component: EmptyPage, meta: { navLabelKey: "home", navLabel: "Home", navGroup: "simulation", navOrder: 1 } },
      { path: "/queue", name: "queue", component: EmptyPage, meta: { navLabelKey: "queue", navLabel: "Queue", navGroup: "support", navOrder: 2 } },
      { path: "/patch-notes", name: "patch-notes", component: EmptyPage, meta: { navLabelKey: "patchNotes", navLabel: "Patch Notes", navHidden: true } },
    ],
  });
}

describe("application shell behavior", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => { document.body.innerHTML = ""; });

  it("marks the current sidebar route active", async () => {
    const router = createTestRouter();
    await router.push("/queue");
    await router.isReady();

    const wrapper = mount(defineComponent({
      components: { AppSidebar, SidebarProvider },
      template: '<SidebarProvider><AppSidebar version="1.0.0" /></SidebarProvider>',
    }), { global: { plugins: [router] }, attachTo: document.body });

    const queueLink = wrapper.findAll("a").find((link) => link.text().includes("Queue"));
    expect(queueLink.classes()).toContain("bg-sidebar-accent");
  });

  it("links to patch notes and exposes the semantic unread indicator", async () => {
    const router = createTestRouter();
    await router.push("/home");
    await router.isReady();

    const wrapper = mount(defineComponent({
      components: { AppSidebar, SidebarProvider },
      template: '<SidebarProvider><AppSidebar version="1.0.0" :unread-patch-notes-count="3" patch-notes-label="Patch Notes, 3 unread updates" /></SidebarProvider>',
    }), { global: { plugins: [router] }, attachTo: document.body });

    const patchNotesLink = wrapper.findAll("a").find((link) => link.attributes("href") === "/patch-notes");
    expect(patchNotesLink).toBeTruthy();
    expect(patchNotesLink.attributes("aria-label")).toBe("Patch Notes, 3 unread updates");
    expect(patchNotesLink.find(".sidebar-unread-indicator").exists()).toBe(true);
    expect(patchNotesLink.find(".sidebar-unread-badge").text()).toBe("3");

    await router.push("/patch-notes");
    await flushPromises();
    expect(patchNotesLink.classes()).toContain("sidebar-action-active");
  });

  it("caps the unread badge at 99+", async () => {
    const router = createTestRouter();
    await router.push("/home");
    await router.isReady();

    const wrapper = mount(defineComponent({
      components: { AppSidebar, SidebarProvider },
      template: '<SidebarProvider><AppSidebar version="1.0.0" :unread-patch-notes-count="120" /></SidebarProvider>',
    }), { global: { plugins: [router] }, attachTo: document.body });

    const patchNotesLink = wrapper.findAll("a").find((link) => link.attributes("href") === "/patch-notes");
    expect(patchNotesLink.find(".sidebar-unread-badge").text()).toBe("99+");
  });

  it("persists desktop sidebar collapse state", async () => {
    const wrapper = mount(defineComponent({
      components: { SidebarProvider, SidebarTrigger },
      template: '<SidebarProvider><SidebarTrigger /></SidebarProvider>',
    }));

    await wrapper.get("button").trigger("click");
    expect(localStorage.getItem("mwi.ui.sidebar.v1")).toBe("collapsed");
    expect(wrapper.get("button").attributes("aria-label")).toBe("Expand navigation");
  });

  it("closes the mobile sidebar when the viewport crosses into desktop", async () => {
    let mediaListener;
    const originalMatchMedia = window.matchMedia;
    window.matchMedia = () => ({
      matches: false,
      addEventListener: (_event, listener) => { mediaListener = listener; },
      removeEventListener: () => {},
    });

    const wrapper = mount(defineComponent({
      components: { Sidebar, SidebarProvider, SidebarTrigger },
      template: '<SidebarProvider><SidebarTrigger mobile /><Sidebar><span>Navigation</span></Sidebar></SidebarProvider>',
    }), { attachTo: document.body });

    await wrapper.get("button").trigger("click");
    await flushPromises();
    expect(document.body.querySelector('[role="dialog"]')).not.toBeNull();

    mediaListener({ matches: true });
    await flushPromises();
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();

    wrapper.unmount();
    window.matchMedia = originalMatchMedia;
  });

  it("preserves command disabled rules and emits the primary action", async () => {
    const wrapper = mount(CombatCommandBar, {
      props: {
        players: [],
        hasBaseline: true,
        itemCount: 1,
        queueActionsDisabled: false,
      },
      attachTo: document.body,
    });

    const runButtons = wrapper.findAll("button").filter((button) => button.text().includes("Run Queue"));
    expect(runButtons.length).toBe(2);
    expect(runButtons.every((button) => button.attributes("disabled") === undefined)).toBe(true);
    await runButtons[0].trigger("click");
    expect(wrapper.emitted("run-queue")).toHaveLength(1);
  });

  it("switches the Home simulation action from start to stop", async () => {
    const wrapper = mount(CombatCommandBar, {
      props: { players: [], showSimulationActions: true, simulationRunning: false },
    });

    await wrapper.get("button").trigger("click");
    expect(wrapper.emitted("start-simulation")).toHaveLength(1);

    await wrapper.setProps({ simulationRunning: true });
    const stopButton = wrapper.findAll("button").find((button) => button.text().includes("Stop"));
    expect(stopButton).toBeTruthy();
    await stopButton.trigger("click");
    expect(wrapper.emitted("stop-simulation")).toHaveLength(1);
  });

  it("shows the party locked by the active queue baseline", () => {
    const wrapper = mount(CombatCommandBar, {
      props: { players: [], partySummaryText: "Alice / Bob" },
    });

    expect(wrapper.text()).toContain("Locked party");
    expect(wrapper.text()).toContain("Alice / Bob");
  });

  it("only handles player keyboard selection on the player control itself", () => {
    const wrapper = mount(CombatCommandBar, {
      props: { players: [{ id: "player-1", name: "Player One", selected: true }] },
    });
    const playerControl = wrapper.get('[role="button"]');
    const nameInput = playerControl.findAll("input")[0];
    const inputSpace = new KeyboardEvent("keydown", { key: " ", bubbles: true, cancelable: true });

    expect(nameInput.element.dispatchEvent(inputSpace)).toBe(true);
    expect(inputSpace.defaultPrevented).toBe(false);
    expect(wrapper.emitted("select-player")).toBeUndefined();

    const controlSpace = new KeyboardEvent("keydown", { key: " ", bubbles: true, cancelable: true });
    expect(playerControl.element.dispatchEvent(controlSpace)).toBe(false);
    expect(controlSpace.defaultPrevented).toBe(true);
    expect(wrapper.emitted("select-player")).toEqual([["player-1"]]);
  });

  it("opens the mobile overflow menu", async () => {
    const wrapper = mount(CombatCommandBar, { props: { players: [] }, attachTo: document.body });
    await wrapper.get('button[aria-label="More actions"]').trigger("click");
    await flushPromises();
    expect(document.body.textContent).toContain("Set Baseline");
    expect(document.body.textContent).toContain("Clear Queue");
  });
});
