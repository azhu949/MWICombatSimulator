// Auto-generated from src/main.js (Trigger)

function initTriggerModal() {
    let modal = document.getElementById("triggerModal");
    modal.addEventListener("show.bs.modal", (event) => triggerModalShownHandler(event));

    let triggerSaveButton = document.getElementById("buttonTriggerModalSave");
    triggerSaveButton.addEventListener("click", (event) => triggerModalSaveHandler(event));

    let triggerAddButton = document.getElementById("buttonAddTrigger");
    triggerAddButton.addEventListener("click", (event) => triggerAddButtonHandler(event));

    let triggerDefaultButton = document.getElementById("buttonDefaultTrigger");
    triggerDefaultButton.addEventListener("click", (event) => triggerDefaultButtonHandler(event));

    for (let i = 0; i < 4; i++) {
        let triggerDependencySelect = document.getElementById("selectTriggerDependency_" + i);
        let triggerConditionSelect = document.getElementById("selectTriggerCondition_" + i);
        let triggerComparatorSelect = document.getElementById("selectTriggerComparator_" + i);
        let triggerValueInput = document.getElementById("inputTriggerValue_" + i);
        let triggerRemoveButton = document.getElementById("buttonRemoveTrigger_" + i);

        triggerDependencySelect.addEventListener("change", (event) => triggerDependencySelectHandler(event, i));
        triggerConditionSelect.addEventListener("change", (event) => triggerConditionSelectHandler(event, i));
        triggerComparatorSelect.addEventListener("change", (event) => triggerComparatorSelectHander(event, i));
        triggerValueInput.addEventListener("change", (event) => triggerValueInputHandler(event, i));
        triggerRemoveButton.addEventListener("click", (event) => triggerRemoveButtonHandler(event, i));
    }
}

function triggerModalShownHandler(event) {
    let triggerButton = event.relatedTarget;

    let triggerType = triggerButton.getAttribute("data-bs-triggertype");
    let triggerIndex = Number(triggerButton.getAttribute("data-bs-triggerindex"));

    let triggerTarget;
    switch (triggerType) {
        case "food":
            triggerTarget = food[triggerIndex];
            break;
        case "drink":
            triggerTarget = drinks[triggerIndex];
            break;
        case "ability":
            triggerTarget = abilities[triggerIndex];
            break;
    }

    let triggerTargetnput = document.getElementById("inputModalTriggerTarget");
    triggerTargetnput.value = triggerTarget;
    modalTriggers = triggerMap[triggerTarget];
    updateTriggerModal();
}

function triggerModalSaveHandler(event) {
    let triggerTargetnput = document.getElementById("inputModalTriggerTarget");
    let triggerTarget = triggerTargetnput.value;

    triggerMap[triggerTarget] = modalTriggers;
    refreshHomeDiffHighlight();
}

function triggerDependencySelectHandler(event, index) {
    modalTriggers[index].dependencyHrid = event.target.value;
    modalTriggers[index].conditionHrid = "";
    modalTriggers[index].comparatorHrid = "";
    modalTriggers[index].value = 0;

    updateTriggerModal();
}

function triggerConditionSelectHandler(event, index) {
    modalTriggers[index].conditionHrid = event.target.value;
    modalTriggers[index].comparatorHrid = "";
    modalTriggers[index].value = 0;

    updateTriggerModal();
}

function triggerComparatorSelectHander(event, index) {
    modalTriggers[index].comparatorHrid = event.target.value;

    updateTriggerModal();
}

function triggerValueInputHandler(event, index) {
    modalTriggers[index].value = Number(event.target.value);

    updateTriggerModal();
}

function triggerRemoveButtonHandler(event, index) {
    modalTriggers.splice(index, 1);

    updateTriggerModal();
}

function triggerAddButtonHandler(event) {
    if (modalTriggers.length == 4) {
        return;
    }

    modalTriggers.push({
        dependencyHrid: "",
        conditionHrid: "",
        comparatorHrid: "",
        value: 0,
    });

    updateTriggerModal();
}

function triggerDefaultButtonHandler(event) {
    let triggerTargetnput = document.getElementById("inputModalTriggerTarget");
    let triggerTarget = triggerTargetnput.value;

    if (triggerTarget.startsWith("/items/")) {
        modalTriggers = structuredClone(itemDetailMap[triggerTarget].consumableDetail.defaultCombatTriggers);
    } else {
        modalTriggers = structuredClone(abilityDetailMap[triggerTarget].defaultCombatTriggers);
    }

    updateTriggerModal();
}

