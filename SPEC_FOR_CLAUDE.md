# Product Spec: "Vita Check" - Daily Vitamin & Mineral Intake Checker (static website)

## What I need from you
Please produce, for an **autonomous coding model** that will build this project mostly unattended overnight (driven through the OpenCode CLI, with a human-side supervisor checking its work):

1. **Overall architecture** - file/module layout, data schema (food composition data, DRI tables, household measures, app state), key components, state management, and how the cross-nutrient sync and live target updates work.
2. **Project phases** - small, independently verifiable steps (each roughly one commit), ordered so that every phase leaves the repo in a working state and work can resume from the last commit if the model's API connection drops.
3. **Acceptance criteria for each phase** - concrete, checkable conditions (commands to run, tests that must pass, files that must exist, behaviors visible in a headless browser), so the supervisor can accept or reject each phase objectively.
4. **Risks and guardrails** - especially around data correctness (no invented nutrient numbers), and anything the coding model is likely to get wrong.

Keep the plan practical for a mid-strength coding model: explicit file names, explicit data formats, and small tasks.

## Constraints on the builder
- The coding model works in an isolated, fresh directory on a Linux box with Node.js 24, Python 3, git, and Google Chrome available (Playwright may be installed). It can run shell commands and download public files.
- Its API connection is unreliable (frequent 502/503/timeouts), so tasks must be small and every phase must end with a git commit.
- No secrets, no private data, no backend, no accounts.
- Commit titles: English Conventional Commits (e.g. `feat(ui): add nutrient target cards`).

## Product
A static, pure front-end website that lets a person check whether their daily intake of vitamins and minerals (micronutrients) is sufficient. All user-facing UI text is in **Simplified Chinese** (the target users are Chinese speakers). It will be used mostly on an iPhone.

### 1. Profile and standard selection (top of page)
- The user first chooses **sex** (male / female) and **age group** (adult groups at minimum, e.g. 18-29, 30-49, 50-64, 65-74, 75+; optionally pregnancy/lactation and younger groups if data is available).
- The page then shows **two reference standards side by side** for that profile:
  - **Chinese standard:** Chinese Dietary Reference Intakes, 2023 edition (published by the Chinese Nutrition Society), using RNI where available, otherwise AI.
  - **US standard:** US Dietary Reference Intakes (NASEM / NIH Office of Dietary Supplements tables), using RDA where available, otherwise AI.
- The user ticks which standard to calculate with (a toggle). All remaining-amount calculations use the selected standard. Switching standards recalculates instantly.
- Note: the two standards use different age-group boundaries; the design must map a single user age choice onto each standard's own group correctly.

### 2. Daily target cards
- Below the profile, one small card per nutrient showing the daily target from the selected standard.
- Each nutrient has its own distinct background color.
- Nutrients in scope (adjust if data is missing): vitamins A, D, E, K, C, B1 (thiamin), B2 (riboflavin), B3 (niacin), B6, folate, B12, pantothenic acid, biotin (optional), choline (optional); minerals calcium, iron, zinc, magnesium, potassium, phosphorus, selenium, copper, iodine (likely missing from food data), manganese, sodium (optional, as an upper-limit-type nutrient).
- Units must be handled carefully (e.g. vitamin A in micrograms RAE, folate in micrograms DFE, vitamin D in micrograms, niacin in mg NE vs. mg). Where the two standards or the food data use different equivalents, the design must state how values are converted or labeled.

### 3. Food list grouped by nutrient
- Foods are shown in groups, one group (tab or section) per nutrient.
- Within each group, food cards are sorted by that nutrient's amount **per 100 g**, from high to low, showing the amount per 100 g on the card.
- Each food has a Chinese name (shown in the UI) and an English name (secondary / searchable).
- A search box to filter foods is a nice-to-have.

### 4. Selecting a food and quantity
- Tapping a food card selects it: the card turns **green** and a **default quantity** is filled in.
- Quantity input supports **rough household measures** converted to grams, per food where sensible, for example: a handful of nuts, a fist-sized portion of cooked rice, one egg, one bowl, one cup of milk, one slice of bread, one medium apple. Each measure has a gram estimate. Manual entry in grams is always available.
- The page must state clearly that household measures are rough approximations.

### 5. Cross-group synchronization
- A selected food is selected **globally**, not per group.
- Example: the user selects pork liver in the vitamin A group. When they switch to the vitamin B12 group, pork liver already appears checked and **pinned at the top** of that group (above the high-to-low list), and its B12 contribution is already counted in the B12 target card.
- Changing the quantity anywhere updates every nutrient.

### 6. Live target updates
- Each target card shows the **remaining amount still needed** (target minus intake from all selected foods), updating live as foods/quantities change.
- When a nutrient reaches its target, its card turns **green**.
- If intake exceeds the target, show the surplus as **"+value unit"** (e.g. "+12 mg"); never show a negative number.
- Nice-to-have: show a warning when intake exceeds the Tolerable Upper Intake Level (UL), where UL data exists for the selected standard (noting that ULs often apply only to supplements/fortified forms, e.g. magnesium, folic acid, niacin).

### 7. Persistence and privacy
- Profile, selected standard, selected foods and quantities are saved in the browser's localStorage. No accounts, no backend, no network uploads. A "clear all" control resets.

### 8. Platform and deployment
- Output must be static files only (plain HTML/CSS/JS, or a light build such as Vite producing static output).
- Must work under **any base path** (relative asset paths): first deployed to GitHub Pages at a project path (e.g. `https://<user>.github.io/vita-check/`), later moved to a custom subdomain via CNAME. Include a short DEPLOY.md describing the custom-subdomain setup.
- Mobile-first, responsive layout (iPhone widths around 390 px must be comfortable); also good on desktop.

## Data requirements (correctness is critical)
- **Food composition:** USDA FoodData Central (public domain), e.g. the SR Legacy and/or Foundation Foods downloadable datasets. Select a few hundred up to about 1000 common foods relevant to a Chinese diet (grains, rice, noodles, tofu and soy products, vegetables, fruits, meats, offal, fish and seafood, eggs, dairy, nuts and seeds, mushrooms, seaweed, etc.). Data must be **extracted by a script from the downloaded official files**, keeping the USDA FDC ID per food for traceability - never typed in from memory.
- The Chinese Food Composition Table is copyrighted and **must not be copied**.
- Common Chinese staples or dishes missing from USDA may be added only as clearly labeled **estimates**, each with its stated basis (e.g. computed from listed USDA ingredients and proportions), and visibly marked as estimates in the UI.
- **DRI tables:** Chinese DRIs 2023 and US DRIs, stored as structured data files with a source citation per table. These values will be spot-checked by a human supervisor against official sources; the plan should keep them in one clearly reviewable file and must not let the coding model invent values it cannot source.
- An "About / data sources" section on the page lists sources, versions, and the disclaimer: this is for general information only, not medical advice.

## Quality expectations
- Unit tests for: nutrient calculation, unit conversion, household-measure conversion, standard/age-group mapping, cross-group sync and pinning order, remaining/surplus display (no negatives).
- A headless browser smoke test (e.g. Playwright with system Chrome) covering: choose profile, select a food in one group, switch groups and see it pinned and counted, target card turns green when reached, surplus shown with "+", reload restores state, mobile viewport renders without horizontal scrolling.
- A data validation script: every food has an FDC ID or an estimate basis; no negative or absurd values; DRI tables complete for every nutrient/profile in scope.
- Screenshots at desktop and mobile widths as final evidence.
