import abilityDetailMap from "../data/abilityDetailMap.json";
import { describe, expect, it } from "vitest";
import { normalizeAbilityDefinitionHrid, resolveAbilityDefinition } from "../abilityDefinitionResolver.js";

describe("abilityDefinitionResolver", () => {
    it("resolves extracted abilities from abilityDetailMap", () => {
        expect(resolveAbilityDefinition("/abilities/aqua_arrow")).toEqual(abilityDetailMap["/abilities/aqua_arrow"]);
    });

    it("resolves supplemental blaze and bloom abilities through the shared resolver", () => {
        expect(normalizeAbilityDefinitionHrid("blaze")).toBe("/abilities/blaze");
        expect(normalizeAbilityDefinitionHrid("bloom")).toBe("/abilities/bloom");

        expect(resolveAbilityDefinition("/abilities/blaze")?.name).toBe("Blaze");
        expect(resolveAbilityDefinition("blaze")?.hrid).toBe("/abilities/blaze");
        expect(resolveAbilityDefinition("/abilities/bloom")?.name).toBe("Bloom");
        expect(resolveAbilityDefinition("bloom")?.hrid).toBe("/abilities/bloom");
    });

    it("returns null for unknown abilities", () => {
        expect(resolveAbilityDefinition("/abilities/unknown_custom")).toBeNull();
    });
});
