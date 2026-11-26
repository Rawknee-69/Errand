import { CONNECTORS_PATH } from "@errand/shared";

export type Screen =
  | "connect"
  | "connectors"
  | "catalog"
  | "slips"
  | "receipts"
  | "trust"
  | "journal"
  | "keys";

export type NavItem = {
  screen: Screen;
  label: string;
  title: string;
};

type PlaceholderCopy = {
  ticket: number;
  copy: string;
};

type ScreenInfo = NavItem & {
  path: string;
  placeholder?: PlaceholderCopy;
};

const entries: ScreenInfo[] = [
  {
    screen: "connect",
    path: "/connect",
    label: "Connect",
    title: "Connect a service",
  },
  {
    screen: "connectors",
    path: CONNECTORS_PATH,
    label: "Connectors",
    title: "Connectors",
  },
  {
    screen: "catalog",
    path: "/catalog",
    label: "Catalog",
    title: "Catalog",
  },
  {
    screen: "slips",
    path: "/slips",
    label: "Slips",
    title: "Slips",
  },
  {
    screen: "receipts",
    path: "/receipts",
    label: "Receipts",
    title: "Receipts",
    placeholder: {
      ticket: 19,
      copy: "What was verified, what could not be, and undo only where a real inverse exists.",
    },
  },
  {
    screen: "trust",
    path: "/trust",
    label: "Trust",
    title: "Trust",
    placeholder: {
      ticket: 19,
      copy: "Each errand type's tier, its clean-run count, and the caps you set for a license.",
    },
  },
  {
    screen: "journal",
    path: "/journal",
    label: "Journal",
    title: "Journal",
    placeholder: {
      ticket: 19,
      copy: "Run the hash-chain check and see the first broken sequence, or a clean verdict.",
    },
  },
  {
    screen: "keys",
    path: "/keys",
    label: "Keys",
    title: "Agent keys",
    placeholder: {
      ticket: 19,
      copy: "Create and revoke the keys your agents use. A key is shown once, then only its hash remains.",
    },
  },
];

export const nav: NavItem[] = entries.map(({ screen, label, title }) => ({
  screen,
  label,
  title,
}));

export type PlaceholderInfo = {
  title: string;
  ticket: number;
  copy: string;
};

function entryFor(screen: Screen): ScreenInfo {
  const entry = entries.find((candidate) => candidate.screen === screen);
  if (entry === undefined) throw new Error(`No route for screen ${screen}`);
  return entry;
}

export function pathFor(screen: Screen): string {
  return entryFor(screen).path;
}

export function placeholderFor(screen: Screen): PlaceholderInfo | undefined {
  const entry = entryFor(screen);
  if (entry.placeholder === undefined) return undefined;
  return { title: entry.title, ...entry.placeholder };
}

export function screenFromPath(pathname: string): Screen {
  const normalized = pathname.replace(/\/$/, "");
  return entries.find((entry) => entry.path === normalized)?.screen ?? "connect";
}
