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

type ScreenInfo = NavItem & {
  path: string;
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
  },
  {
    screen: "trust",
    path: "/trust",
    label: "Trust",
    title: "Trust",
  },
  {
    screen: "journal",
    path: "/journal",
    label: "Journal",
    title: "Journal",
  },
  {
    screen: "keys",
    path: "/keys",
    label: "Keys",
    title: "Agent keys",
  },
];

export const nav: NavItem[] = entries.map(({ screen, label, title }) => ({
  screen,
  label,
  title,
}));

function entryFor(screen: Screen): ScreenInfo {
  const entry = entries.find((candidate) => candidate.screen === screen);
  if (entry === undefined) throw new Error(`No route for screen ${screen}`);
  return entry;
}

export function pathFor(screen: Screen): string {
  return entryFor(screen).path;
}

export function screenFromPath(pathname: string): Screen {
  const normalized = pathname.replace(/\/$/, "");
  return entries.find((entry) => entry.path === normalized)?.screen ?? "connect";
}
