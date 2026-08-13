// @vitest-environment jsdom

import { beforeAll, describe, expect, it } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { initI18n } from "../i18n/i18n.js";
import InlineTriggerEditor from "../components/home/InlineTriggerEditor.vue";
import { Select } from "../components/ui/select/index.js";

const VALID_RULE = {
  dependencyHrid: "/combat_trigger_dependencies/self",
  conditionHrid: "/combat_trigger_conditions/missing_hp",
  comparatorHrid: "/combat_trigger_comparators/greater_than_equal",
  value: 1,
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function mountEditor(overrides = {}) {
  const currentRules = overrides.currentRules ?? [clone(VALID_RULE)];
  return mount(InlineTriggerEditor, {
    attachTo: document.body,
    props: {
      targetId: "ability:0",
      targetName: "Test ability",
      state: "default",
      currentRules,
      defaultRules: [clone(VALID_RULE)],
      draft: clone(currentRules),
      expanded: true,
      maxRules: 4,
      ...overrides,
    },
  });
}

function buttonByText(wrapper, text) {
  return wrapper.findAll("button").find((button) => button.text().includes(text));
}

beforeAll(async () => {
  localStorage.setItem("i18nextLng", "en");
  await initI18n();
});

describe("InlineTriggerEditor", () => {
  it("renders default, custom, and no-condition summaries", async () => {
    const wrapper = mountEditor({ expanded: false });
    await flushPromises();
    expect(wrapper.text()).toContain("Default");
    expect(wrapper.text()).toContain("1 conditions");

    await wrapper.setProps({ state: "custom" });
    expect(wrapper.text()).toContain("Custom");

    await wrapper.setProps({ state: "disabled", currentRules: [], draft: [] });
    expect(wrapper.text()).toContain("No conditions");
    expect(wrapper.text()).toContain("Activates whenever it is ready.");

    await wrapper.setProps({ state: "default" });
    expect(wrapper.text()).toContain("No conditions");
    wrapper.unmount();
  });

  it("adds and removes draft rules without mutating current rules", async () => {
    const currentRules = [clone(VALID_RULE)];
    const wrapper = mountEditor({ currentRules, draft: clone(currentRules) });

    await buttonByText(wrapper, "Add condition").trigger("click");
    expect(wrapper.emitted("update:draft").at(-1)[0]).toHaveLength(2);
    expect(currentRules).toEqual([VALID_RULE]);

    await buttonByText(wrapper, "Remove").trigger("click");
    expect(wrapper.emitted("update:draft").at(-1)[0]).toEqual([]);
    expect(currentRules).toEqual([VALID_RULE]);
    wrapper.unmount();
  });

  it("enforces the four-rule limit", () => {
    const rules = Array.from({ length: 4 }, () => clone(VALID_RULE));
    const wrapper = mountEditor({ currentRules: rules, draft: clone(rules) });

    expect(buttonByText(wrapper, "Add condition").attributes("disabled")).toBeDefined();
    wrapper.unmount();
  });

  it("clears dependent fields when dependency changes", async () => {
    const wrapper = mountEditor();
    wrapper.findAllComponents(Select)[0].vm.$emit("update:modelValue", "/combat_trigger_dependencies/all_enemies");
    await flushPromises();

    expect(wrapper.emitted("update:draft").at(-1)[0][0]).toEqual({
      dependencyHrid: "/combat_trigger_dependencies/all_enemies",
      conditionHrid: "",
      comparatorHrid: "",
      value: 0,
    });
    wrapper.unmount();
  });

  it("disables the value input for comparators that do not accept a value", async () => {
    const rule = {
      dependencyHrid: "/combat_trigger_dependencies/self",
      conditionHrid: "/combat_trigger_conditions/frenzy",
      comparatorHrid: "/combat_trigger_comparators/is_active",
      value: 0,
    };
    const wrapper = mountEditor({ currentRules: [rule], draft: clone([rule]) });

    expect(wrapper.get('input[type="number"]').attributes("disabled")).toBeDefined();
    wrapper.unmount();
  });

  it("blocks invalid saves and emits valid save and cancel actions", async () => {
    const wrapper = mountEditor({ currentRules: [], draft: [{
      dependencyHrid: "/combat_trigger_dependencies/self",
      conditionHrid: "",
      comparatorHrid: "",
      value: 0,
    }] });
    expect(buttonByText(wrapper, "Save").attributes("disabled")).toBeDefined();

    await wrapper.setProps({ draft: [clone(VALID_RULE)] });
    await buttonByText(wrapper, "Save").trigger("click");
    expect(wrapper.emitted("save").at(-1)[0]).toEqual([VALID_RULE]);

    await buttonByText(wrapper, "Cancel").trigger("click");
    expect(wrapper.emitted("cancel")).toHaveLength(1);
    wrapper.unmount();
  });

  it("keeps restore-default and no-condition actions as drafts until save", async () => {
    const currentRules = [{ ...clone(VALID_RULE), value: 75 }];
    const defaultRules = [clone(VALID_RULE)];
    const wrapper = mountEditor({ currentRules, defaultRules, draft: clone(currentRules) });

    await buttonByText(wrapper, "Restore default").trigger("click");
    expect(wrapper.emitted("update:draft").at(-1)[0]).toEqual(defaultRules);
    expect(wrapper.emitted("save")).toBeUndefined();
    expect(currentRules[0].value).toBe(75);

    await buttonByText(wrapper, "No conditions").trigger("click");
    expect(wrapper.emitted("update:draft").at(-1)[0]).toEqual([]);
    expect(wrapper.emitted("save")).toBeUndefined();
    expect(currentRules[0].value).toBe(75);
    wrapper.unmount();
  });
});
