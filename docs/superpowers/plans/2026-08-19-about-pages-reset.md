# About Pages Reset Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reset the slurry calculator's company, research center, and municipal division pages to the RockMass project's shared `ABOUT / NN` and `SECTION / NN` design while preserving the slurry calculator's product shell and municipal content.

**Architecture:** Add focused shell components for shared About design primitives, company/research rendering, and municipal rendering. `MainContent.tsx` keeps the existing view contract but delegates About rendering to the new lazy-loaded page; the old embedded About helpers and page body are then removed. Company and research content/assets come from `D:\软件\CINF_RockMass_Calculator`, while municipal content comes from the current app and is reorganized under the same page hierarchy.

**Tech Stack:** React 18, TypeScript, Vite 5, Tailwind CSS, react-katex, lucide-react, Vitest, Testing Library, jsdom.

---

## File Map

**Create**

- `frontend/vitest.config.ts`: component-test runner configuration.
- `frontend/src/test/setup.ts`: Testing Library DOM matchers.
- `frontend/src/components/BackIconButton.tsx`: shared icon-only return control.
- `frontend/src/components/shell/AboutDesignPrimitives.tsx`: shared `ABOUT / NN` Hero and `SECTION / NN` heading.
- `frontend/src/components/shell/AboutPage.tsx`: company/research page content and municipal dispatch.
- `frontend/src/components/shell/MunicipalAboutPage.tsx`: municipal content, carousel, lightbox, sections, and qualifications.
- `frontend/src/components/shell/__tests__/AboutDesignPrimitives.test.tsx`: title primitive contract.
- `frontend/src/components/shell/__tests__/AboutPage.test.tsx`: company/research content and numbering contract.
- `frontend/src/components/shell/__tests__/MunicipalAboutPage.test.tsx`: municipal content, numbering, and no-mining-content contract.

**Modify**

- `frontend/package.json`, `frontend/package-lock.json`: add test scripts/dependencies and `lucide-react`.
- `frontend/src/App.tsx`: update research preload paths and provide About return behavior.
- `frontend/src/components/MainContent.tsx`: delegate About rendering and delete embedded About-only helpers/state/body.
- `frontend/src/components/Sidebar.tsx`: order About links as company, research, municipal.
- `frontend/index.html`: update research image preload paths.

**Add assets**

- `frontend/public/about/cinf/*`: seven company images from the reference project.
- `frontend/public/about/rdc/*`: five full and five thumbnail research images from the reference project.
- `frontend/public/about/2/doc-image01.jpeg` through `doc-image20.jpeg`: current municipal assets under the unified path.

Do not touch the user's existing changes in `requirements.txt` or `requirements_win7.txt`.

### Task 1: Establish the Frontend Test Baseline

**Files:**

- Modify: `frontend/package.json`
- Modify: `frontend/package-lock.json`
- Create: `frontend/vitest.config.ts`
- Create: `frontend/src/test/setup.ts`

- [ ] **Step 1: Confirm the missing test command**

Run:

```powershell
Set-Location 'D:\软件\CINF_Flow_Calculator\frontend'
npm test
```

Expected: npm exits non-zero with `Missing script: "test"`.

- [ ] **Step 2: Add the exact test and typecheck scripts**

Update `frontend/package.json` scripts to include:

```json
"test": "vitest run",
"test:watch": "vitest",
"typecheck": "tsc --noEmit -p tsconfig.json"
```

Install the same component-test stack used by the reference project plus the icon package used by its About controls:

```powershell
npm install lucide-react@^1.31.0
npm install --save-dev vitest@^4.1.10 @testing-library/react@^16.3.2 @testing-library/jest-dom@^7.0.1 jsdom@^30.0.1
```

- [ ] **Step 3: Add the Vitest configuration**

Create `frontend/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
})
```

Create `frontend/src/test/setup.ts`:

```ts
import '@testing-library/jest-dom/vitest'
```

- [ ] **Step 4: Verify the empty test baseline and typecheck**

Run:

```powershell
npm test -- --passWithNoTests
npm run typecheck
```

