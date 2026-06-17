---
name: mobile-responsive-testing
description: Use when verifying responsive/mobile layouts — after implementing UI features, fixing responsive layout bugs, before deploying frontend changes, during QA, or when a user reports mobile issues (content cut off, horizontal scroll, tiny touch targets, broken modals/forms on phones).
---

# Mobile Responsive Testing

## Overview

Thorough mobile responsiveness testing: scroll through entire pages, capture screenshots at multiple breakpoints, and verify touch interactions. Catches layout issues, usability problems, and responsive bugs that desktop-only testing misses.

## When to Use

- After implementing UI features
- After fixing responsive layout bugs
- Before deploying frontend changes
- During comprehensive QA validation
- When a user reports mobile issues

## What This Skill Does

### 1. Multi-Breakpoint Testing

Tests at ALL standard breakpoints:

| Name | Size | Device |
|------|------|--------|
| Mobile Portrait | 375 × 667 | iPhone SE |
| Mobile Portrait Large | 414 × 896 | iPhone 11 Pro |
| Mobile Landscape | 667 × 375 | — |
| Tablet Portrait | 768 × 1024 | iPad |
| Tablet Landscape | 1024 × 768 | iPad |
| Small Desktop | 1280 × 720 | — |
| Large Desktop | 1920 × 1080 | — |

### 2. Comprehensive Scrolling

For EACH breakpoint:
- Scroll to top of page
- Take screenshot of viewport
- Scroll down by viewport height
- Take screenshot
- Repeat until bottom of page
- Verify no horizontal scrolling
- Check all content is accessible

### 3. Touch Target Verification

Validates mobile usability:
- All buttons minimum 44px × 44px
- Adequate spacing between tappable elements (8px minimum)
- No overlapping interactive elements
- Touch targets not too close to screen edges

### 4. Visual Verification

Captures evidence of:
- Layout at each breakpoint
- Component stacking on mobile
- Text readability without zooming
- Image scaling and aspect ratios
- Modal/dialog behavior on small screens
- Navigation menu responsiveness

### 5. Scroll Behavior Testing

Verifies smooth scrolling:
- No janky animations
- Sticky headers work correctly
- Infinite scroll (if applicable)
- Pull-to-refresh doesn't interfere
- Scroll position maintained on navigation

## Available Playwright MCP Tools

- `mcp__playwright__browser_navigate` — Navigate to page
- `mcp__playwright__browser_resize` — Change viewport size **(CRITICAL FOR THIS SKILL)**
- `mcp__playwright__browser_take_screenshot` — Capture visual state **(USE EXTENSIVELY)**
- `mcp__playwright__browser_evaluate` — Run JavaScript to scroll and measure
- `mcp__playwright__browser_snapshot` — Get page accessibility tree
- `mcp__playwright__browser_scroll` — Scroll programmatically
- `mcp__playwright__browser_wait_for` — Wait for scroll completion
- `mcp__playwright__browser_close` — Close browser when done

> Requires a Playwright MCP server connected to the session. If these tools are
> unavailable, the same workflow runs via a local Playwright script
> (`tests/` + `playwright.config.js` already exist in this repo).

## Testing Workflow

### Step 1: Initialize Browser

```
mcp__playwright__browser_navigate(url)
```

### Step 2: Test Each Breakpoint

For each breakpoint (375, 414, 768, 1024, 1280, 1920):

```js
// Resize to breakpoint
mcp__playwright__browser_resize(width, height)

// Wait for layout to settle
mcp__playwright__browser_wait_for(selector: "body", state: "stable")

// Get page height
const pageHeight = await mcp__playwright__browser_evaluate(`
  document.documentElement.scrollHeight
`)

// Get viewport height
const viewportHeight = await mcp__playwright__browser_evaluate(`
  window.innerHeight
`)

// Calculate number of screenshots needed
const numScreenshots = Math.ceil(pageHeight / viewportHeight)

// Scroll and screenshot
for (let i = 0; i < numScreenshots; i++) {
  await mcp__playwright__browser_evaluate(`window.scrollTo(0, ${i * viewportHeight})`)
  await mcp__playwright__browser_wait_for(timeout: 500)
  await mcp__playwright__browser_take_screenshot(filename: `${breakpoint}_scroll_${i}.png`)

  // Check for horizontal scroll (BAD!)
  const hasHorizontalScroll = await mcp__playwright__browser_evaluate(`
    document.documentElement.scrollWidth > window.innerWidth
  `)
  if (hasHorizontalScroll) {
    console.error(`Horizontal scroll detected at ${breakpoint}px`)
  }
}
```

