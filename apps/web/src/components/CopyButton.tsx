import { useState } from "react";

type Props = {
  value: string;
  label: string;
};

async function copyText(value: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    const area = document.createElement("textarea");
    area.value = value;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const copied = document.execCommand("copy");
    area.remove();
    return copied;
  }
}

export function CopyButton({ value, label }: Props) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");

  async function copy() {
    setState((await copyText(value)) ? "copied" : "failed");
    window.setTimeout(() => setState("idle"), 2_000);
  }

  return (
    <button type="button" className="button small" onClick={copy}>
      {state === "copied" ? "Copied" : state === "failed" ? "Copy failed" : label}
    </button>
  );
}
