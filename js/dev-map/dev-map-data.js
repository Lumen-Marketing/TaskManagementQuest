export const DEV_MAP_ANNOTATIONS = [
  {
    id: "lifecycle-rail",
    target: "#questLeftZone",
    status: "LOCK",
    title: "Lifecycle Rail",
    author: "Alexia",
    body: "Approved spatial contract. Do not resize or restructure this rail.",
    files: ["css/quest-composition.css"],
    acceptance: [
      "Lifecycle geometry remains unchanged",
      "Active phase remains the source of truth",
    ],
  },
  {
    id: "active-canvas",
    target: "#questCoreZone",
    status: "BUILD",
    title: "Active Canvas",
    body: "Primary implementation zone for phase-specific operational work.",
    files: ["css/quest-composition.css"],
    acceptance: [
      "Phase content stays inside the active canvas",
      "Shell geometry remains intact",
    ],
  },
  {
    id: "sidecar",
    target: "#questRightZone",
    status: "CHECK",
    title: "Context Sidecar",
    body: "Contextual support only. Do not turn this into a second independent application.",
    files: ["css/quest-composition.css"],
    acceptance: [
      "Tracks active lifecycle phase",
      "Does not independently control routing",
    ],
  },
  {
    id: "query",
    target: '[data-phase="query"], #questQueryView',
    phase: "query",
    status: "BUILD",
    title: "Query Workspace",
    body: "Complete the operational intake flow here.",
    files: ["js/quest-query.js", "css/quest-query.css"],
    acceptance: [
      "Input persists correctly",
      "Ownership is visible",
      "Downstream work can be created",
    ],
  },
  {
    id: "relay",
    target: "#questRelay, [data-quest-relay]",
    status: "LOCK",
    title: "Relay",
    author: "Alexia",
    body: "Persistent system communication layer. Preserve its spatial baseline and intent.",
    acceptance: [
      "Relay remains available across phases",
      "Position does not shift between views",
    ],
  },
  {
    id: "session",
    target: "#questUserArea, [data-user-session]",
    status: "CHECK",
    title: "User / Session",
    body: "Verify signed-in user identity and session presentation.",
    acceptance: [
      "Correct user is shown",
      "Session state is visually clear",
    ],
  },
  {
    id: "negative-space",
    target: "#questCoreZone",
    status: "LOCK",
    title: "Intentional Space",
    author: "Alexia",
    body: "The open space here is intentional. Do not fill it simply because space exists.",
  },
];

export const DEV_MAP_TOUR = [
  "lifecycle-rail",
  "active-canvas",
  "query",
  "sidecar",
  "relay",
  "session",
];