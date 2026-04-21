# Gemini Prompt Pack for the Budgeting App

Use these prompts to generate UI floor plans before polishing implementation. Each prompt is tuned for a single-user, mobile-first budgeting PWA with very low entry friction.

## Global rules for every prompt

```
Design for an iPhone-sized viewport first.
Create a calm, clean budgeting app UI for a single user.
This is a lightweight installable web app, not a bank app and not accounting software.
Prioritize one-handed use, large tap targets, fast scanning, and amount-first entry.
Use a bottom navigation pattern with Home, Transactions, Add, Budget, and Insights.
Keep copy minimal and practical.
Use a trust-blue base, success green for healthy budget states, red only for overspending or destructive actions.
Avoid neon gradients, glass-heavy finance dashboards, fake credit-card UIs, fake bank sync, and spreadsheet clutter.
Make numbers highly legible and category progress easy to understand in one glance.
```

## Prompt 1: Direction A

```
Generate a mobile UI concept for a personal budgeting app focused on very fast expense tracking.

Visual direction:
- Calm and clean
- Minimalism mixed with soft modern UI
- Clear surfaces, subtle depth, compact spacing
- Friendly but not playful

Show these screens in one concept set:
1. Home screen with this month spend, remaining budget, recent transactions, and a strong quick-add affordance
2. Quick Add bottom sheet with amount-first keypad, preset categories, and optional merchant/date/note fields
3. Budget screen with category rows and simple progress bars

Interaction goals:
- Common case should feel like open add -> tap amount -> tap save
- Show how category is selected quickly
- Keep everything thumb-friendly and visually stable

Output:
- 3 vertically stacked iPhone mockups
- clean spacing
- strong numeric hierarchy
- no marketing hero sections
```

## Prompt 2: Direction B

```
Generate a second mobile UI concept for the same budgeting app, but make it slightly more premium while staying highly usable.

Visual direction:
- Polished and modern
- Calm financial clarity
- Slightly richer materials, but no heavy glassmorphism
- High contrast text, restrained color

Show:
1. Home screen
2. Transactions screen with search and quick edit affordances
3. Insights screen with simple category breakdown and monthly trend

Requirements:
- Bottom navigation always visible
- Primary add action must remain obvious
- Charts should be simple, readable, and lightweight
- Recent transactions should be easy to scan with amount, merchant, date, and category

Avoid:
- dense desktop dashboard layouts
- too many cards
- decorative blobs
- unreadable small numbers
```

## Prompt 3: Direction C

```
Generate a third mobile UI concept for the same app using a softer, more reassuring visual tone for people who dislike stressful finance tools.

Visual direction:
- Soft UI evolution
- Quiet, calm, reassuring
- Light surfaces and subtle shadows
- Clear hierarchy over decoration

Show:
1. First-run empty state home screen
2. Quick add sheet
3. Overspending state on the budget screen

Focus on:
- making budgeting feel approachable
- reducing cognitive load
- showing budget status without shame or warning overload
- making empty states feel useful rather than blank

Use real UI layout, not moodboard fragments.
```

## Prompt 4: Refined chosen direction

```
Take the strongest concept from the previous directions and refine it into a coherent mobile design system for the budgeting app.

Deliver:
- Home
- Quick Add
- Transactions
- Budget
- Insights
- Settings

Rules:
- iPhone viewport
- bottom nav
- floating or docked primary add action
- amount-first quick add
- calm clean visual tone
- trust-blue primary color
- green for healthy budget states
- red only for over-budget or destructive actions
- concise copy
- highly legible currency values

Include:
- typography scale
- spacing rhythm
- chip, button, list row, progress bar, and modal styles
- empty state treatment
- edit state for a transaction
```

## Prompt 5: Quick-add interaction study

```
Design the fastest possible quick-add flow for a mobile budgeting app.

Show a sequence of UI states:
1. Home with add action
2. Quick add opened as a bottom sheet
3. Amount entry state
4. Category selected state
5. Optional details expanded
6. Saved confirmation state

Design intent:
- one-handed use
- amount first
- save in 2-3 actions in the common case
- optional details should stay out of the way
- no cluttered form fields up front

Output should feel like a product interaction study, not just disconnected screens.
```

## Prompt 6: Edge-state study

```
Generate mobile UI states for a budgeting app covering key edge cases:
- no transactions yet
- near budget limit
- over budget
- search with no results
- install on iPhone help panel
- backup export/import section in settings

Keep everything in the same visual system:
- calm and clean
- mobile first
- minimal copy
- strong clarity
- no alarmist tone
```
