# Control Room parity implementation plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Replace the local Control Room prototype's placeholder and generic action drawers with action-specific, production-capable flows that preserve every current 3SM admin capability without rendering two default admin UIs.

**Architecture:** Keep `/admin-workspace-prototype` isolated and admin-gated. Use real read queries and a typed action router. Existing shell-less components may only be mounted inside their matching action panel during the bridge phase. Extract Track Intelligence, stewarding, and news editing into shell-less workspaces before they are incorporated. Every production mutation gets an explicit impact/confirmation state; no mutation is executed during automated verification.

**Tech stack:** React, TypeScript, TanStack Query, Supabase, existing 3SM RPCs/Edge Functions, Discord bot queue.

---

### Task 1: Establish a typed Control Room action model

**Objective:** Remove string-matching action routing and give every visible CTA one explicit action key and panel definition.

**Files:**
- Modify: `src/pages/AdminWorkspacePrototype.tsx`
- Create: `src/features/control-room/actionModel.ts`

**Requirements:**
- Action keys cover: season CRUD, season race edit, season registration/car lock, lobby, solo race CRUD, result import, team request review, team CRUD, role management, announcements, points, Track Intelligence sync/log/export, stewarding, and news editor.
- Each key defines title, production-impact level, role requirement, and panel component.
- Remove generic “Actie voorbereiden” placeholder behavior. An unavailable action must be visibly disabled before click.

**Verification:** `npx tsc --noEmit --pretty false && npm run lint`.

### Task 2: Build native season and race panels

**Objective:** Make Calendar, Registrations, Cars, Lobby, season CRUD, and solo races distinct new panels with real data and existing write semantics.

**Files:**
- Create: `src/features/control-room/season/*`
- Modify: `src/pages/AdminWorkspacePrototype.tsx`

**Requirements:**
- Use Amsterdam local date input / UTC writes and `TrackSelect` behavior.
- Preserve all league/race fields, car locks, lobby fields, solo races, and status values from `SeasonsAdmin`.
- Confirm destructive season/race deletion and summarize cascaded impact.
- Confirm multi-race car-lock actions.

### Task 3: Build native result import wizard

**Objective:** Move all of `ResultsImportAdmin` behavior into an action-specific new wizard without losing JSON/manual modes or downstream updates.

**Files:**
- Create: `src/features/control-room/results/*`
- Reuse: `src/lib/importHelpers.ts`

**Requirements:**
- Race selection, existing-result warning, JSON parsing, session previews, consistent profile matching, manual rows, points/fastest-lap preview.
- Final confirmation states all real side effects: result upsert, profile iRating/SR update, race completion, session replacement, penalties, 3SR, and unlocked car choices.

### Task 4: Build native community and role panels

**Objective:** Replace generic team/role drawers with focused native panels.

**Files:**
- Create: `src/features/control-room/community/*`

**Requirements:**
- Team request approval/denial, team CRUD/logo handling, team Discord automation status and destructive impact confirmation.
- Driver detail with actual role permission gates: super-admin only Admin/Steward; Admin or super-admin Editor; protected super-admin/self-delete rules.
- Actual success/error state only after RPC response.

### Task 5: Build native Discord communications and points panels

**Objective:** Preserve production queue and point configuration behavior in the new UI.

**Files:**
- Create: `src/features/control-room/communications/*`
- Create: `src/features/control-room/settings/*`

**Requirements:**
- Announcement composer uses exact tags/image payload and bot-compatible preview; queue status derives from real records.
- Team mention warnings and combined-tag color behavior are visible.
- Points config persists exact per-league position upserts; fastest-lap note remains non-configurable.

### Task 6: Extract specialist workspaces

**Objective:** Make Track Intelligence, Stewarding, and News Editor first-class areas without nested shells.

**Files:**
- Refactor: `src/pages/TrackIntelligenceTestPage.tsx`
- Refactor: `src/pages/StewardPage.tsx`
- Refactor: `src/pages/NewsEditorPage.tsx`
- Create: `src/features/control-room/specialist/*`

**Requirements:**
- Keep current routes working as guard/shell wrappers.
- Extract shell-less content components for Control Room use.
- Preserve role boundaries: Track Intelligence admin; stewardship admin/moderator; editorial admin/super-admin/editor.

### Task 7: Integration, permissions, and acceptance testing

**Objective:** Ensure the new workspace is the only default UI, has parity, and does not silently mutate in tests.

**Verification:**
- Auth matrix: admin, super-admin, steward, editor, unauthenticated.
- UI action inventory matches legacy inventory.
- Browser test after admin login for at least: season calendar, role panel, announcement composer, Track Intelligence filter/log.
- `npx tsc --noEmit --pretty false`
- `npm run lint`
- `npm run build`
- No push or deploy without explicit approval.