Expected: Vitest exits 0 with no tests; TypeScript exits 0.

- [ ] **Step 5: Commit the test baseline**

```powershell
git add frontend/package.json frontend/package-lock.json frontend/vitest.config.ts frontend/src/test/setup.ts
git commit -m "test: add frontend component test baseline"
```

### Task 2: Build the Shared About Title System

**Files:**

- Create: `frontend/src/components/BackIconButton.tsx`
- Create: `frontend/src/components/shell/AboutDesignPrimitives.tsx`
- Create: `frontend/src/components/shell/__tests__/AboutDesignPrimitives.test.tsx`

- [ ] **Step 1: Write the failing title-system tests**

Create `frontend/src/components/shell/__tests__/AboutDesignPrimitives.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { AboutPageHero, AboutSectionHeading } from '../AboutDesignPrimitives'

describe('about design primitives', () => {
  it('renders the page number and all specialties', () => {
    render(
      <AboutPageHero
        darkMode={false}
        eyebrow="长沙有色冶金设计研究院有限公司 · 科研创新中心"
        title="科研创新中心"
        summary="统筹科技创新与成果转化，服务工程实践。"
        specialties={['创新平台', '成果转化', '标准与知识产权']}
        index="02"
      />,
    )

    expect(screen.getByText('ABOUT / 02')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '科研创新中心' })).toBeInTheDocument()
    expect(screen.getByText('创新平台')).toBeInTheDocument()
    expect(screen.getByText('成果转化')).toBeInTheDocument()
    expect(screen.getByText('标准与知识产权')).toBeInTheDocument()
  })

  it('renders the section number and supporting context', () => {
    render(
      <AboutSectionHeading
        darkMode={false}
        index="01"
        eyebrow="创新平台"
        title="面向工程实践的科研体系"
        description="从需求识别到成果应用，形成完整技术闭环。"
        aside="5个省级平台"
      />,
    )

    expect(screen.getByText('SECTION / 01')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '面向工程实践的科研体系' })).toBeInTheDocument()
    expect(screen.getByText('5个省级平台')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```powershell
npm test -- AboutDesignPrimitives.test.tsx
```

Expected: FAIL because `../AboutDesignPrimitives` does not exist.

- [ ] **Step 3: Add the shared primitives and back control**

Create `frontend/src/components/BackIconButton.tsx` with the reference component's exact API, placing the import first:

```tsx
import { ArrowLeft } from 'lucide-react'

interface BackIconButtonProps {
  label: string
  onClick?: () => void
  darkMode: boolean
  className?: string
}