### Step 3: Test Touch Targets (Mobile Only, < 768px)

```js
const touchTargets = await mcp__playwright__browser_evaluate(`
  const elements = document.querySelectorAll('button, a, input, select, textarea, [role="button"]')
  Array.from(elements).map(el => {
    const rect = el.getBoundingClientRect()
    return { tag: el.tagName, text: el.textContent?.substring(0, 20),
             width: rect.width, height: rect.height, x: rect.x, y: rect.y }
  })
`)

touchTargets.forEach(target => {
  if (target.width < 44 || target.height < 44) {
    console.error(`Touch target too small: ${target.tag} "${target.text}" is ${target.width}x${target.height}px (min 44x44px)`)
  }
})
```

### Step 4: Test Navigation Responsiveness

```js
if (viewport.width < 768) {
  const hasMobileMenu = await mcp__playwright__browser_evaluate(`
    const hamburger = document.querySelector('[aria-label*="menu"], .mobile-menu, .hamburger')
    hamburger !== null
  `)
  if (!hasMobileMenu) console.warn('No mobile menu found on mobile viewport')
}
```

### Step 5: Test Form Layouts

```js
if (viewport.width < 768) {
  const formLayouts = await mcp__playwright__browser_evaluate(`
    const forms = document.querySelectorAll('form')
    Array.from(forms).map(form => {
      const inputs = form.querySelectorAll('input, select, textarea')
      const positions = Array.from(inputs).map(input => input.getBoundingClientRect().left)
      const uniqueColumns = [...new Set(positions)].length
      return { formId: form.id || 'unknown', columns: uniqueColumns }
    })
  `)
  formLayouts.forEach(layout => {
    if (layout.columns > 1) {
      console.error(`Form "${layout.formId}" has ${layout.columns} columns on mobile (should be 1)`)
    }
  })
}
```

### Step 6: Generate Report

```js
const report = {
  breakpoints_tested: ['375px', '414px', '768px', '1024px', '1280px', '1920px'],
  screenshots_captured: totalScreenshots,
  horizontal_scroll_issues: horizontalScrollIssues,
  touch_target_violations: touchTargetViolations,
  layout_issues: layoutIssues,
  status: issues.length === 0 ? 'PASS' : 'FAIL'
}
```

## Docker IP Configuration

**IMPORTANT:** When testing against Docker containers, use the container IP address, NOT localhost.

```bash
# Get the container IP
docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' {container_name}
```

```
# Instead of:
mcp__playwright__browser_navigate("http://localhost:3003")
# Use:
mcp__playwright__browser_navigate("http://172.18.0.5:80")
```

## Expected Inputs

- URL to test (Docker IP address if using containers)
- Page/feature to test
- Specific breakpoints (or use all standard ones)

## Deliverables

- Screenshot for each breakpoint at each scroll position
- List of horizontal scroll violations
- List of touch target violations (< 44px)
- Form layout issues on mobile
- Navigation responsiveness issues
- Overall PASS/FAIL status
- Detailed report with recommendations

## Example: Complete Mobile Testing Flow

