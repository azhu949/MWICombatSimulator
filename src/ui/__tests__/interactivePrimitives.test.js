// @vitest-environment jsdom

import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { defineComponent, ref } from "vue";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "../components/ui/accordion/index.js";
import { SearchCombobox } from "../components/ui/combobox/index.js";
import { NativeSelect } from "../components/ui/native-select/index.js";
import { NumberField } from "../components/ui/number-field/index.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "../components/ui/select/index.js";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "../components/ui/tabs/index.js";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../components/ui/table/index.js";

beforeAll(() => {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }

  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: vi.fn(),
  });
  Object.defineProperty(HTMLElement.prototype, "hasPointerCapture", {
    configurable: true,
    value: () => false,
  });
  Object.defineProperty(HTMLElement.prototype, "setPointerCapture", {
    configurable: true,
    value: vi.fn(),
  });
  Object.defineProperty(HTMLElement.prototype, "releasePointerCapture", {
    configurable: true,
    value: vi.fn(),
  });
});

afterEach(() => {
  document.body.innerHTML = "";
});

describe("interactive shadcn-vue primitives", () => {
  it("renders Table primitives as semantic table elements", () => {
    const Host = defineComponent({
      components: { Table, TableBody, TableCell, TableHead, TableHeader, TableRow },
      template: `
        <Table>
          <TableHeader>
            <TableRow><TableHead>Metric</TableHead></TableRow>
          </TableHeader>
          <TableBody>
            <TableRow><TableCell>Damage</TableCell></TableRow>
          </TableBody>
        </Table>
      `,
    });
    const wrapper = mount(Host);

    expect(wrapper.get("table").exists()).toBe(true);
    expect(wrapper.get("thead th").text()).toBe("Metric");
    expect(wrapper.get("tbody td").text()).toBe("Damage");
    expect(wrapper.findAll("tr")).toHaveLength(2);
  });

  it("forwards Tabs v-model and renders the selected panel", async () => {
    const Host = defineComponent({
      components: { Tabs, TabsContent, TabsList, TabsTrigger },
      setup() {
        const selected = ref("summary");
        return { selected };
      },
      template: `
        <Tabs v-model="selected">
          <TabsList>
            <TabsTrigger value="summary">Summary</TabsTrigger>
            <TabsTrigger value="details">Details</TabsTrigger>
          </TabsList>
          <TabsContent value="summary">Summary panel</TabsContent>
          <TabsContent value="details">Details panel</TabsContent>
        </Tabs>
      `,
    });
    const wrapper = mount(Host, { attachTo: document.body });

    expect(wrapper.text()).toContain("Summary panel");
    await wrapper.findAll('[data-slot="tabs-trigger"]')[1].trigger("mousedown", {
      button: 0,
      ctrlKey: false,
    });
    await flushPromises();

    expect(wrapper.vm.selected).toBe("details");
    expect(wrapper.text()).toContain("Details panel");
  });

  it("forwards Accordion attributes and toggles its content", async () => {
    const Host = defineComponent({
      components: { Accordion, AccordionContent, AccordionItem, AccordionTrigger },
      template: `
        <Accordion type="single" collapsible>
          <AccordionItem value="guide">
            <AccordionTrigger>Guide contents</AccordionTrigger>
            <AccordionContent>Anchor links</AccordionContent>
          </AccordionItem>
        </Accordion>
      `,
    });
    const wrapper = mount(Host, { attachTo: document.body });

    expect(wrapper.text()).not.toContain("Anchor links");
    await wrapper.get('[data-slot="accordion-trigger"]').trigger("click");
    await flushPromises();

    expect(wrapper.text()).toContain("Anchor links");
    expect(wrapper.get('[data-slot="accordion-trigger"]').attributes("data-state")).toBe("open");
  });

  it("updates Number Field values without exceeding the configured bounds", async () => {
    const Host = defineComponent({
      components: { NumberField },
      setup() {
        const amount = ref(2);
        return { amount };
      },
      template: '<NumberField v-model="amount" :min="1" :max="3" increment-label="Increase rounds" />',
    });
    const wrapper = mount(Host);
    await flushPromises();
    const increment = wrapper.get('button[aria-label="Increase rounds"]');

    increment.element.dispatchEvent(new MouseEvent("pointerdown", {
      bubbles: true,
      cancelable: true,
      button: 0,
    }));
    window.dispatchEvent(new Event("pointerup"));
    await flushPromises();
    expect(wrapper.vm.amount).toBe(3);
    expect(increment.attributes("disabled")).toBeDefined();
  });

  it("forwards Number Field labels to the input instead of a stepper button", () => {
    const Host = defineComponent({
      components: { NumberField },
      template: `
        <div>
          <label for="round-count">Rounds</label>
          <NumberField id="round-count" :model-value="2" />
        </div>
      `,
    });
    const wrapper = mount(Host);

    const label = wrapper.get("label").element;
    const input = wrapper.get("input").element;
    expect(input.id).toBe("round-count");
    expect(label.control).toBe(input);

    wrapper.unmount();
  });

  it("preserves Native Select number modifiers and change events", async () => {
    const Host = defineComponent({
      components: { NativeSelect },
      setup() {
        const changes = ref(0);
        const selected = ref(1);
        return { changes, selected };
      },
      template: `
        <NativeSelect v-model.number="selected" @change="changes += 1">
          <option :value="1">One</option>
          <option :value="2">Two</option>
        </NativeSelect>
      `,
    });
    const wrapper = mount(Host);

    await wrapper.get("select").setValue("2");
    expect(wrapper.vm.selected).toBe(2);
    expect(wrapper.vm.changes).toBe(1);
  });

  it("filters and caps Combobox results before emitting a selection", async () => {
    const Host = defineComponent({
      components: { SearchCombobox },
      setup() {
        const selected = ref("");
        const options = [
          { value: "alpha", label: "Alpha" },
          { value: "beta", label: "Beta" },
          { value: "gamma", label: "Gamma" },
          { value: "delta", label: "Delta" },
        ];
        return { options, selected };
      },
      template: `
        <SearchCombobox
          v-model="selected"
          :options="options"
          :max-results="2"
          more-results-label="{count} more"
          placeholder="Search targets"
        />
      `,
    });
    const wrapper = mount(Host, { attachTo: document.body });
    const input = wrapper.get("input");
    expect(input.classes()).toContain("focus-visible:outline-none!");
    expect(wrapper.find(".lucide-search").exists()).toBe(false);

    await input.trigger("focus");
    await flushPromises();
    expect(document.body.textContent).toContain("2 more");

    await input.setValue("gam");
    await flushPromises();
    expect(document.body.textContent).toContain("Gamma");
    expect(document.body.textContent).not.toContain("Alpha");

    document.body.querySelector('[role="option"]').click();
    await flushPromises();
    expect(wrapper.vm.selected).toBe("gamma");
  });

  it("shows the full result set when opening with an existing selection", async () => {
    const Host = defineComponent({
      components: { SearchCombobox },
      setup() {
        const selected = ref("alpha");
        const options = ref([
          { value: "alpha", label: "Alpha" },
          { value: "beta", label: "Beta" },
          { value: "gamma", label: "Gamma" },
        ]);
        return { options, selected };
      },
      template: `
        <SearchCombobox
          v-model="selected"
          :options="options"
          :max-results="2"
          more-results-label="{count} more"
          aria-label="Region"
        />
      `,
    });
    const wrapper = mount(Host, { attachTo: document.body });
    const input = wrapper.get("input");

    await flushPromises();
    expect(input.element.value).toBe("Alpha");
    await input.trigger("focus");
    await flushPromises();

    const content = document.getElementById(input.attributes("aria-controls"));
    const optionLabels = Array.from(document.body.querySelectorAll('[role="option"]')).map((option) => option.textContent.trim());
    expect(content?.closest('[data-reka-popper-content-wrapper]')).not.toBeNull();
    expect(optionLabels).toEqual(["Alpha", "Beta"]);
    expect(document.body.textContent).toContain("1 more");

    document.body.querySelectorAll('[role="option"]')[1].click();
    await flushPromises();
    wrapper.unmount();
  });

  it("refreshes the selected Combobox label when option labels change", async () => {
    const Host = defineComponent({
      components: { SearchCombobox },
      setup() {
        const selected = ref("alpha");
        const options = ref([
          { value: "alpha", label: "Alpha" },
          { value: "beta", label: "Beta" },
        ]);
        return { options, selected };
      },
      template: `<SearchCombobox v-model="selected" :options="options" aria-label="Region" />`,
    });
    const wrapper = mount(Host, { attachTo: document.body });
    const input = wrapper.get("input");

    await flushPromises();
    expect(input.element.value).toBe("Alpha");
    wrapper.vm.options = [
      { value: "alpha", label: "阿尔法" },
      { value: "beta", label: "贝塔" },
    ];
    await flushPromises();
    expect(input.element.value).toBe("阿尔法");
    wrapper.unmount();
  });

  it("maps an empty-string option through Reka Combobox without changing the public value", async () => {
    const Host = defineComponent({
      components: { SearchCombobox },
      setup() {
        const selected = ref("alpha");
        const options = [
          { value: "", label: "None" },
          { value: "alpha", label: "Alpha" },
        ];
        return { options, selected };
      },
      template: `<SearchCombobox v-model="selected" :options="options" aria-label="Equipment" />`,
    });
    const wrapper = mount(Host, { attachTo: document.body });
    const input = wrapper.get("input");

    await input.trigger("focus");
    await flushPromises();
    const options = document.body.querySelectorAll('[role="option"]');
    expect(options).toHaveLength(2);
    expect(options[0].textContent).toContain("None");

    options[0].click();
    await flushPromises();
    expect(wrapper.vm.selected).toBe("");
    expect(input.element.value).toBe("None");
    wrapper.unmount();
  });

  it("forwards Select v-model through a keyboard selection", async () => {
    const Host = defineComponent({
      components: { Select, SelectContent, SelectItem, SelectTrigger },
      setup() {
        const selected = ref("strict");
        return { selected };
      },
      template: `
        <Select v-model="selected">
          <SelectTrigger aria-label="Scoring mode" />
          <SelectContent>
            <SelectItem value="strict">Strict</SelectItem>
            <SelectItem value="composite">Composite</SelectItem>
          </SelectContent>
        </Select>
      `,
    });
    const wrapper = mount(Host, { attachTo: document.body });
    const trigger = wrapper.get('[data-slot="select-trigger"]');

    await trigger.trigger("keydown", { key: "ArrowDown" });
    await flushPromises();
    const options = document.body.querySelectorAll('[role="option"]');
    options[1].dispatchEvent(new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: "Enter",
    }));
    await flushPromises();

    expect(wrapper.vm.selected).toBe("composite");
    expect(trigger.text()).toContain("Composite");
  });

});