export default function BackIconButton({ label, onClick, darkMode, className = '' }: BackIconButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={`inline-flex h-8 w-8 items-center justify-center rounded transition-colors ${
        darkMode ? 'text-gray-200 hover:bg-gray-700' : 'text-slate-700 hover:bg-gray-100'
      } ${className}`}
      onClick={onClick}
    >
      <ArrowLeft aria-hidden="true" className="h-5 w-5" strokeWidth={2.25} />
    </button>
  )
}
```

Create `frontend/src/components/shell/AboutDesignPrimitives.tsx` by transferring the complete reference implementation from `D:\软件\CINF_RockMass_Calculator\frontend\src\components\shell\AboutDesignPrimitives.tsx` unchanged. It must export exactly:

```ts
export function AboutPageHero(props: AboutPageHeroProps): JSX.Element
export function AboutSectionHeading(props: AboutSectionHeadingProps): JSX.Element
```

Keep the reference structure: a top `ABOUT / {index}` band in `AboutPageHero`, and `SECTION / {index}` plus optional description/aside in `AboutSectionHeading`.

- [ ] **Step 4: Run the focused test**

```powershell
npm test -- AboutDesignPrimitives.test.tsx
```

Expected: 2 tests PASS.

- [ ] **Step 5: Commit the title system**

```powershell
git add frontend/src/components/BackIconButton.tsx frontend/src/components/shell/AboutDesignPrimitives.tsx frontend/src/components/shell/__tests__/AboutDesignPrimitives.test.tsx
git commit -m "feat: add shared about page title system"
```

### Task 3: Migrate and Verify About Assets

**Files:**

- Add: `frontend/public/about/cinf/*`
- Add: `frontend/public/about/rdc/*`
- Add: `frontend/public/about/2/doc-image01.jpeg` through `doc-image20.jpeg`
- Modify: `frontend/index.html`
- Modify: `frontend/src/App.tsx:104-120`

- [ ] **Step 1: Prove the target asset structure is absent**

Run:

```powershell
$targets = @(
  'frontend/public/about/cinf/pic1.png',
  'frontend/public/about/cinf/pic3.jpg',
  'frontend/public/about/rdc/info1-thumb.jpg',
  'frontend/public/about/rdc/info5.jpg',
  'frontend/public/about/2/doc-image01.jpeg',
  'frontend/public/about/2/doc-image20.jpeg'
)
$targets | ForEach-Object { "$_ = $(Test-Path -LiteralPath $_)" }
```

Expected: every target reports `False`.

- [ ] **Step 2: Copy the exact approved assets**

Copy company, research, and municipal assets with this bounded PowerShell script. It resolves and validates every destination before writing and does not delete the original files:

```powershell
$aboutRoot = [System.IO.Path]::GetFullPath('D:\软件\CINF_Flow_Calculator\frontend\public\about')
$copyGroups = @(
  @{
    Source = 'D:\软件\CINF_RockMass_Calculator\frontend\public\about\cinf'
    Destination = 'D:\软件\CINF_Flow_Calculator\frontend\public\about\cinf'
    Filter = '*'
  },
  @{
    Source = 'D:\软件\CINF_RockMass_Calculator\frontend\public\about\rdc'
    Destination = 'D:\软件\CINF_Flow_Calculator\frontend\public\about\rdc'
    Filter = '*'
  },
  @{
    Source = 'D:\软件\CINF_Flow_Calculator\frontend\public\municipal'
    Destination = 'D:\软件\CINF_Flow_Calculator\frontend\public\about\2'
    Filter = 'doc-image*.jpeg'
  }
)

foreach ($group in $copyGroups) {
  $resolvedDestination = [System.IO.Path]::GetFullPath($group.Destination)
  if (-not $resolvedDestination.StartsWith($aboutRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Destination escapes About asset root: $resolvedDestination"
  }
  New-Item -ItemType Directory -Force -Path $resolvedDestination | Out-Null
  Get-ChildItem -LiteralPath $group.Source -Filter $group.Filter -File | ForEach-Object {
    $destinationFile = [System.IO.Path]::GetFullPath((Join-Path $resolvedDestination $_.Name))
    if (-not $destinationFile.StartsWith($aboutRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
      throw "Destination escapes About asset root: $destinationFile"
    }
    Copy-Item -LiteralPath $_.FullName -Destination $destinationFile
  }
}
```

- [ ] **Step 3: Update preload URLs**

In `frontend/index.html`, replace `/infoN-thumb.jpg` with `./about/rdc/infoN-thumb.jpg` for N = 1..5.

In `frontend/src/App.tsx`, set the preload arrays to:

```ts
const RESEARCH_PLATFORM_THUMB_URLS = [
  './about/rdc/info1-thumb.jpg',
  './about/rdc/info2-thumb.jpg',
  './about/rdc/info3-thumb.jpg',
  './about/rdc/info4-thumb.jpg',
  './about/rdc/info5-thumb.jpg',
] as const
const RESEARCH_PLATFORM_FULL_URLS = [
  './about/rdc/info1.jpg',
  './about/rdc/info2.jpg',
  './about/rdc/info3.jpg',
  './about/rdc/info4.jpg',
  './about/rdc/info5.jpg',
] as const
```

- [ ] **Step 4: Verify file counts and hashes**

Run:

```powershell
(Get-ChildItem frontend/public/about/cinf -File).Count
(Get-ChildItem frontend/public/about/rdc -File).Count
(Get-ChildItem frontend/public/about/2 -Filter 'doc-image*.jpeg' -File).Count
Compare-Object `
  (Get-ChildItem 'D:\软件\CINF_RockMass_Calculator\frontend\public\about\rdc' -File | Get-FileHash | Select-Object -ExpandProperty Hash | Sort-Object) `
  (Get-ChildItem 'frontend/public/about/rdc' -File | Get-FileHash | Select-Object -ExpandProperty Hash | Sort-Object)
```

Expected: counts are 7, 10, and 20; `Compare-Object` produces no output.

- [ ] **Step 5: Commit the asset migration**

```powershell
git add frontend/public/about frontend/index.html frontend/src/App.tsx
git commit -m "assets: organize company research and municipal media"
```

### Task 4: Migrate the Company and Research Pages

**Files:**

- Create: `frontend/src/components/shell/AboutPage.tsx`
- Create: `frontend/src/components/shell/__tests__/AboutPage.test.tsx`

- [ ] **Step 1: Write failing company/research page tests**

Create `frontend/src/components/shell/__tests__/AboutPage.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import AboutPage from '../AboutPage'

describe('AboutPage', () => {
  it('renders the copied company page as ABOUT 01', () => {
    render(<AboutPage darkMode={false} language="zh" aboutDepartment="cinf" />)

    expect(screen.getByText('ABOUT / 01')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '有色金属全产业链技术与服务提供商' })).toBeInTheDocument()
    expect(screen.getByText('SECTION / 01')).toBeInTheDocument()
    expect(screen.getByText('SECTION / 02')).toBeInTheDocument()
  })

  it('renders the copied research page as ABOUT 02 with five platforms', () => {
    render(<AboutPage darkMode={false} language="zh" aboutDepartment="research" />)

    expect(screen.getByText('ABOUT / 02')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '科研创新中心' })).toBeInTheDocument()
    expect(screen.getAllByText(/PLATFORM \/ 0[1-5]/)).toHaveLength(5)
    expect(screen.getByText('湖南省有色冶金智能制造工程技术研究中心')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run the focused test and verify it fails**

```powershell
npm test -- AboutPage.test.tsx
```

Expected: FAIL because `../AboutPage` does not exist.

- [ ] **Step 3: Create the focused About page**

Use `D:\软件\CINF_RockMass_Calculator\frontend\src\components\shell\AboutPage.tsx` as the authoritative source for the company and research branches, with these exact adaptations:

```ts
import { useEffect, useState } from 'react'
import {
  APP_TAGLINE_MAIN_EN,
  APP_TAGLINE_ZH,
  APP_TITLE_MAIN_EN,
  APP_TITLE_MAIN_ZH,
} from '../../constants/appCopy'
import BackIconButton from '../BackIconButton'
import { AboutPageHero, AboutSectionHeading } from './AboutDesignPrimitives'
```

Derive the shell copy without adding new app-copy helpers:

```ts
const appTitle = language === 'en' ? APP_TITLE_MAIN_EN : APP_TITLE_MAIN_ZH
const appSubtitle = language === 'en' ? APP_TAGLINE_MAIN_EN : APP_TAGLINE_ZH
```

Keep the reference `researchThumbFromFull`, research loading/fallback state, company branch, research branch, image paths under `./about/cinf` and `./about/rdc`, and the shared Hero/section primitives. Remove all reference-only `mining`, `mining-legacy`, `caseStudies`, `departmentNames`, `selectedCase`, municipal carousel, and legacy fallback-page code.

End routing with the exact behavior for this independently compiling task:

```tsx
return null
```

Task 5 adds the municipal import and dispatch after the municipal component exists. Stage only `AboutPage.tsx` and its test in this task.

- [ ] **Step 4: Run the focused test**

```powershell
npm test -- AboutPage.test.tsx
```

Expected: 2 tests PASS.

- [ ] **Step 5: Commit company/research pages**

```powershell
git add frontend/src/components/shell/AboutPage.tsx frontend/src/components/shell/__tests__/AboutPage.test.tsx
git commit -m "feat: migrate company and research about pages"
```

### Task 5: Replace the Reference Division with Municipal Content

**Files:**

- Create: `frontend/src/components/shell/MunicipalAboutPage.tsx`
- Create: `frontend/src/components/shell/__tests__/MunicipalAboutPage.test.tsx`
- Modify: `frontend/src/components/shell/AboutPage.tsx`

- [ ] **Step 1: Write the failing municipal page tests**

Create `frontend/src/components/shell/__tests__/MunicipalAboutPage.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import AboutPage from '../AboutPage'

describe('municipal About page', () => {
  it('uses ABOUT 03 and the four-section municipal hierarchy', () => {
    render(<AboutPage darkMode={false} language="zh" aboutDepartment="municipal" />)

    expect(screen.getByText('ABOUT / 03')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '市政工程' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '技术体系与标准建设' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '工业废水治理' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '市政污水与矿浆输送' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '代表性工程与专业资质' })).toBeInTheDocument()
    expect(screen.getAllByText(/SECTION \/ 0[1-4]/)).toHaveLength(4)
  })

  it('does not leak reference mining-division content', () => {
    render(<AboutPage darkMode={false} language="zh" aboutDepartment="municipal" />)

    expect(screen.queryByText('矿山事业部')).not.toBeInTheDocument()
    expect(screen.queryByText('攻克矿山工程的“高、深、难、绿”')).not.toBeInTheDocument()
    expect(screen.getByText('《浆体长距离管道输送工程设计标准》')).toBeInTheDocument()
    expect(screen.getByText('市政行业甲级')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run the focused test and verify it fails**

```powershell
npm test -- MunicipalAboutPage.test.tsx
```

Expected: FAIL because `AboutPage` currently returns `null` for `aboutDepartment="municipal"`.

- [ ] **Step 3: Implement `MunicipalAboutPage` with the approved hierarchy**

Define the exact public interface:

```ts
export interface MunicipalAboutPageProps {
  darkMode: boolean
  language: 'zh' | 'en'
  appTitle: string
  appSubtitle: string
  onBackToHome?: () => void
}
```

Import the completed component in `AboutPage.tsx`:

```ts
import MunicipalAboutPage from './MunicipalAboutPage'
```

Replace the final `return null` with municipal dispatch followed by the safe unknown-department fallback:

```tsx
if (aboutDepartment === 'municipal') {
  return (
    <MunicipalAboutPage
      darkMode={darkMode}
      language={language}
      appTitle={appTitle}
      appSubtitle={appSubtitle}
      onBackToHome={onBackToHome}
    />
  )
}

return null
```

Transfer these helpers from the current `MainContent.tsx` into the new file and update `municipalDocSrc`:

```ts
type MunicipalHandbookSpec = { n: number; title: string }

function municipalDocSrc(n: number): string {
  return `./about/2/doc-image${String(n).padStart(2, '0')}.jpeg`
}
```

Move `MunicipalImageLightbox` and `MunicipalHandbookCarousel` without changing their Escape handling, auto-rotation, pause-on-hover, or click-to-enlarge behavior. Use `X` from `lucide-react` for the lightbox close button.

Build the page in this exact order:

```tsx
<AboutPageHero
  darkMode={darkMode}
  index="03"
  eyebrow="长沙有色院 · 市政事业部"
  title="市政工程"
  summary="长沙有色院在采选废水、冶炼废水、市政污水处理与长距离矿浆输送领域形成了从技术研发、咨询设计到工程总承包的完整服务能力。"
  specialties={['工程咨询', '工程设计', 'EPC总承包', '科研与技术开发']}
>
  {/* handbook carousel using documents 1, 2, and 3 */}