```js
const url = "http://172.18.0.5:80/schedules"   // Docker IP
mcp__playwright__browser_navigate(url)

const breakpoints = [
  { name: 'mobile_portrait', width: 375, height: 667 },
  { name: 'mobile_large',    width: 414, height: 896 },
  { name: 'tablet_portrait', width: 768, height: 1024 },
  { name: 'desktop',         width: 1280, height: 720 },
  { name: 'desktop_large',   width: 1920, height: 1080 }
]

for (const breakpoint of breakpoints) {
  console.log(`Testing ${breakpoint.name} (${breakpoint.width}x${breakpoint.height})`)
  mcp__playwright__browser_resize(breakpoint.width, breakpoint.height)

  const dimensions = await mcp__playwright__browser_evaluate(`({
    pageHeight: document.documentElement.scrollHeight,
    pageWidth: document.documentElement.scrollWidth,
    viewportHeight: window.innerHeight,
    viewportWidth: window.innerWidth
  })`)

  if (dimensions.pageWidth > dimensions.viewportWidth) {
    console.error(`❌ FAIL: Horizontal scroll at ${breakpoint.name}`)
    console.error(`   Page width: ${dimensions.pageWidth}px, Viewport: ${dimensions.viewportWidth}px`)
  }

  const scrollPositions = Math.ceil(dimensions.pageHeight / dimensions.viewportHeight)
  for (let i = 0; i < scrollPositions; i++) {
    const scrollY = i * dimensions.viewportHeight
    await mcp__playwright__browser_evaluate(`window.scrollTo(0, ${scrollY})`)
    await mcp__playwright__browser_wait_for(timeout: 300)
    await mcp__playwright__browser_take_screenshot(filename: `${breakpoint.name}_scroll_${i}_y${scrollY}.png`)
    console.log(`  📸 ${breakpoint.name}_scroll_${i}.png (y: ${scrollY}px)`)
  }

  if (breakpoint.width < 768) {
    const touchIssues = await mcp__playwright__browser_evaluate(`
      const buttons = document.querySelectorAll('button, a[role="button"], [onclick]')
      const issues = []
      buttons.forEach((btn) => {
        const rect = btn.getBoundingClientRect()
        if (rect.width < 44 || rect.height < 44) {
          issues.push({
            element: btn.tagName + (btn.textContent ? ': ' + btn.textContent.substring(0, 20) : ''),
            size: \`\${Math.round(rect.width)}x\${Math.round(rect.height)}px\`
          })
        }
      })
      issues
    `)
    if (touchIssues.length > 0) {
      console.error(`❌ Touch target violations at ${breakpoint.name}:`)
      touchIssues.forEach(issue => console.error(`   - ${issue.element}: ${issue.size} (min 44x44px)`))
    } else {
      console.log(`✅ All touch targets meet 44px minimum`)
    }
  }

  await mcp__playwright__browser_evaluate(`window.scrollTo(0, 0)`)
}

mcp__playwright__browser_close()
console.log('Mobile responsive testing complete!')
```

## Validation Checklist

### Layout
- [ ] No horizontal scrolling at any breakpoint
- [ ] All content visible without zooming
- [ ] Images scale proportionally
- [ ] Text remains readable (min 16px on mobile)
- [ ] No content cut off at edges

### Touch Interactions (Mobile < 768px)
- [ ] All buttons/links minimum 44×44px
- [ ] Adequate spacing between touch targets (8px)
- [ ] No overlapping interactive elements
- [ ] Touch targets not at extreme screen edges

### Navigation
- [ ] Mobile menu appears on small screens (< 768px)
- [ ] Desktop navigation on large screens (>= 1024px)
- [ ] Menu items all accessible
- [ ] Deep linking works at all sizes

### Forms
- [ ] Single column layout on mobile
- [ ] Multi-column on desktop
- [ ] Input fields large enough to tap (44px height)
- [ ] Keyboard doesn't obscure inputs on mobile

### Content
- [ ] Grid layouts adapt per breakpoint
- [ ] Tables convert to cards/stacked layout on mobile
- [ ] Modals/dialogs fit mobile screens
- [ ] No content hidden or inaccessible

## Common Issues Detected

### Horizontal Scroll on Mobile
**Detected:** Page width > viewport width.
**Common causes:** Fixed-width elements (`width: 1200px`); images without `max-width: 100%`; long unbreakable text (URLs); negative margins breaking out of container.

### Touch Targets Too Small
**Detected:** Button/link < 44×44px on mobile.
**Common causes:** Desktop-sized buttons on mobile; icon-only buttons without padding; links inline in text.

### Content Cut Off
**Detected:** Elements positioned outside viewport.
**Common causes:** Absolute positioning without responsive values; fixed positioning without mobile adjustments; `overflow: hidden` cutting off content; **`vh`-based modal sizing that ignores mobile browser chrome** (use `dvh`).

### Forms Not Mobile-Friendly
**Detected:** Multi-column form on mobile.
**Common causes:** CSS Grid not responsive; Flexbox not wrapping on mobile; fixed columns in form layout.

## Integration with QA Agents

A QA frontend agent should ALWAYS use this skill to:
- Test all breakpoints (not just desktop)
- Scroll through the entire page at each breakpoint
- Capture screenshots as evidence
- Verify touch targets on mobile
- Check for horizontal scrolling
- Validate form layouts