function updateTriggerModal() {
    let triggerStartTextElement = document.getElementById("triggerStartText");
    if (modalTriggers.length == 0) {
        triggerStartTextElement.innerHTML = "Activate as soon as it's off cooldown";
    } else {
        triggerStartTextElement.innerHTML = "Activate when:";
    }

    let triggerAddButton = document.getElementById("buttonAddTrigger");
    triggerAddButton.disabled = modalTriggers.length == 4;

    let triggersValid = true;

    for (let i = 0; i < 4; i++) {
        let triggerElement = document.getElementById("modalTrigger_" + i);

        if (!modalTriggers[i]) {
            hideElement(triggerElement);
            continue;
        }

        showElement(triggerElement);

        let triggerDependencySelect = document.getElementById("selectTriggerDependency_" + i);
        let triggerConditionSelect = document.getElementById("selectTriggerCondition_" + i);
        let triggerComparatorSelect = document.getElementById("selectTriggerComparator_" + i);
        let triggerValueInput = document.getElementById("inputTriggerValue_" + i);

        showElement(triggerDependencySelect);
        fillTriggerDependencySelect(triggerDependencySelect);

        if (modalTriggers[i].dependencyHrid == "") {
            hideElement(triggerConditionSelect);
            hideElement(triggerComparatorSelect);
            hideElement(triggerValueInput);
            triggersValid = false;
            continue;
        }

        triggerDependencySelect.value = modalTriggers[i].dependencyHrid;
        showElement(triggerConditionSelect);
        fillTriggerConditionSelect(triggerConditionSelect, modalTriggers[i].dependencyHrid);

        if (modalTriggers[i].conditionHrid == "") {
            hideElement(triggerComparatorSelect);
            hideElement(triggerValueInput);
            triggersValid = false;
            continue;
        }

        triggerConditionSelect.value = modalTriggers[i].conditionHrid;
        showElement(triggerComparatorSelect);
        fillTriggerComparatorSelect(triggerComparatorSelect, modalTriggers[i].conditionHrid);

        if (modalTriggers[i].comparatorHrid == "") {
            hideElement(triggerValueInput);
            triggersValid = false;
            continue;
        }

        triggerComparatorSelect.value = modalTriggers[i].comparatorHrid;

        if (combatTriggerComparatorDetailMap[modalTriggers[i].comparatorHrid].allowValue) {
            showElement(triggerValueInput);
            triggerValueInput.value = modalTriggers[i].value;
        } else {
            hideElement(triggerValueInput);
        }
    }

    let triggerSaveButton = document.getElementById("buttonTriggerModalSave");
    triggerSaveButton.disabled = !triggersValid;

    updateContent();
}

function fillTriggerDependencySelect(element) {
    element.length = 0;
    element.add(new Option("", ""));

    for (const dependency of Object.values(combatTriggerDependencyDetailMap).sort(
        (a, b) => a.sortIndex - b.sortIndex
    )) {
        let opt = new Option(dependency.name, dependency.hrid);
        opt.setAttribute("data-i18n", "combatTriggerDependencyNames." + dependency.hrid);
        element.add(opt);
    }
}

function fillTriggerConditionSelect(element, dependencyHrid) {
    let dependency = combatTriggerDependencyDetailMap[dependencyHrid];

    let conditions;
    if (dependency.isSingleTarget) {
        conditions = Object.values(combatTriggerConditionDetailMap).filter((condition) => condition.isSingleTarget);
    } else {
        conditions = Object.values(combatTriggerConditionDetailMap).filter((condition) => condition.isMultiTarget);
    }

    element.length = 0;
    element.add(new Option("", ""));

    for (const condition of Object.values(conditions).sort((a, b) => a.sortIndex - b.sortIndex)) {
        let opt = new Option(condition.name, condition.hrid);
        opt.setAttribute("data-i18n", "combatTriggerConditionNames." + condition.hrid);
        element.add(opt);
    }
}

function fillTriggerComparatorSelect(element, conditionHrid) {
    let condition = combatTriggerConditionDetailMap[conditionHrid];

    let comparators = condition.allowedComparatorHrids.map((hrid) => combatTriggerComparatorDetailMap[hrid]);

    element.length = 0;
    element.add(new Option("", ""));

    for (const comparator of Object.values(comparators).sort((a, b) => a.sortIndex - b.sortIndex)) {
        let opt = new Option(comparator.name, comparator.hrid);
        opt.setAttribute("data-i18n", "combatTriggerComparatorNames." + comparator.hrid);
        element.add(opt);
    }
}

function hideElement(element) {
    element.classList.remove("d-flex");
    element.classList.add("d-none");
}

function showElement(element) {
    element.classList.remove("d-none");
    element.classList.add("d-flex");
}

export function registerTriggerModule(api) {
    api.registerFunctions({
        initTriggerModal,
        triggerModalShownHandler,
        triggerModalSaveHandler,
        triggerDependencySelectHandler,
        triggerConditionSelectHandler,
        triggerComparatorSelectHander,
        triggerValueInputHandler,
        triggerRemoveButtonHandler,
        triggerAddButtonHandler,
        triggerDefaultButtonHandler,
        updateTriggerModal,
        fillTriggerDependencySelect,
        fillTriggerConditionSelect,
        fillTriggerComparatorSelect,
        hideElement,
        showElement
    });
}