</AboutPageHero>
```

Immediately after the Hero, render the supported facts only:

```ts
const municipalStats = [
  ['4类', '核心业务方向'],
  ['3项', '主持编制标准'],
  ['EPC', '全过程工程服务'],
  ['甲级', '市政行业资质'],
] as const
```

Use four `AboutSectionHeading` components with the exact headings asserted by the test:

```tsx
<AboutSectionHeading
  darkMode={darkMode}
  index="01"
  eyebrow="技术与标准"
  title="技术体系与标准建设"
  description="围绕废水治理与浆体输送持续开展技术研发、标准编制和工程转化。"
  aside="3项主持编制标准"
/>
<AboutSectionHeading
  darkMode={darkMode}
  index="02"
  eyebrow="工业废水"
  title="工业废水治理"
  description="覆盖采选废水、冶炼废水、高盐废水与资源化回用。"
/>
<AboutSectionHeading
  darkMode={darkMode}
  index="03"
  eyebrow="基础设施"
  title="市政污水与矿浆输送"
  description="形成市政污水处理与高浓度长距离浆体输送两类成套能力。"
/>
<AboutSectionHeading
  darkMode={darkMode}
  index="04"
  eyebrow="业绩与资质"
  title="代表性工程与专业资质"
  description="以全过程咨询设计和多专业协同支撑工程建设与持续运营。"
  aside="市政行业甲级"
/>
```

Move the current four evidence blocks without changing their engineering values or project names:

- 采选废水 uses `doc-image04.jpeg`.
- 冶炼废水 uses `doc-image08.jpeg`.
- 市政污水 uses `doc-image12.jpeg`.
- 矿浆输送 uses `doc-image16.jpeg`.

Place the current qualification copy and tags in Section 04. Do not copy any content, people, statistics, or images from the reference `MiningAboutPage.tsx`.

- [ ] **Step 4: Run municipal and all About tests**

```powershell
npm test -- MunicipalAboutPage.test.tsx AboutPage.test.tsx AboutDesignPrimitives.test.tsx
```

Expected: 6 tests PASS.

- [ ] **Step 5: Commit the municipal page**

```powershell
git add frontend/src/components/shell/MunicipalAboutPage.tsx frontend/src/components/shell/AboutPage.tsx frontend/src/components/shell/__tests__/MunicipalAboutPage.test.tsx
git commit -m "feat: add municipal division about page"
```

### Task 6: Integrate the New Pages and Remove Embedded About Code

**Files:**

- Modify: `frontend/src/components/MainContent.tsx:1,4465-4658,4660-4685,4762-4770,5040-5052,5483-5486,7065-7890,9507-9509`
- Modify: `frontend/src/App.tsx:290-305,394-405`
- Modify: `frontend/src/components/Sidebar.tsx:382-424`

- [ ] **Step 1: Capture the old embedded-code evidence**

Run:

```powershell
rg -n "renderAboutPage|MunicipalHandbookCarousel|MunicipalImageLightbox|researchThumbFromFull|aboutDepartment === 'municipal'" frontend/src/components/MainContent.tsx
```

Expected: matches in the helper block, About-only state/effects, `renderAboutPage`, and final About branch.

- [ ] **Step 2: Add lazy delegation and return behavior**

Extend the React import in `MainContent.tsx` with `lazy` and `Suspense`, then declare:

```ts
const AboutPage = lazy(() => import('./shell/AboutPage'))
```

Add to `MainContentProps` and component destructuring:

```ts
onBackToHome?: () => void
```

Replace the existing About return branch with:

```tsx
if (currentView === 'about' && aboutDepartment) {
  return (
    <Suspense
      fallback={
        <div className={`flex flex-1 items-center justify-center ${darkMode ? 'bg-gray-800 text-gray-400' : 'bg-gray-50 text-gray-500'}`}>
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" aria-label="页面加载中" />
        </div>
      }
    >
      <AboutPage
        darkMode={darkMode}
        language={language}
        aboutDepartment={aboutDepartment}
        onBackToHome={onBackToHome}
      />
    </Suspense>
  )
}
```

In `App.tsx`, add:

```ts
const handleBackToHome = () => {
  setCurrentView('formula')
  setAboutDepartment(null)
}
```

and pass `onBackToHome={handleBackToHome}` to `MainContent`.

- [ ] **Step 3: Remove only the old About implementation**

Delete from `MainContent.tsx`:

- `MunicipalHandbookSpec`, `municipalDocSrc`, `researchThumbFromFull`, `MunicipalImageLightbox`, and `MunicipalHandbookCarousel`.
- `municipalLightbox`, `zoomPlatformImageUrl`, `researchZoomLightboxReady`, `researchThumbFallbackByKey`, and `researchPlatformImageLoadedByKey` state.
- effects whose only dependencies are the removed About state.
- the entire `renderAboutPage` function from its declaration through its closing brace immediately before the next non-About renderer.

Retain `renderAppHeader`, all calculation state, and `renderSettingsPage`.

- [ ] **Step 4: Reorder the sidebar to match page numbering**

In `Sidebar.tsx`, keep the company button first, move the research button second, and municipal button third. Do not change their state keys:

```text
cinf -> ABOUT / 01
research -> ABOUT / 02
municipal -> ABOUT / 03
```

- [ ] **Step 5: Verify old code is absent and the project compiles**

Run:

```powershell
rg -n "renderAboutPage|MunicipalHandbookCarousel|MunicipalImageLightbox|aboutDepartment === 'municipal'" frontend/src/components/MainContent.tsx
npm run typecheck
npm test
npm run build
```

Expected: `rg` has no matches; TypeScript exits 0; all tests pass; Vite build exits 0.

- [ ] **Step 6: Commit integration and cleanup**

```powershell
git add frontend/src/App.tsx frontend/src/components/MainContent.tsx frontend/src/components/Sidebar.tsx
git commit -m "refactor: delegate about pages from main content"
```

### Task 7: Browser and Packaged-Path Verification

**Files:**

- Modify only files required by discovered defects.

- [ ] **Step 1: Start the frontend server**

Run from `frontend`:

```powershell
npx vite --host 127.0.0.1 --port 5173
```

Expected: Vite reports `http://127.0.0.1:5173/`.

- [ ] **Step 2: Verify all three routes at desktop width**

Using the in-app Browser, open the local app and click the three sidebar buttons in order. For each page capture a fresh DOM snapshot and screenshot.

Expected authoritative signals:

```text
Company:  ABOUT / 01, 有色金属全产业链技术与服务提供商, SECTION / 01, SECTION / 02
Research: ABOUT / 02, 科研创新中心, PLATFORM / 01 through PLATFORM / 05
Municipal: ABOUT / 03, 市政工程, SECTION / 01 through SECTION / 04
```

Confirm the municipal DOM contains neither `矿山事业部` nor `攻克矿山工程的“高、深、难、绿”`.

- [ ] **Step 3: Verify interaction and responsive layout**

At desktop width:

- Open and close one research platform image.
- Advance the municipal handbook carousel once.
- Open and close one municipal project image.
- Confirm Escape closes both lightboxes.

At a mobile viewport near 390 x 844:

- Check each Hero stacks to one column.
- Check headings and buttons stay inside their containers.
- Check no text overlaps the sidebar/mobile shell, images, or following sections.

Reset the temporary viewport override after the checks.

- [ ] **Step 4: Inspect console and asset responses**

Read browser console errors after visiting all pages. Expected: no new React errors, missing-module errors, or image 404s. Inspect the DOM image `src` values and confirm they begin with:

```text
./about/cinf/
./about/rdc/
./about/2/
```

- [ ] **Step 5: Run final verification from a clean command invocation**

```powershell
Set-Location 'D:\软件\CINF_Flow_Calculator\frontend'
npm run typecheck
npm test
npm run build
Set-Location '..'
git diff --check
git status --short
```

Expected: typecheck, tests, build, and diff check all exit 0. `git status --short` may show the user's pre-existing `requirements.txt` and `requirements_win7.txt` modifications, but no unintended generated files.

- [ ] **Step 6: Commit any QA-only fixes**

If QA required code changes, stage only those files and commit:

```powershell
git commit -m "fix: polish responsive about page layout"
```

If no QA fixes were needed, do not create an empty commit.
